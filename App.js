import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, StatusBar, Animated, Image, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as NativeSplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_900Black } from '@expo-google-fonts/poppins';

import { supabase } from './supabase';
import AuthScreen from './screens/AuthScreen';
import MainTabs from './screens/MainTabs';
import DetailScreen from './screens/DetailScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import EditProfileScreen from './screens/EditProfileScreen';
import GenericScreen from './screens/GenericScreen';
import ChatRoomScreen from './screens/ChatRoomScreen';
import AddListingScreen from './screens/AddListingScreen';
import AgentHomeScreen from './screens/AgentHomeScreen';
import SettingsScreen from './screens/SettingsScreen';
import SupportScreen from './screens/SupportScreen';
import PaymentScreen from './screens/PaymentScreen';
import UserListScreen from './screens/UserListScreen';
import PaynowWebViewScreen from './screens/PaynowWebViewScreen';

// We hide native splash screen immediately to show our custom animated one
NativeSplashScreen.preventAutoHideAsync();

// Configure how notifications are handled when the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const Stack = createNativeStackNavigator();

export default function App() {
  const [session, setSession] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const splashOpacity = useRef(new Animated.Value(1)).current;
  const splashScale = useRef(new Animated.Value(0.9)).current;

  let [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_900Black,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) registerForPushNotificationsAsync(session.user.id);
      setAuthLoaded(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        if (session?.user) registerForPushNotificationsAsync(session.user.id);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function registerForPushNotificationsAsync(userId) {
    if (!Device.isDevice) return;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    try {
      const token = (await Notifications.getExpoPushTokenAsync({
        projectId: Constants.expoConfig.extra.eas.projectId,
      })).data;

      if (token) {
        await supabase
          .from('profiles')
          .update({ push_token: token })
          .eq('id', userId);
      }
    } catch (e) {
      console.log('Error getting push token:', e);
    }
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

  const onLayoutRootView = useCallback(async () => {
    if (fontsLoaded && authLoaded) {
      // Hide the native splash and begin our custom splash animation
      await NativeSplashScreen.hideAsync();
      
      Animated.sequence([
        Animated.parallel([
          Animated.timing(splashScale, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(splashOpacity, { toValue: 1, duration: 500, useNativeDriver: true })
        ]),
        Animated.delay(1500),
        Animated.timing(splashOpacity, { toValue: 0, duration: 500, useNativeDriver: true })
      ]).start(() => {
        setShowSplash(false);
      });
    }
  }, [fontsLoaded, authLoaded]);

  if (!fontsLoaded || !authLoaded) {
    return null; // Wait for core assets
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <NavigationContainer>
        <StatusBar barStyle="dark-content" />
        <Stack.Navigator
          screenOptions={{ headerShown: false, animation: 'fade' }}
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
            </>
          ) : (
            <Stack.Screen name="Auth" component={AuthScreen} />
          )}
        </Stack.Navigator>
      </NavigationContainer>

      {/* Custom Animated Splash Screen Overlay */}
      {showSplash && (
        <Animated.View style={[styles.splashContainer, { opacity: splashOpacity }]}>
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
