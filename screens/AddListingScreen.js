import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Alert, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../supabase';

const CATEGORIES = [
  { id: 'house', name: 'House' },
  { id: 'villa', name: 'Villa' },
  { id: 'apartment', name: 'Apartment' },
  { id: 'cottage', name: 'Cottage' },
  { id: 'studio', name: 'Studio' },
  { id: 'room', name: 'Room' },
  { id: 'shops', name: 'Shops' },
  { id: 'offices', name: 'Offices' },
  { id: 'stands', name: 'Stands' },
];

export default function AddListingScreen({ route, navigation }) {
  const editItem = route?.params?.editItem;
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [checkingSub, setCheckingSub] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]); 
  const [form, setForm] = useState({
    title: editItem?.title || '',
    property_type: editItem?.property_type || 'apartment',
    rent_usd: editItem?.rent_usd ? String(editItem.rent_usd) : '',
    address: editItem?.address || '',
    city: editItem?.city || '',
    bedrooms: editItem?.bedrooms ? String(editItem.bedrooms) : '1',
    bathrooms: editItem?.bathrooms ? String(editItem.bathrooms) : '1',
    floor_level: editItem?.floor_level || '',
    is_furnished: editItem?.is_furnished || false,
    parking_spots: editItem?.parking_spots ? String(editItem.parking_spots) : '',
    water_source: editItem?.water_source || '',
    area_sqm: editItem?.area_sqm ? String(editItem.area_sqm) : '',
    description: editItem?.description || ''
  });

  const handleUpdate = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 10, // Allowing up to 10 images
      quality: 0.5,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const newImages = result.assets.map(asset => ({ uri: asset.uri, base64: asset.base64 }));
      setSelectedImages(prev => [...prev, ...newImages].slice(0, 10)); // cap at 10
    }
  };

  useFocusEffect(
    useCallback(() => {
      checkSubscription();
    }, [])
  );

  const checkSubscription = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      if (data && data.length > 0) {
        const latest = data[0];
        const expiry = new Date(latest.expires_at);
        const now = new Date();
        
        if (latest.status === 'active' && expiry > now) {
          setIsSubscribed(true);
        } else {
          setIsSubscribed(false);
        }
      } else {
        setIsSubscribed(false);
      }
    } catch (error) {
      console.error('Sub check error:', error);
    } finally {
      setCheckingSub(false);
    }
  };

  const handleSubmit = async () => {
    if (!isSubscribed) {
      Alert.alert(
        'Subscription Required',
        'You need an active $5/30-days subscription to freely upload unlimited listings on Hlala Link.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Subscribe Now', onPress: () => navigation.navigate('Payment') }
        ]
      );
      return;
    }

    if (!form.title || !form.rent_usd || !form.address || !form.city) {
      Alert.alert('Missing Fields', 'Please fill in all required fields (Title, Rent, Address, City).');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'You must be logged in to upload a property.');
        setLoading(false);
        return;
      }

      // Format payload for Supabase 'properties' table
      const payload = {
        owner_id: user.id,
        title: form.title,
        property_type: form.property_type,
        rent_usd: parseFloat(form.rent_usd),
        address: form.address,
        city: form.city,
        bedrooms: parseInt(form.bedrooms) || 0,
        bathrooms: parseInt(form.bathrooms) || 0,
        floor_level: form.floor_level,
        is_furnished: form.is_furnished,
        parking_spots: parseInt(form.parking_spots) || 0,
        water_source: form.water_source,
        area_sqm: parseFloat(form.area_sqm) || null,
        description: form.description,
        status: 'available',
        country: 'Zimbabwe' // Default
      };

      let insertedProperty;

      if (editItem) {
        const { data, error } = await supabase.from('properties').update(payload).eq('id', editItem.id).select().single();
        if (error) throw error;
        insertedProperty = data;
      } else {
        const { data, error } = await supabase.from('properties').insert(payload).select().single();
        if (error) throw error;
        insertedProperty = data;
      }

      // If images were selected, upload their base64s to the property_images table
      if (selectedImages.length > 0 && insertedProperty) {
        const imagePayloads = selectedImages.map((img, index) => ({
          property_id: insertedProperty.id,
          storage_path: 'local_base64', 
          url: `data:image/jpeg;base64,${img.base64}`,
          is_cover: index === 0, // First image is cover
          sort_order: index
        }));
        await supabase.from('property_images').insert(imagePayloads);
      }

      Alert.alert('Success!', editItem ? 'Property updated successfully.' : 'Property uploaded successfully.');
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{editItem ? 'Edit Listing' : 'Add New Listing'}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        
        {/* Photo Placeholder & Preview */}
        {selectedImages.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScrollContainer}>
            {selectedImages.map((img, idx) => (
              <Image key={idx} source={{ uri: img.uri }} style={styles.previewImageMulti} />
            ))}
            <TouchableOpacity style={styles.addMorePhotosBtn} onPress={pickImage}>
              <Ionicons name="add" size={30} color="#0A84FF" />
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <TouchableOpacity style={styles.photoUploadBox} onPress={pickImage}>
            <Ionicons name="images-outline" size={40} color="#0A84FF" />
            <Text style={styles.photoText}>Upload Property Photos (Up to 10)</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Property Category</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryScroll}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity 
              key={cat.id} 
              style={[styles.catPill, form.property_type === cat.id && styles.catPillActive]}
              onPress={() => handleUpdate('property_type', cat.id)}
            >
              <Text style={[styles.catText, form.property_type === cat.id && styles.catTextActive]}>{cat.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.sectionTitle}>Basic Details</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Property Title *</Text>
          <TextInput style={styles.input} placeholder="e.g. Modern 2-Bed Apartment" value={form.title} onChangeText={(val) => handleUpdate('title', val)} />
        </View>

        <View style={styles.rowInputs}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.label}>Rent per month (USD) *</Text>
            <TextInput style={styles.input} placeholder="0.00" keyboardType="numeric" value={form.rent_usd} onChangeText={(val) => handleUpdate('rent_usd', val)} />
          </View>
        </View>

        {form.property_type === 'stands' && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Stand Size (sqm) *</Text>
            <TextInput 
              style={styles.input} 
              placeholder="e.g. 2000" 
              keyboardType="numeric" 
              value={form.area_sqm} 
              onChangeText={(val) => handleUpdate('area_sqm', val)} 
            />
          </View>
        )}

        {form.property_type !== 'stands' && (
          <View style={styles.rowInputs}>
            <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
              <Text style={styles.label}>Bedrooms</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={form.bedrooms} onChangeText={(val) => handleUpdate('bedrooms', val)} />
            </View>
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Bathrooms</Text>
              <TextInput style={styles.input} keyboardType="numeric" value={form.bathrooms} onChangeText={(val) => handleUpdate('bathrooms', val)} />
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>Location</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Location *</Text>
          <TextInput style={styles.input} placeholder="e.g. 123 Borrowdale Road" value={form.address} onChangeText={(val) => handleUpdate('address', val)} />
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>City *</Text>
          <TextInput style={styles.input} placeholder="e.g. Harare" value={form.city} onChangeText={(val) => handleUpdate('city', val)} />
        </View>

        <Text style={styles.sectionTitle}>Key Specifications</Text>
        <View style={styles.rowInputs}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.label}>Floor Level</Text>
            <TextInput style={styles.input} placeholder="e.g. Ground" value={form.floor_level} onChangeText={(val) => handleUpdate('floor_level', val)} />
          </View>
          <View style={[styles.inputGroup, { flex: 1 }]}>
            <Text style={styles.label}>Parking Spots</Text>
            <TextInput style={styles.input} placeholder="e.g. 2" keyboardType="numeric" value={form.parking_spots} onChangeText={(val) => handleUpdate('parking_spots', val)} />
          </View>
        </View>

        <View style={styles.rowInputs}>
          <View style={[styles.inputGroup, { flex: 1, marginRight: 10 }]}>
            <Text style={styles.label}>Water Source</Text>
            <TextInput style={styles.input} placeholder="e.g. Borehole" value={form.water_source} onChangeText={(val) => handleUpdate('water_source', val)} />
          </View>
          {form.property_type !== 'stands' && (
            <View style={[styles.inputGroup, { flex: 1 }]}>
              <Text style={styles.label}>Furnished?</Text>
              <View style={styles.toggleRow}>
                <TouchableOpacity 
                  style={[styles.toggleBtn, form.is_furnished && styles.toggleBtnActive]} 
                  onPress={() => handleUpdate('is_furnished', true)}
                >
                  <Text style={[styles.toggleText, form.is_furnished && styles.toggleTextActive]}>Yes</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.toggleBtn, !form.is_furnished && styles.toggleBtnActive]} 
                  onPress={() => handleUpdate('is_furnished', false)}
                >
                  <Text style={[styles.toggleText, !form.is_furnished && styles.toggleTextActive]}>No</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Description</Text>
        <View style={styles.inputGroup}>
          <TextInput 
            style={[styles.input, styles.textArea]} 
            placeholder="Tell us about the property..." 
            multiline 
            numberOfLines={4}
            value={form.description} 
            onChangeText={(val) => handleUpdate('description', val)} 
          />
        </View>

        <TouchableOpacity style={[styles.submitBtn, loading && { opacity: 0.7 }]} onPress={handleSubmit} disabled={loading}>
          <Text style={styles.submitText}>{loading ? 'Saving...' : (editItem ? 'Save Changes' : 'Publish Listing')}</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 30, paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000' },
  
  scroll: { padding: 20, paddingBottom: 60 },
  
  photoUploadBox: { width: '100%', height: 120, backgroundColor: '#F0F5FF', borderRadius: 16, borderStyle: 'dashed', borderWidth: 2, borderColor: '#0A84FF', justifyContent: 'center', alignItems: 'center', marginBottom: 24, overflow: 'hidden' },
  photoText: { fontFamily: 'Poppins_500Medium', color: '#0A84FF', marginTop: 8 },
  imageScrollContainer: { marginBottom: 24, height: 100 },
  previewImageMulti: { width: 100, height: 100, borderRadius: 12, marginRight: 12, resizeMode: 'cover' },
  addMorePhotosBtn: { width: 100, height: 100, backgroundColor: '#F0F5FF', borderRadius: 12, borderStyle: 'dashed', borderWidth: 2, borderColor: '#0A84FF', justifyContent: 'center', alignItems: 'center', marginRight: 12 },

  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000', marginBottom: 12, marginTop: 8 },
  
  categoryScroll: { marginBottom: 24 },
  catPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#F5F5F5', marginRight: 12, borderWidth: 1, borderColor: '#F5F5F5' },
  catPillActive: { backgroundColor: '#E0F0FF', borderColor: '#0A84FF' },
  catText: { fontFamily: 'Poppins_500Medium', color: '#8E8E93' },
  catTextActive: { color: '#0A84FF' },

  inputGroup: { marginBottom: 16 },
  label: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#8E8E93', marginBottom: 6 },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 16, height: 52, fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#000' },
  textArea: { height: 100, paddingTop: 16, textAlignVertical: 'top' },
  
  rowInputs: { flexDirection: 'row', justifyContent: 'space-between' },
  toggleRow: { flexDirection: 'row', backgroundColor: '#F5F5F5', borderRadius: 12, padding: 4, height: 52 },
  toggleBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  toggleBtnActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, elevation: 2 },
  toggleText: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#8E8E93' },
  toggleTextActive: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' },

  submitBtn: { backgroundColor: '#0A84FF', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 20, shadowColor: '#0A84FF', shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  submitText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FFF' }
});
