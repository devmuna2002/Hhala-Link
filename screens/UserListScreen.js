import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

export default function UserListScreen({ navigation }) {
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentUserId, setCurrentUserId] = useState(null);
  const [followingIds, setFollowingIds] = useState(new Set());

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    // 1. Fetch conversations first to know who to exclude
    const convs = await fetchConversations();
    // 2. Fetch users and check following
    await Promise.all([fetchUsers(convs), checkFollowing()]);
    setLoading(false);
  };

  const fetchConversations = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('conversations')
      .select(`
        *,
        participant_a_profile:profiles!participant_a(*),
        participant_b_profile:profiles!participant_b(*)
      `)
      .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
      .order('last_message_at', { ascending: false });

    if (data) {
      const seen = new Set();
      const formatted = [];
      
      data.forEach(c => {
        const otherProfile = c.participant_a === user.id ? c.participant_b_profile : c.participant_a_profile;
        if (otherProfile && !seen.has(otherProfile.id)) {
          seen.add(otherProfile.id);
          formatted.push({
            ...c,
            otherProfile
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
      .select('*')
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
        const fullName = `${u.first_name} ${u.last_name}`.trim().toLowerCase();
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

  const formatLastSeen = (lastSeen) => {
    if (!lastSeen) return 'Offline';
    const last = new Date(lastSeen);
    const now = new Date();
    const diff = Math.floor((now - last) / 1000);
    if (diff < 60) return 'Online';

    if (last.toDateString() === now.toDateString()) {
      return `at ${last.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
    }
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (last.toDateString() === yesterday.toDateString()) {
      return `yesterday`;
    }

    return last.toLocaleDateString();
  };

  const filteredUsers = users.filter(u => 
    `${u.first_name} ${u.last_name}`.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color="#A0A0A0" style={styles.searchIcon} />
        <TextInput 
          placeholder="Search agents or users..." 
          placeholderTextColor="#A0A0A0" 
          style={styles.searchInput} 
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {loading ? (
          <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 40 }} />
        ) : (
          <>
            {conversations.length > 0 && !searchQuery && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent Chats</Text>
                {conversations.map((c) => (
                  <TouchableOpacity 
                    key={c.id} 
                    style={styles.userRow}
                    onPress={() => navigation.navigate('ChatRoom', { 
                      conversationId: c.id, 
                      participantB: c.otherProfile?.id,
                      recipientName: `${c.otherProfile?.first_name} ${c.otherProfile?.last_name}` 
                    })}
                  >
                    <View style={styles.avatarContainer}>
                      {c.otherProfile?.avatar_url ? (
                        <Image source={{ uri: c.otherProfile.avatar_url }} style={styles.avatar} />
                      ) : (
                        <View style={styles.avatarPlaceholder}>
                          <Ionicons name="person" size={24} color="#0A84FF" />
                        </View>
                      )}
                    </View>
                    <View style={styles.userInfo}>
                      <Text style={styles.name}>{c.otherProfile?.first_name} {c.otherProfile?.last_name}</Text>
                      <Text style={styles.status} numberOfLines={1}>Active in chat</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#D1D1D6" />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{searchQuery ? 'Search Results' : 'Discover People'}</Text>
              {filteredUsers.map((user) => (
                <View key={user.id} style={styles.userRow}>
                  <View style={styles.avatarContainer}>
                    {user.avatar_url ? (
                      <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
                    ) : (
                      <View style={styles.avatarPlaceholder}>
                        <Ionicons name="person" size={24} color="#0A84FF" />
                      </View>
                    )}
                    {formatLastSeen(user.last_seen) === 'Online' && <View style={styles.onlineBadge} />}
                  </View>
                  
                  <View style={styles.userInfo}>
                    <Text style={styles.name}>{user.first_name} {user.last_name}</Text>
                    <Text style={[styles.status, formatLastSeen(user.last_seen) === 'Online' && { color: '#34C759' }]}>
                      {formatLastSeen(user.last_seen) === 'Online' ? 'Online' : `Last seen ${formatLastSeen(user.last_seen)}`}
                    </Text>
                  </View>

                  <View style={styles.actions}>
                    <TouchableOpacity 
                      style={[styles.actionBtn, followingIds.has(user.id) && styles.followingBtn]} 
                      onPress={() => handleFollow(user.id)}
                    >
                      <Ionicons 
                        name={followingIds.has(user.id) ? "person-remove" : "person-add"} 
                        size={18} 
                        color={followingIds.has(user.id) ? "#8E8E93" : "#0A84FF"} 
                      />
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.actionBtn, styles.msgBtn]} 
                      onPress={() => navigation.navigate('ChatRoom', { 
                        participantB: user.id, 
                        recipientName: `${user.first_name} ${user.last_name}` 
                      })}
                    >
                      <Ionicons name="chatbubble-ellipses" size={18} color="#FFF" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 20, paddingBottom: 15, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000' },
  
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', height: 46, borderRadius: 12, marginHorizontal: 20, paddingHorizontal: 16, marginTop: 20, marginBottom: 20 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#000' },
  
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  userRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, backgroundColor: '#FFF' },
  avatarContainer: { position: 'relative' },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarPlaceholder: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center' },
  onlineBadge: { position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, backgroundColor: '#34C759', borderSize: 2, borderColor: '#FFF' },
  
  userInfo: { flex: 1, marginLeft: 15 },
  name: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000' },
  status: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },
  
  section: { marginBottom: 30 },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#8E8E93', marginBottom: 15, textTransform: 'uppercase', letterSpacing: 1 },

  actions: { flexDirection: 'row' },
  actionBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center', marginLeft: 10 },
  followingBtn: { backgroundColor: '#F5F5F5' },
  msgBtn: { backgroundColor: '#0A84FF' },
});
