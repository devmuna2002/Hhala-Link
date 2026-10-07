import React, { useState, useEffect, useMemo } from 'react';
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
import { NotificationService } from '../services/NotificationService';
import { TERMS_OF_SERVICE, PRIVACY_POLICY, ABOUT_APP } from '../utils/legal';
import { useTheme } from '../utils/theme';
import { signOutAndClear } from '../utils/auth';

const LANGUAGES = [
  { id: 'en', name: 'English', sub: 'Default' },
  { id: 'sn', name: 'Shona', sub: 'ChiShona' },
  { id: 'nd', name: 'Ndebele', sub: 'isiNdebele' },
];

// System fonts — Threads style, matching Profile
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

export default function SettingsScreen({ navigation }) {
  const { t, dark, setDark } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
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
        // Permission alone doesn't deliver pushes — the device token must
        // be (re-)registered now, not on the next cold start.
        try {
          const user = await getSessionUser();
          if (user) {
            const token = await NotificationService.registerForPushNotificationsAsync(user.id);
            if (!token) {
              Alert.alert(
                'Push Not Ready',
                'Permission is on, but this device could not register for pushes (Expo Go builds cannot receive remote pushes — install the APK).'
              );
            }
          }
        } catch (_) {}
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
      <StatusBar barStyle={t.statusBar} backgroundColor={t.bg} />

      {/* Threads header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color={t.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Language Selection Modal with Bullet Selection Method */}
      <Modal visible={langModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Language</Text>
              <TouchableOpacity onPress={() => setLangModalVisible(false)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={24} color={t.text} />
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
        {(matchesSearch('notifications') || matchesSearch('location') || matchesSearch('language') || matchesSearch('dark') || matchesSearch('theme') || matchesSearch('appearance')) && (
          <View style={styles.sectionWrap}>
            <Text style={styles.sectionTitle}>Preferences</Text>
            <View style={styles.group}>
              {(matchesSearch('dark') || matchesSearch('theme') || matchesSearch('appearance')) && (
                <View style={styles.settingRow}>
                  <Ionicons name={dark ? 'moon' : 'sunny'} size={22} color={t.text} style={styles.rowIcon} />
                  <View style={styles.settingContent}>
                    <Text style={styles.settingTitle}>Dark Mode</Text>
                    <Text style={styles.settingDesc}>{dark ? 'On' : 'Off'}</Text>
                  </View>
                  <Switch
                    value={dark}
                    onValueChange={(val) => {
                      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                      setDark(val);
                    }}
                    trackColor={{ false: '#E5E5EA', true: '#0A84FF' }}
                    thumbColor="#FFFFFF"
                  />
                </View>
              )}

              {matchesSearch('notifications') && (
                <View style={styles.settingRow}>
                  <Ionicons name="notifications" size={22} color={t.text} style={styles.rowIcon} />
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
                  <Ionicons name="location" size={22} color={t.text} style={styles.rowIcon} />
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
                  <Ionicons name="globe" size={22} color={t.text} style={styles.rowIcon} />
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
            <View style={styles.group}>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => navigation.navigate('EditProfile')}
                activeOpacity={0.7}
              >
                <Ionicons name="person-circle" size={22} color={t.text} style={styles.rowIcon} />
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
            <View style={styles.group}>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={() => navigation.navigate('Generic', { ...TERMS_OF_SERVICE })}
                activeOpacity={0.7}
              >
                <Ionicons name="document-text" size={22} color={t.text} style={styles.rowIcon} />
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>Terms of Service</Text>
                  <Text style={styles.settingDesc}>Rules and agreements for using Hlala Link</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.settingRow, styles.rowBorder]}
                onPress={() => navigation.navigate('Generic', { ...PRIVACY_POLICY })}
                activeOpacity={0.7}
              >
                <Ionicons name="shield-checkmark" size={22} color={t.text} style={styles.rowIcon} />
                <View style={styles.settingContent}>
                  <Text style={styles.settingTitle}>Privacy Policy</Text>
                  <Text style={styles.settingDesc}>How we safeguard and protect your data</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.settingRow, styles.rowBorder]}
                onPress={() => navigation.navigate('Generic', {
                  ...ABOUT_APP,
                  title: 'About Hlala Link',
                })}
                activeOpacity={0.7}
              >
                <Ionicons name="information-circle" size={22} color={t.text} style={styles.rowIcon} />
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
            <View style={styles.group}>
              <TouchableOpacity
                style={styles.settingRow}
                onPress={handleDeleteAccount}
                activeOpacity={0.7}
              >
                <Ionicons name="trash" size={22} color="#FF3B30" style={styles.rowIcon} />
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

const buildStyles = (t) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.bg,
  },

  // Header — standard app header: bare back chevron + centered title
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: t.card,
    borderBottomWidth: 1,
    borderBottomColor: t.hairline,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: SYS_MED,
    fontWeight: '600',
    color: t.text,
  },

  scroll: {
    paddingTop: 10,
    paddingBottom: 60,
    gap: 6,
  },

  // Search — Threads gray pill
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.input,
    borderRadius: 23,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    height: 46,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: SYS,
    fontWeight: '400',
    color: t.text,
  },

  // Section
  sectionWrap: {
    gap: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: SYS_MED,
    fontWeight: '600',
    color: t.sub,
    letterSpacing: 0.5,
    marginLeft: 16,
  },

  // Flat Threads group — hairlines top and bottom, no card
  group: {
    backgroundColor: t.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
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
    borderTopColor: t.hairline,
  },
  rowIcon: {
    marginRight: 12,
  },
  settingContent: {
    flex: 1,
    marginRight: 10,
  },
  settingTitle: {
    fontSize: 15,
    fontFamily: SYS,
    fontWeight: '400',
    color: t.text,
    marginBottom: 2,
  },
  settingDesc: {
    fontSize: 13,
    fontFamily: SYS,
    fontWeight: '400',
    color: t.sub,
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
    backgroundColor: t.card,
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
    fontSize: 17,
    fontFamily: SYS_MED,
    fontWeight: '600',
    color: t.text,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: t.input,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  bulletOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: t.hairline,
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
    fontFamily: SYS,
    fontWeight: '400',
    color: t.text,
  },
  langItemTextActive: {
    fontFamily: SYS_MED,
    fontWeight: '600',
    color: '#0A84FF',
  },
  langItemSub: {
    fontSize: 12,
    fontFamily: SYS,
    fontWeight: '400',
    color: t.sub,
  },

  // Footer
  footerWrap: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  footerVersion: {
    fontSize: 12,
    fontFamily: SYS,
    fontWeight: '400',
    color: t.sub,
  },
  footerMeta: {
    fontSize: 11,
    fontFamily: SYS,
    fontWeight: '400',
    color: t.sub,
    marginTop: 2,
  },
});
