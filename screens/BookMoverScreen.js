import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView, TextInput,
  TouchableOpacity, Alert, ActivityIndicator, Switch, KeyboardAvoidingView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';
import { createMoverBooking } from '../services/MoversService';

const ZIMBABWE_CITIES = [
  'Harare', 'Bulawayo', 'Chitungwiza', 'Mutare', 'Gweru',
  'Epworth', 'Kwekwe', 'Kadoma', 'Masvingo', 'Chinhoyi',
  'Norton', 'Marondera', 'Ruwa', 'Chegutu', 'Zvishavane',
];

export default function BookMoverScreen({ route, navigation }) {
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

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUser(user);
    });
  }, []);

  const validate = () => {
    if (!pickupAddress.trim()) { Alert.alert('Required', 'Please enter a pickup address.'); return false; }
    if (!dropAddress.trim()) { Alert.alert('Required', 'Please enter a drop-off address.'); return false; }
    if (!movingDate.trim()) { Alert.alert('Required', 'Please enter the moving date (e.g. 2025-07-15).'); return false; }
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(movingDate.trim())) {
      Alert.alert('Invalid Date', 'Use format YYYY-MM-DD (e.g. 2025-07-15).');
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
        Alert.alert('Booking Failed', error.message || 'Could not create booking. Please try again.');
        return;
      }

      Alert.alert(
        'Booking Sent! 🎉',
        `Your move request has been sent to ${mover.company_name}. They will review and respond shortly.`,
        [{ text: 'View My Bookings', onPress: () => navigation.replace('MyMoverBookings') }]
      );
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
        <Ionicons name="location-outline" size={15} color="#0A84FF" />
        <Text style={styles.cityPickerText}>{value}</Text>
        <Ionicons name={show ? 'chevron-up' : 'chevron-down'} size={14} color="#8E8E93" />
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
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} color="#000" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Book a Mover</Text>
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
              <Ionicons name="cube" size={22} color="#0A84FF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.moverSummaryName}>{mover.company_name}</Text>
              <Text style={styles.moverSummaryCity}>{mover.city}</Text>
            </View>
            <Text style={styles.moverSummaryPrice}>${mover.base_price_usd || '—'}</Text>
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
              placeholderTextColor="#A0A0A0"
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
              placeholderTextColor="#A0A0A0"
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
                placeholderTextColor="#A0A0A0"
                value={movingDate}
                onChangeText={setMovingDate}
                keyboardType="numeric"
              />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="08:00 AM"
                placeholderTextColor="#A0A0A0"
                value={movingTime}
                onChangeText={setMovingTime}
              />
            </View>
          </View>

          {/* Items */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Items to Move</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder="Describe what you're moving — furniture, appliances, boxes, etc."
              placeholderTextColor="#A0A0A0"
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
                placeholderTextColor="#A0A0A0"
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
                <Ionicons name="archive-outline" size={18} color="#0A84FF" />
                <View style={{ marginLeft: 12 }}>
                  <Text style={styles.toggleLabel}>Packing Assistance</Text>
                  <Text style={styles.toggleSub}>Movers will pack your items</Text>
                </View>
              </View>
              <Switch
                value={needPacking}
                onValueChange={setNeedPacking}
                trackColor={{ false: '#E5E5EA', true: '#0A84FF' }}
                thumbColor="#FFF"
                ios_backgroundColor="#E5E5EA"
              />
            </View>

            <View style={[styles.toggleRow, { marginTop: 8 }]}>
              <View style={styles.toggleInfo}>
                <Ionicons name="shield-checkmark-outline" size={18} color="#0A84FF" />
                <View style={{ marginLeft: 12 }}>
                  <Text style={styles.toggleLabel}>Insurance Cover</Text>
                  <Text style={styles.toggleSub}>Protect your goods in transit</Text>
                </View>
              </View>
              <Switch
                value={needInsurance}
                onValueChange={setNeedInsurance}
                trackColor={{ false: '#E5E5EA', true: '#0A84FF' }}
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
              placeholderTextColor="#A0A0A0"
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
                <Ionicons name="cube-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA',
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center',
  },
  navTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: '#000' },

  scroll: { paddingHorizontal: 20, paddingTop: 20 },

  moverSummary: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EBF4FF', borderRadius: 14, padding: 14, marginBottom: 24,
  },
  moverIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', marginRight: 12,
  },
  moverSummaryName: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000' },
  moverSummaryCity: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },
  moverSummaryPrice: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#0A84FF' },

  section: { marginBottom: 22 },
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000', marginBottom: 10 },

  input: {
    backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
    fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#000',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
  },
  multilineInput: { minHeight: 90, paddingTop: 14 },

  row: { flexDirection: 'row', alignItems: 'center' },

  budgetRow: { flexDirection: 'row', alignItems: 'center' },
  budgetDollar: {
    fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#0A84FF',
    backgroundColor: '#F5F5F5', borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
    borderTopLeftRadius: 12, borderBottomLeftRadius: 12,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 11,
  },

  cityPickerWrap: { marginBottom: 8, position: 'relative', zIndex: 10 },
  cityPickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
  },
  cityPickerText: { flex: 1, fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#000' },
  cityDropdown: {
    position: 'absolute', top: 46, left: 0, right: 0,
    backgroundColor: '#FFF', borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 5,
    zIndex: 100,
  },
  cityOption: { paddingHorizontal: 16, paddingVertical: 11 },
  cityOptionActive: { backgroundColor: '#EBF4FF' },
  cityOptionText: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#3C3C43' },
  cityOptionTextActive: { fontFamily: 'Poppins_600SemiBold', color: '#0A84FF' },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F2F2F7', borderRadius: 14, padding: 14,
  },
  toggleInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  toggleLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#000' },
  toggleSub: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93' },

  submitBtn: {
    backgroundColor: '#0A84FF', borderRadius: 14, paddingVertical: 16,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8,
  },
  submitText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FFF' },

  disclaimer: {
    fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#8E8E93',
    textAlign: 'center', marginTop: 12, lineHeight: 18,
  },
});
