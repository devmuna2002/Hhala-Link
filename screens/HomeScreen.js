import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, ScrollView, Text, StyleSheet, Platform, TextInput, TouchableOpacity, StatusBar, ActivityIndicator, Modal, FlatList, Image, RefreshControl, Alert, Keyboard, DeviceEventEmitter } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { supabase, getSessionUser } from '../supabase';
import { NotificationService } from '../services/NotificationService';
import ListingCard from '../components/ListingCard';
import { CardVideo } from '../components/ListingCard';
import { ListingCardSkeleton } from '../components/Skeleton';
import BlurFadeCardImage from '../components/BlurFadeCardImage';
import RequestViewModal from '../components/RequestViewModal';
import { emitConnection, CONNECTION_RETRY_EVENT, isOfflineNow } from '../utils/connection';
import { listingDescription } from '../utils/listingText';
import { listingPricePrimary } from '../utils/formatPrice';
import { prefetchFeedCovers } from '../utils/imageUrl';
import { emitFeedScroll } from '../utils/feedScroll';
import { withTimeout, withRetry, isTransientError } from '../utils/network';
import { attachRatings } from '../utils/ratings';
import { useResponsiveWidth } from '../utils/useResponsiveWidth';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const RECENT_SEARCHES_KEY = 'recent_searches';
const MAX_RECENT_SEARCHES = 4;
// Old placeholder recents — purged so only real searches are kept
const FAKE_RECENTS = new Set(['harare apartments', 'borrowdale houses', 'bulawayo cottages']);
const isVideoImg = (img) => img && img.url && (img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url));

// Smart location formatter — suburb+city takes priority to show e.g. "Borrowdale, Harare"
function formatLocation(item) {
  const address = (item.address || '').trim();
  const suburb = (item.suburb || '').trim();
  const city = (item.city || '').trim();

  if (suburb && city) {
    if (suburb.toLowerCase() !== city.toLowerCase()) return `${suburb}, ${city}`;
    const neighborhood = address && address.toLowerCase() !== city.toLowerCase() ? address : '';
    return neighborhood ? `${neighborhood}, ${city}` : city;
  }
  return suburb || city || address || 'Zimbabwe';
}

// Purpose classification helpers (all rentals under Rent, all for-sale under Buy)
export const isRentalListing = (p) => {
  if (!p) return false;
  const purpose = (p.listing_purpose || '').toLowerCase();
  if (purpose === 'rent' || purpose === 'both' || !purpose) return true;
  if (p.rent_usd && Number(p.rent_usd) > 0) return true;
  return false;
};

export const isSaleListing = (p) => {
  if (!p) return false;
  const purpose = (p.listing_purpose || '').toLowerCase();
  if (purpose === 'sale' || purpose === 'both') return true;
  if (p.sale_price_usd && Number(p.sale_price_usd) > 0) return true;
  return false;
};

function TrendingMedia({ images, style }) {
  const list = images || [];
  const first = list.find(img => isVideoImg(img));
  const cover = list.find(img => !isVideoImg(img));
  const url = (cover && cover.url) || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994';
  if (first) {
    return <CardVideo uri={first.url} fallbackUri={url} style={style} />;
  }
  return <BlurFadeCardImage uri={url} style={style} />;
}

// Highlights the matched part of a suggestion/recent label
function HighlightText({ text, q, style }) {
  if (!q) return <Text style={style}>{text}</Text>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <Text style={style}>{text}</Text>;
  return (
    <Text style={style}>
      {text.slice(0, i)}
      <Text style={styles.suggestionHighlight}>{text.slice(i, i + q.length)}</Text>
      {text.slice(i + q.length)}
    </Text>
  );
}

const CATEGORIES = [
  { id: 'all', name: 'Real Estate', icon: 'business' },
  { id: 'house', name: 'House', icon: 'home' },
  { id: 'apartment', name: 'Apartment', icon: 'business' },
  { id: 'hotel', name: 'Hotel', icon: 'bed' },
  { id: 'villa', name: 'Villa', icon: 'home' },
  { id: 'cottage', name: 'Cottages', icon: 'leaf' },
  { id: 'room', name: 'Rooms', icon: 'grid' },
  { id: 'offices', name: 'Offices', icon: 'briefcase' },
];

const CITIES = [
  'All Locations',
  'Harare',
  'Bulawayo',
  'Mutare',
  'Gweru',
  'Masvingo',
  'Kwekwe',
  'Chinhoyi',
  'Victoria Falls',
];

