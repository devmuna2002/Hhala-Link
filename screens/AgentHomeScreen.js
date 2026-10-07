import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, ActivityIndicator, Image, Alert, Share } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase, getSessionUser } from '../supabase';
import { listingPricePrimary } from '../utils/formatPrice';
import { toPublicImageUrl } from '../utils/imageUrl';
import { signOutAndClear } from '../utils/auth';
import { useTheme } from '../utils/theme';
import { CardVideo } from '../components/ListingCard';

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
  const [isPortfolioCollapsed, setIsPortfolioCollapsed] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [userRole, setUserRole] = useState('agent');
  const [moverProfile, setMoverProfile] = useState(null);
  const [moverBookings, setMoverBookings] = useState([]);
  
  // Selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedListings, setSelectedListings] = useState([]);

  const loadAgentData = async () => {
    const user = await getSessionUser();
    if (!user) return;

    setLoading(true);
    
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
    }

    setLoading(false);
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
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.menuBtn}>
            <Ionicons name="menu" size={26} color="#111111" />
          </TouchableOpacity>
          <View style={{ marginLeft: 15, flex: 1 }}>
            <Text style={styles.greeting} numberOfLines={1}>{userRole === 'mover' ? 'Mover Hub' : 'Agent Hub'}</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{userRole === 'mover' ? 'Manage your transport' : 'Manage your properties'}</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          {userRole === 'mover' ? (
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('MyMoverBookings')}>
              <Ionicons name="swap-horizontal" size={24} color="#8A8A8A" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('AddListing')}>
              <Ionicons name="add" size={28} color="#111111" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('UserList')}>
            <View style={{ position: 'relative' }}>
              <Ionicons name="chatbubble-ellipses" size={26} color="#8A8A8A" />
              {unreadMsgCount > 0 && <View style={styles.unreadBadge} />}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {userRole === 'mover' ? (
        <>
        {/* Quick Actions */}
        <View style={[styles.groupContainer, { marginTop: 20 }]}>
          <TouchableOpacity
            style={styles.quickRow}
            onPress={() => navigation.navigate('MyMoverBookings')}
            activeOpacity={0.7}
          >
            <View style={styles.quickIconBox}>
              <Ionicons name="swap-horizontal" size={20} color="#8A8A8A" />
            </View>
            <Text style={styles.quickLabel}>My Moving Jobs</Text>
            <Ionicons name="chevron-forward" size={16} color="#8A8A8A" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.quickRow, styles.quickRowBorder]}
            onPress={() => navigation.navigate('EditProfile')}
            activeOpacity={0.7}
          >
            <View style={styles.quickIconBox}>
              <Ionicons name="car-sport" size={20} color="#8A8A8A" />
            </View>
            <Text style={styles.quickLabel}>Edit Transport Profile</Text>
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
            <Text style={styles.quickLabel}>Messages</Text>
            {unreadMsgCount > 0 && (
              <View style={styles.quickBadge}>
                <Text style={styles.quickBadgeText}>{unreadMsgCount > 99 ? '99+' : unreadMsgCount}</Text>
              </View>
            )}
            <Ionicons name="chevron-forward" size={16} color="#8A8A8A" style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        </View>

        {/* Transportation Profile */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Transportation Profile</Text>
          <TouchableOpacity onPress={() => navigation.navigate('EditProfile')}><Text style={styles.seeAll}>Edit</Text></TouchableOpacity>
        </View>
        <View style={styles.groupContainer}>
          <View style={styles.moverProfileRow}>
            <View style={styles.moverAvatar}>
              {moverAvatarUrl ? (
                <Image source={{ uri: moverAvatarUrl }} style={styles.menuAvatarImg} />
              ) : (
                <Ionicons name="swap-horizontal" size={30} color="#8A8A8A" />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.moverCompanyName} numberOfLines={1}>{moverName}</Text>
              <View style={styles.moverVerifiedPill}>
                <Ionicons name="checkmark-circle" size={12} color="#1E8E4E" />
                <Text style={styles.moverVerifiedText}>VERIFIED MOVER</Text>
              </View>
            </View>
          </View>
          <View style={styles.moverStatsRow}>
            {!!moverCity && (
              <View style={styles.moverStat}>
                <Ionicons name="location" size={13} color="#8A8A8A" />
                <Text style={styles.moverStatText}>{moverCity}</Text>
              </View>
            )}
            {!!moverBasePrice && (
              <View style={styles.moverStat}>
                <Ionicons name="pricetag" size={13} color="#8A8A8A" />
                <Text style={styles.moverStatText}>{moverBasePrice}</Text>
              </View>
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
              <Ionicons name="car-sport" size={20} color="#8A8A8A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quickLabel}>{vehicleLabel}</Text>
              {!!vehicleRegLabel && <Text style={styles.quickSub}>{vehicleRegLabel}</Text>}
            </View>
            <Ionicons name="chevron-forward" size={16} color="#8A8A8A" />
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
          <ActivityIndicator size="small" color="#8A8A8A" style={{ marginVertical: 20 }} />
        ) : moverBookings.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="swap-horizontal" size={40} color="#E0E0E0" style={{ marginBottom: 12 }} />
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
                      <Ionicons name="person" size={20} color="#8A8A8A" />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.msgName} numberOfLines={1}>{clientName}</Text>
                      <Text style={styles.msgTime}>{new Date(b.created_at).toLocaleDateString()}</Text>
                    </View>
                    <Text style={styles.msgPreview} numberOfLines={1}>{jd.from && jd.to ? `${jd.from} → ${jd.to}` : b.status}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#8A8A8A" style={{ marginLeft: 10 }} />
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
            onPress={() => navigation.navigate('Generic', { title: 'Broadcast to Tenants', icon: 'megaphone' })}
            activeOpacity={0.7}
          >
            <View style={styles.quickIconBox}>
              <Ionicons name="megaphone" size={20} color="#8A8A8A" />
            </View>
            <Text style={styles.quickLabel}>Update Tenants</Text>
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
            style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} 
            onPress={() => setIsPortfolioCollapsed(!isPortfolioCollapsed)}
            activeOpacity={0.7}
          >
            <Text style={styles.sectionTitle}>Active Portfolio</Text>
            <Ionicons 
              name={isPortfolioCollapsed ? "chevron-down" : "chevron-up"} 
              size={18} 
              color="#8A8A8A" 
              style={{ marginLeft: 8 }} 
            />
          </TouchableOpacity>
          
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {myListings.length > 0 && !isPortfolioCollapsed && (
              <TouchableOpacity 
                style={{ marginRight: 15 }}
                onPress={() => {
                  if (isSelectionMode) {
                    cancelSelection();
                  } else {
                    setIsSelectionMode(true);
                  }
                }}
              >
                <Text style={styles.seeAll}>{isSelectionMode ? 'Done' : 'Select'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => navigation.navigate('Main', { screen: 'Explore' })}>
              <Text style={styles.seeAll}>Public View</Text>
            </TouchableOpacity>
          </View>
        </View>

        {isSelectionMode && !isPortfolioCollapsed && (
          <View style={styles.selectionToolbar}>
            <TouchableOpacity onPress={selectAll} style={styles.toolbarBtn}>
              <Ionicons name={selectedListings.length === myListings.length ? "checkbox" : "square"} size={20} color="#111111" />
              <Text style={styles.toolbarText}>All</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={handleShareSelected} style={[styles.toolbarBtn, { marginRight: 15, opacity: selectedListings.length > 0 ? 1 : 0.5 }]} disabled={selectedListings.length === 0}>
                <Ionicons name="share-social" size={20} color="#111111" />
                <Text style={styles.toolbarText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeleteSelected} style={[styles.toolbarBtn, { opacity: selectedListings.length > 0 ? 1 : 0.5 }]} disabled={selectedListings.length === 0}>
                <Ionicons name="trash" size={20} color="#FF3B30" />
                <Text style={[styles.toolbarText, { color: '#FF3B30' }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isPortfolioCollapsed && (
          loading ? (
            <ActivityIndicator size="small" color="#8A8A8A" style={{ marginVertical: 20 }} />
          ) : myListings.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="business" size={40} color="#E0E0E0" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>You haven't uploaded any properties yet.</Text>
              <TouchableOpacity style={styles.emptyAddBtn} onPress={() => navigation.navigate('AddListing')}>
                <Text style={styles.emptyAddBtnText}>Add Your First Listing</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.groupContainer}>
              {myListings.map((item, index) => {
                const imgs = Array.isArray(item.property_images) ? item.property_images : [];
                const firstPhoto = imgs.find((im) => !isVideoImage(im));
                const firstVideo = imgs.find((im) => isVideoImage(im));
                const coverImg = firstPhoto?.url || null;
                const isSelected = selectedListings.includes(item.id);
                const isLast = index === myListings.length - 1;
                return (
                  <TouchableOpacity 
                    key={item.id} 
                    style={[
                      styles.manageCard, 
                      isSelected && styles.manageCardSelected,
                      isLast && { borderBottomWidth: 0 }
                    ]}
                    activeOpacity={0.9}
                    onPress={() => {
                      if (isSelectionMode) toggleSelection(item.id);
                    }}
                    onLongPress={() => {
                      if (!isSelectionMode) {
                        setIsSelectionMode(true);
                        setSelectedListings([item.id]);
                      }
                    }}
                  >
                    {isSelectionMode && (
                      <View style={styles.checkboxContainer}>
                        <Ionicons name={isSelected ? "checkmark-circle" : "ellipse"} size={24} color={isSelected ? "#111111" : "#C7C7CC"} />
                      </View>
                    )}
                    <View style={styles.manageCardContent}>
                      {firstVideo && !firstPhoto ? (
                        <CardVideo uri={toPublicImageUrl(firstVideo.url)} style={[styles.manageImg, { overflow: 'hidden' }]} />
                      ) : coverImg ? (
                        <Image source={{ uri: coverImg }} style={styles.manageImg} />
                      ) : (
                        <View style={[styles.manageImg, { backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center' }]}>
                          <Ionicons name="image" size={24} color="#8A8A8A" opacity={0.6} />
                        </View>
                      )}
                      <View style={styles.manageInfo}>
                        <View style={styles.badgeRow}>
                          {(() => {
                            const sb = STATUS_BADGES[item.status] || STATUS_BADGES.available;
                            return (
                              <Text style={[styles.statusBadgeText, { color: sb.color }]}>{sb.label}</Text>
                            );
                          })()}
                          <Text style={styles.managePrice}>{listingPricePrimary(item)}</Text>
                        </View>
                        <Text style={styles.manageTitle} numberOfLines={1}>{item.title}</Text>
                        <View style={styles.manageStatsRow}>
                          <View style={styles.manageStat}><Ionicons name="eye" size={12} color="#8A8A8A" /><Text style={styles.manageStatText}>{item.views || 0} views</Text></View>
                          <View style={styles.manageStat}><Ionicons name="calendar" size={12} color="#8A8A8A" /><Text style={styles.manageStatText}>{new Date(item.created_at).toLocaleDateString()}</Text></View>
                        </View>
                      </View>
                    </View>
                    {!isSelectionMode && (
                      <View style={styles.manageActions}>
                        <TouchableOpacity style={styles.actionBtnEdit} onPress={() => navigation.navigate('AddListing', { editItem: item })}>
                          <Text style={styles.actionBtnText}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionBtnDelete} onPress={() => handleDelete(item.id)}>
                          <Text style={styles.actionBtnDeleteText}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )
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

      {/* Hamburger Menu Modal */}
      {menuVisible && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.overlayClose} onPress={() => setMenuVisible(false)} />
          <LinearGradient 
            colors={['#FFFFFF', '#FFFFFF']}
            style={styles.menuContent}
          >
            {/* Decorative Shape */}
            <View style={styles.decorCircle} />
            
            <View style={styles.menuProfile}>
              <View style={styles.menuAvatar}>
                {moverAvatarUrl || agentProfile?.avatar_url ? (
                  <Image source={{ uri: moverAvatarUrl || agentProfile?.avatar_url }} style={styles.menuAvatarImg} />
                ) : (
                  <Ionicons name={userRole === 'mover' ? 'swap-horizontal' : 'person'} size={30} color="#8A8A8A" />
                )}
              </View>
              <View>
                <Text style={styles.menuName}>{agentProfile?.first_name} {agentProfile?.last_name}</Text>
                <Text style={styles.menuRole}>{userRole === 'mover' ? 'Professional Mover' : 'Professional Agent'}</Text>
              </View>
            </View>

            <View style={styles.menuItems}>
              {userRole === 'mover' ? (
                <>
                  <MenuLink icon="swap-horizontal" label="My Moving Jobs" color="#8A8A8A" onPress={() => { setMenuVisible(false); navigation.navigate('MyMoverBookings'); }} />
                  <MenuLink icon="car-sport" label="Edit Transport Profile" color="#8A8A8A" onPress={() => { setMenuVisible(false); navigation.navigate('EditProfile'); }} />
                </>
              ) : (
                <MenuLink icon="add-circle" label="Add New Listing" color="#8A8A8A" onPress={() => { setMenuVisible(false); navigation.navigate('AddListing'); }} />
              )}
              <MenuLink icon="mail" label="Messages" color="#8A8A8A" onPress={() => { setMenuVisible(false); navigation.navigate('UserList'); }} />
              <MenuLink icon="people" label="Discover People" color="#8A8A8A" onPress={() => { setMenuVisible(false); navigation.navigate('UserList'); }} />
              <MenuLink icon="settings" label="Account Settings" color="#8A8A8A" onPress={() => { setMenuVisible(false); navigation.navigate('Settings'); }} />
              <MenuLink icon="help-circle" label="Help & Support" color="#8A8A8A" onPress={() => { setMenuVisible(false); navigation.navigate('Support'); }} />
              <View style={styles.menuDivider} />
              <MenuLink icon="log-out" label="Log Out" color="#FF3B30" onPress={() => signOutAndClear()} />
            </View>

            <Text style={styles.versionTag}>Hlala Link {userRole === 'mover' ? 'Mover' : 'Agent'} v1.1.0</Text>
          </LinearGradient>
        </View>
      )}
    </View>
  );
}

function MenuLink({ icon, label, color, onPress }) {
  const isDestructive = color === '#FF3B30';
  return (
    <TouchableOpacity style={styles.menuLink} onPress={onPress}>
      <View style={styles.menuIconBox}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={[styles.menuLinkLabel, isDestructive && { color: '#FF3B30' }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#8A8A8A" />
    </TouchableOpacity>
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
  greeting: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 20, fontWeight: '600', color: t.text },
  subtitle: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 13, fontWeight: '400', color: t.sub, marginTop: 1 },
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
  menuName: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 17, fontWeight: '600', color: t.text },
  menuRole: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 13, fontWeight: '400', color: t.sub, marginTop: 2 },
  menuItems: { flex: 1, backgroundColor: t.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline, zIndex: 1 },
  menuLink: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.hairline },
  menuIconBox: { width: 30, height: 30, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  menuLinkLabel: { flex: 1, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 15, fontWeight: '400', color: t.text },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: t.hairline, marginVertical: 8 },
  versionTag: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 11, fontWeight: '400', color: t.sub, textAlign: 'center', marginBottom: 40, marginTop: 20 },
  
  scroll: { paddingBottom: 120 },

  quickRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, backgroundColor: t.card },
  quickRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EFEFEF' },
  quickIconBox: { width: 30, height: 30, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  quickLabel: { flex: 1, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 15, fontWeight: '400', color: t.text },
  quickBadge: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, marginRight: 6 },
  quickBadgeText: { color: '#FF3B30', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 13, fontWeight: '600' },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 20, marginBottom: 8 },
  sectionTitle: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 15, fontWeight: '600', color: t.text },
  seeAll: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: t.sub },
  
  emptyBox: { padding: 36, backgroundColor: t.card, alignItems: 'center' },
  emptyText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: t.sub, textAlign: 'center' },
  emptyAddBtn: { marginTop: 18, backgroundColor: t.text, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14 },
  emptyAddBtnText: { color: t.bg, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 15, fontWeight: '600' },

  manageCard: {
    backgroundColor: t.card,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  manageCardContent: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  manageImg: { width: 72, height: 72, borderRadius: 12 },
  manageInfo: { flex: 1, marginLeft: 12 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  activeBadge: { paddingVertical: 2 },
  activeBadgeText: { color: "#1E8E4E", fontSize: 12, fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontWeight: '600' },
  statusBadge: { paddingVertical: 2 },
  statusBadgeText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 12, fontWeight: '600' },
  manageTitle: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 15, fontWeight: '400', color: t.text, marginBottom: 4 },
  managePrice: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 15, fontWeight: '600', color: t.text },
  manageStatsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  manageStat: { flexDirection: 'row', alignItems: 'center', marginRight: 14 },
  manageStatText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 12, fontWeight: '400', color: t.sub, marginLeft: 4 },
  
  manageActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.hairline, paddingTop: 10, alignItems: 'center' },
  actionBtnEdit: { paddingVertical: 8, paddingRight: 20 },
  actionBtnText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 14, fontWeight: '600', color: t.text },
  actionBtnDelete: { paddingVertical: 8 },
  actionBtnDeleteText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 14, fontWeight: '400', color: '#FF3B30' },

  msgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  msgAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 12, overflow: 'hidden' },
  msgName: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 15, fontWeight: '400', color: t.text },
  msgTime: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 12, fontWeight: '400', color: t.sub },
  msgPreview: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 13, fontWeight: '400', color: t.sub, marginTop: 2 },

  // Selection Styles
  selectionToolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  toolbarBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  toolbarText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 14, fontWeight: '600', color: t.text, marginLeft: 6 },
  manageCardSelected: { backgroundColor: t.input },
  checkboxContainer: { position: 'absolute', top: 12, right: 12, zIndex: 10 },

  groupContainer: {
    backgroundColor: t.card,
    marginHorizontal: 0,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  quickSub: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 13, fontWeight: '400', color: t.sub, marginTop: 2 },

  // Mover Hub Styles
  moverProfileRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  moverAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center', marginRight: 12, overflow: 'hidden' },
  moverCompanyName: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 17, fontWeight: '600', color: t.text },
  moverVerifiedPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginTop: 4 },
  moverVerifiedText: { color: '#1E8E4E', fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 12, fontWeight: '600', marginLeft: 4 },
  moverStatsRow: { flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EFEFEF', paddingHorizontal: 16, paddingVertical: 12, gap: 16 },
  moverStat: { flexDirection: 'row', alignItems: 'center' },
  moverStatText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 13, fontWeight: '400', color: t.sub, marginLeft: 6 },
  vehiclePhotoRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EFEFEF', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  vehicleThumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: t.tile },
  vehicleMore: { backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center' },
  vehicleMoreText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif-medium' }), fontSize: 15, fontWeight: '600', color: t.text },
  vehicleEmpty: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EFEFEF', paddingHorizontal: 16, paddingVertical: 14 },
  vehicleEmptyText: { fontFamily: Platform.select({ ios: 'System', android: 'sans-serif' }), fontSize: 13, fontWeight: '400', color: t.sub },
});
