import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, Platform, TextInput,
  TouchableOpacity, ActivityIndicator, FlatList, Image, RefreshControl,
  Linking, Alert, StatusBar,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getSessionUser } from '../supabase';
import { withRetry, withTimeout } from '../utils/network';
import { useTheme } from '../utils/theme';
import ThreadsButton from '../components/ThreadsButton';
import * as Haptics from 'expo-haptics';

// Threads-style system type (no Poppins on this screen)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

// vehicle_details is JSONB in the DB (e.g. {"type":"Truck","model":"Toyota"}
// or {}) — never render it raw or React crashes with "Objects are not valid
// as a React child". Format it to a plain string; '' when empty.
const formatVehicle = (v) => {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') {
    return Object.values(v)
      .filter(x => (typeof x === 'string' || typeof x === 'number') && String(x).trim())
      .join(' · ');
  }
  return '';
};

// Defensive: bio should be text, but coerce so a non-string can never crash render.
const asText = (v) => (typeof v === 'string' ? v : '');

export default function MoversListScreen({ navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [movers, setMovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [myCity, setMyCity] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');

  const FILTERS = ['All', 'Harare', 'Bulawayo', 'Mutare', 'Gweru'];

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);

  const loadData = async () => {
    try {
      const user = await getSessionUser();
      // Fire both independent startup queries together instead of
      // back-to-back; the city sort uses the fresh profile city below.
      const profileP = user
        ? supabase
            .from('profiles')
            .select('id, role, city, avatar_url, first_name, last_name')
            .eq('id', user.id)
            .single()
        : Promise.resolve({ data: null });
      const moversP = queryMoversList().catch((e) => {
        console.log('fetchMovers error', e?.message || e);
        return null;
      });
      // Instant paint from cache while both queries fly.
      try {
        const cached = await AsyncStorage.getItem('cached_movers');
        if (cached) setMovers(JSON.parse(cached));
      } catch (_) {}
      const [{ data: profile }, moversList] = await Promise.all([profileP, moversP]);
      let sortCity;
      if (profile) {
        setCurrentUserProfile(profile);
        if (profile.city) {
          setMyCity(profile.city);
          sortCity = profile.city;
        }
      }
      if (moversList) {
        const list = sortMoversByCity(moversList, sortCity !== undefined ? sortCity : myCity);
        setMovers(list);
        try { await AsyncStorage.setItem('cached_movers', JSON.stringify(list)); } catch (_) {}
      }
    } catch (e) {
      console.log('MoversListScreen loadData error', e);
    }
  };

  const MOVERS_SEL = 'id, first_name, last_name, avatar_url, city, phone_number, business_name, bio, vehicle_details, vehicle_photos';

  const sortMoversByCity = (arr, city) => {
    const cityNorm = (city || '').trim().toLowerCase();
    if (!cityNorm) return shuffle(arr);
    const local = arr.filter(m => (m.city || '').trim().toLowerCase() === cityNorm);
    const others = arr.filter(m => (m.city || '').trim().toLowerCase() !== cityNorm);
    return [...shuffle(local), ...shuffle(others)];
  };

  const queryMoversList = async () => {
    // Transient spikes (cold backend, tower handoff) heal inside retries
    // instead of emptying the movers screen.
    const { data, error } = await withRetry(() => withTimeout(
      supabase
        .from('profiles')
        .select(MOVERS_SEL)
        .eq('role', 'mover')
        .order('created_at', { ascending: false }),
      12000,
      'movers'
    ), { attempts: 3, baseDelayMs: 800, label: 'movers' });
    if (error) throw error;
    return data || [];
  };

  const fetchMovers = async (cityOverride) => {
    // Show the last-known list instantly so the screen never sits on a spinner.
    try {
      const cached = await AsyncStorage.getItem('cached_movers');
      if (cached) setMovers(JSON.parse(cached));
    } catch (_) {}
    try {
      const list = sortMoversByCity(
        await queryMoversList(),
        cityOverride !== undefined ? cityOverride : myCity
      );
      setMovers(list);
      try { await AsyncStorage.setItem('cached_movers', JSON.stringify(list)); } catch (_) {}
    } catch (e) {
      console.log('fetchMovers error', e?.message || e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); fetchMovers(); };

  const openInbox = (mover) => {
    navigation.navigate('ChatRoom', {
      participantB: mover.id,
      recipientName: mover.business_name || `${mover.first_name || ''} ${mover.last_name || ''}`.trim(),
      recipientRole: 'mover',
      moverVehicle: mover.vehicle_details || null,
      moverCity: mover.city || null,
    });
  };

  const callMover = (mover) => {
    if (!mover.phone_number) { Alert.alert('No phone number', 'This mover has not added a contact number.'); return; }
    Linking.openURL(`tel:${mover.phone_number}`);
  };

  const goBook = (mover) => {
    navigation.navigate('BookMover', { mover: { ...mover, company_name: mover.business_name } });
  };

  const filtered = movers.filter(m => {
    const q = searchQuery.trim().toLowerCase();
    const matchSearch = !q ||
      (m.business_name || '').toLowerCase().includes(q) ||
      (m.first_name || '').toLowerCase().includes(q) ||
      (m.last_name || '').toLowerCase().includes(q) ||
      (m.bio || '').toLowerCase().includes(q);
    const matchFilter = activeFilter === 'All' ||
      (m.city || '').trim().toLowerCase().includes(activeFilter.toLowerCase());
    return matchSearch && matchFilter;
  });

  // Threads activity-style row: avatar | name + meta | Request + message/call.
  // Tapping the row opens the full mover profile (fleet photos live there).
  const renderRow = ({ item }) => {
    const name = `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.business_name || 'Professional Mover';
    const company = item.business_name || 'Relocation & Logistics';
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'M';
    const isNearby = myCity && (item.city || '').toLowerCase() === myCity.toLowerCase();
    const bioText = asText(item.bio);
    const vehicleText = formatVehicle(item.vehicle_details);

    return (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => navigation.navigate('MoverDetail', { mover: item })}
      >
        <View style={styles.avatarWrap}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.avatarImg} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
        </View>

        <View style={styles.rowMain}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {company} · {item.city || 'Zimbabwe'}{isNearby ? ' · Nearby' : ''}
          </Text>
          {bioText ? (
            <Text style={styles.bio} numberOfLines={2}>{bioText}</Text>
          ) : null}
          {vehicleText ? (
            <View style={styles.vehicleRow}>
              <Ionicons name="car-outline" size={14} color={t.sub} />
              <Text style={styles.vehicleText} numberOfLines={1}>{vehicleText}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.rowSide}>
          <ThreadsButton
            title="Request"
            variant="outline"
            size="sm"
            onPress={(e) => { try { e?.stopPropagation?.(); } catch (_) {} goBook(item); }}
          />
          <View style={styles.iconRow}>
            <TouchableOpacity
              style={styles.ghostBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              activeOpacity={0.65}
              onPress={(e) => { try { e?.stopPropagation?.(); } catch (_) {} try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {} openInbox(item); }}
            >
              <Ionicons name="paper-plane-outline" size={20} color={t.text} />
            </TouchableOpacity>
            {item.phone_number ? (
              <TouchableOpacity
                style={styles.ghostBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.65}
                onPress={(e) => { try { e?.stopPropagation?.(); } catch (_) {} try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {} callMover(item); }}
              >
                <Ionicons name="call-outline" size={20} color={t.text} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const userAvatar = currentUserProfile?.avatar_url;

  return (
    <View style={styles.root}>
      <StatusBar barStyle={t.statusBar} backgroundColor={t.bg} />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Movers</Text>
          <Text style={styles.headerSub}>
            {loading ? 'Finding movers…' : `${filtered.length} mover${filtered.length !== 1 ? 's' : ''}`}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.profileBtn}
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.8}
        >
          {userAvatar ? (
            <Image source={{ uri: userAvatar }} style={styles.headerAvatarImg} />
          ) : (
            <Ionicons name="person-circle-outline" size={32} color={t.sub} />
          )}
        </TouchableOpacity>
      </View>

      {/* Search — Threads pill */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color={t.sub} />
          <TextInput
            placeholder="Search"
            placeholderTextColor={t.sub}
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={20} color={t.sub} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter pills */}
      <View style={styles.filterContainer}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={f => f}
          contentContainerStyle={styles.filterList}
          renderItem={({ item: f }) => (
            <TouchableOpacity
              style={[styles.pill, activeFilter === f && styles.pillActive]}
              onPress={() => setActiveFilter(f)}
              activeOpacity={0.75}
            >
              <Text style={[styles.pillText, activeFilter === f && styles.pillTextActive]}>{f}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* List */}
      {loading && filtered.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={t.text} />
          <Text style={styles.loadingText}>Finding movers near you…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderRow}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text} colors={[t.text]} progressBackgroundColor={t.card} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconRing}>
                <Ionicons name="people-outline" size={36} color={t.sub} />
              </View>
              <Text style={styles.emptyTitle}>No movers found</Text>
              <Text style={styles.emptyBody}>
                No movers found for this location. Try choosing All.
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const buildStyles = (t) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 58 : 42,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  headerTitle: {
    fontSize: 32,
    fontFamily: SYS_MED,
    fontWeight: '700',
    color: t.text,
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 14,
    fontFamily: SYS,
    color: t.sub,
    marginTop: 1,
  },
  profileBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  headerAvatarImg: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline,
  },

  searchSection: {
    backgroundColor: t.bg,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.input,
    height: 46,
    borderRadius: 23,
    paddingLeft: 14,
    paddingRight: 14,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 15,
    fontFamily: SYS,
    color: t.text,
  },

  filterContainer: {
    paddingBottom: 4,
  },
  filterList: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.hairline,
  },
  pillActive: {
    backgroundColor: t.text,
    borderColor: t.text,
  },
  pillText: {
    fontSize: 15,
    fontFamily: SYS,
    color: t.text,
  },
  pillTextActive: {
    color: t.bg,
    fontFamily: SYS_MED,
  },

  list: { paddingBottom: 120 },

  // Threads activity row
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    gap: 12,
  },
  avatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: t.tile,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    fontSize: 20,
    fontFamily: SYS_MED,
    fontWeight: '700',
    color: t.text,
  },
  rowMain: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  name: {
    fontSize: 16,
    fontFamily: SYS_MED,
    fontWeight: '700',
    color: t.text,
    flexShrink: 1,
  },
  meta: {
    fontSize: 14,
    fontFamily: SYS,
    color: t.sub,
    marginTop: 1,
  },
  bio: {
    fontSize: 15,
    fontFamily: SYS,
    color: t.text,
    lineHeight: 21,
    marginTop: 4,
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  vehicleText: {
    fontSize: 14,
    fontFamily: SYS,
    color: t.sub,
    flexShrink: 1,
  },
  rowSide: {
    alignItems: 'flex-end',
    gap: 10,
    paddingTop: 2,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingRight: 4,
  },
  ghostBtn: {
    padding: 4,
    minWidth: 32,
    minHeight: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Loading
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 60 },
  loadingText: { fontSize: 15, fontFamily: SYS, color: t.sub },

  // Empty
  emptyWrap: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyIconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 20, fontFamily: SYS_MED, fontWeight: '700', color: t.text, marginBottom: 6 },
  emptyBody: { fontSize: 15, fontFamily: SYS, color: t.sub, textAlign: 'center', lineHeight: 22 },
});
