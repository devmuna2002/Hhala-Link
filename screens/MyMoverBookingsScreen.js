import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Platform, TouchableOpacity, FlatList,
  ActivityIndicator, Alert, RefreshControl
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getSessionUser } from '../supabase';
import { updateBookingStatus, acceptBooking } from '../services/MoversService';
import { useTheme } from '../utils/theme';

// Threads-style: plain dot + label, no colored badge pills.
const STATUS_COLORS = {
  pending:     '#FFB800',
  accepted:    '#22C55E',
  in_progress: '#0A84FF',
  completed:   '#22C55E',
  cancelled:   '#FF3B30',
  declined:    '#8A8A8A',
};

const STATUS_LABELS = {
  pending:     'Pending',
  accepted:    'Accepted',
  in_progress: 'In Progress',
  completed:   'Completed',
  cancelled:   'Cancelled',
  declined:    'Declined',
};

// Threads-style system type (no Poppins on this screen)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

export default function MyMoverBookingsScreen({ navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
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
      const user = await getSessionUser();
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

  // primary = filled black button, secondary = gray fill, danger = text-only red
  const getActionsForBooking = (booking) => {
    const { status } = booking;
    if (userRole === 'mover') {
      if (status === 'pending') return [
        { label: 'Accept', action: 'accepted', kind: 'primary' },
        { label: 'Decline', action: 'declined', kind: 'secondary' },
      ];
      if (status === 'accepted') return [
        { label: 'Start Move', action: 'in_progress', kind: 'primary' },
      ];
      if (status === 'in_progress') return [
        { label: 'Mark Complete', action: 'completed', kind: 'primary' },
      ];
    } else {
      if (status === 'pending' || status === 'accepted') return [
        { label: 'Cancel', action: 'cancelled', kind: 'secondary' },
      ];
      if (status === 'completed' && !booking.reviewed) return [
        { label: 'Leave Review', action: '_review', kind: 'primary' },
      ];
    }
    return [];
  };

  const filtered = activeTab === 'all'
    ? bookings
    : bookings.filter(b => b.status === activeTab);

  const renderBooking = ({ item }) => {
    const dotColor = STATUS_COLORS[item.status] || STATUS_COLORS.pending;
    const jd = item.job_details || item;
    const actions = getActionsForBooking(item);
    const otherParty = userRole === 'mover' ? item.client : item.mover;
    const otherPartyName = userRole === 'mover'
      ? `${otherParty?.first_name || ''} ${otherParty?.last_name || ''}`.trim() || item.client_name || 'Client'
      : otherParty?.company_name || item.company_name || 'Mover';
    const pickupAddress = jd.pickup_address || item.pickup_address || '—';
    const dropAddress = jd.drop_address || jd.destination_address || item.drop_address || item.destination_address || '—';
    const movingDate = jd.moving_date || item.moving_date;
    const estimatedPrice = jd.estimated_price ?? item.estimated_price ?? item.final_price ?? item.bid_amount;

    return (
      <View style={styles.card}>
        {/* Card header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardIcon}>
            <Ionicons name="swap-horizontal" size={20} color={t.text} />
          </View>
          <View style={styles.cardIdentity}>
            <Text style={styles.cardTitle} numberOfLines={2}>{otherPartyName}</Text>
            <Text style={styles.cardDate}>
              {new Date(item.created_at).toLocaleDateString('en-ZW', {
                day: 'numeric', month: 'short', year: 'numeric'
              })}
            </Text>
          </View>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
            <Text style={styles.statusText}>
              {STATUS_LABELS[item.status] || item.status}
            </Text>
          </View>
        </View>

        {/* Route */}
        <View style={styles.routeRow}>
          <View style={styles.routeDot} />
          <View style={styles.routeInfo}>
            <Text style={styles.routeLabel}>PICKUP</Text>
            <Text style={styles.routeText} numberOfLines={2}>{pickupAddress}</Text>
          </View>
        </View>
        <View style={[styles.routeRow, { marginTop: 4 }]}>
          <View style={[styles.routeDot, { backgroundColor: '#FF3B30' }]} />
          <View style={styles.routeInfo}>
            <Text style={styles.routeLabel}>DROP-OFF</Text>
            <Text style={styles.routeText} numberOfLines={2}>{dropAddress}</Text>
          </View>
        </View>

        {/* Details row */}
        <View style={styles.detailsRow}>
          {movingDate && (
            <View style={styles.detailItem}>
              <Ionicons name="calendar" size={13} color="#8A8A8A" />
              <Text style={styles.detailText}>{new Date(`${movingDate}T00:00:00`).toLocaleDateString('en-ZW', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
            </View>
          )}
          {estimatedPrice != null && (
            <View style={styles.detailItem}>
              <Ionicons name="cash" size={13} color="#8A8A8A" />
              <Text style={styles.detailText}>${estimatedPrice}</Text>
            </View>
          )}
          {jd.need_packing && (
            <View style={styles.detailItem}>
              <Ionicons name="archive" size={13} color="#8A8A8A" />
              <Text style={styles.detailText}>Packing</Text>
            </View>
          )}
          {jd.need_insurance && (
            <View style={styles.detailItem}>
              <Ionicons name="shield-checkmark" size={13} color="#8A8A8A" />
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
                style={[styles.actionBtn, a.kind === 'primary' ? styles.actionPrimary : styles.actionSecondary]}
                activeOpacity={0.85}
                onPress={() => {
                  if (a.action === '_review') {
                    navigation.navigate('MoverReview', { booking: item });
                  } else {
                    handleAction(item, a.action);
                  }
                }}
              >
                <Text style={[styles.actionBtnText, a.kind === 'primary' ? styles.actionPrimaryText : styles.actionSecondaryText]}>{a.label}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.chatBtn}
              activeOpacity={0.7}
              onPress={() => navigation.navigate('UserList')}
            >
              <Ionicons name="chatbubble" size={14} color={t.text} />
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
      {/* Nav — plain chevron, no title bar */}
      <View style={styles.navBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="chevron-back" size={26} color={t.text} />
        </TouchableOpacity>
        <Text style={styles.navTitle}>
          {userRole === 'mover' ? 'My Jobs' : 'My Bookings'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Threads-style text tabs */}
      <View style={styles.tabsWrap}>
        <FlatList
          horizontal
          data={tabs}
          keyExtractor={t => t.key}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 18 }}
          renderItem={({ item: tab }) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                style={styles.tab}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8 }}
                onPress={() => setActiveTab(tab.key)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {tab.label}
                </Text>
                <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* List */}
      {loading ? (
          <ActivityIndicator size="large" color={t.text} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderBooking}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text} colors={['#0A84FF']} progressBackgroundColor={t.card} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="swap-horizontal" size={34} color="#8A8A8A" />
              </View>
              <Text style={styles.emptyTitle}>No bookings yet</Text>
              <Text style={styles.emptySubtitle}>
                {userRole === 'mover'
                  ? 'Booking requests from clients will appear here.'
                  : 'Browse movers and send your first booking request.'}
              </Text>
              {userRole !== 'mover' && (
                <TouchableOpacity
                  style={styles.emptyBtn}
                  activeOpacity={0.85}
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

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingHorizontal: 8, paddingBottom: 4,
  },
  backBtn: {
    width: 40, height: 40,
    justifyContent: 'center', alignItems: 'center',
  },
  navTitle: { fontFamily: SYS_MED, fontSize: 17, color: t.text },

  // Threads text tabs: gray idle / black + underline when active
  tabsWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
    marginTop: 6,
  },
  tab: { alignItems: 'center', paddingHorizontal: 4, paddingTop: 10, marginRight: 22 },
  tabText: { fontFamily: SYS, fontSize: 14, color: t.sub },
  tabTextActive: { fontFamily: SYS_MED, color: t.text },
  tabUnderline: { height: 2, borderRadius: 1, backgroundColor: 'transparent', alignSelf: 'stretch', marginTop: 8 },
  tabUnderlineActive: { backgroundColor: t.text },

  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 140, gap: 12 },

  card: {
    backgroundColor: t.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: t.hairline,
    shadowColor: '#000000',
    shadowOpacity: 0.03,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardIdentity: { flex: 1, minWidth: 0, marginRight: 8 },
  cardIcon: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  cardTitle: { fontFamily: SYS_MED, fontSize: 15, color: t.text },
  cardDate: { fontFamily: SYS, fontSize: 12, color: t.sub, marginTop: 2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 14, backgroundColor: t.tile },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontFamily: SYS_MED, fontSize: 12, color: t.text },

  routeRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  routeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E', marginRight: 10, marginTop: 6 },
  routeInfo: { flex: 1, minWidth: 0 },
  routeLabel: { fontFamily: SYS_MED, fontSize: 10, color: t.sub, marginBottom: 1 },
  routeText: { fontFamily: SYS, fontSize: 13, lineHeight: 18, color: t.text, flexShrink: 1 },

  detailsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12, marginBottom: 4 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  detailText: { fontFamily: SYS, fontSize: 12, color: t.sub },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  actionBtn: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
  },
  actionPrimary: { backgroundColor: t.text },
  actionSecondary: { backgroundColor: t.input },
  actionBtnText: { fontFamily: SYS_MED, fontSize: 13 },
  actionPrimaryText: { color: t.bg },
  actionSecondaryText: { color: t.text },
  chatBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 28,
    backgroundColor: t.input,
  },
  chatBtnText: { fontFamily: SYS_MED, fontSize: 13, color: t.text },

  emptyWrap: { alignItems: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyIconCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: t.tile,
    justifyContent: 'center', alignItems: 'center',
  },
  emptyTitle: { fontFamily: SYS_MED, fontSize: 18, color: t.text, marginTop: 16 },
  emptySubtitle: {
    fontFamily: SYS, fontSize: 14, color: t.sub,
    marginTop: 6, textAlign: 'center', lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 20, backgroundColor: t.text,
    paddingHorizontal: 24, paddingVertical: 13, borderRadius: 28,
  },
  emptyBtnText: { fontFamily: SYS_MED, fontSize: 14, color: t.bg },
});
