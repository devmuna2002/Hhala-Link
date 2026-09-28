import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Image, StatusBar, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getSessionUser } from '../supabase';
import { ChatRowSkeleton } from '../components/Skeleton';
import { useFocusEffect } from '@react-navigation/native';

export default function UserListScreen({ navigation }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [unreadConversations, setUnreadConversations] = useState(new Set());

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [])
  );

  const fetchData = async () => {
    try {
      const user = await getSessionUser();
      if (!user) {
        setLoading(false);
        setRefreshing(false);
        return;
      }
      setCurrentUserId(user.id);
      // Stale-while-revalidate: paint the cached list instantly, then
      // silently replace it with fresh rows below.
      try {
        const cached = await AsyncStorage.getItem(`cached_conversations_${user.id}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) setConversations(parsed);
        }
      } catch (_) {}
      await fetchConversations(user.id);
    } catch (e) {
      console.log('Error during chat init:', e?.message || e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const fetchConversations = async (userId) => {
    // The two reads are independent — fire them together, not back-to-back.
    // Messages embed only the preview columns (body/created_at); sender_id
    // and status were transferred but never rendered.
    const [convRes, unreadRes] = await Promise.all([
      supabase
        .from('conversations')
        .select(`
          id, participant_a, participant_b, property_id, last_message_at,
          participant_a_profile:profiles!participant_a(id, first_name, last_name, avatar_url, role, business_name, last_seen),
          participant_b_profile:profiles!participant_b(id, first_name, last_name, avatar_url, role, business_name, last_seen),
          messages(body, created_at)
        `)
        .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
        .order('last_message_at', { ascending: false }),
      supabase
        .from('messages')
        .select('conversation_id')
        .neq('status', 'read')
        .neq('sender_id', userId),
    ]);

    // Fetch unread messages for this user
    if (unreadRes.data) {
      setUnreadConversations(new Set(unreadRes.data.map(m => m.conversation_id)));
    }

    const data = convRes.data;
    if (data) {
      // One row per conversation (not per person): the same two people can
      // now hold a separate exchange for each property.
      const formatted = [];

      data.forEach(c => {
        const otherProfile = c.participant_a === userId ? c.participant_b_profile : c.participant_a_profile;
        if (!otherProfile) return;

        const sortedMsgs = (c.messages || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        const lastMsg = sortedMsgs[0];

          formatted.push({
            ...c,
            otherProfile,
            // Cached rows carry no message history — keep their stored
            // preview instead of resetting to the placeholder.
            lastMessage: lastMsg ? lastMsg.body : (c.lastMessage || 'Active in chat'),
            lastMessageTime: lastMsg ? lastMsg.created_at : (c.lastMessageTime || c.last_message_at)
          });
      });

      // Batched property titles (single query) so parallel chats with the
      // same person are labeled with their listing.
      const propIds = [...new Set(formatted.map(c => c.property_id).filter(Boolean))];
      if (propIds.length > 0) {
        try {
          const { data: props } = await supabase
            .from('properties')
            .select('id, title')
            .in('id', propIds);
          const titleById = new Map((props || []).map(p => [String(p.id), p.title]));
          formatted.forEach(c => {
            if (c.property_id) c.propertyTitle = titleById.get(String(c.property_id)) || null;
          });
        } catch (_) {}
      }

      setConversations(formatted);
      // Strip the embedded message history before caching — previews are
      // rebuilt on refresh and the bodies would bloat storage.
      const cacheable = formatted.map(({ messages, ...rest }) => rest);
      AsyncStorage.setItem(`cached_conversations_${userId}`, JSON.stringify(cacheable)).catch(() => {});
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
    const name = `${c.otherProfile?.first_name || ''} ${c.otherProfile?.last_name || ''} ${c.otherProfile?.business_name || ''}`.toLowerCase();
    const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase()) || (c.lastMessage || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const totalUnreadCount = unreadConversations.size;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* iOS Large Title Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={26} color="#111111" />
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
            <Ionicons name="reload" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Floating Curved Pill Search Bar */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#8A8A8A" />
          <TextInput 
            placeholder="Search messages or people..." 
            placeholderTextColor="#8E8E93" 
            style={styles.searchInput} 
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4, marginRight: 8 }}>
              <Ionicons name="close-circle" size={18} color="#8E8E93" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView 
        contentContainerStyle={styles.list} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#111111" colors={['#0A84FF']} progressBackgroundColor="#FFFFFF" />}
      >
        {loading ? (
          <View>
            {[0, 1, 2, 3, 4].map((i) => (
              <ChatRowSkeleton key={`skel-${i}`} />
            ))}
          </View>
        ) : (
          <>
            {/* Threads-style conversation list */}
            {filteredConversations.length > 0 &&
              filteredConversations.map((c, index) => {
                const isUnread = unreadConversations.has(c.id);
                // Personal name first — a mover/agent business name (e.g.
                // "... Freight ...") must never stand in for the person.
                const personalName = `${c.otherProfile?.first_name || ''} ${c.otherProfile?.last_name || ''}`.trim();
                const displayName = personalName || c.otherProfile?.business_name || 'Hlala User';
                const isLast = index === filteredConversations.length - 1;

                return (
                  <TouchableOpacity 
                    key={c.id} 
                    style={[styles.chatRow, !isLast && styles.rowBorder]}
                    onPress={() => navigation.navigate('ChatRoom', { 
                      conversationId: c.id, 
                      participantB: c.otherProfile?.id,
                      recipientName: displayName,
                      recipientAvatar: c.otherProfile?.avatar_url || null,
                      propertyId: c.property_id || null
                    })}
                    activeOpacity={0.7}
                  >
                    {/* Avatar with Online Indicator */}
                    <View style={styles.avatarContainer}>
                      {c.otherProfile?.avatar_url ? (
                        <Image source={{ uri: c.otherProfile.avatar_url }} style={styles.avatar} />
                      ) : (
                        <View style={styles.avatarPlaceholder}>
                          <Ionicons
                            name={c.otherProfile?.role === 'mover' ? 'swap-horizontal' : c.otherProfile?.role === 'agent' ? 'business' : 'person'}
                            size={22}
                            color="#111111"
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
                          {!!c.propertyTitle && (
                            <Text style={styles.chatProperty} numberOfLines={1}>
                              Re: {c.propertyTitle}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
            {filteredConversations.length === 0 && (
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="chatbubbles" size={40} color="#8A8A8A" />
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
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF'
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 4, marginRight: 6 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: '#000000', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Threads gray pill search bar
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: '#FFFFFF',
    zIndex: 100
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F0F0',
    height: 46,
    borderRadius: 23,
    paddingLeft: 14,
    paddingRight: 14,
  },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 14, color: '#1A1A1A', paddingVertical: 0 },

  list: { paddingBottom: 120, paddingTop: 4 },
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
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: '#FFFFFF',
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFEF',
  },
  avatarContainer: { position: 'relative' },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarPlaceholder: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F0F0F0' },
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
    fontSize: 17, 
    fontWeight: '600', 
    color: '#000000', 
    flex: 1, 
    marginRight: 6 
  },
  chatNameUnread: {
    fontWeight: '700',
  },
  chatTime: {
    fontSize: 13,
    color: '#8E8E93',
  },
  chatTimeUnread: {
    color: '#111111',
    fontWeight: '600',
  },

  chatSnippetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  chatSnippet: { 
    fontSize: 15, 
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
    backgroundColor: '#111111',
    marginLeft: 4
  },
  chatProperty: {
    fontSize: 12,
    color: '#0A84FF',
    marginTop: 2,
  },

  statusText: { 
    fontSize: 12, 
    color: '#8E8E93',
    marginTop: 2,
  },

  userActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  loadingWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 60, gap: 10 },
  loadingText: { fontSize: 14, color: '#8A8A8A' },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000000', marginBottom: 4 },
  emptySubtitle: { fontSize: 13, color: '#8E8E93', textAlign: 'center', lineHeight: 18 },
});
