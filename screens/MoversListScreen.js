import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Platform, TextInput,
  TouchableOpacity, ActivityIndicator, FlatList, Image, RefreshControl,
  Linking, Alert, Modal, useWindowDimensions, StatusBar, Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

const IOS_BLUE = '#007AFF';
const IOS_GREEN = '#34C759';
const IOS_GRAY  = '#8E8E93';
const IOS_BG    = '#F2F2F7';

export default function MoversListScreen({ navigation }) {
  const [movers, setMovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [userRole, setUserRole] = useState('tenant');
  const [myCity, setMyCity] = useState('');
  const [viewerUri, setViewerUri] = useState(null);
  const [activeFilter, setActiveFilter] = useState('All');
  const { width } = useWindowDimensions();
  const fadeIn = useRef(new Animated.Value(0)).current;

  const FILTERS = ['All', 'Harare', 'Bulawayo', 'Mutare', 'Gweru'];

  useFocusEffect(
    useCallback(() => {
      loadData();
      Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }, [])
  );

  const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role, city')
          .eq('id', user.id)
          .single();
        if (profile) {
          setUserRole(profile.role);
          if (profile.city) setMyCity(profile.city);
        }
      }
      await fetchMovers();
    } catch (e) {
      console.log('MoversListScreen loadData error', e);
    }
  };

  const fetchMovers = async () => {
    const SEL = 'id, first_name, last_name, avatar_url, city, phone_number, business_name, bio, vehicle_details, vehicle_photos';
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select(SEL)
        .eq('role', 'mover')
        .order('created_at', { ascending: false });
      if (error) throw error;
      let list = data || [];
      if (myCity) {
        const local = list.filter(m => (m.city || '').toLowerCase() === myCity.toLowerCase());
        const others = list.filter(m => (m.city || '').toLowerCase() !== myCity.toLowerCase());
        list = [...shuffle(local), ...shuffle(others)];
      } else {
        list = shuffle(list);
      }
      setMovers(list);
    } catch (e) {
      console.log('fetchMovers error', e);
      setMovers([]);
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

  const whatsappMover = (mover) => {
    if (!mover.phone_number) { Alert.alert('No phone number', 'This mover has not added a contact number.'); return; }
    Linking.openURL(`https://wa.me/${mover.phone_number.replace(/\D/g, '')}`);
  };

  const filtered = movers.filter(m => {
    const q = searchQuery.toLowerCase();
    const matchSearch = !q ||
      (m.business_name || '').toLowerCase().includes(q) ||
      (m.first_name || '').toLowerCase().includes(q) ||
      (m.last_name || '').toLowerCase().includes(q) ||
      (m.bio || '').toLowerCase().includes(q);
    const matchFilter = activeFilter === 'All' ||
      (m.city || '').toLowerCase().includes(activeFilter.toLowerCase());
    return matchSearch && matchFilter;
  });

  const PhotoStrip = ({ item }) => {
    const photos = item.vehicle_photos || [];
    const [page, setPage] = useState(0);
    const cardW = width - 32;
    if (!photos.length) return null;
    return (
      <View style={{ flex: 1 }}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          onMomentumScrollEnd={(e) =>
            setPage(Math.round(e.nativeEvent.contentOffset.x / cardW))}
          renderItem={({ item: uri }) => (
            <TouchableOpacity
              activeOpacity={0.95}
              style={{ width: cardW }}
              onPress={() => setViewerUri(uri)}
            >
              <Image source={{ uri }} style={{ width: cardW, height: '100%' }} />
            </TouchableOpacity>
          )}
        />
        {photos.length > 1 && (
          <View style={styles.dotsRow} pointerEvents="none">
            {photos.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
            ))}
          </View>
        )}
      </View>
    );
  };

  const renderCard = ({ item }) => {
    const name = item.business_name ||
      `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Mover';
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const vehicleType = item.vehicle_details?.type;
    const photos = item.vehicle_photos || [];
    const cardW = width - 32;
    const imgH = Math.round(cardW * 0.58);
    const isNearby = myCity && (item.city || '').toLowerCase() === myCity.toLowerCase();

    return (
      <Animated.View style={[styles.card, { opacity: fadeIn }]}>
        {/* Photo or Fallback */}
        <View style={[styles.heroWrap, { height: imgH }]}>
          {photos.length > 0 ? (
            <PhotoStrip item={item} />
          ) : item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.heroImg} />
          ) : (
            <View style={styles.heroFallback}>
              <Text style={styles.heroInitials}>{initials}</Text>
            </View>
          )}

          <View style={styles.scrim} />

          <View style={styles.badgeRow}>
            <View style={styles.badge}>
              <Ionicons name="checkmark-circle" size={10} color="#fff" />
              <Text style={styles.badgeText}>Verified</Text>
            </View>
            {isNearby && (
              <View style={[styles.badge, { backgroundColor: IOS_GREEN }]}>
                <Ionicons name="location" size={10} color="#fff" />
                <Text style={styles.badgeText}>Nearby</Text>
              </View>
            )}
          </View>

          {item.phone_number && (
            <TouchableOpacity style={styles.callPill} onPress={() => callMover(item)} activeOpacity={0.8}>
              <Ionicons name="call" size={13} color={IOS_BLUE} />
              <Text style={styles.callPillText}>Call</Text>
            </TouchableOpacity>
          )}

          <View style={styles.heroFooter}>
            <Text style={styles.heroName} numberOfLines={1}>{name}</Text>
            <View style={styles.heroLocRow}>
              <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.75)" />
              <Text style={styles.heroLoc} numberOfLines={1}>{item.city || 'Zimbabwe'}</Text>
            </View>
          </View>
        </View>

        {/* Body */}
        <View style={styles.body}>
          <View style={styles.tagsRow}>
            {vehicleType && (
              <View style={styles.tag}>
                <Ionicons name="cube-outline" size={10} color={IOS_BLUE} />
                <Text style={styles.tagText}>{vehicleType}</Text>
              </View>
            )}
            {item.phone_number && (
              <View style={[styles.tag, styles.tagGreen]}>
                <View style={styles.onlineDot} />
                <Text style={[styles.tagText, { color: IOS_GREEN }]}>Available</Text>
              </View>
            )}
          </View>

          {item.bio ? (
            <Text style={styles.bio} numberOfLines={2}>{item.bio}</Text>
          ) : null}

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.btnPrimary} onPress={() => openInbox(item)} activeOpacity={0.85}>
              <Ionicons name="chatbubble-ellipses" size={15} color="#fff" />
              <Text style={styles.btnText}>Message</Text>
            </TouchableOpacity>
            {item.phone_number && (
              <TouchableOpacity style={styles.btnWa} onPress={() => whatsappMover(item)} activeOpacity={0.85}>
                <Ionicons name="logo-whatsapp" size={15} color="#fff" />
                <Text style={styles.btnText}>WhatsApp</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Movers</Text>
          <Text style={styles.headerSub}>
            {loading ? 'Finding movers…' : `${filtered.length} available`}
          </Text>
        </View>
        {userRole === 'mover' && (
          <TouchableOpacity style={styles.profileBtn} onPress={() => navigation.navigate('Profile')}>
            <Ionicons name="person-circle-outline" size={26} color={IOS_BLUE} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={IOS_GRAY} />
          <TextInput
            placeholder="Search name, city or service"
            placeholderTextColor={IOS_GRAY}
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
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

      {/* Info banner for mover accounts */}
      {userRole === 'mover' && (
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle-outline" size={15} color={IOS_BLUE} />
          <Text style={styles.infoBannerText}>Your profile is listed here. Keep it updated via Profile.</Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={IOS_BLUE} />
          <Text style={styles.loadingText}>Finding movers near you</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={IOS_BLUE} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconRing}>
                <Ionicons name="car-outline" size={40} color={IOS_BLUE} />
              </View>
              <Text style={styles.emptyTitle}>No movers found</Text>
              <Text style={styles.emptyBody}>
                {userRole === 'mover'
                  ? 'Complete your profile and it will appear here.'
                  : 'No registered movers in this area. Try a different city.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Photo viewer */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewer}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUri(null)}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
          {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImg} resizeMode="contain" />}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: IOS_BG },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    paddingTop: Platform.OS === 'ios' ? 58 : 42, paddingHorizontal: 16, paddingBottom: 10,
    backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#C6C6C8',
  },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#000000' },
  headerSub: { fontSize: 13, color: IOS_GRAY },
  profileBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center' },
  searchRow: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#C6C6C8' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EFEFF4', borderRadius: 10, paddingHorizontal: 12, height: 36 },
  searchInput: { flex: 1, fontSize: 14, color: '#000000', marginTop: Platform.OS === 'android' ? 2 : 0 },
  filterContainer: { backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#C6C6C8' },
  filterList: { paddingHorizontal: 16, paddingVertical: 9, gap: 7 },
  pill: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, backgroundColor: '#EFEFF4' },
  pillActive: { backgroundColor: IOS_BLUE },
  pillText: { fontSize: 13, color: '#3C3C43', fontWeight: '500' },
  pillTextActive: { color: '#FFFFFF', fontWeight: '600' },
  infoBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#EAF3FF', marginHorizontal: 16, marginTop: 10, borderRadius: 10, padding: 10 },
  infoBannerText: { flex: 1, fontSize: 12, color: IOS_BLUE },
  list: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 140, gap: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3 },
  heroWrap: { width: '100%', backgroundColor: '#E5E5EA', position: 'relative' },
  heroImg: { width: '100%', height: '100%' },
  heroFallback: { flex: 1, backgroundColor: '#D1D1D6', justifyContent: 'center', alignItems: 'center' },
  heroInitials: { fontSize: 36, fontWeight: '700', color: '#FFFFFF' },
  scrim: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', backgroundColor: 'rgba(0,0,0,0.28)' },
  badgeRow: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 5 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: IOS_BLUE, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { color: '#fff', fontSize: 9, fontWeight: '600' },
  callPill: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FFFFFF', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 20, elevation: 3 },
  callPillText: { fontSize: 12, color: IOS_BLUE, fontWeight: '600' },
  heroFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 },
  heroName: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  heroLocRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  heroLoc: { fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  dotsRow: { position: 'absolute', bottom: 44, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotActive: { width: 14, backgroundColor: '#FFFFFF' },
  body: { padding: 14 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EAF3FF', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20 },
  tagGreen: { backgroundColor: '#EFFBF0' },
  tagText: { fontSize: 10, color: IOS_BLUE, fontWeight: '500' },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: IOS_GREEN },
  bio: { fontSize: 13, color: '#3C3C43', lineHeight: 19, marginBottom: 12 },
  actionsRow: { flexDirection: 'row', gap: 8 },
  btnPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: IOS_BLUE, borderRadius: 10, paddingVertical: 11 },
  btnWa: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#25D366', borderRadius: 10, paddingVertical: 11 },
  btnText: { fontSize: 13, color: '#FFFFFF', fontWeight: '600' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { fontSize: 14, color: IOS_GRAY },
  emptyWrap: { alignItems: 'center', marginTop: 70, paddingHorizontal: 40 },
  emptyIconRing: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#EAF3FF', justifyContent: 'center', alignItems: 'center', marginBottom: 18 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#000000', marginBottom: 6 },
  emptyBody: { fontSize: 14, color: IOS_GRAY, textAlign: 'center', lineHeight: 20 },
  viewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  viewerClose: { position: 'absolute', top: Platform.OS === 'ios' ? 58 : 28, right: 18, zIndex: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', justifyContent: 'center', alignItems: 'center' },
  viewerImg: { width: '100%', height: '82%' },
});
