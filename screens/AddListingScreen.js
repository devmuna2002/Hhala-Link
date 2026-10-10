import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, KeyboardAvoidingView, Alert, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';
import { CardVideo } from '../components/ListingCard';
import { SkeletonBlock } from '../components/Skeleton';

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

// Instant open: role + mini profile survive between visits in this session,
// so the composer paints immediately instead of spinning on every focus.
let cachedAccess = null;

export default function AddListingScreen({ route, navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const editItem = route?.params?.editItem;
  const [userRole, setUserRole] = useState(cachedAccess?.role ?? null);
  const [profileMini, setProfileMini] = useState(cachedAccess?.profileMini ?? null);
  const scrollRef = useRef(null);
  const [detailsY, setDetailsY] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedImages, setSelectedImages] = useState([]);
  // Existing photos when editing — shown in the strip, removable (deleted on save).
  const isExistingVideo = (u) => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(String(u?.url || u || ''));
  const [existingImages, setExistingImages] = useState(
    (Array.isArray(editItem?.property_images) ? editItem.property_images : [])
      .filter((img) => img?.url && !isExistingVideo(img))
      .map((img) => ({ url: img.url }))
  );
  // Existing videos when editing — shown in the strip with a player thumb, removable (deleted on save).
  const [existingVideos, setExistingVideos] = useState(
    (Array.isArray(editItem?.property_images) ? editItem.property_images : [])
      .filter((img) => img?.url && isExistingVideo(img))
      .map((img) => ({ url: img.url }))
  );
  const [removedUrls, setRemovedUrls] = useState([]);
  // Skeleton thumbs while carried photos are missing and the fallback fetch runs.
  const [loadingExisting, setLoadingExisting] = useState(
    () => !!editItem?.id && !(Array.isArray(editItem?.property_images) && editItem.property_images.length > 0)
  );

  // Lightning strip: warm the image cache on mount so existing photos paint
  // instantly, and fetch gallery rows when the entry screen didn't carry them.
  useEffect(() => {
    const urls = existingImages.map((i) => i.url).filter((u) => u && String(u).startsWith('http'));
    urls.forEach((u) => { Image.prefetch(u).catch(() => {}); });
    if (editItem?.id && existingImages.length === 0 && existingVideos.length === 0) {
      (async () => {
        try {
          const { data } = await supabase.from('property_images').select('url, alt_text').eq('property_id', editItem.id);
          const rows = (data || []).filter((r) => r?.url);
          const photoRows = rows.filter((r) => !isExistingVideo(r));
          const videoRows = rows.filter((r) => isExistingVideo(r));
          if (photoRows.length) {
            setExistingImages(photoRows.map((r) => ({ url: r.url })));
            photoRows.map((r) => r.url).filter((u) => String(u).startsWith('http')).forEach((u) => {
              Image.prefetch(u).catch(() => {});
            });
          }
          if (videoRows.length) {
            setExistingVideos(videoRows.map((r) => ({ url: r.url })));
          }
        } catch (_) {}
        setLoadingExisting(false);
      })();
    } else {
      setLoadingExisting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [compressingVideo, setCompressingVideo] = useState(false);
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

  const composerName = profileMini?.business_name
    || `${profileMini?.first_name || ''} ${profileMini?.last_name || ''}`.trim()
    || 'Your listing';
  const purposeLabel = form.listing_purpose === 'rent' ? 'For Rent' : form.listing_purpose === 'sale' ? 'For Sale' : 'Rent & Sale';
  const typeLabel = CATEGORIES.find(c => c.id === form.property_type)?.name || 'Property';
  const needRentComposer = form.listing_purpose === 'rent' || form.listing_purpose === 'both';
  const needSaleComposer = form.listing_purpose === 'sale' || form.listing_purpose === 'both';
  const canPost = !!form.title.trim() && !!form.address.trim() && !!form.city.trim() &&
    (!needRentComposer || !!form.rent_usd) && (!needSaleComposer || !!form.sale_price_usd) &&
    !loading && !uploadingVideo && !compressingVideo;

  const handleUpdate = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const removeImage = (idx) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== idx));
  };

  const removeExistingImage = (idx) => {
    setExistingImages(prev => {
      const gone = prev[idx];
      if (gone?.url) setRemovedUrls(r => [...r, gone.url]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const removeExistingVideo = (idx) => {
    setExistingVideos(prev => {
      const gone = prev[idx];
      if (gone?.url) setRemovedUrls(r => [...r, gone.url]);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const pickMedia = async () => {
    try {
      let result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        // Split the picks: videos go to the video slot (30s max), everything
        // else joins the photo strip. Detection is by asset type first,
        // duration/extension as fallback.
        const assets = result.assets;
        const isVid = (a) =>
          a.type === 'video' ||
          normalizeDuration(a.duration) > 0 ||
          /\.(mp4|mov|m4v|webm)(\?|$)/i.test(String(a.uri || ''));
        const vids = assets.filter(isVid);
        if (vids.length > 0) {
          const v = vids[0];
          const duration = normalizeDuration(v.duration);
          if (duration > MAX_VIDEO_SECONDS + 1) {
            Alert.alert(
              'Video Too Long',
              `That clip is about ${Math.round(duration)}s long. Please trim it to ${MAX_VIDEO_SECONDS}s or less.`
            );
          } else {
            setSelectedVideo({ uri: v.uri, duration });
          }
        }
        const newImages = assets
          .filter((a) => !isVid(a))
          .map((asset) => ({ uri: asset.uri, base64: asset.base64 }))
          .filter((img) => img.base64);
        if (newImages.length > 0) {
          setSelectedImages((prev) => [...prev, ...newImages].slice(0, 10)); // cap at 10
        }
      }
    } catch (e) {
      console.log('pickMedia error:', e?.message || e);
      Alert.alert('Photo Error', 'Could not open the media library. Please try again.');
    }
  };

  const MAX_VIDEO_SECONDS = 30;
  // Videos over this size get auto-compressed before upload so feed
  // playback doesn't stall on slow links (a 30s phone clip is ~8-80MB).
  const COMPRESS_ABOVE_BYTES = 8 * 1024 * 1024;

  // Some Android pickers report duration in milliseconds — normalize to seconds
  const normalizeDuration = (d) => {
    if (!d || d <= 0) return 0;
    return d > 1000 ? d / 1000 : d;
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

      // Auto-compress large clips (native module; Expo Go falls back to original).
      let uploadUri = selectedVideo.uri;
      try {
        const info = await FileSystem.getInfoAsync(selectedVideo.uri);
        if (!info?.exists || (info?.size || 0) > COMPRESS_ABOVE_BYTES) {
          let VideoCompressor = null;
          try {
            VideoCompressor = require('react-native-compressor').Video;
          } catch (_) {}
          if (VideoCompressor?.compress) {
            setCompressingVideo(true);
            setUploadProgress(0);
            const compressed = await VideoCompressor.compress(
              selectedVideo.uri,
              { compressionMethod: 'auto' },
              (progress) => setUploadProgress(Math.min(99, Math.round(progress * 100)))
            );
            if (compressed && typeof compressed === 'string') {
              uploadUri = compressed;
              console.log('Video compressed for upload');
            }
          }
        }
      } catch (_) {
        // Compression failed/unavailable — upload the original.
      } finally {
        setCompressingVideo(false);
        setUploadProgress(0);
      }

      const extMatch = uploadUri.split('.').pop().toLowerCase().split('?')[0];
      const ext = ['mp4', 'mov', 'webm', 'm4v'].includes(extMatch) ? extMatch : 'mp4';
      const contentType = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' }[ext];

      const filePath = `${userId}/${propertyId}/${Date.now()}.${ext}`;

      // Stream the file straight from disk (handles large files without memory issues)
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not logged in');

      const uploadTask = FileSystem.createUploadTask(
        `${supabase.supabaseUrl}/storage/v1/object/properties/${filePath}`,
        uploadUri,
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
    // Paint instantly from cache, then refresh quietly in the background.
    // (Subscription checks are skipped — posting is free.)
    if (cachedAccess) {
      setUserRole(cachedAccess.role);
      setProfileMini(cachedAccess.profileMini);
    }
    try {
      const user = await getSessionUser();
      if (user) {
        const { data } = await supabase.from('profiles').select('role, avatar_url, first_name, last_name, business_name').eq('id', user.id).single();
        const role = data?.role || null;
        setUserRole(role);
        setProfileMini(data || null);
        cachedAccess = { role, profileMini: data || null };
      }
    } catch (_) {}
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

      // Drop photos removed from the strip while editing (match by url —
      // the edit query only selects url/alt_text, so there is no id).
      // Surfaced in the final alert — never silent, so a failed delete
      // can't masquerade as a successful cleanup.
      let removedPhotosFailed = null;
      if (insertedProperty && removedUrls.length > 0) {
        try {
          const { error: delError } = await supabase.from('property_images').delete()
            .eq('property_id', insertedProperty.id)
            .in('url', removedUrls);
          if (delError) removedPhotosFailed = delError.message;
        } catch (e) {
          removedPhotosFailed = e?.message || String(e);
        }
      }

      // If images were selected, upload their base64s to the property_images table
      if (selectedImages.length > 0 && insertedProperty) {
        const imagePayloads = selectedImages.map((img, index) => ({
          property_id: insertedProperty.id,
          storage_path: 'local_base64', 
          url: `data:image/jpeg;base64,${img.base64}`,
          // First image is cover — unless kept photos already cover it.
          is_cover: existingImages.length === 0 && index === 0,
          sort_order: existingImages.length + index
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

      // Flag feeds to refresh on return: Home reloads silently, Detail
      // refetches this listing — otherwise removed photos linger from cache.
      try {
        await AsyncStorage.setItem('hlala_feed_stale', '1');
        if (insertedProperty?.id) {
          await AsyncStorage.setItem(`hlala_detail_stale_${insertedProperty.id}`, '1');
        }
      } catch (_) {}

      Alert.alert(
        removedPhotosFailed ? 'Saved with a warning' : 'Success!',
        removedPhotosFailed
          ? `Details saved, but ${removedUrls.length} removed photo${removedUrls.length === 1 ? ' was' : 's were'} not deleted on the server (${removedPhotosFailed}). Pull to refresh — if they persist, the API needs redeploying.`
          : editItem
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

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.cancelBtn}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{editItem ? 'Edit listing' : 'New listing'}</Text>
        <TouchableOpacity onPress={handleSubmit} disabled={loading || uploadingVideo || compressingVideo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ minWidth: 64, alignItems: 'flex-end' }}>
          <Text style={[styles.postBtn, canPost && styles.postBtnReady]}>
            {uploadingVideo || compressingVideo ? '...' : (loading ? '...' : (editItem ? 'Save' : 'Post'))}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>

        {/* Composer — Threads style */}
        <View style={styles.composerRow}>
          <View style={styles.composerAvatarCol}>
            <View style={styles.composerAvatar}>
              {profileMini?.avatar_url ? (
                <Image source={{ uri: profileMini.avatar_url }} style={styles.composerAvatarImg} />
              ) : (
                <Text style={styles.composerInitial}>{(composerName.trim()[0] || 'H').toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.composerThreadLine} />
          </View>
          <View style={{ flex: 1 }}>
            <TouchableOpacity
              onPress={() => scrollRef.current?.scrollTo({ y: Math.max(0, detailsY - 20), animated: true })}
              activeOpacity={0.7}
            >
              <Text style={styles.composerName} numberOfLines={1}>
                {composerName} <Text style={styles.composerTopic}>› {purposeLabel} · {typeLabel}</Text>
              </Text>
            </TouchableOpacity>
            <TextInput
              style={styles.titleInput}
              placeholder="Listing title *"
              placeholderTextColor={t.sub}
              value={form.title}
              onChangeText={(val) => handleUpdate('title', val)}
            />
            <TextInput
              style={styles.whatsNewInput}
              placeholder="What's new?"
              placeholderTextColor={t.sub}
              multiline
              value={form.description}
              onChangeText={(val) => handleUpdate('description', val)}
            />
          </View>
        </View>
        {loadingExisting ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScrollContainer}>
            {[0, 1, 2].map((i) => (
              <SkeletonBlock key={i} width={100} height={100} borderRadius={12} style={{ backgroundColor: t.tile, marginRight: 10 }} />
            ))}
          </ScrollView>
        ) : (existingImages.length + selectedImages.length + existingVideos.length) > 0 || !!selectedVideo ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScrollContainer}>
            {existingVideos.map((vid, idx) => (
              <View key={`ev-${idx}`} style={styles.thumbWrap}>
                <CardVideo
                  uri={vid.url}
                  style={styles.previewImageMulti}
                  fit="cover"
                />
                <View style={styles.videoDurationBadge}>
                  <Text style={styles.videoDurationText}>Video</Text>
                </View>
                <TouchableOpacity
                  style={styles.thumbRemove}
                  onPress={() => removeExistingVideo(idx)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove video ${idx + 1}`}
                >
                  <Ionicons name="close" size={13} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
            {!!selectedVideo && (
              <View style={styles.thumbWrap}>
                <CardVideo
                  uri={selectedVideo.uri}
                  style={styles.previewImageMulti}
                  fit="cover"
                />
                {!!selectedVideo.duration && (
                  <View style={styles.videoDurationBadge}>
                    <Text style={styles.videoDurationText}>{Math.round(selectedVideo.duration)}s</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.thumbRemove}
                  onPress={() => setSelectedVideo(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Remove video"
                >
                  <Ionicons name="close" size={13} color="#FFF" />
                </TouchableOpacity>
              </View>
            )}
            {existingImages.map((img, idx) => (
              <View key={`e-${idx}`} style={styles.thumbWrap}>
                <Image source={{ uri: img.url }} style={styles.previewImageMulti} />
                <TouchableOpacity
                  style={styles.thumbRemove}
                  onPress={() => removeExistingImage(idx)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${idx + 1}`}
                >
                  <Ionicons name="close" size={13} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
            {selectedImages.map((img, idx) => (
              <View key={`n-${idx}`} style={styles.thumbWrap}>
                <Image source={{ uri: img.uri }} style={styles.previewImageMulti} />
                <TouchableOpacity
                  style={styles.thumbRemove}
                  onPress={() => removeImage(idx)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${existingImages.length + idx + 1}`}
                >
                  <Ionicons name="close" size={13} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addMorePhotosBtn} onPress={pickMedia}>
              <Ionicons name="add" size={26} color={t.sub} />
            </TouchableOpacity>
          </ScrollView>
        ) : (
          <TouchableOpacity style={styles.photoUploadBox} onPress={pickMedia}>
            <Ionicons name="image" size={32} color={t.sub} />
            <Text style={styles.photoText}>Add photos or video · up to 10</Text>
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

        {(uploadingVideo || compressingVideo) && (
          <View style={styles.mediaProgressWrap}>
            <View style={styles.mediaProgressLabelRow}>
              <Text style={styles.mediaProgressLabel}>{compressingVideo ? 'Compressing video' : 'Uploading video'}</Text>
              <Text style={styles.mediaProgressPercent}>{uploadProgress}%</Text>
            </View>
            <View style={styles.mediaProgressTrack}>
              <View style={[styles.mediaProgressFill, { width: `${uploadProgress}%` }]} />
            </View>
          </View>
        )}

        <View onLayout={(e) => setDetailsY(e.nativeEvent.layout.y)}>
          <Text style={styles.sectionTitle}>Property Category</Text>
        </View>
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

      </ScrollView>

      {/* Bottom bar — Threads style */}
      <View style={styles.bottomBar}>
        {!editItem && (
          <View style={styles.approvalBadge}>
            <Ionicons name="time-outline" size={15} color={t.text} />
            <Text style={styles.bottomNote}>Goes live after approval</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.bottomPostBtn, !canPost && styles.bottomPostBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading || uploadingVideo}
          activeOpacity={0.85}
        >
          {loading || uploadingVideo ? (
            <ActivityIndicator size="small" color={canPost ? t.bg : t.sub} />
          ) : (
            <Text style={[styles.bottomPostBtnText, !canPost && styles.bottomPostBtnTextDisabled]}>
              {editItem ? 'Save' : 'Post'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 30, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.hairline },
  backBtn: { minWidth: 64 },
  cancelBtn: { fontFamily: SYS, fontSize: 16, color: t.text },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: SYS_MED, fontWeight: '700', fontSize: 17, color: t.text },
  postBtn: { fontFamily: SYS_MED, fontSize: 16, color: t.sub, minWidth: 64, textAlign: 'right' },
  postBtnReady: { color: t.text, fontWeight: '700' },
  
  scroll: { padding: 16, paddingBottom: 100 },

  // Composer — Threads style
  composerRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 6 },
  composerAvatarCol: { alignItems: 'center', marginRight: 12 },
  composerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  composerThreadLine: { flex: 1, width: 2, borderRadius: 1, backgroundColor: t.hairline, marginTop: 8, minHeight: 24 },
  composerAvatarImg: { width: '100%', height: '100%' },
  composerInitial: { fontFamily: SYS_MED, fontSize: 16, fontWeight: '600', color: t.text },
  composerName: { fontFamily: SYS_MED, fontSize: 15, fontWeight: '600', color: t.text },
  composerTopic: { fontFamily: SYS, fontSize: 14, fontWeight: '400', color: t.sub },
  titleInput: { fontFamily: SYS_MED, fontSize: 20, fontWeight: '700', color: t.text, marginTop: 6, paddingVertical: 2 },
  whatsNewInput: { fontFamily: SYS, fontSize: 17, lineHeight: 23, color: t.text, marginTop: 4, minHeight: 44, textAlignVertical: 'top' },

  // Bottom bar — Threads style
  bottomBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 28 : 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline, backgroundColor: t.bg },
  bottomNote: { fontFamily: SYS_MED, fontSize: 13, fontWeight: '600', color: t.text },
  approvalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bottomPostBtn: { backgroundColor: t.text, paddingHorizontal: 28, paddingVertical: 11, borderRadius: 20, justifyContent: 'center', alignItems: 'center', minWidth: 110 },
  bottomPostBtnDisabled: { backgroundColor: t.input },
  bottomPostBtnText: { fontFamily: SYS_MED, fontSize: 16, fontWeight: '600', color: t.bg },
  bottomPostBtnTextDisabled: { color: t.sub },
  
  photoUploadBox: { width: '100%', height: 120, backgroundColor: t.input, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: t.hairline, justifyContent: 'center', alignItems: 'center', marginBottom: 20, overflow: 'hidden' },
  mediaProgressWrap: { width: '100%', marginTop: -8, marginBottom: 18 },
  mediaProgressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  mediaProgressLabel: { fontFamily: SYS_MED, fontSize: 12, color: t.sub },
  mediaProgressPercent: { fontFamily: SYS_MED, fontSize: 12, color: t.text },
  mediaProgressTrack: { width: '100%', height: 6, borderRadius: 3, backgroundColor: t.hairline, overflow: 'hidden' },
  mediaProgressFill: { height: '100%', borderRadius: 3, backgroundColor: '#0A84FF' },
  photoText: { fontFamily: SYS, fontSize: 14, color: t.sub, marginTop: 8 },
  imageScrollContainer: { marginBottom: 20, height: 100 },
  thumbWrap: { position: 'relative', marginRight: 10 },
  previewImageMulti: { width: 100, height: 100, borderRadius: 12, resizeMode: 'cover' },
  thumbRemove: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center', alignItems: 'center',
  },
  videoDurationBadge: {
    position: 'absolute', left: 6, bottom: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8,
  },
  videoDurationText: { fontFamily: SYS_MED, fontSize: 11, fontWeight: '600', color: '#FFF' },
  addMorePhotosBtn: { width: 100, height: 100, backgroundColor: t.input, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: t.hairline, justifyContent: 'center', alignItems: 'center', marginRight: 10 },

  sectionTitle: { fontFamily: SYS_MED, fontSize: 17, fontWeight: '600', color: t.text, marginBottom: 12, marginTop: 10 },
  
  categoryScroll: { marginBottom: 20 },
  catPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: t.input, marginRight: 10 },
  catPillActive: { backgroundColor: t.text },
  catText: { fontFamily: SYS, fontSize: 14, color: t.sub },
  catTextActive: { color: t.bg },

  inputGroup: { marginBottom: 14 },
  label: { fontFamily: SYS_MED, fontSize: 13, color: t.sub, marginBottom: 6 },
  input: { backgroundColor: t.input, borderRadius: 14, paddingHorizontal: 16, height: 50, fontFamily: SYS, fontSize: 16, color: t.text },
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
});
