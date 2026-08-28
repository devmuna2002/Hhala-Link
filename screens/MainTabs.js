import React, { useState, useEffect, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, Text, StyleSheet, Animated, TouchableOpacity, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '../supabase';

import HomeScreen from './HomeScreen';
import ExploreScreen from './ExploreScreen';
import AgentHomeScreen from './AgentHomeScreen';
import SavedScreen from './SavedScreen';
import UserListScreen from './UserListScreen';
import ProfileScreen from './ProfileScreen'; 
import NotificationsScreen from './NotificationsScreen';
import MoversListScreen from './MoversListScreen';
const Tab = createBottomTabNavigator();

function BubblyTabButton({ children, onPress, accessibilityState }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const bounceAnim = useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 0.8, friction: 4, tension: 60, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: -6, duration: 80, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      ]),
    ]).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }),
      Animated.sequence([
        Animated.timing(bounceAnim, { toValue: 4, duration: 60, useNativeDriver: true }),
        Animated.timing(bounceAnim, { toValue: 0, duration: 100, useNativeDriver: true }),
      ]),
    ]).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [{ flex: 1, justifyContent: 'center', alignItems: 'center' }]}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }, { translateY: bounceAnim }] }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export default function MainTabs() {
  const [role, setRole] = useState('tenant');
  const [counts, setCounts] = useState({ total: 0, chat: 0, explore: 0, favorite: 0, movers: 0 });

  useEffect(() => {
    let user;
    supabase.auth.getUser().then(({ data }) => {
      user = data.user;
      if (user) {
        supabase.from('profiles').select('role').eq('id', user.id).single()
          .then(({ data }) => {
            if (data) setRole(data.role);
          });
        fetchCounts(user.id);
        setupRealtime(user.id);
      }
    });
  }, []);

  const fetchCounts = async (userId) => {
    // Fetch unread counts
    const { data, error } = await supabase
      .from('notifications')
      .select('type, is_read')
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (error) {
      console.log('Error fetching notification counts:', error.message);
      return;
    }

    if (data) {
      const newCounts = { total: data.length, chat: 0, explore: 0, favorite: 0, movers: 0 };
      data.forEach(n => {
        if (n.type === 'message') newCounts.chat++;
        if (n.type === 'new_listing') newCounts.explore++;
        if (n.type === 'like') newCounts.favorite++;
        if (n.type === 'mover_booking' || n.type === 'booking_update') newCounts.movers++;
      });
      setCounts(newCounts);
    }
  };

  const setupRealtime = (userId) => {
    console.log("DEBUG: Setting up realtime for user:", userId);
    const channel = supabase
      .channel(`notifs_${userId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications', 
        filter: `user_id=eq.${userId}` 
      }, (payload) => {
        console.log("DEBUG: NEW NOTIFICATION RECEIVED:", payload);
        setCounts(prev => ({
          total: prev.total + 1,
          chat: payload.new.type === 'message' ? prev.chat + 1 : prev.chat,
          explore: payload.new.type === 'new_listing' ? prev.explore + 1 : prev.explore,
          favorite: payload.new.type === 'like' ? prev.favorite + 1 : prev.favorite,
          movers: (payload.new.type === 'mover_booking' || payload.new.type === 'booking_update') ? prev.movers + 1 : prev.movers,
        }));
      })
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'notifications', 
        filter: `user_id=eq.${userId}` 
      }, (payload) => {
        console.log("DEBUG: NOTIFICATION UPDATED (READ):", payload);
        fetchCounts(userId);
      })
      .subscribe((status) => {
        console.log("DEBUG: NOTIFICATION SUB STATUS:", status);
      });
    
    return () => supabase.removeChannel(channel);
  };

  const TabBadge = ({ count }) => {
    if (!count || count <= 0) return null;
    return (
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
      </View>
    );
  };

  const markTypeAsRead = async (type) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('type', type)
      .eq('is_read', false);
    
    fetchCounts(user.id);
  };

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: '#0A84FF',
        tabBarInactiveTintColor: '#8E8E93',
        tabBarLabelStyle: {
          fontFamily: 'Poppins_500Medium',
          fontSize: 10.5,
          marginTop: 2,
          marginBottom: Platform.OS === 'ios' ? 0 : 2,
        },
        tabBarStyle: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: Platform.OS === 'ios' ? 88 : 68,
          backgroundColor: '#FAF8FF',
          borderTopWidth: 0,
          elevation: 15,
          shadowColor: '#0A84FF',
          shadowOpacity: 0.12,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -4 },
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 8,
        },
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center',
          paddingVertical: 2,
        },
        tabBarIcon: ({ focused, color }) => {
          let iconName;
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Explore') iconName = focused ? 'compass' : 'compass-outline';
          else if (route.name === 'Favorite') iconName = focused ? 'heart' : 'heart-outline';
          else if (route.name === 'Movers') iconName = focused ? 'cube' : 'cube-outline';

          let badgeCount = 0;
          if (route.name === 'Explore') badgeCount = counts.explore;
          if (route.name === 'Favorite') badgeCount = counts.favorite;
          if (route.name === 'Movers') badgeCount = counts.movers;

          return (
            <View style={styles.iconWrapper}>
              <Ionicons name={iconName} size={32} color={color} />
              <TabBadge count={badgeCount} />
            </View>
          );
        },
        tabBarButton: (props) => <BubblyTabButton {...props} />,
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tab.Screen 
        name="Explore" 
        component={ExploreScreen} 
        options={{ tabBarLabel: 'Explore' }}
        listeners={{ tabPress: () => markTypeAsRead('new_listing') }}
      />
      <Tab.Screen 
        name="Favorite" 
        component={SavedScreen} 
        options={{ tabBarLabel: 'Saved' }}
        listeners={{ tabPress: () => markTypeAsRead('like') }}
      />
      <Tab.Screen 
        name="Movers" 
        component={MoversListScreen} 
        options={{ tabBarLabel: 'Movers' }}
        listeners={{ tabPress: () => markTypeAsRead('mover_booking') }}
      />
    </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 30,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: "#0A84FF",
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontFamily: 'Poppins_700Bold',
    textAlign: 'center',
  },
});
