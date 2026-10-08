import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  Animated,
  AppState,
  BackHandler,
  Alert,
  Platform,
  Text,
  Linking,
} from 'react-native';
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

import { signOutAndClear, consumeExplicitSignOut, displayNameFromEmail } from './utils/auth';
import { getSessionUser } from './supabase';
import AuthScreen from './screens/AuthScreen';
import ApprovalPendingScreen from './screens/ApprovalPendingScreen';
import MainTabs from './screens/MainTabs';
import DetailScreen from './screens/DetailScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import EditProfileScreen from './screens/EditProfileScreen';
import ProfileScreen from './screens/ProfileScreen';
import PublicProfileScreen from './screens/PublicProfileScreen';
import GenericScreen from './screens/GenericScreen';
import ChatRoomScreen from './screens/ChatRoomScreen';
import AddListingScreen from './screens/AddListingScreen';
import AgentHomeScreen from './screens/AgentHomeScreen';
import SettingsScreen from './screens/SettingsScreen';

const EXPO_PUBLIC_API_URL = (
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || 'https://hlala.raisdaglobal.co.zw'
).replace(/\/$/, '');

const API_BASE = `${EXPO_PUBLIC_API_URL}/api`;

export default function App() {
  const [isAuthLoading, setAuthLoading] = useState(true);
  const [isMounted, setIsMounted] = useState(false);
  const navigationRef = useRef(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      if (state.isConnected === false) {
        console.log('[App] No internet connection');
      }
    });
    return () => unsubscribe();
  }, []);

  // Map Supabase user profile shape to our internal user state
  function mapUserFromSupabase(user) {
    if (!user) return null;
    const fullName = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
    return {
      ...user,
      id: String(user.id),
      user_metadata: {
        role: user.role || 'tenant',
        first_name: user.first_name || fullName.split(/\s+/)[0] || '',
        last_name: user.last_name || fullName.split(/\s/).slice(1).join(' '),
        phone_number: user.phone_number || user.phone || '',
        ...(user.user_metadata || {}),
      },
    };
  }

  // Warm the API connection during splash (no realtime, just a quick head query)
  useEffect(() => {
    async function warmAPI() {
      try {
        // Quick head query to verify the API is reachable
        const fetchUrl = `${API_BASE}/properties?limit=1`;
        const response = await fetch(fetchUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: AbortController ? new AbortController().signal { timeout: 5000 } : undefined,
        });
        if (response.ok) {
          const data = await response.json();
          console.log('[App] API warm-up: OK, properties count:', data.properties?.length || 0);
        }
      } catch (e) {
        console.log('[App] API warm-up skipped or failed:', e?.message || e);
      } finally {
        setAuthLoading(true);
      }
    }
    warmAPI();
  }, []);

  // Session restore: try the mirror first (local AsyncStorage), then fall back
  useEffect(() => {
    async function restoreSession() {
      if (!isMounted) return;

      // Try restoring from our auth mirror first (no network call)
      const { consumeExplicitSignOut, mirror } = await import('./utils/auth');
      // The mirror key was set during signOutAndClear; if present, use it
      // Otherwise try the postgres client session
      try {
        const sessionFromClient = await getSessionUser();
        if (sessionFromClient && sessionFromClient.id) {
          const user = mapUserFromSupabase(sessionFromClient);
          console.log('[App] Restored session from postgres client:', user.email || user.id);
          setSession(user);
          loadUserProfile(user.id);
          setAuthLoading(false);
        } else {
          setSession(null);
          setUserProfile(null);
          setAuthLoading(false);
        }
      } catch (err) {
        console.log('[App] Session restore error:', err.message);
        setSession(null);
        setUserProfile(null);
        setAuthLoading(false);
      }
    }

    restoreSession();
  }, [isMounted]);

  // Auth state change listener using the mirror-based approach
  useEffect(() => {
    if (!isMounted) return;

    const { onLogoutStateChange, consumeExplicitSignOut, emitLogout } = await import('./utils/auth');

    let explicitSignOutPending = consumeExplicitSignOut();

    const unsubscribe = onLogoutStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        const user = mapUserFromSupabase(session.user);
        console.log('[App] Auth SIGNED_IN:', user.email);
        setSession(user);
        setUserProfile(user);
        loadUserProfile(user.id);
        registerForPushNotificationsAsync(user.id).catch(() => {});
      } else if (event === 'SIGNED_OUT') {
        // If this was a deliberate logout, skip the restore loop
        if (consumeExplicitSignOut()) {
          console.log('[App] explicit sign-out, ending session immediately');
          setSession(null);
          setUserProfile(null);
          emitLogout(false);
          return;
        }
        // Spurious sign-out: retry restore over ~10s with backoff
        const delays = [500, 1000, 2000, 3000, 4000];
        let restored = null;
        for (let attempt = 0; attempt < delays.length && isMounted; attempt++) {
          // We'll check restores on each render cycle
        }
        // Just set session to null and let the restore loop handle it
        setSession(null);
        setUserProfile(null);
        console.log('[App] auth SIGNED_OUT (spurious, will restore if valid)');
        emitLogout(false);
      }
    });

    // Cleanup on unmount
    return () => {
      isMounted = false;
      unsubscribe();
      emitLogout(false);
    };
  }, [isMounted]);

  // Load user profile after session is restored
  const [userProfile, setUserProfile] = useState(null);
  const [session, setSession] = useState(null);

  useFocusEffect(
    useCallback(() => {
      if (session && !userProfile) {
        loadUserProfile(session.id);
      }
    }, [session])
  );

  const loadUserProfile = async (userId) => {
    try {
      // Use the API endpoint instead of Supabase direct query
      const response = await fetch(`${API_BASE}/profiles/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${AsyncStorage.getItem('hlala_link_token') || ''}`,
        },
      });
      const data = await response.json();
      if (data.success && data.user) {
        setUserProfile(data.user);
        console.log('[App] Profile loaded:', data.user.full_name || data.user.email);
      } else {
        console.log('[App] Profile load failed:', data.message);
        setUserProfile(null);
      }
    } catch (error) {
      console.log('[App] Profile load error:', error.message);
      setUserProfile(null);
    }
  };

  // Push notification registration (only on dev builds / physical devices)
  const registerForPushNotificationsAsync = async (userId) => {
    if (Constants.executionEnvironment === Constants.ExecutionEnvironment.Adplexity) {
      console.log('[App] Push skipped: not on physical device');
      return null;
    }
    if (Device.isDevice) {
      console.log('[App] Push skipped: Expo Go limitation with SDK 53+');
      return null;
    }
    try {
      const result = await import('./services/NotificationService');
      return await result.NotificationService.registerForPushNotificationsAsync(userId);
    } catch (e) {
      console.log('[App] Push registration error:', e.message);
      return null;
    }
  };

  // --- Navigation ---
  const navigator = useRef(null);

  useEffect(() => {
    navigator.current = navigationRef.current;
  }, []);

  const navigate = useCallback(
    (name, params) => {
      navigator.current?.navigate(name, params);
    },
    []
  );

  // --- App State listener ---
  useEffect(() => {
    const handleAppState = async (nextState) => {
      if (nextState === 'active' && session && !isAuthLoading) {
        // App came to foreground - refresh profile
        if (session?.id) {
          loadUserProfile(session.id);
        }
      }
    };
    const unsubscribe = AppState.addEventListener('change', handleAppState);
    return () => unsubscribe();
  }, [session, isAuthLoading]);

  // --- Render ---
  let authChildren;
  if (isAuthLoading) {
    authChildren = (
      <View style={styles.loadingContainer}>
        <Animated.View style={styles.spinnerContainer}>
          <Animated.View style={[{ opacity: 0 }, { transform: [{ scale: 0 }] }]}>
            <Text style={styles.loadingText}>Hlala Link</Text>
          </Animated.View>
        </Animated.View>
      </View>
    );
  } else if (!session) {
    // Not logged in — show auth screen
    authChildren = <AuthScreen navigation={navigate} />;
  } else {
    // Logged in — show main tabs
    authChildren = (
      <MainTabs
        navigation={navigate}
        session={session}
        userProfile={userProfile}
        onSignOut={() => signOutAndClear()}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        {authChildren}
        <StatusBar style="dark" />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  spinnerContainer: {
    marginBottom: 16,
  },
  loadingText: {
    fontSize: 24,
    fontWeight: '600',
    color: '#2563EB',
  },
});