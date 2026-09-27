import { DeviceEventEmitter } from 'react-native';

export const FEED_SCROLL_EVENT = 'FEED_SCROLL';

export function emitFeedScroll(dy) {
  DeviceEventEmitter.emit(FEED_SCROLL_EVENT, dy);
}