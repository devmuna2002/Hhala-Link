import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, ActivityIndicator, Image, Alert, Share } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../supabase';
import { listingPricePrimary } from '../utils/formatPrice';

const STATUS_BADGES = {
  pending:   { label: 'PENDING',  bg: '#FFF1D6', color: '#B26A00' },
  rejected:  { label: 'REJECTED', bg: '#FFE3E3', color: '#C0392B' },
  available: { label: 'LIVE',     bg: '#E2F6EA', color: '#1E8E4E' },
};

export default function AgentHomeScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [myListings, setMyListings] = useState([]);
  const [recentMessages, setRecentMessages] = useState([]);
  const [stats, setStats] = useState({ activeListings: 0, totalViews: 0, totalLoves: 0 });
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [agentProfile, setAgentProfile] = useState(null);
  const [isPortfolioCollapsed, setIsPortfolioCollapsed] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  
  // Selection state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedListings, setSelectedListings] = useState([]);

  const loadAgentData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setLoading(true);
    
    // Fetch Profile, Properties, and Conversations concurrently
    const [
      { data: profile },
      { data: properties },
      { data: convs }
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('properties')
        .select('*, property_images(url)')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false }),
      supabase.from('conversations')
        .select(`
          id, 
          last_message_at, 
          participant_a:profiles!participant_a(id, first_name, last_name, avatar_url), 
          participant_b:profiles!participant_b(id, first_name, last_name, avatar_url),
          messages(body, created_at)
        `)
        .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
        .order('last_message_at', { ascending: false })
        .limit(5)
    ]);

    setAgentProfile(profile);
    setMyListings(properties || []);
    
    // Process conversations and deduplicate in frontend
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

    // Fetch Total Saves across all listings
    const propIds = (properties || []).map(p => p.id);
    let totalSaves = 0;
    if (propIds.length > 0) {
      const { count } = await supabase
        .from('saved_properties')
        .select('*', { count: 'exact', head: true })
        .in('property_id', propIds);
      totalSaves = count || 0;
    }

    const totalViews = (properties || []).reduce((acc, p) => acc + (p.views || 0), 0);

    setStats({
      activeListings: properties ? properties.length : 0,
      totalViews: totalViews,
      totalLoves: totalSaves
    });
    setLoading(false);
  };

  const fetchUnreadMessages = async () => {
    const { data: { user } } = await supabase.auth.getUser();
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
      const message = `Check out these amazing properties on Hlala Link:\n\n` +
                      selectedProps.map(p => `🏠 *${p.title}* - ${listingPricePrimary(p)}`).join('\n') +
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <TouchableOpacity onPress={() => setMenuVisible(true)} style={styles.menuBtn}>
            <Ionicons name="menu" size={28} color="#000" />
          </TouchableOpacity>
          <View style={{ marginLeft: 15, flex: 1 }}>
            <Text style={styles.greeting} numberOfLines={1}>Agent Hub</Text>
            <Text style={styles.subtitle} numberOfLines={1}>Manage your properties</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={[styles.headerBtn, styles.inboxBtn]} onPress={() => navigation.navigate('Main', { screen: 'Chat' })}>
            <View style={{ position: 'relative' }}>
              <Ionicons name="chatbubble-ellipses" size={20} color="#0A84FF" />
              {unreadMsgCount > 0 && <View style={styles.unreadBadge} />}
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Ionicons name="home" size={24} color="#0A84FF" />
            <Text style={styles.statValue}>{stats.activeListings}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="eye" size={24} color="#8A2BE2" />
            <Text style={styles.statValue}>{stats.totalViews}</Text>
            <Text style={styles.statLabel}>Views</Text>
          </View>
          <View style={styles.statCard}>
            <Ionicons name="heart" size={24} color="#FF2D55" />
            <Text style={styles.statValue}>{stats.totalLoves}</Text>
            <Text style={styles.statLabel}>Saves</Text>
          </View>
        </View>

        {/* Quick Actions */}
        <TouchableOpacity style={styles.actionBanner} onPress={() => navigation.navigate('Generic', { title: 'Broadcast to Tenants', icon: 'megaphone' })}>
          <View style={styles.bannerIcon}><Ionicons name="megaphone" size={28} color="#FFF" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>Update Tenants</Text>
            <Text style={styles.bannerSub}>Send a blast message about new listings.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#FFF" />
        </TouchableOpacity>

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
              color="#A0A0A0" 
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
              <Ionicons name={selectedListings.length === myListings.length ? "checkbox" : "square-outline"} size={20} color="#0A84FF" />
              <Text style={styles.toolbarText}>All</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row' }}>
              <TouchableOpacity onPress={handleShareSelected} style={[styles.toolbarBtn, { marginRight: 15, opacity: selectedListings.length > 0 ? 1 : 0.5 }]} disabled={selectedListings.length === 0}>
                <Ionicons name="share-social-outline" size={20} color="#0A84FF" />
                <Text style={[styles.toolbarText, { color: '#0A84FF' }]}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeleteSelected} style={[styles.toolbarBtn, { opacity: selectedListings.length > 0 ? 1 : 0.5 }]} disabled={selectedListings.length === 0}>
                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                <Text style={[styles.toolbarText, { color: '#FF3B30' }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isPortfolioCollapsed && (
          loading ? (
            <ActivityIndicator size="small" color="#0A84FF" style={{ marginVertical: 20 }} />
          ) : myListings.length === 0 ? (
            <View style={styles.emptyBox}>
              <Ionicons name="business-outline" size={48} color="#D1D1D6" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>You haven't uploaded any properties yet.</Text>
              <TouchableOpacity style={styles.emptyAddBtn} onPress={() => navigation.navigate('AddListing')}>
                <Text style={styles.emptyAddBtnText}>Add Your First Listing</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.groupContainer}>
              {myListings.map((item, index) => {
                const coverImg = item.property_images && item.property_images.length > 0 ? item.property_images[0].url : null;
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
                        <Ionicons name={isSelected ? "checkmark-circle" : "ellipse-outline"} size={24} color={isSelected ? "#0A84FF" : "#D1D1D6"} />
                      </View>
                    )}
                    <View style={styles.manageCardContent}>
                      {coverImg ? (
                        <Image source={{ uri: coverImg }} style={styles.manageImg} />
                      ) : (
                        <View style={[styles.manageImg, { backgroundColor: '#E5F1FF', justifyContent: 'center', alignItems: 'center' }]}>
                          <Ionicons name="image-outline" size={24} color="#0A84FF" opacity={0.5} />
                        </View>
                      )}
                      <View style={styles.manageInfo}>
                        <View style={styles.badgeRow}>
                          {(() => {
                            const sb = STATUS_BADGES[item.status] || STATUS_BADGES.available;
                            return (
                              <View style={[styles.statusBadge, { backgroundColor: sb.bg }]}>
                                <Text style={[styles.statusBadgeText, { color: sb.color }]}>{sb.label}</Text>
                              </View>
                            );
                          })()}
                          <Text style={styles.managePrice}>{listingPricePrimary(item)}</Text>
                        </View>
                        <Text style={styles.manageTitle} numberOfLines={1}>{item.title}</Text>
                        <View style={styles.manageStatsRow}>
                          <View style={styles.manageStat}><Ionicons name="eye" size={12} color="#0A84FF" /><Text style={styles.manageStatText}>{item.views || 0} views</Text></View>
                          <View style={styles.manageStat}><Ionicons name="calendar" size={12} color="#8E8E93" /><Text style={styles.manageStatText}>{new Date(item.created_at).toLocaleDateString()}</Text></View>
                        </View>
                      </View>
                    </View>
                    {!isSelectionMode && (
                      <View style={styles.manageActions}>
                        <TouchableOpacity style={styles.actionBtnEdit} onPress={() => navigation.navigate('AddListing', { editItem: item })}>
                          <Ionicons name="pencil" size={16} color="#0A84FF" />
                          <Text style={[styles.actionBtnText, { color: '#0A84FF' }]}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionBtnDelete} onPress={() => handleDelete(item.id)}>
                          <Ionicons name="trash-outline" size={20} color="#FF3B30" />
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
          <TouchableOpacity onPress={() => navigation.navigate('Chat')}><Text style={styles.seeAll}>Inbox</Text></TouchableOpacity>
        </View>
        
        {loading ? (
          <ActivityIndicator size="small" color="#0A84FF" style={{ marginVertical: 20 }} />
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
                    <View style={[styles.msgAvatar, { backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center' }]}>
                      <Ionicons name="person" size={20} color="#0A84FF" />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.msgName}>{msg.senderName}</Text>
                      <Text style={styles.msgTime}>{new Date(msg.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
                    </View>
                    <Text style={styles.msgPreview} numberOfLines={1}>{msg.preview}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#C0C0C0" style={{ marginLeft: 10 }} />
                </TouchableOpacity>
              );
            })}
          </View>
        )}

      </ScrollView>

      {/* Hamburger Menu Modal */}
      {menuVisible && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.overlayClose} onPress={() => setMenuVisible(false)} />
          <LinearGradient 
            colors={['#FFFFFF', '#F0F5FF', '#E5F1FF']}
            style={styles.menuContent}
          >
            {/* Decorative Shape */}
            <View style={styles.decorCircle} />
            
            <View style={styles.menuProfile}>
              <View style={styles.menuAvatar}>
                {agentProfile?.avatar_url ? (
                  <Image source={{ uri: agentProfile.avatar_url }} style={styles.menuAvatarImg} />
                ) : (
                  <Ionicons name="person" size={30} color="#0A84FF" />
                )}
              </View>
              <View>
                <Text style={styles.menuName}>{agentProfile?.first_name} {agentProfile?.last_name}</Text>
                <Text style={styles.menuRole}>Professional Agent</Text>
              </View>
            </View>

            <View style={styles.menuItems}>
              <MenuLink icon="add-circle" label="Add New Listing" color="#0A84FF" onPress={() => { setMenuVisible(false); navigation.navigate('AddListing'); }} />
              <MenuLink icon="mail" label="Messages" color="#5856D6" onPress={() => { setMenuVisible(false); navigation.navigate('Main', { screen: 'Chat' }); }} />
              <MenuLink icon="people" label="Discover People" color="#0A84FF" onPress={() => { setMenuVisible(false); navigation.navigate('UserList'); }} />
              <MenuLink icon="settings" label="Account Settings" color="#8E8E93" onPress={() => { setMenuVisible(false); navigation.navigate('Settings'); }} />
              <MenuLink icon="help-circle" label="Help & Support" color="#34C759" onPress={() => { setMenuVisible(false); navigation.navigate('Support'); }} />
              <View style={styles.menuDivider} />
              <MenuLink icon="log-out" label="Log Out" color="#FF3B30" onPress={() => supabase.auth.signOut()} />
            </View>

            <Text style={styles.versionTag}>Hlala Link Agent v1.2.0</Text>
          </LinearGradient>
        </View>
      )}
    </View>
  );
}

function MenuLink({ icon, label, color, onPress }) {
  return (
    <TouchableOpacity style={styles.menuLink} onPress={onPress}>
      <View style={[styles.menuIconBox, { backgroundColor: color + '15' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.menuLinkLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingTop: Platform.OS === 'ios' ? 80 : 50,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
  },
  menuBtn: { padding: 4 },
  greeting: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#000' },
  subtitle: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginLeft: 10, position: 'relative' },
  inboxBtn: { backgroundColor: '#F2F2F7' },
  unreadBadge: { position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF3B30', borderWidth: 1.5, borderColor: '#F2F2F7', zIndex: 1 },
  
  // Menu Styles
  menuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, flexDirection: 'row' },
  overlayClose: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  menuContent: { width: '82%', backgroundColor: '#F2F2F7', height: '100%', paddingTop: 80, paddingHorizontal: 0, overflow: 'hidden' },
  decorCircle: { display: 'none' },
  menuProfile: { flexDirection: 'row', alignItems: 'center', marginBottom: 28, paddingHorizontal: 20, zIndex: 1 },
  menuAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#E5E5EA', justifyContent: 'center', alignItems: 'center', marginRight: 14, overflow: 'hidden' },
  menuAvatarImg: { width: '100%', height: '100%' },
  menuName: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#000' },
  menuRole: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93' },
  menuItems: { flex: 1, backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#C6C6C8', zIndex: 1 },
  menuLink: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  menuIconBox: { width: 34, height: 34, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  menuLinkLabel: { flex: 1, fontFamily: 'Poppins_500Medium', fontSize: 16, color: '#1C1C1E' },
  menuDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#C6C6C8', marginVertical: 8 },
  versionTag: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#AEAEB2', textAlign: 'center', marginBottom: 40, marginTop: 20 },
  
  scroll: { paddingBottom: 120 },
  
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 24, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'flex-start',
    marginHorizontal: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
  },
  statValue: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#000', marginTop: 8 },
  statLabel: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#8E8E93' },

  actionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0A84FF',
    marginHorizontal: 16,
    borderRadius: 14,
    padding: 18,
    marginBottom: 28,
  },
  bannerIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  bannerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#FFF' },
  bannerSub: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 },
  sectionTitle: { fontFamily: 'Poppins_700Bold', fontSize: 17, color: '#1A1A1A' },
  seeAll: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#0A84FF' },
  
  emptyBox: { marginHorizontal: 16, padding: 36, backgroundColor: '#FFFFFF', borderRadius: 20, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: '#DCEBFF' },
  emptyText: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: "#8E8E93", textAlign: 'center' },
  emptyAddBtn: { marginTop: 18, backgroundColor: "#0A84FF", paddingHorizontal: 20, paddingVertical: 11, borderRadius: 20 },
  emptyAddBtnText: { color: '#FFFFFF', fontFamily: 'Poppins_600SemiBold', fontSize: 14 },

  manageCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DCEBFF',
  },
  manageCardContent: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  manageImg: { width: 80, height: 80, borderRadius: 16 },
  manageInfo: { flex: 1, marginLeft: 16 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  activeBadge: { backgroundColor: '#DCEBFF', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 30, borderWidth: 1, borderColor: '#0A84FF' },
  activeBadgeText: { color: "#0A84FF", fontSize: 10, fontFamily: 'Poppins_700Bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusBadgeText: { fontFamily: 'Poppins_700Bold', fontSize: 9, letterSpacing: 1 },
  manageTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: "#1A1A1A", marginBottom: 6 },
  managePrice: { fontFamily: 'Poppins_700Bold', fontSize: 14, color: "#0A84FF" },
  manageStatsRow: { flexDirection: 'row', alignItems: 'center' },
  manageStat: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  manageStatText: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: "#8E8E93", marginLeft: 4 },
  
  manageActions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#DCEBFF', paddingTop: 16, justifyContent: 'space-between', alignItems: 'center' },
  actionBtnEdit: { flex: 1, flexDirection: 'row', backgroundColor: '#DCEBFF', justifyContent: 'center', alignItems: 'center', height: 44, borderRadius: 22, marginRight: 10 },
  actionBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, marginLeft: 8, color: "#1A1A1A" },
  actionBtnDelete: { width: 44, height: 44, backgroundColor: '#F2F7FF', justifyContent: 'center', alignItems: 'center', borderRadius: 22 },

  msgCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DCEBFF',
  },
  msgAvatar: { width: 44, height: 44, borderRadius: 22, marginRight: 16, overflow: 'hidden' },
  msgName: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: "#1A1A1A" },
  msgTime: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: "#8E8E93" },
  msgPreview: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: "#8E8E93", marginTop: 4 },

  // Selection Styles
  selectionToolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 },
  toolbarBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  toolbarText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: "#0A84FF", marginLeft: 6 },
  manageCardSelected: { backgroundColor: '#DCEBFF' },
  checkboxContainer: { position: 'absolute', top: 16, right: 16, zIndex: 10 },

  groupContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    marginHorizontal: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#DCEBFF',
  },
});
