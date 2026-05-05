import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, ActivityIndicator, Image, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../supabase';

export default function AgentHomeScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [myListings, setMyListings] = useState([]);
  const [recentMessages, setRecentMessages] = useState([]);
  const [stats, setStats] = useState({ activeListings: 0, totalViews: 0, totalLoves: 0 });
  const [unreadMsgCount, setUnreadMsgCount] = useState(0);
  const [agentProfile, setAgentProfile] = useState(null);
  const [isPortfolioCollapsed, setIsPortfolioCollapsed] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  const loadAgentData = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setLoading(true);
    // Fetch Agent's Profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    setAgentProfile(profile);

    // Fetch Agent's Properties
    const { data: properties } = await supabase
      .from('properties')
      .select('*, property_images(url)')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false });

    // Fetch Recent Messages (Conversations)
    const { data: convs } = await supabase
      .from('conversations')
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
            <Ionicons name="chatbubble-ellipses" size={20} color="#0A84FF" />
            {unreadMsgCount > 0 && <View style={styles.unreadBadge} />}
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
        <TouchableOpacity 
          style={styles.sectionHeader} 
          onPress={() => setIsPortfolioCollapsed(!isPortfolioCollapsed)}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.sectionTitle}>Active Portfolio</Text>
            <Ionicons 
              name={isPortfolioCollapsed ? "chevron-down" : "chevron-up"} 
              size={18} 
              color="#A0A0A0" 
              style={{ marginLeft: 8 }} 
            />
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Main', { screen: 'Explore' })}>
            <Text style={styles.seeAll}>Public View</Text>
          </TouchableOpacity>
        </TouchableOpacity>
        
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
            <View style={{ paddingHorizontal: 20 }}>
              {myListings.map((item) => {
                const coverImg = item.property_images && item.property_images.length > 0 ? item.property_images[0].url : null;
                return (
                  <View key={item.id} style={styles.manageCard}>
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
                          <View style={styles.activeBadge}><Text style={styles.activeBadgeText}>ACTIVE</Text></View>
                          <Text style={styles.managePrice}>${item.rent_usd}/mo</Text>
                        </View>
                        <Text style={styles.manageTitle} numberOfLines={1}>{item.title}</Text>
                        <View style={styles.manageStatsRow}>
                          <View style={styles.manageStat}><Ionicons name="eye" size={12} color="#0A84FF" /><Text style={styles.manageStatText}>{item.views || 0} views</Text></View>
                          <View style={styles.manageStat}><Ionicons name="calendar" size={12} color="#8E8E93" /><Text style={styles.manageStatText}>{new Date(item.created_at).toLocaleDateString()}</Text></View>
                        </View>
                      </View>
                    </View>
                    <View style={styles.manageActions}>
                      <TouchableOpacity style={styles.actionBtnEdit} onPress={() => navigation.navigate('AddListing', { editItem: item })}>
                        <Ionicons name="pencil" size={16} color="#0A84FF" />
                        <Text style={[styles.actionBtnText, { color: '#0A84FF' }]}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtnDelete} onPress={() => handleDelete(item.id)}>
                        <Ionicons name="trash-outline" size={20} color="#FF3B30" />
                      </TouchableOpacity>
                    </View>
                  </View>
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
          recentMessages.map((msg) => (
            <TouchableOpacity key={msg.id} style={styles.msgCard} onPress={() => navigation.navigate('ChatRoom', { conversationId: msg.id, recipientName: msg.senderName })}>
              {msg.avatar ? (
                <Image source={{ uri: msg.avatar }} style={styles.msgAvatar} />
              ) : (
                <View style={[styles.msgAvatar, { backgroundColor: '#F0F5FF' }]}>
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
          ))
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
              <MenuLink icon="people" label="Discover People" color="#FF9500" onPress={() => { setMenuVisible(false); navigation.navigate('UserList'); }} />
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
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', paddingTop: Platform.OS === 'ios' ? 80 : 50, paddingHorizontal: 20, paddingBottom: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 5 },
  menuBtn: { padding: 4 },
  greeting: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#000' },
  subtitle: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  inboxBtn: { backgroundColor: '#F0F5FF' },
  unreadBadge: { position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF3B30', borderWidth: 1, borderColor: '#FFF' },
  
  // Menu Styles
  menuOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, flexDirection: 'row' },
  overlayClose: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  menuContent: { width: '82%', backgroundColor: '#FFF', height: '100%', paddingTop: 80, paddingHorizontal: 24, overflow: 'hidden' },
  decorCircle: { position: 'absolute', top: -100, right: -100, width: 300, height: 300, borderRadius: 150, backgroundColor: '#0A84FF', opacity: 0.05 },
  menuProfile: { flexDirection: 'row', alignItems: 'center', marginBottom: 40, zIndex: 1 },
  menuAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginRight: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 10, elevation: 4 },
  menuAvatarImg: { width: '100%', height: '100%' },
  menuName: { fontFamily: 'Poppins_700Bold', fontSize: 19, color: '#000' },
  menuRole: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93' },
  menuItems: { flex: 1, zIndex: 1 },
  menuLink: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  menuIconBox: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  menuLinkLabel: { flex: 1, fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#1C1C1E' },
  menuDivider: { height: 1, backgroundColor: '#F2F2F7', marginVertical: 15 },
  versionTag: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#C7C7CC', textAlign: 'center', marginBottom: 40 },
  
  scroll: { paddingBottom: 120 },
  
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, marginTop: 24, marginBottom: 24 },
  statCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 20, padding: 16, alignItems: 'flex-start', marginHorizontal: 5, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 12, elevation: 3 },
  statValue: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#000', marginTop: 10 },
  statLabel: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#8E8E93' },

  actionBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A84FF', marginHorizontal: 20, borderRadius: 24, padding: 20, marginBottom: 30, shadowColor: '#0A84FF', shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  bannerIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  bannerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FFF' },
  bannerSub: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#E0F0FF', marginTop: 2 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#000' },
  seeAll: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#0A84FF' },
  
  emptyBox: { marginHorizontal: 20, padding: 40, backgroundColor: '#FFF', borderRadius: 24, alignItems: 'center', borderWidth: 1, borderColor: '#F0F0F0', borderStyle: 'dashed' },
  emptyText: { fontFamily: 'Poppins_500Medium', fontSize: 15, color: '#8E8E93', textAlign: 'center' },
  emptyAddBtn: { marginTop: 20, backgroundColor: '#0A84FF', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  emptyAddBtnText: { color: '#FFF', fontFamily: 'Poppins_600SemiBold', fontSize: 14 },

  manageCard: { backgroundColor: '#FFF', borderRadius: 24, padding: 16, marginBottom: 16, marginHorizontal: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 15, elevation: 4 },
  manageCardContent: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  manageImg: { width: 85, height: 85, borderRadius: 18 },
  manageInfo: { flex: 1, marginLeft: 16 },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  activeBadge: { backgroundColor: '#E5F9EB', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  activeBadgeText: { color: '#34C759', fontSize: 10, fontFamily: 'Poppins_700Bold' },
  manageTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000', marginBottom: 6 },
  managePrice: { fontFamily: 'Poppins_700Bold', fontSize: 15, color: '#0A84FF' },
  manageStatsRow: { flexDirection: 'row', alignItems: 'center' },
  manageStat: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  manageStatText: { fontFamily: 'Poppins_500Medium', fontSize: 12, color: '#8E8E93', marginLeft: 4 },
  
  manageActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#F5F5F5', paddingTop: 16, justifyContent: 'space-between', alignItems: 'center' },
  actionBtnEdit: { flex: 1, flexDirection: 'row', backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center', height: 44, borderRadius: 12, marginRight: 12 },
  actionBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, marginLeft: 8 },
  actionBtnDelete: { width: 44, height: 44, backgroundColor: '#FFF0F0', justifyContent: 'center', alignItems: 'center', borderRadius: 12 },

  msgCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', marginHorizontal: 20, padding: 16, borderRadius: 20, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 10, elevation: 3 },
  msgAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: 14, overflow: 'hidden' },
  msgName: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000' },
  msgTime: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#A0A0A0' },
  msgPreview: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', marginTop: 2 }
});
