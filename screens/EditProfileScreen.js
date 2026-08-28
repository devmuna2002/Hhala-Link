import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ScrollView, TextInput, Image, Alert, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../supabase';

export default function EditProfileScreen({ navigation }) {
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploading, setUploading] = useState(false);

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
      const { data: { user } } = await supabase.auth.getUser();
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
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsMultipleSelection: true,
      selectionLimit: 8 - vehiclePhotos.length,
    });
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
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });

    if (!result.canceled) {
      uploadImage(result.assets[0].uri);
    }
  }

  async function uploadImage(uri) {
    try {
      setUploading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not found');

      // 1. Read file as base64 using expo-file-system
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      // 2. Convert base64 to ArrayBuffer (Manual decoder for React Native compatibility)
      const base64Characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const base64ToArrayBuffer = (data) => {
        const len = data.length;
        let bufferLength = len * 0.75;
        if (data[len - 1] === '=') {
          bufferLength--;
          if (data[len - 2] === '=') bufferLength--;
        }
        const arrayBuffer = new ArrayBuffer(bufferLength);
        const bytes = new Uint8Array(arrayBuffer);
        for (let i = 0, j = 0; i < len; i += 4, j += 3) {
          const encoded1 = base64Characters.indexOf(data[i]);
          const encoded2 = base64Characters.indexOf(data[i + 1]);
          const encoded3 = base64Characters.indexOf(data[i + 2]);
          const encoded4 = base64Characters.indexOf(data[i + 3]);
          bytes[j] = (encoded1 << 2) | (encoded2 >> 4);
          bytes[j + 1] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
          bytes[j + 2] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }
        return arrayBuffer;
      };

      const arrayBuffer = base64ToArrayBuffer(base64);
      
      const fileExt = uri.split('.').pop().toLowerCase();
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;
      const filePath = fileName;

      // 3. Upload to Supabase
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, arrayBuffer, {
          cacheControl: '3600',
          contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`,
        });

      if (uploadError) {
        console.error('Supabase upload error:', uploadError);
        throw uploadError;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      setAvatarUrl(publicUrl);
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
      const { data: { user } } = await supabase.auth.getUser();
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
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={loading || uploading}>
          {loading ? <ActivityIndicator size="small" color="#0A84FF" /> : <Text style={styles.saveText}>Save</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarSection}>
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
          <TouchableOpacity onPress={pickImage} disabled={uploading}>
            <Text style={styles.changePhotoText}>{uploading ? 'Uploading...' : 'Change Photo'}</Text>
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

        {role === 'mover' && (
          <>
            <View style={styles.sectionDivider}>
              <Ionicons name="car-sport-outline" size={18} color="#0A84FF" />
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
                        <Ionicons name="camera-outline" size={24} color="#0A84FF" />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: Platform.OS === 'ios' ? 60 : 30, 
    paddingHorizontal: 20, 
    paddingBottom: 15, 
    borderBottomWidth: 1, 
    borderBottomColor: '#F0F0F0' 
  },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000' },
  saveText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#0A84FF' },
  content: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 30 },
  avatarContainer: { 
    width: 100, 
    height: 100, 
    borderRadius: 50, 
    backgroundColor: '#F0F5FF', 
    marginBottom: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center'
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarPlaceholder: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  uploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  changePhotoText: { fontFamily: 'Poppins_500Medium', color: '#0A84FF' },
  inputGroup: { marginBottom: 20 },
  label: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#8E8E93', marginBottom: 8 },
  input: { backgroundColor: '#F5F5F5', height: 52, borderRadius: 12, paddingHorizontal: 16, fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#000' },
  sectionDivider: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000', marginLeft: 8 },
  vehicleTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleTypeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#E5E5EA' },
  vehicleTypeChipActive: { backgroundColor: '#0A84FF', borderColor: '#0A84FF' },
  vehicleTypeText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#3C3C43' },
  vehicleTypeTextActive: { color: '#FFF' },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoTile: { width: 78, height: 78, borderRadius: 12, overflow: 'hidden' },
  photoImage: { width: '100%', height: '100%' },
  photoRemove: { position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  photoAddTile: { width: 78, height: 78, borderRadius: 12, backgroundColor: '#F0F5FF', borderWidth: 1.5, borderColor: '#B8D4FF', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  photoAddText: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#0A84FF', marginTop: 2 }
});
