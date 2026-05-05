import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, TextInput, TouchableOpacity, ScrollView, KeyboardAvoidingView, Image, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

const TEMPLATES = [
  "Is this still available?",
  "I'd like to schedule a viewing.",
  "What is the deposit amount?",
  "Can I get more photos?",
  "Is the price negotiable?",
  "When can I move in?"
];

export default function ChatRoomScreen({ route, navigation }) {
  const { conversationId, recipientName, propertyId, participantB } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [userId, setUserId] = useState(null);
  const [activeConvId, setActiveConvId] = useState(conversationId);
  const [recipientAvatar, setRecipientAvatar] = useState(null);
  const [recipientPhone, setRecipientPhone] = useState(null);
  const [lastSeen, setLastSeen] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        if (activeConvId) {
          loadMessages(activeConvId);
          markMessagesAsRead(activeConvId, user.id);
        }
      }
    });

    if (participantB) {
      supabase.from('profiles').select('avatar_url, phone_number, last_seen').eq('id', participantB).single()
        .then(({ data }) => {
          if (data) {
            setRecipientAvatar(data.avatar_url);
            setRecipientPhone(data.phone_number);
            setLastSeen(data.last_seen);
          }
        });

      // Real-time listener for recipient profile (to catch online status)
      const profileChannel = supabase
        .channel(`profile_${participantB}`)
        .on('postgres_changes', { 
          event: 'UPDATE', 
          schema: 'public', 
          table: 'profiles', 
          filter: `id=eq.${participantB}` 
        }, (payload) => {
          if (payload.new.last_seen) setLastSeen(payload.new.last_seen);
        })
        .subscribe();
      
      return () => {
        supabase.removeChannel(profileChannel);
      };
    }
  }, [participantB]);

  function getStatus() {
    if (!lastSeen) return { text: 'Offline', online: false };
    const last = new Date(lastSeen);
    const now = new Date();
    const diff = Math.floor((now - last) / 1000); // seconds

    if (diff < 120) return { text: 'Online', online: true };
    
    if (last.toDateString() === now.toDateString()) {
      return { text: `last seen today at ${last.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`, online: false };
    }
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (last.toDateString() === yesterday.toDateString()) {
      return { text: `last seen yesterday at ${last.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`, online: false };
    }

    return { text: `last seen ${last.toLocaleDateString()}`, online: false };
  }

  const status = getStatus();

  useEffect(() => {
    // Real-time subscription for messages and status updates
    let channel;
    if (activeConvId) {
      channel = supabase
        .channel(`chat_${activeConvId}`)
        .on('postgres_changes', { 
          event: '*', 
          schema: 'public', 
          table: 'messages',
          filter: `conversation_id=eq.${activeConvId}`
        }, (payload) => {
          if (payload.eventType === 'INSERT') {
            const newMessage = payload.new;
            setMessages(prev => {
              // Avoid duplicates
              if (prev.some(m => m.id === newMessage.id)) return prev;
              return [...prev, newMessage];
            });
            
            // If the message is from the other person, mark it as read
            if (newMessage.sender_id !== userId) {
              markMessagesAsRead(activeConvId, userId);
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedMessage = payload.new;
            setMessages(prev => prev.map(m => m.id === updatedMessage.id ? updatedMessage : m));
          }
        })
        .subscribe();
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [activeConvId, participantB, userId]);

  function markMessagesAsRead(convId, currentUserId) {
    if (!convId || !currentUserId) return;
    supabase
      .from('messages')
      .update({ status: 'read' })
      .eq('conversation_id', convId)
      .neq('sender_id', currentUserId)
      .neq('status', 'read')
      .then();
  }

  function handleWhatsApp() {
    if (!recipientPhone) {
      Alert.alert('Unavailable', 'This user hasn\'t provided a phone number.');
      return;
    }
    const cleanPhone = recipientPhone.replace(/[^\d+]/g, '');
    Linking.openURL(`whatsapp://send?phone=${cleanPhone}`);
  }

  async function loadMessages(convId) {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    
    if (data) setMessages(data);
  }

  const sendMessage = async () => {
    if (!inputText.trim() || !userId) return;
    
    let currentConvId = activeConvId;

    // If no conversation exists yet, try to find an existing one first
    if (!currentConvId) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
        .or(`participant_a.eq.${participantB},participant_b.eq.${participantB}`)
        .eq('property_id', propertyId)
        .limit(1)
        .single();

      if (existing) {
        currentConvId = existing.id;
        setActiveConvId(currentConvId);
      } else {
        const { data: newConv, error: convError } = await supabase
          .from('conversations')
          .insert({
            participant_a: userId,
            participant_b: participantB,
            property_id: propertyId
          })
          .select()
          .single();
          
        if (convError) {
          console.error("Error creating conversation", convError);
          return;
        }
        currentConvId = newConv.id;
        setActiveConvId(currentConvId);
      }
    }

    const newMessage = {
      conversation_id: currentConvId,
      sender_id: userId,
      body: inputText.trim(),
    };

    setInputText(''); // optimistic clear
    
    const { error } = await supabase.from('messages').insert(newMessage);
    if (!error) {
      loadMessages(currentConvId);
    } else {
      console.error("Error sending message", error);
    }
  };

  const sendTemplate = async (text) => {
    if (!userId) {
      Alert.alert('Session Error', 'Please wait a moment for the chat to initialize.');
      return;
    }
    
    let currentConvId = activeConvId;

    try {
      // 1. If no conversation ID, try to find or create one
      if (!currentConvId) {
        // Try to find existing first
        let query = supabase.from('conversations').select('id')
          .or(`participant_a.eq.${userId},participant_b.eq.${userId}`)
          .or(`participant_a.eq.${participantB},participant_b.eq.${participantB}`);
        
        if (propertyId) {
          query = query.eq('property_id', propertyId);
        }

        const { data: existing } = await query.limit(1).single();

        if (existing) {
          currentConvId = existing.id;
          setActiveConvId(currentConvId);
        } else {
          // Create new
          const newConvData = {
            participant_a: userId,
            participant_b: participantB,
            last_message_at: new Date()
          };
          if (propertyId) newConvData.property_id = propertyId;

          const { data: newConv, error: convError } = await supabase
            .from('conversations')
            .insert(newConvData)
            .select()
            .single();
            
          if (convError) throw convError;
          currentConvId = newConv.id;
          setActiveConvId(currentConvId);
        }
      }

      // 2. Send the template message
      const { error } = await supabase.from('messages').insert({
        conversation_id: currentConvId,
        sender_id: userId,
        body: text,
        status: 'sent'
      });

      if (!error) {
        // 3. Update conversation activity
        await supabase.from('conversations').update({ last_message_at: new Date() }).eq('id', currentConvId);
        loadMessages(currentConvId);
      } else {
        throw error;
      }
    } catch (error) {
      console.log('Template error:', error.message);
      Alert.alert('Message Error', 'Failed to send template message.');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <View style={styles.headerTitleBox}>
          <View style={styles.headerRow}>
            {recipientAvatar ? (
              <Image source={{ uri: recipientAvatar }} style={styles.headerAvatar} />
            ) : (
              <View style={styles.headerAvatarFallback}>
                <Ionicons name="person" size={16} color="#0A84FF" />
              </View>
            )}
            <View style={{ marginLeft: 10 }}>
              <Text style={styles.headerTitle}>{recipientName || 'Chat'}</Text>
              <View style={styles.statusRow}>
                {status.online && <View style={styles.onlineDot} />}
                <Text style={[styles.headerSubtitle, status.online && { color: '#34C759' }]}>
                  {status.text}
                </Text>
              </View>
            </View>
          </View>
        </View>
        <TouchableOpacity onPress={handleWhatsApp}>
          <Ionicons name="logo-whatsapp" size={24} color="#25D366" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.chatList}>
        {messages.map((msg) => {
          const isMe = msg.sender_id === userId;
          return (
            <View key={msg.id} style={[styles.msgWrapper, isMe ? styles.msgWrapperRight : styles.msgWrapperLeft]}>
              <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextThem]}>{msg.body}</Text>
              </View>
              <View style={styles.msgFooter}>
                <Text style={styles.time}>{new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
                {isMe && (
                  <Ionicons 
                    name={msg.status === 'read' ? "checkmark-done" : "checkmark"} 
                    size={14} 
                    color={msg.status === 'read' ? "#34C759" : "#A0A0A0"} 
                    style={{ marginLeft: 4 }}
                  />
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.templatesWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templatesList}>
          {TEMPLATES.map((t, idx) => (
            <TouchableOpacity key={idx} style={styles.templateChip} onPress={() => sendTemplate(t)}>
              <Text style={styles.templateText}>{t}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.inputArea}>
        <TouchableOpacity style={styles.attachBtn}>
          <Ionicons name="add" size={28} color="#A0A0A0" />
        </TouchableOpacity>
        <TextInput 
          style={styles.input} 
          placeholder="Type a message..." 
          value={inputText}
          onChangeText={setInputText}
          multiline
        />
        <TouchableOpacity style={styles.sendBtn} onPress={sendMessage}>
          <Ionicons name="send" size={18} color="#FFF" style={{ marginLeft: 3 }} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F7FA' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', paddingTop: Platform.OS === 'ios' ? 100 : 70, paddingHorizontal: 20, paddingBottom: 15, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 3, zIndex: 10 },
  backBtn: { padding: 4 },
  headerTitleBox: { flex: 1, marginLeft: 15 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerAvatar: { width: 36, height: 36, borderRadius: 18 },
  headerAvatarFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000' },
  headerSubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#34C759' },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  
  chatList: { padding: 20, paddingBottom: 40 },
  msgWrapper: { marginBottom: 16, maxWidth: '80%' },
  msgWrapperRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgWrapperLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  bubbleMe: { backgroundColor: '#0A84FF', borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#FFFFFF', borderBottomLeftRadius: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, elevation: 1 },
  msgText: { fontFamily: 'Poppins_400Regular', fontSize: 15 },
  msgTextMe: { color: '#FFF' },
  msgTextThem: { color: '#000' },
  msgFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginHorizontal: 4 },
  time: { fontFamily: 'Poppins_400Regular', fontSize: 10, color: '#A0A0A0' },

  inputArea: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingBottom: Platform.OS === 'ios' ? 30 : 12 },
  attachBtn: { marginRight: 12 },
  input: { flex: 1, backgroundColor: '#F5F7FA', minHeight: 44, maxHeight: 100, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#000' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0A84FF', justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
    marginRight: 6,
  },
  templatesWrapper: {
    paddingVertical: 10,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
  },
  templatesList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  templateChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#F0F5FF',
    borderWidth: 1,
    borderColor: '#D0E0FF',
  },
  templateText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#0A84FF',
  },
});
