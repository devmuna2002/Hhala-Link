import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, StatusBar, Animated, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as NativeSplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_900Black } from '@expo-google-fonts/poppins';

import { supabase } from './supabase';
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
import MoversListScreen from './screens/MoversListScreen';
import MoverDetailScreen from './screens/MoverDetailScreen';
import BookMoverScreen from './screens/BookMoverScreen';
import MyMoverBookingsScreen from './screens/MyMoverBookingsScreen';
import MoverReviewScreen from './screens/MoverReviewScreen';
import NotificationDetailScreen from './screens/NotificationDetailScreen';

import AvatarUploadModal from './components/AvatarUploadModal';
import ErrorBoundary from './components/ErrorBoundary';
import { NotificationService } from './services/NotificationService';
import { RealtimeNotificationListener } from './services/RealtimeNotificationListener';
import RealtimeNotificationBanner from './components/RealtimeNotificationBanner';

const navigationRef = createNavigationContainerRef();

NativeSplashScreen.preventAutoHideAsync().catch(() => {});

const Stack = createNativeStackNavigator();

function AppContent() {
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [avatarModalDismissed, setAvatarModalDismissed] = useState(false);
  
  // Real-time Push Alert States
  const [currentNotification, setCurrentNotification] = useState(null);
  const [bannerVisible, setBannerVisible] = useState(false);

  const splashOpacity = useRef(new Animated.Value(1)).current;
  const splashScale = useRef(new Animated.Value(0.9)).current;

  let [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_900Black,
  });

  const loadUserProfile = async (userId) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error && data) {
        setUserProfile(data);
      }
    } catch (e) {
      console.log('[App] loadUserProfile error:', e?.message || e);
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Safety timeout: Ensure app loads even if Supabase network is unreachable on slow cellular data
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        setAuthLoaded(true);
      }
    }, 2500);

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      setSession(session);
      if (session?.user) {
        loadUserProfile(session.user.id);
        registerForPushNotificationsAsync(session.user.id);
      }
      setAuthLoaded(true);
    }).catch((err) => {
      console.log('[App] getSession error:', err);
      if (isMounted) setAuthLoaded(true);
    }).finally(() => {
      clearTimeout(safetyTimeout);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) return;
        setSession(session);
        if (session?.user) {
          loadUserProfile(session.user.id);
          registerForPushNotificationsAsync(session.user.id);
        } else {
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
      .channel(`app_profile_listener_${session.user.id}`)
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
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', user.id);
    }
  };

  useEffect(() => {
    updateLastSeen();
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        updateLastSeen();
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && authLoaded) {
      NativeSplashScreen.hideAsync().catch(() => {});
      
      Animated.sequence([
        Animated.parallel([
          Animated.timing(splashScale, { toValue: 1, duration: 450, useNativeDriver: true }),
          Animated.timing(splashOpacity, { toValue: 1, duration: 450, useNativeDriver: true })
        ]),
        Animated.delay(1000),
        Animated.timing(splashOpacity, { toValue: 0, duration: 350, useNativeDriver: true })
      ]).start(() => {
        setShowSplash(false);
      });
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
        <NavigationContainer ref={navigationRef}>
          <StatusBar barStyle="dark-content" />
          <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
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

      {/* Custom Animated Splash Screen Overlay */}
      {showSplash && (
        <Animated.View style={[styles.splashContainer, { opacity: splashOpacity }]} pointerEvents={showSplash ? 'auto' : 'none'}>
          <LinearGradient 
            colors={['#011232', '#0d1c4d', '#011232']} 
            style={StyleSheet.absoluteFill} 
          />
          <Animated.Image 
            source={require('./assets/logo_new.png')} 
            style={[styles.splashLogo, { transform: [{ scale: splashScale }] }]} 
          />
        </Animated.View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <AppContent />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#011232',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  splashLogo: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'transparent',
  }
});
