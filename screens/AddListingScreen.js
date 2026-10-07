import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Alert, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';

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

// Threads-style system type (no Poppins on this screen)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

export default function AddListingScreen({ route, navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const editItem = route?.params?.editItem;
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [checkingSub, setCheckingSub] = useState(true);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]); 
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
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
    try {
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
    } catch (e) {
      console.log('pickImage error:', e?.message || e);
      Alert.alert('Photo Error', 'Could not open the photo library. Please try again.');
    }
  };

  const MAX_VIDEO_SECONDS = 30;

  // Some Android pickers report duration in milliseconds — normalize to seconds
  const normalizeDuration = (d) => {
    if (!d || d <= 0) return 0;
    return d > 1000 ? d / 1000 : d;
  };

  const pickVideo = async () => {
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsVideoEditing: true,
        videoMaxDuration: MAX_VIDEO_SECONDS,
        quality: 1,
      });
    } catch (e) {
      console.log('pickVideo error:', e?.message || e);
      Alert.alert('Video Error', 'Could not open the video library. Please try again.');
      return;
    }

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
    setUploadProgress(0);
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

      const uploadTask = FileSystem.createUploadTask(
        `${supabase.supabaseUrl}/storage/v1/object/properties/${filePath}`,
        selectedVideo.uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': contentType,
          },
        },
        ({ totalBytesSent, totalBytesExpectedToSend }) => {
          if (totalBytesExpectedToSend > 0) {
            setUploadProgress(Math.min(99, Math.round((totalBytesSent / totalBytesExpectedToSend) * 100)));
          }
        }
      );
      const uploadResult = await uploadTask.uploadAsync();

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Storage responded ${uploadResult.status}`);
      }
      setUploadProgress(100);

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
      const user = await getSessionUser();
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
    setUploadProgress(0);
    try {
      const user = await getSessionUser();
      if (!user) {
        Alert.alert('Error', 'You must be logged in to upload a property.');
        setLoading(false);
        return;
      }

      // Format payload for Supabase 'properties' table
      // (trimmed: a stray "Harare " with trailing space breaks city filters)
      const payload = {
        owner_id: user.id,
        title: (form.title || '').trim(),
        property_type: form.property_type,
        listing_purpose: purpose,
        rent_usd: needRent ? parseFloat(form.rent_usd) : null,
        sale_price_usd: needSale ? parseFloat(form.sale_price_usd) : null,
        address: (form.address || '').trim(),
        city: (form.city || '').trim(),
        suburb: (form.suburb || '').trim(),
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
        setUploadingImages(true);
        try {
          for (let index = 0; index < imagePayloads.length; index += 1) {
            const { error } = await supabase.from('property_images').insert(imagePayloads[index]);
            if (error) throw error;
            setUploadProgress(Math.round(((index + 1) / imagePayloads.length) * 100));
          }
        } finally {
          setUploadingImages(false);
        }
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
        <ActivityIndicator size="large" color={t.text} />
        <Text style={{ marginTop: 10, fontFamily: SYS, fontSize: 14, color: t.sub }}>Checking subscription...</Text>
      </View>
    );
  }

  // Tenants and movers cannot upload properties
  if (userRole === 'tenant' || userRole === 'mover') {
    return (
      <View style={[styles.container, { padding: 20, justifyContent: 'center', alignItems: 'center' }]}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
          <Ionicons name="home" size={36} color={t.sub} />
        </View>
        <Text style={{ fontFamily: SYS_MED, fontSize: 20, color: t.text, textAlign: 'center', marginBottom: 10 }}>
          {userRole === 'mover' ? 'Movers can\'t list properties' : 'Tenants can\'t list properties'}
        </Text>
        <Text style={{ fontFamily: SYS, fontSize: 15, color: t.sub, textAlign: 'center', marginBottom: 30, lineHeight: 22 }}>
          {userRole === 'mover'
            ? 'Only agents and landlords can upload properties. You can edit your vehicle details from Profile → Edit Profile.'
            : 'Only agents and landlords can upload properties. Browse listings and contact agents to find your next home.'}
        </Text>

        <TouchableOpacity
          style={{ backgroundColor: t.text, width: '100%', paddingVertical: 16, borderRadius: 14, alignItems: 'center' }}
          onPress={() => navigation.goBack()}
        >
          <Text style={{ fontFamily: SYS_MED, fontSize: 16, color: t.bg }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Show paywall if not subscribed and NOT editing an existing property
  if (!isSubscribed && !editItem) {
    return (
      <View style={[styles.container, { padding: 20, justifyContent: 'center', alignItems: 'center' }]}>
        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
          <Ionicons name="lock-closed" size={36} color={t.sub} />
        </View>
        <Text style={{ fontFamily: SYS_MED, fontSize: 20, color: t.text, textAlign: 'center', marginBottom: 10 }}>
          Premium Feature
        </Text>
        <Text style={{ fontFamily: SYS, fontSize: 15, color: t.sub, textAlign: 'center', marginBottom: 30, lineHeight: 22 }}>
          You need an active $5/30-days subscription to freely upload unlimited listings on Hlala Link.
        </Text>
        
        <TouchableOpacity 
          style={{ backgroundColor: t.text, width: '100%', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginBottom: 15 }}
          onPress={() => navigation.navigate('Payment')}
        >
          <Text style={{ fontFamily: SYS_MED, fontSize: 16, color: t.bg }}>Subscribe Now</Text>
        </TouchableOpacity>
        
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ fontFamily: SYS, fontSize: 15, color: t.sub }}>Go Back</Text>
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={24} color={t.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{editItem ? 'Edit listing' : 'New listing'}</Text>
        <TouchableOpacity onPress={handleSubmit} disabled={loading || uploadingVideo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={[styles.postBtn, (loading || uploadingVideo) && styles.postBtnDisabled]}>
            {uploadingVideo ? '...' : (loading ? '...' : (editItem ? 'Save' : 'Post'))}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        
        {/* Photo Placeholder & Preview */}
        {selectedImages.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScrollContainer}>
            {selectedImages.map((img, idx) => (
              <Image key={idx} source={{ uri: img.uri }} style={styles.previewImageMulti} />
            ))}
            <TouchableOpacity style={styles.addMorePhotosBtn} onPress={pickImage}>
              <Ionicons name="add" size={26} color="#8A8A8A" />
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <TouchableOpacity style={styles.photoUploadBox} onPress={pickImage}>
            <Ionicons name="image" size={32} color="#8A8A8A" />
            <Text style={styles.photoText}>Add photos · up to 10</Text>
          </TouchableOpacity>
        )}

        {uploadingImages && (
          <View style={styles.mediaProgressWrap}>
            <View style={styles.mediaProgressLabelRow}>
              <Text style={styles.mediaProgressLabel}>Uploading photos</Text>
              <Text style={styles.mediaProgressPercent}>{uploadProgress}%</Text>
            </View>
            <View style={styles.mediaProgressTrack}>
              <View style={[styles.mediaProgressFill, { width: `${uploadProgress}%` }]} />
            </View>
          </View>
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
              <Ionicons name="trash" size={18} color="#FF3B30" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.videoUploadBox} onPress={pickVideo} activeOpacity={0.7}>
            <Ionicons name="videocam" size={22} color="#8A8A8A" />
            <Text style={styles.videoUploadText}>Add a video · optional, max 30s</Text>
          </TouchableOpacity>
        )}
        {uploadingVideo && (
          <View style={styles.mediaProgressWrap}>
            <View style={styles.mediaProgressLabelRow}>
              <Text style={styles.mediaProgressLabel}>Uploading video</Text>
              <Text style={styles.mediaProgressPercent}>{uploadProgress}%</Text>
            </View>
            <View style={styles.mediaProgressTrack}>
              <View style={[styles.mediaProgressFill, { width: `${uploadProgress}%` }]} />
            </View>
          </View>
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

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 30, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: SYS_MED, fontSize: 17, color: t.text },
  postBtn: { fontFamily: SYS_MED, fontSize: 16, color: t.text },
  postBtnDisabled: { color: t.sub },
  
  scroll: { padding: 16, paddingBottom: 60 },
  
  photoUploadBox: { width: '100%', height: 120, backgroundColor: t.input, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: t.hairline, justifyContent: 'center', alignItems: 'center', marginBottom: 20, overflow: 'hidden' },
  mediaProgressWrap: { width: '100%', marginTop: -8, marginBottom: 18 },
  mediaProgressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  mediaProgressLabel: { fontFamily: SYS_MED, fontSize: 12, color: t.sub },
  mediaProgressPercent: { fontFamily: SYS_MED, fontSize: 12, color: t.text },
  mediaProgressTrack: { width: '100%', height: 6, borderRadius: 3, backgroundColor: t.hairline, overflow: 'hidden' },
  mediaProgressFill: { height: '100%', borderRadius: 3, backgroundColor: '#0A84FF' },
  photoText: { fontFamily: SYS, fontSize: 14, color: t.sub, marginTop: 8 },
  imageScrollContainer: { marginBottom: 20, height: 100 },
  previewImageMulti: { width: 100, height: 100, borderRadius: 12, marginRight: 10, resizeMode: 'cover' },
  addMorePhotosBtn: { width: 100, height: 100, backgroundColor: t.input, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: t.hairline, justifyContent: 'center', alignItems: 'center', marginRight: 10 },

  videoUploadBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    paddingVertical: 14,
    backgroundColor: t.input,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline,
    marginBottom: 20,
  },
  videoUploadText: { fontFamily: SYS, fontSize: 14, color: t.sub },
  videoPreviewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#050505',
    borderRadius: 14,
    marginBottom: 20,
  },
  videoPreviewTitle: { fontFamily: SYS_MED, fontSize: 14, color: '#FFF' },
  videoPreviewSub: { fontFamily: SYS, fontSize: 12, color: '#A0A0A0' },
  videoRemoveBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center' },

  sectionTitle: { fontFamily: SYS_MED, fontSize: 16, color: t.text, marginBottom: 12, marginTop: 10 },
  
  categoryScroll: { marginBottom: 20 },
  catPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: t.input, marginRight: 10 },
  catPillActive: { backgroundColor: t.text },
  catText: { fontFamily: SYS, fontSize: 14, color: t.sub },
  catTextActive: { color: t.bg },

  inputGroup: { marginBottom: 14 },
  label: { fontFamily: SYS_MED, fontSize: 13, color: t.sub, marginBottom: 6 },
  input: { backgroundColor: t.input, borderRadius: 14, paddingHorizontal: 16, height: 50, fontFamily: SYS, fontSize: 15, color: t.text },
  textArea: { height: 100, paddingTop: 14, textAlignVertical: 'top' },
  
  rowInputs: { flexDirection: 'row', justifyContent: 'space-between' },
  purposeRow: { flexDirection: 'row', backgroundColor: t.input, borderRadius: 14, padding: 4 },
  purposeBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 10, paddingVertical: 11 },
  purposeBtnActive: { backgroundColor: t.card, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  purposeText: { fontFamily: SYS, fontSize: 13, color: t.sub },
  purposeTextActive: { color: t.text, fontFamily: SYS_MED },
  toggleRow: { flexDirection: 'row', backgroundColor: t.input, borderRadius: 14, padding: 4, height: 50 },
  toggleBtn: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  toggleBtnActive: { backgroundColor: t.card, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  toggleText: { fontFamily: SYS, fontSize: 14, color: t.sub },
  toggleTextActive: { color: t.text, fontFamily: SYS_MED },

  submitBtn: { backgroundColor: t.text, height: 54, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  submitText: { fontFamily: SYS_MED, fontSize: 16, color: t.bg }
});
