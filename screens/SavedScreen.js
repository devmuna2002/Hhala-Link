import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../supabase';
import ListingCard from '../components/ListingCard';

export default function SavedScreen({ navigation }) {
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadFavorites = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setFavorites([]);
      setLoading(false);
      return;
    }

    // Fetch saved properties with their full details
    const { data, error } = await supabase
      .from('saved_properties')
      .select(`
        property_id,
        properties (*)
      `)
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false });

    if (!error && data) {
      // Filter out any potential nulls if a property was deleted
      const validProps = data.map(item => item.properties).filter(p => p !== null);
      
      // Fetch images for these properties to ensure they show up in the card
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

    // In SavedScreen, toggling it usually means removing it
    const { error } = await supabase
      .from('saved_properties')
      .delete()
      .eq('user_id', user.id)
      .eq('property_id', property.id);

    if (!error) {
      setFavorites(prev => prev.filter(p => p.id !== property.id));
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#0A84FF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Favorites</Text>
      </View>

      {favorites.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.iconCircle}>
            <Ionicons name="heart-outline" size={48} color="#0A84FF" />
          </View>
          <Text style={styles.title}>No Favorites Yet</Text>
          <Text style={styles.subtitle}>Tap the heart icon on properties you like to save them for later.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.navigate('Home')}>
            <Text style={styles.btnText}>Explore Properties</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <View style={styles.cardWrapper}>
              <ListingCard 
                item={item} 
                onPress={() => navigation.navigate('Detail', { item })} 
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
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: { 
    paddingTop: Platform.OS === 'ios' ? 60 : 30, 
    paddingHorizontal: 20, 
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5'
  },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24, color: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 20, paddingVertical: 20 },
  cardWrapper: { marginBottom: 20 },
  
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginTop: -50,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F0F5FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: '#000',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  btn: {
    backgroundColor: '#0A84FF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 24,
    shadowColor: '#0A84FF',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  btnText: {
    color: '#FFF',
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
  }
});
