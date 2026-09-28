import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Image,
  ScrollView,
  TouchableOpacity,
  StatusBar,
  Alert,
  Share,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { emitFeedScroll } from '../utils/feedScroll';
import { signOutAndClear } from '../utils/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getSessionUser } from '../supabase';

// System fonts — no Poppins on this screen (Threads style)
const SYS_REGULAR = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MEDIUM = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

// Role config
const ROLE_CONFIG = {
  agent:  { label: 'AGENT', color: '#1877F2', bg: '#E7F3FF', icon: 'business' },
  mover:  { label: 'VERIFIED MOVER',   color: '#31A24C', bg: '#EAF8EE', icon: 'swap-horizontal' },
  tenant: { label: 'TENANT',           color: '#1877F2', bg: '#E7F3FF', icon: 'person' },
};

export default function ProfileScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [savedCount, setSavedCount] = useState(0);
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  // Collapsible dropdown sections (Shortcuts open by default)
  const [openSections, setOpenSections] = useState({ shortcuts: true, support: false, settings: false });
  const toggleSection = (key) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const lastFeedY = useRef(0);
  const onFeedScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastFeedY.current;
    lastFeedY.current = y;
    if (Math.abs(dy) > 2) emitFeedScroll(dy);
  };

  const loadProfile = async () => {
    // 1) Instantly restore whatever we know locally so the account never
    //    flashes the "Hlala Link User" placeholder while auth is still loading.
    try {
      const mirrorRaw = await AsyncStorage.getItem('hlala_auth_mirror_v1');
      if (mirrorRaw) {
        const mirror = JSON.parse(mirrorRaw);
        const mirrorUser = mirror?.user;
        if (mirrorUser?.id) {
          setUser(mirrorUser);
          try {
            const cached = await AsyncStorage.getItem(`cached_user_profile_${mirrorUser.id}`);
            if (cached) setProfile(JSON.parse(cached));
          } catch (_) {}
        }
      }
    } catch (_) {}

    // 2) Fetch the live auth session. Right after a reload the session is
    //    restored from storage asynchronously, so it can briefly read as
    //    null even though we ARE signed in — retry a few times instead of
    //    giving up. Local read, no network round-trip.
    let user = null;
    for (let i = 0; i < 3; i++) {
      try {
        user = await getSessionUser();
      } catch (_) {}
      if (user) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    setUser(user);

    try {
      if (user) {
        // Fetch profile (only rendered columns — names, avatar, role)
        const { data, error } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, avatar_url, role')
          .eq('id', user.id)
          .single();
        if (error) throw error;
        if (data) {
          const roleFromDb = data.role || user?.user_metadata?.role || 'tenant';
          setProfile({ ...data, role: roleFromDb });
          console.log('[ProfileScreen] loaded profile:', data.first_name, data.last_name, '| email:', user.email);
          await AsyncStorage.setItem(`cached_user_profile_${user.id}`, JSON.stringify({ ...data, role: roleFromDb }));
        } else {
          console.log('[ProfileScreen] profile row missing for', user.id, user.email?.split('@')[0]);
        }

        // Fetch counts for shortcuts in their own try/catch so a count
        // failure can never block the profile render or cache write.
        try {
          const { count: savedCountVal } = await supabase
            .from('saved_properties')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id);
          if (typeof savedCountVal === 'number') setSavedCount(savedCountVal);

          // Unread = messages in my conversations, sent by others, not read.
          // (messages has no receiver_id column — scope via conversations.)
          const { data: convs } = await supabase
            .from('conversations')
            .select('id')
            .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`);
          const convIds = (convs || []).map(c => c.id);
          if (convIds.length > 0) {
            const { count: unreadVal } = await supabase
              .from('messages')
              .select('id', { count: 'exact', head: true })
              .in('conversation_id', convIds)
              .neq('sender_id', user.id)
              .neq('status', 'read');
            if (typeof unreadVal === 'number') setUnreadMsgCount(unreadVal);
          } else {
            setUnreadMsgCount(0);
          }
        } catch (countErr) {
          console.log('[ProfileScreen] counts error:', countErr?.message || countErr);
        }
      }
    } catch (e) {
      console.log('Profile fetch error, loading from cache:', e);
    }
  };

  useFocusEffect(useCallback(() => { loadProfile(); }, []));

  const handleLogout = () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out of your Hlala Link account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => { await signOutAndClear(); },
        },
      ]
    );
  };

  const handleShareProfile = async () => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    try {
      // Profile deep link: recipients land on the website spotlight, where
      // the pinned Get-the-App button (or the hlalalink:// deep link, when
      // installed) takes them to this profile. Swap SITE_URL only if the
      // web domain ever changes; use the store URL once published.
      const SITE_URL = 'https://hlala-link.web.app';
      const APP_DOWNLOAD_URL = 'https://expo.dev/accounts/ehsanum/projects/hlala-link';
      const myId = user?.id || profile?.id || '';
      const link = myId ? `${SITE_URL}/#profile=${myId}` : APP_DOWNLOAD_URL;
      await Share.share({
        message: `Check out ${displayName} on Hlala Link — verified rentals, agents and movers in Zimbabwe. View profile & get the app: ${link}`,
        url: link,
        title: 'Hlala Link',
      });
    } catch (_) {}
  };

  const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';
  const displayName = fullName || profile?.full_name ||
    (user?.email ? user.email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null) ||
    'Hlala Link User';
  const initials = displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'HL';
  const roleKey = (profile?.role || 'tenant');
  const roleConf = ROLE_CONFIG[roleKey] || ROLE_CONFIG.tenant;

  // Flat Threads-style rows — same navigation targets as before
  const shortcutRows = [
    {
      id: 'saved',
      title: 'Saved',
      icon: 'bookmark',
      route: 'Saved',
    },
    {
      id: 'messages',
      title: 'Messages',
      icon: 'chatbubble',
      route: 'UserList',
    },
    ...(roleKey === 'agent' ? [
      {
        id: 'listings',
        title: 'My Listings',
        icon: 'home',
        route: 'AgentHome',
      },
    ] : []),
    ...(roleKey === 'mover' ? [
      {
        id: 'moverhub',
        title: 'Moving Hub',
        icon: 'swap-horizontal',
        route: 'AgentHome',
      },
    ] : []),
    {
      id: 'searches',
      title: 'Saved Searches',
      icon: 'search',
      route: 'SavedSearches',
    },
    {
      id: 'movers',
      title: 'Find Movers',
      icon: 'car-sport',
      route: 'MoversList',
    },
  ];

  const supportRows = [
    {
      id: 'help',
      title: 'Help Center',
      icon: 'help-circle',
      route: 'Support',
    },
    {
      id: 'report',
      title: 'Report a Problem',
      icon: 'flag',
      route: 'Support',
    },
  ];

  const settingsRows = [
    {
      id: 'settings',
      title: 'Settings',
      icon: 'settings',
      route: 'Settings',
    },
    {
      id: 'privacy',
      title: 'Privacy',
      icon: 'shield-checkmark',
      route: 'Generic',
      params: {
        title: 'Privacy Policy',
        icon: 'shield-checkmark',
        message: 'Your privacy is our highest priority. We use industry-standard encryption to protect your data. We never sell your personal information to third parties.',
      },
    },
    {
      id: 'terms',
      title: 'Terms',
      icon: 'document-text',
      route: 'Generic',
      params: {
        title: 'Terms of Service',
        icon: 'document-text',
        message: 'Hlala Link Marketplace Terms\n\nCopyright (c) 2026 Hlala Link. All rights reserved.\n\nBy accessing or using Hlala Link, you agree to comply with our community safety and marketplace policies.',
      },
    },
    {
      id: 'about',
      title: 'About',
      icon: 'information-circle',
      route: 'Generic',
      params: {
        title: 'About',
        icon: 'information-circle',
        message: 'Hlala Link · v1.1.0\n\nMeta-Grade Real Estate Discovery.',
      },
    },
  ];

  const go = (row) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    // Profile renders both as a tab and as a stack screen — resolve the
    // route in this navigator, else the parent, else via Main tabs.
    try {
      const names = navigation.getState?.()?.routeNames || [];
      const parent = navigation.getParent?.();
      const parentNames = parent?.getState?.()?.routeNames || [];
      if (names.includes(row.route)) {
        if (row.params) navigation.navigate(row.route, row.params);
        else navigation.navigate(row.route);
      } else if (parent && parentNames.includes(row.route)) {
        if (row.params) parent.navigate(row.route, row.params);
        else parent.navigate(row.route);
      } else if (parent) {
        if (row.params) parent.navigate('Main', { screen: row.route, params: row.params });
        else parent.navigate('Main', { screen: row.route });
      }
    } catch (_) {}
  };

  const renderRow = (row, isLast) => (
    <TouchableOpacity
      key={row.id}
      style={[styles.row, isLast && styles.rowLast]}
      onPress={() => go(row)}
      activeOpacity={0.6}
    >
      <Ionicons name={row.icon} size={22} color="#111111" style={styles.rowIcon} />
      <Text style={styles.rowTitle} numberOfLines={1}>{row.title}</Text>
      <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
    </TouchableOpacity>
  );

  const sections = [
    { key: 'shortcuts', label: 'Shortcuts', rows: shortcutRows },
    { key: 'support', label: 'Support', rows: supportRows },
    { key: 'settings', label: 'Settings', rows: settingsRows },
  ];

  const renderSection = (section, index) => {
    const isOpen = !!openSections[section.key];
    return (
      <View key={section.key} style={[styles.dropBlock, index === 0 && styles.dropBlockFirst]}>
        <TouchableOpacity
          style={styles.dropHeader}
          onPress={() => toggleSection(section.key)}
          activeOpacity={0.6}
        >
          <Text style={styles.dropLabel}>{section.label}</Text>
          <Text style={styles.dropCount}>{section.rows.length}</Text>
          <Ionicons
            name={isOpen ? 'chevron-up' : 'chevron-down'}
            size={20}
            color="#8A8A8A"
          />
        </TouchableOpacity>
        {isOpen && (
          <View style={styles.dropBody}>
            {section.rows.map((r, i) => renderRow(r, i === section.rows.length - 1))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Threads top bar — icons only, no title */}
      <View style={styles.header}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={handleShareProfile}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.headerIconBtn}
        >
          <Ionicons name="share" size={24} color="#111111" />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          activeOpacity={0.6}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.headerIconBtn}
        >
          <Ionicons name="settings" size={24} color="#111111" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={onFeedScroll}
        scrollEventThrottle={16}
      >

        {/* ─── Threads profile header: text left, avatar right ─── */}
        <View style={styles.profileBlock}>
          <View style={styles.nameAvatarRow}>
            <View style={styles.nameBlock}>
              <Text style={styles.profileRole}>{roleConf.label.charAt(0) + roleConf.label.slice(1).toLowerCase()}</Text>
              <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.statsText}>{`${savedCount} Saved · ${unreadMsgCount} Unread`}</Text>
            </View>
            {profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
          </View>

          {/* Buttons row */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.6}
            >
              <Text style={styles.outlineBtnText}>Edit profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={handleShareProfile}
              activeOpacity={0.6}
            >
              <Text style={styles.outlineBtnText}>Share profile</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── Dropdown sections ─── */}
        {sections.map((s, i) => renderSection(s, i))}

        {/* ─── Log Out (plain red-text row) ─── */}
        <TouchableOpacity style={styles.logoutRow} onPress={handleLogout} activeOpacity={0.6}>
          <Ionicons name="log-out" size={22} color="#FF3B30" style={styles.rowIcon} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        {/* Footer */}
        <View style={styles.footerWrap}>
          <Text style={styles.footerText}>Hlala Link · v1.1.0</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  // Icon-only top bar (Threads has no title here)
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingHorizontal: 16,
    paddingBottom: 4,
    backgroundColor: '#FFFFFF',
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },

  scroll: {
    paddingBottom: 110,
  },

  // Threads profile header — text left, avatar right
  profileBlock: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  nameAvatarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  nameBlock: {
    flex: 1,
    paddingRight: 12,
    justifyContent: 'center',
  },
  avatarImg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F0F0F0',
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#111111',
    fontSize: 26,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
  },
  profileName: {
    fontSize: 22,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
    color: '#000000',
  },
  profileRole: {
    fontSize: 13,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: '#8A8A8A',
    marginBottom: 2,
  },
  statsText: {
    fontSize: 15,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: '#8A8A8A',
    marginTop: 8,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    marginBottom: 12,
  },
  outlineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D9D9D9',
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  outlineBtnText: {
    fontSize: 15,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
    color: '#000000',
  },

  // Dropdown sections
  dropBlock: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EFEFEF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  dropBlockFirst: {
    marginTop: 14,
  },
  dropHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
  },
  dropLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
    color: '#000000',
  },
  dropCount: {
    fontSize: 13,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: '#8A8A8A',
    marginRight: 6,
  },
  dropBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EFEFEF',
  },

  // Threads-style flat rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
    backgroundColor: '#FFFFFF',
  },
  rowLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    marginRight: 12,
  },
  rowTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: '#000000',
  },

  // Log Out — plain red-text row
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EFEFEF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
    backgroundColor: '#FFFFFF',
  },
  logoutText: {
    flex: 1,
    fontSize: 15,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: '#FF3B30',
  },

  // Footer — small centered gray text
  footerWrap: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 10,
  },
  footerText: {
    fontSize: 12,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: '#8A8A8A',
    textAlign: 'center',
  },
});
