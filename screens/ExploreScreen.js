import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, ScrollView, Text, StyleSheet, Platform, TextInput, TouchableOpacity, StatusBar, ActivityIndicator, FlatList, Image, RefreshControl, Alert, Keyboard, Modal, DeviceEventEmitter } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { supabase, getSessionUser } from '../supabase';
import { NotificationService } from '../services/NotificationService';
import ListingCard, { CardVideo } from '../components/ListingCard';
import { ListingCardSkeleton } from '../components/Skeleton';
import BlurFadeCardImage from '../components/BlurFadeCardImage';
import RequestViewModal from '../components/RequestViewModal';
import { emitConnection, CONNECTION_RETRY_EVENT, isOfflineNow } from '../utils/connection';
import { listingPricePrimary } from '../utils/formatPrice';
import { listingDescription } from '../utils/listingText';
import { attachRatings } from '../utils/ratings';
import { useResponsiveWidth } from '../utils/useResponsiveWidth';
import { emitFeedScroll } from '../utils/feedScroll';
import { withTimeout, withRetry, isTransientError } from '../utils/network';
import { prefetchFeedCovers } from '../utils/imageUrl';
import { Ionicons } from '@expo/vector-icons';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const isVideoImg = (img) => img && img.url && (img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url));

// Purpose classification helpers
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

const CATEGORIES = [
  { id: 'all', name: 'All', icon: 'apps' },
  { id: 'house', name: 'Houses', icon: 'home' },
  { id: 'villa', name: 'Villas', icon: 'business' },
  { id: 'apartment', name: 'Apartments', icon: 'business' },
  { id: 'cottage', name: 'Cottages', icon: 'leaf' },
  { id: 'studio', name: 'Studios', icon: 'grid' },
  { id: 'room', name: 'Rooms', icon: 'bed' },
  { id: 'shops', name: 'Shops', icon: 'cart' },
  { id: 'offices', name: 'Offices', icon: 'briefcase' },
  { id: 'stands', name: 'Stands', icon: 'map' },
];

const RECENT_SEARCHES_KEY = 'explore_recent_searches';
const MAX_RECENT = 5;

