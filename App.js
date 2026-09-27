import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, StatusBar, Animated, AppState, BackHandler, Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as NativeSplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as ScreenCapture from 'expo-screen-capture';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_900Black } from '@expo-google-fonts/poppins';

import { supabase, getSessionUser } from './supabase';
import AuthScreen from './screens/AuthScreen';
import ApprovalPendingScreen from './screens/ApprovalPendingScreen';
import MainTabs from './screens/MainTabs';
import DetailScreen from './screens/DetailScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import EditProfileScreen from './screens/EditProfileScreen';
import ProfileScreen from './screens/ProfileScreen';
import GenericScreen from './screens/GenericScreen';
import ChatRoomScreen from './screens/ChatRoomScreen';
import AddListingScreen from './screens/AddListingScreen';
import AgentHomeScreen from './screens/AgentHomeScreen';
import SettingsScreen from './screens/SettingsScreen';
import SupportScreen from './screens/SupportScreen';
import PaymentScreen from './screens/PaymentScreen';
import UserListScreen from './screens/UserListScreen';
import PaynowWebViewScreen from './screens/PaynowWebViewScreen';
import SavedSearchesScreen from './screens/SavedSearchesScreen';
import SavedScreen from './screens/SavedScreen';
import MoversListScreen from './screens/MoversListScreen';
import MoverDetailScreen from './screens/MoverDetailScreen';
import BookMoverScreen from './screens/BookMoverScreen';
import MyMoverBookingsScreen from './screens/MyMoverBookingsScreen';
import MoverReviewScreen from './screens/MoverReviewScreen';
import NotificationDetailScreen from './screens/NotificationDetailScreen';

import AvatarUploadModal from './components/AvatarUploadModal';
import ErrorBoundary from './components/ErrorBoundary';
import { NotificationService } from './services/NotificationService';
import { setDeviceOnline, requestReconnect, isOfflineNow } from './utils/connection';
import { RealtimeNotificationListener } from './services/RealtimeNotificationListener';
import RealtimeNotificationBanner from './components/RealtimeNotificationBanner';
import { AUTH_MIRROR_KEY, consumeExplicitSignOut } from './utils/auth';

const navigationRef = createNavigationContainerRef();

NativeSplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();

