import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Platform, TextInput,
  TouchableOpacity, ActivityIndicator, FlatList, Image, RefreshControl,
  Linking, Alert, Modal, useWindowDimensions, StatusBar, Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

const LINKEDIN_BLUE = '#0A66C2';
const IOS_GRAY = '#8E8E93';
const BG_COLOR = '#F3F2EF';

export default function MoversListScreen({ navigation }) {
  const [movers, setMovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
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
          .select('id, role, city, avatar_url, first_name, last_name')
          .eq('id', user.id)
          .single();
        if (profile) {
          setCurrentUserProfile(profile);
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
    if (!photos.length) return null;
    return (
      <View style={styles.mediaContainer}>
        <Text style={styles.mediaLabel}>Fleet & Equipment</Text>
        <FlatList
          data={photos}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={{ gap: 8 }}
          renderItem={({ item: uri }) => (
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.mediaThumbWrap}
              onPress={() => setViewerUri(uri)}
            >
              <Image source={{ uri }} style={styles.mediaThumb} />
            </TouchableOpacity>
          )}
        />
      </View>
    );
  };

  const renderCard = ({ item }) => {
    const name = `${item.first_name || ''} ${item.last_name || ''}`.trim() || item.business_name || 'Professional Mover';
    const company = item.business_name || 'Relocation & Logistics';
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'M';
    const isNearby = myCity && (item.city || '').toLowerCase() === myCity.toLowerCase();

    return (
      <Animated.View style={[styles.linkedInCard, { opacity: fadeIn }]}>
        {/* LinkedIn-style Top Cover Banner */}
        <View style={styles.coverBanner}>
          <View style={styles.coverPattern} />
          {isNearby && (
            <View style={styles.nearbyBadge}>
              <Ionicons name="location" size={11} color="#FFFFFF" />
              <Text style={styles.nearbyBadgeText}>Nearby</Text>
            </View>
          )}
        </View>

        {/* Profile Info Header */}
        <View style={styles.cardHeaderArea}>
          <View style={styles.avatarRow}>
            {/* Avatar overlapping banner */}
            <View style={styles.avatarWrap}>
              {item.avatar_url ? (
                <Image source={{ uri: item.avatar_url }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatarInitialsBg}>
                  <Text style={styles.avatarInitialsText}>{initials}</Text>
                </View>
              )}
            </View>

            {/* Quick Call Button on right */}
            {item.phone_number && (
              <TouchableOpacity style={styles.quickCallBtn} onPress={() => callMover(item)} activeOpacity={0.8}>
                <Ionicons name="call-outline" size={16} color={LINKEDIN_BLUE} />
              </TouchableOpacity>
            )}
          </View>

          {/* Member Name & Headline */}
          <View style={styles.nameBlock}>
            <View style={styles.nameRow}>
              <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
              <Ionicons name="checkmark-circle" size={16} color={LINKEDIN_BLUE} style={{ marginLeft: 4 }} />
            </View>
            <Text style={styles.headlineText} numberOfLines={1}>
              {company} • Moving & Relocation
            </Text>
            <View style={styles.locationMeta}>
              <Ionicons name="location-outline" size={12} color="#666666" />
              <Text style={styles.locationText}>{item.city || 'Zimbabwe'}</Text>
            </View>
          </View>

          {/* Bio / About */}
          {item.bio ? (
            <Text style={styles.bioText} numberOfLines={3}>
              {item.bio}
            </Text>
          ) : null}

          {/* Media / Photos Strip */}
          <PhotoStrip item={item} />

          {/* LinkedIn-style Action Buttons */}
          <View style={styles.cardActions}>
            <TouchableOpacity 
              style={styles.messageBtn} 
              onPress={() => openInbox(item)} 
              activeOpacity={0.85}
            >
              <Ionicons name="paper-plane" size={14} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.messageBtnText}>Message</Text>
            </TouchableOpacity>

            {item.phone_number && (
              <TouchableOpacity 
                style={styles.whatsappBtn} 
                onPress={() => whatsappMover(item)} 
                activeOpacity={0.85}
              >
                <Ionicons name="logo-whatsapp" size={15} color="#057642" style={{ marginRight: 6 }} />
                <Text style={styles.whatsappBtnText}>WhatsApp</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Animated.View>
    );
  };

  const userAvatar = currentUserProfile?.avatar_url;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Movers</Text>
          <Text style={styles.headerSub}>
            {loading ? 'Finding movers…' : `${filtered.length} verified mover${filtered.length !== 1 ? 's' : ''}`}
          </Text>
        </View>

        {/* Profile Avatar Button (Shows for all users) */}
        <TouchableOpacity 
          style={styles.profileBtn} 
          onPress={() => navigation.navigate('Profile')}
          activeOpacity={0.8}
        >
          {userAvatar ? (
            <Image source={{ uri: userAvatar }} style={styles.headerAvatarImg} />
          ) : (
            <Ionicons name="person-circle-outline" size={32} color={LINKEDIN_BLUE} />
          )}
        </TouchableOpacity>
      </View>

      {/* Search Section */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#8E8E93" />
          <TextInput
            placeholder="Search movers by name, city, or service"
            placeholderTextColor="#8E8E93"
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4, marginRight: 4 }}>
              <Ionicons name="close-circle" size={18} color="#8E8E93" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.searchBtn} onPress={() => {}}>
            <Ionicons name="search" size={18} color="#FFFFFF" />
          </TouchableOpacity>
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
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={LINKEDIN_BLUE} />
          <Text style={styles.loadingText}>Finding verified movers near you…</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderCard}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={LINKEDIN_BLUE} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconRing}>
                <Ionicons name="people-outline" size={40} color={LINKEDIN_BLUE} />
              </View>
              <Text style={styles.emptyTitle}>No Movers Found</Text>
              <Text style={styles.emptyBody}>
                No verified movers found for this location. Try choosing All Cities.
              </Text>
            </View>
          }
        />
      )}

      {/* Photo viewer */}
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={styles.viewer}>
          <TouchableOpacity style={styles.viewerClose} onPress={() => setViewerUri(null)}>
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          {viewerUri && <Image source={{ uri: viewerUri }} style={styles.viewerImg} resizeMode="contain" />}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG_COLOR },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 58 : 42,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '700',
    color: '#000000',
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 12,
    color: '#666666',
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
    borderWidth: 1.5,
    borderColor: LINKEDIN_BLUE,
  },

  searchSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    height: 52,
    borderRadius: 26,
    paddingLeft: 16,
    paddingRight: 6,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 14,
    color: '#1A1A1A',
  },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: LINKEDIN_BLUE,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: LINKEDIN_BLUE,
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },

  filterContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
  },
  filterList: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#666666',
  },
  pillActive: {
    backgroundColor: LINKEDIN_BLUE,
    borderColor: LINKEDIN_BLUE,
  },
  pillText: {
    fontSize: 13,
    color: '#666666',
    fontWeight: '600',
  },
  pillTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  list: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 120, gap: 10 },

  // LinkedIn-style Card
  linkedInCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E0E0E0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  coverBanner: {
    height: 60,
    backgroundColor: '#DCE6F1',
    position: 'relative',
    justifyContent: 'center',
  },
  coverPattern: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A66C2',
    opacity: 0.15,
  },
  nearbyBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#057642',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 3,
  },
  nearbyBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },

  cardHeaderArea: {
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  avatarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: -32,
    marginBottom: 8,
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitialsBg: {
    flex: 1,
    backgroundColor: '#DCE6F1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitialsText: {
    fontSize: 22,
    fontWeight: '700',
    color: LINKEDIN_BLUE,
  },
  quickCallBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: LINKEDIN_BLUE,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },

  nameBlock: { marginBottom: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  memberName: {
    fontSize: 17,
    fontWeight: '700',
    color: '#000000',
  },
  headlineText: {
    fontSize: 13,
    color: '#333333',
    fontWeight: '400',
    marginTop: 2,
  },
  locationMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: 3,
  },
  locationText: {
    fontSize: 12,
    color: '#666666',
  },

  bioText: {
    fontSize: 13,
    color: '#444444',
    lineHeight: 18,
    marginBottom: 10,
  },

  // Media
  mediaContainer: {
    marginBottom: 12,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EBEBEB',
  },
  mediaLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666666',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mediaThumbWrap: {
    width: 90,
    height: 65,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#EAEAEA',
  },
  mediaThumb: { width: '100%', height: '100%' },

  // Actions
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EBEBEB',
  },
  messageBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LINKEDIN_BLUE,
    paddingVertical: 9,
    borderRadius: 20,
  },
  messageBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  whatsappBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#057642',
    paddingVertical: 8,
    borderRadius: 20,
  },
  whatsappBtnText: {
    color: '#057642',
    fontSize: 14,
    fontWeight: '600',
  },

  // Loading
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 60 },
  loadingText: { fontSize: 14, color: '#666666' },

  // Empty
  emptyWrap: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyIconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EDF3F8',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000000', marginBottom: 6 },
  emptyBody: { fontSize: 14, color: '#666666', textAlign: 'center', lineHeight: 20 },

  viewer: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  viewerClose: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 58 : 28,
    right: 18,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImg: { width: '100%', height: '80%' },
});
