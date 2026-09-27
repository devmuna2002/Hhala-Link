import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert, Linking, Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase, getSessionUser } from '../supabase';
import { listingPricePrimary } from '../utils/formatPrice';
import { toPublicImageUrl } from '../utils/imageUrl';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const FALLBACK_IMG = 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1473&auto=format&fit=crop';
const isVideoImg = (img) => img && img.url && (img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url));

const capitalise = (s = '') => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtMoney = (n) => (n === undefined || n === null || n === '') ? '' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtDate = (d) => { if (!d) return ''; const dt = new Date(d); return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };

export default function RequestViewModal({ visible, item, onClose, onFavorite, isFavorite }) {
  const navigation = useNavigation();
  const [property, setProperty] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);

  // Fetch the full listing (owner, extras, amenities) whenever the modal opens
  useEffect(() => {
    if (!visible || !item) return;
    setLoading(true);
    setActivePhoto(0);
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase
          .from('properties')
          .select('*, property_images(url, alt_text), owner:profiles!owner_id(first_name, last_name, avatar_url, phone_number, role, followers_count)')
          .eq('id', item.id)
          .single();
        if (!error && data && !cancelled) setProperty(data);
      } catch (e) {}
      if (!cancelled) setLoading(false);

      // Count this view quietly in the background
      supabase.rpc('increment_property_views', { prop_id: item.id }).then(() => {}, () => {});
    })();

    return () => { cancelled = true; };
  }, [visible, item]);

  const p = property || item || {};
  const photos = (p.property_images || [])
    .filter(i => !isVideoImg(i))
    .map(i => ({ ...i, url: toPublicImageUrl(i.url) }));
  const photoUrl = photos.length ? photos[activePhoto]?.url || photos[0].url : (item?.images?.[0] ? toPublicImageUrl(item.images[0]) : FALLBACK_IMG);

  const price = listingPricePrimary(p);
  const a = (p.address || '').trim();
  const s = (p.suburb || '').trim();
  const c = (p.city || '').trim();
  const locationLabel = (() => {
    if (s && c) {
      if (s.toLowerCase() !== c.toLowerCase()) return `${s}, ${c}`;
      const neighborhood = a && a.toLowerCase() !== c.toLowerCase() ? a : '';
      return neighborhood ? `${neighborhood}, ${c}` : c;
    }
    return s || c || a || 'Zimbabwe';
  })();
  const ownerName = p.owner ? `${p.owner.first_name || ''} ${p.owner.last_name || ''}`.trim() : (p.owner_name || '');
  const ownerPhone = p.owner?.phone_number || p.owner_phone || '';

  const metaChips = [];
  if (p.property_type !== 'stands') {
    metaChips.push({ icon: 'bed', label: `${p.bedrooms ?? 0} Bedroom${p.bedrooms !== 1 ? 's' : ''}` });
    metaChips.push({ icon: 'water', label: `${p.bathrooms ?? 0} Bathroom${p.bathrooms !== 1 ? 's' : ''}` });
  }
  const pk = Number(p.parking_spots || 0);
  if (pk > 0) metaChips.push({ icon: 'car-sport', label: `${pk} Parking Lot${pk > 1 ? 's' : ''}` });
  if (p.area_sqm) metaChips.push({ icon: 'resize', label: `${p.area_sqm}m²` });
  metaChips.push({ icon: 'home', label: capitalise(p.property_type) });
  if (p.is_furnished) metaChips.push({ icon: 'bulb', label: 'Furnished' });
  if (p.pets_allowed) metaChips.push({ icon: 'heart', label: 'Pets OK' });

  // Property Details grid (mirrors the website popup)
  const sellable = Number(p.sale_price_usd || 0) > 0;
  const rentable = Number(p.rent_usd || 0) > 0;
  const detailRows = [
    { label: 'Rent', val: rentable ? fmtMoney(p.rent_usd) + '/month' : '' },
    { label: 'Sale Price', val: sellable ? fmtMoney(p.sale_price_usd) : '' },
    { label: 'Deposit', val: p.deposit_usd !== undefined && p.deposit_usd !== null ? fmtMoney(p.deposit_usd) : '' },
    { label: 'Utilities', val: p.utilities_inc === true ? 'Included' : (p.utilities_inc === false ? 'Not included' : '') },
    { label: 'Purpose', val: p.listing_purpose ? capitalise(p.listing_purpose) : '' },
    { label: 'Status', val: p.status === 'available' ? 'Available Now' : (p.status ? capitalise(p.status) : '') },
    { label: 'Floor Level', val: p.floor_level !== undefined && p.floor_level !== null ? 'Floor ' + p.floor_level : '' },
    { label: 'Available From', val: fmtDate(p.available_from) },
    { label: 'Furnished', val: p.is_furnished === true ? 'Yes' : '' },
    { label: 'Pets Allowed', val: p.pets_allowed === true ? 'Yes' : '' },
    { label: 'Address', val: p.address },
    { label: 'Suburb', val: p.suburb },
    { label: 'City', val: p.city },
    { label: 'Province', val: p.province },
    { label: 'Country', val: p.country },
    { label: 'Listed On', val: fmtDate(p.created_at) },
    { label: 'Listing Ref', val: p.id ? String(p.id).slice(0, 8).toUpperCase() : '' },
  ].filter(r => String(r.val ?? '').trim());

  // Amenities (mirrors the website popup)
  const amenities = [];
  if (p.has_wifi) amenities.push({ icon: 'wifi', label: 'WiFi' });
  if (p.has_pool) amenities.push({ icon: 'water', label: 'Pool' });
  if (p.has_gym) amenities.push({ icon: 'barbell', label: 'Gym' });
  if (p.has_borehole) amenities.push({ icon: 'water', label: 'Borehole' });
  if (p.has_solar) amenities.push({ icon: 'sunny', label: 'Solar' });
  if (p.has_security) amenities.push({ icon: 'shield-checkmark', label: 'Security' });
  if (p.has_generator) amenities.push({ icon: 'flash', label: 'Generator' });
  if (p.has_water_tank) amenities.push({ icon: 'water', label: 'Water Tank' });
  if (p.has_garden) amenities.push({ icon: 'leaf', label: 'Garden' });
  if (p.utilities_inc) amenities.push({ icon: 'power', label: 'Utils. Incl.' });
  if (pk > 0) amenities.push({ icon: 'car-sport', label: `${pk} Parking` });

  const guardContact = async () => {
    if (!p.owner_id) {
      Alert.alert('Unavailable', 'This property does not have a listed contact.');
      return null;
    }
    const user = await getSessionUser();
    if (!user) {
      Alert.alert('Login Required', 'Please log in to contact the agent.');
      return null;
    }
    if (user.id === p.owner_id) {
      Alert.alert('Your Listing', 'This is your own listing, so there is no need to contact yourself.');
      return null;
    }
    return user;
  };

  const handleApply = async () => {
    const user = await guardContact();
    if (!user) return;
    try {
      const { data: convs, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .or(`and(participant_a.eq.${user.id},participant_b.eq.${p.owner_id}),and(participant_a.eq.${p.owner_id},participant_b.eq.${user.id})`)
        .limit(1)
        .maybeSingle();
      if (fetchError) throw fetchError;

      let convId = convs?.id || null;
      if (!convId) {
        const { data: newConv, error: createError } = await supabase
          .from('conversations')
          .insert({
            participant_a: user.id,
            participant_b: p.owner_id,
            property_id: p.id,
            last_message_at: new Date(),
          })
          .select()
          .single();
        if (createError) throw createError;
        convId = newConv.id;

        const intro = `Hi ${ownerName || 'there'}, I am interested in your property: ${p.title || 'this listing'} on Hlala Link.`;
        await supabase.from('messages').insert({
          conversation_id: convId,
          sender_id: user.id,
          body: intro,
          status: 'sent',
        });
      }

      if (onClose) onClose();
      navigation.navigate('ChatRoom', {
        conversationId: convId,
        recipientName: ownerName || 'Property Agent',
        propertyId: p.id,
        participantB: p.owner_id,
      });
    } catch (error) {
      console.log('Apply chat error:', error.message);
      Alert.alert('Error', 'Could not start the conversation. Please check your connection and try again.');
    }
  };

  const handleWhatsApp = async () => {
    if (!ownerPhone) {
      Alert.alert('Unavailable', 'No WhatsApp number listed for this agent.');
      return;
    }
    const digits = String(ownerPhone).replace(/[^\d]/g, '');
    const text = `Hi, I am interested in your property: ${p.title || ''} on Hlala Link.`;
    Linking.openURL(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`).catch(() => {});
  };

  const close = () => { if (onClose) onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {loading && !property ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color="#0A84FF" />
            </View>
          ) : (
            <>
              {/* Close */}
              <TouchableOpacity style={styles.closeBtn} onPress={close} activeOpacity={0.8}>
                <Ionicons name="close" size={22} color="#101828" />
              </TouchableOpacity>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
                {/* Photo header */}
                <View style={styles.cover}>
                  <ExpoImage contentFit="cover" source={{ uri: photoUrl }} style={styles.coverImg} blurRadius={4} transition={0} />
                  <View style={styles.locationPillWrap} pointerEvents="none">
                    <View style={styles.locationPill}>
                      <Ionicons name="map" size={12} color="#0A84FF" />
                      <Text style={styles.locationPillText} numberOfLines={1}>{capitalise(locationLabel)}</Text>
                    </View>
                  </View>
                  <View style={[styles.statusBadge, p.status !== 'available' && styles.statusBadgeSoon]}>
                    <Text style={[styles.statusBadgeText, p.status !== 'available' && styles.statusBadgeSoonText]}>
                      {p.status === 'available' || !p.status ? 'Available Now' : 'Coming Soon'}
                    </Text>
                  </View>
                </View>

                {/* Thumbnails */}
                {photos.length > 1 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.thumbsRow}>
                    {photos.map((ph, i) => (
                      <TouchableOpacity key={i} onPress={() => setActivePhoto(i)} activeOpacity={0.8}>
                        <ExpoImage contentFit="cover" source={{ uri: ph.url }} style={[styles.thumb, activePhoto === i && styles.thumbActive]} />
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                {/* Title row + owner */}
                <View style={styles.headArea}>
                  <View style={{ flex: 1, marginRight: 10 }}>
                    <Text style={styles.bigPrice}>{price}</Text>
                    <Text style={styles.headTitle} numberOfLines={2}>{p.title || 'Beautiful Property'}</Text>
                    <View style={styles.locRow}>
                      <Ionicons name="map" size={12} color="#0A84FF" />
                      <Text style={styles.locText} numberOfLines={1}>{capitalise(locationLabel)}</Text>
                    </View>
                  </View>
                  {ownerName ? (
                    <View style={styles.ownerBlock}>
                      <Text style={styles.ownerName} numberOfLines={1}>{ownerName}</Text>
                      <View style={styles.verifiedRow}>
                        <Ionicons name="checkmark-circle" size={13} color="#22C55E" />
                        <Text style={styles.verifiedText}>Verified Agent</Text>
                      </View>
                    </View>
                  ) : null}
                </View>

                {/* Description */}
                <Text style={styles.description}>{p.description || 'No description provided.'}</Text>

                {/* Meta chips */}
                {metaChips.length > 0 && (
                  <View style={styles.chipsWrap}>
                    {metaChips.map((c, i) => (
                      <View key={i} style={styles.chip}>
                        <Ionicons name={c.icon} size={12} color="#0A84FF" />
                        <Text style={styles.chipText}>{c.label}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Property Details grid */}
                {detailRows.length > 0 && (
                  <View style={styles.detailSection}>
                    <View style={styles.sectionTitleRow}>
                      <Ionicons name="list" size={14} color="#101828" />
                      <Text style={styles.sectionTitle}>Property Details</Text>
                    </View>
                    <View style={styles.detailGrid}>
                      {detailRows.map((r, i) => (
                        <View key={i} style={styles.detailRow}>
                          <Text style={styles.detailLabel}>{r.label}</Text>
                          <Text style={styles.detailVal}>{r.val}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Amenities */}
                {amenities.length > 0 && (
                  <View style={styles.amenWrap}>
                    {amenities.map((a, i) => (
                      <View key={i} style={styles.chip}>
                        <Ionicons name={a.icon} size={12} color="#0A84FF" />
                        <Text style={styles.chipText}>{a.label}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>

              {/* Action buttons */}
              <View style={styles.footer}>
                <TouchableOpacity style={styles.applyBtn} onPress={handleApply} activeOpacity={0.85}>
                  <Ionicons name="chatbubble-ellipses" size={14} color="#FFFFFF" />
                  <Text style={styles.applyBtnText}>Message Agent</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.whatsBtn} onPress={handleWhatsApp} activeOpacity={0.85}>
                  <Ionicons name="logo-whatsapp" size={14} color="#FFFFFF" />
                  <Text style={styles.whatsBtnText}>Chat on WhatsApp</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4,9,26,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 540,
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 12 },
      android: { elevation: 12 },
    }),
  },
  closeBtn: {
    position: 'absolute',
    top: 14,
    right: 14,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.96)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: { paddingBottom: 16 },

  cover: { height: 250, backgroundColor: '#EAF3FF', position: 'relative', overflow: 'hidden' },
  coverImg: { width: '100%', height: '100%', transform: [{ scale: 1.04 }] },
  locationPillWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '85%',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 50,
  },
  locationPillText: { color: '#101828', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  statusBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#22C55E',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 3,
  },
  statusBadgeSoon: { backgroundColor: '#FACC15' },
  statusBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 10, letterSpacing: 0.4 },
  statusBadgeSoonText: { color: '#020817' },

  thumbsRow: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  thumb: { width: 60, height: 46, borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
  thumbActive: { borderColor: '#0A84FF' },

  headArea: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 14 },
  bigPrice: { color: '#101828', fontWeight: '800', fontSize: 24 },
  headTitle: { color: '#101828', fontWeight: '700', fontSize: 15, marginTop: 4 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  locText: { color: '#6B7280', fontSize: 12, flexShrink: 1 },
  ownerBlock: { alignItems: 'flex-end', maxWidth: '38%' },
  ownerName: { color: '#101828', fontWeight: '700', fontSize: 12 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  verifiedText: { color: '#22C55E', fontSize: 11, fontWeight: '600' },

  description: { color: '#6B7280', fontSize: 13, lineHeight: 20, paddingHorizontal: 16, marginTop: 10 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginTop: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EAF3FF',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 50,
  },
  chipText: { color: '#0A84FF', fontSize: 11, fontWeight: '600' },

  detailSection: { paddingHorizontal: 16, marginTop: 16 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionTitle: { color: '#101828', fontWeight: '700', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.6 },
  detailGrid: { backgroundColor: '#F4F6FB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 5 },
  detailLabel: { color: '#6B7280', fontSize: 12, flexShrink: 0 },
  detailVal: { color: '#101828', fontWeight: '600', fontSize: 12, textAlign: 'right', flexShrink: 1 },

  amenWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, marginTop: 14 },

  footer: { padding: 12, gap: 10 },
  applyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#0A84FF', borderRadius: 999, paddingVertical: 14,
  },
  applyBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  whatsBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#25D366', borderRadius: 999, paddingVertical: 14,
  },
  whatsBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});