export default function HomeScreen({ navigation }) {
  const screenWidth = useResponsiveWidth();
  const [listings, setListings] = useState([]);
  const [featuredListings, setFeaturedListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPurpose, setSelectedPurpose] = useState('rent'); // 'rent' | 'sale' | 'all'
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentLocation, setCurrentLocation] = useState('All Locations');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [savedProperties, setSavedProperties] = useState([]);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
  const [locating, setLocating] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const listingsLoadedOnce = useRef(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const lastLoadedQuery = useRef(null);
  const didMountSearch = useRef(false);
  const flatListRef = useRef(null);

  // Reset Home to default when the Home tab is tapped while already focused
  useEffect(() => {
    const unsub = navigation.addListener('tabPress', () => {
      if (!navigation.isFocused()) return;
      setSearchQuery('');
      setSelectedPurpose('rent');
      setSelectedCategory('all');
      setCurrentLocation('All Locations');
      setShowSuggestions(false);
      setSuggestions([]);
      setSearchFocused(false);
      Keyboard.dismiss();
      lastLoadedQuery.current = null;
      loadListings(true);
      flatListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    });
    return unsub;
  }, [navigation]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(RECENT_SEARCHES_KEY)
      .then(raw => {
        if (cancelled) return;
        let parsed = (raw ? JSON.parse(raw) : []).filter(r => !FAKE_RECENTS.has(String(r).toLowerCase()));
        if (!Array.isArray(parsed)) parsed = [];
        setRecentSearches(parsed);
        AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(parsed)).catch(() => {});
      })
      .catch(() => { if (!cancelled) setRecentSearches([]); });
    return () => { cancelled = true; };
  }, []);

  const saveRecentSearch = async (query) => {
    const q = (query || '').trim();
    if (!q) return;
    let updated = [];
    setRecentSearches(prev => {
      updated = [q, ...prev.filter(r => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT_SEARCHES);
      return updated;
    });
    try { await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated)); } catch {}
  };

  const removeRecentSearch = async (query) => {
    const updated = recentSearches.filter(r => r !== query);
    setRecentSearches(updated);
    try { await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated)); } catch {}
  };

  const commitSearch = (rawQuery) => {
    const query = (rawQuery !== undefined && rawQuery !== null ? rawQuery : searchQuery).trim();
    setSearchQuery(query);
    lastLoadedQuery.current = query;
    saveRecentSearch(query);
    setShowSuggestions(false);
    setSuggestions([]);
    setSearchFocused(false);
    Keyboard.dismiss();
  };

  const handleSelectSuggestion = (s) => {
    setSearchQuery(s);
    commitSearch(s);
  };

  // Instant local pool: recents first, then rich property details
  // (cities, suburbs like "Msasa Park", "3 rooms", "Full House",
  //  and feature phrases pulled from descriptions e.g. "tiles", "borehole")
  const buildSearchPool = useCallback(() => {
    const TYPE_LABELS = {
      house: 'Full House', villa: 'Villa', apartment: 'Apartment', flat: 'Flat',
      cottage: 'Cottage', studio: 'Studio', room: 'Single Room',
      shops: 'Shop', offices: 'Office', stands: 'Stand',
    };
    const pool = [];
    const push = (v) => {
      const t = (v || '').trim();
      if (t.length >= 3 && !pool.some(x => x.toLowerCase() === t.toLowerCase())) pool.push(t);
    };

    recentSearches.forEach(push);
    CITIES.forEach(c => { if (c !== 'All Locations') push(c); });

    [...listings, ...featuredListings].forEach(p => {
      push(p.title);
      push(p.suburb);
      push(p.city);
      if (p.suburb && p.city && p.suburb.toLowerCase() !== p.city.toLowerCase()) {
        push(`${p.suburb}, ${p.city}`);
      }
      const typeLabel = TYPE_LABELS[(p.property_type || '').toLowerCase()];
      if (typeLabel) push(typeLabel);
      if (p.bedrooms) {
        push(`${p.bedrooms} rooms`);
        push(`${p.bedrooms} bedroom${p.bedrooms > 1 ? 's' : ''}`);
        if (typeLabel) push(`${p.bedrooms} bedroom ${typeLabel}`);
      }
      // Feature/detail fragments from the description ("Tiles", "Solar backup", ...)
      (p.description || '')
        .split(/[,;.()]|\bwith\b|\band\b|\bof\b/i)
        .map(s => s.trim())
        .filter(s => s.length >= 4 && s.split(/\s+/).length <= 4 && /[a-z]/i.test(s))
        .slice(0, 6)
        .forEach(push);
    });
    return pool;
  }, [recentSearches, listings, featuredListings]);

  // Recent searches filter themselves as you type (Facebook-style)
  const matchingRecents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return recentSearches.slice(0, 3);
    return recentSearches.filter(r => r.toLowerCase().includes(q)).slice(0, 3);
  }, [recentSearches, searchQuery]);

  // Suggestions: instant local matches, merged with remote Supabase hints
  const finalSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || /\s$/.test(searchQuery)) return [];
    const out = [];
    const seen = new Set();
    for (const s of buildSearchPool()) {
      const l = s.toLowerCase();
      if (l.includes(q) && !seen.has(l)) { seen.add(l); out.push(s); }
      if (out.length >= 6) break;
    }
    for (const s of suggestions) {
      const key = (s || '').toLowerCase();
      if (key && !seen.has(key)) { seen.add(key); out.push(s); }
    }
    return out.slice(0, 7);
  }, [searchQuery, buildSearchPool, suggestions]);

  // Remote title/city/suburb hints merged into the local matches above
  useEffect(() => {
    const fetchSuggestions = async () => {
      const q = searchQuery.trim();
      if (q.length >= 2) {
        const mySeq = ++suggestSeq.current;
        try {
          const { data, error } = await supabase
            .from('properties')
            .select('title, city, suburb')
            .eq('status', 'available')
            .or(`title.ilike.%${q}%,city.ilike.%${q}%,suburb.ilike.%${q}%`)
            .limit(6);

          if (error) throw error;
          // A slower earlier keystroke must never overwrite results for the
          // newer query the user has already typed.
          if (mySeq !== suggestSeq.current) return;

          const combined = new Set();
          (data || []).forEach(item => {
            if ((item.city || '').toLowerCase().includes(q.toLowerCase())) combined.add(item.city);
            if ((item.suburb || '').toLowerCase().includes(q.toLowerCase())) combined.add(item.suburb);
            if ((item.title || '').toLowerCase().includes(q.toLowerCase())) combined.add(item.title);
          });
          setSuggestions(Array.from(combined).filter(Boolean).slice(0, 5));
          setShowSuggestions(true);
        } catch (e) {
          setSuggestions([]);
        }
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    };

    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Live search-as-you-type — client-side filtering handles this, no DB call needed
  useEffect(() => {
    // Close suggestions when typing stops and there's a valid query
    const q = searchQuery.trim();
    if (!q) {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  }, [searchQuery]);
  const [userData, setUserData] = useState(null);
  
  const featuredRef = useRef(null);
  const lastFeedY = useRef(0);
  const loadingRef = useRef(false);
  // Generation counter: a background ratings wave must never overwrite rows
  // from a newer load that started after it.
  const loadSeq = useRef(0);
  const suggestSeq = useRef(0);
  // Live snapshots so the background refresher always compares/queries
  // with current values instead of a stale closure.
  const listingsSnap = useRef([]);
  const featuredSnap = useRef([]);
  const feedParamsSnap = useRef({ category: 'all', city: 'All Locations' });
  const onFeedScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastFeedY.current;
    lastFeedY.current = y;
    if (Math.abs(dy) > 2) emitFeedScroll(dy);
  };
  const [activeIndex, setActiveIndex] = useState(0);
  const [requestItem, setRequestItem] = useState(null);
  // Progressive window: only the first N cards mount at once. Mounting 50
  // video-capable cards in one commit is the slowest part of feed render —
  // this keeps time-to-interactive fast and streams the rest in below the fold.
  const [visibleCount, setVisibleCount] = useState(12);

  const loadListings = async (silent = false, searchOverride = null, cityOverride = null) => {
    if (loadingRef.current) {
      setRefreshing(false);
      return;
    }
    loadingRef.current = true;
    if (!silent) setLoading(true);
    const activeCity = cityOverride !== null ? cityOverride : currentLocation;
    // Stale-while-revalidate: paint the last cached feed instantly (the
    // loader only renders when the list is empty), then silently replace it
    // with fresh rows below. Cold opens feel instant on slow connections.
    // Cache is still WRITTEN on success and READ as the offline fallback.
    try {
      try {
        const [cachedL, cachedF] = await Promise.all([
          AsyncStorage.getItem('cached_listings'),
          AsyncStorage.getItem('cached_featured_listings'),
        ]);
        if (cachedL) setListings(JSON.parse(cachedL));
        if (cachedF) setFeaturedListings(JSON.parse(cachedF));
      } catch (_) {}

      const SELECT_COLUMNS = 'id, title, rent_usd, sale_price_usd, listing_purpose, city, suburb, address, property_type, created_at, views, owner_id, bedrooms, bathrooms, area_sqm, description, property_images(url, alt_text), owner:profiles!owner_id(first_name, last_name, business_name, avatar_url, role)';

      // Built inside a factory so auto-retries below re-issue fresh queries
      // instead of re-awaiting a spent builder.
      const fetchFeedQueries = () => {
        let recentQuery = supabase
          .from('properties')
          .select(SELECT_COLUMNS)
          .eq('status', 'available')
          .order('created_at', { ascending: false });

        if (selectedCategory !== 'all') {
          recentQuery = recentQuery.eq('property_type', selectedCategory);
        }

        if (activeCity !== 'All Locations') {
          // Trailing-wildcard match: tolerates dirty data like "Harare " (trailing space)
          recentQuery = recentQuery.ilike('city', `${activeCity}%`);
        }

        return withTimeout(Promise.all([
          supabase.from('properties').select(SELECT_COLUMNS).eq('status', 'available').order('views', { ascending: false }).limit(5),
          recentQuery
        ]), 12000, 'listings');
      };

      // Transient blips (tower handoff, elevator, backend cold-start) heal
      // silently inside these retries instead of flipping the app offline.
      const [
        { data: featured },
        { data: recent, error }
      ] = await withRetry(fetchFeedQueries, { attempts: 3, baseDelayMs: 800, label: 'listings' });

      if (error) throw error;

      const listingsData = recent || [];
      // TWO-BEAT PAINT: cards render after ONE wave (feed query) instead of
      // waiting on the ratings round-trip. Ratings enrich in the background
      // and merge in when they land — time-to-first-card drops by a full
      // round-trip (~30-40% on cellular).
      const mySeq = ++loadSeq.current;
      if (featured) {
        setFeaturedListings(featured);
      }
      setListings(listingsData);
      setIsOffline(false);
      emitConnection(false);
      setLoadError(null);
      // Warm the image cache so cards paint instantly instead of popping in.
      prefetchFeedCovers(listingsData);
      console.log(`[HomeScreen] Supabase connected, loaded ${listingsData.length} listings (${featured?.length || 0} featured)`);
      AsyncStorage.setItem('cached_listings', JSON.stringify(listingsData)).catch(() => {});
      if (featured) {
        AsyncStorage.setItem('cached_featured_listings', JSON.stringify(featured)).catch(() => {});
      }
      // Beat 2 (background, non-blocking): attach ratings, then merge ONLY
      // if no newer load has started since.
      withTimeout(Promise.all([
        featured ? attachRatings(featured) : Promise.resolve(featured || []),
        attachRatings(listingsData),
      ]), 10000, 'ratings').then(([featuredWithRating, listingsWithRating]) => {
        if (loadSeq.current !== mySeq) return;
        if (featured) {
          setFeaturedListings(featuredWithRating);
          AsyncStorage.setItem('cached_featured_listings', JSON.stringify(featuredWithRating)).catch(() => {});
        }
        setListings(listingsWithRating);
        AsyncStorage.setItem('cached_listings', JSON.stringify(listingsWithRating)).catch(() => {});
      }).catch(() => {});
    } catch (err) {
      console.log('[HomeScreen] Failed to load listings, fallback path:', err.message);
      // Only transient failures mean "offline". Auth/RLS/shape errors keep
      // the app online with an inline error instead of the offline banner.
      const transient = isTransientError(err);
      if (transient) {
        setIsOffline(true);
      }
      setLoadError(err.message);
      // A query-shaped error (RLS/missing table column on the embedded owner
      // join) still allows us to render cards without the poster header.
      if (!/network|fetch|timeout/i.test(err.message || '')) {
        try {
          const plainCols = 'id, title, rent_usd, sale_price_usd, listing_purpose, city, suburb, address, property_type, created_at, views, bedrooms, bathrooms, area_sqm, description, property_images(url, alt_text), owner_id';
          let fq = supabase.from('properties').select(plainCols).eq('status', 'available').order('created_at', { ascending: false });
          if (selectedCategory !== 'all') fq = fq.eq('property_type', selectedCategory);
          if (activeCity !== 'All Locations') fq = fq.ilike('city', `${activeCity}%`);
          const { data: plainRecent, error: plainErr } = await withTimeout(fq, 12000, 'listings');
          if (!plainErr && plainRecent) {
            const plainRated = await withTimeout(attachRatings(plainRecent), 10000, 'ratings');
            setListings(plainRated);
            await AsyncStorage.setItem('cached_listings', JSON.stringify(plainRated));
            setIsOffline(false);
            emitConnection(false);
            prefetchFeedCovers(plainRated);
            return;
          }
        } catch (e2) {
          console.log('[HomeScreen] Plain query also failed:', e2.message);
        }
      }
      try {
        const cachedListingsRaw = await AsyncStorage.getItem('cached_listings');
        const cachedFeaturedRaw = await AsyncStorage.getItem('cached_featured_listings');
        if (cachedListingsRaw) {
          setListings(JSON.parse(cachedListingsRaw));
        }
        if (cachedFeaturedRaw) {
          setFeaturedListings(JSON.parse(cachedFeaturedRaw));
        }
      } catch (cacheErr) {
        console.log('Error reading from cache:', cacheErr);
      }
      // Retries are exhausted here: show cached data (already painted at the
      // top of this load) and mark the server unreachable ONLY for transient
      // failures. The radio coming back or the next successful query clears
      // it automatically — no manual retry tap required.
      if (transient) {
        emitConnection(true);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleLocationSelect = (city) => {
    setCurrentLocation(city);
    setLocationModalVisible(false);
    loadListings(false, null, city);
  };

  const detectLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Permission', 'Enable location access to auto-detect your city.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const geo = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      const g = (geo && geo[0]) || null;
      const detected = [g?.city, g?.locality, g?.district, g?.subregion, g?.region];
      const matched = CITIES.filter(c => c !== 'All Locations').find(city =>
        detected.some(v => v && String(v).toLowerCase().includes(city.toLowerCase()))
      );
      if (matched) {
        handleLocationSelect(matched);
      } else {
        handleLocationSelect('All Locations');
        Alert.alert('No Local Listings', 'No listings found in your area yet — showing all locations.');
      }
    } catch (e) {
      Alert.alert('Location Error', 'Could not detect your location. Please select a city manually.');
    } finally {
      setLocating(false);
    }
  };

  const toggleFavorite = async (property) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    if (isOffline) {
      Alert.alert('Offline Mode', 'You cannot bookmark properties while offline.');
      return;
    }

    const isFav = savedProperties.includes(property.id);
    
    // OPTIMISTIC UPDATE: Change the UI immediately!
    if (isFav) {
      setSavedProperties(prev => prev.filter(id => id !== property.id));
    } else {
      setSavedProperties(prev => [...prev, property.id]);
    }

    const user = await getSessionUser();
    if (!user) {
      // Revert if not logged in
      if (isFav) setSavedProperties(prev => [...prev, property.id]);
      else setSavedProperties(prev => prev.filter(id => id !== property.id));
      Alert.alert('Login Required', 'Please log in to save properties.');
      return;
    }

    try {
      if (isFav) {
        const { error } = await supabase.from('saved_properties').delete().eq('user_id', user.id).eq('property_id', property.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('saved_properties').insert({ user_id: user.id, property_id: property.id });
        if (error) throw error;
        // Real push for the owner on save (fire-and-forget, never self).
        try {
          if (property.owner_id && property.owner_id !== user.id) {
            const saver = [user?.user_metadata?.first_name, user?.user_metadata?.last_name].filter(Boolean).join(' ') || 'Someone';
            NotificationService.notifyUser({
              recipientId: property.owner_id,
              title: 'Saved listing',
              body: `${saver} saved your listing: ${property.title || 'your property'}.`,
              data: { propertyId: property.id },
            }).catch(() => {});
          }
        } catch (_) {}
      }
      
      // Update local storage cache of saved properties
      const updatedFavs = isFav 
        ? savedProperties.filter(id => id !== property.id)
        : [...savedProperties, property.id];
      await AsyncStorage.setItem(`cached_saved_properties_${user.id}`, JSON.stringify(updatedFavs));
    } catch (e) {
      // Revert on error
      if (isFav) setSavedProperties(prev => [...prev, property.id]);
      else setSavedProperties(prev => prev.filter(id => id !== property.id));
    }
  };

  const loadSavedProperties = async () => {
    try {
      const user = await getSessionUser();
      if (!user) return;
      
      const { data, error } = await supabase.from('saved_properties').select('property_id').eq('user_id', user.id);
      if (error) throw error;

      if (data) {
        const favIds = data.map(item => item.property_id);
        setSavedProperties(favIds);
        await AsyncStorage.setItem(`cached_saved_properties_${user.id}`, JSON.stringify(favIds));
      }
    } catch (e) {
      console.log('Error loading saved properties, falling back to cache:', e);
      try {
        const user = await getSessionUser();
        if (user) {
          const cachedFavs = await AsyncStorage.getItem(`cached_saved_properties_${user.id}`);
          if (cachedFavs) {
            setSavedProperties(JSON.parse(cachedFavs));
          }
        }
      } catch (_) {}
    }
  };

  const [avatarError, setAvatarError] = useState(false);

  const loadUserData = async () => {
    // Header only renders the avatar — fetch just that (plus id) instead
    // of the whole profile row, and keep it in a dedicated cache key so a
    // slim row can never pollute the full-profile cache ProfileScreen owns.
    try {
      const user = await getSessionUser();
      if (user) {
        const { data, error } = await supabase.from('profiles').select('id, avatar_url').eq('id', user.id).single();
        if (error) throw error;
        if (data) {
          setUserData(data);
          setAvatarError(false);
          await AsyncStorage.setItem(`cached_home_header_${user.id}`, JSON.stringify(data));
        }
      }
    } catch (e) {
      console.log('Error loading user data, falling back to cache:', e);
      try {
        const user = await getSessionUser();
        if (user) {
          const cachedProfile = await AsyncStorage.getItem(`cached_home_header_${user.id}`);
          if (cachedProfile) {
            setUserData(JSON.parse(cachedProfile));
          }
        }
      } catch (_) {}
    }
  };
  
  const updateLastSeen = async () => {
    try {
      const user = await getSessionUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({ last_seen: new Date().toISOString() })
          .eq('id', user.id);
      }
    } catch (e) {
      // Ignore offline update errors
    }
  };

  useEffect(() => {
    updateLastSeen();
    const interval = setInterval(updateLastSeen, 60000); // Heartbeat every 60s
    return () => clearInterval(interval);
  }, []);

  const fetchUnreadCount = async () => {
    try {
      const user = await getSessionUser();
      if (!user) return;
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      
      if (error) throw error;

      setUnreadNotifs(count || 0);
      await AsyncStorage.setItem(`cached_unread_notifs_${user.id}`, String(count || 0));
    } catch (e) {
      console.log('Error fetching unread count, falling back to cache:', e);
      try {
        const user = await getSessionUser();
        if (user) {
          const cachedNotifs = await AsyncStorage.getItem(`cached_unread_notifs_${user.id}`);
          if (cachedNotifs !== null) {
            setUnreadNotifs(parseInt(cachedNotifs, 10));
          }
        }
      } catch (_) {}
    }
  };

  useEffect(() => {
    fetchUnreadCount();
    // No channel subscription here: the per-user filtered notifications
    // channel in the effect below already refetches on the user's own
    // inserts/updates. A second unfiltered subscription would receive
    // EVERY user's notification events (global firehose) for no benefit.
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadSavedProperties();
        loadUserData();
        fetchUnreadCount();
      } else {
        setSavedProperties([]);
        setUserData(null);
        setUnreadNotifs(0);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const channelId = `alerts_${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'properties' },
        (payload) => {
          // New agent posts land as 'pending' (invisible in the feed until
          // admin approval) — refresh silently and celebrate only listings
          // that are actually visible, so the alert never deep-links into a
          // listing the homepage hides.
          loadListings(true);
          if (payload.new?.status !== 'available') return;
          Alert.alert(
            'New Property Alert',
            `${payload.new.title} was just listed in ${payload.new.city}. Check it out now!`,
            [
              { text: 'View Detail', onPress: () => navigation.navigate('Detail', { item: payload.new }) },
              { text: 'Later', style: 'cancel' }
            ]
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'properties' },
        () => {
          // Approvals and edits land here — silent refresh puts newly
          // approved listings on the homepage within seconds (no waiting
          // for the 60s background cycle or a manual pull).
          loadListings(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getUserLocation = async () => {
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      let location = await Location.getCurrentPositionAsync({});
      let reverse = await Location.reverseGeocodeAsync({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude
      });

      if (reverse.length > 0) {
        const detectedCity = reverse[0].city || reverse[0].region;
        const matchedCity = CITIES.find(c => c.toLowerCase() === detectedCity?.toLowerCase());
        if (matchedCity) {
          setCurrentLocation(matchedCity);
        } else {
          setCurrentLocation('All Locations');
        }
      }
    } catch (e) {
      setCurrentLocation('All Locations');
    }
  };

  const fetchUnreadCounts = async () => {
    try {
      const user = await getSessionUser();
      if (!user) return;

      // 1. Unread notifications + 2. conversation list are independent —
      // fire them together instead of back-to-back.
      const [notifRes, convsRes] = await Promise.all([
        supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('is_read', false),
        supabase
          .from('conversations')
          .select('id')
          .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`),
      ]);

      const notifCount = notifRes.count;
      if (notifCount !== null && notifCount !== undefined) {
        setUnreadNotifs(notifCount);
      }

      // 3. Unread messages across user's conversations (depends on step 2)
      const convs = convsRes.data;

      if (convs && convs.length > 0) {
        const convIds = convs.map(c => c.id);
        const { count: msgCount } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .in('conversation_id', convIds)
          .neq('sender_id', user.id)
          .neq('status', 'read');

        if (msgCount !== null && msgCount !== undefined) {
          setUnreadMessages(msgCount);
        }
      } else {
        setUnreadMessages(0);
      }
    } catch (e) {
      console.log('HomeScreen fetchUnreadCounts error:', e.message);
    }
  };

  useEffect(() => {
    getUserLocation();
    loadSavedProperties();
    loadUserData();
    fetchUnreadCounts();

    // Subscribe to realtime profile, notifications, and messages changes
    let profileChannel = null;
    let notifsChannel = null;
    let msgsChannel = null;

    getSessionUser().then((user) => {
      if (user) {
        profileChannel = supabase
          .channel(`home_profile_${user.id}_${Date.now()}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${user.id}` },
            (payload) => {
              if (payload.new) {
                setUserData(payload.new);
                setAvatarError(false);
              }
            }
          )
          .subscribe();

        notifsChannel = supabase
          .channel(`home_notifs_${user.id}_${Date.now()}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
            () => fetchUnreadCounts()
          )
          .subscribe();

        msgsChannel = supabase
          .channel(`home_messages_${user.id}_${Date.now()}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'messages' },
            () => fetchUnreadCounts()
          )
          .subscribe();
      }
    });

    return () => {
      if (profileChannel) supabase.removeChannel(profileChannel);
      if (notifsChannel) supabase.removeChannel(notifsChannel);
      if (msgsChannel) supabase.removeChannel(msgsChannel);
    };
  }, []);

  useEffect(() => {
    loadListings(false);
  }, [currentLocation, selectedCategory]);

  const filteredFeaturedListings = useMemo(() => {
    if (selectedPurpose === 'rent') {
      return featuredListings.filter(isRentalListing);
    }
    if (selectedPurpose === 'sale') {
      return featuredListings.filter(isSaleListing);
    }
    return featuredListings;
  }, [featuredListings, selectedPurpose]);

  const filteredListings = useMemo(() => {
    let list = listings;

    if (selectedPurpose === 'rent') {
      list = list.filter(isRentalListing);
    } else if (selectedPurpose === 'sale') {
      list = list.filter(isSaleListing);
    }

    const raw = (searchQuery || '').trim().toLowerCase();
    if (!raw) return list;
    const terms = raw.split(/\s+/).filter(Boolean);
    return list.filter(p => {
      const haystack = [
        p.title, p.suburb, p.city, p.property_type, p.description, p.address,
      ].filter(Boolean).join(' ').toLowerCase();
      // Match if the full query appears as a phrase, OR every individual word appears somewhere
      return haystack.includes(raw) || terms.every(t => haystack.includes(t));
    });
  }, [listings, searchQuery, selectedPurpose]);

  // Reset the progressive window only when the FILTERS change — never on
  // data refreshes, so background rating merges can't collapse a scrolled list.
  useEffect(() => {
    setVisibleCount(12);
  }, [searchQuery, selectedPurpose, selectedCategory, currentLocation]);
  // Grow the window in chunks after paint until every card is mounted.
  const visibleListings = filteredListings.slice(0, visibleCount);
  useEffect(() => {
    if (visibleCount >= filteredListings.length) return;
    const t = setTimeout(() => {
      setVisibleCount((c) => Math.min(c + 16, filteredListings.length));
    }, 350);
    return () => clearTimeout(t);
  }, [visibleCount, filteredListings.length]);

  useFocusEffect(
    useCallback(() => {
      loadUserData();
      fetchUnreadCounts();
      loadSavedProperties();
      // Only do a full listings reload on first focus (and via pull-to-refresh),
      // so re-tapping the Home tab / re-focusing doesn't refresh and jump to top.
      if (!listingsLoadedOnce.current) {
        listingsLoadedOnce.current = true;
        loadListings(true);
      }
    }, [])
  );

  // Tapping the tab-bar connection banner retries this feed. The ref always
  // holds the latest loadListings closure so filters/location stay current.
  const loadRef = useRef(null);
  loadRef.current = () => loadListings();
  listingsSnap.current = listings;
  featuredSnap.current = featuredListings;
  feedParamsSnap.current = { category: selectedCategory, city: currentLocation };

  // Idle guard (declared BEFORE quietRefresh): never refresh mid-interaction
  // (searching / filtering / pull-to-refresh) — image reloads there read as
  // flicker. Updated every render so the interval always sees live values.
  const focusedRef = useRef(true);
  const uiBusyRef = useRef(false);
  uiBusyRef.current = searchFocused || showSuggestions || purposeOpen || locationModalVisible || refreshing || loading;

  // Stable merge: reuse the PREVIOUS object reference for any row whose
  // display signature is unchanged. Memoized ListingCard then skips those
  // rows entirely — their expo-image bitmap is never torn down (no flicker).
  // Returns null when nothing visible changed, so we write ZERO state.
  const mergeStable = (oldList, newList) => {
    const oldById = new Map((oldList || []).map(p => [String(p.id), p]));
    const rowSig = (p) => [
      p.title, p.city, p.suburb, p.address, p.property_type,
      p.rent_usd, p.sale_price_usd, p.listing_purpose,
      p.bedrooms, p.bathrooms, p.area_sqm, p.views,
      p.average_rating, p.review_count,
      (p.property_images || []).map(i => `${i?.url}|${i?.alt_text || ''}`).join(','),
      p.owner?.avatar_url, p.owner?.business_name, p.owner?.first_name, p.owner?.last_name, p.owner?.role,
    ].join('~');
    if ((oldList || []).length !== (newList || []).length) {
      // Length changed — still reuse refs for unchanged rows.
      return (newList || []).map(n => {
        const o = oldById.get(String(n.id));
        return (o && rowSig(o) === rowSig(n)) ? o : n;
      });
    }
    let changed = false;
    const out = (newList || []).map((n, idx) => {
      const o = oldById.get(String(n.id));
      // Order change also counts (feed reorder must repaint order only).
      const oldAtIdx = (oldList || [])[idx];
      if (!o || String(oldAtIdx?.id) !== String(n.id) || rowSig(o) !== rowSig(n)) {
        changed = true;
        return n;
      }
      return o;
    });
    return changed ? out : null;
  };

  // Truly background refresh: single attempt per cycle, and ZERO UI state
  // writes unless the fresh payload actually differs — no spinner, no
  // flicker, no scroll jumps. Unchanged rows keep their object identity so
  // memoized cards + pinned expo-images never reload.
  const quietRefresh = async () => {
    if (loadingRef.current) return;
    if (uiBusyRef.current) return;
    loadingRef.current = true;
    try {
      const { category, city } = feedParamsSnap.current;
      const SELECT = 'id, title, rent_usd, sale_price_usd, listing_purpose, city, suburb, address, property_type, created_at, views, owner_id, bedrooms, bathrooms, area_sqm, description, property_images(url, alt_text), owner:profiles!owner_id(first_name, last_name, business_name, avatar_url, role)';
      let rq = supabase.from('properties').select(SELECT).eq('status', 'available').order('created_at', { ascending: false });
      if (category !== 'all') rq = rq.eq('property_type', category);
      if (city !== 'All Locations') rq = rq.ilike('city', `${city}%`);
      const [{ data: feat }, { data: rec, error }] = await withTimeout(Promise.all([
        supabase.from('properties').select(SELECT).eq('status', 'available').order('views', { ascending: false }).limit(5),
        rq,
      ]), 12000, 'listings');
      if (error) throw error;
      const recRated = await withTimeout(attachRatings(rec || []), 10000, 'ratings');
      const mergedRec = mergeStable(listingsSnap.current, recRated);
      if (mergedRec) {
        setListings(mergedRec);
        await AsyncStorage.setItem('cached_listings', JSON.stringify(mergedRec));
      }
      if (feat) {
        const featRated = await withTimeout(attachRatings(feat), 10000, 'ratings');
        const mergedFeat = mergeStable(featuredSnap.current, featRated);
        if (mergedFeat) {
          setFeaturedListings(mergedFeat);
          await AsyncStorage.setItem('cached_featured_listings', JSON.stringify(mergedFeat));
        }
      }
    } catch (_) { /* silent: next cycle retries */ }
    finally {
      loadingRef.current = false;
    }
  };
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CONNECTION_RETRY_EVENT, () => {
      try { loadRef.current?.(); } catch (_) {}
    });
    return () => sub.remove();
  }, []);

  // Background auto-refresh every 60s while connected, focused, and idle.
  // Uses quietRefresh: single attempt, single-flight, zero polling while
  // offline, and no UI churn unless data actually changed.
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    return () => { focusedRef.current = false; };
  }, []));
  useEffect(() => {
    const t = setInterval(() => {
      if (!isOfflineNow() && focusedRef.current) {
        quietRefresh().catch(() => {});
      }
    }, 60000);
    return () => clearInterval(t);
  }, []);

  // Reset active carousel index when filteredFeaturedListings changes
  useEffect(() => {
    setActiveIndex(0);
    try {
      featuredRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    } catch (e) {}
  }, [filteredFeaturedListings.length, selectedPurpose]);

  // Auto-slide the trending carousel every 5s. Manual swipes update
  // activeIndex via onMomentumScrollEnd, and the timer continues from there.
  // Dragging pauses auto-slide for 8s so it never fights the user's finger.
  const lastCarouselTouch = useRef(0);
  useEffect(() => {
    if (filteredFeaturedListings.length < 2) return;
    const t = setInterval(() => {
      if (Date.now() - lastCarouselTouch.current < 8000) return;
      setActiveIndex((prev) => {
        const next = (prev + 1) % filteredFeaturedListings.length;
        try {
          featuredRef.current?.scrollToIndex({ index: next, animated: true });
        } catch (e) {}
        return next;
      });
    }, 5000);
    return () => clearInterval(t);
  }, [filteredFeaturedListings.length]);

  const onRefresh = () => {
    setRefreshing(true);
    loadUserData();
    fetchUnreadCounts();
    loadSavedProperties();
    loadListings();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Location Selection — Threads-style bottom sheet */}
      <Modal visible={locationModalVisible} transparent animationType="slide" onRequestClose={() => setLocationModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.locationModal}>
            <View style={styles.sheetHandle} />
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select city</Text>
              <TouchableOpacity onPress={() => setLocationModalVisible(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={24} color="#111111" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={CITIES}
              keyExtractor={item => item}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <TouchableOpacity style={styles.locateRow} onPress={detectLocation} activeOpacity={0.7}>
                  <View style={styles.locateIconBox}>
                    {locating ? (
                      <ActivityIndicator size="small" color="#111111" />
                    ) : (
                      <Ionicons name="locate" size={20} color="#111111" />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.locateTitle}>{locating ? 'Detecting location…' : 'Use my current location'}</Text>
                    <Text style={styles.locateSub}>Automatically pick the city you're in</Text>
                  </View>
                </TouchableOpacity>
              }
              renderItem={({ item }) => {
                const isSelected = currentLocation === item;
                return (
                  <TouchableOpacity
                    style={styles.cityItem}
                    onPress={() => handleLocationSelect(item)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.cityText, isSelected && styles.cityTextActive]}>{item}</Text>
                    {isSelected && (
                      <Ionicons name="checkmark" size={22} color="#111111" />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.locationContainer} onPress={() => setLocationModalVisible(true)}>
          <View style={styles.locIconBox}>
            <Ionicons name="map" size={18} color="#111111" />
          </View>
          <View style={{ marginLeft: 12, flexShrink: 1 }}>
            <Text style={styles.locLabel}>Location</Text>
            <Text style={[styles.locText, { numberOfLines: 1 }]} numberOfLines={1}>{currentLocation}</Text>
          </View>
          <Ionicons name="chevron-down" size={16} color="#8E8E93" style={{ marginLeft: 6 }} />
        </TouchableOpacity>
        
        <View style={styles.headerRight}>
          {/* Profile Avatar */}
          <TouchableOpacity
            style={{ marginRight: 8 }}
            onPress={() => navigation.navigate('Profile')}
            activeOpacity={0.8}
          >
            {userData?.avatar_url && !avatarError ? (
              <Image 
                key={userData.avatar_url} 
                source={{ uri: userData.avatar_url }} 
                style={styles.avatarMini} 
                onError={() => setAvatarError(true)}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={22} color="#0A84FF" />
              </View>
            )}
          </TouchableOpacity>

          {/* Messages Icon with Dynamic Badge Counter */}
          <TouchableOpacity 
            style={[styles.iconBtn, { marginRight: 8 }]} 
            onPress={() => navigation.navigate('UserList')}
            activeOpacity={0.7}
          >
            <View style={{ position: 'relative' }}>
              <Ionicons name="paper-plane" size={24} color="#8A8A8A" />
              {unreadMessages > 0 && (
                <View style={styles.counterBadge}>
                  <Text style={styles.counterBadgeText}>
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar + Suggestions */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <View style={styles.searchIconBox}>
            <Ionicons name="search" size={20} color="#8A8A8A" />
          </View>
          <TextInput 
            placeholder="Search" 
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            onSubmitEditing={() => commitSearch()}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              onPress={() => {
                setSearchQuery('');
                lastLoadedQuery.current = null;
                setShowSuggestions(false);
                setSuggestions([]);
                Keyboard.dismiss();
              }}
            >
              <Ionicons name="close-circle" size={20} color="#8A8A8A" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.filterBtn} onPress={() => setPurposeOpen(true)}>
            <Ionicons name="options" size={20} color="#8A8A8A" />
          </TouchableOpacity>
        </View>

        {(searchFocused || showSuggestions) && (matchingRecents.length > 0 || finalSuggestions.length > 0) && (
          <View style={styles.suggestionsDropdown}>
            {matchingRecents.length > 0 && (
              <>
                <Text style={styles.sugLabel}>RECENT SEARCHES</Text>
                {matchingRecents.map((r) => (
                  <View key={r} style={styles.suggestionItem}>
                    <TouchableOpacity
                      style={styles.suggestionMain}
                      onPress={() => handleSelectSuggestion(r)}
                    >
                      <Ionicons name="time" size={20} color="#8E8E93" />
                      <HighlightText text={r} q={searchQuery.trim()} style={styles.suggestionText} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.sugRemove}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => removeRecentSearch(r)}
                    >
                      <Ionicons name="close-circle" size={20} color="#C7C7CC" />
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}
            {finalSuggestions.length > 0 && (
              <>
                <Text style={styles.sugLabel}>SUGGESTIONS</Text>
                {finalSuggestions.map((s) => (
                  <TouchableOpacity
                    key={`sug-${s}`}
                    style={styles.suggestionItem}
                    onPress={() => handleSelectSuggestion(s)}
                  >
                    <Ionicons name="map" size={16} color="#8E8E93" />
                    <HighlightText text={s} q={searchQuery.trim()} style={styles.suggestionText} />
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        )}
      </View>

      <FlatList
        ref={flatListRef}
        // Keep every row mounted: Android unmounts off-screen views by
        // default, which makes pictures/videos reload + flash on scroll-back.
        removeClippedSubviews={false}
        ListHeaderComponent={
          <>
            {/* Top Rated Hero Card */}
            {filteredFeaturedListings.length > 0 && (
              <View style={styles.trendingSection}>
                <FlatList
                  ref={featuredRef}
                  data={filteredFeaturedListings}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  // Keep all hero slides mounted so swiping back never
                  // reloads pictures/videos (no flicker).
                  removeClippedSubviews={false}
                  keyExtractor={item => `trending-${item.id}`}
                  onScrollBeginDrag={() => { lastCarouselTouch.current = Date.now(); }}
                  onScrollToIndexFailed={(info) => {
                    setTimeout(() => {
                      try {
                        featuredRef.current?.scrollToIndex({ index: Math.min(info.index, filteredFeaturedListings.length - 1), animated: false });
                      } catch (e) {}
                    }, 300);
                  }}
                  onMomentumScrollEnd={(e) => {
                    const index = Math.round(e.nativeEvent.contentOffset.x / (screenWidth - 36));
                    setActiveIndex(index);
                  }}
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      style={[styles.trendingCard, { width: screenWidth - 36 }]} 
                      activeOpacity={0.92}
                      onPress={() => navigation.navigate('Detail', { item })}
                    >
                      <TrendingMedia images={item.property_images} style={styles.trendingImg} />
                      <LinearGradient
                        pointerEvents="none"
                        colors={['rgba(0,0,0,0.25)', 'transparent', 'rgba(0,0,0,0.7)']}
                        locations={[0, 0.35, 1.0]}
                        style={StyleSheet.absoluteFill}
                      />
                      <View style={styles.topRatedBadge}>
                        <Ionicons name="star" size={16} color="#F59E0B" />
                        <Text style={styles.topRatedBadgeText}>Top Rated</Text>
                      </View>
                      <View style={styles.trendingBottom}>
                        <Text style={styles.trendingTitle} numberOfLines={1}>{item.title}</Text>
                        <Text style={styles.trendingLocation} numberOfLines={1}>
                          {formatLocation(item)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )}
                />
                <View style={styles.pagination}>
                  {filteredFeaturedListings.map((_, i) => (
                    <View key={i} style={[styles.dot, activeIndex === i && styles.activeDot]} />
                  ))}
                </View>
              </View>
            )}

            {/* Categories — Threads-style text tabs (no pills): gray idle,
                black + underline when active */}
            <View style={styles.categoriesSection}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
                {CATEGORIES.map(cat => {
                  const active = selectedCategory === cat.id;
                  return (
                      <TouchableOpacity
                        key={cat.id}
                        style={[styles.categoryTab, active && styles.categoryTabActive]}
                        activeOpacity={0.7}
                        hitSlop={{ top: 8, bottom: 8 }}
                        onPress={() => {
                          try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                          setSelectedCategory(cat.id);
                        }}
                      >
                        <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{cat.name}</Text>
                      </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Listings — stacked vertically like Dreamscape mockup */}
            {loading && filteredListings.length === 0 ? (
              <View style={styles.listingsContainer}>
                {[0, 1, 2].map((i) => (
                  <ListingCardSkeleton key={`skel-${i}`} wide />
                ))}
              </View>
            ) : filteredListings.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="search" size={60} color="#D1D1D6" />
                <Text style={styles.emptyTitle}>No properties found</Text>
                <Text style={styles.emptySubtitle}>Try changing your category or location.</Text>
              </View>
            ) : (
              <View style={styles.listingsContainer}>
                {visibleListings.map((item, idx) => (
                  <View key={String(item?.id ?? idx)}>
                    <ListingCard
                      item={item}
                      wide={true}
                      onPress={() => navigation.navigate('Detail', { item })}
                      onFavorite={toggleFavorite}
                      isFavorite={item ? savedProperties.includes(item.id) : false}
                    />
                    {idx < visibleListings.length - 1 && <View style={styles.listingDivider} />}
                  </View>
                ))}
              </View>
            )}
          </>
        }
        data={[]}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScroll={onFeedScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#0A84FF']} progressBackgroundColor="#FFFFFF" />}
      />
      <RequestViewModal
        visible={!!requestItem}
        item={requestItem}
        onClose={() => setRequestItem(null)}
        onFavorite={toggleFavorite}
        isFavorite={requestItem ? savedProperties.includes(requestItem.id) : false}
      />

      {/* Purpose dropdown modal */}
      <Modal
        visible={purposeOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPurposeOpen(false)}
      >
        <TouchableOpacity
          style={styles.purposeOverlay}
          activeOpacity={1}
          onPress={() => setPurposeOpen(false)}
        >
          <View style={styles.purposeSheet}>
            <View style={styles.purposeSheetHandle} />
            <Text style={styles.purposeSheetTitle}>Show properties</Text>
            {(['rent', 'sale', 'all']).map(opt => {
              const label = opt === 'rent' ? 'Rent' : opt === 'sale' ? 'Buy' : 'All Properties';
              const active = selectedPurpose === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[styles.purposeOption, active && styles.purposeOptionActive]}
                  activeOpacity={0.8}
                  onPress={() => {
                    setSelectedPurpose(opt);
                    setPurposeOpen(false);
                    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                  }}
                >
                  <Text style={[styles.purposeOptionText, active && styles.purposeOptionTextActive]}>{label}</Text>
                  {active ? <Ionicons name="checkmark" size={17} color="#FFFFFF" style={{ marginLeft: 'auto' }} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 16, 
    paddingTop: Platform.OS === 'ios' ? 58 : 42,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  locationContainer: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: 8 },
  locIconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#EAF3FF', justifyContent: 'center', alignItems: 'center' },
  locLabel: { fontSize: 11, fontWeight: '500', color: '#8E8E93' },
  locText: { fontSize: 15, fontWeight: '700', color: '#000000' },
  headerRight: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  iconBtn: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    backgroundColor: '#F2F2F7', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  avatarMini: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#007AFF' },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EAF3FF', justifyContent: 'center', alignItems: 'center' },
  counterBadge: {
    position: 'absolute',
    top: -9,
    right: -5,
    minWidth: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counterBadgeText: {
    color: '#FF3B30',
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    textAlign: 'center',
  },

  searchSection: { 
    paddingHorizontal: 18, 
    paddingTop: 10, 
    paddingBottom: 4,
    marginBottom: 12, 
    zIndex: 100 
  },
  searchBar: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#F0F0F0', 
    height: 46, 
    borderRadius: 23, 
    paddingLeft: 14, 
    paddingRight: 14, 
  },
  searchIconBox: {
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 2,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15, color: '#111111', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }) },
  clearBtn: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 6,
  },
  filterBtn: { 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingLeft: 10,
  },
  
  suggestionsDropdown: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 12,
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
    zIndex: 1000
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA'
  },
  suggestionMain: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  suggestionText: { fontSize: 14, color: '#000000', flex: 1, marginLeft: 8 },
  sugLabel: { fontSize: 11, fontWeight: '600', color: '#8E8E93', letterSpacing: 0.5, paddingHorizontal: 10, paddingTop: 4 },
  suggestionHighlight: { color: '#007AFF', fontWeight: '600' },
  sugRemove: { paddingLeft: 10, paddingVertical: 4 },

  // Location bottom sheet — Threads style
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  locationModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 8,
    maxHeight: '75%',
  },
  sheetHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#D9D9D9',
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#111111' },
  cityItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFEFEF' },
  cityText: { flex: 1, fontSize: 15, color: '#111111' },
  cityTextActive: { fontWeight: '600' },
  locateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  locateIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F0F0F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  locateTitle: { fontSize: 15, fontWeight: '600', color: '#111111' },
  locateSub: { fontSize: 13, color: '#8A8A8A', marginTop: 2 },

  trendingSection: { marginTop: 4, marginBottom: 18 },
  trendingCard: { height: 220, marginHorizontal: 18, borderRadius: 24, overflow: 'hidden', backgroundColor: '#E5E7EB', position: 'relative' },
  trendingImg: { width: '100%', height: '100%' },
  topRatedBadge: { 
    position: 'absolute', 
    top: 14, 
    left: 14, 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(255,255,255,0.92)', 
    paddingHorizontal: 11, 
    paddingVertical: 5, 
    borderRadius: 16,
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  topRatedBadgeText: { color: '#111827', fontSize: 11.5, fontFamily: 'Poppins_600SemiBold', marginLeft: 4 },
  trendingBottom: { position: 'absolute', bottom: 22, left: 16, right: 16, zIndex: 2 },
  trendingTitle: { color: '#FFFFFF', fontSize: 20, fontFamily: 'Poppins_900Black', marginBottom: 2, letterSpacing: -0.3 },
  trendingLocation: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, fontFamily: 'Poppins_400Regular' },
  trendingDesc: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    lineHeight: 16,
    marginTop: 6,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    overflow: 'hidden',
  },

  pagination: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D5DB', marginHorizontal: 3 },
  activeDot: { width: 18, height: 6, borderRadius: 3, backgroundColor: '#111111' },

  categoriesSection: { marginBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFEFEF', paddingVertical: 10 },
  categoriesScroll: { paddingHorizontal: 18 },
  // Captioning pills: light gray idle, solid black + white text when active.
  categoryTab: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: '#F2F2F7',
    marginRight: 10,
  },
  categoryTabActive: {
    backgroundColor: '#111111',
  },
  categoryText: { color: '#6E6E73', fontSize: 15, fontFamily: 'Poppins_600SemiBold' },
  categoryTextActive: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold' },

  listingsContainer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  listingDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E5EA',
    marginVertical: 10,
  },
  listContent: { paddingBottom: 90, paddingTop: 6 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 12 },
  gridItemWrapper: { width: '48%', marginBottom: 14 },
  listingsGridContent: { paddingBottom: 24 },
  listingsLoadingWrap: { alignItems: 'center', paddingVertical: 40 },

  emptyContainer: { alignItems: 'center', marginTop: 40, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#000000', marginTop: 16 },
  emptySubtitle: { fontSize: 14, color: '#8E8E93', marginTop: 6, textAlign: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF4E5',
    borderWidth: 1,
    borderColor: '#FFD8A8',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12.5,
    fontWeight: '500',
    color: '#B26A00',
  },
  errorBannerRetry: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#007AFF',
  },

  // Purpose dropdown (Rent / Buy / All)
  purposeToggleWrap: {
    paddingHorizontal: 16,
    marginBottom: 18,
    marginTop: 10,
  },
  purposeDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EAF3FF',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  purposeDropdownText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0A84FF',
  },
  purposeOverlay: {
    flex: 1,
    backgroundColor: 'rgba(4,9,26,0.5)',
    justifyContent: 'flex-end',
  },
  purposeSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 34,
  },
  purposeSheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E5',
    marginBottom: 14,
  },
  purposeSheetTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  purposeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F5F7FA',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 10,
  },
  purposeOptionActive: {
    backgroundColor: '#0A84FF',
  },
  purposeOptionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#101828',
  },
  purposeOptionTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
