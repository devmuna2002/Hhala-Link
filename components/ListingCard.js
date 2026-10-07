import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TouchableOpacity, Text, StyleSheet, View, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import BlurFadeCardImage from './BlurFadeCardImage';
import { SkeletonBlock } from './Skeleton';
import { listingPricePrimary } from '../utils/formatPrice';
import { listingDescription } from '../utils/listingText';
import { useResponsiveWidth } from '../utils/useResponsiveWidth';
import { toPublicImageUrl } from '../utils/imageUrl';
import { useTheme } from '../utils/theme';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;

function isVideoImage(img) {
  if (!img || !img.url) return false;
  return img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url);
}

// Facebook-style collage: 2 photos side-by-side, 3 as one big + two stacked,
// 4+ as a 2x2 grid. Every tile carries the native bottom blur.
function PhotoArea({ photos, styles }) {
  const T = ({ uri }) => (
    <View style={styles.photoCell}>
      <BlurFadeCardImage uri={uri} style={styles.photoTile} />
    </View>
  );

  if (photos.length === 2) {
    return (
      <View style={styles.photoRow}>
        <T uri={photos[0].url} />
        <T uri={photos[1].url} />
      </View>
    );
  }

  if (photos.length === 3) {
    return (
      <View style={styles.photoRow}>
        <T uri={photos[0].url} />
        <View style={styles.photoCol}>
          <T uri={photos[1].url} />
          <T uri={photos[2].url} />
        </View>
      </View>
    );
  }

  if (photos.length >= 4) {
    return (
      <View style={{ flex: 1 }}>
        <View style={styles.photoRow}>
          <T uri={photos[0].url} />
          <T uri={photos[1].url} />
        </View>
        <View style={styles.photoRow}>
          <T uri={photos[2].url} />
          <T uri={photos[3].url} />
        </View>
      </View>
    );
  }

  return null;
}

function formatLocation(item) {
  const address = (item.address || '').trim();
  const suburb = (item.suburb || '').trim();
  const city = (item.city || '').trim();

  if (suburb && city) {
    if (suburb.toLowerCase() !== city.toLowerCase()) {
      // e.g. "Mandara, Harare" or "Borrowdale, Harare"
      return `${suburb}, ${city}`;
    }
    // suburb is just the city name ("Harare") — the real neighborhood lives in address
    const neighborhood = address && address.toLowerCase() !== city.toLowerCase() ? address : '';
    return neighborhood ? `${neighborhood}, ${city}` : city;
  }

  if (suburb) return suburb;
  if (city) return city;
  if (address) return address;
  return 'Zimbabwe';
}

// Auto-playing, muted, looping video (X-style): starts by itself, no tap,
// no sound. Poster-first: the still photo (or a neutral tile) stays on top
// until the video renders its first frame, so a loading/erroring video
// never flashes black. Falls back to the still permanently on error.
// Memoized + keyed by uri only, so feed re-renders never tear down the player.
export const CardVideo = React.memo(function CardVideo({ uri, style, styles, fallbackUri, fit = 'cover', showMute = false }) {
  const { t } = useTheme();
  const fallbackStyles = useMemo(() => ({
    videoWrap: { backgroundColor: '#05070B', overflow: 'hidden' },
    videoFallbackTile: { backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center' },
    muteBtn: {
      position: 'absolute',
      bottom: 10,
      right: 10,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 3,
    },
  }), [t]);
  const videoStyles = styles || fallbackStyles;
  const [failed, setFailed] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = true;
    p.muted = true;
    p.volume = 0;
    try { p.play(); } catch (_) {}
  });
  useEffect(() => {
    try {
      player.muted = muted;
      player.volume = muted ? 0 : 1;
    } catch (_) {}
  }, [player, muted]);
  useEffect(() => {
    setFailed(false);
    setHasFrame(false);
  }, [uri]);
  useEffect(() => {
    if (!player || !player.addListener) return;
    let statusSub = null;
    let endSub = null;
    try {
      statusSub = player.addListener('statusChange', (payload) => {
        if (payload?.status === 'error') {
          setFailed(true);
        } else if (payload?.status === 'readyToPlay' && !player.playing) {
          try { player.play(); } catch (_) {}
        }
      });
      endSub = player.addListener('playToEnd', () => {
        try {
          player.currentTime = 0;
          player.play();
        } catch (_) {}
      });
    } catch (_) {}
    return () => {
      try { statusSub?.remove(); } catch (_) {}
      try { endSub?.remove(); } catch (_) {}
    };
  }, [player]);
  return (
    <View style={[style, { position: 'relative' }, videoStyles.videoWrap]}>
      {!failed && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit={fit}
          nativeControls={false}
          fullscreenOptions={{ isFullscreenButtonHidden: true, variants: [] }}
          allowsPictureInPicture={false}
          onFirstFrameRender={() => setHasFrame(true)}
        />
      )}
      {(!hasFrame || failed) && (
        fallbackUri ? (
          <BlurFadeCardImage uri={fallbackUri} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, videoStyles.videoFallbackTile]}>
            <Ionicons name="videocam" size={30} color="#8A8A8A" />
          </View>
        )
      )}
      {showMute && hasFrame && !failed && (
        <TouchableOpacity
          style={videoStyles.muteBtn}
          activeOpacity={0.8}
          onPress={() => setMuted((m) => !m)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={15} color="#FFFFFF" />
        </TouchableOpacity>
      )}
    </View>
  );
}, (prev, next) => prev.uri === next.uri && prev.fallbackUri === next.fallbackUri && prev.fit === next.fit && prev.showMute === next.showMute && prev.styles === next.styles);

