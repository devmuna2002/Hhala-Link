import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Image, StatusBar, RefreshControl, Alert, Animated, Easing, Modal, Pressable } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getSessionUser } from '../supabase';
import { useTheme } from '../utils/theme';
import { ChatRowSkeleton } from '../components/Skeleton';
import { useFocusEffect } from '@react-navigation/native';
import ThreadsButton from '../components/ThreadsButton';
import * as Haptics from 'expo-haptics';

const sameId = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isMsgUnread = (m, userId) => {
  if (!m || sameId(m.sender_id, userId)) return false;
  // Backend booleans arrive as true/false, but tolerate 1/0/'1'/'0' too.
  return !(m.is_read === true || m.is_read === 1 || String(m.is_read).toLowerCase() === 'true' || String(m.is_read) === '1');
};

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
  const [connectingId, setConnectingId] = useState(null);
  const [activeTab, setActiveTab] = useState('inbox');
  const [unreadOnly, setUnreadOnly] = useState(false);
  // Pinned chats (long-press a row): ids, newest pin first. Phone is the
  // source of truth; the server write is best-effort (see migration).
  const [pinnedChats, setPinnedChats] = useState([]);
  const [pinTarget, setPinTarget] = useState(null);
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

  // Live inbox: new arrivals bold without leaving the screen. The cPanel
  // adapter polls the REST API underneath (no postgres_changes on MySQL),
  // so this is a cheap refetch-on-change, not a firehose.
  useEffect(() => {
    let channel = null;
    let cancelled = false;
    getSessionUser().then((user) => {
      if (cancelled || !user?.id) return;
      channel = supabase
        .channel(`inbox_${user.id}_${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
          fetchConversations(user.id).catch(() => {});
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `participant_a=eq.${user.id}` }, () => {
          fetchConversations(user.id).catch(() => {});
        })
        .subscribe();
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const fetchData = async () => {
    try {
      const user = await getSessionUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setCurrentUserId(user.id);
      // Restore pinned chats for the pin-first sort below.
      try {
        const rawPins = await AsyncStorage.getItem(`pinned_chats_${user.id}`);
        const arr = rawPins ? JSON.parse(rawPins) : [];
        if (Array.isArray(arr)) setPinnedChats(arr.map(String));
      } catch (_) {}
      // Instant paint: show the last cached chats first so the list never
      // sits on skeletons, then replace with live rows below.
      try {
        const cached = await AsyncStorage.getItem(`cached_conversations_${user.id}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setConversations(parsed);
            // Restore bold instantly from the cached server counts — the
            // stripped message history can't recompute it, but unread_count
            // survives caching.
            setUnreadConversations(new Set(parsed.filter((c) => Number(c.unread_count) > 0).map((c) => c.id)));
            setLoading(false);
          }
        }
      } catch (_) {}
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
          participant_a_profile:profiles!participant_a(id, first_name, last_name, avatar_url, role, business_name),
          participant_b_profile:profiles!participant_b(id, first_name, last_name, avatar_url, role, business_name),
          messages(id, body, created_at, sender_id, is_read, status)
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
      return String(sameId(participantA, userId) ? participantB : participantA);
    }));
    const suggestions = profileRows.filter(person => {
      const id = String(person.id || '');
      return id && id !== String(userId) && !chattedWith.has(id) && !connectedIdsRef.current.has(id);
    }).slice(0, 10);
    setConnectPeople(suggestions);
    if (data) {
      // Bold = server unread_count OR any incoming message not yet read.
      // The count covers history beyond the last-20 embedded messages; the
      // scan covers rows whose count hasn't caught up yet.
      const unreadIds = new Set(
        data
          .filter((c) => Number(c.unread_count) > 0 || (c.messages || []).some((m) => isMsgUnread(m, userId)))
          .map((c) => c.id)
      );
      // Belt-and-suspenders: an unread message ALERT for a conversation also
      // bolds it, even if its message rows already flipped to read.
      // Self-echoes (my own sent messages coming back) never bold.
      try {
        const { data: notifs } = await supabase
          .from('notifications')
          .select('reference_id, data, actor_id')
          .eq('user_id', userId)
          .eq('is_read', false);
        (Array.isArray(notifs) ? notifs : []).forEach((n) => {
          const senderId = n?.actor_id || n?.data?.senderId || n?.data?.sender_id || null;
          if (senderId && sameId(senderId, userId)) return;
          const key = n?.data?.conversationId || n?.data?.conversation_id || n?.reference_id || null;
          if (key) unreadIds.add(String(key));
        });
      } catch (_) {}
      setUnreadConversations(unreadIds);
      // One row per conversation (not per person): the same two people can
      // now hold a separate exchange for each property.
      const formatted = [];

      data.forEach(c => {
        const [participantA, participantB] = participantsFor(c);
        // Never list self-chat: both sides are me.
        if (sameId(participantA, userId) && sameId(participantB, userId)) return;
        const isMeA = String(participantA || '').trim().toLowerCase() === String(userId || '').trim().toLowerCase();
        const otherProfile = (isMeA ? c.participant_b_profile : c.participant_a_profile) || c.other_user;
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
    // No self-chat: a thread with yourself notifies you about your own
    // messages (the echo comes straight back as a notification).
    if (String(person.id).toLowerCase() === String(user.id).toLowerCase()) return;
    const personId = String(person.id);
    if (connectingId) return;
    setConnectingId(personId);
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
    const recipientName = `${person.first_name || ''} ${person.last_name || ''}`.trim() || person.business_name || 'Hlala member';
    try {
      const pairFilter = `and(participant_a.eq.${user.id},participant_b.eq.${person.id}),and(participant_a.eq.${person.id},participant_b.eq.${user.id})`;
      // General chats carry property_id NULL, which the unique index can
      // never dedupe (NULLs never conflict) — so look first and reuse the
      // pair's general thread instead of blind-inserting another dupe.
      // (Dup threads split history: each side only sees its own messages.)
      try {
        const { data: existing } = await supabase
          .from('conversations')
          .select('id')
          .or(pairFilter)
          .is('property_id', null)
          .order('created_at', { ascending: true })
          .limit(1);
        const hit = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;
        if (hit?.id) {
          connectedIdsRef.current.add(personId);
          setConnectPeople(previous => previous.filter(item => String(item.id) !== personId));
          await fetchConversations(user.id);
          navigation.navigate('ChatRoom', {
            conversationId: hit.id,
            participantB: person.id,
            recipientName,
            recipientAvatar: person.avatar_url || null,
            recipientRole: person.role || null,
          });
          return;
        }
      } catch (_) {}
      const { data, error } = await supabase
        .from('conversations')
        .insert({ participant_a: user.id, participant_b: person.id, property_id: null })
        .select()
        .single();
      let convId = data?.id || null;
      if ((error || !convId) && error?.code === '23505') {
        // Pair thread already exists (unique index) — reuse it instead of failing.
        const { data: legacyRows } = await supabase
          .from('conversations')
          .select('id')
          .or(`and(participant_a.eq.${user.id},participant_b.eq.${person.id}),and(participant_a.eq.${person.id},participant_b.eq.${user.id})`)
          .order('created_at', { ascending: true })
          .limit(1);
        const legacy = Array.isArray(legacyRows) && legacyRows.length > 0 ? legacyRows[0] : null;
        convId = legacy?.id || null;
      }
      if (!convId) {
        Alert.alert('Could not connect', error?.message || 'Please try again.');
        return;
      }
      connectedIdsRef.current.add(personId);
      setConnectPeople(previous => previous.filter(item => String(item.id) !== personId));
      await fetchConversations(user.id);
      navigation.navigate('ChatRoom', {
        conversationId: convId,
        participantB: person.id,
        recipientName,
        recipientAvatar: person.avatar_url || null,
        recipientRole: person.role || null,
      });
    } finally {
      setConnectingId(null);
    }
  };

  const isChatPinned = (c) => !!c && (pinnedChats.some((p) => String(p) === String(c.id)) || c.is_pinned === true);

  const togglePinChat = async (conv) => {
    if (!conv?.id || !currentUserId) return;
    const id = String(conv.id);
    const pinned = pinnedChats.some((p) => String(p) === id);
    const next = pinned
      ? pinnedChats.filter((p) => String(p) !== id)
      : [id, ...pinnedChats.filter((p) => String(p) !== id)];
    setPinnedChats(next);
    setPinTarget(null);
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
    AsyncStorage.setItem(`pinned_chats_${currentUserId}`, JSON.stringify(next)).catch(() => {});
    // Best-effort shared state (works once database/add_chat_pinning.sql
    // is applied; ignored until then).
    try {
      await supabase.from('conversations').update({ is_pinned: !pinned }).eq('id', conv.id);
    } catch (_) {}
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

  // Pinned chats first (newest pin on top), then recency as usual.
  const filteredConversations = conversations
    .filter(c => {
      const name = `${c.otherProfile?.first_name || ''} ${c.otherProfile?.last_name || ''} ${c.otherProfile?.business_name || ''}`.toLowerCase();
      const matchesSearch = !searchQuery || name.includes(searchQuery.toLowerCase()) || (c.lastMessage || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesUnread = !unreadOnly || unreadConversations.has(c.id);
      return matchesSearch && matchesUnread;
    })
    .sort((a, b) => {
      const pa = isChatPinned(a) ? 0 : 1;
      const pb = isChatPinned(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ia = pinnedChats.findIndex((p) => String(p) === String(a.id));
      const ib = pinnedChats.findIndex((p) => String(p) === String(b.id));
      if (ia !== ib) return ia - ib;
      return 0;
    });

  const totalUnreadCount = unreadConversations.size;

  return (
    <View style={styles.container}>
      <StatusBar barStyle={t.statusBar} backgroundColor={t.bg} />

      {/* Threads header: big title + compose */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={26} color={t.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={() => {
              try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
              setActiveTab('requests');
            }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="New message"
          >
            <Ionicons name="create" size={26} color={t.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={onRefresh}
            disabled={refreshing}
            activeOpacity={0.7}
          >
            <Animated.View style={{ transform: [{ rotate: refreshRotation }] }}>
              <Ionicons name="reload" size={26} color={t.text} />
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color={t.sub} />
          <TextInput
            placeholder="Search"
            placeholderTextColor={t.sub}
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={{ padding: 4, marginRight: 8 }}>
              <Ionicons name="close-circle" size={18} color={t.sub} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filter tabs */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.filterBtn, unreadOnly && styles.filterBtnActive]}
          onPress={() => {
            try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
            setUnreadOnly(v => !v);
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Unread only"
        >
          <Ionicons name="options-outline" size={20} color={unreadOnly ? t.bg : t.text} />
        </TouchableOpacity>
        {['inbox', 'requests'].map(tab => {
          const active = activeTab === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabPill, active && styles.tabPillActive]}
              onPress={() => {
                try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
                setActiveTab(tab);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tab === 'inbox' ? 'Inbox' : 'Requests'}
              </Text>
            </TouchableOpacity>
          );
        })}
        {totalUnreadCount > 0 && activeTab === 'inbox' && (
          <Text style={styles.unreadCountText}>{totalUnreadCount} unread</Text>
        )}
      </View>

      <ScrollView 
        contentContainerStyle={styles.list} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.text} colors={[t.text]} progressBackgroundColor={t.card} />}
      >
        {loading ? (
          <View>
            <View style={{ alignItems: 'center', paddingVertical: 16 }}>
              <ActivityIndicator size="small" color={t.text} />
            </View>
            {[0, 1, 2, 3, 4].map((i) => (
              <ChatRowSkeleton key={`skel-${i}`} />
            ))}
          </View>
        ) : (
          <>
            {activeTab === 'inbox' ? (
            <>
            {/* Threads-style conversation list */}
            {filteredConversations.length > 0 &&
              filteredConversations.map((c) => {
                const isUnread = unreadConversations.has(c.id);
                const pinned = isChatPinned(c);
                // Personal name first — a mover/agent business name (e.g.
                // "... Freight ...") must never stand in for the person.
                const personalName = `${c.otherProfile?.first_name || ''} ${c.otherProfile?.last_name || ''}`.trim();
                const displayName = personalName || c.otherProfile?.business_name || 'Hlala User';

                return (
                  <View
                    key={c.id}
                    style={styles.chatRow}
                  >
                    {/* Avatar — taps through to profile */}
                    <TouchableOpacity
                      onPress={() => c.otherProfile?.id && navigation.navigate('PublicProfile', { userId: c.otherProfile.id })}
                      activeOpacity={0.7}
                    >
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
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.chatMain}
                      onPress={() => navigation.navigate('ChatRoom', {
                        conversationId: c.id,
                        participantB: c.otherProfile?.id,
                        recipientName: displayName,
                        recipientAvatar: c.otherProfile?.avatar_url || null,
                        propertyId: c.property_id || null
                      })}
                      onLongPress={() => {
                        try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch (_) {}
                        setPinTarget(c);
                      }}
                      delayLongPress={350}
                      activeOpacity={0.65}
                    >
                      {/* Middle Chat Details */}
                      <View style={styles.chatInfo}>
                        <View style={styles.chatHeaderRow}>
                          <Text style={[styles.chatName, isUnread && styles.chatNameUnread]} numberOfLines={1}>
                            {displayName}
                          </Text>
                          <View style={styles.chatTimeBox}>
                            {pinned && <MaterialIcons name="push-pin" size={22} color={t.text} style={{ transform: [{ rotate: '-45deg' }] }} />}
                            <Text style={[styles.chatTime, isUnread && styles.chatTimeUnread]}>
                              {formatTimeAgo(c.lastMessageTime)}
                            </Text>
                          </View>
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
                      </View>
                    </TouchableOpacity>
                  </View>
                );
                  })}
            {filteredConversations.length === 0 && (
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="chatbubbles-outline" size={36} color={t.sub} />
                </View>
                <Text style={styles.emptyTitle}>No Messages Found</Text>
                <Text style={styles.emptySubtitle}>
                  {searchQuery ? 'Try searching for a different name or message.' : 'Start a conversation with an agent or mover.'}
                </Text>
              </View>
            )}
            </>
            ) : (
            <>
            {connectPeople.length > 0 ? (
              connectPeople.map(person => {
                const personName = `${person.first_name || ''} ${person.last_name || ''}`.trim() || person.business_name || 'Hlala member';
                const isConnecting = connectingId === String(person.id);
                return (
                  <View key={String(person.id)} style={styles.chatRow}>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('PublicProfile', { userId: person.id })}
                      activeOpacity={0.7}
                    >
                      {person.avatar_url ? (
                        <Image source={{ uri: person.avatar_url }} style={styles.avatar} />
                      ) : (
                        <View style={styles.avatarPlaceholder}>
                          <Text style={styles.avatarInitial}>{(personName.charAt(0) || 'H').toUpperCase()}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    <View style={styles.chatInfo}>
                      <Text style={styles.chatName} numberOfLines={1}>{personName}</Text>
                      <Text style={styles.chatSnippet} numberOfLines={1}>{person.role || person.city || 'Hlala member'}</Text>
                    </View>
                    <ThreadsButton
                      title={isConnecting ? 'Connecting…' : 'Connect'}
                      variant="outline"
                      size="sm"
                      loading={isConnecting}
                      onPress={() => connectWithPerson(person)}
                    />
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyWrap}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="people-outline" size={36} color={t.sub} />
                </View>
                <Text style={styles.emptyTitle}>No requests</Text>
                <Text style={styles.emptySubtitle}>New people you can message will appear here.</Text>
              </View>
            )}
            </>
            )}
          </>
        )}
      </ScrollView>

      {/* Long-press chat options (Pin / Unpin) — bottom sheet */}
      <Modal visible={!!pinTarget} transparent animationType="slide" onRequestClose={() => setPinTarget(null)}>
        <View style={styles.pinOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPinTarget(null)} />
          <View style={styles.pinMenu}>
            <View style={styles.pinHandle} />
            {!!pinTarget && (
              <Text style={styles.pinTitle} numberOfLines={1}>
                {`${pinTarget.otherProfile?.first_name || ''} ${pinTarget.otherProfile?.last_name || ''}`.trim() || pinTarget.otherProfile?.business_name || 'Chat'}
              </Text>
            )}
            <View style={styles.pinDivider} />
            <TouchableOpacity style={styles.pinRow} onPress={() => pinTarget && togglePinChat(pinTarget)} activeOpacity={0.6}>
              <Text style={styles.pinRowText}>{pinTarget && isChatPinned(pinTarget) ? 'Unpin chat' : 'Pin chat'}</Text>
            </TouchableOpacity>
            <View style={styles.pinDivider} />
            <TouchableOpacity style={styles.pinRow} onPress={() => setPinTarget(null)} activeOpacity={0.6}>
              <Text style={[styles.pinRowText, { color: t.sub }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingBottom: 6,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { padding: 4, marginRight: 6 },
  headerTitle: { fontSize: 32, fontWeight: '700', color: t.text, letterSpacing: -0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  searchInput: { flex: 1, marginLeft: 10, fontSize: 15, color: t.text, paddingVertical: 0 },

  // Threads filter tabs: icon filter + Inbox / Requests pills
  tabsRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6, gap: 8 },
  filterBtn: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1, borderColor: t.hairline,
    justifyContent: 'center', alignItems: 'center',
  },
  filterBtnActive: { backgroundColor: t.text, borderColor: t.text },
  tabPill: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1, borderColor: t.hairline,
  },
  tabPillActive: { backgroundColor: t.text, borderColor: t.text },
  tabText: { fontSize: 15, fontWeight: '600', color: t.text },
  tabTextActive: { color: t.bg },
  unreadCountText: { fontSize: 13, color: t.sub, marginLeft: 4 },

  list: { paddingBottom: 120, paddingTop: 4 },
  connectSection: { paddingTop: 24, paddingBottom: 20 },
  connectHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12 },
  connectTitle: { fontSize: 19, fontWeight: '700', color: t.text },
  connectSubtitle: { fontSize: 13, color: t.sub, marginTop: 2 },
  connectList: { paddingHorizontal: 16, gap: 10 },
  personCard: { width: 152, minHeight: 192, padding: 12, paddingBottom: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: t.hairline, backgroundColor: t.card, alignItems: 'center', justifyContent: 'flex-start' },
  personProfile: { width: '100%', alignItems: 'center' },
  personAvatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: t.tile },
  personAvatarFallback: { width: 56, height: 56, borderRadius: 28, backgroundColor: t.tile, alignItems: 'center', justifyContent: 'center' },
  personInitial: { fontSize: 20, fontWeight: '700', color: t.text },
  personName: { width: '100%', marginTop: 9, fontSize: 13, fontWeight: '600', color: t.text, textAlign: 'center' },
  personMeta: { width: '100%', marginTop: 3, marginBottom: 10, fontSize: 11, color: t.sub, textAlign: 'center', textTransform: 'capitalize' },
  connectBtnWrap: { width: '100%' },
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
    elevation: Platform.OS === 'android' ? 0 : 1,
  },

  // Chat Row Item
  chatRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: t.card,
  },
  chatMain: { flex: 1, minWidth: 0 },
  profileShortcut: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  avatarContainer: { position: 'relative' },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarPlaceholder: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', backgroundColor: t.tile },
  avatarInitial: { fontSize: 22, fontWeight: '700', color: t.text },
  
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
    fontSize: 14,
    color: t.sub,
  },
  chatTimeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  // Long-press pin bottom sheet (Threads-style)
  pinOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pinMenu: {
    backgroundColor: t.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  pinHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: t.hairline,
    alignSelf: 'center',
    marginBottom: 8,
  },
  pinTitle: {
    fontSize: 14,
    color: t.sub,
    textAlign: 'center',
    paddingVertical: 8,
  },
  pinRow: {
    alignItems: 'center',
    paddingVertical: 15,
  },
  pinRowText: {
    fontSize: 17,
    color: t.text,
    fontWeight: '500',
  },
  pinDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.hairline,
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
  emptyTitle: { fontSize: 20, fontWeight: '700', color: t.text, marginBottom: 4 },
  emptySubtitle: { fontSize: 15, color: t.sub, textAlign: 'center', lineHeight: 22 },
});
