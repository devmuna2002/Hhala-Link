import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
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
import { isTransientError } from '../utils/network';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
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

// Staggered entrance wrapper: fades + rises its children with a delay.
// Remount (via key) replays the animation — used for mode switches.
function RiseIn({ delay = 0, style, children }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(26)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.spring(translate, { toValue: 0, friction: 9, tension: 55, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(t);
  }, []);
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: translate }] }]}>
      {children}
    </Animated.View>
  );
}

// Frosted brand backdrop: soft color blobs + a giant hlala watermark,
// blurred by the BlurView on top so forms sit on frosted glass.
function AuthBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={authBgStyles.blobA} />
      <View style={authBgStyles.blobB} />
      <Image source={require('../assets/hlala-icon.png')} style={authBgStyles.watermark} />
      <BlurView intensity={88} tint="light" style={StyleSheet.absoluteFill} />
    </View>
  );
}

const authBgStyles = StyleSheet.create({
  blobA: {
    position: 'absolute',
    top: -110,
    right: -110,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: '#DCE3F2',
  },
  blobB: {
    position: 'absolute',
    bottom: -130,
    left: -120,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: '#E9EDF5',
  },
  watermark: {
    position: 'absolute',
    right: -70,
    bottom: 90,
    width: 300,
    height: 300,
    borderRadius: 60,
    opacity: 0.08,
    transform: [{ rotate: '-12deg' }],
  },
});

