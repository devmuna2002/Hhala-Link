import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, Modal, StatusBar, Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';

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

export default function MoverDetailScreen({ route, navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
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
      const user = await getSessionUser();
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
        <Ionicons key={i} name="star" size={size} color={i < full ? "#F59E0B" : "#D1D1D6"} />
      );
    }
    return stars;
  };

  const canBook = userRole !== 'mover';

  // Default rating for all movers is 2 until real reviews land
  const effectiveRating = mover.rating ? Number(mover.rating) : 2;

  const displayName = `${mover.first_name || ''} ${mover.last_name || ''}`.trim()
    || mover.business_name || mover.company_name || 'Mover';
  const business = mover.business_name || mover.company_name || '';
  const showBusiness = business && business !== displayName;
  const initials = displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'M';
  const vehicleLabel = formatVehicle(vehicleDetails);
  const recipientName = showBusiness ? business : displayName;

  const goBook = () => {
    navigation.navigate('BookMover', {
      mover: { ...mover, company_name: mover.business_name || mover.company_name },
    });
  };

  const goMessage = () => {
    navigation.navigate('ChatRoom', {
      participantB: mover.id,
      recipientName,
      recipientRole: 'mover',
      moverVehicle: typeof vehicleDetails === 'string' ? vehicleDetails : null,
      moverCity: mover.city || null,
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={t.statusBar} backgroundColor={t.bg} />

      {/* Nav — plain chevron, no title bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color={t.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Threads-style profile header */}
        <View style={styles.profileHead}>
          <View style={styles.nameAvatarRow}>
            <View style={styles.nameBlock}>
              <Text style={styles.name}>{displayName}</Text>
              {showBusiness ? (
                <Text style={styles.business}>{business}</Text>
              ) : null}
              <Text style={styles.city}>
                {(mover.city || 'Zimbabwe').trim() || 'Zimbabwe'}
              </Text>
            </View>
            <View style={styles.avatarWrap}>
              {mover.avatar_url ? (
                <Image source={{ uri: mover.avatar_url }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitials}>{initials}</Text>
                </View>
              )}
            </View>
          </View>

          {mover.description ? (
            <Text style={styles.bio}>{mover.description}</Text>
          ) : null}

          <View style={styles.ratingRow}>
            {renderStars(effectiveRating, 14)}
            <Text style={styles.ratingText}>
              {effectiveRating.toFixed(1)} · {mover.total_reviews || 0} reviews
            </Text>
          </View>

          {/* Threads-style action row */}
          <View style={styles.actionRow}>
            {canBook ? (
              <TouchableOpacity style={styles.requestBtn} activeOpacity={0.8} onPress={goBook}>
                <Text style={styles.requestBtnText}>Request</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.messageBtn} activeOpacity={0.8} onPress={goMessage}>
              <Text style={styles.messageBtnText}>Message</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Vehicle */}
        {vehicleLabel ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Vehicle</Text>
            <View style={styles.pillRow}>
              <View style={styles.pill}>
                <Ionicons name="car" size={14} color={t.text} />
                <Text style={styles.pillText}>{vehicleLabel}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Fleet */}
        {(mover.vehicle_types || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Fleet</Text>
            <View style={styles.pillRow}>
              {mover.vehicle_types.map((v, i) => (
                <View key={i} style={styles.pill}>
                  <Text style={styles.pillText}>{v}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Vehicle photos */}
        {vehiclePhotos.length > 0 && (
          <View style={styles.section}>
            <View style={styles.galleryHeaderRow}>
              <Text style={styles.sectionTitle}>Photos</Text>
              <Text style={styles.galleryCount}>{vehiclePhotos.length}</Text>
            </View>
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
            <View style={styles.pillRow}>
              {mover.service_areas.map((area, i) => (
                <View key={i} style={styles.pill}>
                  <Text style={styles.pillText}>{area}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Reviews — flat activity rows */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reviews</Text>
          {loading ? (
            <ActivityIndicator size="small" color="#111111" style={{ marginTop: 12 }} />
          ) : reviews.length === 0 ? (
            <Text style={styles.noReviews}>No reviews yet.</Text>
          ) : (
            reviews.map(r => (
              <View key={r.id} style={styles.reviewRow}>
                <View style={styles.reviewAvatar}>
                  {r.reviewer?.avatar_url ? (
                    <Image source={{ uri: r.reviewer.avatar_url }} style={styles.reviewAvatarImg} />
                  ) : (
                    <Ionicons name="person" size={16} color="#8A8A8A" />
                  )}
                </View>
                <View style={styles.reviewMain}>
                  <View style={styles.reviewTopRow}>
                    <Text style={styles.reviewerName} numberOfLines={1}>
                      {r.reviewer ? `${r.reviewer.first_name || ''} ${r.reviewer.last_name || ''}`.trim() : 'Anonymous'}
                    </Text>
                    <Text style={styles.reviewDate}>
                      {new Date(r.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <View style={styles.reviewStars}>
                    {renderStars(r.rating, 12)}
                  </View>
                  {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
                </View>
              </View>
            ))
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

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

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  navBar: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },

  scroll: { paddingBottom: 40 },

  profileHead: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  nameAvatarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  nameBlock: { flex: 1, paddingRight: 12 },
  name: {
    fontSize: 22,
    fontFamily: SYS_MED,
    color: t.text,
  },
  business: {
    fontSize: 15,
    fontFamily: SYS,
    color: t.sub,
    marginTop: 1,
  },
  city: {
    fontSize: 14,
    fontFamily: SYS,
    color: t.sub,
    marginTop: 2,
  },
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
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
    fontSize: 24,
    fontFamily: SYS_MED,
    color: t.text,
  },
  bio: {
    fontSize: 15,
    fontFamily: SYS,
    color: t.text,
    lineHeight: 21,
    marginTop: 10,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  ratingText: {
    fontSize: 13,
    fontFamily: SYS,
    color: t.sub,
    marginLeft: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  requestBtn: {
    flex: 1,
    backgroundColor: '#111111',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  requestBtnText: {
    fontSize: 15,
    fontFamily: SYS_MED,
    color: '#FFFFFF',
  },
  messageBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: t.hairline,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  messageBtnText: {
    fontSize: 15,
    fontFamily: SYS_MED,
    color: t.text,
  },

  section: {
    paddingHorizontal: 16,
    paddingTop: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    paddingBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: SYS_MED,
    color: t.text,
    marginBottom: 10,
  },
  noReviews: {
    fontSize: 14,
    fontFamily: SYS,
    color: t.sub,
  },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.input,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  pillText: {
    fontSize: 13,
    fontFamily: SYS,
    color: t.text,
  },

  galleryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  galleryCount: {
    fontSize: 13,
    fontFamily: SYS,
    color: t.sub,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    backgroundColor: t.tile,
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

  // Reviews — flat rows
  reviewRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    gap: 10,
  },
  reviewAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  reviewAvatarImg: { width: '100%', height: '100%' },
  reviewMain: { flex: 1, minWidth: 0 },
  reviewTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  reviewerName: {
    fontSize: 14,
    fontFamily: SYS_MED,
    color: t.text,
    flexShrink: 1,
  },
  reviewDate: {
    fontSize: 12,
    fontFamily: SYS,
    color: t.sub,
  },
  reviewStars: { flexDirection: 'row', gap: 2, marginTop: 3 },
  reviewComment: {
    fontSize: 14,
    fontFamily: SYS,
    color: t.text,
    lineHeight: 20,
    marginTop: 4,
  },
});
