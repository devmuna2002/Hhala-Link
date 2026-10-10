import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  StatusBar,
  AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  Poppins_900Black,
} from '@expo-google-fonts/poppins';

import {
  signOutAndClear,
  consumeExplicitSignOut,
  onLogoutStateChange,
  emitLogout,
} from './utils/auth';
import { supabase, getSessionUser } from './supabase';
import { ThemeProvider, useTheme } from './utils/theme';
import ErrorBoundary from './components/ErrorBoundary';

// Screens
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

const navigationRef = createNavigationContainerRef();
const Stack = createNativeStackNavigator();

const EXPO_PUBLIC_API_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  Constants.expoConfig?.extra?.apiUrl ||
  'https://hlala.raisdaglobal.co.zw'
).replace(/\/$/, '');

const API_BASE = `${EXPO_PUBLIC_API_URL}/api`;

function mapUser(user) {
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

function AppContent() {
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [isAuthLoading, setAuthLoading] = useState(true);
  const isMountedRef = useRef(true);
  const { dark: isDark, t: theme } = useTheme();

  const loadUserProfile = useCallback(async (userId) => {
    try {
      const token = await AsyncStorage.getItem('hlala_link_token');
      const response = await fetch(`${API_BASE}/profiles/me`, {
        method: 'GET',
        headers: {
          Authorization: token ? `Bearer ${token}` : '',
        },
      });
      const data = await response.json();
      if (data.success && data.user) {
        if (isMountedRef.current) {
          setUserProfile(data.user);
        }
        console.log('[App] Profile loaded:', data.user.full_name || data.user.email);
      } else {
        console.log('[App] Profile load failed:', data?.message);
        if (isMountedRef.current) {
          setUserProfile(null);
        }
      }
    } catch (error) {
      console.log('[App] Profile load error:', error.message);
      if (isMountedRef.current) {
        setUserProfile(null);
      }
    }
  }, []);

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

  // Warm API — generous timeout: a cold cPanel backend can take 10s+ on
  // first hit. An abort here is quiet (the request still warms the server);
  // only real failures are logged.
  useEffect(() => {
    async function warmAPI() {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const fetchUrl = `${API_BASE}/properties?limit=1`;
        const response = await fetch(fetchUrl, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const data = await response.json();
          console.log('[App] API warm-up: OK, properties count:', data.properties?.length || 0);
        }
      } catch (e) {
        const msg = String(e?.message || e);
        if (!/abort|cancel/i.test(e?.name || '') && !/abort|cancel/i.test(msg)) {
          console.log('[App] API warm-up failed:', msg);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }
    warmAPI();
  }, []);

  // NetInfo
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected === false) {
        console.log('[App] No internet connection');
      }
    });
    return () => unsubscribe();
  }, []);

  // Session restore
  useEffect(() => {
    async function restoreSession() {
      try {
        const sessionFromClient = await getSessionUser();
        if (!isMountedRef.current) return;
        if (sessionFromClient && sessionFromClient.id) {
          const user = mapUser(sessionFromClient);
          console.log('[App] Restored session from cPanel MySQL API:', user.email || user.id);
          setSession(user);
          loadUserProfile(user.id);
        } else {
          setSession(null);
          setUserProfile(null);
        }
      } catch (err) {
        console.log('[App] Session restore error:', err.message);
        if (isMountedRef.current) {
          setSession(null);
          setUserProfile(null);
        }
      } finally {
        if (isMountedRef.current) {
          setAuthLoading(false);
        }
      }
    }
    restoreSession();
  }, [loadUserProfile]);

  // Auth state change listener
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (!isMountedRef.current) return;
      if (event === 'SIGNED_IN' && s?.user) {
        const user = mapUser(s.user);
        console.log('[App] Auth SIGNED_IN:', user.email);
        setSession(user);
        setUserProfile(user);
        loadUserProfile(user.id);
        registerForPushNotificationsAsync(user.id).catch(() => {});
      } else if (event === 'SIGNED_OUT') {
        if (consumeExplicitSignOut()) {
          console.log('[App] explicit sign-out, ending session immediately');
          setSession(null);
          setUserProfile(null);
          emitLogout(false);
          return;
        }
        setSession(null);
        setUserProfile(null);
        console.log('[App] auth SIGNED_OUT');
        emitLogout(false);
      }
    });

    return () => {
      isMountedRef.current = false;
      data?.subscription?.unsubscribe?.();
      emitLogout(false);
    };
  }, [loadUserProfile]);

  // AppState listener
  useEffect(() => {
    const handleAppState = (nextState) => {
      if (nextState === 'active' && session?.id && !isAuthLoading) {
        loadUserProfile(session.id);
      }
    };
    const subscription = AppState.addEventListener('change', handleAppState);
    return () => subscription.remove();
  }, [session, isAuthLoading, loadUserProfile]);

  // Ensure profile loaded when session is present
  useEffect(() => {
    if (session?.id && !userProfile) {
      loadUserProfile(session.id);
    }
  }, [session, userProfile, loadUserProfile]);

  // While the session restores (a fast local read), render nothing instead
  // of a branded loader — the navigator mounts the moment auth resolves.
  if (isAuthLoading) {
    return null;
  }

  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...baseTheme,
    dark: isDark,
    colors: {
      ...baseTheme.colors,
      primary: '#111111',
      background: theme.bg,
      card: theme.card,
      text: theme.text,
      border: theme.hairline,
      notification: '#FF3B30',
    },
    fonts: {
      ...baseTheme.fonts,
      regular: { fontFamily: 'Poppins_400Regular', fontWeight: '400' },
      medium: { fontFamily: 'Poppins_500Medium', fontWeight: '500' },
      bold: { fontFamily: 'Poppins_700Bold', fontWeight: '700' },
      heavy: { fontFamily: 'Poppins_900Black', fontWeight: '900' },
    },
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
    >
      <View style={styles.container}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: theme.bg },
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
              <Stack.Screen name="PublicProfile" component={PublicProfileScreen} />
              <Stack.Screen name="EditProfile" component={EditProfileScreen} />
              <Stack.Screen name="Generic" component={GenericScreen} />
              <Stack.Screen name="ChatRoom" component={ChatRoomScreen} />
              <Stack.Screen name="AddListing" component={AddListingScreen} />
              <Stack.Screen name="AgentHome" component={AgentHomeScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="Support" component={SupportScreen} />
              <Stack.Screen
                name="Payment"
                component={PaymentScreen}
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen name="UserList" component={UserListScreen} />
              <Stack.Screen name="PaynowWebView" component={PaynowWebViewScreen} />
              {/* Movers */}
              <Stack.Screen name="MoversList" component={MoversListScreen} />
              <Stack.Screen
                name="MoverDetail"
                component={MoverDetailScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="BookMover"
                component={BookMoverScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="MyMoverBookings"
                component={MyMoverBookingsScreen}
                options={{ animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="MoverReview"
                component={MoverReviewScreen}
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
            </>
          ) : (
            <>
              <Stack.Screen name="Auth" component={AuthScreen} />
              <Stack.Screen name="PublicProfile" component={PublicProfileScreen} />
            </>
          )}
        </Stack.Navigator>
      </View>
    </NavigationContainer>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_900Black,
  });

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <ThemeProvider>
            <AppContent />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
});