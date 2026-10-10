import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ScrollView, TextInput, Image, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';

// Threads-style system type (no Poppins on this screen)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

// Avatars are shown at ~100px and stored once — downscale before upload so a
// multi-MB camera photo becomes ~100KB and uploads in ~1s on mobile data.
const AVATAR_MAX_EDGE = 768;

async function shrinkForUpload(uri) {
  try {
    const out = await manipulateAsync(
      uri,
      [{ resize: { width: AVATAR_MAX_EDGE } }],
      { compress: 0.7, format: SaveFormat.JPEG }
    );
    return out?.uri || uri;
  } catch (_) {
    return uri;
  }
}

export default function EditProfileScreen({ navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  // Mover vehicle details
  const [role, setRole] = useState(null);
  const [businessName, setBusinessName] = useState('');
  const [moverCity, setMoverCity] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleReg, setVehicleReg] = useState('');
  const [vehiclePhotos, setVehiclePhotos] = useState([]);
  const [uploadingVPhoto, setUploadingVPhoto] = useState(false);

  const VEHICLE_TYPES = ['Truck', 'Bakkie', 'Van', 'Trailer', 'Crane Truck', 'Panel Van'];

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      setLoading(true);
      const user = await getSessionUser();
      if (!user) return;

      setEmail(user.email);

      const { data, error } = await supabase
        .from('profiles')
        .select('first_name, last_name, avatar_url, phone_number, role, business_name, city, bio, vehicle_details, vehicle_photos')
        .eq('id', user.id)
        .single();

      if (data) {
        setFullName(`${data.first_name || ''} ${data.last_name || ''}`.trim());
        setAvatarUrl(data.avatar_url);
        setPhone(data.phone_number || '');
        setBio(data.bio || '');
        setRole(data.role || null);
        if (data.role === 'mover') {
          setBusinessName(data.business_name || '');
          setMoverCity(data.city || '');
          const vd = data.vehicle_details || {};
          setVehicleType(vd.type || '');
          setVehicleModel(vd.model || '');
          setVehicleReg(vd.registration || '');
          setVehiclePhotos(Array.isArray(data.vehicle_photos) ? data.vehicle_photos : []);
        }
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  }

  async function pickVehicleImage() {
    if (vehiclePhotos.length >= 8) {
      Alert.alert('Limit Reached', 'You can upload a maximum of 8 vehicle photos.');
      return;
    }
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.6,
        allowsMultipleSelection: true,
        selectionLimit: 8 - vehiclePhotos.length,
      });
    } catch (e) {
      console.log('pickVehicleImage error:', e?.message || e);
      Alert.alert('Photo Error', 'Could not open the photo library. Please try again.');
      return;
    }
    if (result.canceled) return;

    try {
      setUploadingVPhoto(true);
      const newPhotos = [];
      for (const asset of result.assets) {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
        newPhotos.push(`data:image/jpeg;base64,${base64}`);
      }
      setVehiclePhotos(prev => [...prev, ...newPhotos].slice(0, 8));
    } catch (_) {
      Alert.alert('Error', 'Could not read selected photos.');
    } finally {
      setUploadingVPhoto(false);
    }
  }

  function removeVehiclePhoto(index) {
    setVehiclePhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function pickImage() {
    Alert.alert('Profile Photo', 'Choose how to add your photo.', [
      { text: 'Gallery', onPress: () => launchPicker(false) },
      { text: 'Camera', onPress: () => launchPicker(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function launchPicker(useCamera) {
    let result;
    try {
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Camera permission is required to take a profile picture.');
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.5,
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.5,
        });
      }
    } catch (e) {
      console.log('pickImage error:', e?.message || e);
      Alert.alert('Photo Error', 'Could not open the photo selector. Please try again.');
      return;
    }

    if (!result.canceled) {
      uploadImage(result.assets[0].uri);
    }
  }

  async function uploadImage(uri) {
    try {
      setUploading(true);
      setUploadPct(0);
      const user = await getSessionUser();
      if (!user) throw new Error('User not found');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Your session expired. Please sign in again.');

      // Shrink first: a 768px JPEG uploads several times faster than a
      // full-resolution camera photo and is plenty for an avatar.
      const uploadUri = await shrinkForUpload(uri);
      const requestedExt = uploadUri.split('.').pop().toLowerCase().split(/[?#]/)[0];
      const fileExt = ['jpg', 'jpeg', 'png', 'webp'].includes(requestedExt) ? requestedExt : 'jpg';
      const contentType = fileExt === 'jpg' || fileExt === 'jpeg' ? 'image/jpeg' : `image/${fileExt}`;
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      const encodedPath = fileName.split('/').map(encodeURIComponent).join('/');

      let uploadSuccess = false;
      let finalAvatarUrl = null;
      let uploadStatus = null;
      let uploadDetail = '';

      try {
        const uploadUrl = `${supabase.supabaseUrl}/storage/v1/object/avatars/${encodedPath}`;
        console.log('[EditProfile] Avatar upload start:', uploadUrl, '| uri:', String(uploadUri).slice(0, 32) + '…', '| type:', contentType);
        const task = FileSystem.createUploadTask(
          uploadUrl,
          uploadUri,
          {
            httpMethod: 'POST',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': contentType },
          },
          ({ totalBytesSent, totalBytesExpectedToSend }) => {
            if (totalBytesExpectedToSend > 0) {
              setUploadPct(Math.min(99, Math.round((totalBytesSent / totalBytesExpectedToSend) * 100)));
            }
          }
        );
        const uploadResult = await task.uploadAsync();
        uploadStatus = uploadResult?.status ?? null;
        if (uploadResult && uploadResult.status >= 200 && uploadResult.status < 300) {
          uploadSuccess = true;
          finalAvatarUrl = supabase.storage.from('avatars').getPublicUrl(fileName).data.publicUrl;
        } else {
          if (!uploadResult) uploadDetail = 'empty response from upload task';
          try {
            const rawBody = typeof uploadResult?.body === 'string' ? uploadResult.body : JSON.stringify(uploadResult?.body ?? '');
            if (rawBody && rawBody !== '""') uploadDetail = rawBody.slice(0, 200);
          } catch (_) {}
          console.log('[EditProfile] Storage upload returned non-200:', uploadStatus, uploadDetail);
        }
      } catch (uploadErr) {
        uploadDetail = uploadErr?.message || String(uploadErr);
        console.log('[EditProfile] Storage upload threw:', uploadDetail);
      }

      if (!uploadSuccess || !finalAvatarUrl) {
        // Never fall back to an embedded data URI: ~100KB+ of base64
        // overflows the MySQL avatar column and fails the save with
        // ER_DATA_TOO_LONG. Fail loudly — with the actual status so the
        // cause (server route missing vs session vs network) is visible.
        if (uploadStatus === 404) {
          throw new Error('Photo uploads are not enabled on the server yet (404). The API needs to be redeployed, then try again.');
        }
        if (uploadStatus === 401 || uploadStatus === 403) {
          throw new Error('Your session expired. Please sign out and sign in again, then retry the upload.');
        }
        throw new Error(
          `Photo upload failed${uploadStatus != null ? ` (server ${uploadStatus})` : ' (no server response)'}. Please check your connection and try again.` +
          (uploadDetail ? ` Details: ${uploadDetail}` : '')
        );
      }

      setAvatarUrl(finalAvatarUrl);
      setUploadPct(100);
    } catch (error) {
      console.error('Final upload catch:', error);
      Alert.alert(
        'Upload Failed',
        error?.message || 'Could not save image. Please verify your photo and try again.'
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    try {
      setLoading(true);
      const user = await getSessionUser();
      if (!user) throw new Error('You must be logged in to save changes.');

      // Last line of defense: embedded photo data must never reach the API —
      // it overflows the avatar column (ER_DATA_TOO_LONG) and aborts the save.
      if (typeof avatarUrl === 'string' && avatarUrl.startsWith('data:')) {
        Alert.alert('Photo Upload Incomplete', 'Your profile photo has not finished uploading. Please pick the photo again, wait for the upload, then save.');
        setLoading(false);
        return;
      }

      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const updates = {
        id: user.id,
        first_name: firstName,
        last_name: lastName,
        avatar_url: avatarUrl,
        phone_number: phone,
        bio: bio.trim(),
        updated_at: new Date().toISOString(),
      };

      if (role === 'mover') {
        if (!vehicleType) {
          Alert.alert('Missing Vehicle Type', 'Please select your vehicle type.');
          setLoading(false);
          return;
        }
        if (!vehicleModel.trim() || !vehicleReg.trim()) {
          Alert.alert('Missing Details', 'Please fill in your vehicle model and registration.');
          setLoading(false);
          return;
        }
        if (vehiclePhotos.length < 4) {
          Alert.alert('Not Enough Photos', 'Your vehicle listing needs at least 4 photos.');
          setLoading(false);
          return;
        }
        updates.business_name = businessName.trim();
        updates.city = moverCity.trim();
        updates.vehicle_details = { type: vehicleType, model: vehicleModel.trim(), registration: vehicleReg.trim().toUpperCase() };
        updates.vehicle_photos = vehiclePhotos;
      }

      const { error } = await supabase
        .from('profiles')
        .upsert(updates, { onConflict: 'id' });

      if (error) {
        console.error('Save error:', error.message);
        throw new Error(`Database error: ${error.message}`);
      }

      Alert.alert('Success', 'Profile updated successfully!');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Save Failed', error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={t.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={loading || uploading}>
          {loading ? <ActivityIndicator size="small" color={t.text} /> : <Text style={styles.saveText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarSection}>
          <TouchableOpacity
            style={styles.avatarPressable}
            onPress={pickImage}
            disabled={uploading}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Upload profile photo"
          >
            <View style={styles.avatarContainer}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Ionicons name="person" size={44} color={t.sub} />
                </View>
              )}
              {uploading && (
                <View style={styles.uploadOverlay}>
                  <ActivityIndicator color="#FFF" />
                  <Text style={styles.uploadPctText}>{uploadPct}%</Text>
                </View>
              )}
            </View>
            <View style={styles.avatarCameraBadge}>
              <Ionicons name="camera" size={17} color={t.bg} />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Tap your photo to update it</Text>
          <TouchableOpacity
            style={styles.changePhotoBtn}
            onPress={pickImage}
            disabled={uploading}
            activeOpacity={0.7}
          >
            <Ionicons name="image-outline" size={17} color={t.text} style={{ marginRight: 7 }} />
            <Text style={styles.changePhotoText}>{uploading ? `Uploading… ${uploadPct}%` : 'Change photo'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput 
            style={styles.input} 
            value={fullName} 
            onChangeText={setFullName} 
            placeholder="Enter your name"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address (Read-only)</Text>
          <TextInput 
            style={[styles.input, { opacity: 0.6 }]} 
            value={email} 
            editable={false} 
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+263..."
            keyboardType="phone-pad"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.bioInput]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell people about yourself or your business..."
            multiline
            numberOfLines={4}
            maxLength={300}
          />
        </View>

        {role === 'mover' && (
          <>
            <View style={styles.sectionDivider}>
              <Ionicons name="car-sport" size={18} color={t.text} />
              <Text style={styles.sectionTitle}>Vehicle Listing Details</Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Business Name</Text>
              <TextInput
                style={styles.input}
                value={businessName}
                onChangeText={setBusinessName}
                placeholder="e.g. QuickMove Logistics"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Operating City</Text>
              <TextInput
                style={styles.input}
                value={moverCity}
                onChangeText={setMoverCity}
                placeholder="e.g. Harare"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Vehicle Type</Text>
              <View style={styles.vehicleTypeRow}>
                {VEHICLE_TYPES.map(type => (
                  <TouchableOpacity
                    key={type}
                    style={[styles.vehicleTypeChip, vehicleType === type && styles.vehicleTypeChipActive]}
                    onPress={() => setVehicleType(type)}
                  >
                    <Text style={[styles.vehicleTypeText, vehicleType === type && styles.vehicleTypeTextActive]}>{type}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Vehicle Model</Text>
              <TextInput
                style={styles.input}
                value={vehicleModel}
                onChangeText={setVehicleModel}
                placeholder="e.g. Toyota Dyna 100"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Registration Number</Text>
              <TextInput
                style={styles.input}
                value={vehicleReg}
                onChangeText={(t) => setVehicleReg(t.toUpperCase())}
                placeholder="e.g. ABC 1234"
                autoCapitalize="characters"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Vehicle Photos ({vehiclePhotos.length}/8 · min 4)</Text>
              <View style={styles.photoGrid}>
                {vehiclePhotos.map((photo, index) => (
                  <View key={index} style={styles.photoTile}>
                    <Image source={{ uri: photo }} style={styles.photoImage} />
                    <TouchableOpacity style={styles.photoRemove} onPress={() => removeVehiclePhoto(index)}>
                      <Ionicons name="close" size={14} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                ))}
                {vehiclePhotos.length < 8 && (
                  <TouchableOpacity style={styles.photoAddTile} onPress={pickVehicleImage} disabled={uploadingVPhoto}>
                    {uploadingVPhoto ? (
                      <ActivityIndicator size="small" color={t.text} />
                    ) : (
                      <>
                        <Ionicons name="camera" size={24} color={t.sub} />
                        <Text style={styles.photoAddText}>Add</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: Platform.OS === 'ios' ? 60 : 30, 
    paddingHorizontal: 20, 
    paddingBottom: 15, 
    borderBottomWidth: 1, 
    borderBottomColor: t.hairline 
  },
  headerTitle: { fontFamily: SYS_MED, fontSize: 17, color: t.text },
  saveText: { fontFamily: SYS_MED, fontSize: 16, color: t.text },
  content: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 30 },
  avatarPressable: { position: 'relative', marginBottom: 8 },
  avatarContainer: { 
    width: 112, 
    height: 112, 
    borderRadius: 56, 
    backgroundColor: t.input, 
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarCameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 34, height: 34, borderRadius: 17, backgroundColor: t.text, borderWidth: 3, borderColor: t.bg, alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholder: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  uploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', gap: 6 },
  uploadPctText: { fontFamily: SYS_MED, fontSize: 14, fontWeight: '600', color: '#FFF' },
  avatarHint: { fontFamily: SYS, fontSize: 13, color: t.sub, marginBottom: 10 },
  changePhotoBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: t.hairline, borderRadius: 20, paddingHorizontal: 18, paddingVertical: 10 },
  changePhotoText: { fontFamily: SYS_MED, color: t.text, fontSize: 15, fontWeight: '600' },
  inputGroup: { marginBottom: 20 },
  label: { fontFamily: SYS, fontSize: 13, color: t.sub, marginBottom: 8 },
  input: { backgroundColor: t.input, height: 52, borderRadius: 12, paddingHorizontal: 16, fontFamily: SYS, fontSize: 16, color: t.text },
  bioInput: { height: 110, paddingTop: 14, textAlignVertical: 'top' },
  sectionDivider: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: t.hairline },
  sectionTitle: { fontFamily: SYS_MED, fontSize: 16, color: t.text, marginLeft: 8 },
  vehicleTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleTypeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: t.input, borderWidth: 1, borderColor: t.hairline },
  vehicleTypeChipActive: { backgroundColor: t.text, borderColor: t.text },
  vehicleTypeText: { fontFamily: SYS, fontSize: 13, color: t.sub },
  vehicleTypeTextActive: { color: t.bg },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoTile: { width: 78, height: 78, borderRadius: 12, overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  photoAddTile: { width: 78, height: 78, borderRadius: 12, backgroundColor: t.input, borderWidth: 1.5, borderColor: t.hairline, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  photoAddText: { fontFamily: SYS_MED, fontSize: 11, color: t.text, marginTop: 2 }
});
