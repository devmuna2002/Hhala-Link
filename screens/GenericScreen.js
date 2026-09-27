import React from 'react';
import { View, Text, StyleSheet, Platform, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function GenericScreen({ route, navigation }) {
  const title = route.params?.title || 'Screen';
  const icon = route.params?.icon || 'home';
  const message = route.params?.message || 'Feature coming soon.';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.emptyContainer}>
          <View style={styles.iconTile}>
            <Ionicons name={icon} size={34} color="#0A84FF" />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{message}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 56 : 40, paddingHorizontal: 16, paddingBottom: 15, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#000' },
  scroll: { flexGrow: 1 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, paddingVertical: 40 },
  iconTile: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center' },
  title: { fontFamily: 'Poppins_900Black', fontSize: 24, color: '#000', marginTop: 16, marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 24 }
});
