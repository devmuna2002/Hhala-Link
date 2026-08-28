import React, { useState, useEffect, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { supabase } from '../supabase';

import HomeScreen from './HomeScreen';
import ExploreScreen from './ExploreScreen';
import SavedScreen from './SavedScreen';
import ProfileScreen from './ProfileScreen'; 
import MoversListScreen from './MoversListScreen';

const Tab = createBottomTabNavigator();
const IOS_BLUE = '#007AFF';
const IOS_GRAY = '#8E8E93';

function BubblyTabButton({ children, onPress }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, { toValue: 0.92, friction: 5, tension: 80, useNativeDriver: true }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, { toValue: 1, friction: 4, tension: 60, useNativeDriver: true }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
    >
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

export default function MainTabs() {
  const [counts, setCounts] = useState({ total: 0, chat: 0, explore: 0, favorite: 0, movers: 0 });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (user) {
        fetchCounts(user.id);
        setupRealtime(user.id);
      }
    });
  }, []);

  const fetchCounts = async (userId) => {
    const { data, error } = await supabase
      .from('notifications')
      .select('type, is_read')
      .eq('user_id', userId)
      .eq('is_read', false);
    
    if (error) return;

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
    const channel = supabase
      .channel(`notifs_${userId}`)
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'notifications', 
        filter: `user_id=eq.${userId}` 
      }, (payload) => {
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
      }, () => {
        fetchCounts(userId);
      })
      .subscribe();
    
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
          tabBarActiveTintColor: IOS_BLUE,
          tabBarInactiveTintColor: IOS_GRAY,
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '600',
            marginTop: 2,
            marginBottom: Platform.OS === 'ios' ? 0 : 2,
          },
          tabBarStyle: {
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: Platform.OS === 'ios' ? 84 : 64,
            backgroundColor: '#FFFFFF',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: '#C6C6C8',
            elevation: 8,
            shadowColor: '#000',
            shadowOpacity: 0.05,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: -2 },
            paddingBottom: Platform.OS === 'ios' ? 24 : 8,
            paddingTop: 6,
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
                <Ionicons name={iconName} size={25} color={color} />
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
    width: 32,
    height: 28,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -7,
    backgroundColor: '#FF3B30',
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
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
});

