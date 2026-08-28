import React, { useState } from 'react';
import {
  View, Text, StyleSheet, Platform, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, KeyboardAvoidingView, ScrollView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

export default function MoverReviewScreen({ route, navigation }) {
  const { booking } = route.params;
  const mover = booking?.mover;

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) { Alert.alert('Rating required', 'Please select a star rating.'); return; }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Error', 'You must be logged in.'); return; }

      const { error } = await supabase.from('mover_reviews').insert({
        mover_id: mover?.id,
        booking_id: booking.id,
        reviewer_id: user.id,
        rating,
        comment: comment.trim() || null,
      });

      if (error) {
        Alert.alert('Error', error.message || 'Could not submit review.');
        return;
      }

      Alert.alert('Thank you!', 'Your review has been submitted.', [
        { text: 'Done', onPress: () => navigation.goBack() }
      ]);
    } catch (e) {
      Alert.alert('Error', 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <View style={styles.navBar}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} color="#000" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Leave a Review</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.moverInfo}>
            <View style={styles.moverIcon}>
              <Ionicons name="cube" size={28} color="#0A84FF" />
            </View>
            <Text style={styles.moverName}>{mover?.company_name || 'Mover'}</Text>
            <Text style={styles.moverCity}>{mover?.city}</Text>
          </View>

          <Text style={styles.ratingLabel}>How was your experience?</Text>

          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map(star => (
              <TouchableOpacity key={star} onPress={() => setRating(star)} activeOpacity={0.8}>
                <Ionicons
                  name={star <= rating ? 'star' : 'star-outline'}
                  size={44}
                  color={star <= rating ? '#FFB800' : '#E5E5EA'}
                  style={{ marginHorizontal: 6 }}
                />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.ratingCaption}>
            {rating === 0 ? 'Tap a star' : rating === 1 ? 'Poor' : rating === 2 ? 'Fair' : rating === 3 ? 'Good' : rating === 4 ? 'Very Good' : 'Excellent!'}
          </Text>

          <View style={styles.commentSection}>
            <Text style={styles.commentLabel}>Comments (optional)</Text>
            <TextInput
              style={styles.commentInput}
              placeholder="Tell others about your experience…"
              placeholderTextColor="#A0A0A0"
              value={comment}
              onChangeText={setComment}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </View>

          <TouchableOpacity
            style={[styles.submitBtn, (loading || rating === 0) && { opacity: 0.5 }]}
            onPress={handleSubmit}
            disabled={loading || rating === 0}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitText}>Submit Review</Text>
            )}
          </TouchableOpacity>
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

  scroll: { padding: 24, alignItems: 'center' },

  moverInfo: { alignItems: 'center', marginBottom: 32 },
  moverIcon: {
    width: 80, height: 80, borderRadius: 20,
    backgroundColor: '#EBF4FF', justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  moverName: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#000' },
  moverCity: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#8E8E93', marginTop: 3 },

  ratingLabel: {
    fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: '#000', marginBottom: 16,
  },
  starsRow: { flexDirection: 'row', marginBottom: 10 },
  ratingCaption: {
    fontFamily: 'Poppins_500Medium', fontSize: 15, color: '#8E8E93', marginBottom: 28,
  },

  commentSection: { width: '100%', marginBottom: 24 },
  commentLabel: {
    fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000', marginBottom: 10,
  },
  commentInput: {
    backgroundColor: '#F5F5F5', borderRadius: 14,
    padding: 14, minHeight: 110,
    fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#000',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
  },

  submitBtn: {
    width: '100%', backgroundColor: '#0A84FF',
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
  },
  submitText: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#FFF' },
});
