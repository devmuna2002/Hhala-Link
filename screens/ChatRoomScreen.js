import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, getSessionUser } from '../supabase';
import { toPublicImageUrl } from '../utils/imageUrl';
import { SkeletonBlock } from '../components/Skeleton';
import { useTheme } from '../utils/theme';
import { NotificationService } from '../services/NotificationService';
import { isTransientError, withTimeout, withRetry } from '../utils/network';
import { enqueueOutbox } from '../utils/outbox';

export default function ChatRoomScreen({ route, navigation }) {
  const { t, dark } = useTheme();
  const styles = useMemo(() => buildStyles(t, dark), [t, dark]);
  const { conversationId, recipientName, recipientAvatar: routeAvatar, propertyId, participantB, initialDraft, moverVehicle, moverCity, recipientRole: routeRole } = route.params;
  const [messages, setMessages] = useState([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [inputText, setInputText] = useState(initialDraft || '');
  const [userId, setUserId] = useState(null);
  const [activeConvId, setActiveConvId] = useState(conversationId);
  // Seed the header avatar from the navigation params (the chat list already
  // holds it) so the header paints instantly; the profile fetch below
  // refreshes it in the background.
  const [recipientAvatar, setRecipientAvatar] = useState(routeAvatar || null);
  // Own avatar for sent-bubble icons (single-row fetch on mount).
  const [myAvatar, setMyAvatar] = useState(null);
  const [myInitial, setMyInitial] = useState(null);
  // Avatars resolve a beat after mount — shimmer until then, initials after.
  // Person-icon placeholders are never shown.
  const [avatarsReady, setAvatarsReady] = useState(false);
  const avatarFlags = useRef({ mine: false, theirs: false });
  const markAvatarSettled = (which) => {
    avatarFlags.current[which] = true;
    if (avatarFlags.current.mine && avatarFlags.current.theirs) setAvatarsReady(true);
  };
  const recipientInitial = ((recipientName || 'H').trim()[0] || 'H').toUpperCase();
  const [recipientPhone, setRecipientPhone] = useState(null);
  const [recipientRole, setRecipientRole] = useState(routeRole || null);
  const [recipientVehicle, setRecipientVehicle] = useState(moverVehicle || null);
  const [recipientCity, setRecipientCity] = useState(moverCity || null);
  const [lastSeen, setLastSeen] = useState(null);
  // Listing details for reservation messages tagged with a property_id —
  // fetched once per listing in a single batched query.
  const [msgProps, setMsgProps] = useState({});
  const [actionMsg, setActionMsg] = useState(null);
  const [editVisible, setEditVisible] = useState(false);
  const [editText, setEditText] = useState('');
  const [editTargetId, setEditTargetId] = useState(null);
  const scrollViewRef = useRef();

  useEffect(() => {
    // Keep chats fetched: paint the cached thread instantly, then replace
    // with live rows below.
    if (activeConvId) {
      AsyncStorage.getItem(`cached_messages_${activeConvId}`).then((raw) => {
        try {
          const parsed = raw ? JSON.parse(raw) : null;
          if (Array.isArray(parsed) && parsed.length > 0) {
            setMessages(parsed);
            setLoadingInitial(false);
          }
        } catch (_) {}
      }).catch(() => {});
    } else {
      setLoadingInitial(false);
    }
    getSessionUser().then(async (user) => {
      if (user) {
        setUserId(user.id);
        // Bounded profile fetches: a hung query settles via timeout so
        // avatars can never shimmer forever.
        Promise.race([
          supabase
            .from('profiles')
            .select('avatar_url, first_name')
            .eq('id', user.id)
            .single()
            .then(({ data }) => {
              if (data?.avatar_url) setMyAvatar(data.avatar_url);
              if (data?.first_name) setMyInitial(String(data.first_name).trim()[0].toUpperCase());
            }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('avatar timeout')), 8000)),
        ]).catch(() => {}).finally(() => markAvatarSettled('mine'));
        
        let convIdToUse = activeConvId;
        // Thread scope: one exchange per (user pair + property). A null
        // propertyId means a general chat — matched pair-only as before.
        if (!convIdToUse && participantB) {
          const pairFilter = `and(participant_a.eq.${user.id},participant_b.eq.${participantB}),and(participant_a.eq.${participantB},participant_b.eq.${user.id})`;
          const scopeFilter = propertyId
            ? `and(participant_a.eq.${user.id},participant_b.eq.${participantB},property_id.eq.${propertyId}),and(participant_a.eq.${participantB},participant_b.eq.${user.id},property_id.eq.${propertyId})`
            : pairFilter;
          // Bounded lookup: on timeout treat as not-found (graceful null
          // path below) instead of hanging the room open forever.
          const { data: existing } = await withTimeout(supabase
            .from('conversations')
            .select('id')
            .or(scopeFilter)
            .limit(1)
            .maybeSingle(), 10000, 'conversation').catch(() => ({}));

          if (existing) {
            convIdToUse = existing.id;
            setActiveConvId(existing.id);
          }
        }

        if (convIdToUse) {
          loadMessages(convIdToUse);
          markMessagesAsRead(convIdToUse, user.id);
        } else {
          setLoadingInitial(false);
        }
      }
    });

    if (!participantB) markAvatarSettled('theirs');
    if (participantB) {
      Promise.race([
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
          }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('profile timeout')), 8000)),
      ]).catch(() => {}).finally(() => markAvatarSettled('theirs'));

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
      .update({ is_read: true, status: 'read' })
      .eq('conversation_id', convId)
      .neq('sender_id', currentUserId)
      .eq('is_read', false)
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
    try {
      // Incremental sync: paint from phone cache, fetch only rows newer
      // than the newest cached message (gte + id dedupe covers ties).
      let cached = [];
      try {
        const raw = await AsyncStorage.getItem(`cached_messages_${convId}`);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed) && parsed.length > 0) cached = parsed;
      } catch (_) {}
      let query = supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: true });
      const newest = cached.length > 0 ? cached[cached.length - 1]?.created_at : null;
      if (newest) query = query.gte('created_at', newest);
      const { data } = await withRetry(
        () => withTimeout(
          query,
          10000,
          'messages'
        ),
        { attempts: 2, baseDelayMs: 600, label: 'messages' }
      );
      if (data) {
        const seen = new Set(cached.map((m) => m.id));
        const merged = [...cached, ...data.filter((m) => !seen.has(m.id))];
        setMessages(merged);
        // Keep the thread cached (last 80) for instant reopen.
        AsyncStorage.setItem(`cached_messages_${convId}`, JSON.stringify(merged.slice(-80))).catch(() => {});
      } else if (cached.length > 0) {
        setMessages(cached);
      }
    } catch (e) {
      console.log('[Chat] loadMessages failed:', e?.message || e);
    } finally {
      setLoadingInitial(false);
    }
  }

  // Resolve listing info for tagged reservation messages (batched, cached).
  useEffect(() => {
    const ids = [...new Set((messages || []).map(m => m.property_id).filter(Boolean))]
      .filter(id => !msgProps[id]);
    if (ids.length === 0) return;
    let cancelled = false;
    supabase
      .from('properties')
      .select('id, title, rent_usd, city, suburb, property_images(url, is_cover)')
      .in('id', ids)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map = {};
        data.forEach(p => {
          const cover = (p.property_images || []).find(img => img.is_cover) || p.property_images?.[0];
          map[p.id] = { ...p, coverUrl: toPublicImageUrl(cover?.url) };
        });
        setMsgProps(prev => ({ ...prev, ...map }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [messages]);

  const sendMessage = async () => {
    if (!inputText.trim() || !userId) return;
    
    let currentConvId = activeConvId;

    // If no conversation exists yet, find or create the thread for this
    // (user pair + property) scope.
    if (!currentConvId) {
      const pairFilter = `and(participant_a.eq.${userId},participant_b.eq.${participantB}),and(participant_a.eq.${participantB},participant_b.eq.${userId})`;
      const scopeFilter = propertyId
        ? `and(participant_a.eq.${userId},participant_b.eq.${participantB},property_id.eq.${propertyId}),and(participant_a.eq.${participantB},participant_b.eq.${userId},property_id.eq.${propertyId})`
        : pairFilter;
      const { data: existing } = await withTimeout(supabase
        .from('conversations')
        .select('id')
        .or(scopeFilter)
        .limit(1)
        .maybeSingle(), 10000, 'conversation').catch(() => ({}));

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
          // Pre-migration database (one-chat-per-pair unique index): reuse
          // the pair thread instead of failing the send.
          if (convError.code === '23505') {
            const { data: legacy } = await supabase
              .from('conversations')
              .select('id')
              .or(pairFilter)
              .limit(1)
              .maybeSingle();
            if (legacy) {
              currentConvId = legacy.id;
              setActiveConvId(currentConvId);
            } else {
              console.error("Error creating conversation", convError);
              return;
            }
          } else {
            console.error("Error creating conversation", convError);
            return;
          }
        } else {
          currentConvId = newConv.id;
          setActiveConvId(currentConvId);
        }
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
      // Real push for the recipient (fire-and-forget — never blocks send).
      // Sender name resolves locally from the session metadata.
      try {
        const me = await getSessionUser();
        const senderName = [me?.user_metadata?.first_name, me?.user_metadata?.last_name]
          .filter(Boolean).join(' ') || null;
        NotificationService.notifyChatRecipient({
          recipientId: participantB,
          senderId: userId,
          senderName,
          body: textToSend,
          conversationId: currentConvId,
        }).catch(() => {});
      } catch (_) {}
    } else if (isTransientError(error) && currentConvId) {
      // Offline mid-send: input is already cleared — queue it. The realtime
      // echo (or next load) delivers it on reconnect; no duplicates possible.
      enqueueOutbox({ kind: 'chat-send', convId: currentConvId, senderId: userId, body: textToSend }).catch(() => {});
    } else {
      console.error("Error sending message", error);
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
            <Ionicons name="chevron-back" size={26} color={t.text} />
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.headerProfileArea} 
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`View ${recipientName || 'chat'} profile`}
            onPress={() => participantB && navigation.navigate('PublicProfile', { userId: participantB })}
          >
            <View style={styles.headerAvatarWrap}>
              {recipientAvatar ? (
                <Image source={{ uri: recipientAvatar }} style={styles.headerAvatar} />
              ) : !avatarsReady ? (
                <SkeletonBlock width={36} height={36} borderRadius={18} />
              ) : (
                <View style={styles.headerAvatarFallback}>
                  <Text style={styles.headerAvatarText}>{recipientInitial}</Text>
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
              <Ionicons name="call" size={22} color={t.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleWhatsApp} style={styles.whatsappBtn} activeOpacity={0.8}>
              <Ionicons name="logo-whatsapp" size={20} color={t.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDeleteChat} style={styles.actionIconBtn}>
              <Ionicons name="ellipsis-horizontal" size={20} color={t.text} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Pinned Mover Fleet Card */}
        {recipientRole === 'mover' && recipientVehicle && (
          <View style={styles.moverFleetCard}>
            <View style={styles.moverFleetIconCircle}>
              <Ionicons name="cube" size={18} color={t.text} />
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
                  <Ionicons name="map" size={12} color="#8E8E93" />
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
            {messages.length === 0 || !userId ? (
              (loadingInitial || !userId) ? (
                <View style={styles.emptyChatContainer}>
                  <ActivityIndicator size="large" color={t.text} />
                </View>
              ) : (
              <View style={styles.emptyChatContainer}>
                <View style={styles.emptyChatIconCircle}>
                  <Ionicons name="lock-closed" size={24} color="#8A8A8A" />
                </View>
                <Text style={styles.emptyChatTitle}>End-to-End Chat</Text>
                <Text style={styles.emptyChatSub}>
                  Messages are secure. Send a message or pick a quick inquiry below.
                </Text>
              </View>
              )
            ) : (
              messages.map((msg) => {
                const isMe = msg.sender_id === userId;
                const showOptions = canModifyMessage(msg);
                const avatarUri = isMe ? myAvatar : recipientAvatar;
                return (
                  <View key={msg.id} style={[styles.msgWrapper, isMe ? styles.msgWrapperRight : styles.msgWrapperLeft]}>
                    {!isMe && (
                      avatarUri ? (
                        <Image source={{ uri: avatarUri }} style={styles.msgAvatar} />
                      ) : !avatarsReady ? (
                        <SkeletonBlock width={28} height={28} borderRadius={14} />
                      ) : (
                        <View style={[styles.msgAvatar, styles.msgAvatarFallback]}>
                          <Text style={styles.msgAvatarText}>{recipientInitial}</Text>
                        </View>
                      )
                    )}
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onLongPress={() => showOptions && setActionMsg(msg)}
                      style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}
                    >
                      <Text style={[styles.msgText, isMe ? styles.msgTextMe : styles.msgTextThem]}>{msg.body}</Text>

                      {/* Listing link tag on reservation messages */}
                      {!!msg.property_id && (
                        <TouchableOpacity
                          style={[styles.listingTag, isMe ? styles.listingTagMe : styles.listingTagThem]}
                          onPress={() => navigation.navigate('Detail', { propertyId: msg.property_id })}
                          activeOpacity={0.8}
                        >
                          <Ionicons name="home" size={13} color={isMe ? (dark ? '#000000' : '#FFFFFF') : t.text} />
                          <Text style={[styles.listingTagText, isMe ? styles.listingTagTextMe : styles.listingTagTextThem]} numberOfLines={1}>
                            {msgProps[msg.property_id]?.title || 'View listing'}
                          </Text>
                          <Ionicons name="chevron-forward" size={13} color={isMe ? (dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)') : '#8E8E93'} />
                        </TouchableOpacity>
                      )}
                      
                      {/* WhatsApp timestamp + checkmarks in bottom right */}
                      <View style={styles.bubbleMetaRow}>
                        {msg.is_edited && <Text style={[styles.editedTag, isMe && styles.metaOnBubble]}>edited</Text>}
                        <Text style={[styles.timeText, isMe && styles.metaOnBubble]}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Text>
                        {isMe && (
                          <Ionicons
                            name={msg.status === 'read' ? "checkmark-done-sharp" : "checkmark-sharp"}
                            size={15}
                            color={msg.status === 'read' ? (dark ? "#000000" : "#FFFFFF") : (dark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.7)")}
                            style={{ marginLeft: 3 }}
                          />
                        )}
                      </View>
                    </TouchableOpacity>
                    {isMe && (
                      myAvatar ? (
                        <Image source={{ uri: myAvatar }} style={styles.msgAvatar} />
                      ) : !avatarsReady ? (
                        <SkeletonBlock width={28} height={28} borderRadius={14} />
                      ) : (
                        <View style={[styles.msgAvatar, styles.msgAvatarFallback]}>
                          <Text style={styles.msgAvatarText}>{myInitial || ''}</Text>
                        </View>
                      )
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>

        {/* Message input bar */}
        <View style={styles.inputArea}>
          <TouchableOpacity style={styles.attachmentBtn} activeOpacity={0.7}>
            <Ionicons name="add" size={24} color={t.text} />
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
              name={inputText.trim() ? "arrow-up" : "mic"} 
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
                <Ionicons name="arrow-undo" size={18} color="#FF3B30" />
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

const buildStyles = (t, dark) => StyleSheet.create({  
  container: { flex: 1, backgroundColor: t.bg },
  
  // Header — flat white like Threads/IG DMs
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.card,
    paddingTop: Platform.OS === 'ios' ? 54 : 38,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
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
  headerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.tile },
  headerAvatarFallback: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.tile, justifyContent: 'center', alignItems: 'center' },
  headerAvatarText: { fontSize: 15, fontWeight: '600', color: t.text },
  headerOnlineBadge: { 
    position: 'absolute', 
    bottom: 0, 
    right: 0, 
    width: 10, 
    height: 10, 
    borderRadius: 5, 
    backgroundColor: '#34C759', 
    borderWidth: 2, 
    borderColor: t.card 
  },
  headerTitleBox: { marginLeft: 10, flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '600', color: t.text },
  headerSubtitle: { fontSize: 12, color: t.sub, marginTop: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionIconBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  whatsappBtn: { 
    width: 32, 
    height: 32, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
  
  // Pinned Listing Header Card
  // Pinned Mover Fleet Card
  moverFleetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: t.card,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.hairline,
  },
  moverFleetIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.tile,
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
    color: t.text,
    marginBottom: 1,
  },
  moverFleetSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  plateBadge: {
    backgroundColor: t.input,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  plateBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: t.text,
  },
  moverFleetCity: {
    fontSize: 11,
    color: t.sub,
  },
  moverCallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111111',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  moverCallActionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // Chat Feed — flat white like Threads/IG DMs
  chatBackground: {
    flex: 1,
    backgroundColor: t.bg,
  },
  chatList: { paddingHorizontal: 12, paddingVertical: 12 },
  msgWrapper: { marginBottom: 8, maxWidth: '86%', flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  msgAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: t.tile },
  msgAvatarFallback: { justifyContent: 'center', alignItems: 'center' },
  msgAvatarText: { fontSize: 13, fontWeight: '600', color: t.text },
  msgWrapperRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  msgWrapperLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },

  // Threads-style bubbles — theme-filled sent, gray received. No blue.
  bubble: {
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 8,
    borderRadius: 18,
    flexShrink: 1,
  },
  bubbleMe: {
    backgroundColor: t.text,
    borderTopRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: t.input,
    borderTopLeftRadius: 4,
  },
  msgText: { fontSize: 17.5, lineHeight: 24 },
  msgTextMe: { color: t.bg },
  msgTextThem: { color: t.text },
  // Tappable listing link tagged on reservation messages
  listingTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
  },
  listingTagMe: {
    backgroundColor: dark ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.22)',
  },
  listingTagThem: {
    backgroundColor: t.bg,
  },
  listingTagText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  listingTagTextMe: { color: dark ? '#000000' : '#FFFFFF' },
  listingTagTextThem: { color: t.text },
  bubbleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  timeText: { fontSize: 12, color: t.sub, marginLeft: 4 },
  metaOnBubble: { color: dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)' },
  editedTag: { fontSize: 11, fontStyle: 'italic', color: t.sub, marginRight: 4 },

  // Action Menu
  actionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', alignItems: 'center' },
  optionsMenu: {
    width: 180,
    backgroundColor: t.card,
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
    color: t.text,
    fontWeight: '500',
  },
  optionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.hairline,
  },

  // Edit Modal
  editCard: {
    width: '85%',
    maxWidth: 340,
    backgroundColor: t.card,
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
    color: t.text,
    marginBottom: 10,
  },
  editInput: {
    backgroundColor: t.input,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 70,
    textAlignVertical: 'top',
    fontSize: 15,
    color: t.text,
    marginBottom: 14,
  },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  editCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: t.input,
  },
  editCancelText: { fontSize: 13, color: t.sub, fontWeight: '600' },
  editSaveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#111111',
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
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  emptyChatTitle: { fontSize: 15, fontWeight: '700', color: t.text, marginBottom: 4 },
  emptyChatSub: { fontSize: 13, color: t.sub, textAlign: 'center', lineHeight: 18 },

  // Input Bar — flat white, gray pill field
  inputArea: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: t.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
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
    backgroundColor: t.input,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 6 : 2,
    minHeight: 36,
    maxHeight: 100,
    justifyContent: 'center',
  },
input: {
    fontSize: 18,
    color: t.text,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnInactive: {
    backgroundColor: '#D9D9D9',
  },
});
