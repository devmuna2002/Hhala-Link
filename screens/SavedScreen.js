import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, FlatList, ActivityIndicator, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, getSessionUser } from '../supabase';
import ListingCard from '../components/ListingCard';
import RequestViewModal from '../components/RequestViewModal';
import { emitFeedScroll } from '../utils/feedScroll';

const IOS_BLUE = '#007AFF';
const IOS_GRAY = '#8E8E93';
const IOS_BG   = '#F2F2F7';

export default function SavedScreen({ navigation }) {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestItem, setRequestItem] = useState(null);

  const lastFeedY = useRef(0);
  const onFeedScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastFeedY.current;
    lastFeedY.current = y;
    if (Math.abs(dy) > 2) emitFeedScroll(dy);
  };

  const loadFavorites = async () => {
    setLoading(true);
    const user = await getSessionUser();
    if (!user) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    // Single round-trip: embed images + owner instead of one query per
    // saved property (N+1). Only the columns the cards render are selected.
    const { data, error } = await supabase
      .from('saved_properties')
      .select(`
        property_id,
        properties (
          id, title, rent_usd, sale_price_usd, listing_purpose, city, suburb,
          address, property_type, created_at, views, bedrooms, bathrooms,
          area_sqm, description, owner_id,
          property_images (url, alt_text),
          owner:profiles!owner_id(first_name, last_name, business_name, avatar_url, role)
        )
      `)
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false });

    if (!error && data) {
      setFavorites(data.map(item => item.properties).filter(p => p !== null));
    }
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
    }, [])
  );

  const toggleFavorite = async (property) => {
    const user = await getSessionUser();
    if (!user) return;

    const { error } = await supabase
      .from('saved_properties')
      .delete()
      .eq('user_id', user.id)
      .eq('property_id', property.id);

    if (!error) {
      setFavorites(prev => prev.filter(p => p.id !== property.id));
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Saved</Text>
        <Text style={styles.headerSub}>
          {loading ? 'Loading…' : `${favorites.length} propert${favorites.length === 1 ? 'y' : 'ies'}`}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={IOS_BLUE} />
          <Text style={styles.loadingText}>Loading saved properties…</Text>
        </View>
      ) : favorites.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.iconCircle}>
            <Ionicons name="heart" size={44} color="#8A8A8A" />
          </View>
          <Text style={styles.title}>No Saved Properties</Text>
          <Text style={styles.subtitle}>
            Tap the heart icon on any property to save it to your list.
          </Text>
          <TouchableOpacity 
            style={styles.btn} 
            onPress={() => navigation.navigate('Home')}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>Explore Properties</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={(item, index) => String(item?.id ?? index)}
          // Keep rows mounted so scrolling back never reloads pictures (no flicker).
          removeClippedSubviews={false}
          renderItem={({ item }) => (
            <View style={styles.cardWrapper}>
              <ListingCard 
                item={item} 
                onPress={() => setRequestItem(item)} 
                onFavorite={toggleFavorite}
                isFavorite={true}
                wide
              />
            </View>
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onScroll={onFeedScroll}
          scrollEventThrottle={16}
        />
      )}

      <RequestViewModal
        visible={!!requestItem}
        item={requestItem}
        onClose={() => setRequestItem(null)}
        onFavorite={toggleFavorite}
        isFavorite={requestItem ? favorites.some(f => f.id === requestItem.id) : false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: IOS_BG },
  header: { 
    paddingTop: Platform.OS === 'ios' ? 58 : 42, 
    paddingHorizontal: 16, 
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#000000', letterSpacing: -0.5 },
  headerSub: { fontSize: 13, color: IOS_GRAY, marginTop: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  loadingText: { fontSize: 14, color: IOS_GRAY },
  listContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 120 },
  cardWrapper: { marginBottom: 14 },
  
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 36,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EAF3FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: IOS_GRAY,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  btn: {
    backgroundColor: IOS_BLUE,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  }
});

