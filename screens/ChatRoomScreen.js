import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Platform, 
  TextInput, 
  TouchableOpacity, 
  ScrollView, 
  KeyboardAvoidingView, 
  Image, 
  Linking, 
  Alert,
  ActivityIndicator,
  Modal,
  Pressable
} from 'react-native';
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
  const { conversationId, recipientName, propertyId, participantB, initialDraft, moverVehicle, moverCity, recipientRole: routeRole } = route.params;
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState(initialDraft || '');
  const [userId, setUserId] = useState(null);
  const [activeConvId, setActiveConvId] = useState(conversationId);
  const [recipientAvatar, setRecipientAvatar] = useState(null);
  const [recipientPhone, setRecipientPhone] = useState(null);
  const [recipientRole, setRecipientRole] = useState(routeRole || null);
  const [recipientVehicle, setRecipientVehicle] = useState(moverVehicle || null);
  const [recipientCity, setRecipientCity] = useState(moverCity || null);
  const [lastSeen, setLastSeen] = useState(null);
  const [linkedProperty, setLinkedProperty] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editText, setEditText] = useState('');
  const [editTargetId, setEditTargetId] = useState(null);
  const scrollViewRef = useRef();

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        setUserId(user.id);
        
        let convIdToUse = activeConvId;
        // If no conv ID provided directly, check if a thread already exists between these 2 users
        if (!convIdToUse && participantB) {
          const { data: existing } = await supabase
            .from('conversations')
            .select('id, property_id')
            .or(`and(participant_a.eq.${user.id},participant_b.eq.${participantB}),and(participant_a.eq.${participantB},participant_b.eq.${user.id})`)
            .limit(1)
            .maybeSingle();

          if (existing) {
            convIdToUse = existing.id;
            setActiveConvId(existing.id);
            if (!propertyId && existing.property_id) {
              loadPropertyInfo(existing.property_id);
            }
          }
        }

        if (convIdToUse) {
          loadMessages(convIdToUse);
          markMessagesAsRead(convIdToUse, user.id);
          
          // Also fetch conversation's linked property if not already loaded
          if (!propertyId) {
            supabase
              .from('conversations')
              .select('property_id')
              .eq('id', convIdToUse)
              .single()
              .then(({ data }) => {
                if (data?.property_id) {
                  loadPropertyInfo(data.property_id);
                }
              });
          }
        }
      }
    });

    if (propertyId) {
      loadPropertyInfo(propertyId);
    }

    if (participantB) {
      supabase.from('profiles').select('avatar_url, phone_number, last_seen, first_name, last_name, role, business_name, vehicle_details, city').eq('id', participantB).single()
        .then(({ data }) => {
          if (data) {
            setRecipientAvatar(data.avatar_url);
            setRecipientPhone(data.phone_number);
            setRecipientRole(data.role);
            setLastSeen(data.last_seen);
            if (data.vehicle_details) setRecipientVehicle(data.vehicle_details);
            if (data.city) setRecipientCity(data.city);
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
  }, [participantB, activeConvId, propertyId]);

  const loadPropertyInfo = async (propId) => {
    try {
      const { data, error } = await supabase
        .from('properties')
        .select(`
          id,
          title,
          rent_usd,
          city,
          suburb,
          property_type,
          property_images(url, is_cover)
        `)
        .eq('id', propId)
        .single();

      if (!error && data) {
        const cover = (data.property_images || []).find(img => img.is_cover) || data.property_images?.[0];
        setLinkedProperty({
          id: data.id,
          title: data.title,
          rent_usd: data.rent_usd,
          city: data.city,
          suburb: data.suburb,
          property_type: data.property_type,
          coverUrl: cover?.url || null
        });
      }
    } catch (e) {
      console.log('Error loading property for chat:', e.message);
    }
  };

  function getStatus() {
    if (!lastSeen) return { text: 'Offline', online: false };
    const last = new Date(lastSeen);
    const now = new Date();
    const diff = Math.floor((now - last) / 1000);

    if (diff < 120) return { text: 'Active now', online: true };
    
    if (last.toDateString() === now.toDateString()) {
      return { text: `Active today at ${last.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`, online: false };
    }
    
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (last.toDateString() === yesterday.toDateString()) {
      return { text: `Active yesterday`, online: false };
    }

    return { text: `Active ${last.toLocaleDateString()}`, online: false };
  }

  const status = getStatus();

  useEffect(() => {
    // Real-time subscription for messages
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
              if (prev.some(m => m.id === newMessage.id)) return prev;
              return [...prev, newMessage];
            });
            
            if (newMessage.sender_id !== userId) {
              markMessagesAsRead(activeConvId, userId);
            }
          } else if (payload.eventType === 'UPDATE') {
            const updatedMessage = payload.new;
            setMessages(prev => prev.map(m => m.id === updatedMessage.id ? updatedMessage : m));
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old?.id;
            setMessages(prev => prev.filter(m => m.id !== deletedId));
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

  const canModifyMessage = (msg) => {
    if (!msg || !userId || messages.length === 0) return false;
    const last = messages[messages.length - 1];
    return msg.id === last.id && last.sender_id === userId;
  };

  const handleUnsend = () => {
    if (!actionMsg || !canModifyMessage(actionMsg)) return;
    const target = actionMsg;
    Alert.alert(
      'Unsend Message',
      'This message will be deleted for everyone in this chat.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unsend',
          style: 'destructive',
          onPress: async () => {
            setActionMsg(null);
            const { error } = await supabase
              .from('messages')
              .delete()
              .eq('id', target.id)
              .eq('sender_id', userId);

            if (!error) {
              setMessages(prev => prev.filter(m => m.id !== target.id));
              return;
            }

            console.log('Hard delete failed, falling back to soft unsend:', error.message);
            // Fallback: replace content if hard delete is blocked by RLS
            const { error: updErr } = await supabase
              .from('messages')
              .update({ body: 'You unsent this message' })
              .eq('id', target.id)
              .eq('sender_id', userId);

            if (updErr) {
              Alert.alert('Error', 'Could not unsend this message.');
            } else {
              setMessages(prev => prev.map(m => m.id === target.id ? { ...m, body: 'You unsent this message' } : m));
            }
          }
        }
      ]
    );
  };

  const startEdit = () => {
    if (!canModifyMessage(actionMsg)) return;
    setEditText(actionMsg?.body || '');
    setEditTargetId(actionMsg.id);
    setActionMsg(null);
    setEditVisible(true);
  };

  const cancelEdit = () => {
    setEditVisible(false);
    setEditTargetId(null);
  };

  const saveEdit = async () => {
    const trimmed = editText.trim();
    if (!trimmed || !editTargetId) return;
    const target = editTargetId;

    const { error } = await supabase
      .from('messages')
      .update({ body: trimmed, is_edited: true })
      .eq('id', target)
      .eq('sender_id', userId);

    if (error) {
      console.log('Edit with flag failed, retrying without:', error.message);
      // Fallback: is_edited column may not exist yet
      const { error: retryErr } = await supabase
        .from('messages')
        .update({ body: trimmed })
        .eq('id', target)
        .eq('sender_id', userId);

      if (retryErr) {
        console.log('Edit failed:', retryErr.message);
        Alert.alert(
          'Could Not Edit',
          'Editing is blocked by the database. Please run database/add_message_edit_unsend.sql in the Supabase SQL Editor to enable message editing.'
        );
        return;
      }
    }

    setMessages(prev => prev.map(m => m.id === target ? { ...m, body: trimmed, is_edited: true } : m));
    setEditVisible(false);
    setEditTargetId(null);
  };

  function handleWhatsApp() {
    if (!recipientPhone) {
      Alert.alert('Unavailable', 'This user has not provided a phone number.');
      return;
    }
    const cleanPhone = recipientPhone.replace(/[^\d+]/g, '');
    Linking.openURL(`https://wa.me/${cleanPhone.replace('+', '')}`).catch(() => {
      Alert.alert('Error', 'Could not open WhatsApp.');
    });
  }

  function handleCall() {
    if (!recipientPhone) {
      Alert.alert('Unavailable', 'This user has not provided a phone number.');
      return;
    }
    Linking.openURL(`tel:${recipientPhone}`);
  }

  const handleDeleteChat = () => {
    if (!activeConvId) return;
    Alert.alert(
      'Delete Conversation',
      'Are you sure you want to delete this conversation?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive', 
          onPress: async () => {
            const { error } = await supabase
              .from('conversations')
              .delete()
              .eq('id', activeConvId);
              
            if (!error) {
              navigation.goBack();
            } else {
              Alert.alert('Error', 'Failed to delete conversation.');
            }
          } 
        }
      ]
    );
  };

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

    // If no conversation exists yet, find or create one
    if (!currentConvId) {
      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .or(`and(participant_a.eq.${userId},participant_b.eq.${participantB}),and(participant_a.eq.${participantB},participant_b.eq.${userId})`)
        .limit(1)
        .maybeSingle();

      if (existing) {
        currentConvId = existing.id;
        setActiveConvId(currentConvId);
      } else {
        const { data: newConv, error: convError } = await supabase
          .from('conversations')
          .insert({
            participant_a: userId,
            participant_b: participantB,
            property_id: propertyId || null,
            last_message_at: new Date()
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

    const textToSend = inputText.trim();
    setInputText('');

    const newMessage = {
      conversation_id: currentConvId,
      sender_id: userId,
      body: textToSend,
      status: 'sent'
    };
    
    const { error } = await supabase.from('messages').insert(newMessage);
    if (!error) {
      await supabase.from('conversations').update({ last_message_at: new Date() }).eq('id', currentConvId);
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
      if (!currentConvId) {
        const { data: existing } = await supabase
          .from('conversations')
          .select('id')
          .or(`and(participant_a.eq.${userId},participant_b.eq.${participantB}),and(participant_a.eq.${participantB},participant_b.eq.${userId})`)
          .limit(1)
          .maybeSingle();

        if (existing) {
          currentConvId = existing.id;
          setActiveConvId(currentConvId);
        } else {
          const newConvData = {
            participant_a: userId,
            participant_b: participantB,
            property_id: propertyId || null,
            last_message_at: new Date()
          };

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

      const { error } = await supabase.from('messages').insert({
        conversation_id: currentConvId,
        sender_id: userId,
        body: text,
        status: 'sent'
      });

      if (!error) {
        await supabase.from('conversations').update({ last_message_at: new Date() }).eq('id', currentConvId);
        loadMessages(currentConvId);
      }
    } catch (error) {
      console.log('Template error:', error.message);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Facebook Messenger Style Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#050505" />
          </TouchableOpacity>
          
          <View style={styles.headerTitleBox}>
            <View style={styles.headerRow}>
              <View style={styles.headerAvatarWrap}>
                {recipientAvatar ? (
                  <Image source={{ uri: recipientAvatar }} style={styles.headerAvatar} />
                ) : (
                  <View style={styles.headerAvatarFallback}>
                    <Ionicons 
                      name={recipientRole === 'mover' ? 'cube' : recipientRole === 'agent' ? 'business' : 'person'} 
                      size={18} 
                      color="#0A84FF" 
                    />
                  </View>
                )}
                {status.online && <View style={styles.headerOnlineBadge} />}
              </View>

              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {recipientName || 'Hlala Chat'}
                </Text>
                {status.online ? (
                  <View style={styles.activePill}>
                    <View style={styles.activePillDot} />
                    <Text style={styles.activePillText}>Active now</Text>
                  </View>
                ) : (
                  <Text style={styles.headerSubtitle}>{status.text}</Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleCall} style={styles.actionIconBtn}>
              <Ionicons name="call" size={20} color="#0A84FF" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleWhatsApp} style={styles.whatsappBtn} activeOpacity={0.8}>
              <Ionicons name="logo-whatsapp" size={19} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDeleteChat} style={styles.actionIconBtn}>
              <Ionicons name="ellipsis-vertical" size={20} color="#65676B" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Facebook Marketplace Pinned Listing Header Card */}
        {linkedProperty && (
          <TouchableOpacity 
            style={styles.marketplaceListingCard}
            onPress={() => navigation.navigate('Detail', { id: linkedProperty.id })}
            activeOpacity={0.85}
          >
            {linkedProperty.coverUrl ? (
              <Image source={{ uri: linkedProperty.coverUrl }} style={styles.marketplaceListingThumb} />
            ) : (
              <View style={styles.marketplaceListingFallbackThumb}>
                <Ionicons name="home" size={24} color="#0A84FF" />
              </View>
            )}

            <View style={styles.marketplaceListingInfo}>
              <Text style={styles.marketplaceListingTitle} numberOfLines={1}>
                {linkedProperty.title}
              </Text>
              <Text style={styles.marketplaceListingPrice}>
                ${linkedProperty.rent_usd}
                <Text style={styles.marketplaceListingPeriod}> / month</Text>
              </Text>
              <Text style={styles.marketplaceListingLocation} numberOfLines={1}>
                {linkedProperty.suburb ? `${linkedProperty.suburb}, ` : ''}{linkedProperty.city || 'Zimbabwe'}
              </Text>
            </View>

            <View style={styles.marketplaceViewBtn}>
              <Text style={styles.marketplaceViewBtnText}>View</Text>
              <Ionicons name="chevron-forward" size={14} color="#0A84FF" />
            </View>
          </TouchableOpacity>
        )}

        {/* Pinned Mover Fleet Card (When chatting with a Mover) */}
        {recipientRole === 'mover' && recipientVehicle && (
          <View style={styles.moverFleetCard}>
            <View style={styles.moverFleetIconCircle}>
              <Ionicons name="cube" size={20} color="#0A84FF" />
            </View>

            <View style={styles.moverFleetInfo}>
              <Text style={styles.moverFleetTitle} numberOfLines={1}>
                {[recipientVehicle.type, recipientVehicle.model].filter(Boolean).join(' · ') || 'Moving Truck'}
              </Text>
              <View style={styles.moverFleetSubRow}>
                {recipientVehicle.registration ? (
                  <View style={styles.plateBadge}>
                    <Ionicons name="card" size={11} color="#0A84FF" style={{ marginRight: 4 }} />
                    <Text style={styles.plateBadgeText}>{recipientVehicle.registration}</Text>
                  </View>
                ) : null}
                <Text style={styles.moverFleetCity}>📍 {recipientCity || 'Harare'}</Text>
              </View>
            </View>

            {recipientPhone ? (
              <TouchableOpacity onPress={handleCall} style={styles.moverCallActionBtn} activeOpacity={0.8}>
                <Ionicons name="call" size={13} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.moverCallActionText}>Call</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* Messages Feed */}
        <ScrollView 
          ref={scrollViewRef}
          contentContainerStyle={styles.chatList}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 ? (
            <View style={styles.emptyChatContainer}>
              <View style={styles.emptyChatIconCircle}>
                <Ionicons name="chatbubbles-outline" size={40} color="#0A84FF" />
              </View>
              <Text style={styles.emptyChatTitle}>Start the conversation</Text>
              <Text style={styles.emptyChatSub}>
                Send a message or choose a quick inquiry below about this property.
              </Text>
            </View>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender_id === userId;
              const showOptions = canModifyMessage(msg);
              return (
                <View key={msg.id} style={[styles.msgWrapper, isMe ? styles.msgWrapperRight : styles.msgWrapperLeft]}>
                  <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                    <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextThem]}>
                      {msg.body}
                    </Text>
                  </View>
                  <View style={styles.msgFooter}>
                    <Text style={styles.time}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                    {msg.is_edited && <Text style={styles.editedTag}>Edited</Text>}
                    {isMe && (
                      <Ionicons 
                        name={msg.status === 'read' ? "checkmark-done" : "checkmark"} 
                        size={14} 
                        color={msg.status === 'read' ? "#0A84FF" : "#8E8E93"} 
                        style={{ marginLeft: 4 }}
                      />
                    )}
                    {showOptions && (
                      <TouchableOpacity 
                        style={styles.msgOptionsBtn} 
                        onPress={() => setActionMsg(msg)}
                        activeOpacity={0.6}
                      >
                        <Ionicons name="ellipsis-horizontal" size={15} color="#65676B" />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Facebook Marketplace Quick Question Templates Bar */}
        <View style={styles.templatesWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templatesList}>
            {TEMPLATES.map((t, idx) => (
              <TouchableOpacity key={idx} style={styles.templateChip} onPress={() => sendTemplate(t)} activeOpacity={0.7}>
                <Text style={styles.templateText}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Messenger Input Bar */}
        <View style={styles.inputArea}>
          <TouchableOpacity style={styles.iconActionBtn}>
            <Ionicons name="camera" size={22} color="#0A84FF" />
          </TouchableOpacity>
          <TextInput 
            style={styles.input} 
            placeholder="Type a message..." 
            placeholderTextColor="#8E8E93"
            value={inputText}
            onChangeText={setInputText}
            multiline
          />
          <TouchableOpacity 
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]} 
            onPress={sendMessage}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={17} color="#FFF" style={{ marginLeft: 2 }} />
          </TouchableOpacity>
        </View>

        {/* Latest Message Options Popup (Edit / Unsend) */}
        <Modal visible={!!actionMsg} transparent animationType="fade" onRequestClose={() => setActionMsg(null)}>
          <View style={styles.actionOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setActionMsg(null)} />
            <View style={styles.optionsMenu}>
              <TouchableOpacity style={styles.optionRow} onPress={startEdit} activeOpacity={0.6}>
                <Ionicons name="pencil" size={18} color="#050505" />
                <Text style={styles.optionRowText}>Edit</Text>
              </TouchableOpacity>
              <View style={styles.optionDivider} />
              <TouchableOpacity style={styles.optionRow} onPress={handleUnsend} activeOpacity={0.6}>
                <Ionicons name="arrow-undo-outline" size={18} color="#FF3B30" />
                <Text style={[styles.optionRowText, { color: '#FF3B30' }]}>Unsend</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Edit Message Modal */}
        <Modal visible={editVisible} transparent animationType="fade" onRequestClose={cancelEdit}>
          <View style={styles.actionOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={cancelEdit} />
            <View style={styles.editCard}>
              <Text style={styles.editTitle}>Edit Message</Text>
              <TextInput
                style={styles.editInput}
                value={editText}
                onChangeText={setEditText}
                multiline
                autoFocus
              />
              <View style={styles.editActions}>
                <TouchableOpacity style={styles.editCancelBtn} onPress={cancelEdit}>
                  <Text style={styles.editCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.editSaveBtn, !editText.trim() && { opacity: 0.5 }]} 
                  onPress={saveEdit}
                  disabled={!editText.trim()}
                >
                  <Text style={styles.editSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
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
    backgroundColor: '#FFFFFF', 
    paddingTop: Platform.OS === 'ios' ? 60 : 44, 
    paddingHorizontal: 16, 
    paddingBottom: 12, 
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E6EB',
    zIndex: 10 
  },
  backBtn: { padding: 4, marginRight: 6 },
  headerTitleBox: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerAvatarWrap: { position: 'relative' },
  headerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E4E6EB' },
  headerAvatarFallback: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#EBF5FF', justifyContent: 'center', alignItems: 'center' },
  headerOnlineBadge: { 
    position: 'absolute', 
    bottom: 0, 
    right: 0, 
    width: 11, 
    height: 11, 
    borderRadius: 5.5, 
    backgroundColor: '#34C759', 
    borderWidth: 2, 
    borderColor: '#FFFFFF' 
  },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 15, color: '#050505' },
  headerSubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#65676B' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F0F2F5', justifyContent: 'center', alignItems: 'center' },
  whatsappBtn: { 
    width: 34, 
    height: 34, 
    borderRadius: 17, 
    backgroundColor: '#25D366', 
    justifyContent: 'center', 
    alignItems: 'center',
    shadowColor: '#25D366',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EAF8EE',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 1,
    gap: 4,
  },
  activePillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34C759',
  },
  activePillText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 10.5,
    color: '#248A3D',
  },
  
  // Facebook Marketplace Pinned Listing Header Card
  marketplaceListingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F8FA',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E4E6EB',
  },
  marketplaceListingThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#E4E6EB',
  },
  marketplaceListingFallbackThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#EBF5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  marketplaceListingInfo: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  marketplaceListingTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#050505',
    marginBottom: 1,
  },
  marketplaceListingPrice: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 14,
    color: '#0A84FF',
  },
  marketplaceListingPeriod: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#65676B',
  },
  marketplaceListingLocation: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#65676B',
  },
  marketplaceViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 2,
  },
  marketplaceViewBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: '#0A84FF',
  },

  // Chat Feed
  chatList: { paddingHorizontal: 16, paddingVertical: 16 },
  msgWrapper: { marginBottom: 12, maxWidth: '78%' },
  msgWrapperRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgWrapperLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  
  // Facebook Messenger Bubbles
  bubble: { 
    paddingHorizontal: 15, 
    paddingVertical: 10, 
    borderRadius: 18 
  },
  bubbleMe: { 
    backgroundColor: '#0084FF', // Classic Facebook Messenger Blue
    borderBottomRightRadius: 4,
  },
  bubbleThem: { 
    backgroundColor: '#F0F2F5', // Classic Facebook Messenger Light Gray
    borderBottomLeftRadius: 4,
  },
  msgText: { fontSize: 15, lineHeight: 21 },
  msgTextMe: { color: '#FFFFFF', fontFamily: 'Poppins_400Regular' },
  msgTextThem: { color: '#050505', fontFamily: 'Poppins_400Regular' },
  msgFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginHorizontal: 2 },
  time: { fontFamily: 'Poppins_400Regular', fontSize: 10, color: '#8E8E93' },
  editedTag: { fontFamily: 'Poppins_400Regular', fontSize: 10, fontStyle: 'italic', color: '#8E8E93', marginLeft: 5 },

  // Latest Message Options Menu
  actionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },
  optionsMenu: {
    width: 190,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 20,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    gap: 12,
  },
  optionRowText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14.5,
    color: '#050505',
  },
  optionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E4E6EB',
  },
  msgOptionsBtn: {
    width: 24,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 4,
  },

  // Edit Message Modal
  editCard: {
    width: '82%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 20,
  },
  editTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    color: '#050505',
    marginBottom: 12,
  },
  editInput: {
    backgroundColor: '#F0F2F5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 80,
    textAlignVertical: 'top',
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: '#050505',
    marginBottom: 16,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  editCancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#F0F2F5',
  },
  editCancelText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13.5, color: '#65676B' },
  editSaveBtn: {
    paddingHorizontal: 22,
    paddingVertical: 9,
    borderRadius: 18,
    backgroundColor: '#0084FF',
  },
  editSaveText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13.5, color: '#FFFFFF' },

  // Empty State
  emptyChatContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    paddingHorizontal: 30,
  },
  emptyChatIconCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: '#EBF5FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyChatTitle: { fontFamily: 'Poppins_700Bold', fontSize: 16, color: '#050505', marginBottom: 4 },
  emptyChatSub: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#65676B', textAlign: 'center', lineHeight: 18 },

  // Facebook Marketplace Templates Bar
  templatesWrapper: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
  },
  templatesList: {
    paddingHorizontal: 16,
    gap: 8,
  },
  templateChip: {
    backgroundColor: '#F0F2F5',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E4E6EB',
  },
  templateText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12.5,
    color: '#050505',
  },

  // Input Bar
  inputArea: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 14, 
    paddingVertical: 10, 
    backgroundColor: '#FFFFFF', 
    borderTopWidth: StyleSheet.hairlineWidth, 
    borderTopColor: '#E4E6EB', 
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
    gap: 8,
  },
  iconActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0F2F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  input: { 
    flex: 1, 
    backgroundColor: '#F0F2F5', 
    borderRadius: 20, 
    paddingHorizontal: 16, 
    paddingVertical: 8, 
    maxHeight: 100, 
    fontFamily: 'Poppins_400Regular', 
    fontSize: 14, 
    color: '#050505' 
  },
  sendBtn: { 
    width: 38, 
    height: 38, 
    borderRadius: 19, 
    backgroundColor: '#0084FF', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  sendBtnDisabled: {
    backgroundColor: '#BCC0C4',
  },

  // Pinned Mover Fleet Card Styles
  moverFleetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E4E6EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  moverFleetIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#EBF5FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  moverFleetInfo: {
    flex: 1,
  },
  moverFleetTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 13.5,
    color: '#050505',
    marginBottom: 2,
  },
  moverFleetSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  plateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F2F5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#CCD0D5',
  },
  plateBadgeText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    color: '#050505',
    letterSpacing: 0.5,
  },
  moverFleetCity: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11.5,
    color: '#65676B',
  },
  moverCallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0084FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    shadowColor: '#0084FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  moverCallActionText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    color: '#FFFFFF',
  },
});
