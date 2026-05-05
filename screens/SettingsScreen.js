import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function SettingsScreen({ navigation }) {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(true);

  const SettingItem = ({ icon, title, isSwitch, value, onValueChange, isDestructive }) => (
    <View style={styles.settingItem}>
      <View style={styles.settingIconBox}>
        <Ionicons name={icon} size={20} color={isDestructive ? '#FF3B30' : '#0A84FF'} />
      </View>
      <Text style={[styles.settingTitle, isDestructive && { color: '#FF3B30' }]}>{title}</Text>
      {isSwitch ? (
        <Switch 
          value={value} 
          onValueChange={onValueChange} 
          trackColor={{ false: '#E5E5EA', true: '#34C759' }}
          thumbColor="#FFF"
        />
      ) : (
        <Ionicons name="chevron-forward" size={20} color="#D1D1D6" />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.card}>
          <SettingItem icon="notifications-outline" title="Push Notifications" isSwitch value={pushEnabled} onValueChange={setPushEnabled} />
          <View style={styles.divider} />
          <SettingItem icon="mail-outline" title="Email Updates" isSwitch value={emailEnabled} onValueChange={setEmailEnabled} />
        </View>

        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.card}>
          <SettingItem icon="moon-outline" title="Dark Mode" isSwitch value={darkMode} onValueChange={setDarkMode} />
          <View style={styles.divider} />
          <SettingItem icon="location-outline" title="Location Services" isSwitch value={locationEnabled} onValueChange={setLocationEnabled} />
          <View style={styles.divider} />
          <SettingItem icon="language-outline" title="Language" />
        </View>

        <Text style={styles.sectionTitle}>Legal & About</Text>
        <View style={styles.card}>
          <SettingItem icon="document-text-outline" title="Terms of Service" />
          <View style={styles.divider} />
          <SettingItem icon="shield-checkmark-outline" title="Privacy Policy" />
          <View style={styles.divider} />
          <SettingItem icon="information-circle-outline" title="About Hlala Link" />
        </View>

        <Text style={styles.sectionTitle}>Danger Zone</Text>
        <View style={styles.card}>
          <SettingItem icon="trash-outline" title="Delete Account" isDestructive />
        </View>
        
        <Text style={styles.versionText}>Hlala Link v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FE' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 20, paddingBottom: 15, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000' },
  
  scroll: { padding: 20 },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#8E8E93', textTransform: 'uppercase', marginBottom: 10, marginTop: 10, marginLeft: 5 },
  
  card: { backgroundColor: '#FFF', borderRadius: 16, overflow: 'hidden', marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  
  settingItem: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  settingIconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  settingTitle: { flex: 1, fontFamily: 'Poppins_500Medium', fontSize: 16, color: '#1A1A1A' },
  divider: { height: 1, backgroundColor: '#F5F5F5', marginLeft: 65 },
  
  versionText: { textAlign: 'center', fontFamily: 'Poppins_400Regular', color: '#8E8E93', marginTop: 20, marginBottom: 40 }
});
