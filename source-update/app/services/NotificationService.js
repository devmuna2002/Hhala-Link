import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Alert, Platform } from 'react-native';
import { requestPushNotification, supabase } from '../supabase';

// Expo Notification Config
// Configure foreground notification presentation style (mimicking native alerts).
// Runs everywhere including Expo Go — module-scope side effect must never
// throw. A throw here runs at import time (before any ErrorBoundary mounts)
// and hard-crashes release builds.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch (e) {
  console.log('[NotificationService] setNotificationHandler skipped:', e?.message || e);
}

// profiles.push_token is shared with the web app: it may hold a raw web-push
// subscription JSON, or a merged {"expo","web"} object. Preserve any stored
// web subscription when saving the Expo token (and vice versa on web).
function mergePushTokens(existing, expoToken) {
  if (!expoToken) return existing ?? null;
  if (!existing) return expoToken;
  let parsed = null;
  try {
    parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
  } catch (_) {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object' && (parsed.expo || parsed.web)) {
    parsed.expo = expoToken;
    return JSON.stringify(parsed);
  }
  if (parsed && typeof parsed === 'object' && typeof parsed.endpoint === 'string') {
    return JSON.stringify({ expo: expoToken, web: parsed });
  }
  // Raw string (or anything else): keep the Expo token unless the stored
  // value already looks like a web subscription wrapper.
  return expoToken;
}

