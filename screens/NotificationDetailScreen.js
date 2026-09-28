import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { NotificationService } from '../services/NotificationService';
import { updateBookingStatus } from '../services/MoversService';
import { TYPE_CONFIG } from './NotificationsScreen';

// Threads-style system type (no Poppins on this screen)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

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
  // Requested job info for mover booking notifications (reference_id = booking id).
  const [jobBooking, setJobBooking] = useState(null);

  const config = TYPE_CONFIG[notification.type] || TYPE_CONFIG.default;
  const actor = notification.actor;
  const actorName = actor
    ? actor.business_name || `${actor.first_name || ''} ${actor.last_name || ''}`.trim()
    : null;
  const isMoveRequest = notification.type === 'new_move_request' || notification.type === 'mover_booking';

  // Load the requested job so the mover sees pickup / drop-off / date /
  // price / items right here. Falls back to the data snapshot embedded in
  // the notification by the booking RPC when the row can't be read.
  useEffect(() => {
    if (!isMoveRequest || !notification.reference_id) return;
    let cancelled = false;
    supabase
      .from('mover_bookings')
      .select(`
        id, status, created_at, job_details,
        client:profiles!client_id(id, first_name, last_name, avatar_url, phone_number)
      `)
      .eq('id', notification.reference_id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setJobBooking(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [notification.reference_id, notification.type]);

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
    // Never let a bad route take down the app: a synchronous navigate
    // throw (unknown screen, bad params) restarts the whole app in
    // production, so validate first and fall back to an alert.
    try {
      // Property-linked notifications open the listing directly — the
      // embedded data id is more reliable than reference_id (which may
      // point at an application, like, or match row instead of the
      // property itself, landing on "Property not found").
      const propId = notification.data?.property_id;
      if (propId && config?.isProperty) {
        navigation.navigate('Detail', { propertyId: propId });
        return;
      }
      const r = NotificationService.getNotificationRoute(notification.type, notification.reference_id);
      if (!r?.screen) {
        Alert.alert('Nothing to open', 'This notification has no linked content.');
        return;
      }
      navigation.navigate(r.screen, r.params || {});
    } catch (e) {
      console.log('[NotificationDetail] openRelated failed:', e?.message || e);
      Alert.alert('Could not open', 'The linked content is unavailable right now.');
    }
  };

  // Smart: tapping the sender opens a chat with them.
  const openActorChat = () => {
    if (!actor?.id) return;
    navigation.navigate('ChatRoom', {
      participantB: actor.id,
      recipientName: actorName,
      recipientAvatar: actor.avatar_url || null,
      recipientRole: actor.role || null,
    });
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
              // Valid booking statuses are accepted/declined (see MyMoverBookings).
              const { error } = await updateBookingStatus(
                notification.reference_id,
                accept ? 'accepted' : 'declined'
              );
              if (error) throw new Error(error.message || 'Could not update booking.');
              setJobBooking((prev) => (prev ? { ...prev, status: accept ? 'accepted' : 'declined' } : prev));
              Alert.alert(accept ? 'Job Accepted' : 'Request Declined', 'The customer will be notified.');
              // Real push for the client (fire-and-forget).
              try {
                const clientId = jobBooking?.client?.id || null;
                const when = jobBooking?.job_details?.moving_date ? ` on ${jobBooking.job_details.moving_date}` : '';
                NotificationService.notifyUser({
                  recipientId: clientId,
                  title: accept ? 'Booking accepted' : 'Booking declined',
                  body: accept
                    ? `Your mover accepted your request${when}.`
                    : `Your mover declined your request${when}. Try another mover.`,
                  data: { screen: 'MyMoverBookings' },
                }).catch(() => {});
              } catch (_) {}
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
              // Real push for the applicant (fire-and-forget).
              try {
                const { data: app } = await supabase
                  .from('applications')
                  .select('applicant_id')
                  .eq('id', notification.reference_id)
                  .single();
                NotificationService.notifyUser({
                  recipientId: app?.applicant_id || null,
                  title: approve ? 'Application approved' : 'Application update',
                  body: approve
                    ? 'Good news! Your application was approved. The agent will be in touch shortly.'
                    : 'Your application was not successful this time. Keep exploring other listings.',
                  data: { screen: 'Notifications' },
                }).catch(() => {});
              } catch (_) {}
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
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      {/* Back only — like a Threads thread view */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color="#111111" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Post-style header: avatar + name (taps through to chat) */}
        <TouchableOpacity
          style={styles.postHead}
          activeOpacity={actor?.id ? 0.7 : 1}
          onPress={openActorChat}
          disabled={!actor?.id}
        >
          <View style={styles.avatarWrap}>
            {actor?.avatar_url ? (
              <Image source={{ uri: actor.avatar_url }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarTile}>
                <Ionicons name={config.icon} size={20} color="#111111" />
              </View>
            )}
          </View>
          <View style={styles.postHeadMain}>
            <Text style={styles.name} numberOfLines={1}>
              {actorName || notification.title || config.title}
            </Text>
            {actorName ? (
              <Text style={styles.sub} numberOfLines={1}>
                {notification.title || config.title}
              </Text>
            ) : null}
          </View>
          {actor?.id && (
            <Ionicons name="chevron-forward" size={18} color="#C7C7CC" />
          )}
        </TouchableOpacity>

        {/* Body */}
        <Text style={styles.bodyText}>{notification.message || notification.body || ''}</Text>

        {/* Requested job info (mover booking notifications) */}
        {isMoveRequest && (() => {
          const jd = jobBooking?.job_details || notification.data || {};
          const hasJob = jd.pickup_address || jd.drop_address || jd.moving_date || jd.estimated_price || jd.items_description;
          if (!hasJob) return null;
          const client = jobBooking?.client;
          const clientName = client
            ? `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client'
            : null;
          return (
            <View style={styles.jobCard}>
              <Text style={styles.jobTitle}>Requested Job</Text>
              {clientName && (
                <View style={styles.jobRow}>
                  <Ionicons name="person" size={15} color="#8A8A8A" />
                  <Text style={styles.jobText}>{clientName}</Text>
                </View>
              )}
              {!!jd.pickup_address && (
                <View style={styles.jobRow}>
                  <View style={[styles.jobDot, { backgroundColor: '#22C55E' }]} />
                  <Text style={styles.jobText} numberOfLines={2}>{jd.pickup_address}</Text>
                </View>
              )}
              {!!jd.drop_address && (
                <View style={styles.jobRow}>
                  <View style={[styles.jobDot, { backgroundColor: '#111111' }]} />
                  <Text style={styles.jobText} numberOfLines={2}>{jd.drop_address}</Text>
                </View>
              )}
              {!!jd.moving_date && (
                <View style={styles.jobRow}>
                  <Ionicons name="calendar" size={15} color="#8A8A8A" />
                  <Text style={styles.jobText}>
                    {jd.moving_date}{jd.moving_time ? ` · ${jd.moving_time}` : ''}
                  </Text>
                </View>
              )}
              {!!jd.estimated_price && (
                <View style={styles.jobRow}>
                  <Ionicons name="cash" size={15} color="#8A8A8A" />
                  <Text style={styles.jobText}>${jd.estimated_price}</Text>
                </View>
              )}
              {!!jd.items_description && (
                <Text style={styles.jobNotes} numberOfLines={4}>Items: {jd.items_description}</Text>
              )}
              {(jd.need_packing || jd.need_insurance) && (
                <Text style={styles.jobNotes}>
                  {[jd.need_packing ? 'Packing requested' : null, jd.need_insurance ? 'Insurance requested' : null].filter(Boolean).join(' · ')}
                </Text>
              )}
              {!!jd.notes && (
                <Text style={styles.jobNotes} numberOfLines={4}>Notes: {jd.notes}</Text>
              )}
            </View>
          );
        })()}

        {/* Media (taps through to the related screen) */}
        {propertyImage && (
          <TouchableOpacity activeOpacity={0.85} onPress={openRelated}>
            <Image source={{ uri: propertyImage }} style={styles.relatedImage} resizeMode="cover" />
          </TouchableOpacity>
        )}

        {/* Meta */}
        <Text style={styles.meta}>
          {formatFullDate(notification.created_at)}
          {!notification.is_read && <Text style={styles.metaUnread}> · Unread</Text>}
        </Text>

        <View style={styles.divider} />

        {/* Actions */}
        {renderActions()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 8,
    paddingBottom: 4,
    backgroundColor: '#FFFFFF',
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },

  content: { paddingHorizontal: 16, paddingBottom: 60 },

  // Post-style header
  postHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#F0F0F0',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarTile: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  postHeadMain: { flex: 1, minWidth: 0 },
  name: {
    fontFamily: SYS_MED,
    fontSize: 17,
    color: '#111111',
  },
  sub: {
    fontFamily: SYS,
    fontSize: 13,
    color: '#8A8A8A',
    marginTop: 1,
  },

  bodyText: {
    fontFamily: SYS,
    fontSize: 16,
    lineHeight: 23,
    color: '#111111',
  },

  relatedImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: '#F0F0F0',
    marginTop: 12,
  },

  meta: {
    fontFamily: SYS,
    fontSize: 13,
    color: '#8A8A8A',
    marginTop: 12,
  },
  metaUnread: {
    fontFamily: SYS_MED,
    color: '#111111',
  },

  // Requested job card (mover booking notifications)
  jobCard: {
    backgroundColor: '#F0F0F0',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
    gap: 8,
  },
  jobTitle: { fontFamily: SYS_MED, fontSize: 14, color: '#111111', marginBottom: 2 },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobDot: { width: 8, height: 8, borderRadius: 4 },
  jobText: { fontFamily: SYS, fontSize: 14, color: '#111111', flex: 1 },
  jobNotes: { fontFamily: SYS, fontSize: 13, color: '#555555', lineHeight: 18 },

  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
    marginVertical: 16,
  },

  actionRow: { flexDirection: 'row', gap: 12, width: '100%' },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 12,
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9D9D9',
  },
  primaryBtnText: { fontFamily: SYS_MED, fontSize: 15, color: '#111111' },
  secondaryBtn: { backgroundColor: '#EFEFEF' },
  secondaryBtnText: { fontFamily: SYS_MED, fontSize: 15, color: '#111111' },
});
