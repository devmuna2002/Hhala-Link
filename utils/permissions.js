import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';

// Central permission flows: every system prompt is requested from exactly
// one place, and denials always offer a direct jump to system settings
// (re-requesting after a hard deny never shows a dialog again).

export async function openSystemSettings() {
  try {
    await Linking.openSettings();
    return true;
  } catch (_) {
    return false;
  }
}

export async function getNotificationPermission() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  } catch (_) {
    return 'undetermined';
  }
}

export async function requestNotificationPermission() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return 'granted';
    const { status } = await Notifications.requestPermissionsAsync();
    return status;
  } catch (_) {
    return 'denied';
  }
}

export async function getLocationPermission() {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    return status;
  } catch (_) {
    return 'undetermined';
  }
}

export async function requestLocationPermission() {
  try {
    const { status: existing } = await Location.getForegroundPermissionsAsync();
    if (existing === 'granted') return 'granted';
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status;
  } catch (_) {
    return 'denied';
  }
}
