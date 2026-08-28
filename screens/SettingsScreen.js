import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, Switch, Alert, Modal, FlatList, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import * as Notifications from 'expo-notifications';

const IOS_BLUE = '#007AFF';
const IOS_GRAY = '#8E8E93';
const IOS_BG   = '#F2F2F7';

const LANGUAGES = [
  { id: 'en', name: 'English' },
  { id: 'sn', name: 'Shona' },
  { id: 'nd', name: 'Ndebele' },
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
      Alert.alert('Success', 'Push notifications enabled.');
    } else {
      setPushEnabled(false);
    }
  };

  const SettingItem = ({ icon, iconBg, title, isSwitch, value, onValueChange, isDestructive, onPress, subTitle, isLast }) => (
    <TouchableOpacity 
      style={[styles.settingItem, !isLast && styles.settingItemBorder]} 
      onPress={onPress} 
      activeOpacity={onPress ? 0.7 : 1}
      disabled={isSwitch}
    >
      <View style={[styles.settingIconBox, { backgroundColor: iconBg || (isDestructive ? '#FF3B30' : IOS_BLUE) }]}>
        <Ionicons name={icon} size={17} color="#FFFFFF" />
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
        <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
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
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={IOS_BLUE} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 32 }} />
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
                  <Text style={styles.modalItemText}>{item.name}</Text>
                  {language.id === item.id && <Ionicons name="checkmark" size={20} color={IOS_BLUE} />}
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setLangModalVisible(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
        <View style={styles.card}>
          <SettingItem 
            icon="notifications" 
            iconBg="#FF3B30"
            title="Push Notifications" 
            isSwitch 
            value={pushEnabled} 
            onValueChange={handlePushToggle} 
            isLast
          />
        </View>

        <Text style={styles.sectionHeader}>PREFERENCES</Text>
        <View style={styles.card}>
          <SettingItem 
            icon="location" 
            iconBg="#34C759"
            title="Location Services" 
            isSwitch 
            value={locationEnabled} 
            onValueChange={setLocationEnabled} 
          />
          <SettingItem 
            icon="globe" 
            iconBg="#007AFF"
            title="Language" 
            subTitle={language.name}
            onPress={() => setLangModalVisible(true)} 
            isLast
          />
        </View>

        <Text style={styles.sectionHeader}>LEGAL & ABOUT</Text>
        <View style={styles.card}>
          <SettingItem 
            icon="document-text" 
            iconBg="#5856D6"
            title="Terms of Service" 
            onPress={() => navigation.navigate('Generic', { 
              title: 'Terms of Service', 
              icon: 'document-text',
              message: `Hlala Link Marketplace Terms\n\nCopyright (c) 2024 Hlala Link\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this platform and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.` 
            })} 
          />
          <SettingItem 
            icon="shield-checkmark" 
            iconBg="#34C759"
            title="Privacy Policy" 
            onPress={() => navigation.navigate('Generic', { 
              title: 'Privacy Policy', 
              icon: 'shield-checkmark',
              message: 'Your privacy is our priority. We use industry-standard encryption to protect your data. We never sell your personal information to third parties.' 
            })} 
          />
          <SettingItem 
            icon="information-circle" 
            iconBg="#007AFF"
            title="About Hlala Link" 
            onPress={() => navigation.navigate('Generic', { 
              title: 'About Hlala Link', 
              icon: 'information-circle',
              message: 'Hlala Link is Zimbabwe’s leading property marketplace, designed to connect tenants with verified agents and landlords seamlessly.' 
            })} 
            isLast
          />
        </View>

        <Text style={styles.sectionHeader}>ACCOUNT</Text>
        <View style={styles.card}>
          <SettingItem 
            icon="trash" 
            iconBg="#FF3B30"
            title="Delete Account" 
            isDestructive 
            onPress={handleDeleteAccount} 
            isLast
          />
        </View>
        
        <Text style={styles.versionText}>Hlala Link v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: IOS_BG },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: Platform.OS === 'ios' ? 58 : 42, 
    paddingHorizontal: 16, 
    paddingBottom: 10, 
    backgroundColor: '#FFF', 
    borderBottomWidth: StyleSheet.hairlineWidth, 
    borderBottomColor: '#C6C6C8' 
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  
  scroll: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 60 },
  sectionHeader: { fontSize: 12, fontWeight: '600', color: IOS_GRAY, marginBottom: 6, marginTop: 14, marginLeft: 12, letterSpacing: 0.2 },
  
  card: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 12, 
    overflow: 'hidden', 
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  
  settingItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  settingItemBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA', marginLeft: 46 },
  settingIconBox: { width: 28, height: 28, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  settingTitle: { fontSize: 16, color: '#000000', fontWeight: '400' },
  settingSubTitle: { fontSize: 13, color: IOS_GRAY, marginTop: 1 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 20, color: '#000', textAlign: 'center' },
  modalItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalItemText: { fontSize: 16, color: '#000' },
  modalClose: { marginTop: 20, alignItems: 'center' },
  modalCloseText: { fontSize: 16, fontWeight: '600', color: IOS_BLUE },
  
  versionText: { textAlign: 'center', color: IOS_GRAY, marginTop: 20, marginBottom: 30, fontSize: 12 }
});

