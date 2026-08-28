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
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';

const { width, height } = Dimensions.get('window');

const VEHICLE_TYPES = ['Truck', 'Bakkie', 'Van', 'Trailer', 'Crane Truck', 'Panel Van'];

const ZIM_CITIES = [
  'Harare', 'Bulawayo', 'Chitungwiza', 'Mutare', 'Gweru', 'Masvingo', 'Kwekwe',
  'Kadoma', 'Chinhoyi', 'Marondera', 'Bindura', 'Rusape', 'Beitbridge',
  'Victoria Falls', 'Hwange', 'Zvishavane', 'Kariba', 'Karoi', 'Norton', 'Chegutu',
];

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
  const [businessName, setBusinessName] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleReg, setVehicleReg] = useState('');
  const [vehiclePhotos, setVehiclePhotos] = useState([]);
  const [cityQuery, setCityQuery] = useState('');
  const [moverCity, setMoverCity] = useState('');
  const [detectingCity, setDetectingCity] = useState(false);

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
    const cleanEmail = email.trim().toLowerCase();
    const cleanPwd = pwd;

    if (!cleanEmail || !cleanPwd) {
      Alert.alert('Missing Details', 'Please enter both your email address and password.');
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({ 
        email: cleanEmail, 
        password: cleanPwd 
      });

      if (error) {
        if (error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('failed to fetch')) {
          Alert.alert('Connection Notice', 'Network request failed. Please check your internet connection and try again.');
        } else {
          Alert.alert('Login Error', error.message);
        }
      }
    } catch (err) {
      console.log('Login error:', err);
      Alert.alert('Connection Notice', 'Network request failed. Please check your internet connection.');
    } finally {
      setLoading(false);
    }
  };

  const pickVehiclePhotos = async () => {
    const remaining = 8 - vehiclePhotos.length;
    if (remaining <= 0) return;

    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.4,
      base64: true,
    });

    if (!result.canceled && result.assets?.length > 0) {
      const newPhotos = result.assets.map(a => ({ uri: a.uri, base64: a.base64 }));
      setVehiclePhotos(prev => [...prev, ...newPhotos].slice(0, 8));
    }
  };

  const removeVehiclePhoto = (index) => {
    setVehiclePhotos(prev => prev.filter((_, i) => i !== index));
  };

  const detectCity = async () => {
    try {
      setDetectingCity(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Please allow location access or type your city manually.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const places = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (places?.length) {
        const detected = places[0].city || places[0].region || '';
        if (detected) {
          const match = ZIM_CITIES.find(c => c.toLowerCase() === detected.toLowerCase());
          const finalCity = match || detected;
          setMoverCity(finalCity);
          setCityQuery(finalCity);
        } else {
          Alert.alert('Location Found', 'We could not determine your city name. Please type it manually.');
        }
      } else {
        Alert.alert('Location Found', 'We could not determine your city name. Please type it manually.');
      }
    } catch (e) {
      console.log('detectCity error', e);
      Alert.alert('Detection Failed', 'Could not detect your location. Please type your city manually.');
    } finally {
      setDetectingCity(false);
    }
  };

  const handleSignup = async () => {
    const cleanEmail = email.trim().toLowerCase();
    const cleanPwd = pwd;
    const cleanName = name.trim();

    if (!cleanName || !cleanEmail || !cleanPwd) {
      Alert.alert('Missing Info', 'Please fill in your full name, email and password.');
      return;
    }
    if ((role === 'agent' || role === 'mover') && !businessName.trim()) {
      Alert.alert('Business Name Required', `Please enter your ${role === 'agent' ? 'agency' : 'moving company'} name.`);
      return;
    }
    if (role === 'mover') {
      if (!vehicleType) {
        Alert.alert('Vehicle Required', 'Please select your vehicle type.');
        return;
      }
      if (!vehicleModel.trim() || !vehicleReg.trim()) {
        Alert.alert('Vehicle Details Required', 'Please enter your vehicle model and registration number.');
        return;
      }
      if (vehiclePhotos.length < 4) {
        Alert.alert('Vehicle Photos Required', `Please add at least 4 photos of your vehicle. You have added ${vehiclePhotos.length}.`);
        return;
      }
      if (!moverCity.trim()) {
        Alert.alert('City Required', 'Please set your operating city so customers can find movers near them.');
        return;
      }
    }
    try {
      setLoading(true);
      const fullPhone = `${countryCode.code}${phone.trim()}`;
      const vehicleDetails = role === 'mover'
        ? { type: vehicleType, model: vehicleModel.trim(), registration: vehicleReg.trim().toUpperCase() }
        : null;

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password: cleanPwd,
        options: { 
          data: { 
            first_name: cleanName.split(' ')[0] || '', 
            last_name: cleanName.split(' ').slice(1).join(' ') || '', 
            phone_number: fullPhone,
            role: role,
            business_name: businessName.trim(),
            ...(role === 'mover' && moverCity.trim() ? { city: moverCity.trim() } : {}),
            ...(vehicleDetails ? { vehicle_details: vehicleDetails } : {}),
          } 
        },
      });
      if (error) {
        if (error.message?.toLowerCase().includes('network') || error.message?.toLowerCase().includes('failed to fetch')) {
          Alert.alert('Connection Notice', 'Network request failed. Please check your internet connection and try again.');
        } else {
          Alert.alert('Signup Error', error.message);
        }
      } else if (role === 'agent' || role === 'mover') {
        // Save vehicle photos + city to the profile once we have a session
        if (role === 'mover' && data?.session?.user && (vehiclePhotos.length > 0 || moverCity.trim())) {
          const updates = {};
          if (vehiclePhotos.length > 0) {
            updates.vehicle_photos = vehiclePhotos.map(p => `data:image/jpeg;base64,${p.base64}`);
          }
          if (moverCity.trim()) updates.city = moverCity.trim();
          const { error: updErr } = await supabase
            .from('profiles')
            .update(updates)
            .eq('id', data.session.user.id);
          if (updErr) console.log('Mover profile save error:', updErr.message);
        }
        setMode('login');
      } else {
        setMode('login');
      }
    } catch (err) {
      console.log('Signup error:', err);
      Alert.alert('Connection Notice', 'Network request failed. Please check your internet connection.');
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
        <ImageBackground 
          source={{ uri: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=1470&auto=format&fit=crop' }} 
          style={styles.bgImage}
          blurRadius={2}
        >
          <LinearGradient colors={['rgba(10,132,255,0.1)', 'rgba(2,16,40,0.6)']} style={StyleSheet.absoluteFill} />
          
          <Animated.View style={[
            styles.logoCircleContainer, 
            { opacity: fadeAnim, transform: [{ translateY: logoFloat }] }
          ]}>
            <View style={styles.logoCircle}>
              <Image source={require('../assets/logo_new.png')} style={styles.authLogo} />
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
        </ImageBackground>
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
      
      {/* Modern Role Selection Bottom Sheet Modal */}
      <Modal visible={roleModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={styles.modalBackdropClose} 
            activeOpacity={1} 
            onPress={() => setRoleModalVisible(false)} 
          />
          <View style={styles.roleModalSheet}>
            <View style={styles.modalDragHandle} />
            
            <Text style={styles.roleModalHeaderTitle}>Select Account Type</Text>

            <View style={styles.roleCardsContainer}>
              {[
                { id: 'tenant', title: 'Tenant / Seeker', icon: 'home', color: '#0A84FF', bg: '#EBF4FF' },
                { id: 'agent', title: 'Agent / Landlord', icon: 'business', color: '#0A84FF', bg: '#EAF3FF' },
                { id: 'mover', title: 'Mover / Freight', icon: 'cube', color: '#34C759', bg: '#EAF8EE' },
              ].map((item) => {
                const isSelected = role === item.id;
                return (
                  <TouchableOpacity 
                    key={item.id} 
                    style={[
                      styles.roleCard,
                      isSelected && [styles.roleCardSelected, { borderColor: item.color, backgroundColor: item.bg + '40' }]
                    ]} 
                    onPress={() => { 
                      setRole(item.id); 
                      setRoleModalVisible(false); 
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={[styles.roleIconCircle, { backgroundColor: item.bg }]}>
                      <Ionicons name={item.icon} size={24} color={item.color} />
                    </View>

                    <Text style={[styles.roleCardTitle, isSelected && { color: item.color }]}>
                      {item.title}
                    </Text>

                    <View style={[styles.roleRadioCircle, isSelected && { borderColor: item.color, backgroundColor: item.color }]}>
                      {isSelected && <Ionicons name="checkmark" size={14} color="#FFF" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
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
                    I am a: <Text style={{ fontFamily: 'Poppins_600SemiBold', color: '#0A84FF' }}>
                      {role === 'tenant' ? 'Tenant' : role === 'agent' ? 'Agent / Landlord' : 'Mover'}
                    </Text>
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color="#8E8E93" />
                </TouchableOpacity>

                {(role === 'agent' || role === 'mover') && (
                  <View style={styles.inputWrapper}>
                    <Ionicons 
                      name={role === 'agent' ? 'business-outline' : 'cube-outline'} 
                      size={20} color="#8E8E93" style={styles.inputIcon} 
                    />
                    <TextInput 
                      placeholder={role === 'agent' ? 'Agency / Company Name' : 'Moving Company Name'}
                      placeholderTextColor="#8E8E93" 
                      style={styles.input} 
                      value={businessName} 
                      onChangeText={setBusinessName} 
                    />
                  </View>
                )}

                {role === 'mover' && (
                  <>
                    <Text style={styles.sectionLabel}>Operating City</Text>

                    <TouchableOpacity
                      style={styles.detectCityBtn}
                      onPress={detectCity}
                      disabled={detectingCity}
                      activeOpacity={0.7}
                    >
                      {detectingCity ? (
                        <ActivityIndicator size="small" color="#0A84FF" />
                      ) : (
                        <Ionicons name="location" size={18} color="#0A84FF" />
                      )}
                      <Text style={styles.detectCityText}>
                        {detectingCity ? 'Detecting your location...' : 'Use My Current Location'}
                      </Text>
                    </TouchableOpacity>

                    <View style={styles.inputWrapper}>
                      <Ionicons name="search-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                      <TextInput
                        placeholder="Or search your city..."
                        placeholderTextColor="#8E8E93"
                        style={styles.input}
                        value={cityQuery}
                        onChangeText={(val) => {
                          setCityQuery(val);
                          setMoverCity('');
                        }}
                      />
                      {cityQuery.length > 0 && (
                        <TouchableOpacity onPress={() => { setCityQuery(''); setMoverCity(''); }}>
                          <Ionicons name="close-circle" size={18} color="#8E8E93" />
                        </TouchableOpacity>
                      )}
                    </View>

                    {!moverCity && cityQuery.trim().length > 0 && (
                      <View style={styles.cityResults}>
                        {ZIM_CITIES.filter(c => c.toLowerCase().includes(cityQuery.trim().toLowerCase())).map(c => (
                          <TouchableOpacity
                            key={c}
                            style={styles.cityResultRow}
                            onPress={() => { setMoverCity(c); setCityQuery(c); }}
                          >
                            <Ionicons name="location-outline" size={15} color="#0A84FF" />
                            <Text style={styles.cityResultText}>{c}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {moverCity ? (
                      <View style={styles.citySelectedChip}>
                        <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                        <Text style={styles.citySelectedText}>{moverCity}</Text>
                      </View>
                    ) : null}

                    <Text style={styles.sectionLabel}>Vehicle Details</Text>

                    <View style={styles.vehicleTypeRow}>
                      {VEHICLE_TYPES.map(type => (
                        <TouchableOpacity
                          key={type}
                          style={[styles.vehicleTypeChip, vehicleType === type && styles.vehicleTypeChipActive]}
                          onPress={() => setVehicleType(type)}
                        >
                          <Text style={[styles.vehicleTypeText, vehicleType === type && styles.vehicleTypeTextActive]}>
                            {type}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    <View style={styles.inputWrapper}>
                      <Ionicons name="car-sport-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                      <TextInput 
                        placeholder="Vehicle Model (e.g. Toyota Dyna)" 
                        placeholderTextColor="#8E8E93" 
                        style={styles.input} 
                        value={vehicleModel} 
                        onChangeText={setVehicleModel} 
                      />
                    </View>

                    <View style={styles.inputWrapper}>
                      <Ionicons name="id-card-outline" size={20} color="#8E8E93" style={styles.inputIcon} />
                      <TextInput 
                        placeholder="Registration Number (e.g. ABC 1234)" 
                        placeholderTextColor="#8E8E93" 
                        style={styles.input} 
                        autoCapitalize="characters"
                        value={vehicleReg} 
                        onChangeText={setVehicleReg} 
                      />
                    </View>

                    <View style={styles.photoSectionHeader}>
                      <Text style={styles.sectionLabel}>Vehicle Photos</Text>
                      <Text style={[styles.photoCount, vehiclePhotos.length >= 4 && { color: '#34C759' }]}>
                        {vehiclePhotos.length}/4 min
                      </Text>
                    </View>

                    <View style={styles.photoGrid}>
                      {vehiclePhotos.map((photo, index) => (
                        <View key={index} style={styles.photoTile}>
                          <Image source={{ uri: photo.uri }} style={styles.photoTileImage} />
                          <TouchableOpacity 
                            style={styles.photoRemoveBtn}
                            onPress={() => removeVehiclePhoto(index)}
                          >
                            <Ionicons name="close" size={14} color="#FFF" />
                          </TouchableOpacity>
                          {index === 0 && (
                            <View style={styles.photoCoverTag}>
                              <Text style={styles.photoCoverText}>Cover</Text>
                            </View>
                          )}
                        </View>
                      ))}
                      {vehiclePhotos.length < 8 && (
                        <TouchableOpacity style={styles.photoAddTile} onPress={pickVehiclePhotos} activeOpacity={0.7}>
                          <Ionicons name="add" size={28} color="#0A84FF" />
                          <Text style={styles.photoAddText}>Add</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.photoHint}>Add at least 4 clear photos of your vehicle. First photo is your cover.</Text>
                  </>
                )}

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
  bgImage: { width: '100%', height: '100%' },
  logoCircleContainer: { alignItems: 'center', marginTop: height * 0.10 },
  logoCircle: { 
    width: 180, 
    height: 180, 
    borderRadius: 90, 
    backgroundColor: 'transparent', 
    justifyContent: 'center', 
    alignItems: 'center',
    overflow: 'hidden'
  },
  authLogo: { width: '100%', height: '100%' },
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
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBackdropClose: { ...StyleSheet.absoluteFillObject },
  modalContainer: { width: '85%', backgroundColor: '#FFF', borderRadius: 20, padding: 20, maxHeight: '60%', alignSelf: 'center', marginVertical: 'auto' },
  modalTitle: { fontSize: 20, fontFamily: 'Poppins_700Bold', marginBottom: 20, textAlign: 'center' },
  modalItem: { paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  modalItemText: { fontSize: 16, fontFamily: 'Poppins_400Regular' },
  modalClose: { marginTop: 20, alignItems: 'center' },
  modalCloseText: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold' },

  // Role Modal Bottom Sheet Styles
  roleModalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 25,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 20,
  },
  modalDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5EA',
    alignSelf: 'center',
    marginBottom: 16,
  },
  roleModalHeaderTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    color: '#1C1E21',
    textAlign: 'center',
    marginBottom: 18,
  },
  roleCardsContainer: {
    gap: 12,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#E5E5EA',
  },
  roleCardSelected: {
    shadowColor: '#0A84FF',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  roleIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  roleCardTitle: {
    flex: 1,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#1C1E21',
  },
  roleRadioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#C7C7CC',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },

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
  approvalNotice: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EAF3FF', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#C9DCFB' },
  approvalNoticeText: { flex: 1, fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#C97000', lineHeight: 17 },

  // Mover Vehicle Section
  sectionLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#1A1A1A', marginBottom: 12, marginTop: 4 },
  detectCityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F0F5FF',
    borderWidth: 1.5,
    borderColor: '#B7D6FF',
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 12,
  },
  detectCityText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13.5, color: '#0A84FF' },
  cityResults: {
    backgroundColor: '#FFF',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5EA',
    marginBottom: 10,
    overflow: 'hidden',
  },
  cityResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F2F2F7',
  },
  cityResultText: { fontFamily: 'Poppins_500Medium', fontSize: 13.5, color: '#1A1A1A' },
  citySelectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#EAFBF1',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 14,
  },
  citySelectedText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#1E9E52' },
  vehicleTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  vehicleTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#F8F9FE',
    borderWidth: 1.5,
    borderColor: '#EFEFEF',
  },
  vehicleTypeChipActive: { backgroundColor: '#0A84FF', borderColor: '#0A84FF' },
  vehicleTypeText: { fontFamily: 'Poppins_500Medium', fontSize: 13, color: '#3C3C43' },
  vehicleTypeTextActive: { color: '#FFFFFF' },

  photoSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  photoCount: { fontFamily: 'Poppins_600SemiBold', fontSize: 12, color: '#0A84FF' },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 6,
  },
  photoTile: {
    width: (width - 60 - 8) / 3,
    height: (width - 60 - 8) / 3,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#E5E5EA',
  },
  photoTileImage: { width: '100%', height: '100%' },
  photoRemoveBtn: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoCoverTag: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(10,132,255,0.85)',
    paddingVertical: 2,
    alignItems: 'center',
  },
  photoCoverText: { fontFamily: 'Poppins_600SemiBold', fontSize: 9, color: '#FFF' },
  photoAddTile: {
    width: (width - 60 - 8) / 3,
    height: (width - 60 - 8) / 3,
    borderRadius: 4,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#B9D4F5',
    backgroundColor: '#F0F7FF',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  photoAddText: { fontFamily: 'Poppins_500Medium', fontSize: 11, color: '#0A84FF' },
  photoHint: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#8E8E93', lineHeight: 15, marginBottom: 14, marginTop: 2 },
});


