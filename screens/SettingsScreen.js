import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, Switch, Alert, Modal, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import * as Notifications from 'expo-notifications';

const LANGUAGES = [
  { id: 'en', name: 'English', flag: '🇬🇧' },
  { id: 'sn', name: 'Shona', flag: '🇿🇼' },
  { id: 'nd', name: 'Ndebele', flag: '🇿🇼' },
];

export default function SettingsScreen({ navigation }) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [langModalVisible, setLangModalVisible] = useState(false);

  useEffect(() => {
    checkNotificationStatus();
  }, []);

  const checkNotificationStatus = async () => {
    const { status } = await Notifications.getPermissionsAsync();
    setPushEnabled(status === 'granted');
  };

  const handlePushToggle = async (value) => {
    if (value) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        Alert.alert('Permission Required', 'Please enable notifications in your phone settings to receive updates.');
        setPushEnabled(false);
        return;
      }
      
      setPushEnabled(true);
      Alert.alert('Success', 'Push notifications enabled!');
    } else {
      setPushEnabled(false);
    }
  };

  const SettingItem = ({ icon, title, isSwitch, value, onValueChange, isDestructive, onPress, subTitle }) => (
    <TouchableOpacity 
      style={styles.settingItem} 
      onPress={onPress} 
      activeOpacity={onPress ? 0.7 : 1}
      disabled={isSwitch}
    >
      <View style={styles.settingIconBox}>
        <Ionicons name={icon} size={20} color={isDestructive ? '#FF3B30' : '#0A84FF'} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.settingTitle, isDestructive && { color: '#FF3B30' }]}>{title}</Text>
        {subTitle && <Text style={styles.settingSubTitle}>{subTitle}</Text>}
      </View>
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
    </TouchableOpacity>
  );

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This action is permanent and will delete all your data. Are you sure you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              await supabase.from('profiles').delete().eq('id', user.id);
              await supabase.auth.signOut();
            }
          } 
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <Modal visible={langModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Select Language</Text>
            <FlatList
              data={LANGUAGES}
              keyExtractor={item => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.modalItem} 
                  onPress={() => { setLanguage(item); setLangModalVisible(false); }}
                >
                  <Text style={styles.modalItemText}>{item.flag} {item.name}</Text>
                  {language.id === item.id && <Ionicons name="checkmark" size={20} color="#0A84FF" />}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setLangModalVisible(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.card}>
          <SettingItem 
            icon="notifications-outline" 
            title="Push Notifications" 
            isSwitch 
            value={pushEnabled} 
            onValueChange={handlePushToggle} 
          />
        </View>

        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.card}>
          <SettingItem icon="location-outline" title="Location Services" isSwitch value={locationEnabled} onValueChange={setLocationEnabled} />
          <View style={styles.divider} />
          <SettingItem 
            icon="language-outline" 
            title="Language" 
            subTitle={language.name}
            onPress={() => setLangModalVisible(true)} 
          />
        </View>

        <Text style={styles.sectionTitle}>Legal & About</Text>
        <View style={styles.card}>
          <SettingItem 
            icon="document-text-outline" 
            title="Terms of Service" 
            onPress={() => navigation.navigate('Generic', { 
              title: 'Terms of Service', 
              icon: 'document-text',
              message: `Hlala Link Marketplace Terms\n\nCopyright (c) 2024 Hlala Link\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this platform and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.` 
            })} 
          />
          <View style={styles.divider} />
          <SettingItem 
            icon="shield-checkmark-outline" 
            title="Privacy Policy" 
            onPress={() => navigation.navigate('Generic', { 
              title: 'Privacy Policy', 
              icon: 'shield-checkmark',
              message: 'Your privacy is our priority. We use industry-standard encryption to protect your data. We never sell your personal information to third parties. For a full detailed policy, visit hlalalink.com/privacy.' 
            })} 
          />
          <View style={styles.divider} />
          <SettingItem 
            icon="information-circle-outline" 
            title="About Hlala Link" 
            onPress={() => navigation.navigate('Generic', { 
              title: 'About Hlala Link', 
              icon: 'information-circle',
              message: 'Hlala Link is Zimbabwe’s leading property marketplace, designed to connect tenants with verified agents and landlords seamlessly. Our mission is to make finding a home as easy as a single tap. Join thousands of happy users today.' 
            })} 
          />
        </View>

        <Text style={styles.sectionTitle}>Danger Zone</Text>
        <View style={styles.card}>
          <SettingItem 
            icon="trash-outline" 
            title="Delete Account" 
            isDestructive 
            onPress={handleDeleteAccount} 
          />
        </View>
        
        <Text style={styles.versionText}>Hlala Link v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: Platform.OS === 'ios' ? 60 : 40, 
    paddingHorizontal: 20, 
    paddingBottom: 20, 
    backgroundColor: '#FFF', 
    borderBottomWidth: 1, 
    borderBottomColor: '#F2F2F7' 
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F8F9FE', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#000' },
  
  scroll: { padding: 20 },
  sectionTitle: { fontFamily: 'Poppins_700Bold', fontSize: 13, color: '#A1A1A1', textTransform: 'uppercase', marginBottom: 12, marginTop: 15, marginLeft: 4, letterSpacing: 1 },
  
  card: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 20, 
    overflow: 'hidden', 
    marginBottom: 25, 
    borderWidth: 1, 
    borderColor: '#F2F2F7'
  },
  
  settingItem: { flexDirection: 'row', alignItems: 'center', padding: 18 },
  settingIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  settingTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#1C1C1E' },
  settingSubTitle: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', marginTop: 1 },
  divider: { height: 1, backgroundColor: '#F2F2F7', marginLeft: 72 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#FFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24, paddingBottom: 45 },
  modalTitle: { fontFamily: 'Poppins_700Bold', fontSize: 22, marginBottom: 24, color: '#000', textAlign: 'center' },
  modalItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: '#F2F2F7' },
  modalItemText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#1C1C1E' },
  modalClose: { marginTop: 25, alignItems: 'center' },
  modalCloseText: { fontFamily: 'Poppins_700Bold', fontSize: 16, color: '#0A84FF' },
  
  versionText: { textAlign: 'center', fontFamily: 'Poppins_500Medium', color: '#D1D1D6', marginTop: 10, marginBottom: 50, fontSize: 12 }
});
