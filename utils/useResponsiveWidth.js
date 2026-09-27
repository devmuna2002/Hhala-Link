import { Platform, useWindowDimensions } from 'react-native';

const WEB_FRAME_MAX_WIDTH = 430;

export function useResponsiveWidth() {
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web') return width;
  return Math.min(width, WEB_FRAME_MAX_WIDTH);
}