import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getSessionUser } from '../supabase';

export default function MoversScreen({ navigation }) {
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // We load actual messages from the database. 
  // If the 'messages' table doesn't exist yet, it catches the error gracefully.
  const loadDatabaseChats = async () => {
    try {
      const user = await getSessionUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('conversations')
        .select(`
          id,
          last_message_at,
          participant_a:profiles!participant_a(id, first_name, last_name, avatar_url),
          participant_b:profiles!participant_b(id, first_name, last_name, avatar_url),
          messages(body, created_at, sender_id, status)
        `)
        .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
        .order('last_message_at', { ascending: false });

      if (error) throw error;

      const seenParticipants = new Set();
      const formattedChats = [];
      
      (data || []).forEach(conv => {
        const otherUser = conv.participant_a.id === user.id ? conv.participant_b : conv.participant_a;
        
        // Group by participantB to remove duplicates
        if (!seenParticipants.has(otherUser.id)) {
          seenParticipants.add(otherUser.id);
          
          const sortedMsgs = (conv.messages || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
          const lastMsg = sortedMsgs[0];
          const unreadCount = (conv.messages || []).filter(m => m.sender_id !== user.id && m.status !== 'read').length;

          formattedChats.push({
            id: conv.id,
            participantB: otherUser.id,
            name: `${otherUser.first_name || ''} ${otherUser.last_name || ''}`.trim() || 'Hlala Link User',
            avatar: otherUser.avatar_url,
            time: conv.last_message_at,
            msg: lastMsg ? lastMsg.body : 'No messages yet...',
            unread: unreadCount > 0
          });
        }
      });
      setChats(formattedChats);
    } catch (e) {
      console.log('Error fetching chats', e);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadDatabaseChats();
    }, [])
  );

  useEffect(() => {
    const channelId = `inbox_realtime_${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        loadDatabaseChats();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Messages</Text>
        <TouchableOpacity onPress={() => navigation.navigate('UserList')}>
          <Ionicons name="add-circle" size={28} color="#0A84FF" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={20} color="#A0A0A0" style={styles.searchIcon} />
        <TextInput 
          placeholder="Search chats..." 
          placeholderTextColor="#A0A0A0" 
          style={styles.searchInput} 
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {loading ? (
          <ActivityIndicator size="large" color="#0A84FF" style={{ marginTop: 40 }} />
        ) : chats.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="chatbubbles" size={60} color="#D1D1D6" />
            <Text style={styles.emptyTitle}>No messages found</Text>
            <Text style={styles.emptySubtitle}>Your inbox is empty. Contact an agent or wait for replies here.</Text>
          </View>
        ) : (
          chats.map((chat) => (
            <TouchableOpacity 
              key={chat.id} 
              style={styles.chatRow}
              onPress={() => navigation.navigate('ChatRoom', { 
                conversationId: chat.id, 
                recipientName: chat.name,
                participantB: chat.participantB
              })}
            >
              <View style={styles.avatar}>
                {chat.avatar ? (
                  <Image source={{ uri: chat.avatar }} style={styles.avatarImage} />
                ) : (
                  <Ionicons name="person" size={24} color="#FFF" />
                )}
              </View>
              <View style={styles.chatInfo}>
                <View style={styles.topRow}>
                  <Text style={styles.name}>{chat.name}</Text>
                  <Text style={styles.time}>
                    {chat.time ? new Date(chat.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}
                  </Text>
                </View>
                <View style={styles.bottomRow}>
                  <Text style={[styles.msg, chat.unread && styles.unreadMsg]} numberOfLines={1}>{chat.msg}</Text>
                  {chat.unread && <View style={styles.unreadDot} />}
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 100 : 70, paddingHorizontal: 20, paddingBottom: 15 },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 24, color: '#000' },
  
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', height: 46, borderRadius: 12, marginHorizontal: 20, paddingHorizontal: 16, marginBottom: 20 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#000', marginTop: Platform.OS === 'android' ? 4 : 0 },
  
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  chatRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#A0A0A0', justifyContent: 'center', alignItems: 'center', marginRight: 16, overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 28 },
  chatInfo: { flex: 1, borderBottomWidth: 1, borderBottomColor: '#F5F5F5', paddingBottom: 16 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  name: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000' },
  time: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#A0A0A0' },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  msg: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', paddingRight: 20 },
  unreadMsg: { fontFamily: 'Poppins_600SemiBold', color: '#000' },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#0A84FF' },
  
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 20, color: '#000', marginTop: 16 },
  emptySubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#8E8E93', marginTop: 8, textAlign: 'center', maxWidth: 250 },
});
