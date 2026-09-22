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
        .channel(`profile_${participantB}_${Date.now()}`)
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
        .channel(`chat_${activeConvId}_${Date.now()}`)
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
        {/* iOS WhatsApp Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color="#007AFF" />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.headerProfileArea} 
            activeOpacity={0.8}
            onPress={() => recipientPhone ? handleCall() : null}
          >
            <View style={styles.headerAvatarWrap}>
              {recipientAvatar ? (
                <Image source={{ uri: recipientAvatar }} style={styles.headerAvatar} />
              ) : (
                <View style={styles.headerAvatarFallback}>
                  <Ionicons 
                    name={recipientRole === 'mover' ? 'cube' : recipientRole === 'agent' ? 'business' : 'person'} 
                    size={18} 
                    color="#007AFF" 
                  />
                </View>
              )}
              {status.online && <View style={styles.headerOnlineBadge} />}
            </View>

            <View style={styles.headerTitleBox}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {recipientName || 'Hlala Chat'}
              </Text>
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {status.online ? 'Online' : status.text || 'Tap for contact info'}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.headerActions}>
            <TouchableOpacity onPress={handleCall} style={styles.actionIconBtn}>
              <Ionicons name="call-outline" size={22} color="#007AFF" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleWhatsApp} style={styles.whatsappBtn} activeOpacity={0.8}>
              <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDeleteChat} style={styles.actionIconBtn}>
              <Ionicons name="ellipsis-horizontal" size={20} color="#007AFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Pinned Listing Header Card */}
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
                <Ionicons name="home" size={22} color="#007AFF" />
              </View>
            )}

            <View style={styles.marketplaceListingInfo}>
              <Text style={styles.marketplaceListingTitle} numberOfLines={1}>
                {linkedProperty.title}
              </Text>
              <Text style={styles.marketplaceListingPrice}>
                ${linkedProperty.rent_usd}
                <Text style={styles.marketplaceListingPeriod}> / mo</Text>
              </Text>
              <Text style={styles.marketplaceListingLocation} numberOfLines={1}>
                {linkedProperty.suburb ? `${linkedProperty.suburb}, ` : ''}{linkedProperty.city || 'Zimbabwe'}
              </Text>
            </View>

            <View style={styles.marketplaceViewBtn}>
              <Text style={styles.marketplaceViewBtnText}>View</Text>
              <Ionicons name="chevron-forward" size={14} color="#007AFF" />
            </View>
          </TouchableOpacity>
        )}

        {/* Pinned Mover Fleet Card */}
        {recipientRole === 'mover' && recipientVehicle && (
          <View style={styles.moverFleetCard}>
            <View style={styles.moverFleetIconCircle}>
              <Ionicons name="cube" size={18} color="#007AFF" />
            </View>

            <View style={styles.moverFleetInfo}>
              <Text style={styles.moverFleetTitle} numberOfLines={1}>
                {[recipientVehicle.type, recipientVehicle.model].filter(Boolean).join(' · ') || 'Moving Truck'}
              </Text>
              <View style={styles.moverFleetSubRow}>
                {recipientVehicle.registration ? (
                  <View style={styles.plateBadge}>
                    <Text style={styles.plateBadgeText}>{recipientVehicle.registration}</Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Ionicons name="map-outline" size={12} color="#8E8E93" />
                  <Text style={styles.moverFleetCity}>{recipientCity || 'Harare'}</Text>
                </View>
              </View>
            </View>

            {recipientPhone ? (
              <TouchableOpacity onPress={handleCall} style={styles.moverCallActionBtn} activeOpacity={0.8}>
                <Ionicons name="call" size={12} color="#FFFFFF" style={{ marginRight: 4 }} />
                <Text style={styles.moverCallActionText}>Call</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {/* WhatsApp Chat Messages Feed */}
        <View style={styles.chatBackground}>
          <ScrollView 
            ref={scrollViewRef}
            contentContainerStyle={styles.chatList}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 ? (
              <View style={styles.emptyChatContainer}>
                <View style={styles.emptyChatIconCircle}>
                  <Ionicons name="lock-closed" size={24} color="#667781" />
                </View>
                <Text style={styles.emptyChatTitle}>End-to-End Chat</Text>
                <Text style={styles.emptyChatSub}>
                  Messages are secure. Send a message or pick a quick inquiry below.
                </Text>
              </View>
            ) : (
              messages.map((msg) => {
                const isMe = msg.sender_id === userId;
                const showOptions = canModifyMessage(msg);
                return (
                  <View key={msg.id} style={[styles.msgWrapper, isMe ? styles.msgWrapperRight : styles.msgWrapperLeft]}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onLongPress={() => showOptions && setActionMsg(msg)}
                      style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}
                    >
                      <Text style={styles.msgText}>{msg.body}</Text>
                      
                      {/* WhatsApp timestamp + checkmarks in bottom right */}
                      <View style={styles.bubbleMetaRow}>
                        {msg.is_edited && <Text style={styles.editedTag}>edited</Text>}
                        <Text style={styles.timeText}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        {isMe && (
                          <Ionicons 
                            name={msg.status === 'read' ? "checkmark-done" : "checkmark"} 
                            size={14} 
                            color={msg.status === 'read' ? "#34B7F1" : "#8696A0"} 
                            style={{ marginLeft: 3 }}
                          />
                        )}
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>

        {/* Quick Question Templates Bar */}
        <View style={styles.templatesWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templatesList}>
            {TEMPLATES.map((t, idx) => (
              <TouchableOpacity key={idx} style={styles.templateChip} onPress={() => sendTemplate(t)} activeOpacity={0.7}>
                <Text style={styles.templateText}>{t}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* iOS WhatsApp Style Input Bar */}
        <View style={styles.inputArea}>
          <TouchableOpacity style={styles.attachmentBtn} activeOpacity={0.7}>
            <Ionicons name="add" size={24} color="#007AFF" />
          </TouchableOpacity>
          <View style={styles.inputContainer}>
            <TextInput 
              style={styles.input} 
              placeholder="Message" 
              placeholderTextColor="#8E8E93"
              value={inputText}
              onChangeText={setInputText}
              multiline
            />
          </View>
          <TouchableOpacity 
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnInactive]} 
            onPress={sendMessage}
            disabled={!inputText.trim()}
            activeOpacity={0.8}
          >
            <Ionicons 
              name={inputText.trim() ? "arrow-up" : "mic-outline"} 
              size={18} 
              color="#FFFFFF" 
            />
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
  
  // WhatsApp iOS Header
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    backgroundColor: '#F6F6F6', 
    paddingTop: Platform.OS === 'ios' ? 54 : 38, 
    paddingHorizontal: 12, 
    paddingBottom: 10, 
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#C6C6C8',
    zIndex: 10 
  },
  backBtn: { padding: 4, marginRight: 2 },
  headerProfileArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 2,
    marginRight: 8,
  },
  headerAvatarWrap: { position: 'relative' },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E4E6EB' },
  headerAvatarFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#EAF3FF', justifyContent: 'center', alignItems: 'center' },
  headerOnlineBadge: { 
    position: 'absolute', 
    bottom: 0, 
    right: 0, 
    width: 10, 
    height: 10, 
    borderRadius: 5, 
    backgroundColor: '#34C759', 
    borderWidth: 2, 
    borderColor: '#FFFFFF' 
  },
  headerTitleBox: { marginLeft: 10, flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000000' },
  headerSubtitle: { fontSize: 12, color: '#8E8E93', marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionIconBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  whatsappBtn: { 
    width: 32, 
    height: 32, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
  
  // Pinned Listing Header Card
  marketplaceListingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D1D6',
  },
  marketplaceListingThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#E4E6EB',
  },
  marketplaceListingFallbackThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#EAF3FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  marketplaceListingInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 6,
  },
  marketplaceListingTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 1,
  },
  marketplaceListingPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: '#007AFF',
  },
  marketplaceListingPeriod: {
    fontSize: 11,
    color: '#8E8E93',
  },
  marketplaceListingLocation: {
    fontSize: 11,
    color: '#8E8E93',
  },
  marketplaceViewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EAF3FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 2,
  },
  marketplaceViewBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
  },

  // Pinned Mover Fleet Card
  moverFleetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D1D1D6',
  },
  moverFleetIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EAF3FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  moverFleetInfo: {
    flex: 1,
  },
  moverFleetTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 1,
  },
  moverFleetSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  plateBadge: {
    backgroundColor: '#EFEFF4',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  plateBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#000000',
  },
  moverFleetCity: {
    fontSize: 11,
    color: '#8E8E93',
  },
  moverCallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  moverCallActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Chat Feed Background (iOS WhatsApp Beige)
  chatBackground: {
    flex: 1,
    backgroundColor: '#EFEAE2',
  },
  chatList: { paddingHorizontal: 12, paddingVertical: 12 },
  msgWrapper: { marginBottom: 8, maxWidth: '82%' },
  msgWrapperRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgWrapperLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  
  // iOS WhatsApp Bubbles
  bubble: { 
    paddingHorizontal: 16, 
    paddingTop: 11, 
    paddingBottom: 9, 
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleMe: { 
    backgroundColor: '#DCF8C6', // WhatsApp Sent Bubble Green
    borderTopRightRadius: 4,
  },
  bubbleThem: { 
    backgroundColor: '#FFFFFF', // WhatsApp Received Bubble White
    borderTopLeftRadius: 4,
  },
  msgText: { fontSize: 17, color: '#000000', lineHeight: 24 },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timeText: { fontSize: 12, color: '#8E8E93', marginLeft: 4 },
  editedTag: { fontSize: 11, fontStyle: 'italic', color: '#8E8E93', marginRight: 4 },

  // Action Menu
  actionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },
  optionsMenu: {
    width: 180,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
  },
  optionRowText: {
    fontSize: 15,
    color: '#000000',
    fontWeight: '500',
  },
  optionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E5E5EA',
  },

  // Edit Modal
  editCard: {
    width: '85%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  editTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 10,
  },
  editInput: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 70,
    textAlignVertical: 'top',
    fontSize: 15,
    color: '#000000',
    marginBottom: 14,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  editCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#F2F2F7',
  },
  editCancelText: { fontSize: 13, color: '#8E8E93', fontWeight: '600' },
  editSaveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#007AFF',
  },
  editSaveText: { fontSize: 13, color: '#FFFFFF', fontWeight: '600' },

  // Empty State
  emptyChatContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    paddingHorizontal: 30,
  },
  emptyChatIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#E1D9D1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyChatTitle: { fontSize: 15, fontWeight: '700', color: '#000000', marginBottom: 4 },
  emptyChatSub: { fontSize: 13, color: '#667781', textAlign: 'center', lineHeight: 18 },

  // Quick Question Templates Bar
  templatesWrapper: {
    backgroundColor: '#EFEAE2',
    paddingVertical: 6,
  },
  templatesList: {
    paddingHorizontal: 12,
    gap: 6,
  },
  templateChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D1D1D6',
  },
  templateText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
  },

  // WhatsApp iOS Style Input Bar
  inputArea: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingHorizontal: 8, 
    paddingVertical: 6, 
    backgroundColor: '#F6F6F6', 
    borderTopWidth: StyleSheet.hairlineWidth, 
    borderTopColor: '#C6C6C8', 
    paddingBottom: Platform.OS === 'ios' ? 24 : 8,
    gap: 6,
  },
  attachmentBtn: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#C6C6C8',
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 6 : 2,
    minHeight: 36,
    maxHeight: 100,
    justifyContent: 'center',
  },
input: {
    fontSize: 17,
    color: '#000000',
  },
  sendBtn: { 
    width: 34, 
    height: 34, 
    borderRadius: 17, 
    backgroundColor: '#007AFF', 
    justifyContent: 'center', 
    alignItems: 'center',
  },
  sendBtnInactive: {
    backgroundColor: '#8E8E93',
  },
});