export const NotificationService = {
  /**
   * Create Android notification channels ONCE, at app startup.
   * Android 8.0+ requires a channel before ANY notification (local or remote)
   * can be shown; doing it only at push-token registration misses apps launched
   * cold where the user isn't signed in yet.
   */
  async configureAndroidChannel() {
    if (Platform.OS !== 'android') return;
    try {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Hlala Link',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#30338F',
        sound: 'default',
      });
      // Compact channel for status updates (booking/application confirmations)
      await Notifications.setNotificationChannelAsync('updates', {
        name: 'Updates',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 150, 150, 150],
        lightColor: '#30338F',
        sound: 'default',
      });
      console.log('[NotificationService] Android notification channels configured');
    } catch (error) {
      console.error('[NotificationService] configureAndroidChannel error:', error);
    }
  },

  /**
   * Request push permissions and register the Expo Push Token in Supabase.
   * @param {string} userId - The authenticated user's ID
   */
  async registerForPushNotificationsAsync(userId) {
    // Web has no Expo push-token path: getExpoPushTokenAsync({ projectId })
    // throws without a notification.vapidPublicKey, and browser push is
    // served by the service-worker subscription instead. Skip quietly —
    // without this, every web launch logs a red Registration error.
    // (Device.isDevice is true in desktop browsers, so it can't guard this.)
    if (Platform.OS === 'web') {
      console.log('[NotificationService] Skipping Expo push registration on web (browser push uses the service worker).');
      return null;
    }
    // Manual opt-in only (Settings toggle) — works in Expo Go too; remote
    // delivery there depends on the build, but registration is attempted.
    if (!Device.isDevice) {
      console.log('[NotificationService] Must use physical device for Push Notifications');
      return null;
    }

    try {
      // Ensure the channel always exists before requesting tokens / scheduling
      await this.configureAndroidChannel();

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('[NotificationService] Failed to get push token for push notification!');
        return null;
      }

      // Project ID from EAS configuration (must match in app.json)
      const projectId = 
        Constants.expoConfig?.extra?.eas?.projectId || 
        Constants.easConfig?.projectId;

      if (!projectId) {
        console.error('[NotificationService] EAS Project ID missing in app config');
        return null;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenData.data;

      if (token) {
        console.log('[NotificationService] Generated token:', token);
        // profiles.push_token is shared with the web app (which stores a
        // Web-Push subscription there). Merge instead of overwriting so a
        // phone login doesn't wipe the browser subscription and vice versa.
        let value = token;
        try {
          const { data } = await supabase
            .from('profiles')
            .select('push_token')
            .eq('id', userId)
            .maybeSingle();
          value = mergePushTokens(data?.push_token, token);
        } catch (_) {
          value = token;
        }
        const { error } = await supabase
          .from('profiles')
          .update({ push_token: value })
          .eq('id', userId);

        if (error) {
          console.error('[NotificationService] Error saving token to Supabase:', error.message);
        } else {
          console.log('[NotificationService] Token successfully saved to database');
        }
        return token;
      }
    } catch (error) {
      console.error('[NotificationService] Registration error:', error);
    }
    return null;
  },

  /**
   * Remove the push token from profiles table (sign out scenario)
   * @param {string} userId - The user ID
   */
  async unregisterForPushNotificationsAsync(userId) {
    // Web never stores an Expo token (see register above) — and push_token
    // is shared with the phone app, so nulling it here would silently kill
    // push on the user's phone.
    if (Platform.OS === 'web') {
      console.log('[NotificationService] Skipping push unregister on web (shared phone token preserved).');
      return;
    }
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ push_token: null })
        .eq('id', userId);

      if (error) {
        console.error('[NotificationService] Error clearing token from Supabase:', error.message);
      } else {
        console.log('[NotificationService] Token successfully cleared from database');
      }
    } catch (error) {
      console.error('[NotificationService] Unregistration error:', error);
    }
  },

  /**
   * Clear the app icon badge (iOS accumulates it forever otherwise).
   */
  async clearBadgeAsync() {
    try {
      await Notifications.setBadgeCountAsync(0);
    } catch (_) {}
  },

  /**
   * Tap-to-open wiring: a tapped push deep-links into the right screen.
   * Handles both cold starts (app launched by the tap) and warm taps.
   * Safe to call in Expo Go — listener setup is a no-op there at worst.
   * Returns an unsubscribe function.
   */
  async setupPushResponseListeners(navigationRef) {
    const openFromData = (data) => {
      try {
        if (!data || Object.keys(data).length === 0) return false;
        if (!navigationRef?.isReady?.()) return false;
        const type = data.type;
        if ((type === 'message' || type === 'landlord_message') && data.conversationId) {
          navigationRef.navigate('ChatRoom', { conversationId: data.conversationId });
          return true;
        }
        // Every other push type lands in the Activity inbox.
        navigationRef.navigate('Main', { screen: 'Notification' });
        return true;
      } catch (_) {
        return false;
      }
    };
    const openSoon = (data) => {
      if (!data) return;
      if (!openFromData(data)) setTimeout(() => openFromData(data), 1200);
    };
    try {
      const last = await Notifications.getLastNotificationResponseAsync().catch(() => null);
      openSoon(last?.notification?.request?.content?.data);
    } catch (_) {}
    let sub = null;
    try {
      sub = Notifications.addNotificationResponseReceivedListener((response) => {
        openSoon(response?.notification?.request?.content?.data);
      });
    } catch (e) {
      console.log('[NotificationService] response listener skipped:', e?.message || e);
    }
    return () => {
      try { sub?.remove(); } catch (_) {}
    };
  },

  /**
   * Ask the sender to confirm before any push goes out. Previews the
   * exact title/body the recipient will receive. Resolves true only
   * when the sender taps Send — Cancel/dismiss means no push is sent.
   */
  confirmSendNotification({ title, body }) {
    return new Promise((resolve) => {
      try {
        Alert.alert(
          'Send notification?',
          `${title || 'Hlala Link'}${body ? `\n\n${body}` : ''}`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Send', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      } catch (_) {
        resolve(false);
      }
    });
  },

  /**
    * Relay a push request to the authenticated server, which resolves the
    * recipient's private token and dispatches through Expo. Never throws.
   */
  async notifyUser({ recipientId, title, body, data = {}, confirm = true }) {
    try {
      if (!recipientId) return { success: false };
      if (confirm) {
        const ok = await this.confirmSendNotification({ title, body });
        if (!ok) return { success: false, dismissed: true };
      }
      const response = await requestPushNotification({ recipientId, title, body, data });
      if (response.error) {
        // Dev-visible diagnosis: 403 = recipient mismatch, 400 = bad
        // payload, 502 = Expo rejected the ticket (bad token / missing
        // FCM-APNs credentials). Previously this failed totally silently.
        console.warn('[NotificationService] Push relay failed:', response.error.message, '| detail:', JSON.stringify(response.data || null));
        return { success: false, error: response.error.message };
      }
      if (response.data && response.data.push === 'skipped') {
        console.warn('[NotificationService] Push skipped — recipient has no push token:', recipientId);
      }
      return { success: true, response: response.data };
    } catch (e) {
      return { success: false, error: e?.message || 'notify failed' };
    }
  },

  /**
   * Fan-out a real push for a chat message. Nothing else in the system
   * sends Expo pushes (DB triggers only write `notifications` rows), so
   * without this, messages never arrive when the app is closed.
   * Profiles are publicly readable, so the recipient token resolves
   * client-side. Never throws — a failed push must never fail the send.
   */
  async notifyChatRecipient({ recipientId, senderId, senderName, body, conversationId, confirm = true }) {
    if (!recipientId || recipientId === senderId) return { success: false };
    return this.notifyUser({
      recipientId,
      title: senderName || 'New message',
      body: body || 'You have a new message.',
      data: {
        type: 'message',
        conversationId: conversationId || null,
        senderId: senderId || null,
        senderName: senderName || null,
      },
      confirm,
    });
  },

  /**
   * Programmatically dispatch an Expo Push Notification.
   * Titles/bodies are stripped of emojis for clean plain text.
   */
  async sendPushNotification({ to, title, body, data = {}, sound = 'default' }) {
    if (!to || !to.startsWith('ExponentPushToken')) {
      console.log('[NotificationService] Invalid push token');
      return { success: false, error: 'Invalid push token' };
    }

    const stripEmojis = (t) =>
      String(t || '')
        .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();

    const payload = {
      to,
      sound,
      title: stripEmojis(title) || 'Hlala Link',
      body: stripEmojis(body),
      data,
      channelId: 'default',
      _displayInForeground: true // Expo iOS compatibility flag
    };

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const resJson = await response.json();
      console.log('[NotificationService] Push API Response:', resJson);
      return { success: true, response: resJson };
    } catch (error) {
      console.error('[NotificationService] Error sending push API call:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Helper to resolve the correct navigation route based on notification type.
   * Enables seamless deep-linking inside the app (like Uber, Property24, Airbnb).
   * @param {string} type - Notification classification
   * @param {string} referenceId - UUID matching key entities (property_id, booking_id, application_id, etc.)
   */
  getNotificationRoute(type, referenceId) {
    switch (type) {
      case 'message':
      case 'landlord_message':
        return {
          screen: 'ChatRoom',
          params: { conversationId: referenceId }
        };

      case 'price_drop':
      case 'new_listing':
      case 'property_match':
        return {
          screen: 'Detail',
          params: { propertyId: referenceId }
        };

      case 'new_move_request':
      case 'mover_booking':
      case 'booking_confirmed':
      case 'pickup_reminder':
      case 'route_update':
      case 'delivery_complete':
      case 'mover_payment_received':
        return {
          screen: 'MyMoverBookings',
          params: {}
        };

      case 'application_received':
        return {
          screen: 'Generic',
          params: { title: 'Application Details', icon: 'document-text', message: 'Review the application from the notifications list. Open the related listing to approve or reject it.' }
        };
      case 'application_approved':
        return {
          screen: 'Generic',
          params: { title: 'Application Approved', icon: 'checkmark-circle', message: 'Good news! Your application was approved. The agent will be in touch shortly with next steps.' }
        };
      case 'application_rejected':
        return {
          screen: 'Generic',
          params: { title: 'Application Update', icon: 'close-circle', message: 'Your application was not successful this time. Keep exploring other listings on Hlala Link.' }
        };

      case 'property_analytics':
        return {
          screen: 'AgentHome',
          params: { tab: 'analytics', propertyId: referenceId }
        };

      case 'listing_moderation':
      case 'user_report':
        return {
          screen: 'Support',
          params: { flagId: referenceId }
        };

      default:
        return {
          screen: 'Main',
          params: {}
        };
    }
  }
};
