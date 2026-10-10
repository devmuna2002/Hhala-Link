import React, { useState, useMemo } from 'react';
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
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../supabase';
import { useTheme } from '../utils/theme';

export default function AvatarUploadModal({ visible, user, profile, onAvatarSaved, onDismiss }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [avatarUri, setAvatarUri] = useState(null);
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
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        setAvatarUri(result.assets[0].uri);
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
      // Shrink first: a 768px JPEG uploads several times faster than a
      // full-resolution camera photo and is plenty for an avatar.
      let uploadUri = avatarUri;
      try {
        const small = await manipulateAsync(
          avatarUri,
          [{ resize: { width: 768 } }],
          { compress: 0.7, format: SaveFormat.JPEG }
        );
        if (small?.uri) uploadUri = small.uri;
      } catch (_) {}
      // Upload the file to avatar storage and persist only the public URL.
      // Embedded base64 data URIs (~100KB+ per photo) overflow the MySQL
      // avatar column and fail the whole save with ER_DATA_TOO_LONG.
      const fileName = `${user.id}/${Date.now()}.jpg`;
      const { data, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, uploadUri, { contentType: 'image/jpeg' });
      if (uploadError || !data) {
        throw new Error(uploadError?.message || 'Photo upload failed. Please check your connection and try again.');
      }
      const finalAvatarUrl = supabase.storage.from('avatars').getPublicUrl(data.path || fileName).data.publicUrl;

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
                name={isAgent ? 'business' : isMover ? 'swap-horizontal' : 'person'}
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
              <Ionicons name="images" size={18} color="#1C1E21" />
              <Text style={styles.optionBtnText}>Choose from Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.optionBtn} onPress={() => pickImage(true)}>
              <Ionicons name="camera" size={18} color="#1C1E21" />
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

const buildStyles = (t) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  card: {
    width: '100%',
    maxWidth: 390,
    backgroundColor: t.card,
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: t.hairline,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 14,
  },
  header: {
    alignItems: 'center',
    marginBottom: 18,
    width: '100%',
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: t.input,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: t.text,
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13.5,
    color: t.sub,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  avatarPreviewWrap: {
    position: 'relative',
    marginVertical: 18,
    width: 118,
    height: 118,
    borderRadius: 59,
    backgroundColor: t.input,
    borderWidth: 1,
    borderColor: t.hairline,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
    borderColor: '#0A84FF',
  },
  avatarPlaceholder: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: t.input,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tapToChooseText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11.5,
    color: '#0A84FF',
    marginTop: 6,
  },
  cameraPencilBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#0A84FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: t.card,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginBottom: 18,
  },
  optionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.input,
    borderRadius: 14,
    paddingVertical: 12,
    gap: 7,
    borderWidth: 1,
    borderColor: t.hairline,
  },
  optionBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12.5,
    color: t.text,
  },
  saveBtn: {
    width: '100%',
    height: 50,
    borderRadius: 999,
    backgroundColor: '#0A84FF',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0A84FF',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 10,
  },
  saveBtnDisabled: {
    backgroundColor: '#A7B0BE',
    shadowOpacity: 0,
    elevation: 0,
  },
  saveBtnText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  skipBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  skipBtnText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13.5,
    color: t.sub,
  },
});
