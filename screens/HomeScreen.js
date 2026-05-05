import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ScrollView, Text, StyleSheet, Platform, TextInput, TouchableOpacity, StatusBar, ActivityIndicator, Modal, FlatList, Image, RefreshControl, useWindowDimensions, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../supabase';
import ListingCard from '../components/ListingCard';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

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

export default function HomeScreen({ navigation }) {
  const { width: screenWidth } = useWindowDimensions();
  const [listings, setListings] = useState([]);
  const [featuredListings, setFeaturedListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentLocation, setCurrentLocation] = useState('All Locations');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [savedProperties, setSavedProperties] = useState([]);

  useEffect(() => {
    const fetchSuggestions = async () => {
      if (searchQuery.length > 2) {
        const { data } = await supabase
          .from('properties')
          .select('title, city, suburb')
          .or(`title.ilike.%${searchQuery}%,city.ilike.%${searchQuery}%,suburb.ilike.%${searchQuery}%`)
          .limit(6);

        if (data) {
          const combined = new Set();
          data.forEach(item => {
            if (item.city?.toLowerCase().includes(searchQuery.toLowerCase())) combined.add(item.city);
            if (item.suburb?.toLowerCase().includes(searchQuery.toLowerCase())) combined.add(item.suburb);
            if (item.title?.toLowerCase().includes(searchQuery.toLowerCase())) combined.add(item.title);
          });
          setSuggestions(Array.from(combined).slice(0, 5));
          setShowSuggestions(true);
        }
      } else {
        setShowSuggestions(false);
      }
    };

    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const [userData, setUserData] = useState(null);
  
  const featuredRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const loadListings = async (silent = false, searchOverride = null) => {
    if (!silent) setLoading(true);
    try {
      const activeSearch = searchOverride !== null ? searchOverride : searchQuery;

      // Load Featured
      const { data: featured } = await supabase
        .from('properties')
        .select('*, property_images(url), owner:profiles!owner_id(first_name, last_name, avatar_url)')
        .order('views', { ascending: false }) // Sort by popularity
        .limit(5);
      if (featured) setFeaturedListings(featured);

      // Load Recently Added (Align with Explore order)
      let query = supabase
        .from('properties')
        .select('*, property_images(url), owner:profiles!owner_id(first_name, last_name, avatar_url)')
        .order('created_at', { ascending: false });
      
      if (selectedCategory !== 'all') {
        query = query.eq('property_type', selectedCategory);
      }
      
      if (currentLocation !== 'All Locations') {
        const cityOnly = currentLocation.split(',')[0];
        query = query.ilike('city', `%${cityOnly}%`);
      }

      if (activeSearch && activeSearch.trim().length > 0) {
        const terms = activeSearch.trim().split(/\s+/);
        const searchFilters = terms.map(term => {
          const t = `%${term}%`;
          return `title.ilike.${t},city.ilike.${t},suburb.ilike.${t},description.ilike.${t},address.ilike.${t}`;
        }).join(',');
        
        query = query.or(searchFilters);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      setListings(data || []);
    } catch (error) {
      console.log('Error loading listings:', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const toggleFavorite = async (property) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Login Required', 'Please log in to save properties.');
      return;
    }

    const isFav = savedProperties.includes(property.id);
    if (isFav) {
      await supabase.from('saved_properties').delete().eq('user_id', user.id).eq('property_id', property.id);
      setSavedProperties(prev => prev.filter(id => id !== property.id));
    } else {
      await supabase.from('saved_properties').insert({ user_id: user.id, property_id: property.id });
      setSavedProperties(prev => [...prev, property.id]);
    }
  };

  const loadSavedProperties = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('saved_properties').select('property_id').eq('user_id', user.id);
    if (data) setSavedProperties(data.map(item => item.property_id));
  };

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
      setUserData(data);
    }
  };
  
  const updateLastSeen = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', user.id);
    }
  };

  useEffect(() => {
    updateLastSeen();
    const interval = setInterval(updateLastSeen, 60000); // Heartbeat every 60s
    return () => clearInterval(interval);
  }, []);

  const fetchUnreadCount = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_read', false);
    setUnreadNotifs(count || 0);
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
        const city = reverse[0].city || reverse[0].region;
        if (city) setCurrentLocation(`${city}, ZW`);
      }
    } catch (e) {
      console.log('Error getting location:', e);
    }
  };

  useEffect(() => {
    getUserLocation();
    loadSavedProperties();
    loadUserData();
  }, []);

  useEffect(() => {
    loadListings();
  }, [currentLocation, selectedCategory]);

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

  const onRefresh = () => {
    setRefreshing(true);
    loadListings();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.locationContainer}>
          <View style={styles.locIconBox}>
            <Ionicons name="location" size={18} color="#0A84FF" />
          </View>
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.locLabel}>Location</Text>
            <Text style={styles.locText}>{currentLocation}</Text>
          </View>
          <Ionicons name="chevron-down" size={16} color="#8E8E93" style={{ marginLeft: 6 }} />
        </TouchableOpacity>
        
        <View style={styles.headerRight}>
          <TouchableOpacity style={[styles.iconBtn, { marginRight: 12 }]} onPress={() => navigation.navigate('AgentHome')}>
            <Ionicons name="add" size={24} color="#0A84FF" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.iconBtn, { marginRight: 12 }]} onPress={() => navigation.navigate('Notifications')}>
            <Ionicons name="notifications-outline" size={20} color="#000" />
            {unreadNotifs > 0 && <View style={styles.notifDot} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
            {userData?.avatar_url ? (
              <Image source={{ uri: userData.avatar_url }} style={styles.avatarMini} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={16} color="#0A84FF" />
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ListHeaderComponent={
          <>
            {/* Search Bar */}
            <View style={styles.searchSection}>
              <View style={styles.searchBar}>
                <Ionicons name="search" size={20} color="#A0A0A0" />
                <TextInput 
                  placeholder="Where do you want to stay?" 
                  placeholderTextColor="#A0A0A0"
                  style={styles.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onSubmitEditing={() => loadListings()}
                />
                <TouchableOpacity style={styles.filterBtn} onPress={() => loadListings()}>
                  <Ionicons name="search" size={18} color="#FFF" />
                </TouchableOpacity>
              </View>

              {showSuggestions && suggestions.length > 0 && (
                <View style={styles.suggestionsDropdown}>
                  {suggestions.map((s, i) => (
                    <TouchableOpacity 
                      key={i} 
                      style={styles.suggestionItem} 
                      onPress={() => {
                        setSearchQuery(s);
                        setShowSuggestions(false);
                        loadListings(false, s);
                      }}
                    >
                      <Ionicons name="location-outline" size={16} color="#8E8E93" />
                      <Text style={styles.suggestionText} numberOfLines={1}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Trending */}
            {featuredListings.length > 0 && (
              <View style={styles.trendingSection}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Trending Properties</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('Explore')}>
                    <Text style={styles.seeAll}>See All</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  ref={featuredRef}
                  data={featuredListings}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={item => `trending-${item.id}`}
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
                      <Image source={{ uri: item.property_images?.[0]?.url || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994' }} style={styles.trendingImg} />
                      <View style={styles.trendingOverlay}>
                        <View style={styles.trendingBadge}><Ionicons name="flash" size={12} color="#FFF" /><Text style={styles.trendingBadgeText}>POPULAR</Text></View>
                        <View>
                          <Text style={styles.trendingTitle}>{item.title}</Text>
                          <View style={styles.trendingFooter}>
                            <Ionicons name="location" size={14} color="#FFF" />
                            <Text style={styles.trendingLocation}>{item.city}</Text>
                            <Text style={styles.trendingPrice}>${item.rent_usd}/mo</Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  )}
                />
                <View style={styles.pagination}>
                  {featuredListings.map((_, i) => <View key={i} style={[styles.dot, activeIndex === i && styles.activeDot]} />)}
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

            <View style={[styles.sectionHeader, { marginTop: 20 }]}>
              <Text style={styles.sectionTitle}>Recently Added</Text>
              <Text style={styles.resultsCount}>{listings.length} items</Text>
            </View>
          </>
        }
        data={listings}
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
            <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 40 }} />
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
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingTop: Platform.OS === 'ios' ? 100 : 70,
    marginBottom: 25
  },
  locationContainer: { flexDirection: 'row', alignItems: 'center' },
  locIconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center' },
  locLabel: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#8E8E93' },
  locText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#1A1A1A' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', position: 'relative' },
  notifDot: { position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', borderWidth: 2, borderColor: '#F5F5F5' },
  avatarMini: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: '#F5F5F5' },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E1F0FF', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#F5F5F5' },

  searchSection: { paddingHorizontal: 20, marginBottom: 25 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', height: 54, borderRadius: 16, paddingLeft: 16, paddingRight: 7 },
  searchInput: { flex: 1, marginLeft: 12, fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#000' },
  filterBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#0A84FF', justifyContent: 'center', alignItems: 'center', shadowColor: '#0A84FF', shadowOpacity: 0.2, shadowRadius: 5, elevation: 3 },
  
  suggestionsDropdown: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 10,
    zIndex: 1000
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5'
  },
  suggestionText: {
    marginLeft: 10,
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#1A1A1A'
  },

  trendingSection: { marginBottom: 30 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, paddingHorizontal: 20 },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#1A1A1A' },
  seeAll: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#0A84FF' },
  resultsCount: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },

  trendingCard: { height: 200, marginHorizontal: 20, borderRadius: 24, overflow: 'hidden', backgroundColor: '#F5F5F5' },
  trendingImg: { width: '100%', height: '100%' },
  trendingOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'space-between', height: '100%' },
  trendingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FF3B30', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, alignSelf: 'flex-start' },
  trendingBadgeText: { color: '#FFF', fontSize: 10, fontFamily: 'Poppins_700Bold', marginLeft: 4 },
  trendingTitle: { color: '#FFF', fontSize: 20, fontFamily: 'Poppins_700Bold', marginBottom: 4 },
  trendingFooter: { flexDirection: 'row', alignItems: 'center' },
  trendingLocation: { color: '#FFF', fontSize: 13, fontFamily: 'Poppins_400Regular', marginLeft: 4, flex: 1 },
  trendingPrice: { color: '#FFF', fontSize: 16, fontFamily: 'Poppins_700Bold' },

  pagination: { flexDirection: 'row', justifyContent: 'center', marginTop: 15 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D1D6', marginHorizontal: 4 },
  activeDot: { width: 18, height: 6, borderRadius: 3, backgroundColor: '#0A84FF' },

  categoriesSection: { marginBottom: 10 },
  categoriesScroll: { paddingHorizontal: 20 },
  categoryPill: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 15, backgroundColor: '#F5F5F5', marginRight: 12 },
  categoryPillActive: { backgroundColor: '#1A1A1A' },
  categoryText: { fontFamily: 'Poppins_500Medium', color: '#8E8E93', fontSize: 14 },
  categoryTextActive: { color: '#FFF' },

  listContent: { paddingBottom: 100 },
  columnWrapper: { justifyContent: 'space-between', paddingHorizontal: 20 },
  gridItemWrapper: { width: '48%' },

  emptyContainer: { alignItems: 'center', marginTop: 40, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000', marginTop: 16 },
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', marginTop: 8, textAlign: 'center' }
});
