import React, { useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, View, Image, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useIsFocused } from '@react-navigation/native';
import { listingPricePrimary, listingPurposeLabel } from '../utils/formatPrice';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;

function isVideoImage(img) {
  if (!img || !img.url) return false;
  return img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url);
}

export default function ListingCard({ item, onPress, onFavorite, isFavorite, wide }) {
  const { width } = useWindowDimensions();
  const cardWidth = wide ? width - 40 : (width - 50) / 2;
  // Shein-style portrait ratio (≈3:4)
  const imageHeight = Math.round(cardWidth * 1.3);
  const isFocused = useIsFocused();

  const isNew =
    item.created_at &&
    Date.now() - new Date(item.created_at).getTime() < 5 * 60 * 60 * 1000;

  // Parse images
  let images = [];
  if (item.property_images && item.property_images.length > 0) {
    images = item.property_images;
  } else if (item.images && item.images.length > 0) {
    images = (typeof item.images === 'string' ? JSON.parse(item.images) : item.images).map(u => ({ url: u }));
  }

  const videoImg = images.find(isVideoImage);
  const videoUrl = videoImg ? videoImg.url : null;
  const coverImg = images.find(img => !isVideoImage(img));
  let imageUrl = coverImg ? coverImg.url : null;
  if (!imageUrl && !videoUrl && images.length > 0) imageUrl = images[0].url;

  const player = useVideoPlayer(videoUrl || null, (player) => {
    player.loop = true;
    player.muted = true;
    player.volume = 0;
  });

  // Keep videos silent and pause them when the screen is not focused
  useEffect(() => {
    if (!videoUrl) return;
    try {
      player.muted = true;
      player.volume = 0;
      if (isFocused) {
        player.play();
      } else {
        player.pause();
      }
    } catch {}
    return () => { try { player.pause(); } catch {} };
  }, [isFocused, videoUrl, player]);

  return (
    <TouchableOpacity 
      onPress={onPress} 
      activeOpacity={0.9} 
      style={[styles.card, { width: cardWidth }]}
    >
      <View style={[styles.imageContainer, { height: imageHeight }]}>
        {videoUrl ? (
          <>
            <VideoView
              player={player}
              style={styles.image}
              contentFit="cover"
              nativeControls={false}
              fullscreenOptions={{ isFullscreenButtonHidden: true, variants: [] }}
              allowsPictureInPicture={false}
              requiresLinearPlayback
            />
            {/* Center play affordance — Shein-style video thumb */}
            <View style={styles.videoPlayOverlay} pointerEvents="none">
              <View style={styles.videoPlayCircle}>
                <Ionicons name="play" size={16} color="#FFFFFF" />
              </View>
            </View>
            <View style={styles.videoBadge}>
              <Ionicons name="play" size={9} color="#FFFFFF" />
              <Text style={styles.videoBadgeText}>VIDEO</Text>
            </View>
          </>
        ) : imageUrl ? (
          <Image 
            source={{ uri: imageUrl }} 
            style={styles.image} 
            resizeMode="cover" 
            fadeDuration={0}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="image-outline" size={30} color="#0A84FF" opacity={0.3} />
          </View>
        )}
        
        {/* NEW tag — top left (Shein "new in" style) */}
        {isNew && (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        )}

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

        {/* Price pill — bottom left over image (Shein style) */}
        <View style={styles.pricePill}>
          <Text style={styles.priceText}>{listingPricePrimary(item)}</Text>
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{item.title || 'Beautiful House'}</Text>
        
        <View style={styles.locationRow}>
          <Ionicons name="location" size={11} color="#0A84FF" />
          <Text style={styles.location} numberOfLines={1}>
            {item.suburb || item.address || item.city || 'Harare'}
          </Text>
        </View>

        <View style={styles.statsRow}>
          {item.property_type === 'stands' ? (
            <View style={styles.stat}>
              <Ionicons name="expand-outline" size={11} color="#8E8E93" />
              <Text style={styles.statText}>{item.area_sqm || 0} m²</Text>
            </View>
          ) : (
            <>
              <View style={styles.stat}>
                <Ionicons name="bed-outline" size={11} color="#8E8E93" />
                <Text style={styles.statText}>{item.bedrooms || 0}</Text>
              </View>
              <View style={styles.stat}>
                <Ionicons name="water-outline" size={11} color="#8E8E93" />
                <Text style={styles.statText}>{item.bathrooms || 0}</Text>
              </View>
            </>
          )}
          <View style={styles.stat}>
            <Ionicons name="resize-outline" size={11} color="#8E8E93" />
            <Text style={styles.statText}>{item.area_sqm || 0}m²</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 16, 
    marginBottom: 16,
    shadowColor: '#000', 
    shadowOpacity: 0.05, 
    shadowRadius: 8, 
    elevation: 3,
    overflow: 'hidden'
  },
  imageContainer: { 
    width: '100%',
    position: 'relative',
    backgroundColor: '#EAF3FF'
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { width: '100%', height: '100%', backgroundColor: '#EAF3FF', justifyContent: 'center', alignItems: 'center' },

  // Shein-style centered play button for videos
  videoPlayOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1
  },
  videoPlayCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,107,107,0.9)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  videoBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#007AFF',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    zIndex: 2
  },
  videoBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 9, letterSpacing: 0.8 },
   
  // "NEW" tag
  newBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: '#007AFF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    zIndex: 2
  },
  newBadgeText: { color: '#FFFFFF', fontWeight: '700', fontSize: 9, letterSpacing: 0.8 },

  pricePill: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 2,
    alignSelf: 'flex-start'
  },
  priceText: { color: '#007AFF', fontWeight: '700', fontSize: 12 },
  
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

  info: { padding: 12 },
  title: { color: '#000000', fontWeight: '600', fontSize: 13, marginBottom: 3 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  location: { color: '#8E8E93', fontSize: 11, marginLeft: 2 },
  
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', paddingTop: 8, marginTop: 4 },
  stat: { flexDirection: 'row', alignItems: 'center' },
  statText: { color: '#8E8E93', fontSize: 10, marginLeft: 3, fontWeight: '500' },
});
