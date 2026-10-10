import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, Share, Linking, Alert, Dimensions, Modal, ActivityIndicator, TextInput, KeyboardAvoidingView, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getSessionUser } from '../supabase';
import { NotificationService } from '../services/NotificationService';
import { isTransientError, withTimeout, withRetry } from '../utils/network';
import { enqueueOutbox } from '../utils/outbox';
import { listingPricePrimary, listingPriceSecondary } from '../utils/formatPrice';
import { toPublicImageUrl } from '../utils/imageUrl';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useIsFocused } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { useTheme } from '../utils/theme';
import { DetailSkeleton } from '../components/Skeleton';
import AsyncStorage from '@react-native-async-storage/async-storage';

function PressScale({ children, onPress, style, disabled, ...props }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => Animated.spring(scale, { toValue: 0.92, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start()}
      {...props}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const FALLBACK_IMG = 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1473&auto=format&fit=crop';
const isVideoImg = (img) => img && img.url && (img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url));

function formatLocation(item) {
  if (!item) return '';
  const address = (item.address || '').trim();
  const suburb  = (item.suburb  || '').trim();
  const city    = (item.city    || '').trim();

  // Always prefer suburb + city when suburb is available
  if (suburb && city) {
    if (suburb.toLowerCase() !== city.toLowerCase()) {
      return `${suburb}, ${city}`;
    }
    // suburb is just the city name — use address as the neighborhood (e.g. "Mandara, Harare")
    const neighborhood = address && address.toLowerCase() !== city.toLowerCase() ? address : '';
    return neighborhood ? `${neighborhood}, ${city}` : city;
  }

  if (suburb) return suburb;
  if (city)   return city;
  if (address) return address;

  return 'Zimbabwe';
}

const firstMediaUrl = (p) => {
  const imgs = p?.property_images || [];
  const photo = imgs.find(i => !isVideoImg(i)) || imgs[0];
  return photo?.url || FALLBACK_IMG;
};

// Relative "listed x ago"
const timeAgo = (d) => {
  if (!d) return null;
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (isNaN(s) || s < 0) return null;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

// Smart feature chips mined from structured fields + description text
function extractFeatures(p) {
  if (!p) return [];
  const d = (p.description || '').toLowerCase();
  const has = (re) => re.test(d);
  const feats = [];
  if (p.is_furnished) feats.push({ icon: 'bed', label: 'Furnished' });
  if (has(/solar/)) feats.push({ icon: 'sunny', label: 'Solar' });
  if (has(/borehole/)) feats.push({ icon: 'water', label: 'Borehole' });
  if (has(/tile/)) feats.push({ icon: 'grid', label: 'Tiled' });
  if (has(/walled|\bwall\b/)) feats.push({ icon: 'shield-checkmark', label: 'Walled' });
  if (has(/gated|complex|estate/)) feats.push({ icon: 'lock-closed', label: 'Gated' });
  if (has(/fibre|fiber|wifi|internet/)) feats.push({ icon: 'wifi', label: 'Fibre Ready' });
  if (has(/prepaid/)) feats.push({ icon: 'flash', label: 'Prepaid Meter' });
  if (has(/\bpet\b|\bpets\b/)) feats.push({ icon: 'paw', label: 'Pet Friendly' });
  return feats.slice(0, 8);
}

// Carousel slide: autoplays video slides, renders photos as images
function MediaSlide({ item, isActive, style }) {
  const isFocused = useIsFocused();
  const player = useVideoPlayer(item.isVideo ? item.uri : null, (p) => {
    p.loop = true;
    p.muted = true;
    p.volume = 0;
  });

  useEffect(() => {
    if (!item.isVideo) return;
    try {
      player.muted = true;
      player.volume = 0;
      if (isActive && isFocused) {
        player.play();
      } else {
        player.pause();
      }
    } catch {}
    return () => { try { player.pause(); } catch {} };
  }, [isActive, isFocused, item.isVideo, player]);

  if (item.isVideo) {
    return (
      <VideoView
        player={player}
        style={style}
        contentFit="cover"
        nativeControls={false}
        fullscreenOptions={{ isFullscreenButtonHidden: true, variants: [] }}
        allowsPictureInPicture={false}
      />
    );
  }
  return <ExpoImage contentFit="cover" source={{ uri: item.uri }} style={style} />;
}

export default function DetailScreen({ route, navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const isFocused = useIsFocused();
  const params = route.params || {};
  const { item: initialItem, propertyId, id, property_id } = params;
  // Resolve the ID from any passed parameter format
  const resolvedId = id || propertyId || property_id || initialItem?.id;
  const [propertyItem, setPropertyItem] = useState(initialItem || null);
  const [fetchingProperty, setFetchingProperty] = useState(!initialItem);

  const { width, height } = Dimensions.get('window');
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('About'); // About, Gallery, Review
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [userRating, setUserRating] = useState(5);
  const [userReview, setUserReview] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [agentModalVisible, setAgentModalVisible] = useState(false);
  const [contacting, setContacting] = useState(false);
  const [draftVisible, setDraftVisible] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  const [similar, setSimilar] = useState([]);
  const [agentListingCount, setAgentListingCount] = useState(null);
  const [descExpanded, setDescExpanded] = useState(false);

  const findOrCreateConversation = async (userId) => {
    // Thread scope: one exchange per (user pair + this property), so
    // inquiries about different listings never merge into one chat.
    const ownerId = propertyItem.owner_id;
    const propId = propertyItem.id;
    const pairFilter = `and(participant_a.eq.${userId},participant_b.eq.${ownerId}),and(participant_a.eq.${ownerId},participant_b.eq.${userId})`;
    const scopeFilter = propId
      ? `and(participant_a.eq.${userId},participant_b.eq.${ownerId},property_id.eq.${propId}),and(participant_a.eq.${ownerId},participant_b.eq.${userId},property_id.eq.${propId})`
      : pairFilter;
    const { data: convs, error: fetchError } = await supabase
      .from('conversations')
      .select('id')
      .or(scopeFilter)
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (convs) return { convId: convs.id, created: false };

    // Create new conversation if none exists
    const { data: newConv, error: createError } = await supabase
      .from('conversations')
      .insert({
        participant_a: userId,
        participant_b: propertyItem.owner_id,
        property_id: propertyItem.id,
        last_message_at: new Date()
      })
      .select()
      .single();

    if (createError) {
      // Pre-migration database (one-chat-per-pair unique index): reuse the
      // pair thread instead of failing.
      if (createError.code === '23505') {
        const { data: legacy, error: legacyErr } = await supabase
          .from('conversations')
          .select('id')
          .or(pairFilter)
          .limit(1)
          .maybeSingle();
        if (legacyErr) throw legacyErr;
        if (legacy) return { convId: legacy.id, created: false };
      }
      throw createError;
    }
    return { convId: newConv.id, created: true };
  };

  const openChat = (convId, fallbackName) => {
    const ownerName = propertyItem.owner
      ? `${propertyItem.owner.first_name || ''} ${propertyItem.owner.last_name || ''}`.trim()
      : '';
    navigation.navigate('ChatRoom', {
      conversationId: convId || null,
      recipientName: ownerName || fallbackName || 'Property Agent',
      recipientAvatar: propertyItem.owner?.avatar_url || null,
      propertyId: propertyItem.id,
      participantB: propertyItem.owner_id
    });
  };

  const guardContact = async () => {
    if (!propertyItem.owner_id) {
      Alert.alert('Unavailable', 'This property does not have a listed contact.');
      return null;
    }

    const user = await getSessionUser();
    if (!user) {
      Alert.alert('Login Required', 'Please log in to contact the agent.');
      return null;
    }

    if (user.id === propertyItem.owner_id) {
      Alert.alert('Your Listing', 'This is your own listing, so there is no need to contact yourself.');
      return null;
    }

    return user;
  };

  // Refetch when returning from the editor (edit screen flags this id
  // stale on save) — without counting another view.
  useEffect(() => {
    if (!isFocused || !resolvedId) return;
    (async () => {
      try {
        const key = `hlala_detail_stale_${resolvedId}`;
        const stale = await AsyncStorage.getItem(key);
        if (stale) {
          await AsyncStorage.removeItem(key);
          fetchProperty(true);
        }
      } catch (_) {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, resolvedId]);

  // Always fetch full property on mount to get description, specs, owner, etc.
  useEffect(() => {
    if (resolvedId) {
      fetchProperty();
      // Fire similar-nearby in PARALLEL when the incoming item already
      // carries city/type (feed taps) — no waiting on the full fetch.
      // The similarFor guard dedupes the post-fetch call below.
      if (initialItem && (initialItem.city || initialItem.property_type)) {
        fetchSimilar(initialItem);
      }
    } else {
      setFetchingProperty(false);
    }
  }, [resolvedId]);

  async function fetchProperty(skipViewCount = false) {
    try {
      if (!propertyItem) setFetchingProperty(true);
      
      // Read-only fetch: safe to retry transient blips instead of hanging
      // on "Loading details..." forever.
      const fetchOne = () => withTimeout(supabase
        .from('properties')
        .select('*, property_images(url, alt_text), owner:profiles!owner_id(first_name, last_name, avatar_url, phone_number, role, followers_count, average_rating)')
        .eq('id', resolvedId)
        .single(), 12000, 'property');
      const { data, error } = await withRetry(fetchOne, { attempts: 3, baseDelayMs: 800, label: 'property' });
      
      if (error) throw error;
      if (data) {
        setPropertyItem(data);
        fetchSimilar(data);
        fetchAgentCount(data.owner_id);
      }

      // Increment views count silently in background (does not block or crash screen).
      // Skipped on post-edit refreshes so returning from the editor doesn't inflate views.
      if (!skipViewCount) {
        supabase.rpc('increment_property_views', { prop_id: resolvedId }).then(() => {}, () => {});
      }

    } catch (error) {
      console.log('Fetch error in DetailScreen:', error.message);
      if (!propertyItem) {
        Alert.alert('Notice', 'Unable to load property details. The listing may have been removed.');
      }
    } finally {
      setFetchingProperty(false);
    }
  }

  // Already-requested property id — skips the duplicate similar fetch when
  // both the mount effect (partial item) and the full fetch complete.
  const similarFor = useRef(null);

  async function fetchSimilar(p) {
    try {
      if (!p?.id || similarFor.current === p.id) return;
      similarFor.current = p.id;
      const filters = [];
      if (p?.city) filters.push(`city.eq.${p.city}`);
      if (p?.property_type) filters.push(`property_type.eq.${p.property_type}`);
      // Slim columns only (what the cards render) + timeout/retry armor.
      // withRetry needs a factory; build the filtered query inside it.
      const fetchFiltered = () => {
        let q = supabase
          .from('properties')
          .select('id, title, rent_usd, sale_price_usd, bedrooms, bathrooms, area_sqm, property_images(url, alt_text)')
          .neq('id', p.id)
          .limit(6);
        if (filters.length > 0) q = q.or(filters.join(','));
        return withTimeout(q.order('views', { ascending: false }), 8000, 'similar');
      };
      const { data } = await withRetry(fetchFiltered, { attempts: 2, baseDelayMs: 600, label: 'similar' });
      setSimilar(data || []);
    } catch (e) {
      setSimilar([]);
    }
  }

  async function fetchAgentCount(ownerId) {
    try {
      if (!ownerId) return setAgentListingCount(0);
      const { count } = await supabase
        .from('properties')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', ownerId);
      setAgentListingCount(count || 0);
    } catch {
      setAgentListingCount(null);
    }
  }

  useEffect(() => {
    if (activeTab === 'Review') {
      fetchReviews();
    }
  }, [activeTab]);

  async function fetchReviews() {
    try {
      setLoadingReviews(true);
      const { data, error } = await supabase
        .from('reviews')
        .select(`
          id, rating, body, created_at,
          reviewer:profiles!reviewer_id(first_name, last_name, avatar_url)
        `)
        .eq('property_id', propertyItem.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReviews(data || []);
    } catch (error) {
      console.log('Error fetching reviews:', error.message);
    } finally {
      setLoadingReviews(false);
    }
  }

  async function submitReview() {
    if (!userReview.trim()) {
      Alert.alert('Empty Review', 'Please enter some text for your review.');
      return;
    }
    
    if (!propertyItem.id) {
      Alert.alert('Error', 'Cannot post review: Property ID is missing.');
      return;
    }

    try {
      setSubmittingReview(true);
      const user = await getSessionUser();
      if (!user) {
        Alert.alert('Login Required', 'Please log in to leave a review.');
        return;
      }

      const { error } = await supabase.from('reviews').insert({
        property_id: propertyItem.id,
        reviewer_id: user.id,
        rating: userRating,
        body: userReview,
        is_public: true
      });

      if (error) {
        console.error('Submit Review Error:', error);
        throw error;
      }

      setUserReview('');
      setUserRating(5);
      Alert.alert('Success', 'Your review has been posted!');
      fetchReviews();
    } catch (error) {
      console.log('Final catch review error:', error.message);
      Alert.alert('Error', error.message || 'Failed to post review. Please try again.');
    } finally {
      setSubmittingReview(false);
    }
  }

  let mediaItems = [];
  if (propertyItem?.property_images && propertyItem.property_images.length > 0) {
    mediaItems = propertyItem.property_images.map(img => ({ uri: toPublicImageUrl(img.url), isVideo: isVideoImg(img) }));
  } else if (propertyItem?.images && propertyItem.images.length > 0) {
    const arr = typeof propertyItem.images === 'string' ? JSON.parse(propertyItem.images) : propertyItem.images;
    mediaItems = arr.map(u => ({ uri: toPublicImageUrl(u), isVideo: VIDEO_URL_REGEX.test(String(u)) || String(u).startsWith('data:video') }));
  }
  // Fallback if no media
  if (mediaItems.length === 0) mediaItems = [{ uri: FALLBACK_IMG, isVideo: false }];
  const images = mediaItems;

  // ── Smart derived data ────────────────────────────────────
  const avgRating = reviews.length
    ? (reviews.reduce((a, r) => a + (r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;
  const features = extractFeatures(propertyItem);
  const listedAgo = timeAgo(propertyItem?.created_at);

  const specsArr = [];
  if (propertyItem?.property_type !== 'stands') {
    if (propertyItem?.floor_level) specsArr.push({ icon: 'layers', label: 'Floor', value: propertyItem.floor_level });
    if (propertyItem?.is_furnished != null) specsArr.push({ icon: 'color-palette', label: 'Furnishing', value: propertyItem.is_furnished ? 'Furnished' : 'Unfurnished' });
  }
  if (propertyItem?.water_source) specsArr.push({ icon: 'water', label: 'Water', value: propertyItem.water_source });
  const basePrice = propertyItem?.rent_usd || propertyItem?.sale_price_usd;
  if (basePrice && propertyItem?.area_sqm) specsArr.push({ icon: 'resize', label: 'Price / sqm', value: `$${(basePrice / propertyItem.area_sqm).toFixed(2)}` });
  if (propertyItem?.listing_purpose) specsArr.push({
    icon: 'swap-horizontal',
    label: 'Listing',
    value: propertyItem.listing_purpose === 'sale' ? 'For Sale' : propertyItem.listing_purpose === 'rent' ? 'To Rent' : 'Rent or Sale',
  });

  const handleScroll = (event) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = event.nativeEvent.contentOffset.x / slideSize;
    setActiveIndex(Math.round(index));
  };

  const buildInquiryTemplate = () =>
    `Hello! I am interested in this ${propertyItem?.property_type || 'property'}: "${propertyItem?.title || 'your listing'}" (${listingPricePrimary(propertyItem)} in ${propertyItem?.city || 'Zimbabwe'}). I'd like to schedule a viewing or discuss next steps. Thank you!`;

  const openDraftComposer = () => {
    setDraftText(buildInquiryTemplate());
    setDraftVisible(true);
  };

  const handleChatPress = async () => {
    if (contacting) return;
    const user = await guardContact();
    if (!user) return;
    openDraftComposer();
  };

  const sendDraft = async () => {
    if (draftBusy) return;
    try {
      setDraftBusy(true);
      const user = await getSessionUser();
      if (!user) {
        Alert.alert('Login Required', 'Please log in to contact the agent.');
        return;
      }

      const { convId } = await findOrCreateConversation(user.id);

      const body = draftText.trim();
      if (body) {
        // Tag the reservation with the listing so the chat renders it as a
        // tappable listing link on the message.
        const baseMsg = {
          conversation_id: convId,
          sender_id: user.id,
          body,
          status: 'sent'
        };
        let { error: msgError } = await supabase
          .from('messages')
          .insert({ ...baseMsg, property_id: propertyItem.id || null });
        // Pre-migration database (no property_id column on messages yet):
        // retry as a plain message instead of failing the send.
        if (msgError && msgError.code === '42703') {
          const retry = await supabase.from('messages').insert(baseMsg);
          msgError = retry.error;
        }
        if (msgError) console.log('Draft message error:', msgError.message);
        else {
          // Real push for the agent (fire-and-forget).
          try {
            const senderName = [user?.user_metadata?.first_name, user?.user_metadata?.last_name]
              .filter(Boolean).join(' ') || null;
            NotificationService.notifyChatRecipient({
              recipientId: propertyItem.owner_id,
              senderId: user.id,
              senderName,
              body,
              conversationId: convId,
            }).catch(() => {});
          } catch (_) {}
        }
      }

      setDraftVisible(false);
      openChat(convId, 'Property Agent');
    } catch (error) {
      console.log('Send draft error:', error.message);
      Alert.alert('Error', 'Could not start the conversation. Please check your connection and try again.');
    } finally {
      setDraftBusy(false);
    }
  };

  const handleShare = async () => {
    try {
      const shareLink = `https://hlalalink.com/property/${propertyItem.id}`;
      const message = `*${propertyItem.title}*\n\n` +
                      `Check out this ${propertyItem.property_type || 'property'} in ${propertyItem.city || 'Zimbabwe'} — ${listingPricePrimary(propertyItem)}!\n\n` +
                      `View full details on Hlala Link:\n${shareLink}`;

      await Share.share({
        message: message,
        url: shareLink,
        title: propertyItem.title,
      });
    } catch (error) {
      console.log('Share error:', error.message);
    }
  };

  const handleCall = () => {
    const phone = propertyItem.owner?.phone_number;
    if (phone) {
      Linking.openURL(`tel:${phone}`);
    } else {
      Alert.alert('No Number', 'This agent has not provided a contact number.');
    }
  };

  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    if (!propertyItem) return;
    checkFavorite();
    // Reviews load lazily when the Review tab opens (tab effect below) —
    // no eager fetch here.
    if (propertyItem.owner_id) checkFollowing();
  }, [propertyItem]);

  const checkFollowing = async () => {
    const user = await getSessionUser();
    if (!user) return;
    setCurrentUserId(user.id);
    const { data } = await supabase.from('user_follows').select('id').eq('follower_id', user.id).eq('following_id', propertyItem.owner_id).single();
    if (data) setIsFollowing(true);
  };

  const handleFollow = async () => {
    const user = await getSessionUser();
    if (!user) {
      Alert.alert('Login Required', 'Please log in to follow agents.');
      return;
    }
    if (user.id === propertyItem.owner_id) {
      Alert.alert('Notice', 'You cannot follow yourself.');
      return;
    }

    if (isFollowing) {
      await supabase.from('user_follows').delete().eq('follower_id', user.id).eq('following_id', propertyItem.owner_id);
      setIsFollowing(false);
      setPropertyItem(prev => ({
        ...prev,
        owner: { ...prev.owner, followers_count: Math.max((prev.owner?.followers_count || 0) - 1, 0) }
      }));
    } else {
      await supabase.from('user_follows').insert({ follower_id: user.id, following_id: propertyItem.owner_id });
      setIsFollowing(true);
      setPropertyItem(prev => ({
        ...prev,
        owner: { ...prev.owner, followers_count: (prev.owner?.followers_count || 0) + 1 }
      }));
    }
  };

  const checkFavorite = async () => {
    const user = await getSessionUser();
    if (!user) return;
    const { data } = await supabase.from('saved_properties').select('property_id').eq('user_id', user.id).eq('property_id', propertyItem.id).single();
    if (data) setIsFavorite(true);
  };

  const handleFavorite = async () => {
    const user = await getSessionUser();
    if (!user) {
      Alert.alert('Login Required', 'Please log in to save properties.');
      return;
    }

    if (isFavorite) {
      await supabase.from('saved_properties').delete().eq('user_id', user.id).eq('property_id', propertyItem.id);
      setIsFavorite(false);
    } else {
      try {
        await supabase.from('saved_properties').insert({ user_id: user.id, property_id: propertyItem.id });
        setIsFavorite(true);
      } catch (e) {
        // Transient blip: keep the optimistic UI and queue for the outbox.
        if (isTransientError(e)) {
          try {
            await enqueueOutbox({ kind: 'fav-add', userId: user.id, propertyId: propertyItem.id });
            setIsFavorite(true);
            return;
          } catch (_) {}
        }
        Alert.alert('Error', 'Could not save. Please try again.');
        return;
      }
      // Real push for the owner on save (fire-and-forget, never self).
      try {
        if (propertyItem.owner_id && propertyItem.owner_id !== user.id) {
          const saver = [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ') || 'Someone';
          NotificationService.notifyUser({
            recipientId: propertyItem.owner_id,
            title: 'Saved listing',
            body: `${saver} saved your listing: ${propertyItem.title || 'your property'}.`,
            data: { propertyId: propertyItem.id },
          }).catch(() => {});
        }
      } catch (_) {}
    }
  };

  const handleBookNow = async () => {
    if (contacting) return;
    const user = await guardContact();
    if (!user) return;
    openDraftComposer();
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      {fetchingProperty ? (
        <DetailSkeleton />
      ) : propertyItem ? (
        <>
        {/* Dreamscape Top Header */}
        <View style={styles.topHeader}>
          <PressScale onPress={() => navigation.goBack()} style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={24} color={t.text} />
          </PressScale>
          <Text style={styles.headerTitle}>Property Details</Text>
          <PressScale onPress={handleShare} style={styles.headerBtn}>
            <Ionicons name="share-social" size={22} color="#8A8A8A" />
          </PressScale>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Top Image Section */}
          <View style={styles.imageCardContainer}>
            {images.length > 0 ? (
              <TouchableOpacity activeOpacity={0.9} onPress={() => setGalleryVisible(true)} style={{ height: '100%' }}>
                <ScrollView 
                  horizontal 
                  pagingEnabled 
                  showsHorizontalScrollIndicator={false}
                  onScroll={handleScroll}
                  scrollEventThrottle={16}
                  bounces={false}
                >
                  {images.map((img, i) => (
                    <MediaSlide key={i} item={img} isActive={activeIndex === i} style={{ width: width - 32, height: '100%' }} />
                  ))}
                </ScrollView>

                {images[activeIndex]?.isVideo && (
                  <View style={styles.videoPill} pointerEvents="none">
                    <Ionicons name="play" size={10} color="#FFF" />
                    <Text style={styles.videoPillText}>VIDEO</Text>
                  </View>
                )}
                
                {images.length > 1 && (
                  <View style={styles.dotsContainer}>
                    {images.map((_, i) => (
                      <View key={i} style={[styles.carouselDot, activeIndex === i && styles.carouselActiveDot]} />
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            ) : (
              <View style={styles.placeholderBg}>
                <Ionicons name="image" size={60} color="#9CA3AF" />
              </View>
            )}
          </View>

          {/* Details Content */}
          <View style={styles.detailsContent}>
            <View style={styles.titleFavoriteRow}>
              <Text style={styles.dreamscapeTitle} numberOfLines={2}>
                {propertyItem.title || 'Harbor View Hideaway'}
              </Text>
              <PressScale onPress={handleFavorite} style={styles.favoriteCircleBtn}>
                <Ionicons name={isFavorite ? "heart" : "heart"} size={22} color={isFavorite ? "#EF4444" : t.text} />
              </PressScale>
            </View>

            <View style={styles.locationRow}>
              <Ionicons name="location" size={13} color={t.text} />
              <Text style={styles.dreamscapeAddress}>
                {formatLocation(propertyItem)}
              </Text>
            </View>

            {(avgRating || reviews.length > 0) ? (
            <View style={styles.ratingReviewsRow}>
              <Ionicons name="star" size={14} color="#F59E0B" />
              <Text style={styles.ratingNumber}>{avgRating || '—'}</Text>
              <Text style={styles.reviewsCountText}> ({reviews.length} review{reviews.length === 1 ? '' : 's'})</Text>
            </View>
            ) : (
            <View style={styles.ratingReviewsRow}>
              <Text style={styles.reviewsCountText}>New listing · No reviews yet</Text>
            </View>
            )}

            {/* Descriptions Section */}
            <View style={styles.sectionBlock}>
              <Text style={styles.dreamscapeSectionTitle}>Descriptions</Text>
              <Text style={styles.descBody} numberOfLines={descExpanded ? undefined : 3}>
                {propertyItem.description || "Sprawled in the heart of the city, this contemporary gem offers a perfect blend of style and functionality. Featuring 2 bedrooms and 2 bathrooms, this square foot home welcomes you with an open living space..."}
              </Text>
              <TouchableOpacity onPress={() => setDescExpanded(e => !e)} hitSlop={{ top: 6, bottom: 6 }}>
                <Text style={styles.readMoreText}>{descExpanded ? 'Show less' : 'Read More'}</Text>
              </TouchableOpacity>
            </View>

            {/* Property Details Amenities Section */}
            <View style={styles.sectionBlock}>
              <Text style={styles.dreamscapeSectionTitle}>Property Details</Text>
              <View style={styles.amenitiesGrid}>
                <View style={styles.amenityTile}>
                  <Text style={styles.amenityTileText}>{propertyItem.bedrooms ?? 2} Bedrooms</Text>
                </View>
                <View style={styles.amenityTile}>
                  <Text style={styles.amenityTileText}>{propertyItem.bathrooms ?? 2} Bathrooms</Text>
                </View>
                {propertyItem.area_sqm > 0 && (
                  <View style={styles.amenityTile}>
                    <Text style={styles.amenityTileText}>{propertyItem.area_sqm}m²</Text>
                  </View>
                )}
                {propertyItem.parking_spots > 0 && (
                  <View style={styles.amenityTile}>
                    <Text style={styles.amenityTileText}>{propertyItem.parking_spots} Parking</Text>
                  </View>
                )}
                {features.map((f, i) => (
                  <View key={i} style={styles.amenityTile}>
                    <Text style={styles.amenityTileText}>{f.label}</Text>
                  </View>
                ))}
              </View>
            </View>

              {similar.length > 0 && (
                <View style={styles.sectionBlock}>
                  <Text style={styles.dreamscapeSectionTitle}>Similar nearby</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.simListContent}
                  >
                    {similar.map(sp => (
                      <PressScale
                        key={sp.id}
                        style={styles.simCard}
                        activeOpacity={0.85}
                        onPress={() => navigation.push('Detail', { item: sp })}
                      >
                        <ExpoImage contentFit="cover" source={{ uri: firstMediaUrl(sp) }} style={styles.simImg} />
                        <View style={styles.simBody}>
                          <Text style={styles.simPrice}>{listingPricePrimary(sp)}</Text>
                          <Text style={styles.simTitle} numberOfLines={1}>{sp.title}</Text>
                          <View style={styles.simSpecs}>
                            {sp.bedrooms > 0 && <Text style={styles.simSpec}>{sp.bedrooms}bd</Text>}
                            {sp.bathrooms > 0 && <Text style={styles.simSpec}>{sp.bathrooms}ba</Text>}
                            {sp.area_sqm > 0 && <Text style={styles.simSpec}>{sp.area_sqm}sqm</Text>}
                          </View>
                        </View>
                      </PressScale>
                    ))}
                  </ScrollView>
                </View>
              )}

          {activeTab === 'Gallery' && (
            <View style={styles.galleryGrid}>
              {images.map((img, i) => (
                <PressScale key={i} style={styles.gridItem} onPress={() => { setActiveIndex(i); setGalleryVisible(true); }}>
                  {img.isVideo ? (
                    <View style={[styles.gridImage, styles.gridVideoTile]}>
                      <Ionicons name="play-circle" size={34} color="#FFF" />
                      <Text style={styles.gridVideoText}>VIDEO</Text>
                    </View>
                  ) : (
                    <ExpoImage contentFit="cover" source={{ uri: img.uri }} style={styles.gridImage} />
                  )}
                </PressScale>
              ))}
            </View>
          )}

          {activeTab === 'Review' && (
            <View style={styles.reviewsSection}>
              <View style={styles.writeReview}>
                <Text style={styles.reviewTitle}>Write a Review</Text>
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <PressScale key={s} onPress={() => setUserRating(s)}>
                      <Ionicons name="star" size={24} color={s <= userRating ? "#FFA500" : "#D1D1D6"} />
                    </PressScale>
                  ))}
                </View>
                <TextInput 
                  style={styles.reviewInput} 
                  placeholder="Share your experience..." 
                  multiline 
                  value={userReview}
                  onChangeText={setUserReview}
                />
                <PressScale 
                  style={[styles.submitReviewBtn, { opacity: submittingReview ? 0.6 : 1 }]} 
                  onPress={submitReview}
                  disabled={submittingReview}
                >
                  {submittingReview ? <ActivityIndicator color={t.bg} /> : <Text style={styles.submitReviewText}>Post Review</Text>}
                </PressScale>
              </View>

              <View style={styles.reviewsList}>
                {loadingReviews ? <ActivityIndicator color="#0A84FF" /> : reviews.length === 0 ? (
                  <Text style={styles.emptyReviews}>No reviews yet. Be the first!</Text>
                ) : (
                  reviews.map(r => (
                    <View key={r.id} style={styles.reviewCard}>
                      <View style={styles.reviewHeader}>
                        <View style={styles.reviewerInfo}>
                          <View style={styles.reviewerAvatar}>
                            {r.reviewer?.avatar_url ? <Image source={{ uri: r.reviewer.avatar_url }} style={{ width: '100%', height: '100%', borderRadius: 15 }} /> : <Ionicons name="person" size={14} color="#FFF" />}
                          </View>
                          <Text style={styles.reviewerName}>{r.reviewer?.first_name || 'Hlala User'}</Text>
                        </View>
                        <View style={styles.ratingRow}>
                          <Ionicons name="star" size={12} color="#FFA500" />
                          <Text style={styles.reviewRating}>{r.rating}</Text>
                        </View>
                      </View>
                      <Text style={styles.reviewBody}>{r.body}</Text>
                      <Text style={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Dreamscape Footer Actions */}
      <View style={styles.bottomBar}>
        <View>
          <Text style={styles.totalPriceLabel}>Total you should pay</Text>
          <Text style={styles.totalPriceValue}>
            {(() => {
              const rent = propertyItem?.rent_usd != null ? `$${propertyItem.rent_usd}` : null;
              const sale = propertyItem?.sale_price_usd != null ? `$${propertyItem.sale_price_usd}` : null;
              if (rent && sale) return <>{rent}<Text style={styles.totalPricePeriod}>/night</Text></>;
              if (rent) return <>{rent}<Text style={styles.totalPricePeriod}>/night</Text></>;
              if (sale) return <>{sale}</>;
              return '$4,788';
            })()}
          </Text>
        </View>
        <PressScale style={[styles.reserveBtn, contacting && { opacity: 0.7 }]} onPress={handleBookNow} disabled={contacting} activeOpacity={0.88}>
          {contacting ? (
            <ActivityIndicator size="small" color={t.bg} />
          ) : (
            <Text style={styles.reserveBtnText}>Reserve Now</Text>
          )}
        </PressScale>
      </View>

      {/* Agent Details Modal */}
      <Modal visible={agentModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.agentModal}>
            <View style={styles.modalHandle} />
            <View style={styles.agentModalAvatar}>
              {propertyItem?.owner?.avatar_url ? (
                <Image source={{ uri: propertyItem.owner.avatar_url }} style={{ width: '100%', height: '100%', borderRadius: 40 }} />
              ) : (
                <Ionicons name="person" size={40} color="#0A84FF" />
              )}
            </View>
            <Text style={styles.agentModalName}>{propertyItem?.owner ? `${propertyItem.owner.first_name || ''} ${propertyItem.owner.last_name || ''}`.trim() || 'Verified Agent' : 'Verified Agent'}</Text>
            <Text style={styles.agentModalRole}>{propertyItem?.owner?.role ? propertyItem.owner.role.toUpperCase() : 'AGENT'}</Text>
            
            <View style={styles.agentStats}>
              <View style={styles.agentStatBox}>
                <Text style={styles.statBoxNum}>{agentListingCount ?? '—'}</Text>
                <Text style={styles.statBoxLabel}>Listings</Text>
              </View>
              <View style={styles.agentStatBox}>
                <Text style={styles.statBoxNum}>{propertyItem?.owner?.average_rating || 'N/A'}</Text>
                <Text style={styles.statBoxLabel}>Rating</Text>
              </View>
              <View style={styles.agentStatBox}>
                <Text style={styles.statBoxNum}>{propertyItem?.owner?.followers_count || 0}</Text>
                <Text style={styles.statBoxLabel}>Followers</Text>
              </View>
            </View>

            {propertyItem?.owner?.role !== 'tenant' && currentUserId !== propertyItem?.owner_id && (
              <PressScale 
                style={[styles.modalFollowBtn, isFollowing && styles.modalFollowingBtn]} 
                onPress={handleFollow}
              >
                <Text style={[styles.modalFollowText, isFollowing && styles.modalFollowingText]}>{isFollowing ? 'Following' : 'Follow Agent'}</Text>
              </PressScale>
            )}

            <PressScale style={styles.closeAgentModal} onPress={() => setAgentModalVisible(false)}>
              <Text style={styles.closeAgentText}>Close</Text>
            </PressScale>
          </View>
        </View>
      </Modal>

      {/* Message Draft Composer */}
      <Modal visible={draftVisible} transparent animationType="fade" onRequestClose={() => !draftBusy && setDraftVisible(false)}>
        <View style={styles.draftOverlay}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => !draftBusy && setDraftVisible(false)} />
          <View style={styles.draftCard}>
            <Text style={styles.draftTitle}>
              Message {propertyItem?.owner ? `${propertyItem.owner.first_name || ''} ${propertyItem.owner.last_name || ''}`.trim() || 'Agent' : 'Agent'}
            </Text>
            {propertyItem?.title ? (
              <Text style={styles.draftSub} numberOfLines={1}>Re: {propertyItem.title}</Text>
            ) : null}
            <TextInput
              style={styles.draftInput}
              value={draftText}
              onChangeText={setDraftText}
              multiline
              autoFocus
              placeholder="Write your message..."
              placeholderTextColor="#8E8E93"
              textAlignVertical="top"
            />
            <View style={styles.draftActions}>
              <TouchableOpacity
                style={styles.draftCancelBtn}
                onPress={() => setDraftVisible(false)}
                disabled={draftBusy}
                activeOpacity={0.7}
              >
                <Text style={styles.draftCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.draftSendBtn, draftBusy && { opacity: 0.7 }]}
                onPress={sendDraft}
                disabled={draftBusy}
                activeOpacity={0.8}
              >
                {draftBusy ? (
                  <ActivityIndicator size="small" color={t.bg} />
                ) : (
                  <>
                    <Ionicons name="send" size={15} color={t.bg} style={{ marginRight: 6 }} />
                    <Text style={styles.draftSendText}>Send Message</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Gallery Modal */}
      <Modal visible={galleryVisible} transparent animationType="fade">
        <View style={styles.galleryModal}>
          <TouchableOpacity style={styles.closeGallery} onPress={() => setGalleryVisible(false)}>
            <Ionicons name="close" size={32} color="#FFF" />
          </TouchableOpacity>
          <ScrollView 
            horizontal 
            pagingEnabled 
            contentOffset={{ x: activeIndex * width, y: 0 }}
          >
            {images.map((img, i) => (
              <MediaSlide key={i} item={img} isActive={activeIndex === i} style={{ width, height: height * 0.7, marginTop: height * 0.15 }} />
            ))}
          </ScrollView>
        </View>
      </Modal>
      </>
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Poppins_500Medium', color: '#8E8E93' }}>Property not found</Text>
        </View>
      )}

    </KeyboardAvoidingView>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  content: { paddingBottom: 100 },
  
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 52 : 20,
    paddingBottom: 10,
    backgroundColor: t.bg,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Poppins_700Bold',
    color: t.text,
  },
  imageCardContainer: {
    height: 230,
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: t.tile,
    position: 'relative',
    marginTop: 4,
  },
  dotsContainer: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  carouselDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.45)',
    marginHorizontal: 3,
  },
  carouselActiveDot: {
    width: 16,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  placeholderBg: {
    flex: 1,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailsContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 30,
  },
  titleFavoriteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  dreamscapeTitle: {
    flex: 1,
    fontSize: 24,
    fontFamily: 'Poppins_900Black',
    color: t.text,
    marginRight: 12,
    letterSpacing: -0.5,
  },
  favoriteCircleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.input,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.hairline,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  dreamscapeAddress: {
    fontSize: 13.5,
    fontFamily: 'Poppins_400Regular',
    color: t.sub,
    marginLeft: 4,
    flex: 1,
  },
  ratingReviewsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  ratingNumber: {
    fontSize: 13.5,
    fontFamily: 'Poppins_600SemiBold',
    color: t.text,
    marginLeft: 4,
  },
  reviewsCountText: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: t.sub,
  },
  sectionBlock: {
    marginBottom: 20,
  },
  dreamscapeSectionTitle: {
    fontSize: 18,
    fontFamily: 'Poppins_900Black',
    color: t.text,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  descBody: {
    fontSize: 15.5,
    fontFamily: 'Poppins_400Regular',
    color: t.text,
    lineHeight: 24,
  },
  readMoreText: {
    fontSize: 14.5,
    fontFamily: 'Poppins_600SemiBold',
    color: t.text,
    marginTop: 4,
  },
  amenitiesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  amenityTile: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.chip,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 6,
  },
  amenityTileText: {
    fontSize: 12.5,
    fontFamily: 'Poppins_500Medium',
    color: t.text,
  },

  bottomBar: { 
    position: 'absolute', 
    bottom: 0, 
    left: 0,
    right: 0,
    width: '100%', 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingTop: 14, 
    backgroundColor: t.card, 
    borderTopWidth: 1, 
    borderTopColor: t.hairline, 
    paddingBottom: Platform.OS === 'ios' ? 32 : 16, 
    shadowColor: '#000', 
    shadowOpacity: 0.05, 
    shadowRadius: 10, 
    elevation: 10 
  },
  totalPriceLabel: { fontFamily: 'Poppins_400Regular', fontSize: 11.5, color: t.sub },
  totalPriceValue: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: t.text, marginTop: 1 },
  totalPricePeriod: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: t.sub },
  reserveBtn: { 
    backgroundColor: t.text, 
    paddingHorizontal: 28, 
    height: 50, 
    borderRadius: 25, 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  reserveBtnText: { color: t.bg, fontFamily: 'Poppins_600SemiBold', fontSize: 15 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  agentModal: { backgroundColor: t.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 26, alignItems: 'center' },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#E0E0E5', marginBottom: 18 },
  agentModalAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  agentModalName: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: t.text },
  agentModalRole: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: t.sub, marginBottom: 18, textTransform: 'capitalize' },
  agentStats: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginBottom: 24, backgroundColor: t.input, borderRadius: 14, paddingVertical: 14 },
  agentStatBox: { alignItems: 'center' },
  statBoxNum: { fontSize: 17, fontFamily: 'Poppins_700Bold', color: t.text },
  statBoxLabel: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: t.sub, marginTop: 2 },
  modalFollowBtn: { width: '100%', backgroundColor: t.text, paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginBottom: 12 },
  modalFollowingBtn: { backgroundColor: t.input },
  modalFollowText: { color: t.bg, fontFamily: 'Poppins_600SemiBold', fontSize: 15 },
  modalFollowingText: { color: t.text },
  closeAgentModal: { paddingVertical: 8 },
  closeAgentText: { color: t.sub, fontFamily: 'Poppins_500Medium', fontSize: 14 },

  // Message draft composer
  draftOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  draftCard: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 20,
  },
  draftTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: t.text },
  draftSub: { fontFamily: 'Poppins_400Regular', fontSize: 12.5, color: t.sub, marginTop: 2, marginBottom: 12 },
  draftInput: {
    backgroundColor: t.input,
    borderRadius: 14,
    padding: 14,
    minHeight: 120,
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: t.text,
    marginBottom: 16,
  },
  draftActions: { flexDirection: 'row', gap: 10 },
  draftCancelBtn: {
    flex: 1,
    height: 52,
    borderRadius: 999,
    backgroundColor: t.input,
    justifyContent: 'center',
    alignItems: 'center',
  },
  draftCancelText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: t.sub },
  draftSendBtn: {
    flex: 1.6,
    height: 52,
    borderRadius: 999,
    backgroundColor: t.text,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  draftSendText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: t.bg },

  galleryModal: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  closeGallery: { position: 'absolute', top: 50, right: 20, zIndex: 10 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridItem: { width: '47%', aspectRatio: 1.2, borderRadius: 14, overflow: 'hidden', backgroundColor: t.tile },
  gridImage: { width: '100%', height: '100%' },
  gridVideoTile: { backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center', gap: 4 },
  gridVideoText: { color: '#FFF', fontFamily: 'Poppins_700Bold', fontSize: 10, letterSpacing: 1 },
  videoPill: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 80,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 5,
    zIndex: 5,
  },
  videoPillText: { color: '#FFF', fontFamily: 'Poppins_700Bold', fontSize: 10, letterSpacing: 1 },

  reviewsSection: { marginTop: 4 },
  writeReview: { backgroundColor: t.input, padding: 18, borderRadius: 16, marginBottom: 24 },
  reviewTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: t.text, marginBottom: 10 },
  starRow: { flexDirection: 'row', marginBottom: 12, gap: 4 },
  reviewInput: { backgroundColor: t.card, borderRadius: 12, padding: 14, height: 90, fontFamily: 'Poppins_400Regular', textAlignVertical: 'top', borderWidth: 1, borderColor: t.hairline, fontSize: 13.5, color: t.text },
  submitReviewBtn: { backgroundColor: t.text, height: 50, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  submitReviewText: { color: t.bg, fontFamily: 'Poppins_600SemiBold', fontSize: 15 },

  reviewsList: { marginTop: 6 },
  reviewCard: { marginBottom: 20, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: t.hairline },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  reviewerInfo: { flexDirection: 'row', alignItems: 'center' },
  reviewerAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  reviewerName: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: t.text },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  reviewRating: { fontFamily: 'Poppins_600SemiBold', fontSize: 12.5, color: '#FFA500' },
  reviewBody: { fontFamily: 'Poppins_400Regular', fontSize: 13.5, color: t.text, lineHeight: 19, marginBottom: 6 },
  reviewDate: { fontFamily: 'Poppins_400Regular', fontSize: 11.5, color: t.sub },
  emptyReviews: { textAlign: 'center', fontFamily: 'Poppins_400Regular', color: t.sub, marginTop: 18 },

  simListContent: { paddingRight: 16, paddingBottom: 4 },
  simCard: { width: 208, marginRight: 12, backgroundColor: t.card, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: t.hairline, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 2 },
  simImg: { width: '100%', height: 124, backgroundColor: t.tile },
  simBody: { padding: 12, minHeight: 88 },
  simPrice: { fontFamily: 'Poppins_700Bold', fontSize: 16, color: '#0A84FF', marginBottom: 3 },
  simTitle: { fontFamily: 'Poppins_700Bold', fontSize: 14, color: t.text, marginBottom: 7 },
  simSpecs: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  simSpec: { fontFamily: 'Poppins_500Medium', fontSize: 10.5, color: t.sub, backgroundColor: t.input, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
});
