import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, FlatList, ActivityIndicator, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../supabase';
import ListingCard from '../components/ListingCard';
import RequestViewModal from '../components/RequestViewModal';

const IOS_BLUE = '#007AFF';
const IOS_GRAY = '#8E8E93';
const IOS_BG   = '#F2F2F7';

export default function SavedScreen({ navigation }) {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestItem, setRequestItem] = useState(null);

  const loadFavorites = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('saved_properties')
      .select(`
        property_id,
        properties (*)
      `)
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false });

    if (!error && data) {
      const validProps = data.map(item => item.properties).filter(p => p !== null);
      
      const propsWithImages = await Promise.all(validProps.map(async (p) => {
        const { data: imgs } = await supabase.from('property_images').select('url').eq('property_id', p.id);
        return { ...p, property_images: imgs || [] };
      }));
      
      setFavorites(propsWithImages);
    }
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
    }, [])
  );

  const toggleFavorite = async (property) => {
    const { data: { user } } = await supabase.auth.getUser();
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
            <Ionicons name="heart-outline" size={44} color={IOS_BLUE} />
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
          keyExtractor={item => item.id.toString()}
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

