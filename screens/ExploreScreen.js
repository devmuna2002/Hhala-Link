import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, ScrollView, Text, StyleSheet, Platform, TextInput, TouchableOpacity, StatusBar, ActivityIndicator, FlatList, Image, useWindowDimensions, RefreshControl, Alert, Keyboard } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { supabase } from '../supabase';
import ListingCard from '../components/ListingCard';
import { listingPricePrimary } from '../utils/formatPrice';
import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const isVideoImg = (img) => img && img.url && (img.alt_text === 'video' || img.url.startsWith('data:video') || VIDEO_URL_REGEX.test(img.url));

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

const RECENT_SEARCHES_KEY = 'explore_recent_searches';
const MAX_RECENT = 5;

export default function ExploreScreen({ navigation, route }) {
  const { width: screenWidth } = useWindowDimensions();
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
  const [isOffline, setIsOffline] = useState(false);
  const [recentSearches, setRecentSearches] = useState([]);
  const lastLoadedQuery = useRef(null);
  const didMountSearch = useRef(false);
  
  const featuredRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

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
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const SELECT_COLUMNS = 'id, title, rent_usd, sale_price_usd, listing_purpose, city, suburb, property_type, created_at, views, bedrooms, bathrooms, area_sqm, description, property_images(url, alt_text)';
      const city = route.params?.city || 'All Locations';

      let recentQuery = supabase
        .from('properties')
        .select(SELECT_COLUMNS)
        .eq('status', 'available')
        .order('created_at', { ascending: false })
        .limit(30);
      
      if (selectedCategory !== 'all') {
        recentQuery = recentQuery.eq('property_type', selectedCategory);
      }

      if (city !== 'All Locations') {
        recentQuery = recentQuery.ilike('city', city);
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
    } catch (error) {
      console.log('[ExploreScreen] Failed to load listings, loading from cache:', error.message);
      setIsOffline(true);
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

  const onRefresh = () => {
    loadListings(true);
  };

  const toggleFavorite = async (property) => {
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

    const { data: { user } } = await supabase.auth.getUser();
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
      console.log('Error loading saved properties in Explore, falling back to cache:', e);
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

  useEffect(() => {
    loadSavedProperties();
    loadListings();
  }, [selectedCategory]);

  useEffect(() => {
    if (featuredListings.length > 0) {
      const interval = setInterval(() => {
        let nextIndex = (activeIndex + 1) % featuredListings.length;
        setActiveIndex(nextIndex);
        featuredRef.current?.scrollToIndex({
          index: nextIndex,
          animated: true,
        });
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [activeIndex, featuredListings]);

  const filteredListings = listings.filter(p => {
    const q = (searchQuery || '').toLowerCase();
    if (!q) return true;
    const roomMatch = q.match(/^(\d+)\s*(?:room|bed|bedroom|br)/i);
    if (roomMatch) {
      return p.bedrooms === parseInt(roomMatch[1], 10);
    }
    return (
      (p.title && p.title.toLowerCase().includes(q)) ||
      (p.suburb && p.suburb.toLowerCase().includes(q)) ||
      (p.city && p.city.toLowerCase().includes(q)) ||
      (p.property_type && p.property_type.toLowerCase().includes(q)) ||
      (p.description && p.description.toLowerCase().includes(q))
    );
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#A0A0A0" />
          <TextInput
            placeholder="Where do you want to stay?"
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
                    <Ionicons name="time-outline" size={16} color="#8E8E93" />
                    <HighlightText text={r} q={searchQuery.trim()} style={styles.suggestionText} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.sugRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => removeRecentSearch(r)}>
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
                <TouchableOpacity key={`sug-${s}`} style={styles.suggestionItem} onPress={() => handleSelectSuggestion(s)}>
                  <Ionicons name="location-outline" size={16} color="#8E8E93" />
                  <HighlightText text={s} q={searchQuery.trim()} style={styles.suggestionText} />
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      )}

      <FlatList
        ListHeaderComponent={
          <>
            {isOffline && (
              <View style={styles.offlineBanner}>
                <View style={styles.offlineDot} />
                <Text style={styles.offlineText}>Working Offline • Viewing Cached Properties</Text>
              </View>
            )}
            {/* Trending Carousel */}
            {featuredListings.length > 0 && (
              <View style={styles.trendingSection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Hot Deals</Text>
                  <View style={styles.pagination}>
                    {featuredListings.map((_, i) => (
                      <View key={i} style={[styles.dot, activeIndex === i && styles.activeDot]} />
                    ))}
                  </View>
                </View>
                <FlatList
                  ref={featuredRef}
                  data={featuredListings}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={item => `explore-trending-${item.id}`}
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
                          <Ionicons name="flame" size={12} color="#FFF" />
                          <Text style={styles.trendingBadgeText}>TRENDING</Text>
                        </View>
                        <View>
                          <Text style={styles.trendingTitle}>{item.title}</Text>
                          <View style={styles.trendingFooter}>
                            <Ionicons name="location" size={14} color="#FFF" />
                            <Text style={styles.trendingLocation}>{item.suburb || item.city}</Text>
                            <Text style={styles.trendingPrice}>{listingPricePrimary(item)}</Text>
                          </View>
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
                    onPress={() => setSelectedCategory(cat.id)}
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
                {selectedCategory === 'all' ? 'Market Overview' : `${selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)} Market`}
              </Text>
              <Text style={styles.resultsCount}>{filteredListings.length} properties</Text>
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
          <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={60} color="#D1D1D6" />
            <Text style={styles.emptyTitle}>No matches found</Text>
            <Text style={styles.emptySubtitle}>Try adjusting your search or category.</Text>
          </View>
        }
      />
      {(loading && !refreshing) && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#0A84FF" />
            <Text style={styles.loadingText}>Loading properties...</Text>
          </View>
        </View>
      )}
    </View>
  );
}

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
  trendingTitle: { color: '#FFF', fontSize: 18, fontFamily: 'Poppins_700Bold', marginBottom: 2 },
  trendingFooter: { flexDirection: 'row', alignItems: 'center' },
  trendingLocation: { color: '#FFF', fontSize: 12, fontFamily: 'Poppins_400Regular', marginLeft: 4, flex: 1 },
  trendingPrice: { color: '#FFF', fontSize: 14, fontFamily: 'Poppins_700Bold' },

  pagination: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#D1D1D6', marginHorizontal: 3 },
  activeDot: { width: 12, height: 4, borderRadius: 2, backgroundColor: '#0A84FF' },

  categoriesSection: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  categoriesScroll: { paddingHorizontal: 20 },
  categoryPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F5F5F5', marginRight: 10 },
  categoryPillActive: { backgroundColor: '#1A1A1A' },
  categoryText: { fontFamily: 'Poppins_500Medium', color: '#8E8E93', fontSize: 13 },
  categoryTextActive: { color: '#FFF' },

  filterBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15 },
  marketTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#000' },
  resultsCount: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93' },
  
  listContent: { paddingBottom: 40 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 20 },
  gridItemWrapper: { width: '48%' },

  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000', marginTop: 16 },
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', marginTop: 8 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EAF3FF',
    borderWidth: 1,
    borderColor: '#C9DCFB',
    paddingVertical: 10,
    marginHorizontal: 20,
    borderRadius: 12,
    marginBottom: 20,
  },
  offlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0A84FF',
    marginRight: 8,
  },
  offlineText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#D47A00',
  },
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
});
