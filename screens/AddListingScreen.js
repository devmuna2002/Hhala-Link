import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Alert, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
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
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]); 
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [form, setForm] = useState({
    title: editItem?.title || '',
    property_type: editItem?.property_type || 'apartment',
    rent_usd: editItem?.rent_usd ? String(editItem.rent_usd) : '',
    address: editItem?.address || '',
    city: editItem?.city || '',
    suburb: editItem?.suburb || '',
    bedrooms: editItem?.bedrooms ? String(editItem.bedrooms) : '1',
    bathrooms: editItem?.bathrooms ? String(editItem.bathrooms) : '1',
    floor_level: editItem?.floor_level || '',
    is_furnished: editItem?.is_furnished || false,
    parking_spots: editItem?.parking_spots ? String(editItem.parking_spots) : '',
    water_source: editItem?.water_source || '',
    area_sqm: editItem?.area_sqm ? String(editItem.area_sqm) : '',
    listing_purpose: editItem?.listing_purpose || 'rent',
    sale_price_usd: editItem?.sale_price_usd ? String(editItem.sale_price_usd) : '',
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

  const MAX_VIDEO_SECONDS = 30;

  // Some Android pickers report duration in milliseconds — normalize to seconds
  const normalizeDuration = (d) => {
    if (!d || d <= 0) return 0;
    return d > 1000 ? d / 1000 : d;
  };

  const pickVideo = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsVideoEditing: true,
      videoMaxDuration: MAX_VIDEO_SECONDS,
      quality: 1,
    });

    if (!result.canceled && result.assets?.length > 0) {
      const asset = result.assets[0];
      const duration = normalizeDuration(asset.duration);

      // Hard guarantee: nothing longer than 30s ever gets attached/uploaded
      if (duration > MAX_VIDEO_SECONDS + 1) {
        Alert.alert(
          'Video Too Long',
          `That clip is about ${Math.round(duration)}s long. Please trim it to ${MAX_VIDEO_SECONDS}s or less.`,
          [
            { text: 'Trim Again', onPress: pickVideo },
            { text: 'Cancel', style: 'cancel' }
          ]
        );
        return;
      }

      setSelectedVideo({ uri: asset.uri, duration });
    }
  };

  const base64ToArrayBuffer = (data) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const len = data.length;
    let bufferLength = len * 0.75;
    if (data[len - 1] === '=') bufferLength--;
    if (data[len - 2] === '=') bufferLength--;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const bytes = new Uint8Array(arrayBuffer);
    for (let i = 0, j = 0; i < len; i += 4, j += 3) {
      const e1 = chars.indexOf(data[i]);
      const e2 = chars.indexOf(data[i + 1]);
      const e3 = chars.indexOf(data[i + 2]);
      const e4 = chars.indexOf(data[i + 3]);
      bytes[j] = (e1 << 2) | (e2 >> 4);
      bytes[j + 1] = ((e2 & 15) << 4) | (e3 >> 2);
      bytes[j + 2] = ((e3 & 3) << 6) | e4;
    }
    return arrayBuffer;
  };

  const uploadVideoToStorage = async (propertyId, userId) => {
    setUploadingVideo(true);
    try {
      // Final safety check: never upload anything longer than 30s
      if (normalizeDuration(selectedVideo.duration) > MAX_VIDEO_SECONDS + 1) {
        console.log('Skipping video upload: longer than 30s');
        return false;
      }

      const extMatch = selectedVideo.uri.split('.').pop().toLowerCase().split('?')[0];
      const ext = ['mp4', 'mov', 'webm', 'm4v'].includes(extMatch) ? extMatch : 'mp4';
      const contentType = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' }[ext];

      const filePath = `${userId}/${propertyId}/${Date.now()}.${ext}`;

      // Stream the file straight from disk (handles large files without memory issues)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      const uploadResult = await FileSystem.uploadAsync(
        `${supabase.supabaseUrl}/storage/v1/object/properties/${filePath}`,
        selectedVideo.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': contentType,
          },
        }
      );

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Storage responded ${uploadResult.status}`);
      }

      const { data: { publicUrl } } = supabase.storage
        .from('properties')
        .getPublicUrl(filePath);

      await supabase.from('property_images').insert({
        property_id: propertyId,
        storage_path: filePath,
        url: publicUrl,
        alt_text: 'video',
        is_cover: false,
        sort_order: 999
      });

      return true;
    } catch (e) {
      console.log('Video upload error:', e.message);
      Alert.alert('Video Upload Failed', 'Your listing was saved, but the video could not be uploaded. Please make sure the "properties" storage bucket exists in Supabase.');
      return false;
    } finally {
      setUploadingVideo(false);
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
      if (user) {
        const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        setUserRole(data?.role || null);
      }
    } catch (_) {}
    // Subscriptions currently paused - posting is 100% free
    setIsSubscribed(true);
    setCheckingSub(false);
  };

  const handleSubmit = async () => {
    const purpose = form.listing_purpose;
    const needRent = purpose === 'rent' || purpose === 'both';
    const needSale = purpose === 'sale' || purpose === 'both';

    const missing = [];
    if (!form.title) missing.push('Title');
    if (!form.address) missing.push('Address');
    if (!form.city) missing.push('City');
    if (needRent && !form.rent_usd) missing.push('Rent');
    if (needSale && !form.sale_price_usd) missing.push('Sale Price');

    if (missing.length > 0) {
      Alert.alert('Missing Fields', `Please fill in: ${missing.join(', ')}.`);
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
        listing_purpose: purpose,
        rent_usd: needRent ? parseFloat(form.rent_usd) : null,
        sale_price_usd: needSale ? parseFloat(form.sale_price_usd) : null,
        address: form.address,
        city: form.city,
        suburb: form.suburb,
        bedrooms: parseInt(form.bedrooms) || 0,
        bathrooms: parseInt(form.bathrooms) || 0,
        floor_level: form.floor_level ? (parseInt(form.floor_level) || null) : null,
        is_furnished: form.is_furnished,
        parking_spots: parseInt(form.parking_spots) || 0,
        water_source: form.water_source,
        area_sqm: parseFloat(form.area_sqm) || null,
        description: form.description,
        country: 'Zimbabwe' // Default
      };

      // New listings start as 'pending' and only go live after admin approval.
      // Editing a live/rejected listing keeps its status, unless it was rejected —
      // re-editing a rejected listing resubmits it for review ('pending').
      if (!editItem) {
        payload.status = 'pending';
      } else if (editItem.status === 'rejected') {
        payload.status = 'pending';
      }

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

      // Upload the selected video (if any) to Supabase Storage
      if (selectedVideo && insertedProperty) {
        await uploadVideoToStorage(insertedProperty.id, user.id);
      }

      Alert.alert(
        'Success!',
        editItem
          ? (editItem.status === 'rejected'
              ? 'Property resubmitted and is pending admin approval again.'
              : 'Property updated successfully.')
          : 'Property uploaded successfully. It is now pending admin approval and will appear in the market once approved.'
      );
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e.message);
      setLoading(false);
    }
  };

  if (checkingSub) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#0A84FF" />
        <Text style={{ marginTop: 10, fontFamily: 'Poppins_500Medium', color: '#8E8E93' }}>Checking subscription...</Text>
      </View>
    );
  }

  // Tenants and movers cannot upload properties
  if (userRole === 'tenant' || userRole === 'mover') {
    return (
      <View style={[styles.container, { padding: 20, justifyContent: 'center', alignItems: 'center' }]}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#F2F7FF', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
          <Ionicons name="home-outline" size={40} color="#FF3B30" />
        </View>
        <Text style={{ fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#000', textAlign: 'center', marginBottom: 10 }}>
          {userRole === 'mover' ? 'Movers Can\'t List Properties' : 'Tenants Can\'t List Properties'}
        </Text>
        <Text style={{ fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#8E8E93', textAlign: 'center', marginBottom: 30, lineHeight: 22 }}>
          {userRole === 'mover'
            ? 'Only agents and landlords can upload properties. You can edit your vehicle details from Profile → Edit Profile.'
            : 'Only agents and landlords can upload properties. Browse listings and contact agents to find your next home.'}
        </Text>

        <TouchableOpacity
          style={{ backgroundColor: '#0A84FF', width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center' }}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FFF' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Show paywall if not subscribed and NOT editing an existing property
  if (!isSubscribed && !editItem) {
    return (
      <View style={[styles.container, { padding: 20, justifyContent: 'center', alignItems: 'center' }]}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#F2F7FF', justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
          <Ionicons name="lock-closed" size={40} color="#FF3B30" />
        </View>
        <Text style={{ fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#000', textAlign: 'center', marginBottom: 10 }}>
          Premium Feature
        </Text>
        <Text style={{ fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#8E8E93', textAlign: 'center', marginBottom: 30, lineHeight: 22 }}>
          You need an active $5/30-days subscription to freely upload unlimited listings on Hlala Link.
        </Text>
        
        <TouchableOpacity 
          style={{ backgroundColor: '#0A84FF', width: '100%', paddingVertical: 16, borderRadius: 16, alignItems: 'center', marginBottom: 15 }}
          onPress={() => navigation.navigate('Payment')}
        >
          <Text style={{ fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FFF' }}>Subscribe Now</Text>
        </TouchableOpacity>
        
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: 'Poppins_500Medium', fontSize: 15, color: '#8E8E93' }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

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

        {/* Video Upload (Optional) */}
        {selectedVideo ? (
          <View style={styles.videoPreviewBox}>
            <Ionicons name="videocam" size={26} color="#FFF" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.videoPreviewTitle}>Video attached</Text>
              <Text style={styles.videoPreviewSub}>
                {selectedVideo.duration ? `${Math.round(selectedVideo.duration)}s` : 'Ready to upload'}
              </Text>
            </View>
            <TouchableOpacity style={styles.videoRemoveBtn} onPress={() => setSelectedVideo(null)}>
              <Ionicons name="trash-outline" size={18} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.videoUploadBox} onPress={pickVideo} activeOpacity={0.7}>
            <Ionicons name="videocam-outline" size={24} color="#0A84FF" />
            <Text style={styles.videoUploadText}>Add a Video (Optional · max 30s)</Text>
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

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Listing For</Text>
          <View style={styles.purposeRow}>
            {[
              { id: 'rent', label: 'For Rent' },
              { id: 'sale', label: 'For Sale' },
              { id: 'both', label: 'Rent & Sale' },
            ].map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.purposeBtn, form.listing_purpose === p.id && styles.purposeBtnActive]}
                onPress={() => handleUpdate('listing_purpose', p.id)}
              >
                <Text style={[styles.purposeText, form.listing_purpose === p.id && styles.purposeTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {(form.listing_purpose === 'rent' || form.listing_purpose === 'both') && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Rent per month (USD) {form.listing_purpose === 'both' ? '' : '*'}</Text>
            <TextInput style={styles.input} placeholder="0.00" keyboardType="numeric" value={form.rent_usd} onChangeText={(val) => handleUpdate('rent_usd', val)} />
          </View>
        )}

        {(form.listing_purpose === 'sale' || form.listing_purpose === 'both') && (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Sale Price (USD) {form.listing_purpose === 'both' ? '' : '*'}</Text>
            <TextInput style={styles.input} placeholder="0.00" keyboardType="numeric" value={form.sale_price_usd} onChangeText={(val) => handleUpdate('sale_price_usd', val)} />
          </View>
        )}

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Property Size (sqm) — optional</Text>
          <TextInput 
            style={styles.input} 
            placeholder="e.g. 150" 
            keyboardType="numeric" 
            value={form.area_sqm} 
            onChangeText={(val) => handleUpdate('area_sqm', val)} 
          />
        </View>

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
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Suburb / Local Area</Text>
          <TextInput 
            style={styles.input} 
            placeholder="e.g. Msasa Park, Borrowdale, Avondale" 
            value={form.suburb} 
            onChangeText={(val) => handleUpdate('suburb', val)} 
          />
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

        <TouchableOpacity style={[styles.submitBtn, (loading || uploadingVideo) && { opacity: 0.7 }]} onPress={handleSubmit} disabled={loading || uploadingVideo}>
          <Text style={styles.submitText}>{uploadingVideo ? 'Uploading video...' : (loading ? 'Saving...' : (editItem ? 'Save Changes' : 'Publish Listing'))}</Text>
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

  videoUploadBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    paddingVertical: 14,
    backgroundColor: '#F0F5FF',
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 2,
    borderColor: '#0A84FF',
    marginBottom: 24,
  },
  videoUploadText: { fontFamily: 'Poppins_500Medium', fontSize: 13.5, color: '#0A84FF' },
  videoPreviewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#050505',
    borderRadius: 16,
    marginBottom: 24,
  },
  videoPreviewTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#FFF' },
  videoPreviewSub: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },
  videoRemoveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center' },

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
  purposeRow: { flexDirection: 'row', backgroundColor: '#F5F5F5', borderRadius: 12, padding: 4 },
  purposeBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 10, paddingVertical: 12 },
  purposeBtnActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, elevation: 2 },
  purposeText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#8E8E93' },
  purposeTextActive: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' },
  toggleRow: { flexDirection: 'row', backgroundColor: '#F5F5F5', borderRadius: 12, padding: 4, height: 52 },
  toggleBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  toggleBtnActive: { backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 5, elevation: 2 },
  toggleText: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#8E8E93' },
  toggleTextActive: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' },

  submitBtn: { backgroundColor: '#0A84FF', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 20, shadowColor: '#0A84FF', shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  submitText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FFF' }
});
