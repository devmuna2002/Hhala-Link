import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { NotificationService } from '../services/NotificationService';
import { TYPE_CONFIG, CATEGORY_LABELS } from './NotificationsScreen';

const formatFullDate = (dateString) => {
  if (!dateString) return '—';
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleString([], {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function NotificationDetailScreen({ route, navigation }) {
  const initial = route.params?.notification || {};
  const [notification, setNotification] = useState(initial);
  const [propertyImage, setPropertyImage] = useState(initial.data?.image_url || null);

  const config = TYPE_CONFIG[notification.type] || TYPE_CONFIG.default;
  const categoryInfo =
    CATEGORY_LABELS[config.role] || { label: config.role, color: '#0A84FF', bg: '#EAF3FF' };
  const actor = notification.actor;
  const actorName = actor
    ? actor.business_name || `${actor.first_name || ''} ${actor.last_name || ''}`.trim()
    : null;

  // Mark as read on open
  useEffect(() => {
    if (!notification.is_read) {
      markAsRead(notification.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve a related property image when only an id is available
  useEffect(() => {
    const propId =
      notification.data?.property_id ||
      (config.isProperty && typeof notification.reference_id === 'string' && notification.reference_id.length > 10
        ? notification.reference_id
        : null);

    if (propertyImage) return;

    if (propId) {
      supabase
        .from('properties')
        .select('property_images(url, is_cover)')
        .eq('id', propId)
        .single()
        .then(({ data }) => {
          const cover =
            data?.property_images?.find((img) => img.is_cover) || data?.property_images?.[0];
          if (cover?.url) setPropertyImage(cover.url);
        })
        .catch(() => {});
    }
  }, []);

  const markAsRead = async (id) => {
    try {
      await supabase.from('notifications').update({ is_read: true }).eq('id', id);
      setNotification((prev) => ({ ...prev, is_read: true }));
    } catch (e) {
      console.log('Error marking as read:', e.message);
    }
  };

  const openRelated = () => {
    const r = NotificationService.getNotificationRoute(notification.type, notification.reference_id);
    if (r) navigation.navigate(r.screen, r.params);
  };

  const handleMoverAccept = (accept) => {
    Alert.alert(
      accept ? 'Accept Moving Request' : 'Decline Request',
      `Are you sure you want to ${accept ? 'accept' : 'decline'} this job request?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: accept ? 'Accept' : 'Decline',
          onPress: async () => {
            try {
              const status = accept ? 'confirmed' : 'cancelled';
              const { error } = await supabase
                .from('mover_bookings')
                .update({ status })
                .eq('id', notification.reference_id);
              if (error) throw error;
              Alert.alert('Job Confirmed', 'Customer will be notified en route.');
              markAsRead(notification.id);
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  const handleApplicationModeration = (approve) => {
    Alert.alert(
      approve ? 'Approve Application' : 'Reject Application',
      'Reviewing listing application...',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: approve ? 'Approve' : 'Reject',
          onPress: async () => {
            try {
              const status = approve ? 'approved' : 'rejected';
              const { error } = await supabase
                .from('applications')
                .update({
                  status,
                  decision_note: approve
                    ? 'Welcome to your new home!'
                    : 'Thank you for your interest. We went with another applicant.',
                })
                .eq('id', notification.reference_id);
              if (error) throw error;
              Alert.alert('Status Updated', 'Tenant has been notified.');
              markAsRead(notification.id);
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  };

  const renderActions = () => {
    const route = NotificationService.getNotificationRoute(
      notification.type,
      notification.reference_id
    );

    switch (notification.type) {
      case 'new_move_request':
        return (
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.primaryBtn]} onPress={() => handleMoverAccept(true)}>
              <Text style={styles.primaryBtnText}>Accept Job</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.secondaryBtn]} onPress={() => handleMoverAccept(false)}>
              <Text style={styles.secondaryBtnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        );
      case 'application_received':
        return (
          <View style={styles.actionRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.primaryBtn]} onPress={() => handleApplicationModeration(true)}>
              <Text style={styles.primaryBtnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.secondaryBtn]} onPress={() => handleApplicationModeration(false)}>
              <Text style={styles.secondaryBtnText}>Reject</Text>
            </TouchableOpacity>
          </View>
        );
      default:
        if (route) {
          return (
            <TouchableOpacity style={[styles.actionBtn, styles.primaryBtn, styles.fullBtn]} onPress={openRelated}>
              <Ionicons name="arrow-forward" size={16} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={styles.primaryBtnText}>Open Related</Text>
            </TouchableOpacity>
          );
        }
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#1C1E21" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notification</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Big Icon */}
        <View style={[styles.iconCircle, { backgroundColor: config.color + '18' }]}>
          <Ionicons name={config.icon} size={40} color={config.color} />
        </View>

        {/* Title */}
        <Text style={styles.title}>{notification.title || config.title}</Text>

        {/* Status + Category */}
        <View style={styles.statusRow}>
          <View style={[styles.categoryPill, { backgroundColor: categoryInfo.bg }]}>
            <Text style={[styles.categoryText, { color: categoryInfo.color }]}>{categoryInfo.label}</Text>
          </View>
          <View
            style={[
              styles.readBadge,
              notification.is_read ? styles.readBadgeRead : styles.readBadgeUnread,
            ]}
          >
            <Ionicons
              name={notification.is_read ? 'checkmark-circle' : 'ellipse'}
              size={12}
              color={notification.is_read ? '#34C759' : '#0A84FF'}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.readText, { color: notification.is_read ? '#34C759' : '#0A84FF' }]}>
              {notification.is_read ? 'Read' : 'Unread'}
            </Text>
          </View>
        </View>

        {/* Sender */}
        {actorName && (
          <View style={styles.senderRow}>
            {actor?.avatar_url ? (
              <Image source={{ uri: actor.avatar_url }} style={styles.senderAvatar} />
            ) : (
              <View style={[styles.senderAvatarPlaceholder, { backgroundColor: config.color + '20' }]}>
                <Ionicons name="person" size={18} color={config.color} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.senderName}>{actorName}</Text>
              {actor?.role && <Text style={styles.senderRole}>{actor.role}</Text>}
            </View>
          </View>
        )}

        {/* Body */}
        <View style={styles.bodyCard}>
          <Text style={styles.bodyText}>{notification.message || notification.body || ''}</Text>
        </View>

        {/* Timestamp */}
        <View style={styles.timeRow}>
          <Ionicons name="time-outline" size={15} color="#8E8E93" style={{ marginRight: 6 }} />
          <Text style={styles.timeText}>{formatFullDate(notification.created_at)}</Text>
        </View>

        {/* Related image */}
        {propertyImage && (
          <Image source={{ uri: propertyImage }} style={styles.relatedImage} resizeMode="cover" />
        )}

        {/* Actions */}
        {renderActions()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E6EB',
    backgroundColor: '#FFFFFF',
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    color: '#050505',
  },

  content: { padding: 24, paddingBottom: 60, alignItems: 'center' },

  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },

  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: '#050505',
    textAlign: 'center',
    marginBottom: 12,
  },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  categoryPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  categoryText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  readBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F0F2F5',
  },
  readBadgeRead: {},
  readBadgeUnread: {},
  readText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
  },

  senderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: '#F6F8FB',
    borderRadius: 16,
    padding: 14,
    marginBottom: 18,
  },
  senderAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E4E6EB' },
  senderAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  senderName: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#050505' },
  senderRole: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#8E8E93',
    textTransform: 'capitalize',
  },

  bodyCard: {
    width: '100%',
    backgroundColor: '#F6F8FB',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
  },
  bodyText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 16,
    lineHeight: 24,
    color: '#1C1E21',
  },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 18,
  },
  timeText: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93' },

  relatedImage: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: '#F0F2F5',
    marginBottom: 18,
  },

  actionRow: { flexDirection: 'row', gap: 12, width: '100%' },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 14,
  },
  fullBtn: { width: '100%' },
  primaryBtn: { backgroundColor: '#0A84FF' },
  primaryBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#FFFFFF' },
  secondaryBtn: { backgroundColor: '#E4E6EB' },
  secondaryBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#050505' },
});
