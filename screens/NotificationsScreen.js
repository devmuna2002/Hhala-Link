import React, { useState, useCallback } from 'react';
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
  Alert 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { NotificationService } from '../services/NotificationService';
import { useFocusEffect } from '@react-navigation/native';

export const TYPE_CONFIG = {
  // Tenant Alerts
  'price_drop': { icon: 'pricetag', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Price Drop', role: 'tenant', isProperty: true },
  'property_match': { icon: 'home', color: '#0A84FF', badgeBg: '#0A84FF', title: 'New Match', role: 'tenant', isProperty: true },
  'application_approved': { icon: 'checkmark-circle', color: '#34C759', badgeBg: '#34C759', title: 'Application Approved', role: 'tenant', isProperty: true },
  'application_rejected': { icon: 'close-circle', color: '#FF3B30', badgeBg: '#FF3B30', title: 'Application Update', role: 'tenant', isProperty: true },
  'viewing_reminder': { icon: 'calendar', color: '#5856D6', badgeBg: '#5856D6', title: 'Viewing Appointment', role: 'tenant', isProperty: true },
  'landlord_message': { icon: 'chatbubbles', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Message from Agent', role: 'tenant', isProperty: false },

  // Landlord / Agent Alerts
  'application_received': { icon: 'document-text', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Application Received', role: 'landlord', isProperty: true },
  'property_analytics': { icon: 'trending-up', color: '#AF52DE', badgeBg: '#AF52DE', title: 'Listing Update', role: 'landlord', isProperty: true },
  'listing_approved': { icon: 'checkmark-done', color: '#34C759', badgeBg: '#34C759', title: 'Listing Approved', role: 'landlord', isProperty: true },
  'listing_expired': { icon: 'alert-circle', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Listing Expiring', role: 'landlord', isProperty: true },
  'tenant_verification': { icon: 'shield-checkmark', color: '#34C759', badgeBg: '#34C759', title: 'Tenant Verified', role: 'landlord', isProperty: false },

  // Movers / Freight Alerts
  'new_move_request': { icon: 'cube', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Move Request', role: 'mover', isProperty: false },
  'booking_confirmed': { icon: 'checkbox', color: '#34C759', badgeBg: '#34C759', title: 'Booking Confirmed', role: 'mover', isProperty: false },
  'pickup_reminder': { icon: 'alarm', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Pickup Scheduled', role: 'mover', isProperty: false },
  'route_update': { icon: 'navigate', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Route Update', role: 'mover', isProperty: false },
  'delivery_complete': { icon: 'checkmark-done-circle', color: '#34C759', badgeBg: '#34C759', title: 'Delivery Complete', role: 'mover', isProperty: false },
  'mover_payment_received': { icon: 'cash', color: '#34C759', badgeBg: '#34C759', title: 'Payment Received', role: 'mover', isProperty: false },

  // Admin Alerts
  'new_user_registration': { icon: 'person-add', color: '#8E8E93', badgeBg: '#8E8E93', title: 'New Registration', role: 'admin', isProperty: false },
  'listing_moderation': { icon: 'eye', color: '#0A84FF', badgeBg: '#0A84FF', title: 'Moderation Alert', role: 'admin', isProperty: true },
  'user_report': { icon: 'warning', color: '#FF3B30', badgeBg: '#FF3B30', title: 'User Report', role: 'admin', isProperty: false },
  'fraud_alert': { icon: 'shield-alert', color: '#FF3B30', badgeBg: '#FF3B30', title: 'Fraud Alert', role: 'admin', isProperty: false },

  // Defaults
  'new_listing': { icon: 'business', color: '#0A84FF', badgeBg: '#0A84FF', title: 'New Property', role: 'tenant', isProperty: true },
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

export default function NotificationsScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [propertyMap, setPropertyMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState(null);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [])
  );

  const fetchData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);
      await fetchNotifications(user.id);
    } catch (e) {
      console.log('Error during notification init:', e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  async function fetchNotifications(userId) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select(`
          *,
          actor:profiles!actor_id(id, first_name, last_name, avatar_url, role, business_name)
        `)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const notifs = data || [];
      setNotifications(notifs);

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
        const { data: properties } = await supabase
          .from('properties')
          .select(`
            id,
            title,
            city,
            rent_usd,
            property_images(url, is_cover)
          `)
          .in('id', propIds);

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
    }
  }

  async function handleNotificationPress(notification) {
    await markAsRead(notification.id);
    navigation.navigate('NotificationDetail', { notification });
  }

  async function markAsRead(id) {
    try {
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id);
      
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (error) {
      console.log('Error marking as read:', error.message);
    }
  }

  // Interactive Quick Actions (FB style)
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

  const renderActionButtons = (item) => {
    if (item.is_read) return null;

    switch (item.type) {
      case 'new_move_request':
        return (
          <View style={styles.fbActionRow}>
            <TouchableOpacity 
              style={[styles.fbActionBtn, styles.fbPrimaryBtn]} 
              onPress={() => handleMoverAccept(item, true)}
            >
              <Text style={styles.fbPrimaryBtnText}>Accept Job</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.fbActionBtn, styles.fbSecondaryBtn]} 
              onPress={() => handleMoverAccept(item, false)}
            >
              <Text style={styles.fbSecondaryBtnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        );

      case 'application_received':
        return (
          <View style={styles.fbActionRow}>
            <TouchableOpacity 
              style={[styles.fbActionBtn, styles.fbPrimaryBtn]} 
              onPress={() => handleApplicationModeration(item, true)}
            >
              <Text style={styles.fbPrimaryBtnText}>Approve</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.fbActionBtn, styles.fbSecondaryBtn]} 
              onPress={() => handleApplicationModeration(item, false)}
            >
              <Text style={styles.fbSecondaryBtnText}>Decline</Text>
            </TouchableOpacity>
          </View>
        );

      case 'price_drop':
      case 'property_match':
        return (
          <View style={styles.fbActionRow}>
            <TouchableOpacity 
              style={[styles.fbActionBtn, styles.fbPrimaryBtn]} 
              onPress={() => handleNotificationPress(item)}
            >
              <Ionicons name="eye-outline" size={14} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={styles.fbPrimaryBtnText}>View Listing</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <View style={styles.container}>
      {/* Facebook Style Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#1C1E21" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={styles.unreadCountBadge}>
              <Text style={styles.unreadCountText}>{unreadCount}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Main Feed */}
      <ScrollView 
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0A84FF" />}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 50 }} />
        ) : notifications.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="notifications-outline" size={48} color="#8E8E93" />
            </View>
            <Text style={styles.emptyTitle}>You're all caught up!</Text>
            <Text style={styles.emptySubtitle}>
              New notifications about your listings, movers, applications, and saved properties will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.notificationsList}>
            {notifications.map((n) => {
              const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.default;
              const categoryInfo = CATEGORY_LABELS[config.role] || { label: config.role, color: '#0A84FF', bg: '#EBF4FF' };
              const taggedProperty = getTaggedProperty(n);
              const actor = n.actor;
              const actorName = actor ? (actor.business_name || `${actor.first_name || ''} ${actor.last_name || ''}`.trim()) : null;

              return (
                <TouchableOpacity 
                  key={n.id} 
                  style={[
                    styles.fbCard, 
                    !n.is_read && styles.fbCardUnread
                  ]}
                  onPress={() => handleNotificationPress(n)}
                  activeOpacity={0.85}
                >
                  {/* Left: Avatar with Overlaid Action Badge (Facebook Style) */}
                  <View style={styles.avatarWrapper}>
                    {actor?.avatar_url ? (
                      <Image source={{ uri: actor.avatar_url }} style={styles.fbAvatar} />
                    ) : (
                      <View style={[styles.fbAvatarPlaceholder, { backgroundColor: config.color + '20' }]}>
                        <Ionicons name={config.icon} size={22} color={config.color} />
                      </View>
                    )}

                    {/* Bottom-Right Overlay Badge */}
                    <View style={[styles.fbBadgeOverlay, { backgroundColor: config.badgeBg }]}>
                      <Ionicons name={config.icon} size={11} color="#FFFFFF" />
                    </View>
                  </View>

                  {/* Center: Notification Text Content */}
                  <View style={styles.fbContentWrapper}>
                    <Text style={styles.fbTextBody}>
                      {actorName ? (
                        <Text style={styles.fbActorName}>{actorName} </Text>
                      ) : n.title ? (
                        <Text style={styles.fbActorName}>{n.title}: </Text>
                      ) : null}
                      <Text style={!n.is_read ? styles.fbBodyUnread : styles.fbBodyRead}>
                        {n.message || n.body || ''}
                      </Text>
                    </Text>

                    {/* Time & Category Tag */}
                    <View style={styles.fbMetaRow}>
                      <Text style={[styles.fbTimeText, !n.is_read && { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' }]}>
                        {getTimeAgo(n.created_at)}
                      </Text>
                      <View style={[styles.fbCategoryPill, { backgroundColor: categoryInfo.bg }]}>
                        <Text style={[styles.fbCategoryText, { color: categoryInfo.color }]}>
                          {categoryInfo.label}
                        </Text>
                      </View>
                    </View>

                    {/* Action buttons (Accept/Decline/View) */}
                    {renderActionButtons(n)}
                  </View>

                  {/* Right: Tagged Apartment / Marketplace Property Picture */}
                  {taggedProperty?.imageUrl ? (
                    <View style={styles.propertyThumbWrapper}>
                      <Image 
                        source={{ uri: taggedProperty.imageUrl }} 
                        style={styles.propertyThumb} 
                        resizeMode="cover"
                      />
                      {!n.is_read && <View style={styles.fbUnreadDot} />}
                    </View>
                  ) : !n.is_read ? (
                    <View style={styles.fbUnreadDotAlone} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  
  // Header
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
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { 
    fontFamily: 'Poppins_700Bold', 
    fontSize: 22, 
    color: '#050505',
    letterSpacing: -0.3
  },
  unreadCountBadge: {
    backgroundColor: '#E7F3FF',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  unreadCountText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 12,
    color: '#0A84FF',
  },

  list: { paddingBottom: 100 },
  notificationsList: { backgroundColor: '#FFFFFF' },

  // Facebook Notification Card
  fbCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
  },
  fbCardUnread: {
    backgroundColor: '#EBF5FF', // Classic Facebook light blue unread tint
  },

  // Left Avatar + Overlaid Badge
  avatarWrapper: {
    position: 'relative',
    marginRight: 12,
    marginTop: 2,
  },
  fbAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#E4E6EB',
  },
  fbAvatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fbBadgeOverlay: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  // Center Content
  fbContentWrapper: {
    flex: 1,
    marginRight: 10,
  },
  fbTextBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#050505',
    marginBottom: 4,
  },
  fbActorName: {
    fontFamily: 'Poppins_700Bold',
    color: '#050505',
  },
  fbBodyRead: {
    fontFamily: 'Poppins_400Regular',
    color: '#65676B',
  },
  fbBodyUnread: {
    fontFamily: 'Poppins_500Medium',
    color: '#050505',
  },

  // Meta (Time + Category)
  fbMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  fbTimeText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    color: '#65676B',
  },
  fbCategoryPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  fbCategoryText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.2,
  },

  // Tagged Marketplace Apartment Picture (Right)
  propertyThumbWrapper: {
    position: 'relative',
    marginLeft: 4,
    marginTop: 2,
  },
  propertyThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#F0F2F5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCD0D5',
  },
  fbUnreadDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0A84FF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  fbUnreadDotAlone: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0A84FF',
    alignSelf: 'center',
    marginLeft: 6,
  },

  // Action Buttons
  fbActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  fbActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 6,
  },
  fbPrimaryBtn: {
    backgroundColor: '#0A84FF',
  },
  fbPrimaryBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  fbSecondaryBtn: {
    backgroundColor: '#E4E6EB',
  },
  fbSecondaryBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#050505',
  },

  // Empty State
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#F0F2F5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
    color: '#050505',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#65676B',
    textAlign: 'center',
    lineHeight: 19,
  },
});