function AppContent() {
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [avatarModalDismissed, setAvatarModalDismissed] = useState(false);
  const inFlightRestore = useRef(null);

  const mirrorSession = async (sess) => {
    try {
      if (sess?.access_token && sess?.refresh_token) {
        await AsyncStorage.setItem(AUTH_MIRROR_KEY, JSON.stringify(sess));
      }
    } catch (e) {}
  };

  const clearMirror = async () => {
    try { await AsyncStorage.removeItem(AUTH_MIRROR_KEY); } catch (e) {}
  };

  // If supabase.js throws a spurious SIGNED_OUT (token refresh hiccup, network
  // blip right after login), revive the session from our own copy instead of
  // dumping the user back to the login screen. The mirror is only deleted when
  // an EXPLICIT sign-out happens; a failed restore attempt must never destroy it.
  const restoreSessionFromMirror = async (isMounted) => {
    if (inFlightRestore.current) return (await inFlightRestore.current) || null;
    inFlightRestore.current = (async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_MIRROR_KEY);
        if (!raw) {
          console.log('[App] restore: no mirror stored');
          return null;
        }
        const mirror = JSON.parse(raw);
        const { data, error } = await supabase.auth.setSession({
          access_token: mirror.access_token,
          refresh_token: mirror.refresh_token,
        });
        if (error || !data.session) {
          console.log('[App] restore: setSession rejected:', error?.message || 'no session');
          return null;
        }
        console.log('[App] restore: session revived from mirror (' + (data.session.user?.email || 'user') + ')');
        await mirrorSession(data.session);
        return data.session;
      } catch (e) {
        console.log('[App] restore: exception:', e?.message || e);
        return null;
      } finally {
        inFlightRestore.current = null;
      }
    })();
    return (await inFlightRestore.current) || null;
  };
  
  // Real-time Push Alert States
  const [currentNotification, setCurrentNotification] = useState(null);
  const [bannerVisible, setBannerVisible] = useState(false);

  let [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_900Black,
  });

  const ensureProfile = async (userId, email, metadata) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error && data) {
        const nameFromEmail = (email || '').split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim();
        const missingName = !(data.first_name || data.last_name) && nameFromEmail;
        if (missingName || !data.role) {
          const patch = {};
          if (missingName) patch.first_name = nameFromEmail;
          if (!data.role) patch.role = metadata?.role || 'tenant';
          const { error: upErr } = await supabase.from('profiles').update(patch).eq('id', userId);
          if (upErr) console.log('[App] ensureProfile update error:', upErr?.message || upErr);
          else console.log('[App] Patched blank profile fields for', userId);
        }
        return;
      }
      const nameHint = (email || '').split('@')[0] || 'Hlala Link User';
      const readable = nameHint
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim();
      const { error: insErr } = await supabase.from('profiles').insert([{
        id: userId,
        email: email || null,
        first_name: readable,
        role: metadata?.role || 'tenant',
        created_at: new Date().toISOString(),
      }]);
      if (insErr) console.log('[App] ensureProfile insert error:', insErr?.message || insErr);
      else console.log('[App] Created missing profile for', userId);
    } catch (e) {
      console.log('[App] ensureProfile error:', e?.message || e);
    }
  };

  const loadUserProfile = async (userId) => {
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error || !data) {
        const u = await getSessionUser();
        await ensureProfile(userId, u?.email, u?.user_metadata);
        const res = await supabase.from('profiles').select('*').eq('id', userId).single();
        if (!res.error && res.data) data = res.data;
      }
      if (data) {
        setUserProfile(data);
        if (data.role) {
          try {
            await AsyncStorage.setItem(`cached_profile_role_${userId}`, data.role);
          } catch (_) {}
        }
      }
    } catch (e) {
      console.log('[App] loadUserProfile error:', e?.message || e);
    }
  };

  // Configure Android notification channels as early as possible so any
  // local notification (booking, chat, approvals) works even when signed out.
  useEffect(() => {
    NotificationService.configureAndroidChannel();
  }, []);

  // Screenshots & screen recordings are BLOCKED app-wide (Android
  // FLAG_SECURE + iOS screen protection), so property images can never be
  // captured on any screen where a listing image is shown.
  const SCREENSHOT_BLOCK_ENABLED = true;

  // Strictly block screenshots & screen recordings across the app (Android FLAG_SECURE + iOS screen protection)
  // and activate app-switcher privacy blur protection so property images can never be captured.
  useEffect(() => {
    if (!SCREENSHOT_BLOCK_ENABLED) {
      // Make sure no leftover FLAG_SECURE / protection persists from a
      // previous build that had blocking enabled.
      if (Platform.OS !== 'web') {
        try {
          ScreenCapture.allowScreenCaptureAsync?.().catch(() => {});
        } catch (_) {}
        try {
          ScreenCapture.disableAppSwitcherProtectionAsync?.().catch(() => {});
        } catch (_) {}
      }
      return;
    }
    if (Platform.OS === 'web') return;
    
    // 1. Prevent screenshots & video screen captures
    ScreenCapture.preventScreenCaptureAsync().catch(() => {});
    
    // 2. Blur app preview in iOS app switcher to protect property media snapshots
    if (ScreenCapture.enableAppSwitcherProtectionAsync) {
      ScreenCapture.enableAppSwitcherProtectionAsync(0.85).catch(() => {});
    }

    // 3. Detect and notify user if a screenshot attempt is made
    let subscription = null;
    try {
      subscription = ScreenCapture.addScreenshotListener(() => {
        Alert.alert(
          'Screenshots Prohibited',
          'Screenshots and screen recordings of property media are strictly prohibited to safeguard host content and tenant privacy.',
          [{ text: 'I Understand' }]
        );
      });
    } catch (_) {}

    return () => {
      subscription?.remove?.();
    };
  }, []);

  // Android hardware back on the home screen would otherwise fire an unhandled
  // GO_BACK action — prompt to exit the app instead.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigationRef.isReady() && navigationRef.getRootState()?.routes?.length <= 1) {
        Alert.alert('Exit Hlala Link?', undefined, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Exit', style: 'destructive', onPress: () => BackHandler.exitApp() },
        ]);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Safety timeout: Ensure app loads even if Supabase network is unreachable on slow cellular data
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        setAuthLoaded(true);
        NativeSplashScreen.hideAsync().catch(() => {});
      }
    }, 2500);

    // Warm the REST connection during splash so the first feed queries don't
    // pay TLS/DNS setup cost after launch.
    supabase.from('properties').select('id', { count: 'exact', head: true }).limit(1).then(() => {}).catch(() => {});

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!isMounted) return;
      console.log('[App] initial getSession:', session?.user?.email || 'none');
      if (session?.user) {
        mirrorSession(session);
        setSession(session);
        loadUserProfile(session.user.id);
        registerForPushNotificationsAsync(session.user.id).catch(() => {});
      } else {
        // Fall back to our mirror in case supabase lost/rolled its storage.
        const restored = await restoreSessionFromMirror(isMounted);
        if (!isMounted) return;
        if (restored?.user) {
          setSession(restored);
          loadUserProfile(restored.user.id);
          registerForPushNotificationsAsync(restored.user.id).catch(() => {});
        } else {
          setSession(null);
        }
      }
      setAuthLoaded(true);
    }).catch((err) => {
      console.log('[App] getSession error:', err);
      if (isMounted) setAuthLoaded(true);
    }).finally(() => {
      clearTimeout(safetyTimeout);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!isMounted) return;
        console.log('[App] auth event:', _event, session?.user?.email || 'none');

        if (session?.user) {
          mirrorSession(session);
          setSession(session);
          loadUserProfile(session.user.id);
          registerForPushNotificationsAsync(session.user.id).catch(() => {});
          return;
        }

        if (_event === 'SIGNED_OUT' || _event === 'INITIAL_SESSION') {
          // Deliberate logout: skip the restore loop entirely and land on
          // the login screen instantly.
          if (consumeExplicitSignOut()) {
            console.log('[App] explicit sign-out, ending session immediately');
            setSession(null);
            setUserProfile(null);
            return;
          }
          // Survives spurious sign-outs on flaky networks: retry over ~10s
          // with backoff (tower handoffs outlast a 1.5s window), NEVER
          // deleting the mirror on failure so nothing is lost mid-blip.
          let restored = null;
          const delays = [500, 1000, 2000, 3000, 4000];
          for (let attempt = 0; attempt < delays.length && isMounted; attempt++) {
            restored = await restoreSessionFromMirror(isMounted);
            if (restored?.user) break;
            if (!isMounted) return;
            await new Promise((r) => setTimeout(r, delays[attempt]));
          }
          if (!isMounted) return;
          if (restored?.user) {
            console.log('[App] kept signed in after', _event, 'event');
            setSession(restored);
            loadUserProfile(restored.user.id);
            registerForPushNotificationsAsync(restored.user.id).catch(() => {});
            return;
          }
          console.log('[App] auth event', _event, 'ended login session (setSession(null))');
          setSession(null);
          setUserProfile(null);
        }
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      subscription?.unsubscribe();
    };
  }, []);

  // Realtime listener for profile changes (instant auto-login upon admin approval)
  useEffect(() => {
    if (!session?.user?.id) return;

    const profileChannel = supabase
      .channel(`app_profile_listener_${session.user.id}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${session.user.id}`,
        },
        (payload) => {
          if (payload.new) {
            console.log('[App] Profile updated in realtime:', payload.new);
            setUserProfile(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(profileChannel);
    };
  }, [session?.user?.id]);

  // Centralized Postgres Insert Listener (Foreground Custom Sliding Alerts)
  useEffect(() => {
    if (!session?.user?.id) return;

    const listener = new RealtimeNotificationListener(session.user.id, (notification) => {
      // Never surface a banner for a message you sent yourself
      if (notification?.type === 'message' && notification?.actor_id === session.user.id) {
        console.log('[App] Ignoring self-authored message notification');
        return;
      }
      console.log('[App] New realtime notification received:', notification);
      setCurrentNotification(notification);
      setBannerVisible(true);
    });

    listener.subscribe();

    return () => {
      listener.unsubscribe();
    };
  }, [session?.user?.id]);

  async function registerForPushNotificationsAsync(userId) {
    return NotificationService.registerForPushNotificationsAsync(userId);
  }

  const updateLastSeen = async () => {
    const user = await getSessionUser();
    if (user) {
      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', user.id);
    }
  };

  // Device-radio connectivity (true signal) + foreground healing.
  // NetInfo drives the offline banner for airplane mode / dead WiFi, while
  // query results drive the server side — the two combine in utils/connection.
  useEffect(() => {
    let unsub = null;
    try {
      const applyState = (state) => {
        // isInternetReachable starts as null — only trust explicit false so
        // the app never flaps offline during startup.
        setDeviceOnline(state?.isConnected !== false && state?.isInternetReachable !== false);
      };
      unsub = NetInfo.addEventListener(applyState);
      NetInfo.fetch().then(applyState).catch(() => {});
    } catch (_) {}
    return () => {
      try { unsub?.(); } catch (_) {}
    };
  }, []);

  // Reconnect the realtime socket if the OS killed it while backgrounded,
  // refresh the in-memory session, and ask every feed to reload — but only
  // when something was actually wrong, so a healthy foreground return
  // doesn't burn data re-fetching feeds that are already fresh.
  const healConnections = async () => {
    const wasOffline = isOfflineNow();
    let socketWasDown = false;
    try {
      if (supabase.realtime && typeof supabase.realtime.isConnected === 'function') {
        if (!supabase.realtime.isConnected()) {
          socketWasDown = true;
          supabase.realtime.connect();
        }
      }
    } catch (_) {}
    try {
      await supabase.auth.getSession();
    } catch (_) {}
    if (wasOffline || socketWasDown) {
      try {
        requestReconnect();
      } catch (_) {}
    }
  };

  useEffect(() => {
    updateLastSeen();
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        updateLastSeen();
        healConnections();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && authLoaded) {
      // The native splash (white + hlala icon, from app.json) already brands
      // the launch — hiding it here reveals the feed instantly. No custom
      // overlay: one less layer that could ever stick on screen.
      NativeSplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError, authLoaded]);

  if ((!fontsLoaded && !fontError) || !authLoaded) {
    return null;
  }

  // Check if avatar prompt modal should be shown (avatar missing for any logged-in role)
  const isAvatarMissing = Boolean(
    session &&
    userProfile &&
    (!userProfile.avatar_url || userProfile.avatar_url.trim() === '') &&
    !avatarModalDismissed
  );

  return (
    <View style={{ flex: 1 }}>
      {(
        <NavigationContainer
          ref={navigationRef}
          theme={{
            dark: false,
            colors: {
              primary: '#111111',
              background: '#FFFFFF',
              card: '#FFFFFF',
              text: '#111111',
              border: '#EFEFEF',
              notification: '#FF3B30',
            },
            fonts: {
              regular: { fontFamily: 'Poppins_400Regular', fontWeight: '400' },
              medium: { fontFamily: 'Poppins_500Medium', fontWeight: '500' },
              bold: { fontFamily: 'Poppins_700Bold', fontWeight: '700' },
              heavy: { fontFamily: 'Poppins_900Black', fontWeight: '900' },
            },
          }}
        >
          <StatusBar barStyle="dark-content" />
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              animation: 'fade',
              contentStyle: { backgroundColor: '#FFFFFF' },
            }}
          >
            {session ? (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen 
                  name="Detail" 
                  component={DetailScreen} 
                  options={{ presentation: 'modal', animation: 'slide_from_bottom' }} 
                />
                <Stack.Screen name="Notifications" component={NotificationsScreen} />
                <Stack.Screen name="NotificationDetail" component={NotificationDetailScreen} />
                <Stack.Screen name="SavedSearches" component={SavedSearchesScreen} />
<Stack.Screen name="Saved" component={SavedScreen} />
                <Stack.Screen name="Profile" component={ProfileScreen} />
                <Stack.Screen name="EditProfile" component={EditProfileScreen} />
                <Stack.Screen name="Generic" component={GenericScreen} />
                <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
                <Stack.Screen name="AddListing" component={AddListingScreen} />
                <Stack.Screen name="AgentHome" component={AgentHomeScreen} />
                <Stack.Screen name="Settings" component={SettingsScreen} />
                <Stack.Screen name="Support" component={SupportScreen} />
                <Stack.Screen name="Payment" component={PaymentScreen} options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                <Stack.Screen name="UserList" component={UserListScreen} />
                <Stack.Screen name="PaynowWebView" component={PaynowWebViewScreen} />
                {/* Movers */}
                <Stack.Screen name="MoversList" component={MoversListScreen} />
                <Stack.Screen name="MoverDetail" component={MoverDetailScreen} options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="BookMover" component={BookMoverScreen} options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="MyMoverBookings" component={MyMoverBookingsScreen} options={{ animation: 'slide_from_right' }} />
                <Stack.Screen name="MoverReview" component={MoverReviewScreen} options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
              </>
            ) : (
              <Stack.Screen name="Auth" component={AuthScreen} />
            )}
          </Stack.Navigator>
        </NavigationContainer>
      )}

      {/* Pop modal for agents, users, movers to upload an avatar if not uploaded */}
      {session && userProfile && (
        <AvatarUploadModal
          visible={isAvatarMissing}
          user={session.user}
          profile={userProfile}
          onAvatarSaved={(newAvatarUrl) => {
            setUserProfile(prev => ({ ...prev, avatar_url: newAvatarUrl }));
            setAvatarModalDismissed(true);
          }}
          onDismiss={() => setAvatarModalDismissed(true)}
        />
      )}

      {/* Real-time Sliding In-App Push Notification Banner Overlay */}
      <RealtimeNotificationBanner
        notification={currentNotification}
        visible={bannerVisible}
        onDismiss={() => setBannerVisible(false)}
        onPress={(notification) => {
          const route = NotificationService.getNotificationRoute(notification.type, notification.reference_id);
          if (route && navigationRef.isReady()) {
            navigationRef.navigate(route.screen, route.params);
          }
        }}
      />
    </View>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <WebFrame>
        <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <AppContent />
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </WebFrame>
    </ErrorBoundary>
  );
}

// Web builds render inside a centered phone-width column so the app
// keeps its mobile look on any browser/desktop window width.
function WebFrame({ children }) {
  if (Platform.OS !== 'web') return children;
  return (
    <View style={webFrameStyles.frame}>
      <View style={webFrameStyles.screen}>{children}</View>
    </View>
  );
}

const webFrameStyles = StyleSheet.create({
  frame: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#E9EDF5',
  },
  screen: {
    width: '100%',
    maxWidth: 430,
    flex: 1,
    backgroundColor: '#FFFFFF',
    // boxShadow is a web-only CSS value: keep it off native style objects so
    // the Fabric renderer on Android release builds never sees an invalid prop.
    ...Platform.select({
      web: {
        boxShadow: '0 0 0 1px rgba(15,23,42,0.06), 0 24px 60px rgba(15,23,42,0.18)',
      },
      default: {},
    }),
    overflow: 'hidden',
  },
});
