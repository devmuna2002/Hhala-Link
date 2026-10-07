import { DeviceEventEmitter } from 'react-native';

export const CONNECTION_EVENT = 'hlala-connection-changed';
export const CONNECTION_RETRY_EVENT = 'hlala-connection-retry';

// Two independent signals feed one offline state:
//   deviceOnline     — the phone's radio (NetInfo): airplane mode, no SIM,
//                      WiFi with no internet. Updated by App.js.
//   serverReachable  — Supabase actually answering queries. Updated by the
//                      screens whenever a query round-trip succeeds/fails.
// Offline = either one is down. Splitting them stops a single slow query
// from looking like "no internet", and lets the app auto-heal the moment
// the radio comes back without waiting for a manual retry tap.
let deviceOnline = true;
let serverReachable = true;

function combinedOffline() {
  return !(deviceOnline && serverReachable);
}

function broadcastIfChanged(prev) {
  const now = combinedOffline();
  if (now !== prev) {
    DeviceEventEmitter.emit(CONNECTION_EVENT, now);
  }
  return now;
}

// Offline transitions are debounced: single blips (tower handoff while
// moving between screens) must never flap the banner. Only a sustained
// failure flips the state; any success inside the window cancels it.
let offlineTimer = null;

function scheduleOffline(apply) {
  if (offlineTimer) return;
  try {
    offlineTimer = setTimeout(() => {
      offlineTimer = null;
      apply();
    }, 2500);
  } catch (_) {
    apply();
  }
}

function cancelPendingOffline() {
  try {
    if (offlineTimer) clearTimeout(offlineTimer);
  } catch (_) {}
  offlineTimer = null;
}

// Legacy helper: screens call emitConnection(true/false) after a query
// batch to report SERVER reachability (unchanged call sites).
export function emitConnection(isOffline) {
  if (!isOffline) {
    // Recovery is instant: cancel any pending offline flip.
    cancelPendingOffline();
    const prev = combinedOffline();
    serverReachable = true;
    broadcastIfChanged(prev);
    return;
  }
  scheduleOffline(() => {
    const prev = combinedOffline();
    serverReachable = false;
    broadcastIfChanged(prev);
  });
}

// Called by the NetInfo listener in App.js with the device-level state.
export function setDeviceOnline(online) {
  if (!online) {
    // Same debounce as server failures — handoff blips stay invisible.
    scheduleOffline(() => {
      const prev = combinedOffline();
      deviceOnline = false;
      broadcastIfChanged(prev);
    });
    return;
  }
  cancelPendingOffline();
  const prev = combinedOffline();
  const wasOffline = prev;
  deviceOnline = !!online;
  const now = broadcastIfChanged(prev);
  // Radio just came back: tell every feed to reload right away instead of
  // sitting on the offline banner until the user taps retry.
  if (wasOffline && !now) {
    try {
      DeviceEventEmitter.emit(CONNECTION_RETRY_EVENT);
    } catch (_) {}
  }
}

// Called by screens after a query batch to report SERVER reachability.
export function setServerReachable(reachable) {
  emitConnection(!reachable);
}

export function isOfflineNow() {
  return combinedOffline();
}

export function isDeviceOnline() {
  return deviceOnline;
}

// Sent when the user taps the offline tab bar to retry loading.
export function requestReconnect() {
  DeviceEventEmitter.emit(CONNECTION_RETRY_EVENT);
}
