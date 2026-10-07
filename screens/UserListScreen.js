import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Image, StatusBar, RefreshControl, Alert, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';
import { ChatRowSkeleton } from '../components/Skeleton';
import { useFocusEffect } from '@react-navigation/native';

export default function UserListScreen({ navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [unreadConversations, setUnreadConversations] = useState(new Set());
  const [connectPeople, setConnectPeople] = useState([]);
  const connectedIdsRef = useRef(new Set());
  const refreshAnimation = useRef(new Animated.Value(0)).current;

  const refreshRotation = refreshAnimation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  useEffect(() => {
    if (!refreshing) {
      refreshAnimation.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.timing(refreshAnimation, {
      toValue: 1,
      duration: 750,
      easing: Easing.linear,
      useNativeDriver: true,
    }));
    loop.start();
    return () => loop.stop();
  }, [refreshing, refreshAnimation]);

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
        return;
      }
      setCurrentUserId(user.id);
      // Supabase-first: fetch live rows. The cache is written on success
      // and read only when the network fails (catch path below).
      await fetchConversations(user.id);
    } catch (e) {
      console.log('Error during chat init:', e?.message || e);
      // Offline fallback: last cached list (only read when the DB fails).
      try {
        const user = await getSessionUser();
        if (user) {
          const cached = await AsyncStorage.getItem(`cached_conversations_${user.id}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) setConversations(parsed);
          }
        }
      } catch (_) {}
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    if (refreshing) return;
    const startedAt = Date.now();
    setRefreshing(true);
    try {
      await fetchData();
    } finally {
      const remaining = 400 - (Date.now() - startedAt);
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
      setRefreshing(false);
    }
  };

  const fetchConversations = async (userId) => {
    const [convRes, peopleRes] = await Promise.all([
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
        .from('profiles')
        .select('id, first_name, last_name, business_name, avatar_url, role, city')
        .neq('id', userId)
        .limit(40),
    ]);
    const data = convRes.data;
    const profileRows = peopleRes.data || [];
    const participantsFor = conversation => [
      conversation.participant_a ?? conversation.participant_one,
      conversation.participant_b ?? conversation.participant_two,
    ];
    const chattedWith = new Set((data || []).map(conversation => {
      const [participantA, participantB] = participantsFor(conversation);
      return String(String(participantA) === String(userId) ? participantB : participantA);
    }));
    const suggestions = profileRows.filter(person => {
      const id = String(person.id || '');
      return id && id !== String(userId) && !chattedWith.has(id) && !connectedIdsRef.current.has(id);
    }).slice(0, 10);
    setConnectPeople(suggestions);
    if (data) {
      setUnreadConversations(new Set(data.filter(c => Number(c.unread_count) > 0).map(c => c.id)));
      // One row per conversation (not per person): the same two people can
      // now hold a separate exchange for each property.
      const formatted = [];

      data.forEach(c => {
        const [participantA] = participantsFor(c);
        const otherProfile = String(participantA) === String(userId) ? c.participant_b_profile : c.participant_a_profile;
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

  const connectWithPerson = async (person) => {
    const user = await getSessionUser();
    if (!user || !person?.id) return;
    const recipientName = `${person.first_name || ''} ${person.last_name || ''}`.trim() || person.business_name || 'Hlala member';
    const { data, error } = await supabase
      .from('conversations')
      .insert({ participant_a: user.id, participant_b: person.id, property_id: null })
      .select()
      .single();
    if (error || !data?.id) {
      Alert.alert('Could not connect', error?.message || 'Please try again.');
      return;
    }
    connectedIdsRef.current.add(String(person.id));
    setConnectPeople(previous => previous.filter(item => String(item.id) !== String(person.id)));
    await fetchConversations(user.id);
    navigation.navigate('ChatRoom', {
      conversationId: data.id,
      participantB: person.id,
      recipientName,
      recipientAvatar: person.avatar_url || null,
      recipientRole: person.role || null,
    });
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
      <StatusBar barStyle={t.statusBar} backgroundColor={t.bg} />

      {/* iOS Large Title Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={26} color={t.text} />
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
            onPress={onRefresh}
            disabled={refreshing}
            activeOpacity={0.7}
          >
            <Animated.View style={{ transform: [{ rotate: refreshRotation }] }}>
              <Ionicons name="reload" size={20} color={t.text} />
            </Animated.View>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text} colors={['#0A84FF']} progressBackgroundColor={t.card} />}
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
                  <View
                    key={c.id} 
                    style={[styles.chatRow, !isLast && styles.rowBorder]}
                  >
                    <TouchableOpacity
                      style={styles.chatMain}
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
                            <Text style={styles.avatarInitial}>
                              {((displayName || 'H').trim()[0] || 'H').toUpperCase()}
                            </Text>
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
                            style={[styles.chatSnippet, isUnread && styles.chatSnippetUnread]}
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
                    <TouchableOpacity
                      style={styles.profileShortcut}
                      onPress={() => c.otherProfile?.id && navigation.navigate('PublicProfile', { userId: c.otherProfile.id })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`View ${displayName}'s profile`}
                    >
                      <Ionicons name="person-circle-outline" size={25} color={t.sub} />
                    </TouchableOpacity>
                  </View>
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
            {connectPeople.length > 0 && (
              <View style={styles.connectSection}>
                <View style={styles.connectHeader}>
                  <View>
                    <Text style={styles.connectTitle}>Connect</Text>
                    <Text style={styles.connectSubtitle}>People you may know</Text>
                  </View>
                  <Ionicons name="people-outline" size={21} color={t.sub} />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.connectList}>
                  {connectPeople.map(person => {
                    const personName = `${person.first_name || ''} ${person.last_name || ''}`.trim() || person.business_name || 'Hlala member';
                    return (
                      <View key={String(person.id)} style={styles.personCard}>
                        <TouchableOpacity
                          style={styles.personProfile}
                          onPress={() => navigation.navigate('PublicProfile', { userId: person.id })}
                          activeOpacity={0.75}
                          accessibilityRole="button"
                          accessibilityLabel={`View ${personName}'s profile`}
                        >
                          {person.avatar_url ? (
                            <Image source={{ uri: person.avatar_url }} style={styles.personAvatar} />
                          ) : (
                            <View style={styles.personAvatarFallback}>
                              <Text style={styles.personInitial}>{personName.charAt(0).toUpperCase()}</Text>
                            </View>
                          )}
                          <Text style={styles.personName} numberOfLines={1}>{personName}</Text>
                          <Text style={styles.personMeta} numberOfLines={1}>{person.role || person.city || 'Hlala member'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.connectButton}
                          onPress={() => connectWithPerson(person)}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="chatbubble-ellipses" size={14} color="#FFFFFF" />
                          <Text style={styles.connectButtonText}>Connect</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
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

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 40,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: t.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 4, marginRight: 6 },
  headerTitle: { fontSize: 24, fontWeight: '700', color: t.text, letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 12, color: t.sub, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
  },
  
  // Threads gray pill search bar
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: t.bg,
    zIndex: 100
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.input,
    height: 46,
    borderRadius: 23,
    paddingLeft: 14,
    paddingRight: 14,
  },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 14, color: t.text, paddingVertical: 0 },

  list: { paddingBottom: 120, paddingTop: 4 },
  connectSection: { paddingTop: 24, paddingBottom: 20 },
  connectHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  connectTitle: { fontSize: 19, fontWeight: '700', color: t.text },
  connectSubtitle: { fontSize: 13, color: t.sub, marginTop: 2 },
  connectList: { paddingHorizontal: 16, gap: 10 },
  personCard: { width: 148, minHeight: 188, padding: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: t.hairline, backgroundColor: t.card, alignItems: 'center' },
  personProfile: { width: '100%', alignItems: 'center' },
  personAvatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: t.tile },
  personAvatarFallback: { width: 54, height: 54, borderRadius: 27, backgroundColor: t.tile, alignItems: 'center', justifyContent: 'center' },
  personInitial: { fontSize: 20, fontWeight: '700', color: t.text },
  personName: { width: '100%', marginTop: 9, fontSize: 13, fontWeight: '600', color: t.text, textAlign: 'center' },
  personMeta: { width: '100%', marginTop: 3, fontSize: 11, color: t.sub, textAlign: 'center', textTransform: 'capitalize' },
  connectButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 34, width: '100%', borderRadius: 17, backgroundColor: '#0A84FF', marginTop: 'auto' },
  connectButtonText: { fontSize: 12, fontWeight: '600', color: '#FFFFFF' },
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
    backgroundColor: t.card,
  },
  chatMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  profileShortcut: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  avatarContainer: { position: 'relative' },
  avatar: { width: 52, height: 52, borderRadius: 26 },
  avatarPlaceholder: { width: 52, height: 52, borderRadius: 26, justifyContent: 'center', alignItems: 'center', backgroundColor: t.tile },
  avatarInitial: { fontSize: 20, fontWeight: '700', color: t.text },
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
    color: t.text, 
    flex: 1, 
    marginRight: 6 
  },
  chatNameUnread: {
    fontWeight: '700',
  },
  chatTime: {
    fontSize: 13,
    color: t.sub,
  },
  chatTimeUnread: {
    color: t.text,
    fontWeight: '600',
  },

  chatSnippetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  chatSnippet: { 
    fontSize: 15, 
    color: t.sub, 
    flex: 1 
  },
  chatSnippetUnread: {
    color: t.text,
    fontWeight: '600',
  },
  unreadPill: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.text,
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
  loadingText: { fontSize: 14, color: t.sub },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: t.text, marginBottom: 4 },
  emptySubtitle: { fontSize: 13, color: t.sub, textAlign: 'center', lineHeight: 18 },
});
