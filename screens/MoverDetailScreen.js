import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Image, FlatList, Modal
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

export default function MoverDetailScreen({ route, navigation }) {
  const { mover } = route.params;
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [userRole, setUserRole] = useState('tenant');
  const [vehiclePhotos, setVehiclePhotos] = useState(mover.vehicle_photos || []);
  const [vehicleDetails, setVehicleDetails] = useState(mover.vehicle_details || null);
  const [viewerUri, setViewerUri] = useState(null);

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUserId(user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();
        if (profile) setUserRole(profile.role);
      }
      fetchVehicleData();
      fetchReviews();
    } catch (e) {
      console.log('MoverDetail init error', e);
      setLoading(false);
    }
  };

  const fetchVehicleData = async () => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('vehicle_details, vehicle_photos')
        .eq('id', mover.id)
        .maybeSingle();
      if (data) {
        if ((data.vehicle_photos || []).length > 0) setVehiclePhotos(data.vehicle_photos);
        if (data.vehicle_details && Object.keys(data.vehicle_details).length > 0) {
          setVehicleDetails(data.vehicle_details);
        }
      }
    } catch (e) {
      console.log('fetchVehicleData error', e);
    }
  };

  const fetchReviews = async () => {
    try {
      const { data, error } = await supabase
        .from('mover_reviews')
        .select(`
          id, rating, comment, created_at,
          reviewer:profiles!reviewer_id(first_name, last_name, avatar_url)
        `)
        .eq('mover_id', mover.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (!error) setReviews(data || []);
    } catch (e) {
      console.log('fetchReviews error', e);
    } finally {
      setLoading(false);
    }
  };

  const renderStars = (rating, size = 14) => {
    const stars = [];
    const full = Math.floor(rating || 0);
    for (let i = 0; i < 5; i++) {
      stars.push(
        <Ionicons key={i} name={i < full ? 'star' : 'star-outline'} size={size} color="#FFB800" />
      );
    }
    return stars;
  };

  const canBook = userRole !== 'mover';

  return (
    <View style={styles.container}>
      {/* Nav bar */}
      <View style={styles.navBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#000" />
        </TouchableOpacity>
        <Text style={styles.navTitle}>Mover Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero card */}
        <View style={styles.heroCard}>
          <View style={styles.heroAvatar}>
            {mover.avatar_url ? (
              <Image source={{ uri: mover.avatar_url }} style={styles.heroAvatarImg} />
            ) : (
              <View style={styles.heroAvatarPlaceholder}>
                <Ionicons name="cube" size={36} color="#0A84FF" />
              </View>
            )}
            {mover.is_verified && (
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={20} color="#30D158" />
              </View>
            )}
          </View>
          <Text style={styles.heroName}>{mover.company_name}</Text>
          <View style={styles.heroLocationRow}>
            <Ionicons name="map-outline" size={14} color="#8E8E93" />
            <Text style={styles.heroLocation}>{mover.city}</Text>
          </View>
          <View style={styles.heroStarsRow}>
            {renderStars(mover.rating, 16)}
            <Text style={styles.heroRating}>
              {mover.rating ? mover.rating.toFixed(1) : '—'} · {mover.total_reviews || 0} reviews
            </Text>
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{mover.total_jobs || 0}</Text>
            <Text style={styles.statLabel}>Jobs Done</Text>
          </View>
          <View style={[styles.statBox, styles.statBoxBorder]}>
            <Text style={styles.statValue}>${mover.base_price_usd || '—'}</Text>
            <Text style={styles.statLabel}>Starting Price</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{mover.is_verified ? 'Yes' : 'No'}</Text>
            <Text style={styles.statLabel}>Verified</Text>
          </View>
        </View>

        {/* About */}
        {mover.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>{mover.description}</Text>
          </View>
        ) : null}

        {/* Vehicles */}
        {(mover.vehicle_types || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fleet</Text>
            <View style={styles.chipsRow}>
              {mover.vehicle_types.map((v, i) => (
                <View key={i} style={styles.chip}>
                  <Ionicons name="car-outline" size={13} color="#0A84FF" />
                  <Text style={styles.chipText}>{v}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Vehicle Gallery (Instagram style grid) */}
        {vehiclePhotos.length > 0 && (
          <View style={styles.section}>
            <View style={styles.galleryHeaderRow}>
              <Text style={styles.sectionTitle}>Vehicle Gallery</Text>
              <Text style={styles.galleryCount}>{vehiclePhotos.length} photos</Text>
            </View>

            {vehicleDetails?.type ? (
              <View style={styles.chipsRow}>
                <View style={styles.chip}>
                  <Ionicons name="car-sport-outline" size={13} color="#0A84FF" />
                  <Text style={styles.chipText}>
                    {[vehicleDetails.type, vehicleDetails.model].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {vehicleDetails.registration ? (
                  <View style={[styles.chip, styles.chipGrey]}>
                    <Text style={[styles.chipText, { color: '#3C3C43' }]}>{vehicleDetails.registration}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.photoGrid}>
              {vehiclePhotos.map((uri, i) => (
                <TouchableOpacity
                  key={i}
                  style={styles.photoTile}
                  activeOpacity={0.85}
                  onPress={() => setViewerUri(uri)}
                >
                  <Image source={{ uri }} style={styles.photoTileImg} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Service areas */}
        {(mover.service_areas || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Service Areas</Text>
            <View style={styles.chipsRow}>
              {mover.service_areas.map((area, i) => (
                <View key={i} style={[styles.chip, styles.chipGrey]}>
                  <Ionicons name="map-outline" size={13} color="#8E8E93" />
                  <Text style={[styles.chipText, { color: '#3C3C43' }]}>{area}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Reviews */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reviews</Text>
          {loading ? (
            <ActivityIndicator size="small" color="#0A84FF" style={{ marginTop: 12 }} />
          ) : reviews.length === 0 ? (
            <Text style={styles.noReviews}>No reviews yet.</Text>
          ) : (
            reviews.map(r => (
              <View key={r.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <View style={styles.reviewAvatar}>
                    {r.reviewer?.avatar_url ? (
                      <Image source={{ uri: r.reviewer.avatar_url }} style={styles.reviewAvatarImg} />
                    ) : (
                      <Ionicons name="person" size={16} color="#FFF" />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewerName}>
                      {r.reviewer ? `${r.reviewer.first_name || ''} ${r.reviewer.last_name || ''}`.trim() : 'Anonymous'}
                    </Text>
                    <View style={styles.reviewStars}>
                      {renderStars(r.rating, 12)}
                    </View>
                  </View>
                  <Text style={styles.reviewDate}>
                    {new Date(r.created_at).toLocaleDateString()}
                  </Text>
                </View>
                {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
              </View>
            ))
          )}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Book CTA */}
      {canBook && (
        <View style={styles.ctaWrap}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ctaFrom}>Starting from</Text>
            <Text style={styles.ctaPrice}>${mover.base_price_usd || '—'}</Text>
          </View>
          <TouchableOpacity
            style={styles.bookBtn}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('BookMover', { mover })}
          >
            <Text style={styles.bookBtnText}>Book Now</Text>
          </TouchableOpacity>
        </View>
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
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center',
  },
  navTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: '#000' },

  scroll: { paddingBottom: 40 },

  heroCard: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20 },
  heroAvatar: { position: 'relative', marginBottom: 14 },
  heroAvatarImg: { width: 90, height: 90, borderRadius: 22 },
  heroAvatarPlaceholder: {
    width: 90, height: 90, borderRadius: 22,
    backgroundColor: '#EBF4FF', justifyContent: 'center', alignItems: 'center',
  },
  verifiedBadge: {
    position: 'absolute', bottom: -4, right: -4,
    backgroundColor: '#FFF', borderRadius: 12,
  },
  heroName: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#000', marginBottom: 4 },
  heroLocationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  heroLocation: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', marginLeft: 3 },
  heroStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroRating: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#3C3C43', marginLeft: 6 },

  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 20, marginBottom: 8,
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
    overflow: 'hidden',
  },
  statBox: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statBoxBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  statValue: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#000' },
  statLabel: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#8E8E93', marginTop: 2 },

  section: { paddingHorizontal: 20, marginTop: 20 },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000', marginBottom: 10 },
  description: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#3C3C43', lineHeight: 22 },
  noReviews: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93' },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#EBF4FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
  },
  chipGrey: { backgroundColor: '#F2F2F7' },
  chipText: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: '#0A84FF' },

  // Vehicle Gallery (Instagram style)
  galleryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  galleryCount: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    marginHorizontal: -1.5,
  },
  photoTile: {
    width: '33.33%',
    aspectRatio: 1,
    padding: 1.5,
  },
  photoTileImg: {
    width: '100%',
    height: '100%',
    backgroundColor: '#F2F2F7',
    borderRadius: 2,
  },

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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerImage: { width: '100%', height: '80%' },

  reviewCard: {
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
    borderRadius: 14, padding: 14, marginBottom: 10,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  reviewAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#A0A0A0', justifyContent: 'center', alignItems: 'center',
    marginRight: 10, overflow: 'hidden',
  },
  reviewAvatarImg: { width: '100%', height: '100%' },
  reviewerName: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#000' },
  reviewStars: { flexDirection: 'row', gap: 2, marginTop: 2 },
  reviewDate: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#8E8E93' },
  reviewComment: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#3C3C43', lineHeight: 20 },

  ctaWrap: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: '#FFF',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  ctaFrom: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#8E8E93' },
  ctaPrice: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#000' },
  bookBtn: {
    backgroundColor: '#0A84FF', paddingHorizontal: 32, paddingVertical: 14,
    borderRadius: 14,
  },
  bookBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FFF' },
});
