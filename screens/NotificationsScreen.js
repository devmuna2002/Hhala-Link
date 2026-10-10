import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
  FlatList
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getSessionUser } from '../supabase';
import { NotificationService } from '../services/NotificationService';
import { useFocusEffect } from '@react-navigation/native';
import { emitFeedScroll } from '../utils/feedScroll';
import { withTimeout, withRetry } from '../utils/network';
import { useTheme } from '../utils/theme';
import { NotificationRowSkeleton } from '../components/Skeleton';
import { toPublicImageUrl } from '../utils/imageUrl';
import ThreadsButton from '../components/ThreadsButton';
import * as Haptics from 'expo-haptics';

// Threads-style system type (no Poppins on this screen)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

export const TYPE_CONFIG = {
  // Tenant Alerts
  'price_drop': { icon: 'trending-down', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Price Drop', role: 'tenant', isProperty: true },
  'property_match': { icon: 'key-sharp', color: '#0A84FF', badgeBg: '#0A84FF', title: 'New Match', role: 'tenant', isProperty: true },
  'application_approved': { icon: 'checkmark-circle-sharp', color: '#34C759', badgeBg: '#34C759', title: 'Application Approved', role: 'tenant', isProperty: true },
  'application_rejected': { icon: 'close-circle-sharp', color: '#FF3B30', badgeBg: '#FF3B30', title: 'Application Update', role: 'tenant', isProperty: true },
  'viewing_reminder': { icon: 'calendar-sharp', color: '#5856D6', badgeBg: '#5856D6', title: 'Viewing Appointment', role: 'tenant', isProperty: true },
  'landlord_message': { icon: 'chatbubbles', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Message from Agent', role: 'tenant', isProperty: false },

  // Landlord / Agent Alerts
  'application_received': { icon: 'document-text-sharp', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Application Received', role: 'landlord', isProperty: true },
  'property_analytics': { icon: 'analytics-sharp', color: '#AF52DE', badgeBg: '#AF52DE', title: 'Listing Update', role: 'landlord', isProperty: true },
  'listing_approved': { icon: 'rocket-sharp', color: '#34C759', badgeBg: '#34C759', title: 'Listing Approved', role: 'landlord', isProperty: true },
  'listing_expired': { icon: 'timer-sharp', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Listing Expiring', role: 'landlord', isProperty: true },
  'tenant_verification': { icon: 'shield-checkmark', color: '#34C759', badgeBg: '#34C759', title: 'Tenant Verified', role: 'landlord', isProperty: false },

  // Movers / Freight Alerts
  'new_move_request': { icon: 'cube-sharp', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Move Request', role: 'mover', isProperty: false },
  'booking_confirmed': { icon: 'checkbox-sharp', color: '#34C759', badgeBg: '#34C759', title: 'Booking Confirmed', role: 'mover', isProperty: false },
  'pickup_reminder': { icon: 'alarm', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Pickup Scheduled', role: 'mover', isProperty: false },
  'route_update': { icon: 'navigate', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Route Update', role: 'mover', isProperty: false },
  'delivery_complete': { icon: 'checkmark-done-circle-sharp', color: '#34C759', badgeBg: '#34C759', title: 'Delivery Complete', role: 'mover', isProperty: false },
  'mover_payment_received': { icon: 'cash', color: '#34C759', badgeBg: '#34C759', title: 'Payment Received', role: 'mover', isProperty: false },

  // Admin Alerts
  'new_user_registration': { icon: 'person-add', color: '#8E8E93', badgeBg: '#8E8E93', title: 'New Registration', role: 'admin', isProperty: false },
  'listing_moderation': { icon: 'eye', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Moderation Alert', role: 'admin', isProperty: true },
  'user_report': { icon: 'warning', color: '#FF3B30', badgeBg: '#FF3B30', title: 'User Report', role: 'admin', isProperty: false },
  'fraud_alert': { icon: 'shield', color: '#FF3B30', badgeBg: '#FF3B30', title: 'Fraud Alert', role: 'admin', isProperty: false },

  // Defaults
  'new_listing': { icon: 'home', color: '#0A84FF', badgeBg: '#0A84FF', title: 'New Property', role: 'tenant', isProperty: true },
  'like': { icon: 'heart', color: '#FF2D55', badgeBg: '#FF2D55', title: 'Saved Listing', role: 'tenant', isProperty: true },
  'message': { icon: 'chatbubble-ellipses', color: '#0A84FF', badgeBg: '#0A84FF', title: 'New Message', role: 'tenant', isProperty: false },
  'default': { icon: 'notifications', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Notification', role: 'tenant', isProperty: false }
};

export const CATEGORY_LABELS = {
  tenant: { label: 'Tenant', color: '#0A84FF', bg: '#EBF4FF' },
  landlord: { label: 'Agent', color: '#0A84FF', bg: '#EAF3FF' },
  mover: { label: 'Freight', color: '#34C759', bg: '#EAF8EE' },
  admin: { label: 'Admin', color: '#FF3B30', bg: '#F2F7FF' },
};

// Threads Activity-style filter pills
const FILTERS = ['All', 'Unread', 'Messages', 'Bookings', 'Listings'];
const MESSAGE_TYPES = new Set(['message', 'landlord_message']);
const BOOKING_TYPES = new Set([
  'new_move_request', 'booking_confirmed', 'pickup_reminder',
  'route_update', 'delivery_complete', 'mover_payment_received',
  'application_received', 'application_approved', 'application_rejected',
]);
const LISTING_TYPES = new Set([
  'price_drop', 'property_match', 'new_listing', 'like',
  'listing_approved', 'listing_expired', 'property_analytics',
  'listing_moderation', 'viewing_reminder',
]);

export default function NotificationsScreen({ navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [notifications, setNotifications] = useState([]);
  const [failedAvatarIds, setFailedAvatarIds] = useState({});
  const [propertyMap, setPropertyMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');

  const lastFeedY = useRef(0);
  const onFeedScroll = (e) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastFeedY.current;
    lastFeedY.current = y;
    if (Math.abs(dy) > 2) emitFeedScroll(dy);
  };
  const [currentUserId, setCurrentUserId] = useState(null);

  useFocusEffect(
    useCallback(() => {
      fetchData();
      // Mark all unread notifications as read when the inbox is opened,
      // so the badge clears even before the user taps a row.
      getSessionUser().then(async (user) => {
        if (!user) return;
        try {
          await supabase
            .from('notifications')
            .update({ is_read: true })
            .eq('user_id', user.id)
            .eq('is_read', false);
        } catch (_) {}
      }).catch(() => {});
      // Clear the app icon badge whenever the inbox is opened.
      try { NotificationService.clearBadgeAsync().catch(() => {}); } catch (_) {}
    }, [])
  );

  const fetchData = async () => {
    try {
      const user = await getSessionUser();
      if (!user) return;
      setCurrentUserId(user.id);
      // Instant paint: show the last cached inbox first so the screen never
      // sits on skeletons, then replace with live rows below.
      try {
        const cached = await AsyncStorage.getItem(`cached_notifications_${user.id}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setNotifications(parsed);
            setLoading(false);
          }
        }
      } catch (_) {}
      // Supabase-first: fetch live rows. The cache is written on success
      // and read only when the network fails (inside fetchNotifications).
      await fetchNotifications(user.id);
    } catch (e) {
      console.log('Error during notification init:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setShowLoadMore(false);
    }
  };

  async function fetchNotifications(userId) {
    try {
      // Bounded + retried (read-only): a hung query can no longer stall
      // the inbox — transient blips heal inside the retry.
      const fetchNotifQuery = () => withTimeout(supabase
        .from('notifications')
        .select(`
          id, type, title, message, body, data, reference_id, is_read, created_at,
          actor:profiles!actor_id(id, first_name, last_name, avatar_url, role, business_name)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false }), 10000, 'notifications');
      const { data, error } = await withRetry(fetchNotifQuery, { attempts: 3, baseDelayMs: 600, label: 'notifications' });

      if (error) throw error;
      const notifs = data || [];
      // Beat 1: rows (with actor avatars) paint immediately; the property
      // thumbnails fill in from the second wave below.
      setNotifications(notifs);
      AsyncStorage.setItem(`cached_notifications_${userId}`, JSON.stringify(notifs)).catch(() => {});

      // Collect all property IDs mentioned across notifications to fetch their pictures
      const propIdSet = new Set();
      notifs.forEach(n => {
        if (n.data?.property_id) propIdSet.add(n.data.property_id);
        const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.default;
        if (config.isProperty && n.reference_id && typeof n.reference_id === 'string' && n.reference_id.length > 10) {
          propIdSet.add(n.reference_id);
        }
      });

      const propIds = Array.from(propIdSet);
      if (propIds.length > 0) {
        const { data: properties } = await withTimeout(supabase
          .from('properties')
          .select(`
            id,
            title,
            city,
            rent_usd,
            property_images(url, is_cover)
          `)
          .in('id', propIds), 8000, 'thumbs').catch(() => ({}));

        if (properties) {
          const map = {};
          properties.forEach(p => {
            const cover = (p.property_images || []).find(img => img.is_cover) || p.property_images?.[0];
            map[p.id] = {
              id: p.id,
              title: p.title,
              imageUrl: cover?.url || null,
              rentUsd: p.rent_usd,
              city: p.city
            };
          });
          setPropertyMap(map);
        }
      }
    } catch (e) {
      console.log('Error fetching notifications:', e.message);
      // Offline fallback: last cached list (only read when the DB fails).
      try {
        const cached = await AsyncStorage.getItem(`cached_notifications_${userId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) setNotifications(parsed);
        }
      } catch (_) {}
    }
  }

  async function handleNotificationPress(notification) {
    await markAsRead(notification.id);
    navigation.navigate('NotificationDetail', { notification });
  }

  async function markAsRead(id) {
    try {
      const user = await getSessionUser();
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('user_id', user?.id || '');

      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (error) {
      console.log('Error marking as read:', error.message);
    }
  }

  // Interactive Quick Actions
  async function handleMoverAccept(notification, accept) {
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
              const { error } = await supabase
                .from('mover_bookings')
                .update({ status: accept ? 'accepted' : 'declined' })
                .eq('id', notification.reference_id);

              if (error) throw error;
              Alert.alert(accept ? 'Job Accepted' : 'Request Declined', 'The customer will be notified.');
              markAsRead(notification.id);
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          }
        }
      ]
    );
  }

  async function handleApplicationModeration(notification, approve) {
    Alert.alert(
      approve ? 'Approve Application' : 'Reject Application',
      `Reviewing listing application...`,
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
                  decision_note: approve ? 'Welcome to your new home!' : 'Thank you for your interest. We went with another applicant.'
                })
                .eq('id', notification.reference_id);

              if (error) throw error;
              Alert.alert('Status Updated', 'Tenant has been notified.');
              markAsRead(notification.id);
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          }
        }
      ]
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const getTimeAgo = (dateString) => {
    if (!dateString) return 'just now';
    const now = new Date();
    const date = new Date(dateString);
    const diffInMs = now - date;
    const diffInMins = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMins < 1) return `just now`;
    if (diffInMins < 60) return `${diffInMins}m`;
    if (diffInHours < 24) return `${diffInHours}h`;
    if (diffInDays < 7) return `${diffInDays}d`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Helper to extract tagged property picture
  const getTaggedProperty = (notification) => {
    const propId = notification.data?.property_id || notification.reference_id;
    if (propId && propertyMap[propId]) {
      return propertyMap[propId];
    }
    if (notification.data?.image_url) {
      return { imageUrl: notification.data.image_url, title: notification.data.title || 'Property' };
    }
    return null;
  };

  const matchFilter = (n) => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'Unread') return !n.is_read;
    if (activeFilter === 'Messages') return MESSAGE_TYPES.has(n.type);
    if (activeFilter === 'Bookings') return BOOKING_TYPES.has(n.type);
    if (activeFilter === 'Listings') return LISTING_TYPES.has(n.type);
    return true;
  };

  const filtered = notifications.filter(matchFilter);
  const newItems = filtered.filter((n) => !n.is_read);
  const earlierItems = filtered.filter((n) => n.is_read);

  const renderRow = (n) => {
    const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.default;
    const taggedProperty = getTaggedProperty(n);
    const actor = n.actor;
    const actorName = actor
      ? (actor.business_name || `${actor.first_name || ''} ${actor.last_name || ''}`.trim())
      : (n.title || config.title);
    const isMessage = MESSAGE_TYPES.has(n.type);
    const hasAvatarImage = actor?.avatar_url && !failedAvatarIds[n.id];

    return (
      <TouchableOpacity
        key={n.id}
        style={[styles.row, !n.is_read && styles.rowUnread]}
        onPress={() => handleNotificationPress(n)}
        activeOpacity={0.65}
      >
        {/* Left: actor avatar + message badge, or neutral type tile */}
        <View style={styles.avatarOuter}>
          <View style={styles.avatarWrap}>
            {hasAvatarImage ? (
              <Image
                source={{ uri: toPublicImageUrl(actor.avatar_url) }}
                style={styles.avatarImg}
                onError={() => setFailedAvatarIds(previous => ({ ...previous, [n.id]: true }))}
              />
            ) : (
              <View style={styles.avatarTile}>
                <Ionicons name={isMessage ? 'chatbubble-ellipses' : (config.icon || 'notifications')} size={20} color={t.text} />
              </View>
            )}
          </View>
          {/* Badge only over real avatars — the tile fallback already
              shows a chat icon, so a badge there would duplicate it. */}
          {isMessage && hasAvatarImage && (
            <View style={styles.msgBadge}>
              <Ionicons name="chatbubble-ellipses" size={11} color={t.bg} />
            </View>
          )}
        </View>

        {/* Center: bold name + gray time on one line, gray subtitle below */}
        <View style={styles.rowMain}>
          <Text style={styles.actorLine} numberOfLines={1}>
            <Text style={styles.actorName}>{actorName}</Text>
            <Text style={styles.timeInline}>  {getTimeAgo(n.created_at)}</Text>
          </Text>
          <Text style={styles.msgText} numberOfLines={2}>
            {n.message || n.body || ''}
          </Text>
          {renderActionButtons(n)}
        </View>

        {/* Right: property thumbnail (like a Threads post thumbnail) or unread dot */}
        {taggedProperty?.imageUrl ? (
          <Image
            source={{ uri: taggedProperty.imageUrl }}
            style={styles.thumb}
          />
        ) : !n.is_read ? (
          <View style={styles.unreadDot} />
        ) : null}
      </TouchableOpacity>
    );
  };

  const renderActionButtons = (item) => {
    if (item.is_read) return null;
    const stop = (e) => { try { e.stopPropagation(); } catch (_) {} };

    switch (item.type) {
      case 'new_move_request':
        return (
          <View style={styles.actionRow}>
            <ThreadsButton
              title="Accept Job"
              variant="primary"
              size="sm"
              onPress={(e) => { stop(e); handleMoverAccept(item, true); }}
              style={styles.actionFlex}
            />
            <ThreadsButton
              title="Decline"
              variant="muted"
              size="sm"
              onPress={(e) => { stop(e); handleMoverAccept(item, false); }}
              style={styles.actionFlex}
            />
          </View>
        );

      case 'application_received':
        return (
          <View style={styles.actionRow}>
            <ThreadsButton
              title="Approve"
              variant="primary"
              size="sm"
              onPress={(e) => { stop(e); handleApplicationModeration(item, true); }}
              style={styles.actionFlex}
            />
            <ThreadsButton
              title="Decline"
              variant="muted"
              size="sm"
              onPress={(e) => { stop(e); handleApplicationModeration(item, false); }}
              style={styles.actionFlex}
            />
          </View>
        );

      case 'price_drop':
      case 'property_match':
        return (
          <View style={styles.actionRow}>
            <ThreadsButton
              title="View Listing"
              variant="outline"
              size="sm"
              onPress={(e) => { stop(e); handleNotificationPress(item); }}
              style={styles.actionFlex}
            />
          </View>
        );

      case 'message':
      case 'landlord_message':
        return (
          <View style={styles.actionRow}>
            <ThreadsButton
              title="Reply"
              variant="outline"
              size="sm"
              icon="chatbubble-ellipses"
              onPress={(e) => { stop(e); handleNotificationPress(item); }}
              style={styles.actionFlex}
            />
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* Threads-style header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Activity</Text>
      </View>

      {/* Threads-style filter pills */}
      <View style={styles.filterContainer}>
        <FlatList
          data={FILTERS}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={f => f}
          contentContainerStyle={styles.filterList}
          renderItem={({ item: f }) => (
            <TouchableOpacity
              style={[styles.pill, activeFilter === f && styles.pillActive]}
              onPress={() => {
                try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
                setActiveFilter(f);
              }}
              activeOpacity={0.65}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Text style={[styles.pillText, activeFilter === f && styles.pillTextActive]}>{f}</Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Main Feed */}
      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text} colors={[t.text]} progressBackgroundColor={t.card} />}
        showsVerticalScrollIndicator={false}
        onScroll={onFeedScroll}
        scrollEventThrottle={16}
      >
        {loading ? (
          <View>
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <ActivityIndicator size="small" color={t.text} />
            </View>
            {[0, 1, 2, 3, 4].map((i) => (
              <NotificationRowSkeleton key={`skel-${i}`} />
            ))}
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="notifications" size={40} color={t.sub} />
            </View>
            <Text style={styles.emptyTitle}>
              {activeFilter === 'All' ? "You're all caught up!" : `No ${activeFilter.toLowerCase()} activity`}
            </Text>
            <Text style={styles.emptySubtitle}>
              New notifications about your listings, movers, applications, and saved properties will appear here.
            </Text>
          </View>
        ) : (
          <View>
            {newItems.length > 0 && (
              <Text style={styles.sectionHeader}>New</Text>
            )}
            {newItems.slice(0, 20).map(renderRow)}
            {([...newItems, ...earlierItems].slice(0, 20 - newItems.slice(0, 20).length).map(renderRow))}
{showLoadMore && (
  <View style={{padding: 16, textAlign: "center"}}>
    <Ionicons name="arrow-down-circle" size={28} color={t.sub} />
    <Text style={{fontSize: 14, marginTop: 8, color: t.sub, fontFamily: SYS_MED}}>Load More</Text>
</View>)
}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 44,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 32,
    fontFamily: SYS_MED,
    fontWeight: '700',
    color: t.text,
  },

  filterContainer: {
    paddingBottom: 4,
  },
  filterList: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: t.hairline,
  },
  pillActive: {
    backgroundColor: t.text,
    borderColor: t.text,
  },
  pillText: {
    fontSize: 15,
    fontFamily: SYS,
    color: t.text,
  },
  pillTextActive: {
    color: t.bg,
    fontFamily: SYS_MED,
  },

  list: { paddingBottom: 120 },

  sectionHeader: {
    fontSize: 17,
    fontFamily: SYS_MED,
    fontWeight: '700',
    color: t.text,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 4,
  },

  // Threads activity row
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    gap: 12,
    backgroundColor: t.card,
  },
  rowUnread: {
    backgroundColor: t.card,
  },
  avatarOuter: {
    position: 'relative',
    width: 44,
    height: 44,
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: t.tile,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarTile: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Message-type badge: small chat icon pinned to avatar corner (Threads DM feel)
  msgBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: t.text,
    borderWidth: 2,
    borderColor: t.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowMain: { flex: 1, minWidth: 0 },
  actorLine: { fontSize: 16 },
  actorName: {
    fontSize: 16,
    fontFamily: SYS_MED,
    fontWeight: '700',
    color: t.text,
  },
  msgText: {
    fontSize: 15,
    fontFamily: SYS,
    color: t.sub,
    lineHeight: 21,
    marginTop: 1,
  },
  timeInline: {
    fontSize: 14,
    fontFamily: SYS,
    color: t.sub,
  },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: t.tile,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.text,
    marginTop: 6,
  },

  // Inline quick actions — standard Threads buttons
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionFlex: {
    flex: 1,
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: SYS_MED,
    color: t.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 15,
    fontFamily: SYS,
    color: t.sub,
    textAlign: 'center',
    lineHeight: 22,
  },
});
