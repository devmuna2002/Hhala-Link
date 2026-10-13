import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../utils/theme';
import { listDrafts, deleteDraft, draftTitleOf, migrateLegacyDraftOnce } from '../utils/drafts';

const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

export default function MyDraftsScreen({ navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await migrateLegacyDraftOnce();
      setDrafts(await listDrafts());
    } catch (_) {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleDelete = (id) => {
    Alert.alert('Delete draft?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteDraft(id);
          setDrafts((prev) => prev.filter((d) => d.id !== id));
        },
      },
    ]);
  };

  const resume = (draft) => {
    navigation.navigate('AddListing', { draftId: draft.id, draft });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => { try { if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Main'); } catch (_) {} }}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={26} color={t.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title} numberOfLines={1}>My Drafts</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {drafts.length === 0 ? 'Unfinished listings' : `${drafts.length} saved`}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => navigation.navigate('AddListing')}
          accessibilityRole="button"
          accessibilityLabel="New listing"
        >
          <Ionicons name="add" size={26} color={t.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="small" color={t.sub} style={{ marginTop: 40 }} />
        ) : drafts.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="document-outline" size={48} color={t.sub} style={{ opacity: 0.4, marginBottom: 14 }} />
            <Text style={styles.emptyTitle}>No drafts yet</Text>
            <Text style={styles.emptySub}>Start a listing and tap Draft — it will wait for you here.</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('AddListing')} activeOpacity={0.85}>
              <Text style={styles.emptyBtnText}>Start a listing</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.list}>
            {drafts.map((d, index) => {
              const f = d.form || {};
              const images = Array.isArray(d.images) ? d.images : [];
              const thumb = images.find((i) => i?.uri)?.uri || null;
              const meta = [
                f.city ? String(f.city).trim() : null,
                f.rent_usd ? `$${f.rent_usd}/mo` : null,
                f.sale_price_usd ? `$${f.sale_price_usd}` : null,
              ].filter(Boolean).join(' · ');
              return (
                <TouchableOpacity
                  key={d.id}
                  style={[styles.row, index === drafts.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => resume(d)}
                  activeOpacity={0.8}
                >
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.thumb} />
                  ) : d.video?.uri ? (
                    <View style={[styles.thumb, styles.thumbEmpty]}>
                      <Ionicons name="videocam" size={22} color={t.sub} />
                    </View>
                  ) : (
                    <View style={[styles.thumb, styles.thumbEmpty]}>
                      <Ionicons name="image-outline" size={22} color={t.sub} />
                    </View>
                  )}
                  <View style={styles.body}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{draftTitleOf(d)}</Text>
                    {!!meta && <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>}
                    <Text style={styles.rowDate} numberOfLines={1}>
                      {`${images.length || 0} photo${images.length === 1 ? '' : 's'}${d.video?.uri ? ' · video' : ''} · ${d.savedAt ? new Date(d.savedAt).toLocaleDateString() : ''}`}
                    </Text>
                    <View style={styles.rowActions}>
                      <TouchableOpacity onPress={() => resume(d)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Text style={styles.resumeText}>Resume</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => handleDelete(d.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Text style={styles.deleteText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.sub} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    backgroundColor: t.card,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  title: { fontFamily: SYS_MED, fontSize: 20, fontWeight: '700', color: t.text },
  subtitle: { fontFamily: SYS, fontSize: 13, color: t.sub, marginTop: 1 },
  newBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingBottom: 40 },
  list: {
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    backgroundColor: t.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  thumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: t.tile },
  thumbEmpty: { justifyContent: 'center', alignItems: 'center' },
  body: { flex: 1, marginLeft: 12, minWidth: 0 },
  rowTitle: { fontFamily: SYS_MED, fontSize: 16, fontWeight: '600', color: t.text },
  rowMeta: { fontFamily: SYS, fontSize: 13, color: t.sub, marginTop: 2 },
  rowDate: { fontFamily: SYS, fontSize: 12, color: t.sub, marginTop: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 8 },
  resumeText: { fontFamily: SYS_MED, fontSize: 15, fontWeight: '600', color: t.text },
  deleteText: { fontFamily: SYS, fontSize: 15, color: '#FF3B30' },
  emptyBox: { alignItems: 'center', padding: 36, marginTop: 24 },
  emptyTitle: { fontFamily: SYS_MED, fontSize: 18, fontWeight: '700', color: t.text },
  emptySub: { fontFamily: SYS, fontSize: 14, color: t.sub, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  emptyBtn: { marginTop: 18, backgroundColor: t.text, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 22 },
  emptyBtnText: { color: t.bg, fontFamily: SYS_MED, fontSize: 16, fontWeight: '600' },
});
