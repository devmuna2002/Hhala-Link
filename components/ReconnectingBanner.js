import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * ReconnectingBanner
 * Shows a dark top banner with a spinning icon when the app is offline.
 * Calls onRetry every etryIntervalMs ms (default 30 000).
 */
export default function ReconnectingBanner({ isOffline, onRetry, retryIntervalMs = 30000 }) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [countdown, setCountdown] = useState(retryIntervalMs / 1000);

  // Spin animation
  useEffect(() => {
    if (!isOffline) return;
    const spin = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true })
    );
    spin.start();
    return () => spin.stop();
  }, [isOffline]);

  // Fade in/out
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: isOffline ? 1 : 0, duration: 300, useNativeDriver: true }).start();
  }, [isOffline]);

  // Auto-retry + countdown
  useEffect(() => {
    if (!isOffline) return;
    setCountdown(retryIntervalMs / 1000);
    const tick = setInterval(() => {
      setCountdown((prev) => (prev <= 1 ? retryIntervalMs / 1000 : prev - 1));
    }, 1000);
    const retry = setInterval(() => { try { onRetry(); } catch {} }, retryIntervalMs);
    return () => { clearInterval(tick); clearInterval(retry); };
  }, [isOffline, retryIntervalMs]);

  const rotate = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  if (!isOffline) return null;

  return (
    <Animated.View style={[styles.banner, { opacity: fadeAnim }]}>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Ionicons name="sync-outline" size={14} color="#FFFFFF" />
      </Animated.View>
      <Text style={styles.text}>
        Reconnecting in {countdown}s…
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1C1E',
    paddingVertical: 7,
    paddingHorizontal: 16,
    gap: 8,
  },
  text: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
