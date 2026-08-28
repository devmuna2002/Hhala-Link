import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, FlatList, TextInput, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

const PROPERTY_TYPES = ['apartment', 'house', 'cottage', 'studio', 'townhouse', 'room', 'office', 'shops', 'villa', 'stands'];

export default function SavedSearchesScreen({ navigation }) {
  const [searches, setSearches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form states
  const [city, setCity] = useState('');
  const [suburb, setSuburb] = useState('');
  const [propType, setPropType] = useState('apartment');
  const [maxPrice, setMaxPrice] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchSavedSearches();
  }, []);

  async function fetchSavedSearches() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('saved_searches')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setSearches(data || []);
    } catch (e) {
      console.log('Error fetching saved searches:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleAddSearch() {
    if (!city.trim()) {
      Alert.alert('Required', 'Please enter at least a City name.');
      return;
    }

    setAdding(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const newSearch = {
        user_id: user.id,
        city: city.trim(),
        suburb: suburb.trim() || null,
        property_type: propType,
        max_price: maxPrice ? parseFloat(maxPrice) : null
      };

      const { error } = await supabase
        .from('saved_searches')
        .insert(newSearch);

      if (error) throw error;

      // Reset Form
      setCity('');
      setSuburb('');
      setPropType('apartment');
      setMaxPrice('');

      Alert.alert('Success', 'Saved search alert active! You will get instant notifications of matches.');
      fetchSavedSearches();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDeleteSearch(id) {
    Alert.alert(
      'Remove Alert',
      'Are you sure you want to delete this search match alert?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('saved_searches')
                .delete()
                .eq('id', id);

              if (error) throw error;
              setSearches(prev => prev.filter(s => s.id !== id));
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          }
        }
      ]
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    fetchSavedSearches();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={28} color="#0A84FF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Match Alerts</Text>
        <View style={{ width: 28 }} />
      </View>

      <FlatList
        data={searches}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} color="#0A84FF" />}
        ListHeaderComponent={
          <View style={styles.formContainer}>
            <Text style={styles.sectionTitle}>Add New Search Alert</Text>
            <Text style={styles.sectionSubtitle}>Get instantly notified when properties matching your criteria are listed, just like Airbnb & Property24.</Text>

            <Text style={styles.label}>City (e.g. Harare, Bulawayo) *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Harare"
              placeholderTextColor="#AEAEB2"
              value={city}
              onChangeText={setCity}
            />

            <Text style={styles.label}>Suburb (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Avondale"
              placeholderTextColor="#AEAEB2"
              value={suburb}
              onChangeText={setSuburb}
            />

            <View style={styles.row}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.label}>Property Type</Text>
                <TouchableOpacity 
                  style={styles.selector}
                  onPress={() => {
                    const nextIndex = (PROPERTY_TYPES.indexOf(propType) + 1) % PROPERTY_TYPES.length;
                    setPropType(PROPERTY_TYPES[nextIndex]);
                  }}
                >
                  <Text style={styles.selectorText}>{propType.toUpperCase()}</Text>
                  <Ionicons name="chevron-down" size={14} color="#8E8E93" />
                </TouchableOpacity>
              </View>

              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.label}>Max Rent Price ($)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. 500"
                  placeholderTextColor="#AEAEB2"
                  keyboardType="numeric"
                  value={maxPrice}
                  onChangeText={setMaxPrice}
                />
              </View>
            </View>

            <TouchableOpacity 
              style={styles.addBtn}
              onPress={handleAddSearch}
              disabled={adding}
            >
              {adding ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Ionicons name="notifications-outline" size={18} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={styles.addBtnText}>Activate Alert</Text>
                </>
              )}
            </TouchableOpacity>

            {searches.length > 0 && (
              <Text style={styles.sectionHeaderTitle}>ACTIVE ALERTS ({searches.length})</Text>
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          const isFirst = index === 0;
          const isLast = index === searches.length - 1;
          return (
            <View style={[
              styles.card,
              isFirst && { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
              isLast && { borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderBottomWidth: 0 },
              searches.length === 1 && { borderRadius: 12, borderBottomWidth: 0 }
            ]}>
              <View style={styles.cardLeft}>
                <View style={styles.bellBadge}>
                  <Ionicons name="notifications" size={18} color="#0A84FF" />
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>
                    {item.city} {item.suburb ? `(${item.suburb})` : ''}
                  </Text>
                  <Text style={styles.cardDetails}>
                    {item.property_type ? item.property_type.toUpperCase() : 'ANY TYPE'} • {item.max_price ? `Max $${item.max_price}/mo` : 'NO PRICE LIMIT'}
                  </Text>
                </View>
              </View>

              <TouchableOpacity onPress={() => handleDeleteSearch(item.id)} style={styles.deleteBtn}>
                <Ionicons name="trash-outline" size={18} color="#FF3B30" />
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 20 }} />
          ) : (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={40} color="#D1D1D6" />
              <Text style={styles.emptyText}>No active search alerts.</Text>
            </View>
          )
        }
        contentContainerStyle={styles.listContent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: Platform.OS === 'ios' ? 100 : 70, 
    paddingHorizontal: 20, 
    paddingBottom: 15, 
    borderBottomWidth: StyleSheet.hairlineWidth, 
    borderBottomColor: '#C6C6C8',
    backgroundColor: '#FFFFFF',
  },
  backBtn: { padding: 4, marginLeft: -8 },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#000' },
  listContent: { paddingVertical: 16, paddingBottom: 60 },
  
  formContainer: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginHorizontal: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    marginBottom: 24,
  },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000', marginBottom: 4 },
  sectionSubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93', lineHeight: 18, marginBottom: 15 },
  label: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#8E8E93', marginBottom: 6, textTransform: 'uppercase' },
  input: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    height: 40,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    color: '#000',
    backgroundColor: '#F2F2F7',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    borderRadius: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F2F2F7',
  },
  selectorText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#000' },
  addBtn: {
    flexDirection: 'row',
    backgroundColor: '#0A84FF',
    height: 44,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  addBtnText: { fontFamily: 'Poppins_700Bold', fontSize: 14, color: '#FFF' },
  
  sectionHeaderTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 24,
    marginBottom: -4,
    textTransform: 'uppercase'
  },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#FFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
    marginHorizontal: 16,
  },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  bellBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#E5F1FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardText: { flex: 1 },
  cardTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#000' },
  cardDetails: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#8E8E93', marginTop: 2 },
  deleteBtn: { padding: 8, marginRight: -8 },
  
  emptyContainer: { alignItems: 'center', marginTop: 30, paddingHorizontal: 20 },
  emptyText: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', marginTop: 8 }
});
