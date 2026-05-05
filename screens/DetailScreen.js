import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform, Share, Linking, Alert, Dimensions, Modal, ActivityIndicator, TextInput, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

export default function DetailScreen({ route, navigation }) {
  const { item: initialItem, propertyId } = route.params;
  const [propertyItem, setPropertyItem] = useState(initialItem || null);
  const [fetchingProperty, setFetchingProperty] = useState(!initialItem && !!propertyId);

  const { width, height } = Dimensions.get('window');
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState('About'); // About, Gallery, Review
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [userRating, setUserRating] = useState(5);
  const [userReview, setUserReview] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [agentModalVisible, setAgentModalVisible] = useState(false);

  useEffect(() => {
    if (!propertyItem && propertyId) {
      fetchProperty();
    }
  }, [propertyId]);

  async function fetchProperty() {
    try {
      setFetchingProperty(true);
      
      // Fetch property details
      const { data, error } = await supabase
        .from('properties')
        .select('*, property_images(url), owner:profiles!owner_id(first_name, last_name, avatar_url)')
        .eq('id', propertyId)
        .single();
      
      if (error) throw error;
      setPropertyItem(data);

      // Increment views count silently in background
      await supabase.rpc('increment_views', { property_id: propertyId });

    } catch (error) {
      console.log('Fetch error:', error.message);
      Alert.alert('Error', 'Failed to load property details.');
      navigation.goBack();
    } finally {
      setFetchingProperty(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'Review') {
      fetchReviews();
    }
  }, [activeTab]);

  async function fetchReviews() {
    try {
      setLoadingReviews(true);
      const { data, error } = await supabase
        .from('reviews')
        .select(`
          id, rating, body, created_at,
          reviewer:profiles!reviewer_id(first_name, last_name, avatar_url)
        `)
        .eq('property_id', propertyItem.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setReviews(data || []);
    } catch (error) {
      console.log('Error fetching reviews:', error.message);
    } finally {
      setLoadingReviews(false);
    }
  }

  async function submitReview() {
    if (!userReview.trim()) {
      Alert.alert('Empty Review', 'Please enter some text for your review.');
      return;
    }
    
    if (!propertyItem.id) {
      Alert.alert('Error', 'Cannot post review: Property ID is missing.');
      return;
    }

    try {
      setSubmittingReview(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Login Required', 'Please log in to leave a review.');
        return;
      }

      const { error } = await supabase.from('reviews').insert({
        property_id: propertyItem.id,
        reviewer_id: user.id,
        rating: userRating,
        body: userReview,
        is_public: true
      });

      if (error) {
        console.error('Submit Review Error:', error);
        throw error;
      }

      setUserReview('');
      setUserRating(5);
      Alert.alert('Success', 'Your review has been posted!');
      fetchReviews();
    } catch (error) {
      console.log('Final catch review error:', error.message);
      Alert.alert('Error', error.message || 'Failed to post review. Please try again.');
    } finally {
      setSubmittingReview(false);
    }
  }

  let images = [];
  if (propertyItem.property_images && propertyItem.property_images.length > 0) {
    images = propertyItem.property_images.map(img => img.url);
  } else if (propertyItem.images && propertyItem.images.length > 0) {
    images = typeof propertyItem.images === 'string' ? JSON.parse(propertyItem.images) : propertyItem.images;
  }
  // Fallback if no images
  if (images.length === 0) images = ['https://images.unsplash.com/photo-1560518883-ce09059eeffa?q=80&w=1473&auto=format&fit=crop'];

  const handleScroll = (event) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const index = event.nativeEvent.contentOffset.x / slideSize;
    setActiveIndex(Math.round(index));
  };

  const handleChatPress = async () => {
    if (!propertyItem.owner_id) return;
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Check if conversation already exists
    const { data: convs } = await supabase
      .from('conversations')
      .select('id')
      .or(`and(participant_a.eq.${user.id},participant_b.eq.${propertyItem.owner_id}),and(participant_a.eq.${propertyItem.owner_id},participant_b.eq.${user.id})`)
      .eq('property_id', propertyItem.id)
      .limit(1);

    const convId = convs && convs.length > 0 ? convs[0].id : null;

    navigation.navigate('ChatRoom', {
      conversationId: convId,
      recipientName: 'Property Agent',
      propertyId: propertyItem.id,
      participantB: propertyItem.owner_id
    });
  };

  const handleShare = async () => {
    try {
      const shareLink = `https://hlalalink.com/property/${propertyItem.id}`;
      const message = `🏠 *${propertyItem.title}*\n\n` +
                      `Check out this amazing ${propertyItem.property_type || 'property'} in ${propertyItem.city || 'Zimbabwe'} for only $${propertyItem.rent_usd}/month!\n\n` +
                      `View full details on Hlala Link:\n${shareLink}`;

      await Share.share({
        message: message,
        url: shareLink,
        title: propertyItem.title,
      });
    } catch (error) {
      console.log('Share error:', error.message);
    }
  };

  const handleCall = () => {
    if (propertyItem.owner && propertyItem.owner.phone_number) {
      Linking.openURL(`tel:${propertyItem.owner.phone_number}`);
    } else {
      Alert.alert('No Number', 'This agent has not provided a contact number.');
    }
  };

  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    checkFavorite();
    if (propertyItem.owner_id) checkFollowing();
  }, []);

  const checkFollowing = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('user_follows').select('*').eq('follower_id', user.id).eq('following_id', propertyItem.owner_id).single();
    if (data) setIsFollowing(true);
  };

  const handleFollow = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Login Required', 'Please log in to follow agents.');
      return;
    }
    if (user.id === propertyItem.owner_id) {
      Alert.alert('Notice', 'You cannot follow yourself.');
      return;
    }

    if (isFollowing) {
      await supabase.from('user_follows').delete().eq('follower_id', user.id).eq('following_id', propertyItem.owner_id);
      setIsFollowing(false);
    } else {
      await supabase.from('user_follows').insert({ follower_id: user.id, following_id: propertyItem.owner_id });
      setIsFollowing(true);
    }
  };

  const checkFavorite = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('saved_properties').select('*').eq('user_id', user.id).eq('property_id', propertyItem.id).single();
    if (data) setIsFavorite(true);
  };

  const handleFavorite = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Login Required', 'Please log in to save properties.');
      return;
    }

    if (isFavorite) {
      await supabase.from('saved_properties').delete().eq('user_id', user.id).eq('property_id', propertyItem.id);
      setIsFavorite(false);
    } else {
      await supabase.from('saved_properties').insert({ user_id: user.id, property_id: propertyItem.id });
      setIsFavorite(true);
    }
  };

  const handleBookNow = async () => {
    if (!propertyItem.owner_id) {
      Alert.alert('Error', 'This property does not have an owner assigned.');
      return;
    }
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Authentication Required', 'Please log in to book this property.');
      return;
    }

    try {
      // 1. Try to find an existing conversation between these two users for this property
      const { data: convs, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .eq('property_id', propertyItem.id)
        .or(`participant_a.eq.${user.id},participant_b.eq.${user.id}`)
        .or(`participant_a.eq.${propertyItem.owner_id},participant_b.eq.${propertyItem.owner_id}`)
        .limit(1);

      let convId;
      if (convs && convs.length > 0) {
        convId = convs[0].id;
      } else {
        // 2. Create new conversation if none exists
        const { data: newConv, error: createError } = await supabase
          .from('conversations')
          .insert({
            participant_a: user.id,
            participant_b: propertyItem.owner_id,
            property_id: propertyItem.id,
            last_message_at: new Date()
          })
          .select()
          .single();
        
        if (createError) throw createError;
        convId = newConv.id;
      }

      // 3. Always send a professional auto-message for fresh "Apply Now" clicks
      // This ensures the agent sees the interest even if a conversation record existed
      const bookingMessage = `Hello! I am interested in booking this ${propertyItem.property_type || 'property'} (${propertyItem.title}) on Hlala Link. I'd like to schedule a viewing or discuss the next steps. Please let me know your availability. Thank you!`;
      
      const { error: msgError } = await supabase
        .from('messages')
        .insert({
          conversation_id: convId,
          sender_id: user.id,
          body: bookingMessage,
          status: 'sent'
        });
      
      if (msgError) console.log('Auto-message error:', msgError.message);

      // 4. Update the conversation timestamp
      await supabase.from('conversations').update({ last_message_at: new Date() }).eq('id', convId);

      // 5. Navigate to chat
      navigation.navigate('ChatRoom', {
        conversationId: convId,
        recipientName: propertyItem.owner ? `${propertyItem.owner.first_name || ''} ${propertyItem.owner.last_name || ''}`.trim() : 'Property Agent',
        propertyId: propertyItem.id,
        participantB: propertyItem.owner_id
      });

    } catch (error) {
      Alert.alert('Booking Error', error.message);
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
    >
      {fetchingProperty ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color="#0A84FF" />
          <Text style={{ marginTop: 12, fontFamily: 'Poppins_400Regular', color: '#8E8E93' }}>Loading details...</Text>
        </View>
      ) : propertyItem ? (
        <>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* Top Image Section */}
        <View style={styles.imageSection}>
          {images.length > 0 ? (
            <TouchableOpacity activeOpacity={0.9} onPress={() => setGalleryVisible(true)} style={{ height: '100%' }}>
              <ScrollView 
                horizontal 
                pagingEnabled 
                showsHorizontalScrollIndicator={false}
                onScroll={handleScroll}
                scrollEventThrottle={16}
                bounces={false}
              >
                {images.map((img, i) => (
                  <Image key={i} source={{ uri: img }} style={{ width, height: '100%' }} resizeMode="cover" />
                ))}
              </ScrollView>
              
              {images.length > 1 && (
                <View style={styles.paginationPill}>
                  <Text style={styles.paginationText}>{activeIndex + 1} / {images.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.placeholderBg}>
              <Ionicons name="image-outline" size={80} color="#0A84FF" opacity={0.3} />
            </View>
          )}

          {/* Header Buttons */}
          <View style={styles.headerBtns}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
              <Ionicons name="arrow-back" size={20} color="#000" />
            </TouchableOpacity>
            <View style={styles.rightBtns}>
              <TouchableOpacity style={styles.iconBtn} onPress={handleShare}>
                <Ionicons name="share-social-outline" size={20} color="#000" />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.iconBtn, { marginLeft: 10 }]} onPress={handleFavorite}>
                <Ionicons name={isFavorite ? "heart" : "heart-outline"} size={20} color={isFavorite ? "#FF2D55" : "#000"} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Details Sheet */}
        <View style={styles.detailsSheet}>
          <View style={styles.row}>
            <Text style={styles.typeText}>{propertyItem.property_type ? propertyItem.property_type.charAt(0).toUpperCase() + propertyItem.property_type.slice(1) : 'Apartment'}</Text>
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={14} color="#FFA500" />
              <Text style={styles.ratingText}>{propertyItem.views > 10 ? '4.8' : 'New'}</Text>
            </View>
          </View>

          <Text style={styles.title}>{propertyItem.title || 'Beautiful Property'}</Text>
          <View style={styles.locationRow}>
            <Ionicons name="location" size={16} color="#0A84FF" />
            <Text style={styles.location}>{propertyItem.address || `${propertyItem.city || 'Harare'}, ${propertyItem.suburb || 'Zimbabwe'}`}</Text>
          </View>

          {/* Tabs */}
          <View style={styles.tabsRow}>
            {['About', 'Gallery', 'Review'].map(tab => (
              <TouchableOpacity key={tab} onPress={() => setActiveTab(tab)} style={activeTab === tab ? styles.activeTab : null}>
                <Text style={activeTab === tab ? styles.activeTabText : styles.inactiveTabText}>{tab}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {activeTab === 'About' && (
            <>
              {/* Amenities Row */}
              <View style={styles.amenitiesRow}>
                {propertyItem.property_type !== 'stands' && (
                  <>
                    <View style={styles.amenity}><Ionicons name="bed" size={20} color="#0A84FF" /><Text style={styles.amenityText}>{propertyItem.bedrooms ?? 0} Beds</Text></View>
                    <View style={styles.amenity}><Ionicons name="water" size={20} color="#0A84FF" /><Text style={styles.amenityText}>{propertyItem.bathrooms ?? 0} Bath</Text></View>
                  </>
                )}
                <View style={styles.amenity}>
                  <Ionicons name="expand-outline" size={20} color="#0A84FF" />
                  <Text style={styles.amenityText}>{propertyItem.area_sqm || 0} sqm</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>Key Specifications</Text>
              <View style={styles.specsGrid}>
                {propertyItem.property_type !== 'stands' && (
                  <>
                    <View style={styles.specItem}>
                      <Ionicons name="layers-outline" size={18} color="#8E8E93" />
                      <Text style={styles.specLabel}>Floor</Text>
                      <Text style={styles.specValue}>{propertyItem.floor_level || 'Ground'}</Text>
                    </View>
                    <View style={styles.specItem}>
                      <Ionicons name="color-palette-outline" size={18} color="#8E8E93" />
                      <Text style={styles.specLabel}>Furnishing</Text>
                      <Text style={styles.specValue}>{propertyItem.is_furnished ? 'Yes' : 'Unfurnished'}</Text>
                    </View>
                  </>
                )}
                <View style={styles.specItem}>
                  <Ionicons name="car-outline" size={18} color="#8E8E93" />
                  <Text style={styles.specLabel}>Parking</Text>
                  <Text style={styles.specValue}>{propertyItem.parking_spots ? `${propertyItem.parking_spots} Slots` : 'Secure'}</Text>
                </View>
                <View style={styles.specItem}>
                  <Ionicons name="water-outline" size={18} color="#8E8E93" />
                  <Text style={styles.specLabel}>Water</Text>
                  <Text style={styles.specValue}>{propertyItem.water_source || 'Borehole'}</Text>
                </View>
              </View>

              <Text style={styles.sectionTitle}>About this property</Text>
              <Text style={styles.descText}>
                {propertyItem.description ? propertyItem.description : 'No description provided by the agent.'}
              </Text>

              <Text style={styles.sectionTitle}>Listing Agent</Text>
              <View style={styles.agentRow}>
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => setAgentModalVisible(true)}>
                  <View style={styles.agentAvatar}>
                    {propertyItem.owner?.avatar_url ? (
                      <Image source={{ uri: propertyItem.owner.avatar_url }} style={{ width: '100%', height: '100%', borderRadius: 25 }} />
                    ) : (
                      <Ionicons name="person" size={24} color="#FFF" />
                    )}
                  </View>
                  <View style={{ marginLeft: 10 }}>
                    <Text style={styles.agentName}>{propertyItem.owner ? `${propertyItem.owner.first_name || ''} ${propertyItem.owner.last_name || ''}`.trim() || 'Verified Agent' : 'Verified Agent'}</Text>
                    <Text style={styles.agentSubText}>View Profile</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.followBtn, isFollowing && styles.followingBtn]} 
                  onPress={handleFollow}
                >
                  <Text style={[styles.followText, isFollowing && styles.followingText]}>{isFollowing ? 'Following' : 'Follow'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.agentActionBtn} onPress={handleChatPress}>
                  <Ionicons name="chatbubble" size={16} color="#0A84FF" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.agentActionBtn} onPress={handleCall}>
                  <Ionicons name="call" size={16} color="#0A84FF" />
                </TouchableOpacity>
              </View>
            </>
          )}

          {activeTab === 'Gallery' && (
            <View style={styles.galleryGrid}>
              {images.map((img, i) => (
                <TouchableOpacity key={i} style={styles.gridItem} onPress={() => { setActiveIndex(i); setGalleryVisible(true); }}>
                  <Image source={{ uri: img }} style={styles.gridImage} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {activeTab === 'Review' && (
            <View style={styles.reviewsSection}>
              <View style={styles.writeReview}>
                <Text style={styles.reviewTitle}>Write a Review</Text>
                <View style={styles.starRow}>
                  {[1, 2, 3, 4, 5].map(s => (
                    <TouchableOpacity key={s} onPress={() => setUserRating(s)}>
                      <Ionicons name={s <= userRating ? "star" : "star-outline"} size={24} color="#FFA500" />
                    </TouchableOpacity>
                  ))}
                </View>
                <TextInput 
                  style={styles.reviewInput} 
                  placeholder="Share your experience..." 
                  multiline 
                  value={userReview}
                  onChangeText={setUserReview}
                />
                <TouchableOpacity 
                  style={[styles.submitReviewBtn, { opacity: submittingReview ? 0.6 : 1 }]} 
                  onPress={submitReview}
                  disabled={submittingReview}
                >
                  {submittingReview ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitReviewText}>Post Review</Text>}
                </TouchableOpacity>
              </View>

              <View style={styles.reviewsList}>
                {loadingReviews ? <ActivityIndicator color="#0A84FF" /> : reviews.length === 0 ? (
                  <Text style={styles.emptyReviews}>No reviews yet. Be the first!</Text>
                ) : (
                  reviews.map(r => (
                    <View key={r.id} style={styles.reviewCard}>
                      <View style={styles.reviewHeader}>
                        <View style={styles.reviewerInfo}>
                          <View style={styles.reviewerAvatar}>
                            {r.reviewer?.avatar_url ? <Image source={{ uri: r.reviewer.avatar_url }} style={{ width: '100%', height: '100%', borderRadius: 15 }} /> : <Ionicons name="person" size={14} color="#FFF" />}
                          </View>
                          <Text style={styles.reviewerName}>{r.reviewer?.first_name || 'Hlala User'}</Text>
                        </View>
                        <View style={styles.ratingRow}>
                          <Ionicons name="star" size={12} color="#FFA500" />
                          <Text style={styles.reviewRating}>{r.rating}</Text>
                        </View>
                      </View>
                      <Text style={styles.reviewBody}>{r.body}</Text>
                      <Text style={styles.reviewDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.bottomBar}>
        <View>
          <Text style={styles.totalPriceLabel}>Total Price</Text>
          <Text style={styles.totalPriceValue}>
            ${propertyItem?.rent_usd || '0'}
            <Text style={styles.totalPricePeriod}>/mo</Text>
          </Text>
        </View>
        <TouchableOpacity style={styles.bookBtn} onPress={handleBookNow}>
          <Text style={styles.bookBtnText}>Apply Now</Text>
        </TouchableOpacity>
      </View>

      {/* Agent Details Modal */}
      <Modal visible={agentModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.agentModal}>
            <View style={styles.modalHandle} />
            <View style={styles.agentModalAvatar}>
              {propertyItem?.owner?.avatar_url ? (
                <Image source={{ uri: propertyItem.owner.avatar_url }} style={{ width: '100%', height: '100%', borderRadius: 40 }} />
              ) : (
                <Ionicons name="person" size={40} color="#0A84FF" />
              )}
            </View>
            <Text style={styles.agentModalName}>{propertyItem?.owner ? `${propertyItem.owner.first_name || ''} ${propertyItem.owner.last_name || ''}`.trim() || 'Verified Agent' : 'Verified Agent'}</Text>
            <Text style={styles.agentModalRole}>{propertyItem?.owner?.role ? propertyItem.owner.role.toUpperCase() : 'AGENT'}</Text>
            
            <View style={styles.agentStats}>
              <View style={styles.agentStatBox}>
                <Text style={styles.statBoxNum}>12</Text>
                <Text style={styles.statBoxLabel}>Listings</Text>
              </View>
              <View style={styles.agentStatBox}>
                <Text style={styles.statBoxNum}>4.8</Text>
                <Text style={styles.statBoxLabel}>Rating</Text>
              </View>
              <View style={styles.agentStatBox}>
                <Text style={styles.statBoxNum}>2.4k</Text>
                <Text style={styles.statBoxLabel}>Followers</Text>
              </View>
            </View>

            <TouchableOpacity 
              style={[styles.modalFollowBtn, isFollowing && styles.modalFollowingBtn]} 
              onPress={handleFollow}
            >
              <Text style={[styles.modalFollowText, isFollowing && styles.modalFollowingText]}>{isFollowing ? 'Following' : 'Follow Agent'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeAgentModal} onPress={() => setAgentModalVisible(false)}>
              <Text style={styles.closeAgentText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Gallery Modal */}
      <Modal visible={galleryVisible} transparent animationType="fade">
        <View style={styles.galleryModal}>
          <TouchableOpacity style={styles.closeGallery} onPress={() => setGalleryVisible(false)}>
            <Ionicons name="close" size={32} color="#FFF" />
          </TouchableOpacity>
          <ScrollView 
            horizontal 
            pagingEnabled 
            contentOffset={{ x: activeIndex * width, y: 0 }}
          >
            {images.map((img, i) => (
              <Image key={i} source={{ uri: img }} style={{ width, height: height * 0.7, marginTop: height * 0.15 }} resizeMode="contain" />
            ))}
          </ScrollView>
        </View>
      </Modal>
      </>
      ) : (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontFamily: 'Poppins_500Medium', color: '#8E8E93' }}>Property not found</Text>
        </View>
      )}

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingBottom: 100 },
  
  imageSection: { height: 380, position: 'relative' },
  mainImg: { width: '100%', height: '100%' },
  placeholderBg: { flex: 1, backgroundColor: '#E5F1FF', justifyContent: 'center', alignItems: 'center' },
  headerBtns: { position: 'absolute', top: Platform.OS === 'ios' ? 55 : 20, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between' },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 5, elevation: 4 },
  rightBtns: { flexDirection: 'row' },
  
  paginationPill: { position: 'absolute', bottom: 45, right: 20, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16 },
  paginationText: { color: '#FFF', fontFamily: 'Poppins_600SemiBold', fontSize: 13, letterSpacing: 1 },
  
  detailsSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 36, borderTopRightRadius: 36, marginTop: -35, padding: 24, paddingBottom: 40, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  typeText: { color: '#0A84FF', fontFamily: 'Poppins_500Medium', fontSize: 14 },
  ratingRow: { flexDirection: 'row', alignItems: 'center' },
  ratingText: { color: '#FFA500', fontFamily: 'Poppins_600SemiBold', fontSize: 14, marginLeft: 6 },
  reviewCount: { color: '#A0A0A0', fontFamily: 'Poppins_400Regular' },
  
  title: { color: '#000', fontFamily: 'Poppins_600SemiBold', fontSize: 26, marginBottom: 8, lineHeight: 32 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  location: { color: '#8E8E93', fontFamily: 'Poppins_400Regular', fontSize: 15, marginLeft: 6 },
  
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#F0F0F0', marginBottom: 24, paddingBottom: 10, justifyContent: 'space-between', paddingHorizontal: 20 },
  activeTab: { borderBottomWidth: 2, borderBottomColor: '#0A84FF', paddingBottom: 10, marginBottom: -11 },
  activeTabText: { color: '#0A84FF', fontFamily: 'Poppins_600SemiBold', fontSize: 14 },
  inactiveTabText: { color: '#000', fontFamily: 'Poppins_500Medium', fontSize: 14 },

  amenitiesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 30 },
  amenity: { flexDirection: 'row', alignItems: 'center' },
  amenityText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: '#000', marginLeft: 8 },

  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 18, color: '#000', marginBottom: 12 },
  specsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 25 },
  specItem: { width: '48%', flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F9FE', padding: 12, borderRadius: 12, marginBottom: 10 },
  specLabel: { fontFamily: 'Poppins_400Regular', fontSize: 11, color: '#8E8E93', marginLeft: 8, flex: 1 },
  specValue: { fontFamily: 'Poppins_600SemiBold', fontSize: 12, color: '#1A1A1A' },
  descText: { fontFamily: 'Poppins_400Regular', fontSize: 15, color: '#666', lineHeight: 24, marginBottom: 30 },
  readMore: { color: '#0A84FF', fontFamily: 'Poppins_500Medium' },

  agentRow: { flexDirection: 'row', alignItems: 'center' },
  agentAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#A0A0A0', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  agentName: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#000' },
  agentActionBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center', marginLeft: 12 },

  bottomBar: { position: 'absolute', bottom: 0, width: '100%', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingBottom: Platform.OS === 'ios' ? 30 : 16 },
  totalPriceLabel: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#A0A0A0' },
  totalPriceValue: { fontFamily: 'Poppins_700Bold', fontSize: 20, color: '#0A84FF', marginTop: 2 },
  totalPricePeriod: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93' },
  bookBtn: { backgroundColor: '#0A84FF', paddingHorizontal: 30, height: 50, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#0A84FF', shadowOpacity: 0.3, shadowRadius: 10, elevation: 5 },
  bookBtnText: { color: '#FFF', fontFamily: 'Poppins_600SemiBold', fontSize: 16 },

  agentSubText: { color: '#0A84FF', fontSize: 12, fontFamily: 'Poppins_500Medium' },
  followBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, backgroundColor: '#E1F0FF', marginRight: 10 },
  followingBtn: { backgroundColor: '#F5F5F5' },
  followText: { color: '#0A84FF', fontSize: 12, fontFamily: 'Poppins_600SemiBold' },
  followingText: { color: '#8E8E93' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  agentModal: { backgroundColor: '#FFF', borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 30, alignItems: 'center' },
  modalHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: '#E5E5EA', marginBottom: 20 },
  agentModalAvatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', marginBottom: 15 },
  agentModalName: { fontSize: 20, fontFamily: 'Poppins_700Bold', color: '#1A1A1A' },
  agentModalRole: { fontSize: 12, fontFamily: 'Poppins_500Medium', color: '#8E8E93', marginBottom: 20 },
  agentStats: { flexDirection: 'row', justifyContent: 'space-around', width: '100%', marginBottom: 30 },
  agentStatBox: { alignItems: 'center' },
  statBoxNum: { fontSize: 18, fontFamily: 'Poppins_700Bold', color: '#1A1A1A' },
  statBoxLabel: { fontSize: 12, fontFamily: 'Poppins_400Regular', color: '#8E8E93' },
  modalFollowBtn: { width: '100%', backgroundColor: '#0A84FF', paddingVertical: 15, borderRadius: 16, alignItems: 'center', marginBottom: 15 },
  modalFollowingBtn: { backgroundColor: '#F5F5F5' },
  modalFollowText: { color: '#FFF', fontFamily: 'Poppins_600SemiBold', fontSize: 16 },
  modalFollowingText: { color: '#1A1A1A' },
  closeAgentModal: { paddingVertical: 10 },
  closeAgentText: { color: '#8E8E93', fontFamily: 'Poppins_500Medium', fontSize: 14 },

  galleryModal: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  closeGallery: { position: 'absolute', top: 50, right: 20, zIndex: 10 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  gridItem: { width: '48%', height: 120, borderRadius: 12, marginBottom: 15, overflow: 'hidden' },
  gridImage: { width: '100%', height: '100%' },

  reviewsSection: { marginTop: 10 },
  writeReview: { backgroundColor: '#F8F9FE', padding: 20, borderRadius: 20, marginBottom: 30 },
  reviewTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#1A1A1A', marginBottom: 10 },
  starRow: { flexDirection: 'row', marginBottom: 15 },
  reviewInput: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, height: 100, fontFamily: 'Poppins_400Regular', textAlignVertical: 'top', borderWidth: 1, borderColor: '#EEE' },
  submitReviewBtn: { backgroundColor: '#0A84FF', height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginTop: 15 },
  submitReviewText: { color: '#FFF', fontFamily: 'Poppins_600SemiBold' },

  reviewsList: { marginTop: 10 },
  reviewCard: { marginBottom: 25, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', paddingBottom: 20 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  reviewerInfo: { flexDirection: 'row', alignItems: 'center' },
  reviewerAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#A0A0A0', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  reviewerName: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#1A1A1A' },
  reviewRating: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#FFA500', marginLeft: 4 },
  reviewBody: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 8 },
  reviewDate: { fontFamily: 'Poppins_400Regular', fontSize: 12, color: '#A0A0A0' },
  emptyReviews: { textAlign: 'center', fontFamily: 'Poppins_400Regular', color: '#8E8E93', marginTop: 20 }
});
