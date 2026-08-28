import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../supabase';

export default function AvatarUploadModal({ visible, user, profile, onAvatarSaved, onDismiss }) {
  const [avatarUri, setAvatarUri] = useState(null);
  const [avatarBase64, setAvatarBase64] = useState(null);
  const [uploading, setUploading] = useState(false);

  const role = profile?.role || 'tenant';
  const isAgent = role === 'agent';
  const isMover = role === 'mover';

  const pickImage = async (useCamera = false) => {
    try {
      let result;
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
          base64: true,
        });
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Gallery permission is required to choose a profile picture.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.5,
          base64: true,
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        setAvatarUri(result.assets[0].uri);
        setAvatarBase64(result.assets[0].base64);
      }
    } catch (e) {
      console.log('Image pick error:', e);
      Alert.alert('Error', 'Could not open photo selector.');
    }
  };

  const handleSaveAvatar = async () => {
    if (!avatarUri) {
      Alert.alert('Choose Photo', 'Please select or take a photo first.');
      return;
    }

    setUploading(true);
    try {
      const finalAvatarUrl = avatarBase64
        ? `data:image/jpeg;base64,${avatarBase64}`
        : avatarUri;

      // 1. Update profiles table
      const { error } = await supabase
        .from('profiles')
        .update({
          avatar_url: finalAvatarUrl,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;

      onAvatarSaved(finalAvatarUrl);
    } catch (e) {
      console.log('Avatar save error:', e);
      Alert.alert('Upload Error', e.message || 'Could not save profile picture.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Ionicons
                name={isAgent ? 'business' : isMover ? 'cube' : 'person'}
                size={22}
                color="#0A84FF"
              />
            </View>
            <Text style={styles.title}>Add a Profile Picture</Text>
            <Text style={styles.subtitle}>
              {isAgent
                ? 'Tenants trust agents with professional photos. Add your picture or agency logo.'
                : isMover
                ? 'Add your business logo or profile photo so clients can recognize your team.'
                : 'Personalize your account and help agents identify you easily.'}
            </Text>
          </View>

          {/* Avatar Preview / Picker Circle */}
          <TouchableOpacity
            style={styles.avatarPreviewWrap}
            onPress={() => pickImage(false)}
            activeOpacity={0.8}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="camera" size={38} color="#0A84FF" />
                <Text style={styles.tapToChooseText}>Tap to Choose</Text>
              </View>
            )}

            <View style={styles.cameraPencilBadge}>
              <Ionicons name="camera-reverse" size={14} color="#FFF" />
            </View>
          </TouchableOpacity>

          {/* Camera vs Gallery Options */}
          <View style={styles.optionsRow}>
            <TouchableOpacity style={styles.optionBtn} onPress={() => pickImage(false)}>
              <Ionicons name="images-outline" size={18} color="#1C1E21" />
              <Text style={styles.optionBtnText}>Choose from Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.optionBtn} onPress={() => pickImage(true)}>
              <Ionicons name="camera-outline" size={18} color="#1C1E21" />
              <Text style={styles.optionBtnText}>Take Photo</Text>
            </TouchableOpacity>
          </View>

          {/* Primary Save Button */}
          <TouchableOpacity
            style={[styles.saveBtn, !avatarUri && styles.saveBtnDisabled]}
            onPress={handleSaveAvatar}
            disabled={uploading || !avatarUri}
            activeOpacity={0.8}
          >
            {uploading ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={18} color="#FFF" style={{ marginRight: 6 }} />
                <Text style={styles.saveBtnText}>Save Profile Photo</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Dismiss / Skip button */}
          <TouchableOpacity style={styles.skipBtn} onPress={onDismiss} disabled={uploading}>
            <Text style={styles.skipBtnText}>I'll do this later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 20,
  },
  header: {
    alignItems: 'center',
    marginBottom: 18,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EBF5FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
    color: '#1C1E21',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12.5,
    color: '#65676B',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  avatarPreviewWrap: {
    position: 'relative',
    marginVertical: 14,
  },
  avatarImage: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: '#0A84FF',
  },
  avatarPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#F0F4FA',
    borderWidth: 2,
    borderColor: '#D8E2F0',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tapToChooseText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: '#0A84FF',
    marginTop: 4,
  },
  cameraPencilBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#0A84FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 16,
  },
  optionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F6F8',
    borderRadius: 12,
    paddingVertical: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E4E6EB',
  },
  optionBtnText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11.5,
    color: '#1C1E21',
  },
  saveBtn: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0A84FF',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0A84FF',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 10,
  },
  saveBtnDisabled: {
    backgroundColor: '#A0AEC0',
    shadowOpacity: 0,
    elevation: 0,
  },
  saveBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  skipBtn: {
    paddingVertical: 8,
  },
  skipBtnText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#8E8E93',
  },
});
