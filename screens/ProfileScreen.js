import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
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
import { signOutAndClear, displayNameFromEmail } from '../utils/auth';
import { TERMS_OF_SERVICE, PRIVACY_POLICY, ABOUT_APP } from '../utils/legal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';

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
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
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
          .select('id, first_name, last_name, avatar_url, role, city, bio')
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
      const APP_DOWNLOAD_URL = `${SITE_URL}/downloads/hlala-link.apk`;
      const myId = user?.id || profile?.id || '';
      const shareParams = [
        ['profile', myId],
        ['name', displayName],
        ['role', profile?.role || user?.role || user?.user_metadata?.role || 'tenant'],
        ['avatar', profile?.avatar_url],
      ].filter(([, value]) => value).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
      const link = myId ? `${SITE_URL}/?${shareParams}` : APP_DOWNLOAD_URL;
      await Share.share({
        message: `Check out ${displayName} on Hlala Link — verified rentals, agents and movers in Zimbabwe. View profile & get the app: ${link}`,
        url: link,
        title: 'Hlala Link',
      });
    } catch (_) {}
  };

  const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';
  const displayName = fullName || profile?.full_name ||
    displayNameFromEmail(user?.email) ||
    'Hlala Link User';
  const initials = displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'HL';
  const roleKey = profile?.role || user?.role || user?.user_metadata?.role || 'tenant';
  const roleConf = ROLE_CONFIG[roleKey];
  const roleLabel = roleConf?.label || String(roleKey).replace(/[_-]+/g, ' ').toUpperCase();
  const handle = String(user?.email || '').split('@')[0].toLowerCase() || 'hlala.user';
  const needsBio = profile ? !String(profile?.bio || '').trim() : false;
  const canReviewListings = roleKey === 'admin' || roleKey === 'agent' || roleKey === 'landlord';
  const finishLeft = (needsBio ? 1 : 0) + (canReviewListings ? 1 : 0);

  // Flat Threads-style rows — same navigation targets as before
  const shortcutRows = [
    {
      id: 'saved',
      title: 'Saved',
      icon: 'bookmark-outline',
      route: 'Saved',
    },
    {
      id: 'messages',
      title: 'Messages',
      icon: 'chatbubble-outline',
      route: 'UserList',
    },
    ...(roleKey === 'agent' || roleKey === 'landlord' || roleKey === 'admin' ? [
      {
        id: 'listings',
        title: 'My Listings',
        icon: 'home-outline',
        route: 'AgentHome',
      },
    ] : []),
    ...(roleKey === 'mover' ? [
      {
        id: 'moverhub',
        title: 'Moving Hub',
        icon: 'swap-horizontal-outline',
        route: 'AgentHome',
      },
    ] : []),
    {
      id: 'searches',
      title: 'Saved Searches',
      icon: 'search-outline',
      route: 'SavedSearches',
    },
    {
      id: 'movers',
      title: 'Find Movers',
      icon: 'car-sport-outline',
      route: 'MoversList',
    },
  ];

  const supportRows = [
    {
      id: 'help',
      title: 'Help Center',
      icon: 'help-circle-outline',
      route: 'Support',
    },
    {
      id: 'report',
      title: 'Report a Problem',
      icon: 'flag-outline',
      route: 'Support',
    },
  ];

  const settingsRows = [
    {
      id: 'settings',
      title: 'Settings',
      icon: 'settings-outline',
      route: 'Settings',
    },
    {
      id: 'privacy',
      title: 'Privacy',
      icon: 'shield-checkmark-outline',
      route: 'Generic',
      params: { ...PRIVACY_POLICY },
    },
    {
      id: 'terms',
      title: 'Terms',
      icon: 'document-text-outline',
      route: 'Generic',
      params: { ...TERMS_OF_SERVICE },
    },
    {
      id: 'about',
      title: 'About',
      icon: 'information-circle-outline',
      route: 'Generic',
      params: { ...ABOUT_APP },
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
      <Ionicons name={row.icon} size={22} color={t.text} style={styles.rowIcon} />
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
            color={t.sub}
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
      <StatusBar barStyle={t.statusBar} backgroundColor={t.bg} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={onFeedScroll}
        scrollEventThrottle={16}
      >

        {/* Profile header — Threads style */}
        <View style={styles.profileBlock}>
          <View style={styles.topIcons}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => { try { navigation.navigate('Main', { screen: 'Explore' }); } catch (_) {} }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Search"
            >
              <Ionicons name="search-outline" size={24} color={t.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => go({ route: 'Settings' })}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <Ionicons name="settings-outline" size={24} color={t.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.nameAvatarRow}>
            <View style={styles.nameBlock}>
              <View style={styles.displayNameRow}>
                <Text style={styles.profileName} numberOfLines={1}>{displayName}</Text>
                <Ionicons name="chevron-down" size={18} color={t.text} style={{ marginLeft: 4 }} />
                {needsBio && <View style={styles.redDot} />}
              </View>
              <Text style={styles.profileHandle} numberOfLines={1}>@{handle}</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('EditProfile')} activeOpacity={0.8}>
              <View>
                {profile?.avatar_url ? (
                  <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
                ) : (
                  <View style={styles.avatarPlaceholder}>
                    <Text style={styles.avatarText}>{initials}</Text>
                  </View>
                )}
                <View style={styles.avatarPlus}>
                  <Ionicons name="add" size={16} color={t.text} />
                </View>
              </View>
            </TouchableOpacity>
          </View>

          <View style={styles.pillsRow}>
            {!!roleConf && (
              <View style={styles.pill}>
                <Ionicons name={roleConf.icon} size={13} color={roleConf.color} style={{ marginRight: 5 }} />
                <Text style={[styles.pillText, { color: roleConf.color }]}>
                  {roleLabel.charAt(0) + roleLabel.slice(1).toLowerCase()}
                </Text>
              </View>
            )}
            {!!profile?.city && (
              <View style={styles.pill}>
                <Ionicons name="location-outline" size={13} color={t.sub} style={{ marginRight: 5 }} />
                <Text style={styles.pillText}>{profile.city}</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.pill}
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <Ionicons name="add" size={14} color={t.sub} />
            </TouchableOpacity>
          </View>

          {!!String(profile?.bio || '').trim() && (
            <Text style={styles.bioText}>{String(profile.bio).trim()}</Text>
          )}

          {/* Buttons row */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.filledBtn}
              onPress={() => navigation.navigate('EditProfile')}
              activeOpacity={0.7}
            >
              <Text style={styles.filledBtnText}>Edit profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.filledBtn}
              onPress={handleShareProfile}
              activeOpacity={0.7}
            >
              <Text style={styles.filledBtnText}>Share profile</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Finish your profile */}
        {finishLeft > 0 && (
          <View style={styles.finishWrap}>
            <View style={styles.finishHeader}>
              <Text style={styles.finishTitle}>Finish your profile</Text>
              <Text style={styles.finishLeft}>{finishLeft} left</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.finishCards}
            >
              {needsBio && (
              <View style={styles.finishCard}>
                <View style={styles.finishIconCircle}>
                  <Ionicons name="pencil-outline" size={24} color={t.text} />
                </View>
                <Text style={styles.finishCardTitle}>Add bio</Text>
                <Text style={styles.finishCardSub} numberOfLines={2}>
                  Introduce yourself and tell people what you're into.
                </Text>
                <TouchableOpacity
                  style={styles.finishPrimaryBtn}
                  onPress={() => navigation.navigate('EditProfile')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.finishPrimaryBtnText}>Add</Text>
                </TouchableOpacity>
              </View>
              )}
              {canReviewListings && (
              <View style={styles.finishCard}>
                <View style={styles.finishIconCircle}>
                  <Ionicons name="home-outline" size={24} color={t.text} />
                </View>
                <Text style={styles.finishCardTitle}>My listings</Text>
                <Text style={styles.finishCardSub} numberOfLines={2}>
                  See everything you've posted, live and pending.
                </Text>
                <TouchableOpacity
                  style={styles.finishPrimaryBtn}
                  onPress={() => go({ route: 'AgentHome' })}
                  activeOpacity={0.85}
                >
                  <Text style={styles.finishPrimaryBtnText}>View</Text>
                </TouchableOpacity>
              </View>
              )}
            </ScrollView>
          </View>
        )}

        {/* ─── Dropdown sections ─── */}
        {sections.map((s, i) => renderSection(s, i))}

        {/* ─── Log Out (plain red-text row) ─── */}
        <TouchableOpacity style={styles.logoutRow} onPress={handleLogout} activeOpacity={0.6}>
          <Ionicons name="log-out-outline" size={22} color="#FF3B30" style={styles.rowIcon} />
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

