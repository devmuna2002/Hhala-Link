import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, Platform, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, RefreshControl
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { updateBookingStatus, acceptBooking } from '../services/MoversService';

const STATUS_COLORS = {
  pending:     { bg: '#EAF3FF', text: '#856404' },
  accepted:    { bg: '#D1FAE5', text: '#065F46' },
  in_progress: { bg: '#DBEAFE', text: '#1E40AF' },
  completed:   { bg: '#E8F5E9', text: '#1B5E20' },
  cancelled:   { bg: '#DCEBFF', text: '#991B1B' },
  declined:    { bg: '#F3F4F6', text: '#6B7280' },
};

const STATUS_LABELS = {
  pending:     'Pending',
  accepted:    'Accepted',
  in_progress: 'In Progress',
  completed:   'Completed',
  cancelled:   'Cancelled',
  declined:    'Declined',
};

export default function MyMoverBookingsScreen({ navigation }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userId, setUserId] = useState(null);
  const [userRole, setUserRole] = useState('tenant');
  const [activeTab, setActiveTab] = useState('all');

  useFocusEffect(
    useCallback(() => {
      loadBookings();
    }, [])
  );

  const loadBookings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      const role = profile?.role || 'tenant';
      setUserRole(role);

      let query = supabase
        .from('mover_bookings')
        .select(`
          id, status, created_at, job_details,
          mover:movers!mover_id(id, company_name, city, base_price_usd, avatar_url),
          client:profiles!client_id(id, first_name, last_name, avatar_url)
        `)
        .order('created_at', { ascending: false });

      if (role === 'mover') {
        query = query.eq('mover_id', user.id);
      } else {
        query = query.eq('client_id', user.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setBookings(data || []);
    } catch (e) {
      console.log('MyMoverBookings loadBookings error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); loadBookings(); };

  const handleAction = async (booking, action) => {
    const confirmMessages = {
      accepted:    'Accept this booking request?',
      declined:    'Decline this booking?',
      in_progress: 'Mark this move as In Progress?',
      completed:   'Mark this move as Completed?',
      cancelled:   'Cancel this booking?',
    };

    Alert.alert('Confirm', confirmMessages[action] || 'Are you sure?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes', onPress: async () => {
          try {
            let res;
            if (action === 'accepted') {
              res = await acceptBooking(booking.id, userId);
            } else {
              res = await updateBookingStatus(booking.id, action);
            }
            if (res.error) {
              Alert.alert('Error', res.error.message || 'Could not update booking.');
            } else {
              loadBookings();
            }
          } catch (e) {
            Alert.alert('Error', 'Something went wrong.');
          }
        }
      }
    ]);
  };

  const getActionsForBooking = (booking) => {
    const { status } = booking;
    if (userRole === 'mover') {
      if (status === 'pending') return [
        { label: 'Accept', action: 'accepted', color: '#30D158' },
        { label: 'Decline', action: 'declined', color: '#FF3B30' },
      ];
      if (status === 'accepted') return [
        { label: 'Start Move', action: 'in_progress', color: '#0A84FF' },
      ];
      if (status === 'in_progress') return [
        { label: 'Mark Complete', action: 'completed', color: '#30D158' },
      ];
    } else {
      if (status === 'pending' || status === 'accepted') return [
        { label: 'Cancel', action: 'cancelled', color: '#FF3B30' },
      ];
      if (status === 'completed' && !booking.reviewed) return [
        { label: 'Leave Review', action: '_review', color: '#FFB800' },
      ];
    }
    return [];
  };

  const filtered = activeTab === 'all'
    ? bookings
    : bookings.filter(b => b.status === activeTab);

  const renderBooking = ({ item }) => {
    const statusColor = STATUS_COLORS[item.status] || STATUS_COLORS.pending;
    const jd = item.job_details || {};
    const actions = getActionsForBooking(item);
    const otherParty = userRole === 'mover' ? item.client : item.mover;

    return (
      <View style={styles.card}>
        {/* Card header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="cube" size={20} color="#0A84FF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {userRole === 'mover'
                ? `${otherParty?.first_name || ''} ${otherParty?.last_name || ''}`.trim() || 'Client'
                : otherParty?.company_name || 'Mover'}
            </Text>
            <Text style={styles.cardDate}>
              {new Date(item.created_at).toLocaleDateString('en-ZW', {
                day: 'numeric', month: 'short', year: 'numeric'
              })}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
            <Text style={[styles.statusText, { color: statusColor.text }]}>
              {STATUS_LABELS[item.status] || item.status}
            </Text>
          </View>
        </View>

        {/* Route */}
        <View style={styles.routeRow}>
          <View style={styles.routeDot} />
          <Text style={styles.routeText} numberOfLines={1}>{jd.pickup_address || '—'}</Text>
        </View>
        <View style={[styles.routeRow, { marginTop: 4 }]}>
          <View style={[styles.routeDot, { backgroundColor: '#FF3B30' }]} />
          <Text style={styles.routeText} numberOfLines={1}>{jd.drop_address || '—'}</Text>
        </View>

        {/* Details row */}
        <View style={styles.detailsRow}>
          {jd.moving_date && (
            <View style={styles.detailItem}>
              <Ionicons name="calendar-outline" size={13} color="#8E8E93" />
              <Text style={styles.detailText}>{jd.moving_date}</Text>
            </View>
          )}
          {jd.estimated_price && (
            <View style={styles.detailItem}>
              <Ionicons name="cash-outline" size={13} color="#8E8E93" />
              <Text style={styles.detailText}>${jd.estimated_price}</Text>
            </View>
          )}
          {jd.need_packing && (
            <View style={styles.detailItem}>
              <Ionicons name="archive-outline" size={13} color="#8E8E93" />
              <Text style={styles.detailText}>Packing</Text>
            </View>
          )}
          {jd.need_insurance && (
            <View style={styles.detailItem}>
              <Ionicons name="shield-checkmark-outline" size={13} color="#8E8E93" />
              <Text style={styles.detailText}>Insured</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        {actions.length > 0 && (
          <View style={styles.actionsRow}>
            {actions.map(a => (
              <TouchableOpacity
                key={a.action}
                style={[styles.actionBtn, { borderColor: a.color }]}
                activeOpacity={0.8}
                onPress={() => {
                  if (a.action === '_review') {
                    navigation.navigate('MoverReview', { booking: item });
                  } else {
                    handleAction(item, a.action);
                  }
                }}
              >
                <Text style={[styles.actionBtnText, { color: a.color }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.chatBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('UserList')}
            >
              <Ionicons name="chatbubble-outline" size={14} color="#0A84FF" />
              <Text style={styles.chatBtnText}>Chat</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const tabs = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'accepted', label: 'Accepted' },
    { key: 'in_progress', label: 'Active' },
    { key: 'completed', label: 'Done' },
  ];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {userRole === 'mover' ? 'My Jobs' : 'My Bookings'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tab filter */}
      <FlatList
        horizontal
        data={tabs}
        keyExtractor={t => t.key}
        showsHorizontalScrollIndicator={false}
        style={styles.tabsRow}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
        renderItem={({ item: tab }) => (
          <TouchableOpacity
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* List */}
      {loading ? (
        <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderBooking}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0A84FF" />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="cube-outline" size={60} color="#D1D1D6" />
              <Text style={styles.emptyTitle}>No bookings yet</Text>
              <Text style={styles.emptySubtitle}>
                {userRole === 'mover'
                  ? 'Booking requests from clients will appear here.'
                  : 'Browse movers and send your first booking request.'}
              </Text>
              {userRole !== 'mover' && (
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => navigation.goBack()}
                >
                  <Text style={styles.emptyBtnText}>Browse Movers</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#000' },

  tabsRow: { flexGrow: 0, paddingVertical: 14 },
  tab: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20,
    backgroundColor: '#F2F2F7', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
  },
  tabActive: { backgroundColor: '#0A84FF', borderColor: '#0A84FF' },
  tabText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#3C3C43' },
  tabTextActive: { color: '#FFF' },

  list: { paddingHorizontal: 20, paddingBottom: 140, gap: 14 },

  card: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
    padding: 16, backgroundColor: '#FFF',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardIcon: {
    width: 42, height: 42, borderRadius: 12,
    backgroundColor: '#EBF4FF', justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  cardTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000' },
  cardDate: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93', marginTop: 2 },
  statusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontFamily: 'Poppins_600SemiBold', fontSize: 11 },

  routeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  routeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#30D158', marginRight: 10 },
  routeText: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#3C3C43', flex: 1 },

  detailsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12, marginBottom: 4 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailText: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  actionBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5,
  },
  actionBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13 },
  chatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: '#0A84FF',
  },
  chatBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#0A84FF' },

  emptyWrap: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 20, color: '#000', marginTop: 16 },
  emptySubtitle: {
    fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93',
    marginTop: 6, textAlign: 'center', lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 20, backgroundColor: '#0A84FF',
    paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12,
  },
  emptyBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#FFF' },
});
