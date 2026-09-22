import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View, Image, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { listingPricePrimary } from '../utils/formatPrice';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;

function isVideoImage(img) {
  if (!img || !img.url) return false;
  return img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url);
}

export default function ListingCard({ item, onPress, onFavorite, isFavorite, wide, cardWidth: fixedWidth }) {
  const { width } = useWindowDimensions();
  const cardWidth = fixedWidth || (wide ? width - 40 : (width - 34) / 2);
  // Tall portrait cover like the website cards
  const imageHeight = Math.round(cardWidth * 1.48);

  // Parse images
  let images = [];
  if (item.property_images && item.property_images.length > 0) {
    images = item.property_images;
  } else if (item.images && item.images.length > 0) {
    images = (typeof item.images === 'string' ? JSON.parse(item.images) : item.images).map(u => ({ url: u }));
  }

  const videoExists = images.some(isVideoImage);
  const coverImg = images.find(img => !isVideoImage(img));
  let imageUrl = coverImg ? coverImg.url : null;
  if (!imageUrl && !videoExists && images.length > 0) imageUrl = images[0].url;

  const available = item.status === 'available' || !item.status;
  const locationLabel = item.suburb || item.address || item.city || 'Zimbabwe';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={[styles.card, { width: cardWidth, height: imageHeight }]}
    >
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.image}
          resizeMode="cover"
          blurRadius={4}
          fadeDuration={0}
        />
      ) : (
        <View style={styles.imagePlaceholder}>
          <Ionicons name="image-outline" size={32} color="#0A84FF" opacity={0.4} />
        </View>
      )}

      {/* Dark scrim from the bottom so overlaid text stays readable */}
      <View style={styles.scrim} />

      {/* Status badge — website style (top-left) */}
      <View style={[styles.statusBadge, !available && styles.statusBadgeSoon]}>
        <Text style={[styles.statusBadgeText, !available && styles.statusBadgeSoonText]}>
          {available ? 'Available Now' : 'Coming Soon'}
        </Text>
      </View>

      {/* Favorite Button — top right */}
      <TouchableOpacity
        style={styles.favoriteBtn}
        onPress={(e) => {
          e.stopPropagation();
          onFavorite && onFavorite(item);
        }}
      >
        <Ionicons
          name={isFavorite ? "heart" : "heart-outline"}
          size={16}
          color={isFavorite ? "#FF2D55" : "#1A1A1A"}
        />
      </TouchableOpacity>

      {/* Video indicator */}
      {videoExists && (
        <View style={styles.videoBadge}>
          <Ionicons name="play" size={9} color="#FFFFFF" />
          <Text style={styles.videoBadgeText}>VIDEO</Text>
        </View>
      )}

      {/* Text over the picture — location, title, price */}
      <View style={styles.overlayText} pointerEvents="none">
        <View style={styles.locRow}>
          <Ionicons name="map" size={11} color="#FFFFFF" />
          <Text style={styles.locText} numberOfLines={1}>{locationLabel}</Text>
        </View>
        <Text style={styles.title} numberOfLines={1}>{item.title || 'Beautiful House'}</Text>
        <Text style={styles.price}>{listingPricePrimary(item)}</Text>
      </View>

      {/* Request View bar pinned to the bottom (website grid footer) */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.requestBtn} onPress={onPress} activeOpacity={0.85}>
          <Ionicons name="calendar-outline" size={13} color="#FFFFFF" />
          <Text style={styles.requestBtnText}>Request View</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#EAF3FF',
    borderRadius: 18,
    marginBottom: 9,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  // Blurred cover — slight zoom hides the soft blur edges
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    transform: [{ scale: 1.04 }],
  },
  imagePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#EAF3FF',
  },

  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '55%',
    backgroundColor: 'rgba(4,9,26,0.45)',
    zIndex: 1,
  },

  // Status badge (website `.listing-badge`, top-left)
  statusBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: '#22C55E',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    zIndex: 3,
  },
  statusBadgeSoon: { backgroundColor: '#FACC15' },
  statusBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 9, letterSpacing: 0.4 },
  statusBadgeSoonText: { color: '#020817' },

  favoriteBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },

  // Centered location pill removed — location is shown inline with the title text
  videoBadge: {
    position: 'absolute',
    right: 10,
    top: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#007AFF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    zIndex: 3,
  },
  videoBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 9, letterSpacing: 0.8 },

  // Text over the picture (location, title, price)
  overlayText: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 46,
    zIndex: 2,
  },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  locText: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '500', flexShrink: 1 },
  title: { color: '#FFFFFF', fontWeight: '700', fontSize: 13, marginTop: 2 },
  price: { color: '#FFFFFF', fontWeight: '800', fontSize: 17, marginTop: 3 },

  // Request View bar pinned to the bottom (website `.listing-footer`)
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4,9,26,0.9)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    zIndex: 4,
  },
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0A84FF',
    borderRadius: 10,
    paddingVertical: 8,
  },
  requestBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
});