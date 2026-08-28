import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  StatusBar,
  SafeAreaView,
  Linking,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../supabase';

export default function ApprovalPendingScreen({ user, profile, onApproved, onSignOut }) {
  const [checking, setChecking] = useState(false);
  const [currentProfile, setCurrentProfile] = useState(profile);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const role = currentProfile?.role || 'agent';
  const isMover = role === 'mover';
  const isAdmin = role === 'admin';
  const displayName = currentProfile?.business_name || currentProfile?.first_name || 'Partner';

  useEffect(() => {
    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.12,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // 1. Realtime listener for instant auto-login once approved in Supabase Studio
    const channel = supabase
      .channel(`approval_watch_${user.id}`)
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
          Alert.alert('🎉 Approved!', 'Your account has been verified. Welcome to Hlala Link!', [
            { text: 'Enter App', onPress: () => onApproved(data) },
          ]);
        } else if (data.approval_status === 'rejected') {
          Alert.alert(
            'Application Update',
            'Your account application was reviewed and could not be approved at this time. Please contact administrator support.'
          );
        } else {
          Alert.alert(
            '⏳ Still Under Review',
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
      <StatusBar barStyle="light-content" backgroundColor="#011232" />
      <LinearGradient colors={['#011232', '#0A2558', '#011232']} style={StyleSheet.absoluteFill} />

      <View style={styles.content}>
        {/* Animated Badge Icon */}
        <Animated.View style={[styles.badgePulseContainer, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.iconCircle}>
            <Ionicons
              name={isAdmin ? 'shield-checkmark' : isMover ? 'cube' : 'business'}
              size={54}
              color="#0A84FF"
            />
          </View>
        </Animated.View>

        <Text style={styles.title}>Account Under Review</Text>
        <Text style={styles.roleTag}>
          {isAdmin ? 'Administrator Candidate' : isMover ? 'Mover & Fleet Partner' : 'Real Estate Agent'}
        </Text>

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Ionicons name="time-outline" size={20} color="#0A84FF" style={{ marginRight: 10 }} />
            <Text style={styles.cardHeadline}>Verification in Progress</Text>
          </View>
          <Text style={styles.cardText}>
            Hello <Text style={{ fontWeight: '700', color: '#FFF' }}>{displayName}</Text>, your registration is currently pending admin approval.
          </Text>
          <View style={styles.divider} />
          <View style={styles.liveSyncRow}>
            <View style={styles.liveDot} />
            <Text style={styles.liveSyncText}>
              Live auto-sync active · Screen will unlock automatically once approved
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <TouchableOpacity
          style={styles.checkBtn}
          onPress={handleManualCheck}
          disabled={checking}
          activeOpacity={0.8}
        >
          {checking ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <>
              <Ionicons name="refresh" size={18} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.checkBtnText}>Check Status Now</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.supportBtn}
          onPress={() => Linking.openURL('mailto:support@hlalalink.com?subject=Account%20Approval%20Inquiry')}
          activeOpacity={0.7}
        >
          <Ionicons name="mail-outline" size={16} color="#8E8E93" style={{ marginRight: 6 }} />
          <Text style={styles.supportBtnText}>Contact Administrator Support</Text>
        </TouchableOpacity>
      </View>

      {/* Sign out footer */}
      <View style={styles.footer}>
        <TouchableOpacity onPress={onSignOut} style={styles.signOutBtn}>
          <Ionicons name="log-out-outline" size={16} color="#FF453A" style={{ marginRight: 6 }} />
          <Text style={styles.signOutText}>Sign Out / Switch Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#011232',
  },
  content: {
    flex: 1,
    paddingHorizontal: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgePulseContainer: {
    marginBottom: 20,
    shadowColor: '#0A84FF',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    borderWidth: 2,
    borderColor: 'rgba(10, 132, 255, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 4,
  },
  roleTag: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#0A84FF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 24,
  },
  card: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    marginBottom: 24,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardHeadline: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#0A84FF',
  },
  cardText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    color: '#D1D1D6',
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 14,
  },
  liveSyncRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
    marginRight: 8,
  },
  liveSyncText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 11,
    color: '#8E8E93',
    flex: 1,
  },
  checkBtn: {
    width: '100%',
    height: 52,
    backgroundColor: '#0A84FF',
    borderRadius: 26,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0A84FF',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    marginBottom: 14,
  },
  checkBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  supportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  supportBtnText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#8E8E93',
  },
  footer: {
    paddingVertical: 18,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signOutText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: '#FF453A',
  },
});
