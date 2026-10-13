import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Animated,
  StatusBar,
  SafeAreaView,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { useTheme } from '../utils/theme';
import ThreadsButton from '../components/ThreadsButton';

// Threads-style system type (no Poppins on this screen)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

export default function ApprovalPendingScreen({ user, profile, onApproved, onSignOut }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const [checking, setChecking] = useState(false);
  const [currentProfile, setCurrentProfile] = useState(profile);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const role = currentProfile?.role || 'agent';
  const isMover = role === 'mover';
  const isAdmin = role === 'admin';
  const displayName = currentProfile?.business_name || currentProfile?.first_name || 'Partner';

  useEffect(() => {
    // Subtle breathing pulse on the status tile (no glow — flat Threads look)
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.06,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // 1. Realtime listener for instant auto-login once approved in Supabase Studio
    const channel = supabase
      .channel(`approval_watch_${user.id}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `id=eq.${user.id}`,
        },
        (payload) => {
          console.log('[ApprovalPending] Realtime profile change:', payload);
          if (payload.new) {
            setCurrentProfile(payload.new);
            if (payload.new.approval_status === 'approved' || payload.new.is_approved === true) {
              onApproved(payload.new);
            }
          }
        }
      )
      .subscribe();

    // 2. Periodic background poll every 6 seconds as a backup
    const interval = setInterval(() => {
      checkStatusSilently();
    }, 6000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user.id]);

  const checkStatusSilently = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (!error && data) {
        setCurrentProfile(data);
        if (data.approval_status === 'approved' || data.is_approved === true) {
          onApproved(data);
        }
      }
    } catch (_) {}
  };

  const handleManualCheck = async () => {
    setChecking(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (data) {
        setCurrentProfile(data);
        if (data.approval_status === 'approved' || data.is_approved === true) {
          Alert.alert('Approved', 'Your account has been verified. Welcome to Hlala Link!', [
            { text: 'Enter App', onPress: () => onApproved(data) },
          ]);
        } else if (data.approval_status === 'rejected') {
          Alert.alert(
            'Application Update',
            'Your account application was reviewed and could not be approved at this time. Please contact administrator support.'
          );
        } else {
          Alert.alert(
            'Still Under Review',
            'Our administrators are reviewing your submission. This screen will automatically unlock the moment you are approved.'
          );
        }
      }
    } catch (err) {
      Alert.alert('Network Notice', 'Could not refresh status. Please check your connection.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={t.statusBar} backgroundColor={t.bg} />
      <View style={styles.content}>
        {/* Status tile */}
        <Animated.View style={[styles.iconTile, { transform: [{ scale: pulseAnim }] }]}>
          <Ionicons
            name={isAdmin ? 'shield-checkmark' : isMover ? 'swap-horizontal' : 'business'}
            size={40}
            color={t.text}
          />
        </Animated.View>

        <Text style={styles.title}>Verification in progress</Text>
        <View style={styles.rolePill}>
          <Text style={styles.rolePillText}>
            {isAdmin ? 'Administrator' : isMover ? 'Mover & Fleet Partner' : 'Real Estate Agent'}
          </Text>
        </View>
        <Text style={styles.subtitle}>
          Hello {displayName} — your registration is pending admin approval.
        </Text>

        {/* Progress steps */}
        <View style={styles.card}>
          <View style={styles.stepRow}>
            <View style={[styles.stepIcon, styles.stepDone]}>
              <Ionicons name="checkmark" size={14} color="#FFFFFF" />
            </View>
            <View style={styles.stepMain}>
              <Text style={styles.stepTitle}>Application submitted</Text>
              <Text style={styles.stepSub}>We received your details</Text>
            </View>
          </View>
          <View style={styles.stepDivider} />
          <View style={styles.stepRow}>
            <View style={[styles.stepIcon, styles.stepCurrent]}>
              <Ionicons name="time" size={14} color="#FFFFFF" />
            </View>
            <View style={styles.stepMain}>
              <Text style={styles.stepTitle}>Under review</Text>
              <Text style={styles.stepSub}>An admin is verifying your account</Text>
            </View>
            <View style={styles.liveDot} />
          </View>
          <View style={styles.stepDivider} />
          <View style={styles.stepRow}>
            <View style={styles.stepIcon}>
              <Ionicons name="lock-closed" size={14} color={t.sub} />
            </View>
            <View style={styles.stepMain}>
              <Text style={[styles.stepTitle, styles.stepPending]}>Account unlocked</Text>
              <Text style={styles.stepSub}>This screen opens automatically</Text>
            </View>
          </View>
        </View>

        {/* Actions */}
        <ThreadsButton
          title="Check status now"
          icon="refresh"
          variant="primary"
          size="md"
          loading={checking}
          onPress={handleManualCheck}
          style={styles.checkBtn}
          textStyle={styles.bigBtnText}
          iconSize={20}
        />
        <ThreadsButton
          title="Contact support"
          icon="mail"
          variant="outline"
          size="md"
          onPress={() => Linking.openURL('mailto:support@hlalalink.com?subject=Account%20Approval%20Inquiry')}
          style={styles.supportBtn}
          textStyle={styles.bigBtnText}
          iconSize={20}
        />
        <Text style={styles.syncNote}>Live auto-sync is on — no need to keep tapping.</Text>
      </View>

      {/* Sign out footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={onSignOut} style={styles.signOutBtn} activeOpacity={0.65}>
          <Ionicons name="log-out-outline" size={16} color="#FF3B30" style={{ marginRight: 6 }} />
          <Text style={styles.signOutText}>Sign out / Switch account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconTile: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: t.tile,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 26,
    fontFamily: SYS_MED,
    fontWeight: '700',
    color: t.text,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  rolePill: {
    backgroundColor: t.input,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 10,
  },
  rolePillText: {
    fontSize: 12,
    fontFamily: SYS_MED,
    fontWeight: '600',
    color: t.text,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: SYS,
    color: t.sub,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 22,
    paddingHorizontal: 8,
  },
  card: {
    width: '100%',
    backgroundColor: t.card,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.hairline,
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginBottom: 22,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  stepDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.hairline,
    marginLeft: 38,
  },
  stepIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: t.input,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepDone: {
    backgroundColor: '#34C759',
  },
  stepCurrent: {
    backgroundColor: t.text,
  },
  stepMain: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 15,
    fontFamily: SYS_MED,
    fontWeight: '600',
    color: t.text,
  },
  stepPending: {
    color: t.sub,
  },
  stepSub: {
    fontSize: 13,
    fontFamily: SYS,
    color: t.sub,
    marginTop: 1,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
  checkBtn: {
    width: '100%',
    minHeight: 60,
    borderRadius: 999,
    marginBottom: 12,
  },
  supportBtn: {
    width: '100%',
    minHeight: 60,
    borderRadius: 999,
  },
  bigBtnText: {
    fontSize: 17,
    fontWeight: '700',
  },
  syncNote: {
    fontSize: 12,
    fontFamily: SYS,
    color: t.sub,
    marginTop: 12,
  },
  footer: {
    paddingVertical: 18,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.hairline,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signOutText: {
    fontSize: 14,
    fontFamily: SYS_MED,
    fontWeight: '600',
    color: '#FF3B30',
  },
});
