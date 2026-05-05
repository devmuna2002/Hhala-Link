import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, Image, ScrollView, Alert, ActivityIndicator, TextInput, Modal, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../supabase';
import { PaynowService } from '../services/PaynowService';

export default function PaymentScreen({ navigation, route }) {
  const [selectedPlan, setSelectedPlan] = useState('month');
  const [paymentMethod, setPaymentMethod] = useState('paynow'); // 'paynow' (Cards), 'ecocash', 'onemoney'
  const [processing, setProcessing] = useState(false);
  const [user, setUser] = useState(null);
  const [phone, setPhone] = useState('');
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('pending');

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, []);

  useEffect(() => {
    if (route.params?.paymentStatus === 'success') {
      const amount = route.params?.amount;
      updateSubscription(amount);
      // Clear the params so it doesn't trigger again on reload
      navigation.setParams({ paymentStatus: undefined, amount: undefined });
    }
  }, [route.params?.paymentStatus]);

  const handlePayment = async () => {
    if (!user) {
      Alert.alert('Error', 'Please log in to continue.');
      return;
    }

    await handleMobilePaynow();
  };



  const handleMobilePaynow = async () => {
    if (!phone || phone.length < 10) {
      Alert.alert('Invalid Phone', 'Please enter a valid mobile number.');
      return;
    }

    setProcessing(true);
    setPaymentStatus('pending');
    setShowStatusModal(true);

    try {
      const reference = `SUB-${user.id.slice(0, 8)}-${Date.now()}`;
      const amount = selectedPlan === 'month' ? 5.00 : 10.00;

      const result = await PaynowService.initiateMobileTransaction({
        amount,
        email: user.email,
        reference,
        phone: phone,
        method: paymentMethod
      });

      if (result.success) {
        setPaymentStatus('awaiting_ussd');
        startPolling(result.pollurl, amount);
      } else {
        setShowStatusModal(false);
        Alert.alert('Payment Error', result.error);
      }
    } catch (error) {
      setShowStatusModal(false);
      Alert.alert('Error', 'Could not initiate mobile payment.');
    } finally {
      setProcessing(false);
    }
  };

  const startPolling = async (pollUrl, amount) => {
    let attempts = 0;
    const maxAttempts = 20; // 2 minutes polling

    const interval = setInterval(async () => {
      attempts++;
      const result = await PaynowService.pollStatus(pollUrl);
      
      if (result && result.status.toLowerCase() === 'paid') {
        clearInterval(interval);
        setPaymentStatus('success');
        setTimeout(() => {
          setShowStatusModal(false);
          updateSubscription(amount);
        }, 2000);
      } else if (attempts >= maxAttempts || (result && result.status.toLowerCase() === 'cancelled')) {
        clearInterval(interval);
        setPaymentStatus('failed');
        setTimeout(() => setShowStatusModal(false), 3000);
      }
    }, 6000); // Poll every 6 seconds
  };

  const updateSubscription = async (amount) => {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 Days exactly

      const { data, error } = await supabase.from('subscriptions').insert({
        user_id: user.id,
        plan: amount === 5 ? 'basic' : 'pro',
        status: 'active',
        price_usd: amount,
        starts_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        max_listings: 999 // Unlimited uploads for 30 days
      }).select();

      console.log("DEBUG: Subscription insert result:", { data, error });

      if (error) throw error;
      
      Alert.alert('Success', 'Subscription activated successfully!');
      navigation.goBack();
    } catch (error) {
      console.error('Subscription update error:', error);
      Alert.alert('Update Error', 'Payment was successful but we couldn\'t update your profile.');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="close" size={28} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Agent Subscription</Text>
          <Text style={styles.subtitle}>Pay $5/month to unlock property uploads and manage your listings natively within the app.</Text>
        </View>

        <View style={styles.plansContainer}>
          <TouchableOpacity 
            style={[styles.planCard, selectedPlan === 'month' && styles.planCardActive]}
            onPress={() => setSelectedPlan('month')}
          >
            <View style={styles.bestValueBadge}><Text style={styles.bestValueText}>POPULAR</Text></View>
            <View style={styles.planHeader}>
              <Text style={[styles.planName, selectedPlan === 'month' && styles.textActive]}>Standard Agent</Text>
              {selectedPlan === 'month' && <Ionicons name="checkmark-circle" size={24} color="#0A84FF" />}
            </View>
            <Text style={[styles.planPrice, selectedPlan === 'month' && styles.textActive]}>$5<Text style={styles.planPeriod}> / 30 Days</Text></Text>
            <Text style={styles.planDesc}>Freely upload unlimited property listings for 30 days. Perfect for active agents.</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Select Payment Method</Text>
        <View style={styles.methodsGrid}>
          <TouchableOpacity 
            style={[styles.methodCardLarge, styles.methodCardActive]}
          >
            <Image 
              source={{ uri: 'https://paynow-admin-prod.s3.amazonaws.com/payment_methods/ecocash.png' }} 
              style={styles.methodIconLarge} 
            />
            <Text style={[styles.methodTextLarge, styles.textActive]}>Pay with EcoCash</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.phoneInputContainer}>
          <Text style={styles.inputLabel}>EcoCash Number</Text>
          <TextInput
            style={styles.phoneInput}
            placeholder="0777123456"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            maxLength={10}
          />
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={18} color="#0A84FF" />
            <Text style={styles.infoText}>You will receive a prompt on your phone to enter your PIN and authorize the payment.</Text>
          </View>
        </View>

      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.payBtn} onPress={handlePayment} disabled={processing}>
          {processing ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.payBtnText}>Complete Payment ($5)</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Payment Status Modal */}
      <Modal visible={showStatusModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {paymentStatus === 'pending' && <ActivityIndicator size="large" color="#0A84FF" />}
            {paymentStatus === 'awaiting_ussd' && (
              <>
                <View style={styles.statusIconContainer}>
                  <Ionicons name="phone-portrait" size={40} color="#0A84FF" />
                </View>
                <Text style={styles.statusTitle}>Check your Phone</Text>
                <Text style={styles.statusSubtitle}>Please enter your PIN on your phone to complete the $5 payment.</Text>
                <ActivityIndicator size="small" color="#0A84FF" style={{ marginTop: 20 }} />
              </>
            )}
            {paymentStatus === 'success' && (
              <>
                <Ionicons name="checkmark-circle" size={60} color="#34C759" />
                <Text style={styles.statusTitle}>Payment Successful!</Text>
                <Text style={styles.statusSubtitle}>Your subscription is now active.</Text>
              </>
            )}
            {paymentStatus === 'failed' && (
              <>
                <Ionicons name="close-circle" size={60} color="#FF3B30" />
                <Text style={styles.statusTitle}>Payment Failed</Text>
                <Text style={styles.statusSubtitle}>Timed out or cancelled. Please try again.</Text>
                <TouchableOpacity style={styles.closeBtn} onPress={() => setShowStatusModal(false)}>
                  <Text style={styles.closeBtnText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FE' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 40, 
    paddingHorizontal: 20, 
    paddingBottom: 10 
  },
  headerTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: '#000' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  
  scroll: { padding: 24, paddingBottom: 120 },
  
  titleContainer: { marginBottom: 30 },
  title: { fontFamily: 'Poppins_700Bold', fontSize: 28, color: '#1A1A1A', marginBottom: 10 },
  subtitle: { fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#8E8E93', lineHeight: 22 },
  
  plansContainer: { marginBottom: 30 },
  planCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 24, marginBottom: 16, borderWidth: 2, borderColor: '#F0F0F0', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  planCardActive: { borderColor: '#0A84FF', backgroundColor: '#F0F7FF' },
  bestValueBadge: { position: 'absolute', top: -12, right: 20, backgroundColor: '#FF9500', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  bestValueText: { fontFamily: 'Poppins_700Bold', fontSize: 10, color: '#FFF' },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  planName: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#8E8E93' },
  planPrice: { fontFamily: 'Poppins_700Bold', fontSize: 32, color: '#8E8E93', marginBottom: 8 },
  planPeriod: { fontSize: 16, fontFamily: 'Poppins_500Medium' },
  planDesc: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', lineHeight: 20 },
  textActive: { color: '#0A84FF' },
  
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#1A1A1A', marginBottom: 15 },
  
  methodsGrid: { marginBottom: 30 },
  methodCardLarge: { width: '100%', backgroundColor: '#FFF', borderRadius: 16, padding: 18, flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: '#F0F0F0' },
  methodIconLarge: { width: 60, height: 36, resizeMode: 'contain', marginRight: 15 },
  methodTextLarge: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#8E8E93' },
  methodCardActive: { borderColor: '#0A84FF', backgroundColor: '#F0F7FF' },

  phoneInputContainer: { marginBottom: 20 },
  inputLabel: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#1A1A1A', marginBottom: 8 },
  phoneInput: { backgroundColor: '#FFF', borderRadius: 12, height: 56, paddingHorizontal: 16, fontSize: 18, fontFamily: 'Poppins_600SemiBold', color: '#000', borderWidth: 1, borderColor: '#DDD' },
  
  infoBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E1F0FF', borderRadius: 12, padding: 12, marginTop: 15 },
  infoText: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#0A84FF', marginLeft: 8 },

  footer: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: '#FFF', paddingHorizontal: 24, paddingVertical: 20, borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingBottom: Platform.OS === 'ios' ? 40 : 20 },
  payBtn: { backgroundColor: '#0A84FF', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#0A84FF', shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  payBtnText: { color: '#FFF', fontFamily: 'Poppins_600SemiBold', fontSize: 18 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: '#FFF', width: '100%', borderRadius: 24, padding: 30, alignItems: 'center' },
  statusIconContainer: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#F0F7FF', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  statusTitle: { fontFamily: 'Poppins_700Bold', fontSize: 22, color: '#1A1A1A', marginTop: 15 },
  statusSubtitle: { fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#8E8E93', textAlign: 'center', marginTop: 10, lineHeight: 22 },
  closeBtn: { marginTop: 30, paddingHorizontal: 30, paddingVertical: 12, borderRadius: 12, backgroundColor: '#F5F5F5' },
  closeBtnText: { fontFamily: 'Poppins_600SemiBold', color: '#1A1A1A' }
});
