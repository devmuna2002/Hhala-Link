import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, ScrollView, Text, StyleSheet, Platform, TextInput, TouchableOpacity, StatusBar, ActivityIndicator, FlatList, Image, useWindowDimensions, RefreshControl } from 'react-native';
import { supabase } from '../supabase';
import ListingCard from '../components/ListingCard';
import { Ionicons } from '@expo/vector-icons';

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

export default function ExploreScreen({ navigation, route }) {
  const { width: screenWidth } = useWindowDimensions();
  const [listings, setListings] = useState([]);
  const [featuredListings, setFeaturedListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savedProperties, setSavedProperties] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const initialCategory = route.params?.category || 'all';
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);
  
  const featuredRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const loadListings = async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setRefreshing(true);
    try {
      const SELECT_COLUMNS = 'id, title, rent_usd, city, suburb, property_type, created_at, views, property_images(url)';

      // Fetch Featured/Trending
      const { data: featured } = await supabase
        .from('properties')
        .select(SELECT_COLUMNS)
        .order('views', { ascending: false })
        .limit(5);
      
      if (featured) setFeaturedListings(featured);

      // Fetch Regular
      let query = supabase
        .from('properties')
        .select(SELECT_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(30);
      
      if (selectedCategory !== 'all') {
        query = query.eq('property_type', selectedCategory);
      }

      const { data, error } = await query;
      if (error) throw error;
      setListings(data || []);
    } catch (error) {
      console.log('Explore error:', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    loadListings(true);
  };

  const toggleFavorite = async (property) => {
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
        await supabase.from('saved_properties').delete().eq('user_id', user.id).eq('property_id', property.id);
      } else {
        await supabase.from('saved_properties').insert({ user_id: user.id, property_id: property.id });
      }
    } catch (e) {
      // Revert
      if (isFav) setSavedProperties(prev => [...prev, property.id]);
      else setSavedProperties(prev => prev.filter(id => id !== property.id));
    }
  };

  const loadSavedProperties = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('saved_properties').select('property_id').eq('user_id', user.id);
    if (data) setSavedProperties(data.map(item => item.property_id));
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

  const filteredListings = listings.filter(p => 
    searchQuery === '' || 
    (p.title && p.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (p.city && p.city.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color="#A0A0A0" />
          <TextInput
            placeholder="Search market..."
            placeholderTextColor="#A0A0A0"
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity style={styles.searchActionBtn}>
            <Ionicons name="search" size={16} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ListHeaderComponent={
          <>
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
                      <Image source={{ uri: item.property_images?.[0]?.url || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994' }} style={styles.trendingImg} />
                      <View style={styles.trendingOverlay}>
                        <View style={styles.trendingBadge}>
                          <Ionicons name="flame" size={12} color="#FFF" />
                          <Text style={styles.trendingBadgeText}>TRENDING</Text>
                        </View>
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
          loading ? (
            <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={60} color="#D1D1D6" />
              <Text style={styles.emptyTitle}>No matches found</Text>
              <Text style={styles.emptySubtitle}>Try adjusting your search or category.</Text>
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
    alignItems: 'center', 
    paddingHorizontal: 20, 
    paddingTop: Platform.OS === 'ios' ? 100 : 70,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0'
  },
  backBtn: { marginRight: 15 },
  searchBar: { 
    flex: 1, 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#F5F5F5', 
    height: 44, 
    borderRadius: 12, 
    paddingLeft: 12,
    paddingRight: 5
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15, color: '#000' },
  searchActionBtn: { 
    backgroundColor: '#0A84FF', 
    width: 34, 
    height: 34, 
    borderRadius: 10, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  
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
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', marginTop: 8 }
});
