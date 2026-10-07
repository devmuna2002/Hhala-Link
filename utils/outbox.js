import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { DeviceEventEmitter } from 'react-native';
import { supabase } from '../supabase';
import { isTransientError } from './network';
import { CONNECTION_RETRY_EVENT } from './connection';

// Offline outbox: mutations made in dead zones (tower handoff, elevator,
// WiFi↔cellular flips) are persisted to AsyncStorage and flushed in order
// when connectivity returns — instead of failing and forcing the user to
// redo them. Permanent failures (RLS/validation) are dropped immediately
// so one bad op can never poison the queue.
//
// Supported op shapes:
//   { kind: 'fav-add' | 'fav-delete', userId, propertyId }
//   { kind: 'chat-send', convId, senderId, body }

const STORAGE_KEY = 'hlala_outbox_v1';
const MAX_ATTEMPTS = 10;

let flushing = false;
let wired = false;

async function readQueue() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function writeQueue(queue) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (_) {}
}

export async function enqueueOutbox(op) {
  if (!op || !op.kind) return;
  const queue = await readQueue();
  queue.push({ ...op, attempts: 0, enqueuedAt: Date.now() });
  await writeQueue(queue);
  // Opportunistic: network may already be back.
  flushOutbox().catch(() => {});
}

async function runOp(op) {
  switch (op.kind) {
    case 'fav-add':
      return supabase
        .from('saved_properties')
        .insert({ user_id: op.userId, property_id: op.propertyId });
    case 'fav-delete':
      return supabase
        .from('saved_properties')
        .delete()
        .eq('user_id', op.userId)
        .eq('property_id', op.propertyId);
    case 'chat-send':
      return supabase.from('messages').insert({
        conversation_id: op.convId,
        sender_id: op.senderId,
        body: op.body,
        status: 'sent',
      });
    default:
      return { error: { message: 'unknown op kind' } };
  }
}

export async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    let queue = await readQueue();
    if (queue.length === 0) return;
    const remaining = [];
    for (const op of queue) {
      const attempts = (op.attempts || 0) + 1;
      try {
        const { error } = await runOp(op);
        if (!error) continue; // sent — drop it
        if (isTransientError(error) && attempts < MAX_ATTEMPTS) {
          remaining.push({ ...op, attempts }); // still offline — retry later
        }
        // Permanent failure (RLS/validation/unknown kind): drop + log.
        else if (!isTransientError(error)) {
          console.log('[Outbox] dropping permanent failure:', op.kind, error.message);
        } else {
          remaining.push({ ...op, attempts });
        }
      } catch (e) {
        if (isTransientError(e) && attempts < MAX_ATTEMPTS) {
          remaining.push({ ...op, attempts });
        } else if (!isTransientError(e)) {
          console.log('[Outbox] dropping failed op:', op.kind, e?.message || e);
        } else {
          remaining.push({ ...op, attempts });
        }
      }
    }
    await writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

// Self-wiring: flush whenever the radio comes back, the user taps the
// connection banner retry, or the app foregrounds (import once).
export function wireOutboxAutoFlush() {
  if (wired) return;
  wired = true;
  try {
    const sub = DeviceEventEmitter.addListener(CONNECTION_RETRY_EVENT, () => {
      flushOutbox().catch(() => {});
    });
    void sub;
  } catch (_) {}
  try {
    NetInfo.addEventListener((state) => {
      const online = state?.isConnected !== false && state?.isInternetReachable !== false;
      if (online) flushOutbox().catch(() => {});
    });
  } catch (_) {}
}
