import React, { useState, useEffect, useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Platform, View, Text, StyleSheet, Animated, Pressable, useWindowDimensions, DeviceEventEmitter, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase, getSessionUser } from '../supabase';
import { FEED_SCROLL_EVENT } from '../utils/feedScroll';
import { CONNECTION_EVENT, CONNECTION_RETRY_EVENT, isOfflineNow, requestReconnect } from '../utils/connection';
import { useTheme } from '../utils/theme';

import HomeScreen from './HomeScreen';
import SavedScreen from './SavedScreen';
import NotificationsScreen from './NotificationsScreen';
import ProfileScreen from './ProfileScreen';

const Tab = createBottomTabNavigator();
const TAB_ACTIVE = '#FFFFFF';
const TAB_INACTIVE = 'rgba(255, 255, 255, 0.55)';
// Every glyph on the floating bar renders at one uniform size.
const TAB_ICON_SIZE = 31;
const TAB_WIDTH = 232;
const TAB_HEIGHT = 54;

const ROUTE_ICONS = {
  Home: { active: 'home-sharp', inactive: 'home' },
  Wishlist: { active: 'bookmark', inactive: 'bookmark' },
  Notification: { active: 'notifications', inactive: 'notifications' },
  Profile: { active: 'person', inactive: 'person' },
};

const TabBadge = ({ count }) => {
  if (!count || count <= 0) return null;
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
    </View>
  );
};

function UploadPlaceholder() {
  return null;
}

