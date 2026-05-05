import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  Dimensions,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../supabase';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

const COUNTRIES = [
  { name: 'Zimbabwe', code: '+263', flag: '🇿🇼' },
  { name: 'South Africa', code: '+27', flag: '🇿🇦' },
  { name: 'United Kingdom', code: '+44', flag: '🇬🇧' },
  { name: 'United States', code: '+1', flag: '🇺🇸' },
  { name: 'Botswana', code: '+267', flag: '🇧🇼' },
  { name: 'Namibia', code: '+264', flag: '🇳🇦' },
  { name: 'Zambia', code: '+260', flag: '🇿🇲' },
  { name: 'Nigeria', code: '+234', flag: '🇳🇬' },
  { name: 'Kenya', code: '+254', flag: '🇰🇪' },
];

export default function AuthScreen({ navigation }) {
  const [mode, setMode] = useState('welcome');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState(COUNTRIES[0]);
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const [role, setRole] = useState('tenant');
  const [roleModalVisible, setRoleModalVisible] = useState(false);

  // Animations
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoFloat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(30);
    
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true })
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(logoFloat, { toValue: -10, duration: 2000, useNativeDriver: true }),
        Animated.timing(logoFloat, { toValue: 0, duration: 2000, useNativeDriver: true })
      ])
    ).start();
  }, [mode]);

  const handleLogin = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: pwd });
      if (error) {
        Alert.alert('Login error', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    try {
      setLoading(true);
      const fullPhone = `${countryCode.code}${phone}`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password: pwd,
        options: { 
          data: { 
            first_name: name.split(' ')[0] || '', 
            last_name: name.split(' ')[1] || '', 
            phone_number: fullPhone,
            role: role 
          } 
        },
      });
      if (error) Alert.alert('Signup error', error.message);
      else {
        Alert.alert('Success', 'Check your email for verification.');
        setMode('login');
      }
    } finally {
      setLoading(false);
    }
  };

  const [titleText, setTitleText] = useState('MY PLACE');

  useEffect(() => {
    if (mode !== 'welcome') return;
    
    let isMounted = true;
    const words = ['MY PLACE', 'MY HOME'];
    let index = 0;
    
    const animateText = async () => {
      while (isMounted) {
        await new Promise(r => setTimeout(r, 2000));
        let current = words[index];
        let prefix = current.split(' ')[0] + ' ';
        let suffix = current.split(' ')[1];
        for (let i = suffix.length; i >= 0; i--) {
          if (!isMounted) return;
          setTitleText(prefix + suffix.slice(0, i));
          await new Promise(r => setTimeout(r, 100));
        }
        index = (index + 1) % words.length;
        let nextSuffix = words[index].split(' ')[1];
        for (let i = 0; i <= nextSuffix.length; i++) {
          if (!isMounted) return;
          setTitleText(prefix + nextSuffix.slice(0, i));
          await new Promise(r => setTimeout(r, 150));
        }
      }
    };
    animateText();
    return () => { isMounted = false; };
  }, [mode]);

  if (mode === 'welcome') {
    return (
      <View style={styles.welcomeContainer}>
        <LinearGradient 
          colors={['#002D5F', '#0A84FF', '#FFFFFF']} 
          locations={[0, 0.6, 1]}
          style={styles.welcomeGradient}
        >
          <Animated.View style={[
            styles.logoCircleContainer, 
            { opacity: fadeAnim, transform: [{ translateY: logoFloat }] }
          ]}>
            <View style={styles.logoCircle}>
              <Ionicons name="link" size={36} color="#0A84FF" />
            </View>
            <Text style={styles.brandName}>HLALA LINK</Text>
            <Text style={styles.brandSub}>Premium Property Marketplace</Text>
          </Animated.View>

          <View style={styles.welcomeCurveOuter}>
            <View style={styles.welcomeCurveInner}>
              <Animated.View style={[
                styles.welcomeContent, 
                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
              ]}>
                <Text style={styles.welcomeTitle}>{titleText}</Text>
                <Text style={styles.welcomeSubtitle}>
                  Your premium gateway to exceptional property discovery and seamless transitions.
                </Text>
                
                <View style={styles.btnGroup}>
                  <TouchableOpacity style={styles.primaryBtn} onPress={() => setMode('login')}>
                    <Text style={styles.primaryBtnText}>Login</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => setMode('signup')}>
                    <Text style={styles.secondaryBtnText}>Sign Up</Text>
                  </TouchableOpacity>
                </View>
              </Animated.View>
            </View>
          </View>
        </LinearGradient>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <LinearGradient colors={['#FFFFFF', '#F8F9FE']} style={StyleSheet.absoluteFill} />
      
      {/* Role Selection Modal */}
      <Modal visible={roleModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { maxHeight: '50%' }]}>
            <Text style={styles.modalTitle}>Choose Your Role</Text>
            {[
              { id: 'tenant', title: 'Tenant', sub: 'I want to find a place to stay' },
              { id: 'agent', title: 'Agent', sub: 'I want to list properties' },
              { id: 'mover', title: 'Mover', sub: 'I offer moving services' }
            ].map((item) => (
              <TouchableOpacity 
                key={item.id} 
                style={[styles.modalItem, role === item.id && { backgroundColor: '#F0F5FF', borderColor: '#0A84FF', borderWidth: 1, borderRadius: 12 }]} 
                onPress={() => { setRole(item.id); setRoleModalVisible(false); }}
              >
                <View style={styles.roleItemContent}>
                  <Ionicons name={item.id === 'tenant' ? 'home' : item.id === 'agent' ? 'business' : 'car'} size={24} color={role === item.id ? '#0A84FF' : '#8E8E93'} style={{ marginRight: 15 }} />
                  <View>
                    <Text style={[styles.roleItemTitle, role === item.id && { color: '#0A84FF' }]}>{item.title}</Text>
                    <Text style={styles.roleItemSub}>{item.sub}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalClose} onPress={() => setRoleModalVisible(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      
      <Modal visible={countryModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Select Country</Text>
            <FlatList
              data={COUNTRIES}
              keyExtractor={item => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={styles.modalItem} 
                  onPress={() => { setCountryCode(item); setCountryModalVisible(false); }}
                >
                  <Text style={styles.modalItemText}>{item.flag} {item.name} ({item.code})</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.modalClose} onPress={() => setCountryModalVisible(false)}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setMode('welcome')}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>

          <Text style={styles.formTitle}>{mode === 'login' ? 'Login' : 'Create Account'}</Text>
          <Text style={styles.formSubtitle}>Enter your details to continue</Text>

          <View style={styles.inputContainer}>
            {mode === 'signup' && (
              <>
                <View style={styles.inputWrapper}>
                  <Ionicons name="person-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                  <TextInput 
                    placeholder="Full Name" 
                    placeholderTextColor="#8E8E93" 
                    style={styles.input} 
                    value={name} 
                    onChangeText={setName} 
                  />
                </View>

                <View style={styles.inputWrapper}>
                  <TouchableOpacity 
                    style={styles.countryPicker} 
                    onPress={() => setCountryModalVisible(true)}
                  >
                    <Text style={styles.countryText}>{countryCode.flag} {countryCode.code}</Text>
                    <Ionicons name="chevron-down" size={12} color="#8E8E93" />
                  </TouchableOpacity>
                  <View style={styles.divider} />
                  <TextInput 
                    placeholder="Phone Number" 
                    placeholderTextColor="#8E8E93"
                    style={styles.input} 
                    keyboardType="phone-pad"
                    value={phone} 
                    onChangeText={setPhone} 
                  />
                </View>
                <TouchableOpacity 
                  style={styles.inputWrapper} 
                  onPress={() => setRoleModalVisible(true)}
                >
                  <Ionicons name="shield-checkmark-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                  <Text style={styles.roleSelectorText}>
                    Role: <Text style={{ fontFamily: 'Poppins_600SemiBold', color: '#0A84FF' }}>{role.charAt(0).toUpperCase() + role.slice(1)}</Text>
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#8E8E93" />
                </TouchableOpacity>
              </>
            )}

            <View style={styles.inputWrapper}>
              <Ionicons name="mail-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
              <TextInput 
                placeholder="Email Address" 
                placeholderTextColor="#8E8E93"
                style={styles.input} 
                autoCapitalize="none" 
                value={email} 
                onChangeText={setEmail} 
              />
            </View>

            <View style={styles.inputWrapper}>
              <Ionicons name="lock-closed-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
              <TextInput 
                placeholder="Password" 
                placeholderTextColor="#8E8E93"
                style={styles.input} 
                secureTextEntry 
                value={pwd} 
                onChangeText={setPwd} 
              />
            </View>

            <TouchableOpacity 
              style={[styles.formPrimaryBtn, loading && { opacity: 0.7 }]} 
              onPress={mode === 'login' ? handleLogin : handleSignup}
              activeOpacity={0.8}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.formPrimaryBtnText}>{mode === 'login' ? 'Sign In' : 'Register'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}>
              <Text style={styles.switchText}>
                {mode === 'login' ? "New here? " : "Joined already? "}
                <Text style={styles.switchTextBold}>{mode === 'login' ? 'Create an Account' : 'Login Now'}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  welcomeContainer: { flex: 1 },
  welcomeGradient: { flex: 1, width: '100%', height: '100%' },
  logoCircleContainer: { alignItems: 'center', marginTop: height * 0.15 },
  logoCircle: { 
    width: 90, 
    height: 90, 
    borderRadius: 45, 
    backgroundColor: '#FFF', 
    justifyContent: 'center', 
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 8
  },
  brandName: { color: '#FFF', fontSize: 38, fontFamily: 'Poppins_900Black', marginTop: 20, letterSpacing: 3 },
  brandSub: { color: '#FFF', fontSize: 14, fontFamily: 'Poppins_400Regular', opacity: 0.85, letterSpacing: 1 },
  
  welcomeCurveOuter: {
    position: 'absolute',
    bottom: 0,
    width: width,
    height: height * 0.45,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  welcomeCurveInner: {
    width: width * 2,
    height: width * 2,
    borderRadius: width,
    backgroundColor: '#FFF',
    position: 'absolute',
    top: 0,
    left: -width * 0.5,
    alignItems: 'center',
    paddingTop: 70,
  },
  welcomeContent: {
    width: width,
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  welcomeTitle: { fontSize: 30, fontFamily: 'Poppins_900Black', color: '#0A84FF', marginBottom: 10, letterSpacing: 0.5 },
  welcomeSubtitle: { 
    fontSize: 14, 
    fontFamily: 'Poppins_400Regular', 
    color: '#666', 
    textAlign: 'center', 
    lineHeight: 22,
    marginBottom: 35,
    paddingHorizontal: 20
  },
  btnGroup: { 
    flexDirection: 'row', 
    width: '100%', 
    paddingHorizontal: 10,
    justifyContent: 'space-between'
  },
  primaryBtn: { 
    flex: 1,
    backgroundColor: '#0A84FF', 
    height: 48, 
    borderRadius: 24, 
    justifyContent: 'center', 
    alignItems: 'center',
    marginRight: 8,
    shadowColor: '#0A84FF',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 4
  },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontFamily: 'Poppins_600SemiBold' },
  secondaryBtn: { 
    flex: 1,
    backgroundColor: '#FFF', 
    height: 48, 
    borderRadius: 24, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#F0F0F0'
  },
  secondaryBtnText: { color: '#1A1A1A', fontSize: 15, fontFamily: 'Poppins_600SemiBold' },

  // Form Styles
  container: { flex: 1, backgroundColor: '#FFF' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 30, paddingTop: 60, paddingBottom: 40 },
  backBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#F8F9FE', justifyContent: 'center', alignItems: 'center', marginBottom: 35 },
  formTitle: { fontSize: 30, fontFamily: 'Poppins_700Bold', color: '#1A1A1A', marginBottom: 8 },
  formSubtitle: { fontSize: 15, fontFamily: 'Poppins_400Regular', color: '#8E8E93', marginBottom: 40 },
  inputContainer: { width: '100%' },
  inputWrapper: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#F8F9FE', 
    borderRadius: 18, 
    paddingHorizontal: 20, 
    height: 60, 
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#F0F0F0'
  },
  inputIcon: { marginRight: 15 },
  input: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 16, color: '#1A1A1A' },
  roleSelectorText: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#1A1A1A' },
  roleItemContent: { flexDirection: 'row', alignItems: 'center' },
  roleItemTitle: { fontSize: 16, fontFamily: 'Poppins_600SemiBold', color: '#1A1A1A' },
  roleItemSub: { fontSize: 13, fontFamily: 'Poppins_400Regular', color: '#8E8E93' },

  countryPicker: { flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
  countryText: { fontSize: 15, fontFamily: 'Poppins_600SemiBold', color: '#1A1A1A', marginRight: 5 },
  divider: { width: 1, height: 24, backgroundColor: '#E5E5E5', marginRight: 15 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalContainer: { width: '85%', backgroundColor: '#FFF', borderRadius: 20, padding: 20, maxHeight: '60%' },
  modalTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', marginBottom: 20, textAlign: 'center' },
  modalItem: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  modalItemText: { fontSize: 16, fontFamily: 'Poppins_400Regular' },
  modalClose: { marginTop: 20, alignItems: 'center' },
  modalCloseText: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' },

  formPrimaryBtn: { 
    backgroundColor: '#0A84FF', 
    height: 60, 
    borderRadius: 30, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 15,
    marginBottom: 25,
    shadowColor: '#0A84FF',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8
  },
  formPrimaryBtnText: { color: '#FFF', fontSize: 18, fontFamily: 'Poppins_700Bold' },
  switchText: { textAlign: 'center', color: '#8E8E93', fontFamily: 'Poppins_400Regular', fontSize: 15 },
  switchTextBold: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' },
});


