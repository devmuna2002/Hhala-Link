import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { useFocusEffect } from '@react-navigation/native';

const ROLE_CONFIG = {
  agent: { label: 'Agent', color: '#0A84FF', bg: '#EBF4FF' },
  mover: { label: 'Mover', color: '#34C759', bg: '#EAF8EE' },
  tenant: { label: 'Tenant', color: '#8E8E93', bg: '#F2F2F7' },
  admin: { label: 'Admin', color: '#FF3B30', bg: '#F2F7FF' },
};

export default function UserListScreen({ navigation }) {
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
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
    setLoading(true);
    const convs = await fetchConversations();
    await Promise.all([fetchUsers(convs), checkFollowing()]);
    setLoading(false);
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

  const formatLastSeen = (lastSeen) => {
    if (!lastSeen) return 'Offline';
    const last = new Date(lastSeen);
    const now = new Date();
    const diff = Math.floor((now - last) / 1000);
    if (diff < 120) return 'Online';
    if (last.toDateString() === now.toDateString()) {
      return `today at ${last.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
    }
    return `${Math.floor(diff / 86400) || 1}d ago`;
  };

  // Filter conversations by tab and search query
  const filteredConversations = conversations.filter(c => {
    const role = c.otherProfile?.role || 'tenant';
    const matchesTab = selectedTab === 'all' || role === selectedTab;
    const name = `${c.otherProfile?.first_name || ''} ${c.otherProfile?.last_name || ''} ${c.otherProfile?.business_name || ''}`.toLowerCase();
    const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const filteredUsers = users.filter(u => {
    const role = u.role || 'tenant';
    const matchesTab = selectedTab === 'all' || role === selectedTab;
    const name = `${u.first_name || ''} ${u.last_name || ''} ${u.business_name || ''}`.toLowerCase();
    const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity 
            style={styles.headerBtn}
            onPress={() => fetchData()}
          >
            <Ionicons name="reload-outline" size={20} color="#0A84FF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#8E8E93" style={styles.searchIcon} />
        <TextInput 
          placeholder="Search agents, movers or tenants..." 
          placeholderTextColor="#8E8E93" 
          style={styles.searchInput} 
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color="#8E8E93" />
          </TouchableOpacity>
        )}
      </View>

      {/* Role Tabs */}
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
            >
              <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Active Conversations */}
            {filteredConversations.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Conversations</Text>
                {filteredConversations.map((c) => {
                  const isUnread = unreadConversations.has(c.id);
                  const roleConfig = ROLE_CONFIG[c.otherProfile?.role] || ROLE_CONFIG.tenant;
                  const displayName = c.otherProfile?.business_name || `${c.otherProfile?.first_name || ''} ${c.otherProfile?.last_name || ''}`.trim() || 'Hlala User';

                  return (
                    <TouchableOpacity 
                      key={c.id} 
                      style={[styles.userRow, isUnread && styles.unreadRow]}
                      onPress={() => navigation.navigate('ChatRoom', { 
                        conversationId: c.id, 
                        participantB: c.otherProfile?.id,
                        recipientName: displayName,
                        propertyId: c.property_id || null
                      })}
                      activeOpacity={0.7}
                    >
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

                      <View style={styles.userInfo}>
                        <View style={styles.nameRow}>
                          <Text style={[styles.name, isUnread && { fontFamily: 'Poppins_700Bold' }]} numberOfLines={1}>
                            {displayName}
                          </Text>
                          <View style={[styles.roleBadge, { backgroundColor: roleConfig.bg }]}>
                            <Text style={[styles.roleBadgeText, { color: roleConfig.color }]}>
                              {roleConfig.label}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.messageRow}>
                          <Text 
                            style={[
                              styles.messageSnippet, 
                              isUnread && { color: '#000', fontFamily: 'Poppins_600SemiBold' }
                            ]} 
                            numberOfLines={1}
                          >
                            {c.lastMessage}
                          </Text>
                          <Text style={styles.timeAgo}>• {formatTimeAgo(c.lastMessageTime)}</Text>
                        </View>
                      </View>

                      {isUnread ? (
                        <View style={styles.unreadDot} />
                      ) : (
                        <Ionicons name="chevron-forward" size={16} color="#C7C7CC" />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Discover & Connect with Agents / Movers / Tenants */}
            {filteredUsers.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {searchQuery ? 'Matching People' : 'Start a Conversation'}
                </Text>
                {filteredUsers.map((user) => {
                  const roleConfig = ROLE_CONFIG[user.role] || ROLE_CONFIG.tenant;
                  const displayName = user.business_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'User';

                  return (
                    <View key={user.id} style={styles.userRow}>
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
                      
                      <View style={styles.userInfo}>
                        <View style={styles.nameRow}>
                          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
                          <View style={[styles.roleBadge, { backgroundColor: roleConfig.bg }]}>
                            <Text style={[styles.roleBadgeText, { color: roleConfig.color }]}>
                              {roleConfig.label}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.status, formatLastSeen(user.last_seen) === 'Online' && { color: '#34C759' }]}>
                          {formatLastSeen(user.last_seen) === 'Online' ? 'Online now' : `Active ${formatLastSeen(user.last_seen)}`}
                        </Text>
                      </View>

                      <View style={styles.actions}>
                        {user.id !== currentUserId && (
                          <TouchableOpacity 
                            style={[styles.actionBtn, followingIds.has(user.id) && styles.followingBtn]} 
                            onPress={() => handleFollow(user.id)}
                          >
                            <Ionicons 
                              name={followingIds.has(user.id) ? "person-remove" : "person-add"} 
                              size={16} 
                              color={followingIds.has(user.id) ? "#8E8E93" : "#0A84FF"} 
                            />
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity 
                          style={[styles.actionBtn, styles.msgBtn]} 
                          onPress={() => navigation.navigate('ChatRoom', { 
                            participantB: user.id, 
                            recipientName: displayName 
                          })}
                        >
                          <Ionicons name="chatbubble-ellipses" size={16} color="#FFF" />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {filteredConversations.length === 0 && filteredUsers.length === 0 && (
              <View style={styles.emptyContainer}>
                <Ionicons name="chatbubbles-outline" size={54} color="#D1D1D6" />
                <Text style={styles.emptyTitle}>No messages found</Text>
                <Text style={styles.emptySubtitle}>Start a chat by contacting an agent or mover from any listing.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: Platform.OS === 'ios' ? 60 : 44, 
    paddingHorizontal: 20, 
    paddingBottom: 12, 
    borderBottomWidth: StyleSheet.hairlineWidth, 
    borderBottomColor: '#E5E5EA' 
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 4, marginRight: 10 },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#000' },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { padding: 6, borderRadius: 20, backgroundColor: '#F2F2F7' },
  
  searchBar: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#F2F2F7', 
    height: 42, 
    borderRadius: 10, 
    marginHorizontal: 16, 
    paddingHorizontal: 12, 
    marginTop: 12, 
    marginBottom: 10 
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#000' },
  
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  tabItem: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
  },
  tabItemActive: {
    backgroundColor: '#0A84FF',
  },
  tabText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#8E8E93',
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontFamily: 'Poppins_600SemiBold',
  },

  list: { paddingHorizontal: 16, paddingBottom: 120, paddingTop: 4 },
  section: { marginBottom: 20 },
  sectionTitle: { 
    fontFamily: 'Poppins_600SemiBold', 
    fontSize: 12, 
    color: '#8E8E93', 
    marginBottom: 10, 
    textTransform: 'uppercase', 
    letterSpacing: 0.8,
    marginTop: 6
  },

  userRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 4, 
    backgroundColor: '#FFF' 
  },
  unreadRow: {
    backgroundColor: '#F0F7FF',
  },
  avatarContainer: { position: 'relative' },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  onlineBadge: { 
    position: 'absolute', 
    bottom: 0, 
    right: 0, 
    width: 13, 
    height: 13, 
    borderRadius: 6.5, 
    backgroundColor: '#34C759', 
    borderWidth: 2, 
    borderColor: '#FFF' 
  },
  
  userInfo: { flex: 1, marginLeft: 12, marginRight: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  name: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000', flexShrink: 1, marginRight: 6 },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 10,
  },

  messageRow: { flexDirection: 'row', alignItems: 'center' },
  messageSnippet: { 
    fontFamily: 'Poppins_400Regular', 
    fontSize: 13, 
    color: '#8E8E93', 
    flexShrink: 1 
  },
  timeAgo: { 
    fontFamily: 'Poppins_400Regular', 
    fontSize: 11, 
    color: '#AEAEB2', 
    marginLeft: 4 
  },
  status: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },

  unreadDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#0A84FF', marginLeft: 6 },

  actions: { flexDirection: 'row', alignItems: 'center' },
  actionBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  followingBtn: { backgroundColor: '#F5F5F5' },
  msgBtn: { backgroundColor: '#0A84FF' },

  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000', marginTop: 14 },
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', textAlign: 'center', marginTop: 6 },
});
