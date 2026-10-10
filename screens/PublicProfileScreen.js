import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity,
  Image, ActivityIndicator, StatusBar, Alert, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';
import ListingCard from '../components/ListingCard';
import { emitFeedScroll } from '../utils/feedScroll';
import ThreadsButton from '../components/ThreadsButton';

// Public agent profile — opened from shared profile links
// (hlalalink://profile/<id>), viewable even when logged out.
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

const ROLE_LABEL = {
  agent: 'Property Agent',
  landlord: 'Landlord',
  mover: 'Mover Partner',
  admin: 'Hlala Link Official',
};

export default function PublicProfileScreen({ route, navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const userId = route.params?.userId || null;
  const [profile, setProfile] = useState(null);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savedIds, setSavedIds] = useState([]);
  const [meId, setMeId] = useState(null);
  const [viewerPrivileged, setViewerPrivileged] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const lastFeedY = useRef(0);
  const onFeedScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastFeedY.current;
    lastFeedY.current = y;
    if (Math.abs(dy) > 2) emitFeedScroll(dy);
  };

  const load = async (silent = false) => {
    if (!userId) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const me = await getSessionUser();
      setMeId(me?.id || null);
      // Admins, agents and landlords see ALL of this user's listings
      // (including pending / rejected); everyone else sees live ones only.
      let privileged = !!(me && me.id === userId);
      let viewerRole = null;
      if (me && !privileged) {
        const { data: meProf } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', me.id)
          .maybeSingle();
        viewerRole = meProf?.role || null;
        privileged = viewerRole === 'admin' || viewerRole === 'agent' || viewerRole === 'landlord';
      }
      setViewerPrivileged(privileged);

      let propsQuery = supabase
        .from('properties')
        .select('id, title, status, rent_usd, sale_price_usd, listing_purpose, city, suburb, address, property_type, created_at, views, owner_id, bedrooms, bathrooms, area_sqm, description, property_images(url, alt_text), owner:profiles!owner_id(first_name, last_name, business_name, avatar_url, role)')
        .eq('owner_id', userId)
        .order('created_at', { ascending: false });
      if (!privileged) propsQuery = propsQuery.eq('status', 'available');

      const [{ data: prof }, { data: props }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, first_name, last_name, business_name, avatar_url, role, city, bio')
          .eq('id', userId)
          .maybeSingle(),
        propsQuery,
      ]);
      if (prof) setProfile(prof);
      setListings(props || []);
      if (me) {
        const { data: favs } = await supabase
          .from('saved_properties')
          .select('property_id')
          .eq('user_id', me.id);
        if (favs) setSavedIds(favs.map((f) => f.property_id));
      }
    } catch (e) {
      console.log('[PublicProfile] load error:', e?.message || e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [userId]));

  const toggleFavorite = async (property) => {
    const me = await getSessionUser();
    if (!me) {
      Alert.alert('Login Required', 'Please log in to save properties.');
      return;
    }
    const isFav = savedIds.includes(property.id);
    if (isFav) {
      setSavedIds((prev) => prev.filter((id) => id !== property.id));
    } else {
      setSavedIds((prev) => [...prev, property.id]);
    }
    try {
      if (isFav) {
        await supabase.from('saved_properties').delete().eq('user_id', me.id).eq('property_id', property.id);
      } else {
        await supabase.from('saved_properties').insert({ user_id: me.id, property_id: property.id });
      }
    } catch (_) {}
  };

  const openChat = async () => {
    const me = await getSessionUser();
    if (!me) {
      Alert.alert('Login Required', 'Please log in to message this agent.');
      return;
    }
    if (!profile) return;
    navigation.navigate('ChatRoom', {
      participantB: profile.id,
      recipientName: displayName,
      recipientAvatar: profile.avatar_url || null,
      recipientRole: profile.role || null,
    });
  };

  const fullName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';
  const displayName = profile?.business_name || fullName || 'Hlala Link Agent';
  const initials = (fullName || displayName).split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'HL';

  // Privileged viewers can slice this user's listings by status.
  const STATUS_FILTERS = ['all', 'available', 'pending', 'rejected'];
  const visibleListings = !viewerPrivileged || statusFilter === 'all'
    ? listings
    : listings.filter((l) => (l.status || 'available') === statusFilter);
  const statusCount = (s) => listings.filter((l) => (l.status || 'available') === s).length;

  return (
    <View style={styles.root}>
      <StatusBar barStyle={t.statusBar} backgroundColor={t.bg} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color={t.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {profile ? displayName : 'Profile'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0A84FF" />
        </View>
      ) : !profile ? (
        <View style={styles.center}>
          <Ionicons name="person" size={48} color="#D1D1D6" />
          <Text style={styles.emptyTitle}>Profile not found</Text>
          <Text style={styles.emptySub}>This profile link is invalid or was removed.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          onScroll={onFeedScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(true); }}
              tintColor="#111111"
              colors={['#0A84FF']}
              progressBackgroundColor="#FFFFFF"
            />
          }
        >
          <View style={styles.profileBlock}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>{initials}</Text>
              </View>
            )}
            <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.role}>
              {ROLE_LABEL[profile.role] || 'Member'}{profile.city ? ` · ${profile.city}` : ''}
            </Text>
            {!!profile.bio && (
              <Text style={styles.bio} numberOfLines={3}>{profile.bio}</Text>
            )}
            <View style={styles.btnRow}>
              <ThreadsButton
                title="Message"
                icon="chatbubble-ellipses"
                variant="primary"
                size="md"
                onPress={openChat}
                style={styles.msgBtnWrap}
              />
            </View>
            <Text style={styles.countText}>
              {visibleListings.length} {viewerPrivileged ? `listing${visibleListings.length === 1 ? '' : 's'}` : `live listing${visibleListings.length === 1 ? '' : 's'}`}
            </Text>
          </View>

          {/* Status filter — next to the bio block, privileged viewers only */}
          {viewerPrivileged && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.statusFilterRow}
            >
              {STATUS_FILTERS.map((s) => {
                const active = statusFilter === s;
                const label = s === 'all'
                  ? `All (${listings.length})`
                  : `${s.charAt(0).toUpperCase() + s.slice(1)} (${statusCount(s)})`;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.statusPill, active && styles.statusPillActive]}
                    onPress={() => setStatusFilter(s)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.statusPillText, active && styles.statusPillTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {visibleListings.map((item) => (
            <View key={String(item.id)}>
              {viewerPrivileged && item.status && item.status !== 'available' && (
                <Text style={styles.statusNote}>{String(item.status).toUpperCase()}</Text>
              )}
              <ListingCard
                item={item}
                wide
                onPress={() => {
                  if (!meId) {
                    Alert.alert('Login Required', 'Please log in to view listing details.');
                    return;
                  }
                  navigation.navigate('Detail', { item });
                }}
                onFavorite={toggleFavorite}
                isFavorite={savedIds.includes(item.id)}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const buildStyles = (t) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: t.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: SYS_MED, fontWeight: '600', color: t.text },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: SYS_MED, fontWeight: '600', color: t.text, marginTop: 16 },
  emptySub: { fontSize: 14, fontFamily: SYS, color: t.sub, marginTop: 6, textAlign: 'center' },
  scroll: { paddingBottom: 90, paddingTop: 6 },
  profileBlock: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: t.tile },
  avatarFallback: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#111111',
    justifyContent: 'center', alignItems: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 28, fontFamily: SYS_MED, fontWeight: '600' },
  name: { fontSize: 22, fontFamily: SYS_MED, fontWeight: '600', color: t.text, marginTop: 12 },
  role: { fontSize: 13, fontFamily: SYS, color: t.sub, marginTop: 2 },
  bio: { fontSize: 14, fontFamily: SYS, color: t.text, marginTop: 8, textAlign: 'center', lineHeight: 20 },
  btnRow: { flexDirection: 'row', marginTop: 14, width: '100%' },
  msgBtnWrap: { flex: 1 },
  countText: { fontSize: 13, fontFamily: SYS, color: t.sub, marginTop: 14, marginBottom: 4 },
  statusNote: {
    fontSize: 12,
    fontFamily: SYS_MED,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: t.sub,
    paddingHorizontal: 18,
    marginTop: 10,
  },
  statusFilterRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  statusPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.hairline,
  },
  statusPillActive: {
    backgroundColor: t.text,
    borderColor: t.text,
  },
  statusPillText: {
    fontSize: 14,
    fontFamily: SYS,
    color: t.text,
  },
  statusPillTextActive: {
    color: t.bg,
    fontFamily: SYS_MED,
  },
});
