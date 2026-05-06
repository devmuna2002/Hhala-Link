import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

const TYPE_CONFIG = {
  'message': { icon: 'chatbubble', color: '#0A84FF', title: 'New Message' },
  'follow': { icon: 'person-add', color: '#AF52DE', title: 'New Follower' },
  'like': { icon: 'heart', color: '#FF2D55', title: 'Property Liked' },
  'new_listing': { icon: 'home', color: '#34C759', title: 'New Listing Alert' },
  'application_received': { icon: 'document-text', color: '#FFA500', title: 'Application Received' },
  'application_approved': { icon: 'checkmark-circle', color: '#34C759', title: 'Application Approved' },
  'application_rejected': { icon: 'close-circle', color: '#FF3B30', title: 'Application Rejected' },
  'booking_confirmed': { icon: 'calendar', color: '#5856D6', title: 'Booking Confirmed' },
  'review_received': { icon: 'star', color: '#FFCC00', title: 'New Review' },
  'property_view': { icon: 'eye', color: '#8E8E93', title: 'Property View' },
  'enquiry_received': { icon: 'help-circle', color: '#AF52DE', title: 'New Enquiry' },
  'default': { icon: 'notifications', color: '#0A84FF', title: 'Notification' }
};

export default function NotificationsScreen({ navigation }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, []);

  async function fetchNotifications() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotifications(data || []);
    } catch (error) {
      console.log('Error fetching notifications:', error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleNotificationPress(notification) {
    await markAsRead(notification.id);

    if (notification.type === 'message' && notification.reference_id) {
      navigation.navigate('ChatRoom', { 
        participantB: notification.actor_id,
        conversationId: notification.reference_id 
      });
    } else if (notification.type === 'new_listing' && notification.reference_id) {
      // Navigate to Detail with propertyId
      navigation.navigate('Detail', { propertyId: notification.reference_id });
    } else if (notification.type === 'like' && notification.reference_id) {
      navigation.navigate('Detail', { propertyId: notification.reference_id });
    } else if (notification.type === 'follow') {
      navigation.navigate('Chat');
    }
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

  const onRefresh = () => {
    setRefreshing(true);
    fetchNotifications();
  };

  const getTimeAgo = (dateString) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffInMs = now - date;
    const diffInMins = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInMins < 60) return `${diffInMins}m ago`;
    if (diffInHours < 24) return `${diffInHours}h ago`;
    return `${diffInDays}d ago`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <TouchableOpacity onPress={fetchNotifications}>
          <Ionicons name="reload" size={20} color="#0A84FF" />
        </TouchableOpacity>
      </View>

      <ScrollView 
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} color="#0A84FF" />}
      >
        {loading ? (
          <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 40 }} />
        ) : notifications.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={60} color="#D1D1D6" />
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptySubtitle}>You have no new notifications at the moment.</Text>
          </View>
        ) : (
          notifications.map(n => {
            const config = TYPE_CONFIG[n.type] || TYPE_CONFIG['default'];
            return (
              <TouchableOpacity 
                key={n.id} 
                style={[styles.notificationCard, !n.is_read && styles.unreadCard]}
                onPress={() => handleNotificationPress(n)}
              >
                <View style={styles.iconContainer}>
                  <View style={styles.iconBox}>
                    <Image source={require('../assets/notification-icon.png')} style={styles.logoIcon} />
                  </View>
                  <View style={[styles.typeIconOverlay, { backgroundColor: config.color }]}>
                    <Ionicons name={config.icon} size={10} color="#FFF" />
                  </View>
                </View>
                <View style={styles.textContainer}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.title, !n.is_read && { color: config.color }]}>{n.title || config.title}</Text>
                    {!n.is_read && <View style={[styles.unreadDot, { backgroundColor: config.color }]} />}
                  </View>
                  <Text style={styles.desc} numberOfLines={2}>{n.message}</Text>
                  <Text style={[styles.time, !n.is_read && { color: config.color }]}>{getTimeAgo(n.created_at)}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 100 : 70, paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#000' },
  list: { padding: 20 },
  notificationCard: { 
    flexDirection: 'row', 
    backgroundColor: '#FFF', 
    padding: 12, 
    borderRadius: 12, 
    marginBottom: 10, 
    alignItems: 'center'
  },
  unreadCard: { 
    backgroundColor: '#E8F5E9' // Light green for unread
  },
  iconContainer: {
    marginRight: 12,
    position: 'relative'
  },
  iconBox: { 
    width: 44, 
    height: 44, 
    borderRadius: 10, 
    overflow: 'hidden',
    backgroundColor: '#F8F9FE',
    justifyContent: 'center',
    alignItems: 'center'
  },
  typeIconOverlay: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF'
  },
  logoIcon: { 
    width: 32, 
    height: 32,
    resizeMode: 'contain'
  },
  textContainer: { flex: 1 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  title: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#000' },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50' }, // Green dot
  desc: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', lineHeight: 18 },
  time: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#4CAF50', marginTop: 4 }, // Green time text for unread vibe
  
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 20, color: '#000', marginTop: 16 },
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#8E8E93', marginTop: 8, textAlign: 'center', maxWidth: 250 },
});
