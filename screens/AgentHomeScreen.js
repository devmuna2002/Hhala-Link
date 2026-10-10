import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, ActivityIndicator, Image, Alert, Share } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getSessionUser } from '../supabase';
import { listingPricePrimary } from '../utils/formatPrice';
import { toPublicImageUrl } from '../utils/imageUrl';
import { useTheme } from '../utils/theme';
import { CardVideo } from '../components/ListingCard';
import { SkeletonBlock } from '../components/Skeleton';

const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?|$)/i;
const isVideoImage = (img) =>
  !!img?.url && (img.alt_text === 'video' || String(img.url).startsWith('data:video') || VIDEO_URL_REGEX.test(String(img.url)));

const STATUS_BADGES = {
  pending:   { label: 'Pending',  bg: 'transparent', color: '#B26A00' },
  rejected:  { label: 'Rejected', bg: 'transparent', color: '#FF3B30' },
  available: { label: 'Approved',     bg: 'transparent', color: '#1E8E4E' },
};

export default function AgentHomeScreen({ navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [loading, setLoading] = useState(true);
  const [myListings, setMyListings] = useState([]);
  const [recentMessages, setRecentMessages] = useState([]);
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [agentProfile, setAgentProfile] = useState(null);
  const [isPortfolioCollapsed, setIsPortfolioCollapsed] = useState(false);  const [userRole, setUserRole] = useState('agent');
  const [moverProfile, setMoverProfile] = useState(null);
  const [moverBookings, setMoverBookings] = useState([]);
  
  // Selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedListings, setSelectedListings] = useState([]);

  const loadAgentData = async () => {
    const user = await getSessionUser();
    if (!user) return;

    setLoading(true);
    // Instant paint from cache: listings show immediately (and stay
    // available offline), then live rows replace them below.
    try {
      const raw = await AsyncStorage.getItem(`cached_agent_home_${user.id}`);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && typeof c === 'object') {
          if (c.role) setUserRole(c.role);
          if (c.agentProfile) setAgentProfile(c.agentProfile);
          if (Array.isArray(c.myListings) && c.myListings.length) setMyListings(c.myListings);
          if (Array.isArray(c.moverBookings) && c.moverBookings.length) setMoverBookings(c.moverBookings);
          if (c.moverProfile) setMoverProfile(c.moverProfile);
          setLoading(false);
        }
      }
    } catch (_) {}

    try {
    
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    const role = profile?.role || user?.user_metadata?.role || 'agent';
    setUserRole(role);
    setAgentProfile(profile);

    const convsQuery = supabase.from('conversations')
      .select(`
        id, 
        last_message_at, 
        participant_a:profiles!participant_a(id, first_name, last_name, avatar_url), 
        participant_b:profiles!participant_b(id, first_name, last_name, avatar_url),
        messages(body, created_at)
      `)
      .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
      .order('last_message_at', { ascending: false })
      .limit(5);

    const processConvs = (convs) => {
      const seenUsers = new Set();
      const processedMsgs = [];
      (convs || []).forEach(c => {
        const otherUser = c.participant_a.id === user.id ? c.participant_b : c.participant_a;
        if (!seenUsers.has(otherUser.id)) {
          seenUsers.add(otherUser.id);
          const lastMsg = (c.messages || []).sort((a,b) => new Date(b.created_at) - new Date(a.created_at))[0];
          processedMsgs.push({ 
            id: c.id, 
            senderName: `${otherUser.first_name || ''} ${otherUser.last_name || ''}`.trim() || 'Tenant', 
            time: c.last_message_at,
            avatar: otherUser.avatar_url,
            preview: lastMsg ? lastMsg.body : 'Inquiry regarding your property...'
          });
        }
      });
      setRecentMessages(processedMsgs);
    };

    if (role === 'mover') {
      const [moverRes, bookingRes, convRes] = await Promise.all([
        supabase.from('movers').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('mover_bookings')
          .select('id, status, created_at, job_details, client:profiles!client_id(id, first_name, last_name, avatar_url)')
          .eq('mover_id', user.id)
          .order('created_at', { ascending: false })
          .limit(5),
        convsQuery
      ]);
      setMoverProfile(moverRes.data);
      setMoverBookings(bookingRes.data || []);
      processConvs(convRes.data);
      // Persist for instant + offline loads (best-effort: quota errors ignored).
      try {
        await AsyncStorage.setItem(`cached_agent_home_${user.id}`, JSON.stringify({
          role,
          agentProfile: profile || null,
          myListings: [],
          moverBookings: bookingRes.data || [],
          moverProfile: moverRes.data || null,
        }));
      } catch (_) {}
    } else {
      const [propRes, convRes] = await Promise.all([
        supabase.from('properties')
          .select('*, property_images(url, alt_text)')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false }),
        convsQuery
      ]);
      setMyListings(propRes.data || []);
      processConvs(convRes.data);
      // Persist for instant + offline loads (best-effort: quota errors ignored).
      try {
        await AsyncStorage.setItem(`cached_agent_home_${user.id}`, JSON.stringify({
          role,
          agentProfile: profile || null,
          myListings: propRes.data || [],
          moverBookings: [],
          moverProfile: null,
        }));
      } catch (_) {}
    }
  } finally {
      setLoading(false);
    }
  };

  const fetchUnreadMessages = async () => {
    const user = await getSessionUser();
    if (!user) return;
    
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('type', 'message')
      .eq('is_read', false);
      
    setUnreadMsgCount(count || 0);
  };

  const handleDelete = (id) => {
    Alert.alert('Delete Property', 'Are you sure you want to permanently delete this listing?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          setLoading(true);
          await supabase.from('properties').delete().eq('id', id);
          loadAgentData();
      }}
    ]);
  };

  const toggleSelection = (id) => {
    setSelectedListings(prev => 
      prev.includes(id) ? prev.filter(itemId => itemId !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedListings.length === myListings.length) {
      setSelectedListings([]);
    } else {
      setSelectedListings(myListings.map(item => item.id));
    }
  };

  const cancelSelection = () => {
    setIsSelectionMode(false);
    setSelectedListings([]);
  };

  const handleShareSelected = async () => {
    if (selectedListings.length === 0) return;
    try {
      const selectedProps = myListings.filter(p => selectedListings.includes(p.id));
      const shareLink = `https://hlalalink.com/agent/${agentProfile?.id || 'portfolio'}`;
      const message = `Check out these properties on Hlala Link:\n\n` +
                      selectedProps.map(p => `• *${p.title}* - ${listingPricePrimary(p)}`).join('\n') +
                      `\n\nView them all here:\n${shareLink}`;

      await Share.share({
        message: message,
        title: 'Selected Properties from Hlala Link',
      });
    } catch (error) {
      console.log('Share error:', error.message);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedListings.length === 0) return;
    Alert.alert('Delete Properties', `Are you sure you want to permanently delete ${selectedListings.length} listing(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
          setLoading(true);
          await supabase.from('properties').delete().in('id', selectedListings);
          setSelectedListings([]);
          setIsSelectionMode(false);
          loadAgentData();
      }}
    ]);
  };

  useEffect(() => {
    fetchUnreadMessages();

    // Realtime listener for messages/notifs
    const channelId = `agent_notifs_${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'notifications',
        filter: `type=eq.message`
      }, () => {
        fetchUnreadMessages();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAgentData();
      fetchUnreadMessages();
    }, [])
  );

  const vehicleDetails = agentProfile?.vehicle_details || {};
  const vehiclePhotos = agentProfile?.vehicle_photos || [];
  const moverName = moverProfile?.company_name
    || agentProfile?.business_name
    || `${agentProfile?.first_name || ''} ${agentProfile?.last_name || ''}`.trim()
    || 'Your Company';
  const moverAvatarUrl = moverProfile?.avatar_url || agentProfile?.avatar_url;
  const moverCity = moverProfile?.city || agentProfile?.city || null;
  const moverBasePrice = moverProfile?.base_price_usd != null ? `From $${moverProfile.base_price_usd}` : null;
  const vehicleLabel = [vehicleDetails.type, vehicleDetails.model].filter(Boolean).join(' • ') || 'Your vehicle';
  const vehicleRegLabel = vehicleDetails.registration ? `Reg: ${vehicleDetails.registration}` : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity onPress={() => { try { if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('Main'); } catch (_) {} }} style={styles.menuBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={26} color={t.text} />
          </TouchableOpacity>
          <View style={{ marginLeft: 15, flex: 1 }}>
            <Text style={styles.greeting} numberOfLines={1}>{userRole === 'mover' ? 'Mover Hub' : 'My Listings'}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{userRole === 'mover' ? 'Manage your transport' : 'Manage your properties'}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {userRole === 'mover' ? (
            <>
              <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('MyMoverBookings')}>
                <Ionicons name="swap-horizontal" size={24} color="#8A8A8A" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('UserList')}>
                <View style={{ position: 'relative' }}>
                  <Ionicons name="chatbubble-ellipses" size={26} color="#8A8A8A" />
                  {unreadMsgCount > 0 && <View style={styles.unreadBadge} />}
                </View>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('AddListing')}>
              <Ionicons name="add" size={28} color="#111111" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {userRole === 'mover' ? (
        <>
        {/* Quick Actions */}
        <View style={[styles.groupContainer, { marginTop: 8 }]}>
          <TouchableOpacity
            style={styles.quickRow}
            onPress={() => navigation.navigate('MyMoverBookings')}
            activeOpacity={0.7}
          >
            <View style={styles.quickIconBox}>
              <Ionicons name="swap-horizontal" size={18} color={t.sub} />
            </View>
            <Text style={styles.quickLabel}>My Moving Jobs</Text>
            <Ionicons name="chevron-forward" size={14} color={t.sub} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickRow, styles.quickRowBorder]}
            onPress={() => navigation.navigate('EditProfile')}
            activeOpacity={0.7}
          >
            <View style={styles.quickIconBox}>
              <Ionicons name="car-sport" size={18} color={t.sub} />
            </View>
            <Text style={styles.quickLabel}>Edit Transport Profile</Text>
            <Ionicons name="chevron-forward" size={14} color={t.sub} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickRow, styles.quickRowBorder]}
            onPress={() => navigation.navigate('UserList')}
            activeOpacity={0.7}
          >
            <View style={styles.quickIconBox}>
              <Ionicons name="mail" size={18} color={t.sub} />
            </View>
            <Text style={styles.quickLabel}>Messages</Text>
            {unreadMsgCount > 0 && (
              <View style={styles.quickBadge}>
                <Text style={styles.quickBadgeText}>{unreadMsgCount > 99 ? '99+' : unreadMsgCount}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={14} color={t.sub} style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        </View>

        {/* Profile header — Threads style */}
        <View style={styles.threadProfile}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text style={styles.threadName} numberOfLines={1}>{moverName}</Text>
            <Text style={styles.threadHandle} numberOfLines={1}>
              {[moverCity, moverBasePrice].filter(Boolean).join(' · ') || 'Transport services'}
            </Text>
            <View style={styles.moverVerifiedPill}>
              <Ionicons name="checkmark-circle" size={12} color="#1E8E4E" />
              <Text style={styles.moverVerifiedText}>VERIFIED MOVER</Text>
            </View>
          </View>
          <View style={styles.threadAvatar}>
            {moverAvatarUrl ? (
              <Image source={{ uri: moverAvatarUrl }} style={styles.menuAvatarImg} />
            ) : (
              <Ionicons name="swap-horizontal" size={26} color={t.sub} />
            )}
          </View>
        </View>

        {/* My Vehicle */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Vehicle</Text>
        </View>
        <View style={styles.groupContainer}>
          <View style={styles.quickRow}>
            <View style={styles.quickIconBox}>
              <Ionicons name="car-sport" size={18} color={t.sub} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickLabel}>{vehicleLabel}</Text>
              {!!vehicleRegLabel && <Text style={styles.quickSub}>{vehicleRegLabel}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={14} color={t.sub} />
          </View>
          {vehiclePhotos.length > 0 ? (
            <View style={styles.vehiclePhotoRow}>
              {vehiclePhotos.slice(0, 4).map((p, i) => (
                <Image key={i} source={{ uri: p }} style={styles.vehicleThumb} />
              ))}
              {vehiclePhotos.length > 4 && (
                <View style={[styles.vehicleThumb, styles.vehicleMore]}>
                  <Text style={styles.vehicleMoreText}>+{vehiclePhotos.length - 4}</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.vehicleEmpty}>
              <Text style={styles.vehicleEmptyText}>No vehicle photos added yet.</Text>
            </View>
          )}
        </View>

        {/* Recent Moves */}
        <View style={[styles.sectionHeader, { marginTop: 24 }]}>
          <Text style={styles.sectionTitle}>Recent Moves</Text>
          <TouchableOpacity onPress={() => navigation.navigate('MyMoverBookings')}><Text style={styles.seeAll}>View all</Text></TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={t.sub} style={{ marginVertical: 20 }} />
        ) : moverBookings.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="swap-horizontal" size={34} color={t.sub} style={{ marginBottom: 12, opacity: 0.35 }} />
            <Text style={styles.emptyText}>No moving jobs yet. Promote your transport profile to get bookings.</Text>
          </View>
        ) : (
          <View style={styles.groupContainer}>
            {moverBookings.map((b, index) => {
              const isLast = index === moverBookings.length - 1;
              const client = b.client || {};
              const clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client';
              const jd = b.job_details || {};
              return (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.msgCard, isLast && { borderBottomWidth: 0 }]}
                  onPress={() => navigation.navigate('MyMoverBookings')}
                  activeOpacity={0.8}
                >
                  {client.avatar_url ? (
                    <Image source={{ uri: client.avatar_url }} style={styles.msgAvatar} />
                  ) : (
                    <View style={[styles.msgAvatar, { backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center' }]}>
                      <Ionicons name="person" size={18} color={t.sub} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.msgName} numberOfLines={1}>{clientName}</Text>
                      <Text style={styles.msgTime}>{new Date(b.created_at).toLocaleDateString()}</Text>
                    </View>
                    <Text style={styles.msgPreview} numberOfLines={1}>{jd.from && jd.to ? `${jd.from} → ${jd.to}` : b.status}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={t.sub} style={{ marginLeft: 10 }} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        </>
        ) : (
        <>
        {/* Quick Actions — grouped like the Profile screen */}
        <View style={[styles.groupContainer, { marginTop: 20 }]}>
          <TouchableOpacity
            style={styles.quickRow}
            onPress={() => navigation.navigate('AddListing')}
            activeOpacity={0.7}
          >
            <View style={styles.quickIconBox}>
              <Ionicons name="add-circle" size={20} color="#8A8A8A" />
            </View>
            <Text style={styles.quickLabel}>Add New Listing</Text>
            <Ionicons name="chevron-forward" size={16} color="#8A8A8A" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickRow, styles.quickRowBorder]}
            onPress={() => navigation.navigate('UserList')}
            activeOpacity={0.7}
          >
            <View style={styles.quickIconBox}>
              <Ionicons name="mail" size={20} color="#8A8A8A" />
            </View>
            <Text style={styles.quickLabel}>Inbox</Text>
            {unreadMsgCount > 0 && (
              <View style={styles.quickBadge}>
                <Text style={styles.quickBadgeText}>{unreadMsgCount > 99 ? '99+' : unreadMsgCount}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color="#8A8A8A" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        </View>

        {/* My Listings */}
        <View style={styles.sectionHeader}>
          <TouchableOpacity
            style={styles.sectionHeaderBtn}
            onPress={() => setIsPortfolioCollapsed(!isPortfolioCollapsed)}
            activeOpacity={0.7}
          >
            <Text style={styles.sectionTitle}>
              My Listings · {myListings.length > 0 ? myListings.length : 'No listings yet'}
            </Text>
            <Ionicons
              name={isPortfolioCollapsed ? 'chevron-down' : 'chevron-up'}
              size={18}
              color={t.sub}
              style={{ marginLeft: 8 }}
            />
          </TouchableOpacity>
        </View>

        {!isPortfolioCollapsed && (
          <View style={styles.pfToolbar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              {myListings.length > 0 && (
                <TouchableOpacity
                  onPress={selectAll}
                  style={styles.toolbarBtn}
                  accessibilityLabel={selectedListings.length === myListings.length ? 'Deselect all' : 'Select all'}
                >
                  <Ionicons
                    name={selectedListings.length === myListings.length ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={t.text}
                  />
                  <Text style={styles.toolbarText}>{selectedListings.length === myListings.length ? 'Done' : 'Select'}</Text>
                </TouchableOpacity>
              )}
              {myListings.length > 0 && selectedListings.length > 0 && (
                <View style={{ flexDirection: 'row', marginLeft: 12 }}>
                  <TouchableOpacity
                    onPress={handleShareSelected}
                    style={[styles.toolbarBtn, { marginRight: 10, opacity: 1 }]}
                    accessibilityLabel="Share selected"
                  >
                    <Ionicons name="share-outline" size={20} color={t.text} />
                    <Text style={styles.toolbarText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDeleteSelected}
                    style={[styles.toolbarBtn, { opacity: 1 }]}
                    accessibilityLabel="Delete selected"
                  >
                    <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                    <Text style={{ ...styles.toolbarText, color: '#FF3B30' }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
              {myListings.length === 0 && (
                <Text style={{ flex: 1, textAlign: 'center', color: t.sub, fontSize: 14 }}>
                  No listings to manage
                </Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <TouchableOpacity onPress={() => navigation.navigate('Main', { screen: 'Explore' })}>
                <Text style={styles.seeAll}>Public View</Text>
              </TouchableOpacity>
              {myListings.length > 0 && (
                <TouchableOpacity onPress={() => setIsPortfolioCollapsed(true)}>
                  <Text style={{ color: t.primary, fontWeight: '600' }}>Collapse</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {!isPortfolioCollapsed && (
          <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
            {loading && myListings.length === 0 ? (
            <View style={styles.pfList}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={styles.pfRow}>
                  <SkeletonBlock width={76} height={76} borderRadius={14} style={{ backgroundColor: t.tile }} />
                  <View style={styles.pfBody}>
                    <SkeletonBlock width="32%" height={16} borderRadius={8} style={{ backgroundColor: t.tile }} />
                    <SkeletonBlock width="72%" height={16} borderRadius={8} style={{ backgroundColor: t.tile, marginTop: 8 }} />
                    <SkeletonBlock width="46%" height={12} borderRadius={6} style={{ backgroundColor: t.tile, marginTop: 8 }} />
                  </View>
                </View>
              ))}
            </View>
          ) : myListings.length === 0 ? (
            <View style={styles.pfEmpty}>
              <Ionicons name="home-outline" size={48} color={t.sub} style={{ marginBottom: 16, opacity: 0.4 }} />
              <Text style={styles.emptyText}>You haven't uploaded any properties yet.</Text>
              <Text style={{ textAlign: 'center', color: t.sub, fontSize: 14, marginTop: 8 }}>
                Start by adding your first listing to showcase your properties.
              </Text>
              <TouchableOpacity style={styles.pfEmptyBtn} onPress={() => navigation.navigate('AddListing')}>
                <Text style={styles.pfEmptyBtnText}>Add Your First Listing</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.pfList}>
              {myListings.map((item) => {
                const imgs = Array.isArray(item.property_images) ? item.property_images : [];
                const firstPhoto = imgs.find((im) => !isVideoImage(im));
                const firstVideo = imgs.find((im) => isVideoImage(im));
                const coverImg = firstPhoto?.url || null;
                const isSelected = selectedListings.includes(item.id);
                const sb = STATUS_BADGES[item.status] || STATUS_BADGES.available;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.pfRow, isSelected && styles.pfRowSelected]}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (isSelectionMode) toggleSelection(item.id);
                      else navigation.navigate('AddListing', { editItem: item });
                    }}
                    onLongPress={() => {
                      if (!isSelectionMode) {
                        setIsSelectionMode(true);
                        setSelectedListings([item.id]);
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                  >
                    {isSelectionMode && (
                      <Ionicons
                        name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={isSelected ? t.text : t.sub}
                        style={{ marginRight: 10, alignSelf: 'center' }}
                        accessibilityLabel={isSelected ? 'Deselect this item' : 'Select this item'}
                      />
                    )}
                    {firstVideo && !firstPhoto ? (
                      <CardVideo uri={toPublicImageUrl(firstVideo.url)} style={styles.pfCover} />
                    ) : coverImg ? (
                      <Image source={{ uri: coverImg }} style={styles.pfCover} />
                    ) : (
                      <View style={[styles.pfCover, styles.pfCoverEmpty]}>
                        <Ionicons name="image-outline" size={24} color={t.sub} />
                      </View>
                    )}
                    <View style={styles.pfBody}>
                      <View style={styles.pfTopRow}>
                        <Text style={[styles.pfStatus, { color: sb.color }]}>{sb.label}</Text>
                        <Text style={styles.pfPrice}>{listingPricePrimary(item)}</Text>
                      </View>
                      <Text style={styles.pfTitle} numberOfLines={2}>{item.title}</Text>
                      <Text style={styles.pfMeta} numberOfLines={1}>
                        {item.views || 0} views · {new Date(item.created_at).toLocaleDateString()}
                      </Text>
                      {!isSelectionMode && (
                        <View style={styles.pfActions}>
                          <TouchableOpacity
                            onPress={(e) => {
                              try { e.stopPropagation(); } catch (_) {}
                              navigation.navigate('AddListing', { editItem: item });
                            }}
                          >
                            <Text style={styles.pfEdit}>Edit</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={(e) => {
                              try { e.stopPropagation(); } catch (_) {}
                              handleDelete(item.id);
                            }}
                          >
                            <Text style={styles.pfDelete}>Delete</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => navigation.navigate('Main', { screen: 'Explore' }) }
                            style={{ paddingTop: 4, paddingBottom: 4, borderWidth: 1, borderColor: t.border, borderRadius: 20, marginTop: 4 }}
                          >
                            <Text style={{ fontSize: 12, color: t.primary }}>View on site</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          </View>
        )}

        {/* Received Messages */}
        <View style={[styles.sectionHeader, { marginTop: 30 }]}>
          <Text style={styles.sectionTitle}>Recent Inquiries</Text>
          <TouchableOpacity onPress={() => navigation.navigate('UserList')}><Text style={styles.seeAll}>Inbox</Text></TouchableOpacity>
        </View>
        
        {loading ? (
          <ActivityIndicator size="small" color="#8A8A8A" style={{ marginVertical: 20 }} />
        ) : recentMessages.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No messages from tenants yet.</Text>
          </View>
        ) : (
          <View style={styles.groupContainer}>
            {recentMessages.map((msg, index) => {
              const isLast = index === recentMessages.length - 1;
              return (
                <TouchableOpacity 
                  key={msg.id} 
                  style={[
                    styles.msgCard,
                    isLast && { borderBottomWidth: 0 }
                  ]} 
                  onPress={() => navigation.navigate('ChatRoom', { conversationId: msg.id, recipientName: msg.senderName })}
                >
                  {msg.avatar ? (
                    <Image source={{ uri: msg.avatar }} style={styles.msgAvatar} />
                  ) : (
                    <View style={[styles.msgAvatar, { backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center' }]}>
                      <Ionicons name="person" size={20} color="#8A8A8A" />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.msgName}>{msg.senderName}</Text>
                      <Text style={styles.msgTime}>{new Date(msg.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
                    </View>
                    <Text style={styles.msgPreview} numberOfLines={1}>{msg.preview}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#8A8A8A" style={{ marginLeft: 10 }} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        </>
        )}
      </ScrollView>
    </View>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: t.card,
    paddingTop: Platform.OS === 'ios' ? 80 : 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  menuBtn: { padding: 4 },
  greeting: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 21, fontWeight: '600', color: t.text },
  subtitle: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: t.sub, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', marginLeft: 6, position: 'relative' },
  inboxBtn: { backgroundColor: 'transparent' },
  addBtn: { backgroundColor: 'transparent' },
  unreadBadge: { position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF3B30', borderWidth: 1.5, borderColor: t.card, zIndex: 1 },
  
  // Menu Styles
  menuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, flexDirection: 'row' },
  overlayClose: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  menuContent: { width: '82%', backgroundColor: t.card, height: '100%', paddingTop: 80, paddingHorizontal: 0, overflow: 'hidden' },
  decorCircle: { display: 'none' },
  menuProfile: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, paddingHorizontal: 20, zIndex: 1 },
  menuAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  menuAvatarImg: { width: '100%', height: '100%' },
  menuName: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 19, fontWeight: '600', color: t.text },
  menuRole: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: t.sub, marginTop: 2 },
  menuItems: { flex: 1, backgroundColor: t.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline, zIndex: 1 },
  menuLink: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.hairline },
  menuIconBox: { width: 30, height: 30, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  menuLinkLabel: { flex: 1, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 16, fontWeight: '400', color: t.text },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: t.hairline, marginVertical: 8 },
  versionTag: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 12, fontWeight: '400', color: t.sub, textAlign: 'center', marginBottom: 40, marginTop: 20 },
  
  scroll: { paddingBottom: 120 },

  quickRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: t.card },
  quickRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline },
  quickIconBox: { width: 28, height: 28, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  quickLabel: { flex: 1, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 16, fontWeight: '400', color: t.text },
  quickBadge: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, marginRight: 6 },
  quickBadgeText: { color: '#FF3B30', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 14, fontWeight: '600' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 20, marginBottom: 8 },
  sectionHeaderBtn: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  sectionTitle: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 17, fontWeight: '700', color: t.text },
  seeAll: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: t.sub },
  
  emptyBox: { padding: 36, backgroundColor: t.card, alignItems: 'center' },
  emptyText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 15, fontWeight: '400', color: t.sub, textAlign: 'center' },

  // Portfolio list (My Listings redo)
  pfToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  pfList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  pfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  pfRowSelected: { backgroundColor: t.input },
  pfCover: {
    width: 76,
    height: 76,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: t.tile,
  },
  pfCoverEmpty: { justifyContent: 'center', alignItems: 'center' },
  pfBody: { flex: 1, marginLeft: 12, minWidth: 0 },
  pfTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pfStatus: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 12, fontWeight: '700' },
  pfPrice: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 16, fontWeight: '700', color: t.text },
  pfTitle: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 16, fontWeight: '600', color: t.text, marginTop: 2 },
  pfMeta: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 13, fontWeight: '400', color: t.sub, marginTop: 3 },
  pfActions: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 10 },
  pfEdit: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 15, fontWeight: '600', color: t.text },
  pfDelete: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 15, fontWeight: '400', color: '#FF3B30' },
  pfEmpty: { padding: 32, alignItems: 'center' },
  pfEmptyBtn: { marginTop: 18, backgroundColor: t.text, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 22 },
  pfEmptyBtnText: { color: t.bg, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 16, fontWeight: '600' },

  msgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  msgAvatar: { width: 40, height: 40, borderRadius: 20, marginRight: 12, overflow: 'hidden' },
  msgName: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 16, fontWeight: '600', color: t.text },
  msgTime: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: t.sub },
  msgPreview: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 15, fontWeight: '400', color: t.sub, marginTop: 1 },

  // Selection Styles
  toolbarBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  toolbarText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 15, fontWeight: '600', color: t.text, marginLeft: 6 },

  groupContainer: {
    backgroundColor: t.card,
    marginHorizontal: 0,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  quickSub: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: t.sub, marginTop: 2 },

  // Mover Hub Styles — Threads-like thread rows
  threadProfile: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  threadAvatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  threadName: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 19, fontWeight: '700', color: t.text },
  threadHandle: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 15, fontWeight: '400', color: t.sub, marginTop: 2 },
  moverVerifiedPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 6 },
  moverVerifiedText: { color: '#1E8E4E', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 12, fontWeight: '600', marginLeft: 4 },
  vehiclePhotoRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline, paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  vehicleThumb: { width: 68, height: 68, borderRadius: 10, backgroundColor: t.tile },
  vehicleMore: { backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center' },
  vehicleMoreText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 16, fontWeight: '600', color: t.text },
  vehicleEmpty: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline, paddingHorizontal: 16, paddingVertical: 14 },
  vehicleEmptyText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: t.sub },
});