function AutoSizeVideo({ uri, posterUri, width, height, styles }) {
  return (
    <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'flex-start' }]}>
      <CardVideo
        uri={uri}
        fallbackUri={posterUri}
        styles={styles}
        style={{ width: width || '100%', height: height || '100%', borderRadius: 22 }}
        fit="cover"
        showMute
      />
    </View>
  );
}

export default function ListingCard({ item, onPress, onFavorite, isFavorite, wide = true, cardWidth: fixedWidth, mediaLoading = false }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [expanded, setExpanded] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const width = useResponsiveWidth();
  const cardWidth = fixedWidth || (wide ? width - 36 : (width - 40) / 2);

  // A corrupt row (null item from a stale cache, bad Supabase shape) must
  // never crash the whole feed through the ErrorBoundary — skip it quietly.
  // NOTE: this sits after the hooks above so hook order stays stable.
  if (!item || typeof item !== 'object') return null;

  // Parse images
  let images = [];
  const rawGallery = Array.isArray(item.property_images) ? item.property_images : null;
  if (rawGallery && rawGallery.length > 0) {
    images = rawGallery
      .map((img) => ({ ...img, url: toPublicImageUrl(img?.url) }))
      .filter((img) => img && img.url);
  } else if (item.images && item.images.length > 0) {
    try {
      const parsed = typeof item.images === 'string' ? JSON.parse(item.images) : item.images;
      images = (Array.isArray(parsed) ? parsed : [])
        .map((u) => (typeof u === 'string' ? { url: toPublicImageUrl(u) } : { ...u, url: toPublicImageUrl(u?.url) }))
        .filter((img) => img && img.url);
    } catch (_) {
      images = [];
    }
  }

  const coverImg = images.find(img => !isVideoImage(img));
  const firstVideo = images.find(img => isVideoImage(img));
  const rawUrl = coverImg?.url || images[0]?.url || toPublicImageUrl(item.image_url);
  const imageUrl = typeof rawUrl === 'string' ? rawUrl.trim() : rawUrl;
  const nonVideoImages = images.filter(img => !isVideoImage(img));
  const photos = nonVideoImages.slice(0, 4);
  const extraCount = Math.max(0, nonVideoImages.length - 4);
  const totalPhotos = nonVideoImages.length;

  const locationLabel = formatLocation(item);
  const ratingValue = item.average_rating ? Number(item.average_rating).toFixed(1) : null;
  // Fresh posts (within 14h) get a NEW banner on the card.
  const createdAtMs = item.created_at ? new Date(item.created_at).getTime() : 0;
  const isNew = createdAtMs > 0 && (Date.now() - createdAtMs) < 14 * 60 * 60 * 1000;

  const bedrooms = item.bedrooms ?? 2;
  const bathrooms = item.bathrooms ?? 2;
  const areaSqm = item.area_sqm ? Number(item.area_sqm) : null;
  const description = listingDescription(item);

  // Listing agent (embedded `owner` join from the feed query). Shown as an
  // X-style byline footer so every card credits who listed it.
  const owner = Array.isArray(item.owner) ? item.owner[0] : item.owner;
  const agentName = (
    owner?.business_name ||
    `${owner?.first_name || ''} ${owner?.last_name || ''}`.trim()
  ) || (item.owner_id ? 'Hlala Link Agent' : null);
  const agentAvatar = !avatarFailed && owner?.avatar_url ? String(owner.avatar_url).trim() : null;
  const agentRoleLabel =
    owner?.role === 'agent' ? 'Property Agent' :
    owner?.role === 'landlord' ? 'Landlord' :
    owner?.role === 'admin' ? 'Hlala Link Official' :
    owner?.role === 'mover' ? 'Mover Partner' : 'Private Lister';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.92}
      style={[styles.card, { width: cardWidth }]}
    >
      {/* Listing agent header on top of the card — X-style byline */}
      {agentName && (
        <View style={styles.agentHeader}>
          {agentAvatar ? (
            <Image
              source={{ uri: agentAvatar }}
              style={styles.agentAvatar}
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <View style={styles.agentAvatarFallback}>
              <Text style={styles.agentInitial}>
                {(agentName.trim()[0] || 'H').toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.agentMeta}>
            <View style={styles.agentNameRow}>
              <Text style={styles.agentName} numberOfLines={1}>
                {agentName}
              </Text>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark" size={11} color="#FFFFFF" />
              </View>
            </View>
            <Text style={styles.agentRole} numberOfLines={1}>
              {agentRoleLabel}
            </Text>
          </View>
        </View>
      )}
      {/* Top Image Container (video tiles size to original aspect) */}
      <View style={[styles.imageContainer, { height: firstVideo ? 460 : (wide ? 270 : 210) }]}>
        {/* Listings with a video autoplay it (muted + looping, X-style) with
            the cover photo as the poster until the first frame renders.
            Photo-only listings keep the collage / still image. */}
        {firstVideo ? (
          <AutoSizeVideo uri={toPublicImageUrl(firstVideo.url)} posterUri={imageUrl} width={Math.max(0, Math.min(310, cardWidth - 32))} height={430} styles={styles} />
        ) : wide && photos.length >= 2 ? (
          <PhotoArea photos={photos} styles={styles} />
        ) : imageUrl ? (
          <BlurFadeCardImage uri={imageUrl} style={styles.cardImage} />
        ) : mediaLoading ? (
          <SkeletonBlock width="100%" height="100%" borderRadius={0} />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="image" size={36} color="#A0A0A0" />
          </View>
        )}

        {/* Top-left badges: NEW + Rating */}
        <View style={styles.topLeftBadges}>
          {isNew && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NEW</Text>
            </View>
          )}
          <View style={styles.ratingBadge}>
            <Ionicons name="star" size={12} color="#F59E0B" style={{ marginRight: 4 }} />
            <Text style={styles.ratingBadgeText}>{ratingValue || '4.7'}</Text>
          </View>
        </View>

        {/* Top-right Favorite Heart Button */}
        <TouchableOpacity
          style={styles.favoriteBtn}
          activeOpacity={0.8}
          onPress={(e) => {
            e.stopPropagation();
            onFavorite && onFavorite(item);
          }}
        >
          <Ionicons
            name="bookmark"
            size={18}
            color={isFavorite ? "#EF4444" : "#111827"}
          />
        </TouchableOpacity>

        {/* Extra photos count badge */}
        {totalPhotos > 1 && (
          <View style={styles.extraBadge}>
            <Ionicons name="images" size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
            <Text style={styles.extraBadgeText}>{totalPhotos}</Text>
          </View>
        )}
      </View>

      {/* Card Info Details */}
      <View style={styles.cardBody}>
        {/* Specs row underneath the image — text-only chips, no icons */}
        <View style={styles.specRow}>
          <View style={styles.lightChip}>
            <Text style={styles.lightChipText}>{bedrooms} Bedrooms</Text>
          </View>
          <View style={styles.lightChip}>
            <Text style={styles.lightChipText}>{bathrooms} Bathrooms</Text>
          </View>
          {!!areaSqm && (
            <View style={styles.lightChip}>
              <Text style={styles.lightChipText}>{areaSqm}m²</Text>
            </View>
          )}
        </View>

        {/* Title & Price Header Row */}
        <View style={styles.titlePriceRow}>
          <Text style={styles.propertyTitle} numberOfLines={1}>
            {item.title || 'Harbor View Hideaway'}
          </Text>
          <Text style={styles.propertyPrice}>
            {listingPricePrimary(item)}
          </Text>
        </View>

        {/* Location Row */}
        <View style={styles.locationRow}>
          <Ionicons name="location" size={14} color="#6B7280" />
          <Text style={styles.propertyLocation} numberOfLines={1}>
            {locationLabel}
          </Text>
        </View>

        {/* Description snippet */}
        {wide && description.length > 0 && (
          <View style={styles.descriptionWrap}>
            <Text
              style={styles.propertyDescription}
              numberOfLines={expanded ? undefined : 2}
            >
              {description}
            </Text>
            {description.length > 90 && (
              <TouchableOpacity onPress={() => setExpanded(!expanded)} hitSlop={{ top: 6, bottom: 6 }} activeOpacity={0.7}>
                <Text style={styles.viewMore}>{expanded ? 'View less' : 'view more... c'}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

      </View>
    </TouchableOpacity>
  );
}

const buildStyles = (t) => StyleSheet.create({
  card: {
    backgroundColor: t.card,
    borderRadius: 32,
    marginBottom: 22,
    overflow: 'hidden',
    // Soft drop shadow so each card lifts off the feed — the shadow gap
    // reads as the division between one card ending and the next starting.
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 5,
    alignSelf: 'center',
  },
  imageContainer: {
    width: '100%',
    height: 190,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: t.card,
    position: 'relative',
    overflow: 'hidden',
  },
  imagePlaceholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: t.tile,
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  videoWrap: {
    backgroundColor: '#05070B',
    overflow: 'hidden',
  },
  videoFallbackTile: {
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
  },
  muteBtn: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 3,
  },
  photoRow: { flex: 1, flexDirection: 'row' },
  photoCol: { flex: 1, flexDirection: 'column' },
  photoCell: { flex: 1, margin: 2 },
  photoTile: { flex: 1, borderRadius: 10, overflow: 'hidden' },
  extraBadge: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.72)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    zIndex: 2,
  },
  extraBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: 'Poppins_600SemiBold',
  },
  topLeftBadges: {
    position: 'absolute',
    top: 12,
    left: 12,
    zIndex: 2,
    gap: 6,
    alignItems: 'flex-start',
  },
  newBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A84FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  newBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: 'Poppins_700Bold',
    letterSpacing: 0.5,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.72)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  ratingBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontFamily: 'Poppins_600SemiBold',
  },
  favoriteBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 2,
  },
  specRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  lightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.chip,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 12,
  },
  lightChipText: {
    color: t.text,
    fontSize: 12.5,
    fontFamily: 'Poppins_700Bold',
    fontWeight: '700',
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: t.card,
  },
  titlePriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  propertyTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_900Black',
    color: t.text,
    flex: 1,
    marginRight: 10,
    letterSpacing: -0.3,
  },
  propertyPrice: {
    fontSize: 19,
    fontFamily: 'Poppins_900Black',
    color: t.text,
    letterSpacing: -0.3,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  propertyLocation: {
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: t.sub,
    marginLeft: 4,
    flex: 1,
  },
  descriptionWrap: {
    marginTop: 12,
  },
  // Threads-style body: system font, regular, near-black.
  propertyDescription: {
    fontSize: 16,
    color: t.text,
    lineHeight: 23,
  },
  viewMore: {
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: t.sub,
    marginTop: 5,
  },
  gridTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Poppins_900Black',
    color: t.text,
    marginRight: 10,
    letterSpacing: -0.2,
  },
  gridPrice: {
    fontSize: 15,
    fontFamily: 'Poppins_900Black',
    color: '#0A84FF',
  },
  agentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  agentAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.tile,
  },
  agentAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  agentInitial: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Poppins_700Bold',
  },
  agentMeta: {
    flex: 1,
    marginLeft: 10,
  },
  agentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  agentName: {
    fontSize: 14.5,
    fontFamily: 'Poppins_700Bold',
    color: t.text,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  verifiedBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#0866FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  agentRole: {
    fontSize: 12,
    fontFamily: 'Poppins_500Medium',
    color: t.sub,
    marginTop: 1,
  },
});