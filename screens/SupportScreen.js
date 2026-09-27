import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function SupportScreen({ navigation }) {
  
  const handleEmail = () => {
    Linking.openURL('mailto:support@hlalalink.com');
  };

  const handlePhone = () => {
    Linking.openURL('tel:+263772123456');
  };

  const SupportCard = ({ icon, title, description, actionText, onPress }) => (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.iconBox}>
        <Ionicons name={icon} size={28} color="#0A84FF" />
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardDesc}>{description}</Text>
        <Text style={styles.actionText}>{actionText}</Text>
      </View>
    </TouchableOpacity>
  );

  const FaqItem = ({ question, answer }) => {
    const [expanded, setExpanded] = useState(false);
    return (
      <TouchableOpacity style={styles.faqItemContainer} onPress={() => setExpanded(!expanded)} activeOpacity={0.7}>
        <View style={styles.faqItemHeader}>
          <Text style={styles.faqQuestion}>{question}</Text>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color="#8E8E93" />
        </View>
        {expanded && (
          <Text style={styles.faqAnswer}>{answer}</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>How can we help you today?</Text>
          <Text style={styles.bannerSub}>Our team is available 24/7 to assist you with any questions or issues.</Text>
        </View>

        <Text style={styles.sectionTitle}>Contact Options</Text>
        <View style={styles.contactRow}>
          <TouchableOpacity style={styles.contactBtn} onPress={handleEmail}>
            <Ionicons name="mail" size={24} color="#0A84FF" />
            <Text style={styles.contactBtnText}>Email Us</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.contactBtn} onPress={handlePhone}>
            <Ionicons name="call" size={24} color="#0A84FF" />
            <Text style={styles.contactBtnText}>Call Us</Text>
          </TouchableOpacity>
        </View>

        <SupportCard 
          icon="chatbubbles" 
          title="Live Chat Support" 
          description="Chat with our customer service team instantly for quick resolutions."
          actionText="Start a conversation"
          onPress={() => {}}
        />

        <SupportCard 
          icon="document-text" 
          title="Knowledge Base" 
          description="Browse our comprehensive guides and tutorials."
          actionText="Visit Knowledge Base"
          onPress={() => {}}
        />

        <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
        <View style={styles.faqContainer}>
          <FaqItem 
            question="How do I list a property?" 
            answer="To list a property, navigate to the Agent dashboard using the '+' icon on the Home screen and fill out the property details form."
          />
          <View style={styles.divider} />
          <FaqItem 
            question="Is Hlala Link free for tenants?" 
            answer="Yes! Browsing and contacting agents on Hlala Link is completely free for all tenants."
          />
          <View style={styles.divider} />
          <FaqItem 
            question="How do I verify my agent profile?" 
            answer="Go to your Profile Settings and upload your agency credentials. Our team will review and grant you the Verified Agent badge."
          />
          <View style={styles.divider} />
          <FaqItem 
            question="What payment methods do you accept?" 
            answer="Currently, payments are handled directly between tenants and agents. We do not process rent payments through the app yet."
          />
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FE' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 20, paddingBottom: 15, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  backBtn: { padding: 4 },
  headerTitle: { fontFamily: 'Poppins_700Bold', fontSize: 18, color: '#000' },
  
  scroll: { padding: 20 },
  
  banner: { backgroundColor: '#0A84FF', borderRadius: 20, padding: 25, marginBottom: 25 },
  bannerTitle: { fontFamily: 'Poppins_900Black', fontSize: 24, color: '#FFF', marginBottom: 10, letterSpacing: -0.5 },
  bannerSub: { fontFamily: 'Poppins_400Regular', fontSize: 14, color: '#E1F0FF', lineHeight: 20 },
  
  sectionTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#1A1A1A', marginBottom: 15, marginTop: 10 },
  
  contactRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  contactBtn: { flex: 0.48, backgroundColor: '#FFF', borderRadius: 16, padding: 20, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  contactBtnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 14, color: '#1A1A1A', marginTop: 10 },
  
  card: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginBottom: 15, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2, alignItems: 'center' },
  iconBox: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#F0F5FF', justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  cardContent: { flex: 1 },
  cardTitle: { fontFamily: 'Poppins_600SemiBold', fontSize: 16, color: '#1A1A1A', marginBottom: 4 },
  cardDesc: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', marginBottom: 8, lineHeight: 18 },
  actionText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: '#0A84FF' },
  
  faqContainer: { backgroundColor: '#FFF', borderRadius: 16, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2, marginBottom: 40 },
  faqItemContainer: { padding: 20 },
  faqItemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQuestion: { fontFamily: 'Poppins_500Medium', fontSize: 14, color: '#1A1A1A', flex: 1, paddingRight: 15 },
  faqAnswer: { fontFamily: 'Poppins_400Regular', fontSize: 13, color: '#8E8E93', marginTop: 10, lineHeight: 20 },
  divider: { height: 1, backgroundColor: '#F5F5F5' }
});
