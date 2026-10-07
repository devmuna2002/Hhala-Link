import React, { useState, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../utils/theme';

export default function PaynowWebViewScreen({ route, navigation }) {
  const { t } = useTheme();
  const styles = useMemo(() => buildStyles(t), [t]);
  const { checkoutUrl, pollUrl, onSuccess } = route.params;
  const [loading, setLoading] = useState(true);

  const handleNavigationStateChange = (newNavState) => {
    // If the return URL is hit, we can potentially close the webview and check status
    if (newNavState.url.includes('payment-success')) {
      navigation.navigate('Payment', { 
        paymentStatus: 'success', 
        amount: route.params?.amount 
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="close" size={28} color={t.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Complete Payment</Text>
        <View style={{ width: 40 }} />
      </View>
      
      <WebView 
        source={{ uri: checkoutUrl }}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={handleNavigationStateChange}
        style={{ flex: 1 }}
      />

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0A84FF" />
          <Text style={styles.loadingText}>Loading Paynow...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const buildStyles = (t) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 40 : 10,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: t.hairline
  },
  headerTitle: { fontSize: 17, fontFamily: 'Poppins_700Bold', color: t.text },
  backBtn: { padding: 5 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.bg,
    opacity: 0.92,
    justifyContent: 'center',
    alignItems: 'center'
  },
  loadingText: {
    marginTop: 15,
    fontFamily: 'Poppins_500Medium',
    color: '#0A84FF'
  }
});
