import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

// Regex to strip any emojis from notification title and body
function stripEmojis(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{1F004}\u{1F0CF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const TYPE_ICONS = {
  message: { name: 'chatbubble', color: '#0084FF', bg: '#E7F3FF' },
  new_listing: { name: 'home', color: '#0084FF', bg: '#E7F3FF' },
  price_drop: { name: 'pricetag', color: '#31A24C', bg: '#E7F8ED' },
  like: { name: 'heart', color: '#FA383E', bg: '#EAF3FF' },
  follow: { name: 'person-add', color: '#0084FF', bg: '#E7F3FF' },
  new_move_request: { name: 'cube', color: '#0084FF', bg: '#E7F3FF' },
  booking_confirmed: { name: 'checkmark-circle', color: '#31A24C', bg: '#E7F8ED' },
  application_approved: { name: 'checkmark-circle', color: '#31A24C', bg: '#E7F8ED' },
  application_rejected: { name: 'close-circle', color: '#FA383E', bg: '#EAF3FF' },
  default: { name: 'notifications', color: '#0084FF', bg: '#E7F3FF' },
};

export default function RealtimeNotificationBanner({ notification, visible, onDismiss, onPress }) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const type = notification?.type || 'default';
  const iconConfig = TYPE_ICONS[type] || TYPE_ICONS.default;

  const cleanTitle = stripEmojis(notification?.title || 'Notification');
  const cleanBody = stripEmojis(notification?.message || notification?.body || '');
  const actorAvatar = notification?.actor?.avatar_url || notification?.data?.actor_avatar || null;
  const propertyImage = notification?.data?.property_image || notification?.property_image || null;

  useEffect(() => {
    if (visible && notification) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: insets.top + 8,
          useNativeDriver: true,
          bounciness: 6,
          speed: 14,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        handleDismiss();
      }, 5500);

      return () => clearTimeout(timer);
    }
  }, [visible, notification]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -140,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (onDismiss) onDismiss();
    });
  };

  const handlePress = () => {
    if (onPress && notification) {
      onPress(notification);
    }
    handleDismiss();
  };

  if (!visible || !notification) return null;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        {
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.92}
        onPress={handlePress}
      >
        {/* Facebook Style Actor / Icon Avatar */}
        <View style={styles.avatarContainer}>
          {actorAvatar ? (
            <Image source={{ uri: actorAvatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatarFallback, { backgroundColor: iconConfig.bg }]}>
              <Ionicons name={iconConfig.name} size={22} color={iconConfig.color} />
            </View>
          )}

          {/* Facebook Mini Action Badge */}
          <View style={[styles.actionBadge, { backgroundColor: iconConfig.color }]}>
            <Ionicons name={iconConfig.name} size={10} color="#FFFFFF" />
          </View>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Text style={styles.sourceText}>Hlala Link</Text>
            <Text style={styles.dotSeparator}>·</Text>
            <Text style={styles.timeText}>Just now</Text>
          </View>

          <Text style={styles.titleText} numberOfLines={1}>
            {cleanTitle}
          </Text>

          {cleanBody ? (
            <Text style={styles.bodyText} numberOfLines={2}>
              {cleanBody}
            </Text>
          ) : null}
        </View>

        {/* Media Thumbnail if attached */}
        {propertyImage ? (
          <Image source={{ uri: propertyImage }} style={styles.mediaThumb} />
        ) : (
          <TouchableOpacity onPress={handleDismiss} style={styles.closeButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={16} color="#8A8D91" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 99999,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E4E6EB',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.16,
        shadowRadius: 12,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F0F2F5',
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    marginRight: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  sourceText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    color: '#0084FF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dotSeparator: {
    fontSize: 11,
    color: '#8A8D91',
    marginHorizontal: 4,
  },
  timeText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#8A8D91',
  },
  titleText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 13.5,
    color: '#050505',
    lineHeight: 18,
  },
  bodyText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12.5,
    color: '#65676B',
    lineHeight: 17,
    marginTop: 1,
  },
  mediaThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#F0F2F5',
  },
  closeButton: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
