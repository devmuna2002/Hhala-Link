import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Image, StatusBar, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { useFocusEffect } from '@react-navigation/native';

const IOS_BLUE = '#007AFF';
const IOS_GREEN = '#34C759';
const IOS_GRAY = '#8E8E93';

const ROLE_CONFIG = {
  agent: { label: 'Agent', color: '#007AFF', bg: '#EAF3FF' },
  mover: { label: 'Mover', color: '#34C759', bg: '#EFFBF0' },
  tenant: { label: 'Tenant', color: '#8E8E93', bg: '#F2F2F7' },
  admin: { label: 'Admin', color: '#FF3B30', bg: '#FFF0EF' },
};

export default function UserListScreen({ navigation }) {
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState('all'); // 'all', 'agent', 'mover', 'tenant'
  const [currentUserId, setCurrentUserId] = useState(null);
  const [followingIds, setFollowingIds] = useState(new Set());
  const [unreadConversations, setUnreadConversations] = useState(new Set());

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [])
  );

  const fetchData = async () => {
    const convs = await fetchConversations();
    await Promise.all([fetchUsers(convs), checkFollowing()]);
    setLoading(false);
    setRefreshing(false);
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const fetchConversations = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    setCurrentUserId(user.id);

    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        participant_a_profile:profiles!participant_a(id, first_name, last_name, avatar_url, role, business_name, last_seen),
        participant_b_profile:profiles!participant_b(id, first_name, last_name, avatar_url, role, business_name, last_seen),
        messages(body, created_at, sender_id, status)
      `)
      .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
      .order('last_message_at', { ascending: false });

    // Fetch unread messages for this user
    const { data: unreadData } = await supabase
      .from('messages')
      .select('conversation_id')
      .neq('status', 'read')
      .neq('sender_id', user.id);
      
    if (unreadData) {
      setUnreadConversations(new Set(unreadData.map(m => m.conversation_id)));
    }

    if (data) {
      const seen = new Set();
      const formatted = [];
      
      data.forEach(c => {
        const otherProfile = c.participant_a === user.id ? c.participant_b_profile : c.participant_a_profile;
        if (otherProfile && !seen.has(otherProfile.id)) {
          seen.add(otherProfile.id);
          
          const sortedMsgs = (c.messages || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const lastMsg = sortedMsgs[0];

          formatted.push({
            ...c,
            otherProfile,
            lastMessage: lastMsg ? lastMsg.body : 'Active in chat',
            lastMessageTime: lastMsg ? lastMsg.created_at : c.last_message_at
          });
        }
      });
      setConversations(formatted);
      return formatted.map(c => c.otherProfile?.id).filter(Boolean);
    }
    return [];
  };

  const fetchUsers = async (excludeIds = []) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    let query = supabase
      .from('profiles')
      .select('id, first_name, last_name, avatar_url, role, business_name, last_seen')
      .neq('id', user?.id)
      .order('last_seen', { ascending: false });

    if (excludeIds.length > 0) {
      query = query.not('id', 'in', `(${excludeIds.join(',')})`);
    }

    const { data, error } = await query;

    if (!error && data) {
      const uniqueUsers = [];
      const seenNames = new Set();
      data.forEach(u => {
        const fullName = `${u.first_name || ''} ${u.last_name || ''}`.trim().toLowerCase();
        if (fullName && !seenNames.has(fullName)) {
          seenNames.add(fullName);
          uniqueUsers.push(u);
        }
      });
      setUsers(uniqueUsers);
    }
  };

  const checkFollowing = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('user_follows')
      .select('following_id')
      .eq('follower_id', user.id);
    
    if (data) {
      setFollowingIds(new Set(data.map(f => f.following_id)));
    }
  };

  const handleFollow = async (targetId) => {
    if (!currentUserId) return;
    const isFollowing = followingIds.has(targetId);

    if (isFollowing) {
      await supabase.from('user_follows').delete().eq('follower_id', currentUserId).eq('following_id', targetId);
      setFollowingIds(prev => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
    } else {
      await supabase.from('user_follows').insert({ follower_id: currentUserId, following_id: targetId });
      setFollowingIds(prev => new Set([...prev, targetId]));
    }
  };

  const formatTimeAgo = (dateStr) => {
    if (!dateStr) return '';
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatLastSeen = (dateStr) => {
    if (!dateStr) return 'Offline';
    const now = new Date();
    const date = new Date(dateStr);
    const diff = Math.floor((now - date) / 1000);
    if (diff < 300) return 'Online';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const filteredConversations = conversations.filter(c => {
    const role = c.otherProfile?.role || 'tenant';
    const matchesTab = selectedTab === 'all' || role === selectedTab;
    const name = `${c.otherProfile?.first_name || ''} ${c.otherProfile?.last_name || ''} ${c.otherProfile?.business_name || ''}`.toLowerCase();
    const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase()) || (c.lastMessage || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const filteredUsers = users.filter(u => {
    const role = u.role || 'tenant';
    const matchesTab = selectedTab === 'all' || role === selectedTab;
    const name = `${u.first_name || ''} ${u.last_name || ''} ${u.business_name || ''}`.toLowerCase();
    const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const totalUnreadCount = unreadConversations.size;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* iOS Large Title Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={26} color={IOS_BLUE} />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>Messages</Text>
            <Text style={styles.headerSubtitle}>
              {totalUnreadCount > 0 ? `${totalUnreadCount} unread message${totalUnreadCount > 1 ? 's' : ''}` : 'All chats up to date'}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity 
            style={styles.headerBtn}
            onPress={fetchData}
            activeOpacity={0.7}
          >
            <Ionicons name="reload" size={18} color={IOS_BLUE} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Floating Curved Pill Search Bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#8E8E93" />
          <TextInput 
            placeholder="Search messages or people..." 
            placeholderTextColor="#8E8E93" 
            style={styles.searchInput} 
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4, marginRight: 4 }}>
              <Ionicons name="close-circle" size={18} color="#8E8E93" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.filterBtn} onPress={() => {}}>
            <Ionicons name="search" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Segmented Filter Pills */}
      <View style={styles.tabBar}>
        {[
          { id: 'all', label: 'All' },
          { id: 'agent', label: 'Agents' },
          { id: 'mover', label: 'Movers' },
          { id: 'tenant', label: 'Tenants' },
        ].map(tab => {
          const isActive = selectedTab === tab.id;
          return (
            <TouchableOpacity 
              key={tab.id}
              style={[styles.tabItem, isActive && styles.tabItemActive]}
              onPress={() => setSelectedTab(tab.id)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView 
        contentContainerStyle={styles.list} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={IOS_BLUE} />}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={IOS_BLUE} />
            <Text style={styles.loadingText}>Loading conversations…</Text>
          </View>
        ) : (
          <>
            {/* WhatsApp / iOS Active Chats List */}
            {filteredConversations.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Chats</Text>
                <View style={styles.groupedCard}>
                  {filteredConversations.map((c, index) => {
                    const isUnread = unreadConversations.has(c.id);
                    const roleConfig = ROLE_CONFIG[c.otherProfile?.role] || ROLE_CONFIG.tenant;
                    const displayName = c.otherProfile?.business_name || `${c.otherProfile?.first_name || ''} ${c.otherProfile?.last_name || ''}`.trim() || 'Hlala User';
                    const isLast = index === filteredConversations.length - 1;

                    return (
                      <TouchableOpacity 
                        key={c.id} 
                        style={[styles.chatRow, !isLast && styles.rowBorder]}
                        onPress={() => navigation.navigate('ChatRoom', { 
                          conversationId: c.id, 
                          participantB: c.otherProfile?.id,
                          recipientName: displayName,
                          propertyId: c.property_id || null
                        })}
                        activeOpacity={0.7}
                      >
                        {/* Avatar with Online Indicator */}
                        <View style={styles.avatarContainer}>
                          {c.otherProfile?.avatar_url ? (
                            <Image source={{ uri: c.otherProfile.avatar_url }} style={styles.avatar} />
                          ) : (
                            <View style={[styles.avatarPlaceholder, { backgroundColor: roleConfig.color + '15' }]}>
                              <Ionicons 
                                name={c.otherProfile?.role === 'mover' ? 'cube' : c.otherProfile?.role === 'agent' ? 'business' : 'person'} 
                                size={22} 
                                color={roleConfig.color} 
                              />
                            </View>
                          )}
                          {formatLastSeen(c.otherProfile?.last_seen) === 'Online' && (
                            <View style={styles.onlineBadge} />
                          )}
                        </View>

                        {/* Middle Chat Details */}
                        <View style={styles.chatInfo}>
                          <View style={styles.chatHeaderRow}>
                            <Text style={[styles.chatName, isUnread && styles.chatNameUnread]} numberOfLines={1}>
                              {displayName}
                            </Text>
                            <Text style={[styles.chatTime, isUnread && styles.chatTimeUnread]}>
                              {formatTimeAgo(c.lastMessageTime)}
                            </Text>
                          </View>

                          <View style={styles.chatSnippetRow}>
                            <View style={[styles.roleBadge, { backgroundColor: roleConfig.bg }]}>
                              <Text style={[styles.roleBadgeText, { color: roleConfig.color }]}>
                                {roleConfig.label}
                              </Text>
                            </View>
                            <Text 
                              style={[
                                styles.chatSnippet, 
                                isUnread && styles.chatSnippetUnread
                              ]} 
                              numberOfLines={1}
                            >
                              {c.lastMessage}
                            </Text>
                            {isUnread && <View style={styles.unreadPill} />}
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Discover & Start a Conversation */}
            {filteredUsers.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {searchQuery ? 'Matching People' : 'Discover & Connect'}
                </Text>
                <View style={styles.groupedCard}>
                  {filteredUsers.map((user, index) => {
                    const roleConfig = ROLE_CONFIG[user.role] || ROLE_CONFIG.tenant;
                    const displayName = user.business_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User';
                    const isLast = index === filteredUsers.length - 1;

                    return (
                      <View key={user.id} style={[styles.chatRow, !isLast && styles.rowBorder]}>
                        <View style={styles.avatarContainer}>
                          {user.avatar_url ? (
                            <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
                          ) : (
                            <View style={[styles.avatarPlaceholder, { backgroundColor: roleConfig.color + '15' }]}>
                              <Ionicons 
                                name={user.role === 'mover' ? 'cube' : user.role === 'agent' ? 'business' : 'person'} 
                                size={22} 
                                color={roleConfig.color} 
                              />
                            </View>
                          )}
                          {formatLastSeen(user.last_seen) === 'Online' && (
                            <View style={styles.onlineBadge} />
                          )}
                        </View>
                        
                        <View style={styles.chatInfo}>
                          <View style={styles.chatHeaderRow}>
                            <Text style={styles.chatName} numberOfLines={1}>{displayName}</Text>
                            <View style={[styles.roleBadge, { backgroundColor: roleConfig.bg }]}>
                              <Text style={[styles.roleBadgeText, { color: roleConfig.color }]}>
                                {roleConfig.label}
                              </Text>
                            </View>
                          </View>
                          <Text style={[styles.statusText, formatLastSeen(user.last_seen) === 'Online' && { color: IOS_GREEN }]}>
                            {formatLastSeen(user.last_seen) === 'Online' ? 'Online now' : `Active ${formatLastSeen(user.last_seen)}`}
                          </Text>
                        </View>

                        <View style={styles.userActions}>
                          {user.id !== currentUserId && (
                            <TouchableOpacity 
                              style={[styles.followBtn, followingIds.has(user.id) && styles.followingBtnActive]} 
                              onPress={() => handleFollow(user.id)}
                              activeOpacity={0.75}
                            >
                              <Ionicons 
                                name={followingIds.has(user.id) ? "checkmark" : "person-add-outline"} 
                                size={14} 
                                color={followingIds.has(user.id) ? "#8E8E93" : IOS_BLUE} 
                              />
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity 
                            style={styles.messageIconBtn} 
                            onPress={() => navigation.navigate('ChatRoom', { 
                              participantB: user.id,
                              recipientName: displayName,
                              recipientRole: user.role
                            })}
                            activeOpacity={0.8}
                          >
                            <Ionicons name="chatbubble" size={14} color="#FFFFFF" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {filteredConversations.length === 0 && filteredUsers.length === 0 && (
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="chatbubbles-outline" size={40} color={IOS_BLUE} />
                </View>
                <Text style={styles.emptyTitle}>No Messages Found</Text>
                <Text style={styles.emptySubtitle}>
                  {searchQuery ? 'Try searching for a different name or message.' : 'Start a conversation with an agent or mover.'}
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  
  // iOS Header
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: Platform.OS === 'ios' ? 56 : 40, 
    paddingHorizontal: 16, 
    paddingBottom: 10, 
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, 
    borderBottomColor: '#C6C6C8' 
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 4, marginRight: 6 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#000000', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { 
    width: 36, 
    height: 36, 
    borderRadius: 18, 
    backgroundColor: '#F2F2F7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Floating Curved Search Bar
  searchSection: { 
    paddingHorizontal: 16, 
    paddingTop: 10, 
    paddingBottom: 4,
    backgroundColor: '#F2F2F7',
    zIndex: 100 
  },
  searchBar: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#FFFFFF', 
    height: 50, 
    borderRadius: 25, 
    paddingLeft: 16, 
    paddingRight: 6, 
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    shadowColor: '#000', 
    shadowOpacity: 0.04, 
    shadowRadius: 8, 
    elevation: 2 
  },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 14, color: '#1A1A1A' },
  filterBtn: { 
    width: 38, 
    height: 38, 
    borderRadius: 19, 
    backgroundColor: "#007AFF", 
    justifyContent: 'center', 
    alignItems: 'center', 
    shadowColor: '#007AFF', 
    shadowOpacity: 0.3, 
    shadowRadius: 4, 
    elevation: 3 
  },
  
  // Segmented Filter Tabs
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  tabItem: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#E5E5EA',
  },
  tabItemActive: {
    backgroundColor: '#007AFF',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#666666',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },

  list: { paddingHorizontal: 16, paddingBottom: 120, paddingTop: 4 },
  section: { marginBottom: 20 },
  sectionTitle: { 
    fontSize: 13, 
    fontWeight: '600',
    color: '#666666', 
    marginBottom: 8, 
    textTransform: 'uppercase', 
    letterSpacing: 0.5,
    marginLeft: 4,
  },

  // Grouped Card Container
  groupedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },

  // Chat Row Item
  chatRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5EA',
  },
  avatarContainer: { position: 'relative' },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  onlineBadge: { 
    position: 'absolute', 
    bottom: 0, 
    right: 0, 
    width: 12, 
    height: 12, 
    borderRadius: 6, 
    backgroundColor: '#34C759', 
    borderWidth: 2, 
    borderColor: '#FFFFFF' 
  },
  
  chatInfo: { flex: 1, marginLeft: 12, marginRight: 8 },
  chatHeaderRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 3 
  },
  chatName: { 
    fontSize: 15, 
    fontWeight: '600', 
    color: '#000000', 
    flex: 1, 
    marginRight: 6 
  },
  chatNameUnread: {
    fontWeight: '700',
  },
  chatTime: {
    fontSize: 12,
    color: '#8E8E93',
  },
  chatTimeUnread: {
    color: '#007AFF',
    fontWeight: '600',
  },

  chatSnippetRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 6 
  },
  roleBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  chatSnippet: { 
    fontSize: 13, 
    color: '#8E8E93', 
    flex: 1 
  },
  chatSnippetUnread: {
    color: '#000000',
    fontWeight: '600',
  },
  unreadPill: { 
    width: 8, 
    height: 8, 
    borderRadius: 4, 
    backgroundColor: '#007AFF', 
    marginLeft: 4 
  },

  statusText: { 
    fontSize: 12, 
    color: '#8E8E93',
    marginTop: 2,
  },

  userActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  followBtn: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    backgroundColor: '#EAF3FF', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  followingBtnActive: { 
    backgroundColor: '#F2F2F7' 
  },
  messageIconBtn: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    backgroundColor: '#007AFF', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 60, gap: 10 },
  loadingText: { fontSize: 14, color: '#8E8E93' },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EAF3FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000000', marginBottom: 4 },
  emptySubtitle: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 18 },
});
