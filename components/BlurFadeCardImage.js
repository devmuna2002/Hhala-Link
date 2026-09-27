import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { DEFAULT_IMAGE_URL, toPublicImageUrl } from '../utils/imageUrl';

// Crisp image container for listing media. Memoized + cache-pinned so
// background list refreshes / carousel auto-slide / parent re-renders
// never remount-flash the picture (the "flickering" bug).
// - recyclingKey={uri}: expo-image reuses the decoded bitmap for the same
//   URL instead of tearing down + fading back in on every re-render.
// - cachePolicy="memory-disk": serve from RAM/disk cache, no network flash.
// - transition={0}: disable the default cross-fade that reads as flicker
//   when rows re-render in a fast feed.
// - Stable gray tile behind the image: no white flash while loading.
function BlurFadeCardImage({
  uri,
  style,
  children,
}) {
  const sourceUri = toPublicImageUrl(uri);
  const finalUri = sourceUri || DEFAULT_IMAGE_URL;

  return (
    <View style={[styles.container, style]}>
      <Image
        source={{ uri: finalUri }}
        contentFit="cover"
        style={StyleSheet.absoluteFill}
        // --- anti-flicker pins ---
        recyclingKey={finalUri}
        cachePolicy="memory-disk"
        transition={0}
        allowDownscaling
        autoplay={false}
      />

      {/* Optional Children Overlay (spec pills, badges, or title elements) */}
      {children}
    </View>
  );
}

export default React.memo(BlurFadeCardImage, (prev, next) => {
  // Re-render only when the resolved URL or layout style actually changes.
  // Parent state churn (badges, timers, background refresh) skips us.
  if (prev.uri !== next.uri) return false;
  if (prev.style !== next.style) {
    // Style objects are usually stable StyleSheet refs; a cheap JSON
    // fallback covers inline styles without false-skipping real changes.
    try {
      if (JSON.stringify(prev.style) !== JSON.stringify(next.style)) return false;
    } catch (_) {
      return false;
    }
  }
  return prev.children === next.children;
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    // Same calm gray as video tiles: no white flash while loading,
    // identical look whether the image is ready or not.
    backgroundColor: '#F0F0F0',
  },
});
