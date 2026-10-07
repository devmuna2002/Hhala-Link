import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ScrollView, TextInput, Image, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';

export default function EditProfileScreen({ navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);

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
        .select('first_name, last_name, avatar_url, phone_number, role, business_name, city, vehicle_details, vehicle_photos')
        .eq('id', user.id)
        .single();

      if (data) {
        setFullName(`${data.first_name || ''} ${data.last_name || ''}`.trim());
        setAvatarUrl(data.avatar_url);
        setPhone(data.phone_number || '');
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
    let result;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
    } catch (e) {
      console.log('pickImage error:', e?.message || e);
      Alert.alert('Photo Error', 'Could not open the photo library. Please try again.');
      return;
    }

    if (!result.canceled) {
      uploadImage(result.assets[0].uri);
    }
  }

  async function uploadImage(uri) {
    try {
      setUploading(true);
      setAvatarUploadProgress(0);
      const user = await getSessionUser();
      if (!user) throw new Error('User not found');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Your session expired. Please sign in again.');

      const requestedExt = uri.split('.').pop().toLowerCase().split(/[?#]/)[0];
      const fileExt = ['jpg', 'jpeg', 'png', 'webp'].includes(requestedExt) ? requestedExt : 'jpg';
      const contentType = fileExt === 'jpg' || fileExt === 'jpeg' ? 'image/jpeg' : `image/${fileExt}`;
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      const encodedPath = fileName.split('/').map(encodeURIComponent).join('/');
      const task = FileSystem.createUploadTask(
        `${supabase.supabaseUrl}/storage/v1/object/avatars/${encodedPath}`,
        uri,
        {
          httpMethod: 'POST',
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': contentType },
        },
        ({ totalBytesSent, totalBytesExpectedToSend }) => {
          if (totalBytesExpectedToSend > 0) {
            setAvatarUploadProgress(Math.min(99, Math.round((totalBytesSent / totalBytesExpectedToSend) * 100)));
          }
        }
      );
      const uploadResult = await task.uploadAsync();
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Storage responded ${uploadResult.status}`);
      }

      setAvatarUploadProgress(100);
      setAvatarUrl(supabase.storage.from('avatars').getPublicUrl(fileName).data.publicUrl);
    } catch (error) {
      console.error('Final upload catch:', error);
      Alert.alert(
        'Upload Failed', 
        'Could not save image. Please ensure you have run the latest SQL script in Supabase and your internet is stable.'
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

      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      const updates = {
        id: user.id,
        first_name: firstName,
        last_name: lastName,
        avatar_url: avatarUrl,
        phone_number: phone,
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
          {loading ? <ActivityIndicator size="small" color="#0A84FF" /> : <Text style={styles.saveText}>Save</Text>}
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
                  <Ionicons name="person" size={40} color="#0A84FF" />
                </View>
              )}
              {uploading && (
                <View style={styles.uploadOverlay}>
                  <ActivityIndicator color="#FFF" />
                </View>
              )}
            </View>
            <View style={styles.avatarCameraBadge}>
              <Ionicons name="camera" size={16} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
          <Text style={styles.avatarHint}>Tap your photo to update it</Text>
          <TouchableOpacity onPress={pickImage} disabled={uploading}>
            <Text style={styles.changePhotoText}>{uploading ? 'Uploading...' : 'Choose a photo'}</Text>
          </TouchableOpacity>
          {uploading && (
            <View style={styles.avatarProgressWrap}>
              <View style={styles.avatarProgressTrack}>
                <View style={[styles.avatarProgressFill, { width: `${avatarUploadProgress}%` }]} />
              </View>
              <Text style={styles.avatarProgressText}>{avatarUploadProgress}%</Text>
            </View>
          )}
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

        {role === 'mover' && (
          <>
            <View style={styles.sectionDivider}>
              <Ionicons name="car-sport" size={18} color="#0A84FF" />
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
                      <ActivityIndicator size="small" color="#0A84FF" />
                    ) : (
                      <>
                        <Ionicons name="camera" size={24} color="#0A84FF" />
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
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: t.text },
  saveText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#0A84FF' },
  content: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 30 },
  avatarPressable: { position: 'relative', marginBottom: 8 },
  avatarContainer: { 
    width: 100, 
    height: 100, 
    borderRadius: 50, 
    backgroundColor: t.input, 
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center'
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarCameraBadge: { position: 'absolute', right: 0, bottom: 0, width: 32, height: 32, borderRadius: 16, backgroundColor: '#0A84FF', borderWidth: 3, borderColor: t.bg, alignItems: 'center', justifyContent: 'center' },
  avatarPlaceholder: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  uploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  avatarHint: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: t.sub, marginBottom: 4 },
  changePhotoText: { fontFamily: 'Poppins_500Medium', color: '#0A84FF', fontSize: 14 },
  avatarProgressWrap: { width: 180, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  avatarProgressTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: t.hairline, overflow: 'hidden' },
  avatarProgressFill: { height: '100%', borderRadius: 3, backgroundColor: '#0A84FF' },
  avatarProgressText: { width: 34, fontSize: 11, color: t.sub, textAlign: 'right' },
  inputGroup: { marginBottom: 20 },
  label: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: t.sub, marginBottom: 8 },
  input: { backgroundColor: t.input, height: 52, borderRadius: 12, paddingHorizontal: 16, fontFamily: 'Poppins_400Regular', fontSize: 15, color: t.text },
  sectionDivider: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: t.hairline },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: t.text, marginLeft: 8 },
  vehicleTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleTypeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: t.input, borderWidth: 1, borderColor: t.hairline },
  vehicleTypeChipActive: { backgroundColor: '#0A84FF', borderColor: '#0A84FF' },
  vehicleTypeText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: t.sub },
  vehicleTypeTextActive: { color: '#FFF' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoTile: { width: 78, height: 78, borderRadius: 12, overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  photoAddTile: { width: 78, height: 78, borderRadius: 12, backgroundColor: t.input, borderWidth: 1.5, borderColor: t.hairline, borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  photoAddText: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#0A84FF', marginTop: 2 }
});
