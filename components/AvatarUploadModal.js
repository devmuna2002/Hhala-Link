import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
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

// Threads-style system type (no Poppins on this modal)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

export default function AvatarUploadModal({ visible, user, profile, onAvatarSaved, onDismiss, required = false, onSignOut }) {
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      // Required mode is blocking: hardware back / backdrop taps never
      // dismiss it. The only way out is uploading (or signing out below).
      onRequestClose={required ? () => {} : onDismiss}
    >
      <View style={styles.overlay}>
        <Pressable onPress={required ? undefined : onDismiss} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.sheetHeader}>
            <View style={styles.avatarMini}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarMiniImg} />
              ) : (
                <Ionicons
                  name={isAgent ? 'business' : isMover ? 'swap-horizontal' : 'person'}
                  size={22}
                  color={t.text}
                />
              )}
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>{required ? 'Profile photo required' : 'Add a profile picture'}</Text>
              <Text style={styles.subtitle}>
                {isAgent
                  ? 'Tenants trust agents with photos. Upload yours to continue.'
                  : isMover
                  ? 'Upload your logo or photo to continue.'
                  : 'Upload a photo to continue.'}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.previewBtn}
              onPress={() => pickImage(false)}
              activeOpacity={0.65}
              accessibilityLabel="Choose profile photo"
            >
              <Text style={styles.previewBtnText}>{avatarUri ? 'Change' : 'Add'}</Text>
            </TouchableOpacity>
          </View>

          {avatarUri ? (
            <View style={styles.previewCircleWrap}>
              <Image source={{ uri: avatarUri }} style={styles.previewLarge} />
            </View>
          ) : null}

          {/* Source rows */}
          <View style={styles.rows}>
            <TouchableOpacity style={styles.row} onPress={() => pickImage(false)} activeOpacity={0.6}>
              <Ionicons name="images-outline" size={22} color={t.text} />
              <Text style={styles.rowText}>Choose from library</Text>
              <Ionicons name="chevron-forward" size={18} color={t.sub} />
            </TouchableOpacity>
            <View style={styles.rowDivider} />
            <TouchableOpacity style={styles.row} onPress={() => pickImage(true)} activeOpacity={0.6}>
              <Ionicons name="camera-outline" size={22} color={t.text} />
              <Text style={styles.rowText}>Take photo</Text>
              <Ionicons name="chevron-forward" size={18} color={t.sub} />
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
              <ActivityIndicator color={t.bg} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save</Text>
            )}
          </TouchableOpacity>

          {/* Dismiss / Skip — hidden in required mode. A sign-out
              escape stays so a broken upload can never brick the app;
              the gate re-pops on next login until a photo is uploaded. */}
          {required ? (
            onSignOut ? (
              <TouchableOpacity style={styles.skipBtn} onPress={onSignOut} disabled={uploading} activeOpacity={0.65}>
                <Text style={styles.skipBtnText}>Sign out</Text>
              </TouchableOpacity>
            ) : null
          ) : (
            <TouchableOpacity style={styles.skipBtn} onPress={onDismiss} disabled={uploading} activeOpacity={0.65}>
              <Text style={styles.skipBtnText}>Not now</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const buildStyles = (t) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: t.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: t.hairline,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  avatarMini: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarMiniImg: {
    width: '100%',
    height: '100%',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontFamily: SYS_MED,
    fontWeight: '700',
    fontSize: 17,
    color: t.text,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontFamily: SYS,
    fontSize: 13.5,
    color: t.sub,
    lineHeight: 18,
    marginTop: 2,
  },
  previewBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.hairline,
  },
  previewBtnText: {
    fontFamily: SYS_MED,
    fontWeight: '600',
    fontSize: 14,
    color: t.text,
  },
  previewCircleWrap: {
    alignSelf: 'center',
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: t.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline,
    overflow: 'hidden',
    marginBottom: 14,
  },
  previewLarge: {
    width: '100%',
    height: '100%',
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.hairline,
    marginLeft: 34,
  },
  rowText: {
    flex: 1,
    fontFamily: SYS,
    fontSize: 16,
    color: t.text,
  },
  saveBtn: {
    width: '100%',
    minHeight: 58,
    borderRadius: 999,
    backgroundColor: t.text,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  saveBtnDisabled: {
    opacity: 0.35,
  },
  saveBtnText: {
    fontFamily: SYS_MED,
    fontWeight: '700',
    fontSize: 17,
    color: t.bg,
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignSelf: 'center',
  },
  skipBtnText: {
    fontFamily: SYS,
    fontSize: 14,
    color: t.sub,
  },
});