export default function ExploreScreen({ navigation, route }) {
  const screenWidth = useResponsiveWidth();
  const [listings, setListings] = useState([]);
  const [featuredListings, setFeaturedListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savedProperties, setSavedProperties] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const initialCategory = route.params?.category || 'all';
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  const initialPurpose = route.params?.purpose || 'rent';
  const [selectedPurpose, setSelectedPurpose] = useState(initialPurpose); // 'rent' | 'sale' | 'all'
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const lastLoadedQuery = useRef(null);
  const didMountSearch = useRef(false);
  
  const featuredRef = useRef(null);
  const lastFeedY = useRef(0);
  const loadingRef = useRef(false);
  // Generation counter: a background ratings wave must never overwrite rows
  // from a newer load that started after it.
  const loadSeq = useRef(0);
  const suggestSeq = useRef(0);
  const onFeedScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastFeedY.current;
    lastFeedY.current = y;
    if (Math.abs(dy) > 2) emitFeedScroll(dy);
  };
  const [activeIndex, setActiveIndex] = useState(0);
  const [requestItem, setRequestItem] = useState(null);
  // Dragging pauses trending auto-slide for 8s so it never fights the finger.
  const lastCarouselTouch = useRef(0);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(RECENT_SEARCHES_KEY).then(raw => {
      if (cancelled) return;
      let parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) parsed = [];
      setRecentSearches(parsed);
    }).catch(() => { if (!cancelled) setRecentSearches([]); });
    return () => { cancelled = true; };
  }, []);

  const saveRecentSearch = async (query) => {
    const q = (query || '').trim();
    if (!q) return;
    let updated = [];
    setRecentSearches(prev => {
      updated = [q, ...prev.filter(r => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
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
    loadListings(true);
  };

  const handleSelectSuggestion = (s) => {
    setSearchQuery(s);
    commitSearch(s);
  };

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
    [...listings, ...featuredListings].forEach(p => {
      push(p.title);
      push(p.suburb);
      push(p.city);
      if (p.suburb && p.city && p.suburb.toLowerCase() !== p.city.toLowerCase()) push(`${p.suburb}, ${p.city}`);
      const typeLabel = TYPE_LABELS[(p.property_type || '').toLowerCase()];
      if (typeLabel) push(typeLabel);
      if (p.bedrooms) {
        push(`${p.bedrooms} rooms`);
        push(`${p.bedrooms} bedroom${p.bedrooms > 1 ? 's' : ''}`);
      }
    });
    return pool;
  }, [recentSearches, listings, featuredListings]);

  const matchingRecents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return recentSearches.slice(0, 3);
    return recentSearches.filter(r => r.toLowerCase().includes(q)).slice(0, 3);
  }, [recentSearches, searchQuery]);

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
        } catch { setSuggestions([]); }
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    };
    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!didMountSearch.current) { didMountSearch.current = true; return; }
    const q = searchQuery.trim();
    if (lastLoadedQuery.current === q) return;
    const t = setTimeout(() => {
      lastLoadedQuery.current = q;
      loadListings(true);
    }, 450);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const loadListings = async (silent = false) => {
    if (loadingRef.current) {
      setRefreshing(false);
      return;
    }
    loadingRef.current = true;
    if (!silent) setLoading(true);
    // Silent (search-as-you-type / retry) never shows the pull-to-refresh
    // spinner — a flashing spinner + list rebuild on every keystroke reads
    // as image flicker.
    // Stale-while-revalidate: paint the last cached feed instantly (the
    // loader only renders when the list is empty), then silently replace it
    // with fresh rows below.
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
      const city = route.params?.city || 'All Locations';

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

        if (city !== 'All Locations') {
          // Trailing-wildcard match: tolerates dirty data like "Harare " (trailing space)
          recentQuery = recentQuery.ilike('city', `${city}%`);
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
      // and merge in when they land.
      const mySeq = ++loadSeq.current;
      if (featured) {
        setFeaturedListings(featured);
      }
      setListings(listingsData);
      setIsOffline(false);
      emitConnection(false);
      // Warm the image cache so cards paint instantly instead of popping in.
      prefetchFeedCovers(listingsData);
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
    } catch (error) {
      console.log('[ExploreScreen] Failed to load listings, loading from cache:', error.message);
      // Only transient failures mean "offline". Auth/RLS/shape errors keep
      // the app online with the cached list instead of the offline banner.
      const transient = isTransientError(error);
      if (transient) {
        setIsOffline(true);
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
      // Retries are exhausted here: cached data (already painted at the top
      // of this load) stays on screen, and the server is marked unreachable
      // ONLY for transient failures. Recovery is automatic — no manual
      // retry tap required.
      if (transient) {
        emitConnection(true);
      }
    } finally {
      loadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    loadListings(true);
  };

  // Tapping the tab-bar connection banner retries this feed. The ref always
  // holds the latest loadListings closure so filters stay current.
  const loadRef = useRef(null);
  loadRef.current = () => loadListings(true);

  // Live listing updates (approvals, edits): silent refresh puts newly
  // approved listings on screen within seconds instead of waiting for the
  // background cycle or a manual pull.
  useEffect(() => {
    const channel = supabase
      .channel(`explore_props_${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'properties' },
        () => { loadListings(true); }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
  // Live snapshots so the background refresher always compares/queries
  // with current values instead of a stale closure.
  const listingsSnap = useRef([]);
  const featuredSnap = useRef([]);
  const feedParamsSnap = useRef({ category: 'all', city: 'All Locations' });
  listingsSnap.current = listings;
  featuredSnap.current = featuredListings;
  feedParamsSnap.current = { category: selectedCategory, city: route.params?.city || 'All Locations' };

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
      return (newList || []).map(n => {
        const o = oldById.get(String(n.id));
        return (o && rowSig(o) === rowSig(n)) ? o : n;
      });
    }
    let changed = false;
    const out = (newList || []).map((n, idx) => {
      const o = oldById.get(String(n.id));
      const oldAtIdx = (oldList || [])[idx];
      if (!o || String(oldAtIdx?.id) !== String(n.id) || rowSig(o) !== rowSig(n)) {
        changed = true;
        return n;
      }
      return o;
    });
    return changed ? out : null;
  };

  // Idle guard: never refresh mid-interaction (images reload = flicker).
  const focusedRef = useRef(true);
  const uiBusyRef = useRef(false);
  uiBusyRef.current = searchFocused || showSuggestions || purposeOpen || refreshing || loading;

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
  // Skipped while the user is searching / filtering / refreshing, so images
  // never reload mid-interaction. Single attempt, single-flight, zero
  // polling while offline, and no UI churn unless data actually changed.
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

  const toggleFavorite = async (property) => {
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
    if (isOffline) {
      Alert.alert('Offline Mode', 'You cannot bookmark properties while offline.');
      return;
    }

    const isFav = savedProperties.includes(property.id);
    
    // OPTIMISTIC UPDATE
    if (isFav) {
      setSavedProperties(prev => prev.filter(id => id !== property.id));
    } else {
      setSavedProperties(prev => [...prev, property.id]);
    }

    const user = await getSessionUser();
    if (!user) {
      // Revert
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
      
      const updatedFavs = isFav
        ? savedProperties.filter(id => id !== property.id)
        : [...savedProperties, property.id];
      await AsyncStorage.setItem(`cached_saved_properties_${user.id}`, JSON.stringify(updatedFavs));
    } catch (e) {
      // Revert
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
      console.log('Error loading saved properties in Explore, falling back to cache:', e);
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

  useEffect(() => {
    loadSavedProperties();
    loadListings();
  }, [selectedCategory]);

  const filteredFeaturedListings = useMemo(() => {
    if (selectedPurpose === 'rent') {
      return featuredListings.filter(isRentalListing);
    }
    if (selectedPurpose === 'sale') {
      return featuredListings.filter(isSaleListing);
    }
    return featuredListings;
  }, [featuredListings, selectedPurpose]);

  useEffect(() => {
    setActiveIndex(0);
    try {
      featuredRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    } catch (e) {}
  }, [filteredFeaturedListings.length, selectedPurpose]);

  useEffect(() => {
    const count = filteredFeaturedListings.length;
    if (count > 1) {
      const interval = setInterval(() => {
        if (Date.now() - lastCarouselTouch.current < 8000) return;
        setActiveIndex((prevIndex) => {
          const nextIndex = (prevIndex + 1) % count;
          try {
            featuredRef.current?.scrollToIndex({
              index: nextIndex,
              animated: true,
            });
          } catch (e) {}
          return nextIndex;
        });
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [filteredFeaturedListings.length]);

  const filteredListings = useMemo(() => {
    let list = listings;

    if (selectedPurpose === 'rent') {
      list = list.filter(isRentalListing);
    } else if (selectedPurpose === 'sale') {
      list = list.filter(isSaleListing);
    }

    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return list;

    const roomMatch = q.match(/^(\d+)\s*(?:room|bed|bedroom|br)/i);
    if (roomMatch) {
      return list.filter(p => p.bedrooms === parseInt(roomMatch[1], 10));
    }

    const terms = q.split(/\s+/).filter(Boolean);
    return list.filter(p => {
      const haystack = [
        p.title, p.suburb, p.city, p.property_type, p.description, p.address
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q) || terms.every(t => haystack.includes(t));
    });
  }, [listings, searchQuery, selectedPurpose]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={24} color="#8A8A8A" />
          <TextInput
            placeholder={selectedPurpose === 'rent' ? 'Search rentals by city, suburb, type...' : selectedPurpose === 'sale' ? 'Search properties to buy...' : 'Where do you want to stay?'}
            placeholderTextColor="#A0A0A0"
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            onSubmitEditing={() => commitSearch()}
            returnKeyType="search"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.filterBtn} onPress={() => commitSearch()}>
            <Ionicons name="search" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {(searchFocused || showSuggestions) && (matchingRecents.length > 0 || finalSuggestions.length > 0) && (
        <View style={styles.suggestionsDropdown}>
          {matchingRecents.length > 0 && (
            <>
              <Text style={styles.sugLabel}>RECENT SEARCHES</Text>
              {matchingRecents.map((r) => (
                <View key={r} style={styles.suggestionItem}>
                  <TouchableOpacity style={styles.suggestionMain} onPress={() => handleSelectSuggestion(r)}>
                    <Ionicons name="time" size={16} color="#8E8E93" />
                    <HighlightText text={r} q={searchQuery.trim()} style={styles.suggestionText} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sugRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => removeRecentSearch(r)}>
                    <Ionicons name="close-circle" size={16} color="#C7C7CC" />
                  </TouchableOpacity>
                </View>
              ))}
            </>
          )}
          {finalSuggestions.length > 0 && (
            <>
              <Text style={styles.sugLabel}>SUGGESTIONS</Text>
              {finalSuggestions.map((s) => (
                <TouchableOpacity key={`sug-${s}`} style={styles.suggestionItem} onPress={() => handleSelectSuggestion(s)}>
                  <Ionicons name="map" size={16} color="#8E8E93" />
                  <HighlightText text={s} q={searchQuery.trim()} style={styles.suggestionText} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      )}

      <FlatList
        // Keep every row mounted: Android unmounts off-screen views by
        // default, which makes pictures/videos reload + flash on scroll-back.
        removeClippedSubviews={false}
        ListHeaderComponent={
          <>

            {/* Purpose Selector: dropdown to choose Rent / Buy / All */}
            <View style={styles.purposeToggleWrap}>
              <TouchableOpacity
                style={styles.purposeDropdown}
                onPress={() => setPurposeOpen(true)}
                activeOpacity={0.85}
              >
                <Text style={styles.purposeDropdownText}>
                  {selectedPurpose === 'rent' ? 'Rent' : selectedPurpose === 'sale' ? 'Buy' : 'All Properties'}
                </Text>
                <Ionicons name="chevron-down" size={16} color="#0A84FF" style={{ marginLeft: 'auto' }} />
              </TouchableOpacity>
            </View>

            {/* Trending Carousel */}
            {filteredFeaturedListings.length > 0 && (
              <View style={styles.trendingSection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>
                    {selectedPurpose === 'rent' ? 'Trending Rentals' : selectedPurpose === 'sale' ? 'Trending for Sale' : 'Hot Deals'}
                  </Text>
                  <View style={styles.pagination}>
                    {filteredFeaturedListings.map((_, i) => (
                      <View key={i} style={[styles.dot, activeIndex === i && styles.activeDot]} />
                    ))}
                  </View>
                </View>
                <FlatList
                  ref={featuredRef}
                  data={filteredFeaturedListings}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  // Keep all hero slides mounted so swiping back never
                  // reloads pictures/videos (no flicker).
                  removeClippedSubviews={false}
                  keyExtractor={item => `explore-trending-${item.id}`}
                  onScrollBeginDrag={() => { lastCarouselTouch.current = Date.now(); }}
                  onScrollToIndexFailed={(info) => {
                    setTimeout(() => {
                      try {
                        featuredRef.current?.scrollToIndex({ index: Math.min(info.index, filteredFeaturedListings.length - 1), animated: false });
                      } catch (e) {}
                    }, 300);
                  }}
                  onMomentumScrollEnd={(e) => {
                    const index = Math.round(e.nativeEvent.contentOffset.x / (screenWidth - 40));
                    setActiveIndex(index);
                  }}
                  renderItem={({ item }) => (
                    <TouchableOpacity 
                      style={[styles.trendingCard, { width: screenWidth - 40 }]} 
                      activeOpacity={0.9}
                      onPress={() => navigation.navigate('Detail', { item })}
                    >
                      <TrendingMedia images={item.property_images} style={styles.trendingImg} />
                      <View style={styles.trendingOverlay}>
                        <View style={styles.trendingBadge}>
                          <Ionicons name="flame" size={16} color="#FFF" />
                          <Text style={styles.trendingBadgeText}>TRENDING</Text>
                        </View>
                        <View>
                          <Text style={styles.trendingTitle}>{item.title}</Text>
                          <View style={styles.trendingFooter}>
                            <Ionicons name="map" size={14} color="#FFF" />
                            <Text style={styles.trendingLocation}>{item.suburb || item.city}</Text>
                            <Text style={styles.trendingPrice}>{listingPricePrimary(item)}</Text>
                          </View>
                          <Text style={styles.trendingDesc} numberOfLines={2}>
                              {listingDescription(item)}
                            </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}

            {/* Categories Scroll */}
            <View style={styles.categoriesSection}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity 
                    key={cat.id} 
                    style={[styles.categoryPill, selectedCategory === cat.id && styles.categoryPillActive]}
                    onPress={() => {
                      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                      setSelectedCategory(cat.id);
                    }}
                  >
                    <Text style={[styles.categoryText, selectedCategory === cat.id && styles.categoryTextActive]}>
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={styles.filterBar}>
              <Text style={styles.marketTitle}>
                {selectedPurpose === 'rent'
                  ? (selectedCategory === 'all' ? 'Rental Market' : `${selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} Rentals`)
                  : selectedPurpose === 'sale'
                  ? (selectedCategory === 'all' ? 'Properties for Sale' : `${selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} for Sale`)
                  : (selectedCategory === 'all' ? 'Market Overview' : `${selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} Market`)}
              </Text>
              <Text style={styles.resultsCount}>{filteredListings.length} properties</Text>
            </View>

            {/* Listings — 2-column grid like the website mobile view */}
            {loading && filteredListings.length === 0 ? (
              <>
                {[0, 1, 2, 3].map((i) => (
                  <ListingCardSkeleton key={`skel-${i}`} wide />
                ))}
              </>
            ) : filteredListings.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="search" size={60} color="#D1D1D6" />
                <Text style={styles.emptyTitle}>No matches found</Text>
                <Text style={styles.emptySubtitle}>Try adjusting your search or category.</Text>
              </View>
            ) : (
              <>
                <FlatList
                  data={filteredListings}
                  keyExtractor={(item, index) => String(item?.id ?? index)}
                  scrollEnabled={false}
                  // Keep rows mounted so scrolling back never reloads
                  // pictures/videos (no flicker).
                  removeClippedSubviews={false}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.listingsGridContent}
                  renderItem={({ item }) => (
                    <ListingCard
                      item={item}
                      wide
                      onPress={() => navigation.navigate('Detail', { item })}
                      onFavorite={toggleFavorite}
                      isFavorite={item ? savedProperties.includes(item.id) : false}
                    />
                  )}
                />
              </>
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
          style={purposeSheetStyles.overlay}
          activeOpacity={1}
          onPress={() => setPurposeOpen(false)}
        >
          <View style={purposeSheetStyles.sheet}>
            <View style={purposeSheetStyles.handle} />
            <Text style={purposeSheetStyles.title}>Show properties</Text>
            {(['rent', 'sale', 'all']).map(opt => {
              const label = opt === 'rent' ? 'Rent' : opt === 'sale' ? 'Buy' : 'All Properties';
              const active = selectedPurpose === opt;
              return (
                <TouchableOpacity
                  key={opt}
                  style={[purposeSheetStyles.option, active && purposeSheetStyles.optionActive]}
                  activeOpacity={0.8}
                  onPress={() => {
                    setSelectedPurpose(opt);
                    setPurposeOpen(false);
                    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                  }}
                >
                  <Text style={[purposeSheetStyles.optionText, active && purposeSheetStyles.optionTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const purposeSheetStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(4,9,26,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    paddingBottom: 34,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E0E5',
    marginBottom: 14,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 12,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F5F7FA',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 13,
    marginBottom: 10,
  },
  optionActive: {
    backgroundColor: '#0A84FF',
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#101828',
  },
  optionTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingTop: Platform.OS === 'ios' ? 100 : 70,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    position: 'relative',
  },
  backBtn: { marginRight: 15 },
  searchBar: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#FFFFFF', 
    height: 54, 
    borderRadius: 24, 
    paddingLeft: 16, 
    paddingRight: 7,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  searchInput: { flex: 1, marginLeft: 12, fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#1A1A1A' },
  filterBtn: { width: 40, height: 40, borderRadius: 24, backgroundColor: '#0A84FF', justifyContent: 'center', alignItems: 'center', shadowColor: '#0A84FF', shadowOpacity: 0.3, shadowRadius: 5, elevation: 3 },

  suggestionsDropdown: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 155 : 125,
    left: 75,
    right: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 12,
    zIndex: 1000,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  suggestionMain: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  suggestionText: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#1A1A1A', flex: 1, marginLeft: 8 },
  sugLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 11, color: '#8E8E93', letterSpacing: 1, paddingHorizontal: 12, paddingTop: 4 },
  suggestionHighlight: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' },
  sugRemove: { paddingLeft: 10, paddingVertical: 4 },
  
  trendingSection: { marginTop: 20, marginBottom: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 15 },
  sectionTitle: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#000' },
  
  trendingCard: { height: 180, marginHorizontal: 20, borderRadius: 20, overflow: 'hidden', backgroundColor: '#F5F5F5' },
  trendingImg: { width: '100%', height: '100%' },
  trendingOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 15, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'space-between', height: '100%' },
  trendingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A84FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, alignSelf: 'flex-start' },
  trendingBadgeText: { color: '#FFF', fontSize: 9, fontFamily: 'Poppins_700Bold', marginLeft: 4 },
  trendingTitle: { color: '#FFF', fontSize: 20, fontFamily: 'Poppins_900Black', marginBottom: 2, letterSpacing: -0.3 },
  trendingFooter: { flexDirection: 'row', alignItems: 'center' },
  trendingLocation: { color: '#FFF', fontSize: 12, fontFamily: 'Poppins_400Regular', marginLeft: 4, flex: 1 },
  trendingPrice: { color: '#FFF', fontSize: 14, fontFamily: 'Poppins_700Bold' },
  trendingDesc: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    lineHeight: 16,
    marginTop: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    overflow: 'hidden',
  },

  pagination: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#D1D1D6', marginHorizontal: 3 },
  activeDot: { width: 12, height: 4, borderRadius: 2, backgroundColor: '#0A84FF' },

  categoriesSection: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  categoriesScroll: { paddingHorizontal: 20 },
  categoryPill: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#F5F5F5', marginRight: 10 },
  categoryPillActive: { backgroundColor: '#111111' },
  categoryText: { fontFamily: 'Poppins_600SemiBold', color: '#6E6E73', fontSize: 14 },
  categoryTextActive: { color: '#FFF', fontFamily: 'Poppins_700Bold' },

  filterBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15 },
  marketTitle: { fontFamily: 'Poppins_900Black', fontSize: 20, color: '#000', letterSpacing: -0.3 },
  resultsCount: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93' },
  
  listContent: { paddingBottom: 120 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 12 },
  gridItemWrapper: { width: '48%' },
  listingsGridContent: { paddingBottom: 24 },
  listingsLoadingWrap: { alignItems: 'center', paddingVertical: 40 },

  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000', marginTop: 16 },
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', marginTop: 8 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  loadingCard: {
    backgroundColor: '#FFF',
    paddingHorizontal: 28,
    paddingVertical: 24,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
    gap: 12,
  },
  loadingText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#8E8E93',
  },

  // Purpose dropdown (Rent / Buy / All)
  purposeToggleWrap: {
    paddingHorizontal: 20,
    marginTop: 16,
    marginBottom: 10,
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
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#0A84FF',
  },
});
