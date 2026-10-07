import React, { useEffect, useRef, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Image,
  Platform,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../utils/theme';
import { toPublicImageUrl } from '../utils/imageUrl';
import { TYPE_CONFIG } from '../screens/NotificationsScreen';

const { width } = Dimensions.get('window');

// Regex to strip any emojis from notification title and body
function stripEmojis(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{1F004}\u{1F0CF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

export default function RealtimeNotificationBanner({ notification, visible, onDismiss, onPress }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  // Finger drag offset, added to the entrance slide.
  const dragY = useRef(new Animated.Value(0)).current;
  const dismissedRef = useRef(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);

  const cleanTitle = stripEmojis(notification?.title || 'Notification');
  const cleanBody = stripEmojis(notification?.message || notification?.body || '');
  const actorAvatarRaw = notification?.actor?.avatar_url || notification?.data?.actor_avatar || null;
  const propertyImageRaw = notification?.data?.property_image || notification?.property_image || null;
  const actorAvatar = actorAvatarRaw ? toPublicImageUrl(actorAvatarRaw) : null;
  const propertyImage = propertyImageRaw ? toPublicImageUrl(propertyImageRaw) : null;
  const typeConfig = TYPE_CONFIG[notification?.type] || TYPE_CONFIG.default;

  useEffect(() => {
    setAvatarFailed(false);
    setMediaFailed(false);
  }, [notification?.id]);

  useEffect(() => {
    if (visible && notification) {
      dismissedRef.current = false;
      dragY.setValue(0);
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
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
    if (dismissedRef.current) return;
    dismissedRef.current = true;
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

  // Swipe up (or fast fling) to flick the pop away, Threads-style. A small
  // downward pull resists and springs back.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
      onPanResponderMove: (_, g) => {
        dragY.setValue(g.dy < 0 ? g.dy : g.dy * 0.25);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy < -50 || g.vy < -0.8) {
          handleDismiss();
        } else {
          Animated.spring(dragY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
            speed: 16,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

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
          transform: [{ translateY: slideAnim }, { translateY: dragY }],
          opacity: opacityAnim,
        },
      ]}
      {...panResponder.panHandlers}
    >
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.92}
        onPress={handlePress}
      >
        {/* Sender avatar with the notification type glyph */}
        <View style={styles.avatarContainer}>
          {actorAvatar && !avatarFailed ? (
            <Image source={{ uri: actorAvatar }} style={styles.avatar} onError={() => setAvatarFailed(true)} />
          ) : (
            <View style={[styles.typeIcon, { backgroundColor: typeConfig.color }]}>
              <Ionicons name={typeConfig.icon} size={22} color="#FFFFFF" />
            </View>
          )}
          {actorAvatar && !avatarFailed && (
            <View style={[styles.typeBadge, { backgroundColor: typeConfig.color }]}>
              <Ionicons name={typeConfig.icon} size={11} color="#FFFFFF" />
            </View>
          )}
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
        {propertyImage && !mediaFailed ? (
          <Image source={{ uri: propertyImage }} style={styles.mediaThumb} onError={() => setMediaFailed(true)} />
        ) : (
          <TouchableOpacity onPress={handleDismiss} style={styles.closeButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={16} color="#8A8A8A" />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

const buildStyles = (t) => StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 99999,
    elevation: 1000,
  },
  card: {
    backgroundColor: t.card,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.hairline,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  avatarContainer: {
    marginRight: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.tile,
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F0F0F0',
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
    fontFamily: SYS_MED,
    fontSize: 13,
    color: t.text,
    letterSpacing: 0.2,
  },
  dotSeparator: {
    fontSize: 11,
    color: t.sub,
    marginHorizontal: 4,
  },
  timeText: {
    fontFamily: SYS,
    fontSize: 12,
    color: t.sub,
  },
  titleText: {
    fontFamily: SYS_MED,
    fontSize: 17,
    color: t.text,
    lineHeight: 22,
  },
  bodyText: {
    fontFamily: SYS,
    fontSize: 16,
    color: t.sub,
    lineHeight: 22,
    marginTop: 1,
  },
  mediaThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: t.tile,
  },
  closeButton: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
