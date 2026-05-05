import React, { useState, useEffect, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, Text, StyleSheet, Animated, TouchableOpacity, Image } from 'react-native';
import { supabase } from '../supabase';

import HomeScreen from './HomeScreen';
import ExploreScreen from './ExploreScreen';
import AgentHomeScreen from './AgentHomeScreen';
import SavedScreen from './SavedScreen';
import UserListScreen from './UserListScreen';
import ProfileScreen from './ProfileScreen'; 
import NotificationsScreen from './NotificationsScreen';
const Tab = createBottomTabNavigator();

export default function MainTabs() {
  const [role, setRole] = useState('tenant');
  const [counts, setCounts] = useState({ total: 0, chat: 0, explore: 0, favorite: 0 });
  const [lastNotif, setLastNotif] = useState(null);
  const popupAnim = useRef(new Animated.Value(-100)).current;

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
      const newCounts = { total: data.length, chat: 0, explore: 0, favorite: 0 };
      data.forEach(n => {
        if (n.type === 'message') newCounts.chat++;
        if (n.type === 'new_listing') newCounts.explore++;
        if (n.type === 'like') newCounts.favorite++;
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
        const newNotif = payload.new;
        setCounts(prev => ({
          total: prev.total + 1,
          chat: newNotif.type === 'message' ? prev.chat + 1 : prev.chat,
          explore: newNotif.type === 'new_listing' ? prev.explore + 1 : prev.explore,
          favorite: newNotif.type === 'like' ? prev.favorite + 1 : prev.favorite,
        }));
        showPopup(newNotif);
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

  const showPopup = (notif) => {
    setLastNotif(notif);
    Animated.sequence([
      Animated.timing(popupAnim, { toValue: 50, duration: 500, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(popupAnim, { toValue: -100, duration: 500, useNativeDriver: true })
    ]).start();
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
      {lastNotif && (
        <Animated.View style={[styles.popupContainer, { transform: [{ translateY: popupAnim }] }]}>
          <View style={styles.popupIcon}>
            <Image source={require('../assets/logo.jpeg')} style={styles.logoIcon} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.popupTitle}>{lastNotif.title || 'Notification'}</Text>
            <Text style={styles.popupBody} numberOfLines={1}>{lastNotif.message}</Text>
          </View>
          <TouchableOpacity onPress={() => Animated.timing(popupAnim, { toValue: -100, duration: 300, useNativeDriver: true }).start()}>
            <Ionicons name="close" size={20} color="#A0A0A0" />
          </TouchableOpacity>
        </Animated.View>
      )}

      <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true, 
        tabBarIcon: ({ focused, color }) => {
          let iconName;
          if (route.name === 'Home') iconName = focused ? 'home' : 'home-outline';
          else if (route.name === 'Explore') iconName = focused ? 'location' : 'location-outline';
          else if (route.name === 'Favorite') iconName = focused ? 'heart' : 'heart-outline';
          else if (route.name === 'Chat') iconName = focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline';
          else if (route.name === 'Profile') iconName = focused ? 'person' : 'person-outline';

          let badgeCount = 0;
          if (route.name === 'Explore') badgeCount = counts.explore;
          if (route.name === 'Favorite') badgeCount = counts.favorite;
          if (route.name === 'Chat') badgeCount = counts.chat;
          // We removed the automatic global clear from Profile tab so it can show total unread
          if (route.name === 'Profile') badgeCount = counts.total;

          return (
            <View style={{
              alignItems: 'center',
              justifyContent: 'center',
              top: Platform.OS === 'ios' ? 8 : 4
            }}>
              <Ionicons name={iconName} size={22} color={color} />
              <TabBadge count={badgeCount} />
            </View>
          );
        },
        tabBarActiveTintColor: '#FFFFFF',
        tabBarInactiveTintColor: 'rgba(255, 255, 255, 0.6)',
        tabBarLabelStyle: {
          fontFamily: 'Poppins_500Medium',
          fontSize: 10,
          marginBottom: 10,
        },
        tabBarStyle: {
          position: 'absolute',
          bottom: 40,
          left: 30,
          right: 30,
          height: 70,
          borderRadius: 35,
          backgroundColor: '#0A84FF',
          borderWidth: 0,
          elevation: 25,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 15,
          shadowOffset: { width: 0, height: 10 },
          paddingBottom: 0,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        },
        tabBarItemStyle: {
          height: 70,
          justifyContent: 'center',
          alignItems: 'center',
        }
      })}
    >
      <Tab.Screen name="Home" component={role === 'agent' ? AgentHomeScreen : HomeScreen} />
      <Tab.Screen 
        name="Explore" 
        component={ExploreScreen} 
        listeners={{ tabPress: () => markTypeAsRead('new_listing') }}
      />
      <Tab.Screen 
        name="Favorite" 
        component={SavedScreen} 
        listeners={{ tabPress: () => markTypeAsRead('like') }}
      />
      <Tab.Screen 
        name="Chat" 
        component={UserListScreen} 
        listeners={{ tabPress: () => markTypeAsRead('message') }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen} 
        // Removed markAllAsRead listener to prevent accidental clearing of badges
      />
    </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    backgroundColor: '#FF3B30',
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#0A84FF', // Matches tab bar color
  },
  badgeText: {
    color: '#FFF',
    fontSize: 8,
    fontFamily: 'Poppins_700Bold',
  },
  popupContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
    zIndex: 9999,
  },
  popupIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F0F7FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  logoIcon: {
    width: '100%',
    height: '100%',
  },
  popupTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#000',
  },
  popupBody: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#8E8E93',
  }
});
