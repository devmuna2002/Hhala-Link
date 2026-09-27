import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from '../supabase';

// Expo Notification Config
// Configure foreground notification presentation style (mimicking native alerts)
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

if (!IS_EXPO_GO) {
  // Module-scope side effect: must never throw. A throw here runs at import
  // time (before any ErrorBoundary mounts) and hard-crashes release builds.
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
    if (IS_EXPO_GO) {
      console.log('[NotificationService] Push notifications not supported in Expo Go with SDK 53+');
      return null;
    }

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
        console.log('[NotificationService] EAS Project ID missing in app config');
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
      const token = tokenData.data;

      if (token) {
        console.log('[NotificationService] Generated token:', token);
        const { error } = await supabase
          .from('profiles')
          .update({ push_token: token })
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
   * Programmatically dispatch an Expo Push Notification.
   * Useful for testing or client-initiated alerts (e.g. ChatRoom or peer-to-peer freight changes).
   * Threads-style: titles/bodies are stripped of emojis for clean plain text.
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