export default function AuthScreen({ navigation }) {
  const [mode, setMode] = useState('welcome');
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [countryCode, setCountryCode] = useState(COUNTRIES[0]);
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const [role, setRole] = useState('tenant');
  const [roleModalVisible, setRoleModalVisible] = useState(false);
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleReg, setVehicleReg] = useState('');
  const [vehiclePhotos, setVehiclePhotos] = useState([]);
  const [cityQuery, setCityQuery] = useState('');
  const [moverCity, setMoverCity] = useState('');
  const [detectingCity, setDetectingCity] = useState(false);
  const [signupStep, setSignupStep] = useState(1); // 1 = Personal Details, 2 = Account Access

  // Animations (entrance only)
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  // Gentle floating loop for the welcome logo tile
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -9, duration: 1700, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    setSignupStep(1);
    fadeAnim.setValue(0);
    slideAnim.setValue(30);

    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: true })
    ]).start();
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
        if (isTransientError(error)) {
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

    try {
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
    } catch (e) {
      console.log('pickVehiclePhotos error:', e?.message || e);
      Alert.alert('Photo Error', 'Could not open the photo library. Please try again.');
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
            ...(role === 'mover' && moverCity.trim() ? { city: moverCity.trim() } : {}),
            ...(vehicleDetails ? { vehicle_details: vehicleDetails } : {}),
          } 
        },
      });
      if (error) {
        if (isTransientError(error)) {
          Alert.alert('Connection Notice', 'Network request failed. Please check your internet connection and try again.');
        } else {
          Alert.alert('Signup Error', error.message);
        }
      } else if (role === 'agent' || role === 'mover') {
        // Save vehicle photos + city to the profile once we have a session
        if (role === 'mover' && data?.session?.user && (vehiclePhotos.length > 0 || moverCity.trim())) {
          const updates = {};
          if (vehiclePhotos.length > 0) {
            updates.vehicle_photos = vehiclePhotos.map(p => (p.base64 ? `data:image/jpeg;base64,${p.base64}` : p.uri)).filter(Boolean);
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

  if (mode === 'welcome') {
    return (
      <View style={styles.welcomeContainer}>
        <AuthBackdrop />
        <Animated.View style={[
          styles.welcomeContent,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
        ]}>
          <RiseIn delay={0}>
            <Animated.View style={{ transform: [{ translateY: floatAnim }] }}>
              <View style={styles.logoTile}>
                <Image
                  source={require('../assets/hlala-icon.png')}
                  style={styles.logoImg}
                  resizeMode="cover"
                />
              </View>
            </Animated.View>
          </RiseIn>

          <RiseIn delay={110}>
            <Text style={styles.welcomeTitle}>Hlala Link</Text>
          </RiseIn>
          <RiseIn delay={190}>
            <Text style={styles.welcomeSubtitle}>
              Find your dream home on the go.{'\n'}Scroll, select, and let's settle in.
            </Text>
          </RiseIn>

          <RiseIn delay={280} style={styles.welcomeBtnWrap}>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.88}
              onPress={() => setMode('login')}
            >
              <Text style={styles.primaryBtnText}>Log in</Text>
            </TouchableOpacity>
          </RiseIn>

          <RiseIn delay={360} style={styles.welcomeBtnWrap}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              activeOpacity={0.88}
              onPress={() => setMode('signup')}
            >
              <Text style={styles.secondaryBtnText}>Sign up</Text>
            </TouchableOpacity>
          </RiseIn>

          <RiseIn delay={440}>
            <View style={styles.signInRow}>
              <Text style={styles.alreadyText}>Already have an account? </Text>
              <TouchableOpacity onPress={() => setMode('login')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.signInLink}>Sign in</Text>
              </TouchableOpacity>
            </View>
          </RiseIn>
        </Animated.View>
        <Text style={styles.welcomeFooter}>Hlala Link · v1.1.0</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      <AuthBackdrop />
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
                { id: 'tenant', title: 'Tenant / Renter', subtitle: 'Rent properties and homes' },
                { id: 'agent', title: 'Agent / Landlord', subtitle: 'List and manage properties' },
                { id: 'mover', title: 'Mover / Courier', subtitle: 'Offer moving and delivery services' },
              ].map((item) => {
                const isSelected = role === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.roleCard,
                      isSelected && styles.roleCardSelected
                    ]}
                    onPress={() => {
                      setRole(item.id);
                      setRoleModalVisible(false);
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.roleCardTitle}>
                        {item.title}
                      </Text>
                      <Text style={styles.roleCardSub}>
                        {item.subtitle}
                      </Text>
                    </View>

                    {isSelected ? (
                      <View style={styles.roleCheckCircle}>
                        <Ionicons name="checkmark" size={15} color="#FFF" />
                      </View>
                    ) : (
                      <View style={styles.roleRadioCircle} />
                    )}
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
                      <Text style={styles.modalItemText}>{item.name} ({item.code})</Text>
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
            <Ionicons name="chevron-back" size={26} color="#111111" />
          </TouchableOpacity>

          <RiseIn key={'title-' + mode}>
            <Text style={styles.formTitle}>{mode === 'login' ? 'Login' : 'Create Account'}</Text>
          </RiseIn>
          {mode === 'login' && <Text style={styles.formSubtitle}>Enter your details to continue</Text>}

          {mode === 'signup' ? (
          <RiseIn key={mode + '-' + signupStep} delay={110}>
            <>
              {/* Card 1: Personal Details */}
              {signupStep === 1 && (
                <>
                  <View style={styles.formCard}>
                <View style={styles.inputContainer}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={styles.cardSectionTitle}>Personal Details</Text>
                  </View>

                  <Text style={styles.fieldLabel}>Full Name</Text>
                  <View style={styles.inputWrapper}>
                    <TextInput 
                      placeholder="Enter your full name" 
                      placeholderTextColor="#8E8E93" 
                      style={styles.input} 
                      value={name} 
                      onChangeText={setName} 
                    />
                  </View>

                  <Text style={styles.fieldLabel}>Phone Number</Text>
                  <View style={styles.inputWrapper}>
                    <TouchableOpacity 
                      style={styles.countryPicker} 
                      onPress={() => setCountryModalVisible(true)}
                    >
                      <Text style={styles.countryText}>{countryCode.code}</Text>
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

                  <Text style={styles.fieldLabel}>Account Type</Text>
                  <TouchableOpacity 
                    style={styles.inputWrapper} 
                    onPress={() => setRoleModalVisible(true)}
                  >
                    <Text style={styles.roleSelectorText}>
                      I am a: <Text style={{ fontWeight: '600', color: '#111111' }}>
                        {role === 'tenant' ? 'Tenant' : role === 'agent' ? 'Agent / Landlord' : 'Mover'}
                      </Text>
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="#8E8E93" />
                  </TouchableOpacity>

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
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : null}
                        <Text style={styles.detectCityText}>
                          {detectingCity ? 'Detecting your location...' : 'Use My Current Location'}
                        </Text>
                      </TouchableOpacity>

                      <View style={styles.inputWrapper}>
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
                              <Text style={styles.cityResultText}>{c}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      )}

                      {moverCity ? (
                        <View style={styles.citySelectedChip}>
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
                        <TextInput 
                          placeholder="Vehicle Model (e.g. Toyota Dyna)" 
                          placeholderTextColor="#8E8E93" 
                          style={styles.input} 
                          value={vehicleModel} 
                          onChangeText={setVehicleModel} 
                        />
                      </View>

                      <View style={styles.inputWrapper}>
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
                            <Text style={styles.photoAddText}>Add</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={styles.photoHint}>Add at least 4 clear photos of your vehicle. First photo is your cover.</Text>
                    </>
                  )}
                </View>
              </View>

                  {/* Next Step Button */}
                  <TouchableOpacity
                    style={[styles.formPrimaryBtn, { marginTop: 14 }]}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (!name.trim()) {
                        Alert.alert('Missing Info', 'Please enter your full name.');
                        return;
                      }
                      setSignupStep(2);
                    }}
                  >
                    <Text style={styles.formPrimaryBtnText}>Next</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setMode('login')} style={{ marginTop: 14 }}>
                    <Text style={styles.switchText}>
                      Joined already? <Text style={styles.switchTextBold}>Login Now</Text>
                    </Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Card 2: Account Access */}
              {signupStep === 2 && (
                <>
                  <TouchableOpacity 
                    onPress={() => setSignupStep(1)} 
                    style={styles.backToStepBtn}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.backToStepText}>Back to Personal Details</Text>
                  </TouchableOpacity>

                  <View style={styles.formCard}>
                    <View style={styles.inputContainer}>
                      <View style={styles.cardHeaderRow}>
                        <Text style={styles.cardSectionTitle}>Account Access</Text>
                      </View>

                      <Text style={styles.fieldLabel}>Email Address</Text>
                      <View style={styles.inputWrapper}>
                        <TextInput 
                          placeholder="Enter your email address" 
                          placeholderTextColor="#8E8E93"
                          style={styles.input} 
                          autoCapitalize="none" 
                          value={email} 
                          onChangeText={setEmail} 
                        />
                      </View>

                      <Text style={styles.fieldLabel}>Password</Text>
                      <View style={styles.inputWrapper}>
                        <TextInput 
                          placeholder="Create a password"
                          placeholderTextColor="#8E8E93"
                          style={styles.input} 
                          secureTextEntry={!showPwd} 
                          value={pwd} 
                          onChangeText={setPwd} 
                        />
                        <TouchableOpacity onPress={() => setShowPwd(s => !s)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                          <Ionicons name={showPwd ? "eye-off" : "eye"} size={20} color="#8E8E93" />
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity 
                        style={[styles.formPrimaryBtn, loading && { opacity: 0.7 }]} 
                        onPress={handleSignup}
                        activeOpacity={0.85}
                        disabled={loading}
                      >
                        {loading ? (
                          <ActivityIndicator color="#FFF" />
                        ) : (
                          <Text style={styles.formPrimaryBtnText}>Create Account</Text>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity onPress={() => setMode('login')}>
                        <Text style={styles.switchText}>
                          Joined already? <Text style={styles.switchTextBold}>Login Now</Text>
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              )}
            </>
          </RiseIn>
          ) : (
            /* Login Mode: Single Card */
            <View style={styles.formCard}>
              <View style={styles.inputContainer}>
                <Text style={styles.fieldLabel}>Email Address</Text>
                <View style={styles.inputWrapper}>
                  <TextInput 
                    placeholder="Enter your email address" 
                    placeholderTextColor="#8E8E93"
                    style={styles.input} 
                    autoCapitalize="none" 
                    value={email} 
                    onChangeText={setEmail} 
                  />
                </View>

                <Text style={styles.fieldLabel}>Password</Text>
                <View style={styles.inputWrapper}>
                  <TextInput 
                    placeholder="Enter your password"
                    placeholderTextColor="#8E8E93"
                    style={styles.input} 
                    secureTextEntry={!showPwd} 
                    value={pwd} 
                    onChangeText={setPwd} 
                  />
                  <TouchableOpacity onPress={() => setShowPwd(s => !s)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name={showPwd ? "eye-off" : "eye"} size={20} color="#8E8E93" />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity 
                  style={[styles.formPrimaryBtn, loading && { opacity: 0.7 }]} 
                  onPress={handleLogin}
                  activeOpacity={0.85}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.formPrimaryBtnText}>Sign In</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setMode('signup')}>
                  <Text style={styles.switchText}>
                    New here? <Text style={styles.switchTextBold}>Create an Account</Text>
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Threads welcome — plain white, centered logo tile, black buttons
  welcomeContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
  },
  welcomeContent: {
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  logoTile: {
    width: 104,
    height: 104,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECECF1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
    overflow: 'hidden',
  },
  logoImg: {
    width: 104,
    height: 104,
  },
  welcomeBtnWrap: {
    width: '100%',
  },
  welcomeTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#111111',
    letterSpacing: -0.8,
    marginBottom: 8,
  },
  welcomeSubtitle: {
    fontSize: 15,
    fontWeight: '400',
    color: '#8A8A8A',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 36,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: '#111111',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryBtn: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9D9D9',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  secondaryBtnText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '600',
  },
  signInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alreadyText: {
    color: '#8A8A8A',
    fontSize: 14,
    fontWeight: '400',
  },
  signInLink: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '600',
  },
  welcomeFooter: {
    position: 'absolute',
    bottom: 32,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '400',
    color: '#B5B5B5',
  },

  // Form Styles — Threads: white screen, borderless gray inputs, black buttons
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F0F0F0', justifyContent: 'center', alignItems: 'center', marginBottom: 28 },
  formTitle: { fontSize: 30, fontWeight: '800', color: '#111111', marginBottom: 8, letterSpacing: -0.8 },
  formSubtitle: { fontSize: 15, fontWeight: '400', color: '#8A8A8A', marginBottom: 26 },
  formCard: {
    backgroundColor: 'transparent',
    paddingBottom: 8,
  },
  inputContainer: { width: '100%' },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardSectionTitle: {
    fontWeight: '600',
    fontSize: 15,
    letterSpacing: 0,
    color: '#111111',
  },
  fieldLabel: {
    fontWeight: '600',
    fontSize: 13,
    color: '#111111',
    marginBottom: 8,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F0F0',
    borderRadius: 28,
    paddingHorizontal: 18,
    height: 56,
    marginBottom: 16,
  },
  input: { flex: 1, fontWeight: '400', fontSize: 16, color: '#111111' },
  roleSelectorText: { flex: 1, fontWeight: '400', fontSize: 15, color: '#111111' },
  roleItemContent: { flexDirection: 'row', alignItems: 'center' },
  roleItemTitle: { fontSize: 16, fontWeight: '600', color: '#111111' },
  roleItemSub: { fontSize: 13, fontWeight: '400', color: '#8A8A8A' },

  countryPicker: { flexDirection: 'row', alignItems: 'center', paddingRight: 10 },
  countryText: { fontSize: 15, fontWeight: '600', color: '#111111', marginRight: 5 },
  divider: { width: 1, height: 24, backgroundColor: '#D9D9D9', marginRight: 12 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBackdropClose: { ...StyleSheet.absoluteFillObject },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 25,
    maxHeight: '60%',
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#111111', marginBottom: 12, textAlign: 'center' },
  modalItem: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#EFEFEF' },
  modalItemText: { fontSize: 16, fontWeight: '400', color: '#111111' },
  modalClose: { marginTop: 16, alignItems: 'center' },
  modalCloseText: { color: '#111111', fontWeight: '600', fontSize: 15 },

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
    fontWeight: '600',
    fontSize: 18,
    color: '#111111',
    textAlign: 'center',
    marginBottom: 18,
  },
  roleCardsContainer: {
    gap: 10,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  roleCardSelected: {
    borderColor: '#111111',
    backgroundColor: '#F0F0F0',
  },
  roleCardTitle: {
    fontWeight: '600',
    fontSize: 15,
    color: '#111111',
  },
  roleCardSub: {
    fontWeight: '400',
    fontSize: 12.5,
    color: '#8A8A8A',
    marginTop: 4,
  },
  roleCheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#111111',
    borderColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
    borderWidth: 2,
  },
  roleRadioCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#C7C7CC',
    marginLeft: 10,
  },

  formPrimaryBtn: {
    height: 56,
    borderRadius: 28,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 25,
  },
  formPrimaryBtnText: { color: '#FFF', fontSize: 17, fontWeight: '600' },
  switchText: { textAlign: 'center', color: '#8A8A8A', fontWeight: '400', fontSize: 15 },
  switchTextBold: { color: '#111111', fontWeight: '600' },
  approvalNotice: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EAF3FF', borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#C9DCFB' },
  approvalNoticeText: { flex: 1, fontWeight: '400', fontSize: 12, color: '#C97000', lineHeight: 17 },

  // Mover Vehicle Section
  sectionLabel: { fontWeight: '600', fontSize: 15, color: '#111111', marginBottom: 12, marginTop: 4 },
  detectCityBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#111111',
    borderRadius: 28,
    paddingVertical: 15,
    marginBottom: 12,
  },
  detectCityText: { fontWeight: '600', fontSize: 14, color: '#FFFFFF' },
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
  cityResultText: { fontWeight: '500', fontSize: 14, color: '#111111' },
  citySelectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#111111',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 14,
  },
  citySelectedText: { fontWeight: '600', fontSize: 13, color: '#FFFFFF' },
  vehicleTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  vehicleTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#F0F0F0',
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  vehicleTypeChipActive: { backgroundColor: '#111111', borderColor: '#111111' },
  vehicleTypeText: { fontWeight: '500', fontSize: 13, color: '#111111' },
  vehicleTypeTextActive: { color: '#FFFFFF' },

  photoSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  photoCount: { fontWeight: '600', fontSize: 12, color: '#111111' },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 6,
  },
  photoTile: {
    width: (width - 60 - 8) / 3,
    height: (width - 60 - 8) / 3,
    borderRadius: 12,
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
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 2,
    alignItems: 'center',
  },
  photoCoverText: { fontWeight: '600', fontSize: 9, color: '#FFF' },
  photoAddTile: {
    width: (width - 60 - 8) / 3,
    height: (width - 60 - 8) / 3,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D9D9D9',
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
  },
  photoAddText: { fontWeight: '500', fontSize: 11, color: '#555555' },
  photoHint: { fontWeight: '400', fontSize: 11, color: '#8A8A8A', lineHeight: 15, marginBottom: 14, marginTop: 2 },
  stepIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  stepDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  stepDotActive: {
    backgroundColor: '#111111',
  },
  backToStepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 6,
  },
  backToStepText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '600',
  },
});