const buildStyles = (t) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.bg,
  },

  // Icon buttons (top-right, Threads has no title here)
  headerIconBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },

  scroll: {
    paddingBottom: 110,
  },

  // Threads profile header — name left, avatar right
  profileBlock: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingBottom: 6,
  },
  topIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginHorizontal: -8,
    marginBottom: 2,
  },
  nameAvatarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  nameBlock: {
    flex: 1,
    paddingRight: 12,
    justifyContent: 'center',
  },
  displayNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  redDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF3B30',
    marginLeft: 6,
  },
  profileHandle: {
    fontSize: 15,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: t.sub,
    marginTop: 1,
  },
  avatarPlus: {
    position: 'absolute',
    left: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.hairline,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: {
    fontSize: 14,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
    color: t.sub,
  },
  bioText: {
    fontSize: 16,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: t.text,
    lineHeight: 22,
    marginTop: 10,
  },
  avatarImg: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: t.tile,
  },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: t.text,
    fontSize: 26,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
  },
  profileName: {
    fontSize: 26,
    fontFamily: SYS_MEDIUM,
    fontWeight: '700',
    color: t.text,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    marginBottom: 4,
  },
  filledBtn: {
    flex: 1,
    backgroundColor: t.input,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filledBtnText: {
    fontSize: 16,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
    color: t.text,
  },

  // Finish your profile
  finishWrap: {
    marginTop: 6,
    paddingBottom: 4,
  },
  finishHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
  },
  finishTitle: {
    fontSize: 17,
    fontFamily: SYS_MEDIUM,
    fontWeight: '700',
    color: t.text,
  },
  finishLeft: {
    fontSize: 14,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: t.sub,
  },
  finishCards: {
    paddingHorizontal: 16,
    gap: 12,
  },
  finishCard: {
    width: 220,
    backgroundColor: t.tile,
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
  },
  finishIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: t.text,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  finishCardTitle: {
    fontSize: 17,
    fontFamily: SYS_MEDIUM,
    fontWeight: '700',
    color: t.text,
  },
  finishCardSub: {
    fontSize: 13,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: t.sub,
    textAlign: 'center',
    marginTop: 4,
  },
  finishPrimaryBtn: {
    marginTop: 12,
    backgroundColor: t.text,
    borderRadius: 12,
    paddingVertical: 11,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  finishPrimaryBtnText: {
    fontSize: 16,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
    color: t.bg,
  },

  // Dropdown sections
  dropBlock: {
    marginTop: 10,
    backgroundColor: t.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  dropBlockFirst: {
    marginTop: 14,
  },
  dropHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: t.card,
  },
  dropLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: SYS_MEDIUM,
    fontWeight: '600',
    color: t.text,
  },
  dropCount: {
    fontSize: 13,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: t.sub,
    marginRight: 6,
  },
  dropBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
  },

  // Threads-style flat rows
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    backgroundColor: t.card,
  },
  rowLast: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: {
    marginRight: 12,
  },
  rowTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: SYS_REGULAR,
    fontWeight: '400',
    color: t.text,
  },

  // Log Out — plain red-text row
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    backgroundColor: t.card,
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
    color: t.sub,
    textAlign: 'center',
  },
});
