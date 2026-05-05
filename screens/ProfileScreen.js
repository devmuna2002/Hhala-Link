import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, Image, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const loadProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    if (user) {
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setProfile(data);
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

  const menuItems = [
    { icon: 'person-outline', title: 'Edit Profile', route: 'EditProfile' },
    { icon: 'home-outline', title: 'My Properties', route: 'AgentHome' },
    { icon: 'wallet-outline', title: 'Payments', route: 'Generic', params: { title: 'Payments', message: 'No recent transaction history.', icon: 'wallet-outline' } },
    { icon: 'settings-outline', title: 'Settings', route: 'Settings' },
    { icon: 'help-circle-outline', title: 'Help & Support', route: 'Support' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Ionicons name="person" size={40} color="#0A84FF" />
            )}
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.name}>{profile ? `${profile.first_name} ${profile.last_name}` : 'Hlala Link User'}</Text>
            <Text style={styles.email}>{user ? user.email : 'Loading...'}</Text>
          </View>
          <TouchableOpacity style={styles.editBtn} onPress={() => navigation.navigate('EditProfile')}>
            <Ionicons name="pencil" size={16} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* Menu Items */}
        <View style={styles.menuContainer}>
          {menuItems.map((item, idx) => (
            <TouchableOpacity 
              key={idx} 
              style={styles.menuItem} 
              onPress={() => navigation.navigate(item.route, item.params)}
            >
              <View style={styles.menuIconBox}>
                <Ionicons name={item.icon} size={20} color="#0A84FF" />
              </View>
              <Text style={styles.menuText}>{item.title}</Text>
              <Ionicons name="chevron-forward" size={20} color="#D1D1D6" />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={20} color="#FF3B30" />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { paddingTop: Platform.OS === 'ios' ? 100 : 70, paddingHorizontal: 20, paddingBottom: 15 },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24, color: '#000' },
  
  scroll: { paddingHorizontal: 20, paddingBottom: 120 },
  
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0F5FF', padding: 20, borderRadius: 24, marginBottom: 30 },
  avatarContainer: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, elevation: 2, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 32 },
  profileInfo: { flex: 1, marginLeft: 16 },
  name: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000' },
  email: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', marginTop: 2 },
  editBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#0A84FF', justifyContent: 'center', alignItems: 'center' },

  menuContainer: { marginBottom: 30 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  menuIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  menuText: { flex: 1, fontFamily: 'Poppins_500Medium', fontSize: 16, color: '#000' },

  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 16, backgroundColor: '#FFF5F5' },
  logoutText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FF3B30', marginLeft: 8 },
});
