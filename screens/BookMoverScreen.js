import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView, TextInput,
  TouchableOpacity, Alert, ActivityIndicator, Switch, KeyboardAvoidingView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, getSessionUser } from '../supabase';
import { createMoverBooking } from '../services/MoversService';
import { NotificationService } from '../services/NotificationService';
import { useTheme } from '../utils/theme';

// Threads-style system type (no Poppins on this screen)
const SYS = Platform.select({ ios: 'System', android: 'sans-serif' });
const SYS_MED = Platform.select({ ios: 'System', android: 'sans-serif-medium' });

const ZIMBABWE_CITIES = [
  'Harare', 'Bulawayo', 'Chitungwiza', 'Mutare', 'Gweru',
  'Epworth', 'Kwekwe', 'Kadoma', 'Masvingo', 'Chinhoyi',
  'Norton', 'Marondera', 'Ruwa', 'Chegutu', 'Zvishavane',
];

function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
}

export default function BookMoverScreen({ route, navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const { mover } = route.params;

  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // Form fields
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropAddress, setDropAddress] = useState('');
  const [movingDate, setMovingDate] = useState('');
  const [movingTime, setMovingTime] = useState('');
  const [itemsDescription, setItemsDescription] = useState('');
  const [estimatedPrice, setEstimatedPrice] = useState(String(mover.base_price_usd || ''));
  const [needPacking, setNeedPacking] = useState(false);
  const [needInsurance, setNeedInsurance] = useState(false);
  const [notes, setNotes] = useState('');

  // City pickers (simplified dropdown-style)
  const [pickupCity, setPickupCity] = useState('Harare');
  const [dropCity, setDropCity] = useState('Harare');
  const [showPickupCities, setShowPickupCities] = useState(false);
  const [showDropCities, setShowDropCities] = useState(false);

  // Auto-format date as YYYY-MM-DD while typing (digits in → dashes placed).
  const formatDateInput = (text) => {
    const digits = text.replace(/\D/g, '').slice(0, 8);
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const d = digits.slice(6, 8);
    let out = y;
    if (m) out += '-' + m;
    if (d) out += '-' + d;
    return out;
  };

  // Auto-format time as HH:MM while typing, preserving a trailing AM/PM.
  const formatTimeInput = (text) => {
    const marker = text.match(/\s*([AaPp])\s*\.?\s*[Mm]?\.?\s*$/);
    let body = text;
    let suffix = '';
    if (marker) {
      body = text.slice(0, marker.index);
      suffix = ` ${marker[1].toUpperCase()}M`;
    }
    const digits = body.replace(/\D/g, '').slice(0, 4);
    let out = digits;
    if (digits.length > 2) out = digits.slice(0, 2) + ':' + digits.slice(2);
    return out + suffix;
  };

  useEffect(() => {
    getSessionUser().then((user) => {
      if (user) setCurrentUser(user);
    });
  }, []);

  const validate = () => {
    if (!pickupAddress.trim()) { Alert.alert('Required', 'Please enter a pickup address.'); return false; }
    if (!dropAddress.trim()) { Alert.alert('Required', 'Please enter a drop-off address.'); return false; }
    if (!movingDate.trim()) { Alert.alert('Required', 'Please enter the moving date (e.g. 2026-10-05).'); return false; }
    if (!isValidIsoDate(movingDate.trim())) {
      Alert.alert('Invalid Date', 'Enter a real date in YYYY-MM-DD format (e.g. 2026-10-05).');
      return false;
    }
    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    if (!currentUser) { Alert.alert('Error', 'You must be logged in to book a mover.'); return; }

    setLoading(true);
    try {
      const jobDetails = {
        pickup_address: `${pickupAddress.trim()}, ${pickupCity}`,
        drop_address: `${dropAddress.trim()}, ${dropCity}`,
        moving_date: movingDate.trim(),
        moving_time: movingTime.trim() || null,
        items_description: itemsDescription.trim() || null,
        estimated_price: parseFloat(estimatedPrice) || mover.base_price_usd || null,
        need_packing: needPacking,
        need_insurance: needInsurance,
        notes: notes.trim() || null,
      };

      const { data, error } = await createMoverBooking(currentUser.id, mover.id, jobDetails);

      if (error) {
        const msg = error.message || 'Could not create booking. Please try again.';
        // Mover profile without a movers row (DB not migrated yet) — say so
        // plainly instead of leaking the raw FK constraint text.
        if (/mover_bookings_mover_id_fkey|foreign key/i.test(msg)) {
          Alert.alert(
            'Mover Not Ready',
            'This mover just signed up and their booking profile is still being set up. Please try another mover in a few minutes.'
          );
          return;
        }
        Alert.alert('Booking Failed', msg);
        return;
      }

      Alert.alert(
        'Booking Sent',
        `Your move request has been sent to ${mover.company_name}. They will review and respond shortly.`,
        [{ text: 'View My Bookings', onPress: () => navigation.replace('MyMoverBookings') }]
      );
      // Real push for the mover (fire-and-forget).
      try {
        NotificationService.notifyUser({
          recipientId: mover.owner_id || mover.user_id || mover.id,
          title: 'New move request',
          body: `${jobDetails.pickup_address} → ${jobDetails.drop_address} on ${jobDetails.moving_date}.`,
          data: { type: 'mover_booking', bookingId: data?.id, screen: 'MyMoverBookings' },
        }).catch(() => {});
      } catch (_) {}
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
      console.error('BookMover submit error', e);
    } finally {
      setLoading(false);
    }
  };

  const CityPicker = ({ value, cities, show, onToggle, onSelect }) => (
    <View style={styles.cityPickerWrap}>
      <TouchableOpacity style={styles.cityPickerBtn} onPress={onToggle} activeOpacity={0.7}>
        <Ionicons name="map" size={15} color={t.text} />
        <Text style={styles.cityPickerText}>{value}</Text>
        <Ionicons name={show ? 'chevron-up' : 'chevron-down'} size={14} color="#8A8A8A" />
      </TouchableOpacity>
      {show && (
        <View style={styles.cityDropdown}>
          <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
            {cities.map(city => (
              <TouchableOpacity
                key={city}
                style={[styles.cityOption, value === city && styles.cityOptionActive]}
                onPress={() => onSelect(city)}
              >
                <Text style={[styles.cityOptionText, value === city && styles.cityOptionTextActive]}>
                  {city}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        {/* Nav bar */}
        <View style={styles.navBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={26} color={t.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Book a mover</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Mover summary */}
          <View style={styles.moverSummary}>
            <View style={styles.moverIcon}>
              <Ionicons name="swap-horizontal" size={22} color={t.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.moverSummaryName} numberOfLines={1}>{mover.company_name}</Text>
              <Text style={styles.moverSummaryCity} numberOfLines={1}>{mover.city}</Text>
            </View>
          </View>

          {/* Pickup */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pickup Location</Text>
            <CityPicker
              value={pickupCity}
              cities={ZIMBABWE_CITIES}
              show={showPickupCities}
              onToggle={() => { setShowPickupCities(v => !v); setShowDropCities(false); }}
              onSelect={(c) => { setPickupCity(c); setShowPickupCities(false); }}
            />
            <TextInput
              style={styles.input}
              placeholder="Street address, suburb…"
              placeholderTextColor="#8A8A8A"
              value={pickupAddress}
              onChangeText={setPickupAddress}
            />
          </View>

          {/* Drop-off */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Drop-off Location</Text>
            <CityPicker
              value={dropCity}
              cities={ZIMBABWE_CITIES}
              show={showDropCities}
              onToggle={() => { setShowDropCities(v => !v); setShowPickupCities(false); }}
              onSelect={(c) => { setDropCity(c); setShowDropCities(false); }}
            />
            <TextInput
              style={styles.input}
              placeholder="Street address, suburb…"
              placeholderTextColor="#8A8A8A"
              value={dropAddress}
              onChangeText={setDropAddress}
            />
          </View>

          {/* Date & Time */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Moving Date & Time</Text>
            <View style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1.4, marginRight: 10 }]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#8A8A8A"
                value={movingDate}
                onChangeText={(t) => setMovingDate(formatDateInput(t))}
                keyboardType="numeric"
                maxLength={10}
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="08:00 AM"
                placeholderTextColor="#8A8A8A"
                value={movingTime}
                onChangeText={(t) => setMovingTime(formatTimeInput(t))}
                maxLength={8}
              />
            </View>
          </View>

          {/* Items */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Items to Move</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Describe what you're moving — furniture, appliances, boxes, etc."
              placeholderTextColor="#8A8A8A"
              value={itemsDescription}
              onChangeText={setItemsDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Estimated budget */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Budget (USD)</Text>
            <View style={styles.budgetRow}>
              <Text style={styles.budgetDollar}>$</Text>
              <TextInput
                style={[styles.input, { flex: 1, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeftWidth: 0 }]}
                placeholder={String(mover.base_price_usd || '0')}
                placeholderTextColor="#8A8A8A"
                value={estimatedPrice}
                onChangeText={setEstimatedPrice}
                keyboardType="numeric"
              />
            </View>
          </View>

          {/* Add-ons */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Add-ons</Text>

            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons name="archive" size={18} color={t.text} />
                <View style={{ marginLeft: 12 }}>
                  <Text style={styles.toggleLabel}>Packing Assistance</Text>
                  <Text style={styles.toggleSub}>Movers will pack your items</Text>
                </View>
              </View>
              <Switch
                value={needPacking}
                onValueChange={setNeedPacking}
                trackColor={{ false: '#E5E5EA', true: '#111111' }}
                thumbColor="#FFF"
                ios_backgroundColor="#E5E5EA"
              />
            </View>

            <View style={[styles.toggleRow, { marginTop: 8 }]}>
              <View style={styles.toggleInfo}>
                <Ionicons name="shield-checkmark" size={18} color="#111111" />
                <View style={{ marginLeft: 12 }}>
                  <Text style={styles.toggleLabel}>Insurance Cover</Text>
                  <Text style={styles.toggleSub}>Protect your goods in transit</Text>
                </View>
              </View>
              <Switch
                value={needInsurance}
                onValueChange={setNeedInsurance}
                trackColor={{ false: '#E5E5EA', true: '#111111' }}
                thumbColor="#FFF"
                ios_backgroundColor="#E5E5EA"
              />
            </View>
          </View>

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Additional Notes</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Access codes, parking info, fragile items, special instructions…"
              placeholderTextColor="#8A8A8A"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="swap-horizontal" size={20} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.submitText}>Send Booking Request</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.disclaimer}>
            Your request will be sent to {mover.company_name}. They can accept, decline, or counter-offer.
          </Text>

          <View style={{ height: 60 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 36, paddingHorizontal: 8, paddingBottom: 4,
  },
  backBtn: {
    width: 40, height: 40,
    justifyContent: 'center', alignItems: 'center',
  },
  navTitle: { fontFamily: SYS_MED, fontSize: 17, color: t.text },

  scroll: { paddingHorizontal: 16, paddingTop: 12 },

  moverSummary: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.input, borderRadius: 14, padding: 14, marginBottom: 24,
  },
  moverIcon: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: t.card, justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  moverSummaryName: { fontFamily: SYS_MED, fontSize: 15, color: t.text },
  moverSummaryCity: { fontFamily: SYS, fontSize: 12, color: t.sub, marginTop: 1 },

  section: { marginBottom: 22 },
  sectionTitle: { fontFamily: SYS_MED, fontSize: 15, color: t.text, marginBottom: 10 },

  input: {
    backgroundColor: t.input, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontFamily: SYS, fontSize: 15, color: t.text,
  },
  multilineInput: { minHeight: 90, paddingTop: 14 },

  row: { flexDirection: 'row', alignItems: 'center' },

  budgetRow: { flexDirection: 'row', alignItems: 'center' },
  budgetDollar: {
    fontFamily: SYS_MED, fontSize: 18, color: t.text,
    backgroundColor: t.input,
    borderTopLeftRadius: 12, borderBottomLeftRadius: 12,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 11,
  },

  cityPickerWrap: { marginBottom: 8, position: 'relative', zIndex: 10 },
  cityPickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.input, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
  },
  cityPickerText: { flex: 1, fontFamily: SYS_MED, fontSize: 15, color: t.text },
  cityDropdown: {
    position: 'absolute', top: 50, left: 0, right: 0,
    backgroundColor: t.card, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.hairline,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 5,
    zIndex: 100,
  },
  cityOption: { paddingHorizontal: 16, paddingVertical: 12 },
  cityOptionActive: { backgroundColor: t.input },
  cityOptionText: { fontFamily: SYS, fontSize: 14, color: t.text },
  cityOptionTextActive: { fontFamily: SYS_MED },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.input, borderRadius: 14, padding: 14,
  },
  toggleInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  toggleLabel: { fontFamily: SYS_MED, fontSize: 14, color: t.text },
  toggleSub: { fontFamily: SYS, fontSize: 12, color: t.sub, marginTop: 1 },

  submitBtn: {
    backgroundColor: '#111111', borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8,
  },
  submitText: { fontFamily: SYS_MED, fontSize: 16, color: '#FFFFFF' },

  disclaimer: {
    fontFamily: SYS, fontSize: 12, color: t.sub,
    textAlign: 'center', marginTop: 12, lineHeight: 18,
  },
});
