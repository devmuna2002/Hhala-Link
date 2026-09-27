import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Modal,
  FlatList,
  StatusBar,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { supabase, getSessionUser } from '../supabase';
import { signOutAndClear } from '../utils/auth';

const LANGUAGES = [
  { id: 'en', name: 'English', sub: 'Default' },
  { id: 'sn', name: 'Shona', sub: 'ChiShona' },
  { id: 'nd', name: 'Ndebele', sub: 'isiNdebele' },
];

export default function SettingsScreen({ navigation }) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    checkNotificationStatus();
  }, []);

  const checkNotificationStatus = async () => {
    try {
      const { status } = await Notifications.getPermissionsAsync();
      setPushEnabled(status === 'granted');
    } catch {}
  };

  const handlePushToggle = async (value) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    if (value) {
      try {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') {
          Alert.alert('Permission Required', 'Please enable notifications in your device settings to receive real-time updates.');
          setPushEnabled(false);
          return;
        }

        setPushEnabled(true);
      } catch (e) {
        setPushEnabled(false);
      }
    } else {
      setPushEnabled(false);
    }
  };

  const handleDeleteAccount = () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    Alert.alert(
      'Delete Account',
      'This action is permanent and will completely delete your account profile, listings, and messages. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            try {
              const user = await getSessionUser();
              if (user) {
                await supabase.from('profiles').delete().eq('id', user.id);
                await signOutAndClear();
              }
            } catch (err) {
              Alert.alert('Error', 'Failed to delete account. Please try again or contact support.');
            }
          },
        },
      ]
    );
  };

  const matchesSearch = (text) => {
    if (!searchQuery.trim()) return true;
    return text.toLowerCase().includes(searchQuery.trim().toLowerCase());
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Standard app header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings & Privacy</Text>
        <View style={{ width: 32 }} />
      </View>

      {/* Language Selection Modal with Bullet Selection Method */}
      <Modal visible={langModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Language</Text>
              <TouchableOpacity onPress={() => setLangModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={LANGUAGES}
              keyExtractor={item => item.id}
              renderItem={({ item }) => {
                const isSelected = language.id === item.id;
                return (
                  <TouchableOpacity
                    style={styles.langItem}
                    onPress={() => {
                      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                      setLanguage(item);
                      setLangModalVisible(false);
                    }}
                    activeOpacity={0.7}
                  >
                    {/* Bullet Selection indicator */}
                    <View style={[styles.bulletOuter, isSelected && styles.bulletOuterActive]}>
                      {isSelected && <View style={styles.bulletInner} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.langItemText, isSelected && styles.langItemTextActive]}>
                        {item.name}
                      </Text>
                      <Text style={styles.langItemSub}>{item.sub}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Facebook Search Settings Input */}
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#8A8A8A" style={{ marginRight: 8 }} />
          <TextInput
            placeholder="Search settings"
            placeholderTextColor="#8E8E93"
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchInput}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={20} color="#8A8A8A" />
            </TouchableOpacity>
          )}
        </View>

        {/* ─── Group 1: Preferences ─── */}
        {(matchesSearch('notifications') || matchesSearch('location') || matchesSearch('language')) && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Preferences</Text>
            <View style={styles.card}>
              {matchesSearch('notifications') && (
                <View style={styles.settingRow}>
                  <View style={styles.settingIconBox}>
                    <Ionicons name="notifications" size={24} color="#0A84FF" />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Push Notifications</Text>
                    <Text style={styles.settingDesc}>Instant alerts for inquiries, visits & quotes</Text>
                  </View>
                  <Switch
                    value={pushEnabled}
                    onValueChange={handlePushToggle}
                    trackColor={{ false: '#E5E5EA', true: '#0A84FF' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              )}

              {matchesSearch('location') && (
                <View style={[styles.settingRow, styles.rowBorder]}>
                  <View style={styles.settingIconBox}>
                    <Ionicons name="location" size={24} color="#0A84FF" />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Location Services</Text>
                    <Text style={styles.settingDesc}>Auto-detect nearby properties & movers</Text>
                  </View>
                  <Switch
                    value={locationEnabled}
                    onValueChange={(val) => {
                      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                      setLocationEnabled(val);
                    }}
                    trackColor={{ false: '#E5E5EA', true: '#0A84FF' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              )}

              {matchesSearch('language') && (
                <TouchableOpacity
                  style={[styles.settingRow, styles.rowBorder]}
                  onPress={() => setLangModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <View style={styles.settingIconBox}>
                    <Ionicons name="globe" size={24} color="#0A84FF" />
                  </View>
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Language</Text>
                    <Text style={styles.settingDesc}>{language.name} ({language.sub})</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* ─── Group 2: Account & Security ─── */}
        {(matchesSearch('profile') || matchesSearch('security') || matchesSearch('account')) && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Account & Security</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => navigation.navigate('EditProfile')}
                activeOpacity={0.7}
              >
                <View style={styles.settingIconBox}>
                  <Ionicons name="person-circle" size={24} color="#0A84FF" />
                </View>
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>Personal Information</Text>
                  <Text style={styles.settingDesc}>Update full name, phone number, vehicle & avatar</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ─── Group 3: Legal & Policies ─── */}
        {(matchesSearch('terms') || matchesSearch('privacy') || matchesSearch('about') || matchesSearch('legal')) && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Legal & Policies</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => navigation.navigate('Generic', {
                  title: 'Terms of Service',
                  icon: 'document-text',
                  message: 'Hlala Link Marketplace Terms\n\nCopyright (c) 2026 Hlala Link. All rights reserved.\n\nBy accessing or using Hlala Link, you agree to comply with our community safety and marketplace policies.',
                })}
                activeOpacity={0.7}
              >
                <View style={styles.settingIconBox}>
                  <Ionicons name="document-text" size={24} color="#0A84FF" />
                </View>
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>Terms of Service</Text>
                  <Text style={styles.settingDesc}>Rules and agreements for using Hlala Link</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.settingRow, styles.rowBorder]}
                onPress={() => navigation.navigate('Generic', {
                  title: 'Privacy Policy',
                  icon: 'shield-checkmark',
                  message: 'Your privacy is our highest priority. We use industry-standard encryption to protect your data. We never sell your personal information to third parties.',
                })}
                activeOpacity={0.7}
              >
                <View style={styles.settingIconBox}>
                  <Ionicons name="shield-checkmark" size={24} color="#0A84FF" />
                </View>
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>Privacy Policy</Text>
                  <Text style={styles.settingDesc}>How we safeguard and protect your data</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.settingRow, styles.rowBorder]}
                onPress={() => navigation.navigate('Generic', {
                  title: 'About Hlala Link',
                  icon: 'information-circle',
                  message: 'Hlala Link is Zimbabwe’s premier smart real estate platform connecting tenants with verified agents, landlords, and professional movers.',
                })}
                activeOpacity={0.7}
              >
                <View style={styles.settingIconBox}>
                  <Ionicons name="information-circle" size={24} color="#0A84FF" />
                </View>
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>About Hlala Link</Text>
                  <Text style={styles.settingDesc}>Version 1.1.0 · Built with modern standards</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ─── Group 4: Account Actions / Danger Zone ─── */}
        {(matchesSearch('delete') || matchesSearch('account')) && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Account Actions</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={handleDeleteAccount}
                activeOpacity={0.7}
              >
                <View style={styles.settingIconBox}>
                  <Ionicons name="trash" size={24} color="#FF3B30" />
                </View>
                <View style={styles.settingContent}>
                  <Text style={[styles.settingTitle, { color: '#FF3B30' }]}>Delete Account</Text>
                  <Text style={styles.settingDesc}>Permanently remove your account and all listings</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.footerWrap}>
          <Text style={styles.footerVersion}>Hlala Link for Android & iOS</Text>
          <Text style={styles.footerMeta}>v1.1.0 (Build 2026)</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8F9FE',
  },

  // Header — standard app header: bare back chevron + centered title
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: '#000',
  },

  scroll: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 60,
    gap: 14,
  },

  // Search Settings Bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 14,
    height: 42,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#000',
  },

  // Section
  sectionWrap: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Poppins_600SemiBold',
    color: '#8E8E93',
    letterSpacing: 0.5,
    marginLeft: 6,
  },

  // Card — standard soft-shadow card (Support pattern)
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F0F0F0',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  // Setting Row
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F5F5F5',
  },
  settingIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F5FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  settingContent: {
    flex: 1,
    marginRight: 10,
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: 'Poppins_600SemiBold',
    color: '#000',
    marginBottom: 2,
  },
  settingDesc: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#8E8E93',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  modalContainer: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: '#000',
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F0F5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F5F5F5',
  },
  bulletOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#E5E5EA',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  bulletOuterActive: {
    borderColor: '#0A84FF',
  },
  bulletInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0A84FF',
  },
  langItemText: {
    fontSize: 15,
    fontFamily: 'Poppins_500Medium',
    color: '#000',
  },
  langItemTextActive: {
    fontFamily: 'Poppins_700Bold',
    color: '#0A84FF',
  },
  langItemSub: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: '#8E8E93',
  },

  // Footer
  footerWrap: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  footerVersion: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: '#8E8E93',
  },
  footerMeta: {
    fontSize: 11,
    fontFamily: 'Poppins_400Regular',
    color: '#C7C7CC',
    marginTop: 2,
  },
});