function ThreadsTabBar({ state, descriptors, navigation }) {
  const windowWidth = useWindowDimensions().width;
  const insets = useSafeAreaInsets();
  const [counts, setCounts] = useState({ total: 0 });
  const [offline, setOffline] = useState(isOfflineNow());
  const [justConnected, setJustConnected] = useState(false);
  // Tenants/movers never list properties: the center "+" becomes a movers
  // shortcut for them. Agents/landlords keep the "+ Add Listing" button.
  const [role, setRole] = useState('tenant');
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  const connectedTimer = useRef(null);
  const flashGen = useRef(0);
  const hideAnim = useRef(new Animated.Value(0)).current;
  const spinVal = useRef(new Animated.Value(0)).current;

  const bottomOffset = Math.max(insets.bottom, 10) + 12;
  // Android gets a docked Material-style bar: full-width, pinned to the
  // bottom edge, content lifted above the system gesture bar. iOS keeps
  // the floating pill.
  const isAndroid = Platform.OS === 'android';
  // Docked Android bar hides by its full height + gesture inset.
  const hideDistance = TAB_HEIGHT + (isAndroid ? insets.bottom : bottomOffset) + 24;

  const stickBar = () => {
    Animated.timing(hideAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start();
  };

  // Soft crossfade whenever the bar swaps modes (icons/banner/connected).
  const swapOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    swapOpacity.setValue(0.3);
    Animated.timing(swapOpacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
  }, [offline, justConnected, swapOpacity]);

  // Smooth resize between the 232px icon pill and the full-width banner so
  // no empty space pops in or out. Layout props need the JS driver.
  const modeAnim = useRef(new Animated.Value(0)).current;
  const isBanner = offline || justConnected;
  useEffect(() => {
    Animated.timing(modeAnim, { toValue: isBanner ? 1 : 0, duration: 250, useNativeDriver: false }).start();
  }, [offline, justConnected, modeAnim]);
  const barLeft = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isAndroid ? [0, 0] : [(windowWidth - TAB_WIDTH) / 2, 16],
  });
  const barWidth = modeAnim.interpolate({
    inputRange: [0, 1],
    outputRange: isAndroid ? [windowWidth, windowWidth] : [TAB_WIDTH, windowWidth - 32],
  });
  const spin = spinVal.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  // Swap icons <-> connection banner when connectivity changes.
  // Guarded on real transitions: duplicate online events (both feeds report
  // success after one retry tap) are ignored so they can never wedge the
  // Connected flash on by killing its timer without replacing it.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(CONNECTION_EVENT, (isOff) => {
      const off = !!isOff;
      if (off) {
        if (offlineRef.current) return;
        offlineRef.current = true;
        flashGen.current += 1;
        clearTimeout(connectedTimer.current);
        // Reconnecting: show the banner and pin it visible.
        setJustConnected(false);
        setOffline(true);
        stickBar();
      } else {
        if (!offlineRef.current) return;
        offlineRef.current = false;
        // Just reconnected: flash green "Connected" for exactly 1s, then icons.
        setOffline(false);
        setJustConnected(true);
        stickBar();
        flashGen.current += 1;
        const gen = flashGen.current;
        clearTimeout(connectedTimer.current);
        connectedTimer.current = setTimeout(() => {
          if (flashGen.current === gen) setJustConnected(false);
        }, 1000);
      }
    });
    return () => { sub.remove(); clearTimeout(connectedTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideAnim]);

  // Spin the sync icon while showing the connection banner.
  useEffect(() => {
    if (!offline) return;
    spinVal.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spinVal, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [offline, spinVal]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FEED_SCROLL_EVENT, (dy) => {
      // Pinned while the connection banner (or Connected flash) is showing.
      if (offlineRef.current || justConnected) return;
      if (dy > 6) {
        Animated.timing(hideAnim, { toValue: hideDistance, duration: 160, useNativeDriver: true }).start();
      } else if (dy < -6) {
        Animated.timing(hideAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start();
      }
    });
    return () => sub.remove();
  }, [hideAnim, hideDistance, justConnected]);

  useEffect(() => {
    let cancelled = false;
    let cleanupRealtime;

    getSessionUser().then((user) => {
      if (user && !cancelled) {
        fetchCounts(user.id);
        setupRealtime(user.id);
        supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()
          .then(({ data: profile }) => {
            if (!cancelled && profile?.role) setRole(profile.role);
          })
          .catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      cleanupRealtime?.();
    };
  }, []);

  const fetchCounts = async (userId) => {
    const { data, error } = await supabase
      .from('notifications')
      .select('type, is_read')
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) return;

    const notifications = Array.isArray(data) ? data : [];
    setCounts({ total: notifications.length });
  };

  const setupRealtime = (userId) => {
    const channel = supabase
      .channel(`notifs_${userId}_${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, (payload) => {
        setCounts(prev => ({ total: prev.total + 1 }));
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      }, () => {
        fetchCounts(userId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  // Offline: the tab bar itself becomes the connection banner.
  // Tap retries loading on the visible feed.
  // (Rendered inside the single shell below.)
  // Just reconnected: green "Connected" flash, then icons return.
  // (Rendered inside the single shell below.)

  // Single shell: the OUTER view owns JS-driven size (left/width) while the
  // INNER view owns native-driven movement (slide/fade). Mixing both drivers
  // on one node crashes the native animated module — never combine them.
  return (
    <Animated.View
      style={[
        styles.pill,
        {
          left: barLeft,
          width: barWidth,
          bottom: isAndroid ? 0 : bottomOffset,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.pillBody,
          isAndroid && styles.dockedBody,
          isAndroid && { paddingBottom: insets.bottom },
          isBanner && styles.pillOffline,
          {
            flex: 1,
            transform: [{ translateY: hideAnim }],
            opacity: swapOpacity,
          },
        ]}
      >
        {offline ? (
          <Pressable
            style={styles.offlineRow}
            onPress={() => {
              try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
              requestReconnect();
            }}
          >
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Ionicons name="sync" size={16} color="#FFFFFF" />
            </Animated.View>
            <Text style={styles.offlineText}>No connection — tap to retry</Text>
          </Pressable>
        ) : justConnected ? (
          <View style={styles.offlineRow}>
            <Ionicons name="cellular" size={16} color="#FFFFFF" />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        ) : (
          <>
            <View style={styles.pillRow}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const options = descriptors[route.key].options;
          const icons = ROUTE_ICONS[route.name];
          const tint = focused ? TAB_ACTIVE : TAB_INACTIVE;
          const badgeCount = route.name === 'Notification' ? counts.total : 0;

          // Center slot: agents/landlords get "+" → Add Listing, everyone else
          // (tenants, movers) gets a movers shortcut instead.
          if (route.name === 'Upload') {
            const canList = role === 'agent' || role === 'landlord' || role === 'admin';
            if (!canList) {
              return (
                <Pressable
                  key={route.key}
                  accessibilityRole="button"
                  accessibilityLabel="Movers"
                  android_ripple={{ color: 'rgba(255,255,255,0.16)' }}
                  onPress={() => {
                    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
                    navigation.navigate('MoversList');
                  }}
                  style={styles.tabItem}
                >
                  <Ionicons name="repeat" size={TAB_ICON_SIZE} color={TAB_INACTIVE} />
                </Pressable>
              );
            }
            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityLabel={options.tabBarAccessibilityLabel || 'Upload'}
                android_ripple={{ color: 'rgba(255,255,255,0.16)' }}
                onPress={() => {
                  try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
                  navigation.navigate('AddListing');
                }}
                style={styles.tabItem}
              >
                <View style={styles.uploadCircle}>
                  <Ionicons name="add" size={TAB_ICON_SIZE} color="#111111" />
                </View>
              </Pressable>
            );
          }

          const onPress = () => {
            try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          if (!icons) return null;

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              android_ripple={{ color: 'rgba(255,255,255,0.16)' }}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={styles.tabItem}
            >
              <View style={styles.iconWrapper}>
                <Ionicons
                  name={focused ? icons.active : icons.inactive}
                  size={TAB_ICON_SIZE}
                  color={tint}
                />
                <TabBadge count={badgeCount} />
              </View>
            </Pressable>
          );
        })}
            </View>
          </>
        )}
        </Animated.View>
    </Animated.View>
  );
}

export default function MainTabs() {
  const { t } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Tab.Navigator tabBar={(props) => <ThreadsTabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: t.bg } }}>
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Wishlist" component={SavedScreen} />
        <Tab.Screen name="Upload" component={UploadPlaceholder} />
        <Tab.Screen name="Notification" component={NotificationsScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  // Transparent positioning shell — JS-driven size only, never visible.
  pill: {
    position: 'absolute',
    height: TAB_HEIGHT,
  },
  // The visible bar — solid black (no blur) so the white glyphs punch
  // through like X's tab bar. Background, border and shadow all hide
  // together with the icons on the sliding inner view.
  pillBody: {
    flex: 1,
    borderRadius: TAB_HEIGHT / 2,
    overflow: 'hidden',
    backgroundColor: '#111111',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  pillRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Android docked bar: full-width Material-style strip — no pill radius,
  // top hairline only, elevation tuned for a docked strip.
  dockedBody: {
    borderRadius: 0,
    borderWidth: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.16)',
    elevation: 8,
    shadowOpacity: 0,
  },
  pillOffline: {
    backgroundColor: '#1C1C1E',
    borderColor: 'transparent',
  },
  offlineRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  offlineText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  connectedText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '400',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 44,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 2,
    minWidth: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#FF3B30',
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
    fontFamily: 'Poppins_700Bold',
    textAlign: 'center',
    includeFontPadding: false,
  },
});