import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View, Image, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function ListingCard({ item, onPress, onFavorite, isFavorite, wide }) {
  const { width } = useWindowDimensions();
  const cardWidth = wide ? width - 40 : (width - 50) / 2;

  // Parse images
  let imageUrl = null;
  if (item.property_images && item.property_images.length > 0) {
    imageUrl = item.property_images[0].url;
  } else if (item.images && item.images.length > 0) {
    imageUrl = typeof item.images === 'string' ? JSON.parse(item.images)[0] : item.images[0];
  }

  return (
    <TouchableOpacity 
      onPress={onPress} 
      activeOpacity={0.9} 
      style={[styles.card, { width: cardWidth }]}
    >
      <View style={styles.imageContainer}>
        {imageUrl ? (
          <Image 
            source={{ uri: imageUrl }} 
            style={styles.image} 
            resizeMode="cover" 
            fadeDuration={0}
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Ionicons name="image-outline" size={30} color="#0A84FF" opacity={0.3} />
          </View>
        )}
        
        {/* Verification Badge */}
        <View style={styles.verifyBadge}>
          <Ionicons name="checkmark-circle" size={14} color="#FFF" />
        </View>

        {/* Price Badge */}
        <View style={styles.priceBadge}>
          <Text style={styles.priceText}>${item.rent_usd}/mo</Text>
        </View>

        {/* Favorite Button */}
        <TouchableOpacity 
          style={styles.favoriteBtn} 
          onPress={(e) => {
            e.stopPropagation();
            onFavorite && onFavorite(item);
          }}
        >
          <Ionicons 
            name={isFavorite ? "heart" : "heart-outline"} 
            size={16} 
            color={isFavorite ? "#FF2D55" : "#FFF"} 
          />
        </TouchableOpacity>
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{item.title || 'Beautiful House'}</Text>
        
        <View style={styles.locationRow}>
          <Ionicons name="location" size={12} color="#0A84FF" />
          <Text style={styles.location} numberOfLines={1}>
            {item.suburb || item.address || item.city || 'Harare'}
          </Text>
        </View>

        <View style={styles.statsRow}>
          {item.property_type === 'stands' ? (
            <View style={styles.stat}>
              <Ionicons name="expand-outline" size={12} color="#8E8E93" />
              <Text style={styles.statText}>{item.area_sqm || 0} sqm</Text>
            </View>
          ) : (
            <>
              <View style={styles.stat}>
                <Ionicons name="bed-outline" size={12} color="#8E8E93" />
                <Text style={styles.statText}>{item.bedrooms || 0}</Text>
              </View>
              <View style={styles.stat}>
                <Ionicons name="water-outline" size={12} color="#8E8E93" />
                <Text style={styles.statText}>{item.bathrooms || 0}</Text>
              </View>
            </>
          )}
          <View style={styles.stat}>
            <Ionicons name="resize-outline" size={12} color="#8E8E93" />
            <Text style={styles.statText}>{item.area_sqm || 0}m²</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="eye-outline" size={12} color="#8E8E93" />
            <Text style={styles.statText}>{item.views || 0}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 20, 
    marginBottom: 20,
    shadowColor: '#000', 
    shadowOpacity: 0.02, // Reduced from 0.05
    shadowRadius: 5, 
    elevation: 1, // Reduced from 3
    overflow: 'hidden'
  },
  imageContainer: { 
    height: 140, 
    width: '100%',
    position: 'relative'
  },
  image: { width: '100%', height: '100%' },
  imagePlaceholder: { width: '100%', height: '100%', backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  
  verifyBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0A84FF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
    zIndex: 2
  },
  priceBadge: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  priceText: { color: '#FFF', fontFamily: 'Poppins_700Bold', fontSize: 10 },
  
  favoriteBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.3)',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2
  },

  info: { padding: 10 },
  title: { color: '#1A1A1A', fontFamily: 'Poppins_600SemiBold', fontSize: 13, marginBottom: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  location: { color: '#8E8E93', fontFamily: 'Poppins_400Regular', fontSize: 11, marginLeft: 2 },
  
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#F5F5F5', paddingTop: 8, marginTop: 4 },
  stat: { flexDirection: 'row', alignItems: 'center' },
  statText: { color: '#8E8E93', fontFamily: 'Poppins_500Medium', fontSize: 10, marginLeft: 4 },
});
