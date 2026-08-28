import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView, TextInput,
  TouchableOpacity, ActivityIndicator, FlatList, Image, RefreshControl, Linking, Alert, Modal,
  useWindowDimensions
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

export default function MoversListScreen({ navigation }) {
  const [movers, setMovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState('tenant');
  const [myCity, setMyCity] = useState('');
  const [viewerUri, setViewerUri] = useState(null);
  const { width } = useWindowDimensions();
  const cardWidth = width - 40;
  const imageHeight = Math.round(cardWidth * 0.72);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [])
  );

  const shuffle = (arr) => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(p => p[1]);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser(user);
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

  // Pull movers from profiles table — anyone who registered as "mover"
  // Movers in the current user's city are shuffled to the top
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
        const local = [];
        const others = [];
        list.forEach(m => {
          if ((m.city || '').toLowerCase() === myCity.toLowerCase()) local.push(m);
          else others.push(m);
        });
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

  const onRefresh = () => {
    setRefreshing(true);
    fetchMovers();
  };

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
    if (!mover.phone_number) {
      Alert.alert('No contact number', 'This mover has not added a phone number yet.');
      return;
    }
    Linking.openURL(`tel:${mover.phone_number}`);
  };

  const whatsappMover = (mover) => {
    if (!mover.phone_number) {
      Alert.alert('No contact number', 'This mover has not added a phone number yet.');
      return;
    }
    Linking.openURL(`https://wa.me/${mover.phone_number.replace(/\D/g, '')}`);
  };

  const filtered = movers.filter(m => {
    const q = searchQuery.toLowerCase();
    return !q ||
      (m.business_name || '').toLowerCase().includes(q) ||
      (m.first_name || '').toLowerCase().includes(q) ||
      (m.last_name || '').toLowerCase().includes(q) ||
      (m.bio || '').toLowerCase().includes(q);
  });

  // Shein-style swipeable hero gallery (full-bleed)
  const VehicleCarousel = ({ item }) => {
    const photos = item.vehicle_photos || [];
    const [page, setPage] = useState(0);
    if (photos.length === 0) return null;

    return (
      <View style={styles.carouselWrap}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          snapToInterval={cardWidth}
          decelerationRate="fast"
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
            setPage(Math.min(Math.max(idx, 0), photos.length - 1));
          }}
        >
          {photos.map((uri, i) => (
            <TouchableOpacity
              key={`${item.id}-${i}`}
              activeOpacity={0.9}
              style={{ width: cardWidth }}
              onPress={() => setViewerUri(uri)}
            >
              <Image
                source={{ uri }}
                style={{ width: cardWidth, height: '100%', backgroundColor: '#EAF3FF' }}
              />
            </TouchableOpacity>
          ))}
        </ScrollView>

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

  const renderMoverCard = ({ item }) => {
    const displayName = item.business_name || `${item.first_name || ''} ${item.last_name || ''}`.trim();
    const initials = displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const vehicleType = item.vehicle_details?.type;
    const photos = item.vehicle_photos || [];

    return (
      <View style={styles.card}>
        <View style={[styles.imageContainer, { height: imageHeight }]}>
          {photos.length > 0 ? (
            <VehicleCarousel item={item} />
          ) : item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.heroImage} />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="cube" size={40} color="#0A84FF" />
            </View>
          )}

          {/* Verified badge (top-left) */}
          <View style={styles.verifiedBadge}>
            <Ionicons name="checkmark-circle" size={12} color="#FFFFFF" />
            <Text style={styles.verifiedBadgeText}>VERIFIED</Text>
          </View>

          {/* Call button (top-right) */}
          {item.phone_number ? (
            <TouchableOpacity style={styles.callBadge} onPress={() => callMover(item)} activeOpacity={0.8}>
              <Ionicons name="call" size={16} color="#0A84FF" />
            </TouchableOpacity>
          ) : null}

          {/* Bottom gradient overlay with name */}
          <View style={styles.imageOverlay}>
            <Text style={styles.overlayName} numberOfLines={1}>{displayName}</Text>
            <View style={styles.overlayMetaRow}>
              <Ionicons name="location" size={12} color="#FFFFFF" />
              <Text style={styles.overlayMeta} numberOfLines={1}>{item.city || 'Zimbabwe'}</Text>
            </View>
          </View>
        </View>

        <View style={styles.info}>
          {vehicleType ? (
            <View style={styles.vehicleChip}>
              <Ionicons name="cube" size={11} color="#0A84FF" />
              <Text style={styles.vehicleChipText}>{vehicleType}</Text>
            </View>
          ) : null}

          {item.bio ? (
            <Text style={styles.postText} numberOfLines={2}>{item.bio}</Text>
          ) : null}

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.chatAction} onPress={() => openInbox(item)} activeOpacity={0.8}>
              <Ionicons name="chatbubble-ellipses" size={16} color="#FFFFFF" />
              <Text style={styles.actionText}>Chat</Text>
            </TouchableOpacity>
            {item.phone_number ? (
              <TouchableOpacity style={styles.waAction} onPress={() => whatsappMover(item)} activeOpacity={0.8}>
                <Ionicons name="logo-whatsapp" size={16} color="#FFFFFF" />
                <Text style={styles.actionText}>WhatsApp</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Movers</Text>
          <Text style={styles.headerSub}>{filtered.length} available near you</Text>
        </View>
        {userRole === 'mover' && (
          <TouchableOpacity
            style={styles.editProfileBtn}
            onPress={() => navigation.navigate('Profile')}
          >
            <Ionicons name="person-circle-outline" size={26} color="#0A84FF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Search */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#A0A0A0" style={styles.searchIcon} />
        <TextInput
          placeholder="Search by name or service…"
          placeholderTextColor="#A0A0A0"
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color="#A0A0A0" />
          </TouchableOpacity>
        )}
      </View>

      {/* Mover sign up banner for logged-in movers */}
      {userRole === 'mover' && (
        <View style={styles.moverBanner}>
          <Ionicons
            name="information-circle-outline"
            size={16}
            color="#0A84FF"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.moverBannerText}>
            Your profile is listed here. Update it via your Profile page.
          </Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderMoverCard}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0A84FF" />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="cube-outline" size={60} color="#D1D1D6" />
              <Text style={styles.emptyTitle}>No movers yet</Text>
              <Text style={styles.emptySubtitle}>
                {userRole === 'mover'
                  ? 'Be the first! Your profile is visible to tenants.'
                  : 'No registered movers yet. Check back soon.'}
              </Text>
            </View>
          }
        />
      )}

      {/* Full-screen photo viewer */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewerOverlay}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUri(null)}>
            <Ionicons name="close" size={30} color="#FFF" />
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
  container: { flex: 1, backgroundColor: '#FAF8FF' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 28, color: '#1A1A1A' },
  headerSub: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', marginTop: 1 },
  editProfileBtn: { padding: 4 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', height: 50, borderRadius: 24,
    marginHorizontal: 20, paddingHorizontal: 16, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
  },
  searchIcon: { marginRight: 8, color: '#8E8E93' },
  searchInput: {
    flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 14,
    color: '#1A1A1A', marginTop: Platform.OS === 'android' ? 4 : 0,
  },

  moverBanner: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EAF3FF', marginHorizontal: 20, marginBottom: 10,
    borderRadius: 16, padding: 12,
  },
  moverBannerText: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 12, color: "#0A84FF" },

  list: { paddingHorizontal: 20, paddingBottom: 140, gap: 12, paddingTop: 8 },

  // Shein-style movers card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    overflow: 'hidden',
  },
  imageContainer: {
    width: '100%',
    position: 'relative',
    backgroundColor: '#EAF3FF',
  },
  heroImage: { width: '100%', height: '100%', backgroundColor: '#EAF3FF' },
  heroPlaceholder: { width: '100%', height: '100%', backgroundColor: '#EAF3FF', justifyContent: 'center', alignItems: 'center' },
  carouselWrap: { flex: 1, width: '100%' },

  dotsRow: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.6)', marginHorizontal: 3 },
  dotActive: { backgroundColor: '#FFFFFF', width: 14 },

  verifiedBadge: {
    position: 'absolute',
    top: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#0A84FF',
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 20,
    zIndex: 2,
  },
  verifiedBadgeText: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 9, letterSpacing: 1 },

  callBadge: {
    position: 'absolute',
    top: 12, right: 12,
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#EAF3FF',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 2,
    shadowColor: '#0A84FF', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },

  imageOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    padding: 14,
    backgroundColor: 'rgba(0,0,0,0.35)',
    zIndex: 1,
  },
  overlayName: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 16 },
  overlayMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  overlayMeta: { color: '#FFFFFF', fontFamily: 'Poppins_400Regular', fontSize: 12, marginLeft: 4, flex: 1 },

  info: { padding: 14 },
  vehicleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#DCEBFF',
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 4,
    marginBottom: 8,
  },
  vehicleChipText: { fontFamily: 'Poppins_500Medium', fontSize: 10, color: '#0A84FF' },

  postText: {
    fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#4A4A4A',
    lineHeight: 17, marginBottom: 10,
  },

  actionRow: { flexDirection: 'row', gap: 10, paddingTop: 2 },
  chatAction: {
    flex: 1, flexDirection: 'row', backgroundColor: '#0A84FF',
    borderRadius: 22, paddingVertical: 11, justifyContent: 'center', alignItems: 'center', gap: 6,
    shadowColor: '#0A84FF', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  waAction: {
    flex: 1, flexDirection: 'row', backgroundColor: '#25D366',
    borderRadius: 22, paddingVertical: 11, justifyContent: 'center', alignItems: 'center', gap: 6,
    shadowColor: '#25D366', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  actionText: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 13, letterSpacing: 0.3 },

  // Full-screen viewer
  viewerOverlay: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 30,
    right: 20,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: { width: '100%', height: '80%' },

  emptyWrap: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 20, color: '#1A1A1A', marginTop: 16 },
  emptySubtitle: {
    fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93',
    marginTop: 6, textAlign: 'center',
  },
});
