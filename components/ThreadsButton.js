import React, { useRef } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../utils/theme';

// Standard Threads-style button used across the app for every
// Connect / Message / Request / Follow / Approve action.
//
// Variants (all theme-aware, no hardcoded blues/blacks):
//   - "primary": filled pill (t.text bg, t.bg text) — main CTA
//   - "outline": bordered pill (t.card bg, t.text border+text) — Threads Follow style
//   - "muted":   gray pill (t.input bg, t.text text) — secondary / Following state
//
// Sizes:
//   - "pill": compact (height 36, radius 999) — inline rows, cards
//   - "md":   full-width (height 48, radius 12) — detail / modal actions
//   - "sm":   tiny inline (height 32, radius 999) — quick actions
export default function ThreadsButton({
  title,
  icon,
  iconSize,
  onPress,
  variant = 'outline',
  size = 'pill',
  disabled = false,
  loading = false,
  style,
  textStyle,
  activeOpacity = 0.65,
  haptics = true,
}) {
  const { t } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40 }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  };
  const handlePress = (e) => {
    if (disabled || loading) return;
    if (haptics) {
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch (_) {}
    }
    onPress?.(e);
  };

  const variantStyle =
    variant === 'primary'
      ? { backgroundColor: t.text, borderWidth: 0 }
      : variant === 'muted'
        ? { backgroundColor: t.input, borderWidth: 0 }
        : { backgroundColor: t.card, borderWidth: 1, borderColor: t.text };

  const variantText =
    variant === 'primary'
      ? { color: t.bg }
      : { color: t.text };

  const sizeStyle =
    size === 'md'
      ? { minHeight: 48, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 12 }
      : size === 'sm'
        ? { minHeight: 32, paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999 }
        : { minHeight: 36, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999 };

  const fontSize = size === 'md' ? 15 : size === 'sm' ? 13 : 14;

  return (
    <TouchableOpacity
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      activeOpacity={activeOpacity}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[styles.base, variantStyle, sizeStyle, (disabled || loading) && styles.disabled, style]}
    >
      <Animated.View style={[styles.inner, { transform: [{ scale }] }]}>
        {loading ? (
          <ActivityIndicator size="small" color={variant === 'primary' ? t.bg : t.text} />
        ) : (
          <>
            {icon ? (
              <Ionicons
                name={icon}
                size={iconSize || (size === 'md' ? 16 : 14)}
                color={variant === 'primary' ? t.bg : t.text}
                style={styles.icon}
              />
            ) : null}
            <Text style={[styles.label, variantText, { fontSize }, textStyle]} numberOfLines={1}>
              {title}
            </Text>
          </>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  icon: {
    marginTop: 1,
  },
  label: {
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  disabled: {
    opacity: 0.5,
  },
});
