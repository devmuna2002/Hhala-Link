import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, Image, ScrollView, TouchableOpacity, StatusBar } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

const IOS_BLUE = '#007AFF';
const IOS_GRAY = '#8E8E93';
const IOS_BG   = '#F2F2F7';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      if (user) {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if (error) throw error;
        if (data) {
          setProfile(data);
          await AsyncStorage.setItem(`cached_user_profile_${user.id}`, JSON.stringify(data));
        }
      }
    } catch (e) {
      console.log('Profile fetch error, loading from cache:', e);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const cachedProfile = await AsyncStorage.getItem(`cached_user_profile_${user.id}`);
          if (cachedProfile) {
            setProfile(JSON.parse(cachedProfile));
          }
        }
      } catch (_) {}
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadProfile();
    }, [])
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'User';
  const initials = fullName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'U';

  const menuSections = [
    {
      items: [
        { icon: 'person-outline', title: 'Edit Profile', route: 'EditProfile', iconBg: '#007AFF' },
        ...(profile?.role !== 'tenant' && profile?.role !== 'mover' ? [
          { icon: 'home-outline', title: 'My Properties', route: 'AgentHome', iconBg: '#34C759' }
        ] : []),
        { icon: 'bookmark-outline', title: 'Saved Searches', route: 'SavedSearches', iconBg: '#5856D6' },
      ]
    },
    {
      items: [
        { icon: 'settings-outline', title: 'Settings', route: 'Settings', iconBg: '#8E8E93' },
        { icon: 'help-circle-outline', title: 'Help & Support', route: 'Support', iconBg: '#FF9500' },
      ]
    }
  ];

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={styles.header}>
        {navigation.canGoBack() && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={IOS_BLUE} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Apple ID-like Profile Card */}
        <TouchableOpacity 
          style={styles.profileCard}
          onPress={() => navigation.navigate('EditProfile')}
          activeOpacity={0.8}
        >
          <View style={styles.avatarContainer}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitials}>{initials}</Text>
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.name}>{fullName || 'Hlala Link User'}</Text>
            <Text style={styles.email}>{user ? user.email : 'Loading…'}</Text>
            <Text style={styles.roleTag}>
              {profile?.role ? profile.role.toUpperCase() : 'TENANT'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
        </TouchableOpacity>

        {/* Grouped Table Sections */}
        {menuSections.map((section, sIdx) => (
          <View key={sIdx} style={styles.sectionCard}>
            {section.items.map((item, idx) => (
              <TouchableOpacity 
                key={idx} 
                style={[
                  styles.menuItem,
                  idx < section.items.length - 1 && styles.menuItemBorder
                ]} 
                onPress={() => navigation.navigate(item.route)}
                activeOpacity={0.7}
              >
                <View style={[styles.menuIconBox, { backgroundColor: item.iconBg }]}>
                  <Ionicons name={item.icon} size={18} color="#FFFFFF" />
                </View>
                <Text style={styles.menuText}>{item.title}</Text>
                <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
              </TouchableOpacity>
            ))}
          </View>
        ))}

        {/* Logout Section */}
        <View style={styles.sectionCard}>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={18} color="#FF3B30" />
            <Text style={styles.logoutText}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: IOS_BG },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingTop: Platform.OS === 'ios' ? 58 : 42, 
    paddingHorizontal: 16, 
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  backBtn: { marginRight: 8, padding: 4 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#000000', letterSpacing: -0.5 },
  
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 120, gap: 16 },
  
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#007AFF',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitials: { color: '#FFFFFF', fontSize: 22, fontWeight: '700' },
  profileInfo: { flex: 1, marginLeft: 14 },
  name: { fontSize: 17, fontWeight: '600', color: '#000000' },
  email: { fontSize: 13, color: IOS_GRAY, marginTop: 1 },
  roleTag: {
    alignSelf: 'flex-start',
    backgroundColor: '#EAF3FF',
    color: '#007AFF',
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 4,
    overflow: 'hidden',
  },

  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  menuItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
    marginLeft: 48,
  },
  menuIconBox: {
    width: 30,
    height: 30,
    borderRadius: 7,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  menuText: { flex: 1, fontSize: 16, color: '#000000', fontWeight: '400' },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#FF3B30' },
});

