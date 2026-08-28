import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Platform, TextInput,
  TouchableOpacity, ActivityIndicator, FlatList, Image, RefreshControl,
  Linking, Alert, Modal, useWindowDimensions, StatusBar, Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

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
  const headerOpacity = useRef(new Animated.Value(0)).current;

  const FILTERS = ['All', 'Harare', 'Bulawayo', 'Mutare', 'Gweru'];

  useFocusEffect(
    useCallback(() => {
      loadData();
      Animated.timing(headerOpacity, { toValue: 1, duration: 600, useNativeDriver: true }).start();
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
    const MOVER_SELECT = 'id, first_name, last_name, avatar_url, city, phone_number, business_name, bio, vehicle_details, vehicle_photos';
    try {
      let { data, error } = await supabase
        .from('profiles')
        .select(MOVER_SELECT)
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
      recipientName: mover.business_name || ${mover.first_name || ''} .trim(),
      recipientRole: 'mover',
      moverVehicle: mover.vehicle_details || null,
      moverCity: mover.city || null,
    });
  };

  const callMover = (mover) => {
    if (!mover.phone_number) { Alert.alert('No contact', 'This mover has not added a phone number yet.'); return; }
    Linking.openURL(	el:);
  };

  const whatsappMover = (mover) => {
    if (!mover.phone_number) { Alert.alert('No contact', 'This mover has not added a phone number yet.'); return; }
    Linking.openURL(https://wa.me/);
  };

  const filtered = movers.filter(m => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q ||
      (m.business_name || '').toLowerCase().includes(q) ||
      (m.first_name || '').toLowerCase().includes(q) ||
      (m.last_name || '').toLowerCase().includes(q) ||
      (m.bio || '').toLowerCase().includes(q);
    const matchesFilter = activeFilter === 'All' || (m.city || '').toLowerCase().includes(activeFilter.toLowerCase());
    return matchesSearch && matchesFilter;
  });

  // Swipeable vehicle photo gallery
  const VehicleCarousel = ({ item }) => {
    const photos = item.vehicle_photos || [];
    const [page, setPage] = useState(0);
    const cardW = width - 40;
    if (photos.length === 0) return null;
    return (
      <View style={{ flex: 1 }}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          onMomentumScrollEnd={(e) => {
            setPage(Math.round(e.nativeEvent.contentOffset.x / cardW));
          }}
          renderItem={({ item: uri }) => (
            <TouchableOpacity activeOpacity={0.92} style={{ width: cardW }} onPress={() => setViewerUri(uri)}>
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

  const renderMoverCard = ({ item, index }) => {
    const displayName = item.business_name || ${item.first_name || ''} .trim() || 'Mover';
    const vehicleType = item.vehicle_details?.type;
    const photos = item.vehicle_photos || [];
    const cardW = width - 40;
    const imgH = Math.round(cardW * 0.62);
    const isLocal = myCity && (item.city || '').toLowerCase() === myCity.toLowerCase();

    return (
      <Animated.View style={[styles.card, { opacity: headerOpacity }]}>
        {/* Hero Image / Carousel */}
        <View style={[styles.heroWrap, { height: imgH }]}>
          {photos.length > 0 ? (
            <VehicleCarousel item={item} />
          ) : item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.heroImg} />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="car" size={48} color="#C7D2FE" />
            </View>
          )}

          {/* Gradient overlay */}
          <View style={styles.heroGradient} />

          {/* Top badges row */}
          <View style={styles.topBadgesRow}>
            <View style={styles.verifiedBadge}>
              <Ionicons name="checkmark-circle" size={11} color="#FFF" />
              <Text style={styles.verifiedText}>VERIFIED</Text>
            </View>
            {isLocal && (
              <View style={styles.localBadge}>
                <Ionicons name="location" size={11} color="#FFF" />
                <Text style={styles.localBadgeText}>NEARBY</Text>
              </View>
            )}
          </View>

          {/* Call FAB */}
          {item.phone_number && (
            <TouchableOpacity style={styles.callFab} onPress={() => callMover(item)} activeOpacity={0.85}>
              <Ionicons name="call" size={18} color="#0A84FF" />
            </TouchableOpacity>
          )}

          {/* Name overlay at bottom */}
          <View style={styles.heroBottom}>
            <Text style={styles.heroName} numberOfLines={1}>{displayName}</Text>
            <View style={styles.heroMeta}>
              <Ionicons name="location-outline" size={12} color="rgba(255,255,255,0.85)" />
              <Text style={styles.heroCity} numberOfLines={1}>{item.city || 'Zimbabwe'}</Text>
            </View>
          </View>
        </View>

        {/* Card body */}
        <View style={styles.cardBody}>
          {/* Chips row */}
          <View style={styles.chipsRow}>
            {vehicleType && (
              <View style={styles.chip}>
                <Ionicons name="cube-outline" size={11} color="#6366F1" />
                <Text style={styles.chipText}>{vehicleType}</Text>
              </View>
            )}
            {item.phone_number && (
              <View style={[styles.chip, { backgroundColor: '#F0FFF4', borderColor: '#86EFAC' }]}>
                <Ionicons name="call-outline" size={11} color="#16A34A" />
                <Text style={[styles.chipText, { color: '#16A34A' }]}>Available</Text>
              </View>
            )}
          </View>

          {item.bio ? (
            <Text style={styles.bio} numberOfLines={2}>{item.bio}</Text>
          ) : null}

          {/* Action buttons */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.btnChat} onPress={() => openInbox(item)} activeOpacity={0.85}>
              <Ionicons name="chatbubble-ellipses" size={16} color="#FFF" />
              <Text style={styles.btnText}>Chat</Text>
            </TouchableOpacity>
            {item.phone_number && (
              <TouchableOpacity style={styles.btnWa} onPress={() => whatsappMover(item)} activeOpacity={0.85}>
                <Ionicons name="logo-whatsapp" size={16} color="#FFF" />
                <Text style={styles.btnText}>WhatsApp</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <Animated.View style={[styles.header, { opacity: headerOpacity }]}>
        <View>
          <Text style={styles.headerTitle}>🚚 Movers</Text>
          <Text style={styles.headerSub}>
            {loading ? 'Loading…' : ${filtered.length} mover available}
          </Text>
        </View>
        {userRole === 'mover' && (
          <TouchableOpacity style={styles.profileBtn} onPress={() => navigation.navigate('Profile')}>
            <Ionicons name="person-circle-outline" size={28} color="#6366F1" />
          </TouchableOpacity>
        )}
      </Animated.View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color="#9CA3AF" />
        <TextInput
          placeholder="Search movers, city, service…"
          placeholderTextColor="#9CA3AF"
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {/* City filter pills */}
      <View style={styles.filtersWrap}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={f => f}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
          renderItem={({ item: f }) => (
            <TouchableOpacity
              style={[styles.filterPill, activeFilter === f && styles.filterPillActive]}
              onPress={() => setActiveFilter(f)}
              activeOpacity={0.8}
            >
              <Text style={[styles.filterPillText, activeFilter === f && styles.filterPillTextActive]}>{f}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Mover info banner */}
      {userRole === 'mover' && (
        <View style={styles.moverBanner}>
          <Ionicons name="information-circle-outline" size={16} color="#6366F1" />
          <Text style={styles.moverBannerText}>Your profile is listed here. Keep it updated via Profile.</Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#6366F1" />
          <Text style={styles.loadingText}>Finding movers near you…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderMoverCard}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366F1" />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconBg}>
                <Ionicons name="car-sport-outline" size={48} color="#6366F1" />
              </View>
              <Text style={styles.emptyTitle}>No movers found</Text>
              <Text style={styles.emptySubtitle}>
                {userRole === 'mover'
                  ? 'Your profile will appear here. Make sure your profile is complete!'
                  : 'No registered movers in this area yet. Try a different filter.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Full-screen photo viewer */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUri(null)}>
            <Ionicons name="close" size={26} color="#FFF" />
          </TouchableOpacity>
          {viewerUri && (
            <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FF' },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
  },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 26, color: '#111827', letterSpacing: -0.3 },
  headerSub: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#6B7280', marginTop: 1 },
  profileBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center', alignItems: 'center',
  },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF',
    marginHorizontal: 20, marginTop: 12, marginBottom: 10,
    borderRadius: 16, paddingHorizontal: 14, height: 48,
    shadowColor: '#6366F1', shadowOpacity: 0.07, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 3, gap: 10,
  },
  searchInput: {
    flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 14,
    color: '#111827', marginTop: Platform.OS === 'android' ? 3 : 0,
  },

  // City filter pills
  filtersWrap: { marginBottom: 10 },
  filterPill: {
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 20, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E5E7EB',
  },
  filterPillActive: { backgroundColor: '#6366F1', borderColor: '#6366F1' },
  filterPillText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#6B7280' },
  filterPillTextActive: { color: '#FFFFFF', fontFamily: 'Poppins_600SemiBold' },

  // Mover banner
  moverBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EEF2FF',
    marginHorizontal: 20, marginBottom: 10,
    borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: '#C7D2FE',
  },
  moverBannerText: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#6366F1' },

  // List
  list: { paddingHorizontal: 20, paddingBottom: 140, paddingTop: 4, gap: 16 },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    shadowColor: '#6366F1', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    overflow: 'hidden',
  },

  // Hero image
  heroWrap: { width: '100%', backgroundColor: '#EEF2FF', position: 'relative', overflow: 'hidden' },
  heroImg: { width: '100%', height: '100%' },
  heroPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#EEF2FF' },
  heroGradient: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%',
    backgroundColor: 'rgba(0,0,0,0)',
    // Simulated gradient via opacity layering
    borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
  },

  // Top badges
  topBadgesRow: {
    position: 'absolute', top: 12, left: 12, right: 12,
    flexDirection: 'row', gap: 6, zIndex: 3,
  },
  verifiedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#0A84FF', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20,
  },
  verifiedText: { color: '#FFF', fontFamily: 'Poppins_700Bold', fontSize: 9, letterSpacing: 0.8 },
  localBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#10B981', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20,
  },
  localBadgeText: { color: '#FFF', fontFamily: 'Poppins_700Bold', fontSize: 9, letterSpacing: 0.8 },

  // Call FAB
  callFab: {
    position: 'absolute', top: 12, right: 12,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, elevation: 5, zIndex: 3,
  },

  // Name overlay
  heroBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 14, backgroundColor: 'rgba(0,0,0,0.42)', zIndex: 2,
  },
  heroName: { color: '#FFF', fontFamily: 'Poppins_700Bold', fontSize: 17 },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  heroCity: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Poppins_400Regular', fontSize: 12, flexShrink: 1 },

  // Dots
  dotsRow: {
    position: 'absolute', bottom: 56, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, zIndex: 2,
  },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { width: 14, backgroundColor: '#FFFFFF' },

  // Card body
  cardBody: { padding: 14 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#EEF2FF', borderWidth: 1, borderColor: '#C7D2FE',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20,
  },
  chipText: { fontFamily: 'Poppins_500Medium', fontSize: 10, color: '#6366F1' },
  bio: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#4B5563', lineHeight: 19, marginBottom: 12 },

  // Action buttons
  actionsRow: { flexDirection: 'row', gap: 10 },
  btnChat: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#6366F1', borderRadius: 14, paddingVertical: 12,
    shadowColor: '#6366F1', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  btnWa: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#25D366', borderRadius: 14, paddingVertical: 12,
    shadowColor: '#25D366', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  btnText: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 13, letterSpacing: 0.2 },

  // Loading
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#6B7280' },

  // Empty state
  emptyWrap: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyIconBg: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: '#EEF2FF',
    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
  },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 20, color: '#111827' },
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#6B7280', marginTop: 6, textAlign: 'center' },

  // Full-screen viewer
  viewerOverlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  viewerClose: {
    position: 'absolute', top: Platform.OS === 'ios' ? 60 : 30, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  viewerImage: { width: '100%', height: '80%' },
});
