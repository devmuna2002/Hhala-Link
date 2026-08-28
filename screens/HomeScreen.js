import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, ScrollView, Text, StyleSheet, Platform, TextInput, TouchableOpacity, StatusBar, ActivityIndicator, Modal, FlatList, Image, RefreshControl, useWindowDimensions, Alert, Keyboard } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { supabase } from '../supabase';
import ListingCard from '../components/ListingCard';
import ReconnectingBanner from '../components/ReconnectingBanner';
import { listingPricePrimary } from '../utils/formatPrice';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useVideoPlayer, VideoView } from 'expo-video';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const RECENT_SEARCHES_KEY = 'recent_searches';
const MAX_RECENT_SEARCHES = 4;
// Old placeholder recents — purged so only real searches are kept
const FAKE_RECENTS = new Set(['harare apartments', 'borrowdale houses', 'bulawayo cottages']);
const isVideoImg = (img) => img && img.url && (img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url));

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

// Trending card media: autoplays video when the listing has one, otherwise shows cover image
function TrendingMedia({ images, style }) {
  const list = images || [];
  const videoImg = list.find(isVideoImg);
  const cover = list.find(img => !isVideoImg(img));
  const isFocused = useIsFocused();
  const player = useVideoPlayer(videoImg?.url || null, (p) => {
    p.loop = true;
    p.muted = true;
    p.volume = 0;
  });

  useEffect(() => {
    if (!videoImg) return;
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
  }, [isFocused, videoImg, player]);

  if (videoImg) {
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
  return (
    <Image
      source={{ uri: cover?.url || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994' }}
      style={style}
    />
  );
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
  { id: 'all', name: 'All', icon: 'apps' },
  { id: 'house', name: 'Houses', icon: 'home' },
  { id: 'villa', name: 'Villas', icon: 'business' },
  { id: 'apartment', name: 'Apartments', icon: 'business-outline' },
  { id: 'cottage', name: 'Cottages', icon: 'leaf-outline' },
  { id: 'studio', name: 'Studios', icon: 'cube-outline' },
  { id: 'room', name: 'Rooms', icon: 'bed-outline' },
  { id: 'shops', name: 'Shops', icon: 'cart-outline' },
  { id: 'offices', name: 'Offices', icon: 'briefcase-outline' },
  { id: 'stands', name: 'Stands', icon: 'map-outline' },
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
  const { width: screenWidth } = useWindowDimensions();
  const [listings, setListings] = useState([]);
  const [featuredListings, setFeaturedListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPurpose, setSelectedPurpose] = useState('rent'); // 'rent' | 'sale' | 'all'
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentLocation, setCurrentLocation] = useState('All Locations');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [savedProperties, setSavedProperties] = useState([]);
  const [locationModalVisible, setLocationModalVisible] = useState(false);
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
        try {
          const { data, error } = await supabase
            .from('properties')
            .select('title, city, suburb')
            .eq('status', 'available')
            .or(`title.ilike.%${q}%,city.ilike.%${q}%,suburb.ilike.%${q}%,description.ilike.%${q}%`)
            .limit(6);

          if (error) throw error;

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
  const [activeIndex, setActiveIndex] = useState(0);

  const loadListings = async (silent = false, searchOverride = null, cityOverride = null) => {
    if (!silent) setLoading(true);
    try {
      const activeCity = cityOverride !== null ? cityOverride : currentLocation;

      const SELECT_COLUMNS = 'id, title, rent_usd, sale_price_usd, listing_purpose, city, suburb, property_type, created_at, views, bedrooms, bathrooms, area_sqm, description, property_images(url, alt_text)';
      
      let recentQuery = supabase
        .from('properties')
        .select(SELECT_COLUMNS)
        .eq('status', 'available')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (selectedCategory !== 'all') {
        recentQuery = recentQuery.eq('property_type', selectedCategory);
      }
      
      if (activeCity !== 'All Locations') {
        recentQuery = recentQuery.ilike('city', activeCity);
      }

      const [
        { data: featured },
        { data: recent, error }
      ] = await Promise.all([
        supabase.from('properties').select(SELECT_COLUMNS).eq('status', 'available').order('views', { ascending: false }).limit(5),
        recentQuery
      ]);

      if (error) throw error;

      if (featured) {
        setFeaturedListings(featured);
        await AsyncStorage.setItem('cached_featured_listings', JSON.stringify(featured));
      }
      
      const listingsData = recent || [];
      setListings(listingsData);
      await AsyncStorage.setItem('cached_listings', JSON.stringify(listingsData));
      setIsOffline(false);
      setLoadError(null);
    } catch (err) {
      console.log('[HomeScreen] Failed to load listings, loading from cache:', err.message);
      setIsOffline(true);
      setLoadError(err.message);
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
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleLocationSelect = (city) => {
    setCurrentLocation(city);
    setLocationModalVisible(false);
    loadListings(false, null, city);
  };

  const toggleFavorite = async (property) => {
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

    const { data: { user } } = await supabase.auth.getUser();
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
      const { data: { user } } = await supabase.auth.getUser();
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
        const { data: { user } } = await supabase.auth.getUser();
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
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if (error) throw error;
        if (data) {
          setUserData(data);
          setAvatarError(false);
          await AsyncStorage.setItem(`cached_user_profile_${user.id}`, JSON.stringify(data));
        }
      }
    } catch (e) {
      console.log('Error loading user data, falling back to cache:', e);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const cachedProfile = await AsyncStorage.getItem(`cached_user_profile_${user.id}`);
          if (cachedProfile) {
            setUserData(JSON.parse(cachedProfile));
          }
        }
      } catch (_) {}
    }
  };
  
  const updateLastSeen = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
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
      const { data: { user } } = await supabase.auth.getUser();
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
        const { data: { user } } = await supabase.auth.getUser();
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

    // Subscribe to new notifications
    const channelId = `home_notifs_${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'notifications' 
      }, () => {
        fetchUnreadCount();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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
          Alert.alert(
            'New Property Alert! 🏠',
            `${payload.new.title} was just listed in ${payload.new.city}. Check it out now!`,
            [
              { text: 'View Detail', onPress: () => navigation.navigate('Detail', { item: payload.new }) },
              { text: 'Later', style: 'cancel' }
            ]
          );
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Unread notifications
      const { count: notifCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (notifCount !== null && notifCount !== undefined) {
        setUnreadNotifs(notifCount);
      }

      // 2. Unread messages across user's conversations
      const { data: convs } = await supabase
        .from('conversations')
        .select('id')
        .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`);

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

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        profileChannel = supabase
          .channel(`home_profile_${user.id}`)
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
          .channel(`home_notifs_${user.id}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
            () => fetchUnreadCounts()
          )
          .subscribe();

        msgsChannel = supabase
          .channel(`home_messages_${user.id}`)
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

  // Reset active carousel index when filteredFeaturedListings changes
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
        setActiveIndex((prevIndex) => {
          const nextIndex = (prevIndex + 1) % count;
          try {
            featuredRef.current?.scrollToIndex({
              index: nextIndex,
              animated: true,
            });
          } catch (e) {
            // ignore if layout not ready
          }
          return nextIndex;
        });
      }, 5000);
      return () => clearInterval(interval);
    }
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
      <ReconnectingBanner isOffline={isOffline} onRetry={() => loadListings(false)} />
      
      {/* Location Selection Modal */}
      <Modal visible={locationModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.locationModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select City</Text>
              <TouchableOpacity onPress={() => setLocationModalVisible(false)}>
                <Ionicons name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={CITIES}
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.cityItem} 
                  onPress={() => handleLocationSelect(item)}
                >
                  <Ionicons name="location-outline" size={20} color="#8E8E93" />
                  <Text style={[styles.cityText, currentLocation === item && styles.cityTextActive]}>{item}</Text>
                  {currentLocation === item && <Ionicons name="checkmark" size={20} color="#0A84FF" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.locationContainer} onPress={() => setLocationModalVisible(true)}>
          <View style={styles.locIconBox}>
            <Ionicons name="location" size={18} color="#0A84FF" />
          </View>
          <View style={{ marginLeft: 12, flexShrink: 1 }}>
            <Text style={styles.locLabel}>Location</Text>
            <Text style={[styles.locText, { numberOfLines: 1 }]} numberOfLines={1}>{currentLocation}</Text>
          </View>
          <Ionicons name="chevron-down" size={16} color="#8E8E93" style={{ marginLeft: 6 }} />
        </TouchableOpacity>
        
        <View style={styles.headerRight}>
          {/* Add Listing (+) Button - hidden for tenants and movers */}
          {userData?.role !== 'tenant' && userData?.role !== 'mover' && (
            <TouchableOpacity
              style={[styles.iconBtn, { marginRight: 8 }]}
              onPress={() => navigation.navigate('AddListing')}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={24} color="#0A84FF" />
            </TouchableOpacity>
          )}

          {/* Messages Icon with Dynamic Badge Counter */}
          <TouchableOpacity 
            style={[styles.iconBtn, { marginRight: 8 }]} 
            onPress={() => navigation.navigate('UserList')}
            activeOpacity={0.7}
          >
            <View style={{ position: 'relative' }}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color="#000" />
              {unreadMessages > 0 && (
                <View style={styles.counterBadge}>
                  <Text style={styles.counterBadgeText}>
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Notifications Bell Icon with Dynamic Badge Counter */}
          <TouchableOpacity 
            style={[styles.iconBtn, { marginRight: 8 }]} 
            onPress={() => navigation.navigate('Notifications')}
            activeOpacity={0.7}
          >
            <View style={{ position: 'relative' }}>
              <Ionicons name="notifications-outline" size={20} color="#000" />
              {unreadNotifs > 0 && (
                <View style={styles.counterBadge}>
                  <Text style={styles.counterBadgeText}>
                    {unreadNotifs > 99 ? '99+' : unreadNotifs}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Profile Avatar */}
          <TouchableOpacity onPress={() => navigation.navigate('Profile')} activeOpacity={0.8}>
            {userData?.avatar_url && !avatarError ? (
              <Image 
                key={userData.avatar_url} 
                source={{ uri: userData.avatar_url }} 
                style={styles.avatarMini} 
                onError={() => setAvatarError(true)}
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={20} color="#0A84FF" />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar + Suggestions — outside FlatList so dropdown sits below naturally */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#A0A0A0" />
          <TextInput 
            placeholder={selectedPurpose === 'rent' ? 'Search rentals by location, suburb...' : selectedPurpose === 'sale' ? 'Search properties to buy...' : 'Where do you want to stay?'} 
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
                      <Ionicons name="time-outline" size={16} color="#8E8E93" />
                      <HighlightText text={r} q={searchQuery.trim()} style={styles.suggestionText} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.sugRemove}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      onPress={() => removeRecentSearch(r)}
                    >
                      <Ionicons name="close-circle-outline" size={16} color="#C7C7CC" />
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
                    <Ionicons name="location-outline" size={16} color="#8E8E93" />
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
        ListHeaderComponent={
          <>

            {/* Purpose Selector: Rent / Buy / All */}
            <View style={styles.purposeToggleWrap}>
              <View style={styles.purposeToggleContainer}>
                <TouchableOpacity
                  style={[
                    styles.purposeTab,
                    selectedPurpose === 'rent' && styles.purposeTabActive
                  ]}
                  onPress={() => {
                    setSelectedPurpose('rent');
                    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons 
                    name="key" 
                    size={15} 
                    color={selectedPurpose === 'rent' ? '#FFFFFF' : '#6B7280'} 
                    style={{ marginRight: 6 }} 
                  />
                  <Text style={[
                    styles.purposeTabText,
                    selectedPurpose === 'rent' && styles.purposeTabTextActive
                  ]}>
                    Rent
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.purposeTab,
                    selectedPurpose === 'sale' && styles.purposeTabActive
                  ]}
                  onPress={() => {
                    setSelectedPurpose('sale');
                    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons 
                    name="pricetag" 
                    size={15} 
                    color={selectedPurpose === 'sale' ? '#FFFFFF' : '#6B7280'} 
                    style={{ marginRight: 6 }} 
                  />
                  <Text style={[
                    styles.purposeTabText,
                    selectedPurpose === 'sale' && styles.purposeTabTextActive
                  ]}>
                    Buy
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.purposeTab,
                    selectedPurpose === 'all' && styles.purposeTabActive
                  ]}
                  onPress={() => {
                    setSelectedPurpose('all');
                    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons 
                    name="apps" 
                    size={14} 
                    color={selectedPurpose === 'all' ? '#FFFFFF' : '#6B7280'} 
                    style={{ marginRight: 6 }} 
                  />
                  <Text style={[
                    styles.purposeTabText,
                    selectedPurpose === 'all' && styles.purposeTabTextActive
                  ]}>
                    All
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Trending */}
            {filteredFeaturedListings.length > 0 && (
              <View style={styles.trendingSection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>
                    {selectedPurpose === 'rent' ? 'Trending Rentals' : selectedPurpose === 'sale' ? 'Trending for Sale' : 'Trending Properties'}
                  </Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Explore')}>
                    <Text style={styles.seeAll}>See All</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  ref={featuredRef}
                  data={filteredFeaturedListings}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={item => `trending-${item.id}`}
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
                        <View style={styles.trendingBadge}><Ionicons name="flash" size={12} color="#FFF" /><Text style={styles.trendingBadgeText}>POPULAR</Text></View>
                        <View style={styles.trendingPricePill}>
                          <Text style={styles.trendingPrice}>{listingPricePrimary(item)}</Text>
                        </View>
                        <View style={styles.trendingBottom}>
                          <Text style={styles.trendingTitle} numberOfLines={1}>{item.title}</Text>
                          <View style={styles.trendingLocationRow}>
                            <Ionicons name="location" size={14} color="#FFF" />
                            <Text style={styles.trendingLocation} numberOfLines={1}>{item.suburb || item.city}</Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  )}
                />
                <View style={styles.pagination}>
                  {filteredFeaturedListings.map((_, i) => <View key={i} style={[styles.dot, activeIndex === i && styles.activeDot]} />)}
                </View>
              </View>
            )}

            {/* Categories */}
            <View style={styles.categoriesSection}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
                {CATEGORIES.map(cat => (
                  <TouchableOpacity 
                    key={cat.id} 
                    style={[styles.categoryPill, selectedCategory === cat.id && styles.categoryPillActive]}
                    onPress={() => setSelectedCategory(cat.id)}
                  >
                    <Text style={[styles.categoryText, selectedCategory === cat.id && styles.categoryTextActive]}>{cat.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={[styles.sectionHeader, { marginTop: 24 }]}>
              <View style={styles.sectionTitleWrap}>
                <Text style={styles.sectionTitle}>
                  {selectedPurpose === 'rent' ? 'Rental Properties' : selectedPurpose === 'sale' ? 'Properties for Sale' : 'Recently Added'}
                </Text>
                <View style={[styles.newPill, selectedPurpose === 'sale' && { backgroundColor: '#F59E0B' }, selectedPurpose === 'all' && { backgroundColor: '#6366F1' }]}>
                  <Text style={styles.newPillText}>
                    {selectedPurpose === 'rent' ? 'FOR RENT' : selectedPurpose === 'sale' ? 'FOR SALE' : 'ALL'}
                  </Text>
                </View>
              </View>
              <Text style={styles.resultsCount}>{filteredListings.length} items</Text>
            </View>
          </>
        }
        data={filteredListings}
        numColumns={2}
        keyExtractor={item => item.id.toString()}
        renderItem={({item}) => (
          <View style={styles.gridItemWrapper}>
            <ListingCard 
              item={item} 
              onPress={() => navigation.navigate('Detail', { item })} 
              onFavorite={toggleFavorite}
              isFavorite={savedProperties.includes(item.id)}
            />
          </View>
        )}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.columnWrapper}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          loading ? (
            <View style={[styles.emptyContainer, { paddingVertical: 40 }]}>
              <ActivityIndicator size="large" color="#0A84FF" />
              <Text style={[styles.emptySubtitle, { marginTop: 12 }]}>Loading properties...</Text>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={60} color="#D1D1D6" />
              <Text style={styles.emptyTitle}>No properties found</Text>
              <Text style={styles.emptySubtitle}>Try changing your category or location.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAF8FF' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingTop: Platform.OS === 'ios' ? 100 : 70,
    marginBottom: 25
  },
  locationContainer: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: 8 },
  locIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#DCEBFF', justifyContent: 'center', alignItems: 'center' },
  locLabel: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#8E8E93' },
  locText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#1A1A1A' },
  headerRight: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  iconBtn: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#EAF3FF', justifyContent: 'center', alignItems: 'center' },
  notifDot: { position: 'absolute', top: -4, right: -4, width: 10, height: 10, borderRadius: 5, backgroundColor: "#0A84FF", borderWidth: 1.5, borderColor: '#EAF3FF', zIndex: 1 },
  counterBadge: { 
    position: 'absolute', 
    top: -6, 
    right: -8, 
    minWidth: 18, 
    height: 18, 
    borderRadius: 9, 
    backgroundColor: "#0A84FF", 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingHorizontal: 4, 
    borderWidth: 1.5, 
    borderColor: '#FFFFFF', 
    zIndex: 10 
  },
  counterBadgeText: { 
    fontFamily: 'Poppins_700Bold', 
    fontSize: 9.5, 
    color: '#FFFFFF', 
    textAlign: 'center',
    lineHeight: 13,
  },
  avatarMini: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: '#EAF3FF' },
  avatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#DCEBFF', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#EAF3FF' },

  searchSection: { paddingHorizontal: 20, marginBottom: 25 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', height: 54, borderRadius: 24, paddingLeft: 16, paddingRight: 7, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  searchInput: { flex: 1, marginLeft: 12, fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#1A1A1A' },
  filterBtn: { width: 40, height: 40, borderRadius: 24, backgroundColor: "#0A84FF", justifyContent: 'center', alignItems: 'center', shadowColor: '#0A84FF', shadowOpacity: 0.3, shadowRadius: 5, elevation: 3 },
  
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
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5'
  },
  suggestionMain: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  suggestionText: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#1A1A1A', flex: 1, marginLeft: 8 },
  sugLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 11, color: '#8E8E93', letterSpacing: 1, paddingHorizontal: 12, paddingTop: 4 },
  suggestionHighlight: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' },
  sugRemove: { paddingLeft: 10, paddingVertical: 4 },

  // Location Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  locationModal: { width: '85%', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingHorizontal: 10 },
  modalTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#1A1A1A' },
  cityItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F5F5F5', paddingHorizontal: 10 },
  cityText: { flex: 1, marginLeft: 15, fontFamily: 'Poppins_500Medium', fontSize: 16, color: '#1A1A1A' },
  cityTextActive: { color: "#0A84FF", fontFamily: 'Poppins_600SemiBold' },

  trendingSection: { marginBottom: 30 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, paddingHorizontal: 20 },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#1A1A1A' },
  newPill: { backgroundColor: '#0A84FF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  newPillText: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 9, letterSpacing: 1 },
  seeAll: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: "#0A84FF" },
  resultsCount: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },

  trendingCard: { height: 240, marginHorizontal: 20, borderRadius: 20, overflow: 'hidden', backgroundColor: '#EAF3FF' },
  trendingImg: { width: '100%', height: '100%' },
  trendingOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 18, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end', height: '100%' },
  trendingBadge: { position: 'absolute', top: 14, left: 14, flexDirection: 'row', alignItems: 'center', backgroundColor: "#0A84FF", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  trendingBadgeText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Poppins_700Bold', marginLeft: 4 },
  trendingPricePill: { position: 'absolute', top: 14, right: 14, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  trendingPrice: { color: "#0A84FF", fontSize: 14, fontFamily: 'Poppins_700Bold' },
  trendingBottom: { marginTop: 'auto' },
  trendingTitle: { color: '#FFFFFF', fontSize: 18, fontFamily: 'Poppins_700Bold', marginBottom: 6 },
  trendingLocationRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  trendingLocation: { color: "#FFFFFF", fontSize: 13, fontFamily: 'Poppins_400Regular', marginLeft: 4, flexShrink: 1 },

  pagination: { flexDirection: 'row', justifyContent: 'center', marginTop: 15 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D1D6', marginHorizontal: 4 },
  activeDot: { width: 18, height: 6, borderRadius: 3, backgroundColor: "#0A84FF" },

  categoriesSection: { marginBottom: 10 },
  categoriesScroll: { paddingHorizontal: 20 },
  categoryPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#EAF3FF', marginRight: 8, borderWidth: 1, borderColor: '#DCEBFF' },
  categoryPillActive: { backgroundColor: "#0A84FF", borderColor: '#0A84FF' },
  categoryText: { fontFamily: 'Poppins_500Medium', color: '#8E8E93', fontSize: 13 },
  categoryTextActive: { color: '#FFFFFF' },

  listContent: { paddingBottom: 100 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 20 },
  gridItemWrapper: { width: '48%', marginBottom: 16 },

  emptyContainer: { alignItems: 'center', marginTop: 40, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#1A1A1A', marginTop: 16 },
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', marginTop: 8, textAlign: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF4E5',
    borderWidth: 1,
    borderColor: '#FFD8A8',
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    borderRadius: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'Poppins_500Medium',
    fontSize: 12.5,
    color: '#B26A00',
  },
  errorBannerRetry: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 12.5,
    color: '#0A84FF',
  },

  // Purpose Toggle (Rent / Buy / All)
  purposeToggleWrap: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  purposeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#EAF3FF',
    borderRadius: 16,
    padding: 4,
    borderWidth: 1,
    borderColor: '#DCEBFF',
  },
  purposeTab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
  },
  purposeTabActive: {
    backgroundColor: '#0A84FF',
    shadowColor: '#0A84FF',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  purposeTabText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#6B7280',
  },
  purposeTabTextActive: {
    color: '#FFFFFF',
    fontFamily: 'Poppins_700Bold',
  },
});
