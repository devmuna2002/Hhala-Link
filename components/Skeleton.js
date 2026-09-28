import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

// Shimmer placeholder kit — pulsing gray blocks shaped like the content
// being fetched, so loading states preview the layout instead of a bare
// spinner. Opacity animation runs on the native driver (cheap, 60fps).

export function SkeletonBlock({ width, height, borderRadius = 8, style }) {
  const opacity = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: '#E8EAED', opacity }, style]}
    />
  );
}

// Feed card placeholder — mirrors ListingCard (media + title + location).
export function ListingCardSkeleton({ wide = true } = {}) {
  return (
    <View style={styles.card}>
      <SkeletonBlock width="100%" height={wide ? 190 : 155} borderRadius={0} />
      <View style={styles.cardBody}>
        <SkeletonBlock width="55%" height={14} borderRadius={7} style={{ marginBottom: 8 }} />
        <SkeletonBlock width="90%" height={20} borderRadius={6} style={{ marginBottom: 8 }} />
        <SkeletonBlock width="65%" height={14} borderRadius={7} />
      </View>
    </View>
  );
}

// Chat row placeholder — mirrors the conversation row (avatar + lines).
export function ChatRowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock width={52} height={52} borderRadius={26} />
      <View style={styles.rowMain}>
        <SkeletonBlock width="60%" height={16} borderRadius={6} style={{ marginBottom: 8 }} />
        <SkeletonBlock width="90%" height={13} borderRadius={6} />
      </View>
    </View>
  );
}

// Notification row placeholder — mirrors the activity row.
export function NotificationRowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBlock width={44} height={44} borderRadius={22} />
      <View style={styles.rowMain}>
        <SkeletonBlock width="45%" height={14} borderRadius={6} style={{ marginBottom: 8 }} />
        <SkeletonBlock width="85%" height={13} borderRadius={6} />
      </View>
      <SkeletonBlock width={44} height={44} borderRadius={10} />
    </View>
  );
}

// Detail screen placeholder — hero image + title + spec lines.
export function DetailSkeleton() {
  return (
    <View style={styles.detailWrap}>
      <SkeletonBlock width="100%" height={280} borderRadius={18} style={{ marginBottom: 16 }} />
      <SkeletonBlock width="70%" height={24} borderRadius={8} style={{ marginBottom: 10 }} />
      <SkeletonBlock width="45%" height={15} borderRadius={7} style={{ marginBottom: 16 }} />
      <SkeletonBlock width="100%" height={14} borderRadius={7} style={{ marginBottom: 8 }} />
      <SkeletonBlock width="100%" height={14} borderRadius={7} style={{ marginBottom: 8 }} />
      <SkeletonBlock width="80%" height={14} borderRadius={7} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    marginBottom: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F3F4F6',
    alignSelf: 'center',
    width: '100%',
  },
  cardBody: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowMain: {
    flex: 1,
    marginLeft: 12,
  },
  detailWrap: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
});
