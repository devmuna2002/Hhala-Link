/* =============================================================
   HLALA LINK — app.js
   Full Supabase integration: auth, properties marketplace,
   movers marketplace, bookings, contact submissions,
   typing animation, scroll reveal, particles
   ============================================================= */

/* ── DATABASE / API CONFIG (STANDALONE) ─────────────────── */
const cfg = window.HLALA_CONFIG || {};
const SUPABASE_URL     = cfg.apiUrl || 'http://localhost:8000';
const SUPABASE_ANON_KEY = cfg.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImhsYWxhLXN0YW5kYWxvbmUiLCJpYXQiOjE3OTA4OTU1MDAsImV4cCI6MjEwNjI1NTUwMH0.6o4swyqP9xKgQcZGU_W1SWMY0vL2ucTOC8P_1O7bfZM';

let supabaseClient = null;
function sb() {
    if (!supabaseClient && window.supabase) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

/* ── CURRENT USER STATE ───────────────────────────────────── */
let currentUser    = null;
let currentProfile = null;

/* ── FALLBACK STATIC DATA (shown when DB is empty / offline) ─ */
const STATIC_PHOTOS = [
    { url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80', alt_text: '' },
    { url: 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=900&q=80', alt_text: '' },
    { url: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=900&q=80', alt_text: '' },
    { url: 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=900&q=80', alt_text: '' },
    { url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=900&q=80', alt_text: '' },
    { url: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=900&q=80', alt_text: '' },
    { url: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&w=900&q=80', alt_text: '' },
    { url: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=900&q=80', alt_text: '' },
];

const STATIC_LISTINGS = [
    { id: 1,  rent_usd: 450,  title: 'Modern 2-Bed Apartment',    city: 'Harare',  suburb: 'Avondale',   bedrooms: 2, bathrooms: 1, area_sqm: 70,  parking_spots: 1, property_type: 'apartment', status: 'available',  bi_icon: 'bi-building',         description: 'Bright apartment with open plan living, parking and garden access.', owner_name: 'TM Properties', views: 238, property_images: [STATIC_PHOTOS[0]] },
    { id: 2,  rent_usd: 350,  title: 'Cozy Cottage with Garden',  city: 'Bulawayo',suburb: 'Suburbs',    bedrooms: 2, bathrooms: 1, area_sqm: 65,  parking_spots: 1, property_type: 'cottage',   status: 'available',  bi_icon: 'bi-house-heart-fill', description: 'Charming cottage with large garden, security and covered parking.',     owner_name: 'BW Estates',    views: 145, property_images: [STATIC_PHOTOS[1]] },
    { id: 3,  rent_usd: 1200, title: 'Spacious Family House',     city: 'Harare',  suburb: 'Borrowdale', bedrooms: 4, bathrooms: 2, area_sqm: 220, parking_spots: 2, property_type: 'house',     status: 'available',  bi_icon: 'bi-house-fill',       description: 'Executive 4-bedroom home in prestigious Borrowdale with pool.',          owner_name: 'Elite Homes',   views: 512, property_images: [STATIC_PHOTOS[2]] },
    { id: 4,  rent_usd: 280,  title: 'Studio Apartment',          city: 'Harare',  suburb: 'Eastlea',    bedrooms: 1, bathrooms: 1, area_sqm: 35,  parking_spots: 0, property_type: 'studio',    status: 'available',  bi_icon: 'bi-house-door-fill',  description: 'Compact studio ideal for students or working professionals.',            owner_name: 'CityPads HRE',  views: 89,  property_images: [STATIC_PHOTOS[3]] },
    { id: 5,  rent_usd: 600,  title: '3-Bed Townhouse',           city: 'Harare',  suburb: 'Greendale',  bedrooms: 3, bathrooms: 2, area_sqm: 140, parking_spots: 2, property_type: 'townhouse', status: 'available',  bi_icon: 'bi-buildings',        description: 'Well-maintained townhouse in a secure complex with 24hr security.',        owner_name: 'GreenGate Props',views: 321, property_images: [STATIC_PHOTOS[4]] },
    { id: 6,  rent_usd: 500,  title: 'Semi-Detached House',       city: 'Mutare',  suburb: 'CBD',        bedrooms: 3, bathrooms: 1, area_sqm: 110, parking_spots: 2, property_type: 'house',     status: 'available',  bi_icon: 'bi-house-check-fill', description: 'Spacious semi-detached with solar backup and borehole.',                 owner_name: 'Mutare Realty', views: 176, property_images: [STATIC_PHOTOS[5]] },
    { id: 7,  rent_usd: 190,  title: 'Single Room En-Suite',      city: 'Harare',  suburb: 'Kuwadzana',  bedrooms: 1, bathrooms: 1, area_sqm: 18,  parking_spots: 0, property_type: 'room',      status: 'available',  bi_icon: 'bi-door-open-fill',   description: 'Self-contained room with en-suite bathroom and prepaid electricity.',     owner_name: 'Local Host',   views: 60,  property_images: [STATIC_PHOTOS[6]] },
    { id: 8,  rent_usd: 750,  title: 'Luxury 3-Bed Apartment',    city: 'Harare',  suburb: 'Msasa',      bedrooms: 3, bathrooms: 2, area_sqm: 165, parking_spots: 1, property_type: 'apartment', status: 'available',  bi_icon: 'bi-building',         description: 'High-spec apartment with pool, gym, 24hr security and fibre internet.',   owner_name: 'Msasa Luxury',  views: 411, property_images: [STATIC_PHOTOS[7]] },
];

const STATIC_MOVERS = [
    { id: 1, company_name: 'Swift Relocations', city: 'Harare',  service_areas: ['Harare', 'Chitungwiza'], vehicle_types: ['bakkie','truck'], base_price_usd: 80,  rating: 4.9, total_reviews: 128, total_jobs: 210, is_verified: true,  phone: '+263 77 111 2222', description: "Harare's premier moving company with modern fleet and professional handlers.", bi_icon: 'bi-truck-front-fill' },
    { id: 2, company_name: 'ZimMove Pros',       city: 'Bulawayo',service_areas: ['Bulawayo', 'Gweru'],   vehicle_types: ['van','truck'],    base_price_usd: 60,  rating: 4.7, total_reviews: 94,  total_jobs: 156, is_verified: true,  phone: '+263 77 333 4444', description: 'Bulawayo-based movers specializing in residential and commercial relocations.',  bi_icon: 'bi-box-seam-fill'    },
    { id: 3, company_name: 'National Movers',    city: 'Harare',  service_areas: ['Harare','Mutare','Gweru','Bulawayo'], vehicle_types: ['truck','trailer'], base_price_usd: 100, rating: 4.8, total_reviews: 210, total_jobs: 380, is_verified: true, phone: '+263 77 555 6666', description: 'Zimbabwe-wide moving services with insured cargo and experienced teams.',       bi_icon: 'bi-buildings-fill'   },
    { id: 4, company_name: 'EasyMove Mutare',    city: 'Mutare',  service_areas: ['Mutare', 'Nyanga'],     vehicle_types: ['bakkie','van'],   base_price_usd: 50,  rating: 4.5, total_reviews: 42,  total_jobs: 88,  is_verified: false, phone: '+263 77 777 8888', description: 'Affordable movers serving Mutare and eastern Zimbabwe.',                          bi_icon: 'bi-truck-front-fill' },
    { id: 5, company_name: 'Express Load Harare',city: 'Harare',  service_areas: ['Harare'],               vehicle_types: ['bakkie'],         base_price_usd: 40,  rating: 4.3, total_reviews: 29,  total_jobs: 55,  is_verified: false, phone: '+263 77 999 0000', description: 'Fast and affordable bakkie hire for small moves and student relocations.',       bi_icon: 'bi-truck-front-fill' },
    { id: 6, company_name: 'Gweru Transport Co', city: 'Gweru',   service_areas: ['Gweru', 'Kwekwe'],      vehicle_types: ['truck','van'],    base_price_usd: 70,  rating: 4.6, total_reviews: 58,  total_jobs: 122, is_verified: true,  phone: '+263 77 111 3333', description: 'Midlands-region movers with full packing and unpacking services.',               bi_icon: 'bi-box-seam-fill'    },
];

/* ── ACTIVE DATA STATE ────────────────────────────────────── */
let allListings      = [];      // full dataset (from DB or static)
let filteredListings = [];
let displayedCount   = 6;
const LISTING_CACHE  = new Map(); // id -> full property object, keeps cards light
const PAGE_SIZE     = 6;

let allMovers       = [];
let filteredMovers  = [];
let currentTypeFilter = 'all';
let currentCityFilter = 'all';
let currentMoverCityFilter = 'all';
let currentSearchQuery = '';
let currentPurpose = 'rent';

function priceOf(p) {
    return currentPurpose === 'buy' ? (p.sale_price_usd ?? p.rent_usd) : (p.rent_usd ?? p.sale_price_usd);
}

function coverFor(str, fallback) {
    const s = String(str || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return (h || (fallback || 0)) % 3 + 1;
}

/* ============================
   1. AUTH SYSTEM
   ============================ */

async function initAuth() {
    const client = sb();
    if (!client) return;

    // Listen for auth changes
    client.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
            currentUser = session.user;
            await loadUserProfile(session.user.id);
            updateAuthUI(true);
            subscribeMessageChannel();
        } else {
            currentUser    = null;
            currentProfile = null;
            updateAuthUI(false);
        }
    });

    // Check initial session
    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
        currentUser = session.user;
        await loadUserProfile(session.user.id);
        updateAuthUI(true);
        subscribeMessageChannel();
    }
}

async function loadUserProfile(userId) {
    const client = sb();
    if (!client) return;
    
    // Optimistic check: if metadata exists, use it as a placeholder to speed up UI
    if (currentUser?.user_metadata?.role && !currentProfile) {
        currentProfile = {
            id: currentUser.id,
            first_name: currentUser.user_metadata.first_name || '',
            last_name:  currentUser.user_metadata.last_name || '',
            role:       currentUser.user_metadata.role || 'tenant',
            phone_number: currentUser.user_metadata.phone_number || ''
        };
    }

    // Retry to account for trigger latency (reduced delays)
    for (let i = 0; i < 3; i++) {
        const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
        if (data) {
            currentProfile = data;
            return;
        }
        if (i < 2) await new Promise(r => setTimeout(r, 150)); 
    }
}

function updateAuthUI(isLoggedIn) {
    const loggedOut = document.getElementById('auth-logged-out');
    const loggedIn  = document.getElementById('auth-logged-in');
    const nameEl    = document.getElementById('user-display-name');
    const addListingBtn = document.getElementById('addListingBtn');
    const addMoverBtn   = document.getElementById('addMoverBtn');
    const dashMenuItem  = document.getElementById('dash-menu-item');

    if (isLoggedIn && currentUser) {
        loggedOut.style.display = 'none';
        loggedIn.style.display  = 'flex';
        
        // Show name from profile, or fallback to email
        const displayName = currentProfile?.first_name || currentUser.email.split('@')[0];
        nameEl.textContent = displayName;

        if (currentProfile) {
            if (['landlord', 'agent'].includes(currentProfile.role)) {
                if (addListingBtn) addListingBtn.style.display = 'flex';
            }
            if (currentProfile.role === 'mover') {
                if (addMoverBtn) addMoverBtn.style.display = 'flex';
            }
            if (isAdminUser()) {
                if (dashMenuItem) dashMenuItem.style.display = 'block';
            } else {
                if (dashMenuItem) dashMenuItem.style.display = 'none';
            }
        }
    } else {
        loggedOut.style.display = 'flex';
        loggedIn.style.display  = 'none';
        if (addListingBtn) addListingBtn.style.display = 'none';
        if (addMoverBtn)   addMoverBtn.style.display   = 'none';
        if (dashMenuItem)  dashMenuItem.style.display  = 'none';
    }
}

let longPressTimer;
function initLongPressSignOut() {
    const avatarBtn = document.getElementById('user-avatar-btn');
    if (!avatarBtn) return;

    const start = (e) => {
        longPressTimer = setTimeout(() => {
            if (confirm('Sign out from Hlala Link?')) {
                handleLogout();
            }
        }, 800);
    };

    const cancel = () => {
        clearTimeout(longPressTimer);
    };

    avatarBtn.addEventListener('mousedown', start);
    avatarBtn.addEventListener('touchstart', start);
    avatarBtn.addEventListener('mouseup', cancel);
    avatarBtn.addEventListener('mouseleave', cancel);
    avatarBtn.addEventListener('touchend', cancel);
}

function toggleUserMenu() {
    document.getElementById('user-avatar-btn')?.classList.toggle('open');
}

/* ── DASHBOARD LOGIC ──────────────────────────────────────── */

/* ── MESSAGE SYSTEM ─────────────────────────────────────── */
function openMessagesModal(partnerId, partnerName) {
    if (!partnerId) { showToast('This mover has no chat profile yet.', 'error'); return; }
    // Load messages between currentUser and partner
    loadMessages(partnerId);
    const modal = document.getElementById('messages-modal');
    if (modal) {
        modal.querySelector('.messages-header').textContent = `Chat with ${partnerName}`;
        modal.dataset.partnerId = partnerId;
        
        // Mark messages as read
        markMessagesAsRead(partnerId);
        
        openModal('messages-modal');
    }
}

async function markMessagesAsRead(partnerId) {
    const client = sb();
    if (!client || !currentUser) return;
    
    // Find conversation ID
    const { data: convs } = await client
        .from('conversations')
        .select('id')
        .or(`and(participant_a.eq.${currentUser.id},participant_b.eq.${partnerId}),and(participant_a.eq.${partnerId},participant_b.eq.${currentUser.id})`)
        .limit(1);

    if (convs?.[0]) {
        await client.from('messages')
            .update({ status: 'read' })
            .eq('conversation_id', convs[0].id)
            .neq('sender_id', currentUser.id)
            .neq('status', 'read');
    }
    
    // Refresh unread indicators
    syncDashboardData();
}

async function loadMessages(partnerId) {
    const container = document.getElementById('messages-list');
    if (!container) return;
    const client = sb();
    if (!client || !currentUser) { container.innerHTML = '<p class="text-muted">Login to view messages.</p>'; return; }

    // 1. Find the conversation ID for this pair
    const { data: convs } = await client
        .from('conversations')
        .select('id')
        .or(`and(participant_a.eq.${currentUser.id},participant_b.eq.${partnerId}),and(participant_a.eq.${partnerId},participant_b.eq.${currentUser.id})`)
        .limit(1);
    
    if (!convs || convs.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:2rem"><p class="text-muted">No messages yet. Start the conversation!</p></div>';
        return;
    }

    const convId = convs[0].id;
    document.getElementById('messages-modal').dataset.convId = convId;

    const { data, error } = await client.from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
    
    if (error) { container.innerHTML = '<p class="text-danger">Failed to load messages.</p>'; return; }
    container.innerHTML = (data || []).map(m => `
        <div class="message-item ${m.sender_id === currentUser.id ? 'sent' : 'received'}">
            <div class="message-content">${m.body}</div>
            <div class="message-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
        </div>`).join('');
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

async function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;
    const partnerId = document.getElementById('messages-modal').dataset.partnerId;
    
    await executeSendMessage(partnerId, content);
    input.value = '';
}

async function executeSendMessage(partnerId, content) {
    const client = sb();
    if (!client || !currentUser) { showToast('Login required to send messages.', 'error'); return; }

    // 1. Find or Create conversation
    const { data: convs } = await client
        .from('conversations')
        .select('id')
        .or(`and(participant_a.eq.${currentUser.id},participant_b.eq.${partnerId}),and(participant_a.eq.${partnerId},participant_b.eq.${currentUser.id})`)
        .limit(1);

    let convId;
    if (convs && convs.length > 0) {
        convId = convs[0].id;
    } else {
        const { data: newConv, error: convErr } = await client
            .from('conversations')
            .insert({ participant_a: currentUser.id, participant_b: partnerId })
            .select()
            .single();
        if (convErr) { showToast('Could not start conversation.', 'error'); return; }
        convId = newConv.id;
    }

    // 2. Insert message
    const { error } = await client.from('messages').insert({
        conversation_id: convId,
        sender_id: currentUser.id,
        body: content, // Note: DB uses 'body' according to schema, not 'content'
        status: 'sent'
    });

    if (error) { 
        console.error('Send error:', error);
        showToast('Failed to send message.', 'error'); 
    } else {
        // Keep conversation ordering correct across clients (mobile parity)
        client.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', convId).then(() => {}, () => {});
        loadMessages(partnerId);
    }
}

function sendQuickReply(content) {
    const partnerId = document.getElementById('messages-modal').dataset.partnerId;
    if (partnerId) {
        executeSendMessage(partnerId, content);
    }
}

// Add listener for real-time updates (optional)
function subscribeMessageChannel() {
    const client = sb();
    if (!client) return;
    client.channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            // messages has no receiver_id column — match the open
            // conversation instead (mobile parity).
            const modal = document.getElementById('messages-modal');
            const openConvId = modal?.dataset.convId;
            const partnerId = modal?.dataset.partnerId;
            if (payload.new?.conversation_id && openConvId && payload.new.conversation_id === openConvId) {
                loadMessages(partnerId);
                markMessagesAsRead(partnerId);
            }
        })
        .subscribe();
}

// Call subscribe on initAuth success
// Added near end of initAuth after updateAuthUI

function isAdminUser() {
    return currentProfile?.role === 'admin' || currentUser?.user_metadata?.role === 'admin';
}

function openDashboard() {
    if (!currentUser) { openModal('login-modal'); return; }
    console.debug('[HlalaLink] Dashboard access — profile role:', currentProfile?.role, '| metadata role:', currentUser.user_metadata?.role);
    if (!isAdminUser()) {
        showToast(`Admins only — your role is "${currentProfile?.role || 'unknown'}".`, 'error', 6000);
        return;
    }
    closeAllUserMenus();
    openModal('dashboard-modal');
    syncDashboardData();
}

/* ── USER MENU SHORTCUTS (header dropdown + chat) ─────────── */
// Opens the dashboard straight to the given tab. Login is required;
// the admin-only gate in openDashboard() is intentionally bypassed
// here because messages / saved / notifications are tenant features.
function openDashTab(tabId) {
    closeAllUserMenus();
    if (!currentUser) {
        showToast('Log in to continue.');
        openModal('login-modal');
        return;
    }
    openModal('dashboard-modal');
    switchDashTab(tabId);
    syncDashboardData();
}

function openChatScreen() {
    openDashTab('messages');
}

function openMyListings() {
    if (!currentUser) {
        closeAllUserMenus();
        showToast('Log in to manage your listings.');
        openModal('login-modal');
        return;
    }
    if (!['landlord', 'agent'].includes(currentProfile?.role || '')) {
        closeAllUserMenus();
        showToast('Listing tools are for landlords and agents.', 'error');
        document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' });
        return;
    }
    openDashTab('listings');
}

/* ── LEGAL MODAL (footer links) ───────────────────────────── */
const LEGAL_COPY = {
    privacy: {
        title: 'Privacy Policy',
        body: `<p><strong>Last updated: 2026.</strong> Hlala Link collects only what it needs to run the marketplace: your account details, listings, messages and bookings.</p><p>We never sell your personal data. Property photos and contact details you publish on listings are visible to other users — that is how tenants reach you.</p><p>Contact <strong>support@hlalalink.co.zw</strong> to request a copy or deletion of your data.</p>`
    },
    terms: {
        title: 'Terms of Service',
        body: `<p><strong>Last updated: 2026.</strong> By using Hlala Link you agree to publish accurate listings, communicate respectfully, and honour bookings you confirm.</p><p>Landlords and movers are responsible for the accuracy of their prices, availability and service descriptions. Hlala Link provides the platform and does not party to rental contracts.</p><p>Accounts that post fraudulent listings may be suspended.</p>`
    }
};

function openLegalModal(type) {
    const copy = LEGAL_COPY[type] || LEGAL_COPY.terms;
    const titleEl = document.getElementById('legal-title');
    const bodyEl  = document.getElementById('legal-body');
    if (titleEl) titleEl.textContent = copy.title;
    if (bodyEl)  bodyEl.innerHTML    = copy.body;
    openModal('legal-modal');
}

/* ── DELETE ACCOUNT (dashboard danger zone) ───────────────── */
async function handleDeleteAccount() {
    if (!currentUser) {
        openModal('login-modal');
        return;
    }
    if (!confirm('Delete your Hlala Link account? Your profile will be removed and you will be signed out. This cannot be undone.')) return;
    try {
        const client = sb();
        if (client) await client.from('profiles').delete().eq('id', currentUser.id);
    } catch (e) {
        console.warn('[account] profile delete failed:', e?.message || e);
    }
    await handleLogout();
    showToast('Your account has been deleted.');
}

/* ── DASHBOARD MOVER BOOKING (quote-safe lookup) ─────────── */
const DASH_MOVERS = new Map();
function bookDashMover(id) {
    const m = DASH_MOVERS.get(String(id));
    if (!m) { showToast('Mover not found.', 'error'); return; }
    openBookingModal(m.id, m.company_name, m.phone || '');
}

function switchDashTab(tabId) {
    // Hide all tabs
    document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.dash-nav-link').forEach(l => l.classList.remove('active'));
    
    // Show selected
    const targetTab = document.getElementById(`dash-tab-${tabId}`);
    if (targetTab) targetTab.classList.add('active');
    
    // Set active link
    const activeLink = Array.from(document.querySelectorAll('.dash-nav-link'))
        .find(l => l.getAttribute('onclick')?.includes(`'${tabId}'`));
    if (activeLink) activeLink.classList.add('active');

    // Clear unread count if switching to messages
    if (tabId === 'messages' && currentUser) {
        sb().from('messages')
            .update({ status: 'read' })
            .neq('sender_id', currentUser.id)
            .neq('status', 'read')
            .then(() => syncDashboardData());
    }
}

async function syncDashboardData() {
    if (!currentProfile) return;
    
    document.getElementById('dash-user-name').textContent = `${currentProfile.first_name} ${currentProfile.last_name}`;
    document.getElementById('dash-user-role').textContent = currentProfile.role.toUpperCase();
    
    // Fill profile form
    document.getElementById('dash-fname').value = currentProfile.first_name || '';
    document.getElementById('dash-lname').value = currentProfile.last_name || '';
    document.getElementById('dash-phone').value = currentProfile.phone_number || '';
    document.getElementById('dash-bio').value   = currentProfile.bio || '';

    // Adjust visibility based on role
    const listingsLink = document.getElementById('dash-link-listings');
    const isProvider = ['landlord', 'agent'].includes(currentProfile.role);
    listingsLink.style.display = isProvider ? 'block' : 'none';

    // 1. Fetch My Listings (if landlord/agent)
    if (isProvider) {
        const { data: props } = await sb().from('properties').select('*').eq('owner_id', currentUser.id);
        const listEl = document.getElementById('dash-properties-list');
        document.getElementById('stat-active-listings').textContent = props?.length || 0;
        
        if (props?.length > 0) {
            listEl.innerHTML = props.map(p => `
                <div class="dash-list-item">
                    <i class="bi bi-house-door" style="font-size:1.5rem;color:var(--blue)"></i>
                    <div style="flex:1">
                        <strong>${p.title}</strong>
                        <div class="text-muted" style="font-size:.75rem">$${p.rent_usd}/mo • ${p.city}</div>
                    </div>
                    <span class="badge-role">${p.status}</span>
                </div>
            `).join('');
        } else {
            listEl.innerHTML = '<p class="text-muted">You haven\'t added any properties yet.</p>';
        }
    }

    // 2. Fetch Saved Properties
    const { data: saved } = await sb().from('saved_properties').select('property_id, properties(*)').eq('user_id', currentUser.id);
    const savedEl = document.getElementById('dash-saved-list');
    if (saved?.length > 0) {
        savedEl.innerHTML = saved.map(s => `
            <div class="dash-list-item" onclick="openListingDetail(${JSON.stringify(s.properties).replace(/"/g, '&quot;')})">
                <i class="bi bi-heart-fill" style="color:var(--red)"></i>
                <div style="flex:1">
                    <strong>${s.properties.title}</strong>
                    <div class="text-muted" style="font-size:.75rem">${s.properties.city} • $${s.properties.rent_usd}</div>
                </div>
                <i class="bi bi-chevron-right"></i>
            </div>
        `).join('');
    } else {
        savedEl.innerHTML = '<p class="text-muted">No saved properties yet.</p>';
    }

    // 3. Fetch Bookings
    const { data: bookings } = await sb().from('mover_bookings').select('*, movers(company_name)').eq('user_id', currentUser.id);
    const bookEl = document.getElementById('dash-bookings-list');
    if (bookings?.length > 0) {
        bookEl.innerHTML = bookings.map(b => `
            <div class="dash-list-item">
                <i class="bi bi-truck" style="font-size:1.5rem;color:var(--blue)"></i>
                <div style="flex:1">
                    <strong>Move with ${b.movers?.company_name || 'Mover'}</strong>
                    <div class="text-muted" style="font-size:.75rem">${b.moving_date} • ${b.status}</div>
                </div>
            </div>
        `).join('');
    } else {
        bookEl.innerHTML = '<p class="text-muted">No moving service bookings found.</p>';
    }

    // 4. Fetch Applications (Tenant perspective)
    const { data: apps } = await sb().from('applications').select('*, properties(title, city)').eq('applicant_id', currentUser.id);
    const appsEl = document.getElementById('dash-apps-list');
    if (apps?.length > 0) {
        appsEl.innerHTML = apps.map(a => `
            <div class="dash-list-item">
                <i class="bi bi-file-earmark-text" style="font-size:1.5rem;color:var(--blue)"></i>
                <div style="flex:1">
                    <strong>Application: ${a.properties?.title}</strong>
                    <div class="text-muted" style="font-size:.75rem">${a.properties?.city} • Status: <b>${a.status.toUpperCase()}</b></div>
                </div>
            </div>
        `).join('');
    } else {
        appsEl.innerHTML = '<p class="text-muted">No active applications.</p>';
    }

    // 5. Fetch Notifications
    const { data: notifs } = await sb().from('notifications').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
    const notifEl = document.getElementById('dash-notifications-list');
    if (notifs?.length > 0) {
        notifEl.innerHTML = notifs.map(n => `
            <div class="dash-list-item">
                <i class="bi bi-bell-fill" style="font-size:1.2rem;color:var(--blue)"></i>
                <div style="flex:1">
                    <strong>${n.title}</strong>
                    <div class="text-muted" style="font-size:.8rem">${n.message}</div>
                </div>
            </div>
        `).join('');
    } else {
        notifEl.innerHTML = '<p class="text-muted">No new notifications.</p>';
    }

    // 6. Update Unread Count in Header
    const { count: unreadCount } = await sb().from('messages')
        .select('*', { count: 'exact', head: true })
        .neq('sender_id', currentUser.id)
        .neq('status', 'read');
    
    const badge = document.getElementById('notif-count');
    if (badge) {
        badge.textContent = unreadCount || 0;
        badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    }

    // 6b. Overview stat + recent activity feed
    const statMsg = document.getElementById('stat-new-messages');
    if (statMsg) statMsg.textContent = unreadCount || 0;
    const activityEl = document.getElementById('dash-activity-list');
    if (activityEl) {
        const items = [];
        (bookings || []).slice(0, 2).forEach(b => items.push({ icon: 'bi-truck', text: `Booking with ${b.movers?.company_name || 'mover'} • ${b.status}` }));
        (apps || []).slice(0, 2).forEach(a => items.push({ icon: 'bi-file-earmark-text', text: `Application: ${a.properties?.title || 'property'} • ${String(a.status || '').toUpperCase()}` }));
        (notifs || []).slice(0, 3).forEach(n => items.push({ icon: 'bi-bell-fill', text: n.title }));
        activityEl.innerHTML = items.length
            ? items.map(i => `<div class="dash-list-item"><i class="bi ${i.icon}" style="font-size:1.2rem;color:var(--blue)"></i><div style="flex:1"><strong>${i.text}</strong></div></div>`).join('')
            : '<p class="text-muted">No recent activity found.</p>';
    }

    // 6c. Movers tab — reuse already-loaded marketplace data (no extra query)
    const moversEl = document.getElementById('dash-movers-list');
    if (moversEl) {
        const list = (allMovers || []).slice(0, 12);
        list.forEach(m => DASH_MOVERS.set(String(m.id), m));
        moversEl.innerHTML = list.length ? list.map(m => `
            <div class="dash-list-item">
                <i class="bi bi-truck-front-fill" style="font-size:1.5rem;color:var(--blue)"></i>
                <div style="flex:1">
                    <strong>${m.company_name}</strong>
                    <div class="text-muted" style="font-size:.75rem">${m.city} • from $${m.base_price_usd}</div>
                </div>
                <button class="btn btn-primary btn-sm" onclick="bookDashMover('${escapeAttr(m.id)}')">Book</button>
            </div>
        `).join('') : '<p class="text-muted">No movers available right now.</p>';
    }

    // 7. Fetch Conversations for Dashboard Chat
    const { data: convos } = await sb().rpc('get_user_conversations', { uid: currentUser.id });
    const convosEl = document.getElementById('convos-list');
    if (convosEl) {
        if (convos?.length > 0) {
            convosEl.innerHTML = convos.map(c => `
                <div class="chat-item ${c.unread_count > 0 ? 'unread' : ''}" onclick="loadDashboardChat('${c.partner_id}', '${c.partner_name}')">
                    <div class="chat-avatar">${c.partner_name.charAt(0)}</div>
                    <div class="chat-info">
                        <strong>${c.partner_name}</strong>
                        <p>${c.last_message_content || 'No messages'}</p>
                    </div>
                    ${c.unread_count > 0 ? `<span class="chat-badge">${c.unread_count}</span>` : ''}
                </div>
            `).join('');
        } else {
            convosEl.innerHTML = '<p class="text-muted p-3">No conversations yet.</p>';
        }
    }
}

async function loadDashboardChat(partnerId, partnerName) {
    const header = document.getElementById('chat-header');
    const form = document.getElementById('chat-form');
    if (header) {
        header.innerHTML = `
            <strong>${partnerName}</strong>
            <button class="btn btn-ghost btn-sm text-danger" onclick="handleDeleteConversation('${partnerId}')">
                <i class="bi bi-trash"></i> Delete
            </button>
        `;
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';
    }
    if (form) {
        form.style.display = 'flex';
        form.dataset.partnerId = partnerId;
    }
    
    await loadDashboardMessages(partnerId);
    markMessagesAsRead(partnerId);
}

async function handleDeleteConversation(partnerId) {
    if (!confirm('Are you sure you want to delete this conversation? This will remove all messages for both users.')) return;
    
    const client = sb();
    if (!client) return;

    // Find the conversation ID for this pair
    const { data: convo } = await client
        .from('conversations')
        .select('id')
        .or(`and(participant_a.eq.${currentUser.id},participant_b.eq.${partnerId}),and(participant_a.eq.${partnerId},participant_b.eq.${currentUser.id})`)
        .single();

    if (convo) {
        const { error } = await client.from('conversations').delete().eq('id', convo.id);
        if (!error) {
            showToast('Conversation deleted.');
            openDashboard(); // Reload dashboard
        } else {
            showToast('Error deleting conversation.', 'error');
        }
    }
}

async function loadDashboardMessages(partnerId) {
    const box = document.getElementById('chat-messages-box');
    if (!box) return;
    
    const client = sb();
    // 1. Get the conversation ID
    const { data: convo } = await client
        .from('conversations')
        .select('id')
        .or(`and(participant_a.eq.${currentUser.id},participant_b.eq.${partnerId}),and(participant_a.eq.${partnerId},participant_b.eq.${currentUser.id})`)
        .single();

    if (!convo) {
        box.innerHTML = '<p class="text-muted p-4">No messages yet.</p>';
        return;
    }

    const { data, error } = await client.from('messages')
        .select('*')
        .eq('conversation_id', convo.id)
        .order('created_at', { ascending: true });
        
    if (data) {
        box.innerHTML = data.map(m => `
            <div class="chat-bubble ${m.sender_id === currentUser.id ? 'sent' : 'received'}">
                ${m.body}
                <div class="chat-time">${new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
        `).join('');
        box.scrollTop = box.scrollHeight;
    }
}

async function handleSendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const partnerId = document.getElementById('chat-form').dataset.partnerId;
    const content = input.value.trim();
    if (!content || !partnerId) return;
    
    await executeSendMessage(partnerId, content);
    input.value = '';
    await loadDashboardMessages(partnerId);
}

async function handleProfileUpdate(e) {
    e.preventDefault();
    const btn = document.getElementById('updateProfileBtn');
    const updates = {
        first_name:   document.getElementById('dash-fname')?.value.trim() || '',
        last_name:    document.getElementById('dash-lname')?.value.trim() || '',
        phone_number: document.getElementById('dash-phone')?.value.trim() || '',
        bio:          document.getElementById('dash-bio')?.value.trim() || ''
    };

    btn.disabled = true;
    btn.textContent = 'Saving…';

    const { error } = await sb().from('profiles').update(updates).eq('id', currentUser.id);
    
    btn.disabled = false;
    btn.textContent = 'Save Changes';
    
    if (error) {
        showToast('⚠ Failed to update profile.');
    } else {
        await loadUserProfile(currentUser.id);
        updateAuthUI(true);
        showToast('Profile updated successfully!');
    }
}

async function handleLogout() {
    const client = sb();
    if (client) await client.auth.signOut();
    currentUser    = null;
    currentProfile = null;
    updateAuthUI(false);
    closeModal('dashboard-modal');
    showToast('Signed out successfully.');
    closeAllUserMenus();
}

async function handleLogin(e) {
    e.preventDefault();
    const email    = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn      = document.getElementById('loginBtn');
    const errEl    = document.getElementById('login-error');

    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Signing in…';
    btn.disabled  = true;
    errEl.textContent = '';

    const client = sb();
    if (!client) {
        setTimeout(() => {
            closeModal('login-modal');
            showToast('Welcome back! (Demo mode — Supabase not connected)');
            btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Log In';
            btn.disabled  = false;
        }, 1000);
        return;
    }

    const { data: authData, error: authError } = await client.auth.signInWithPassword({ email, password });
    
    btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Log In';
    btn.disabled  = false;

    if (authError) {
        console.error("Login Failure:", authError);
        errEl.innerHTML = `⚠ ${authError.message}`;
    } else {
        console.log("Login Success:", authData.user.id);
        closeModal('login-modal');
        showToast('Welcome back! You are now logged in.');

        // Ensure profile is loaded, then send admins straight to the dashboard
        await loadUserProfile(authData.user.id);
        updateAuthUI(true);
        ensurePushSubscription().catch(() => {});
        if (isAdminUser()) openDashboard();
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const role     = document.getElementById('signup-role').value;
    const fname    = document.getElementById('signup-fname').value.trim();
    const lname    = document.getElementById('signup-lname').value.trim();
    const email    = document.getElementById('signup-email').value.trim();
    const phone    = document.getElementById('signup-phone').value.trim();
    const password = document.getElementById('signup-password').value;
    const btn      = document.getElementById('signupBtn');
    const errEl    = document.getElementById('signup-error');

    if (!role) { errEl.textContent = '⚠ Please select an account type.'; return; }

    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Creating Account…';
    btn.disabled  = true;
    errEl.textContent = '';

    const client = sb();
    if (!client) {
        setTimeout(() => {
            closeModal('signup-modal');
            showToast(`Welcome, ${fname}! Your account has been created.`);
            btn.innerHTML = '<i class="bi bi-person-plus-fill"></i> Create Free Account';
            btn.disabled  = false;
        }, 600); // Reduced from 1200ms
        return;
    }

    const { data: authData, error: authError } = await client.auth.signUp({
        email, password,
        options: { 
            data: { 
                first_name: fname, 
                last_name: lname, 
                role: role, 
                phone_number: phone 
            } 
        }
    });

    if (authError) {
        errEl.textContent = '⚠ ' + authError.message;
        btn.innerHTML = '<i class="bi bi-person-plus-fill"></i> Create Free Account';
        btn.disabled  = false;
        return;
    }

    // Success UI updates
    btn.innerHTML = '<i class="bi bi-person-plus-fill"></i> Create Free Account';
    btn.disabled  = false;
    closeModal('signup-modal');
    
    if (!authData.session) {
        showToast(`Verification email sent to ${email}. Please check your inbox!`, 6000);
    } else {
        // Optimistic profile setup to make it feel instant
        currentProfile = {
            id: authData.user.id,
            first_name: fname,
            last_name: lname,
            role: role,
            phone_number: phone
        };
        updateAuthUI(true);
        ensurePushSubscription().catch(() => {});
        showToast(`Welcome, ${fname}! Your account is ready.`);
        
        // Guidance for landlords
        if (['landlord', 'agent'].includes(role)) {
            setTimeout(() => {
                showToast("Ready to list your first property? Click 'Add Listing' in the marketplace toolbar!", 'success', 5000);
            }, 800);
        }
    }
}

function contactViaPhone(phone, message) {
    if (!phone) { showToast('Phone number not available.', 'error'); return; }
    const confirmed = confirm(`Call ${phone}?`);
    if (confirmed) {
        window.open(`tel:${phone}`);
    }
}

function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.innerHTML = isHidden ? '<i class="bi bi-eye-slash-fill"></i>' : '<i class="bi bi-eye-fill"></i>';
}

/* ============================
   2. MARKETPLACE — PROPERTIES
   ============================ */

async function initListings(silent = false) {
    if (!silent) showListingsLoading(true);
    const client = sb();

    if (client) {
        try {
            const { data, error } = await client
                .from('properties')
                .select('*, property_images(url, alt_text, is_cover)')
                .eq('status', 'available')
                .order('created_at', { ascending: false })
                .limit(30);

            if (!error && data && data.length > 0) {
                allListings = data.map(normalizeProperty);
            } else {
                allListings = STATIC_LISTINGS;
                console.warn('[listings] DB query returned 0 rows or an error. Falling back to STATIC_LISTINGS.', error || '(no rows)');
            }
        } catch (err) {
            if (!silent) allListings = STATIC_LISTINGS;
        }
    } else if (!silent) {
        allListings = STATIC_LISTINGS;
    }

    filteredListings = [...allListings];
    updateSpotlight();
    // If not searching/filtering, just update the grid
    if (currentTypeFilter === 'all' && currentCityFilter === 'all') {
        renderListings();
    }
    if (!silent) showListingsLoading(false);
}

/**
 * Real-time subscription for properties
 * Automatically updates the UI when a new property is added or changed
 */
function subscribeToProperties() {
    const client = sb();
    if (!client) return;

    // Debounce re-renders so bursts of realtime events (view counts etc.)
    // never cause the grid to flicker/blink.
    let pendingRefresh = false;
    const debouncedRefresh = () => {
        if (pendingRefresh) return;
        pendingRefresh = true;
        setTimeout(() => {
            pendingRefresh = false;
            initListings(true); // Silent refresh
        }, 3000);
    };

    client.channel('public:properties')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'properties' }, payload => {
            // A pure view-count bump is not a real listing change — ignore it
            // so the grid does not re-render just because someone viewed a listing.
            if (payload.columns && payload.columns.length === 1 && payload.columns[0] === 'views') return;
            debouncedRefresh();
        })
        .subscribe();
}

function normalizeProperty(p) {
    const typeIconMap = {
        apartment: 'bi-building',
        house:     'bi-house-fill',
        cottage:   'bi-house-heart-fill',
        studio:    'bi-house-door-fill',
        townhouse: 'bi-buildings',
        room:      'bi-door-open-fill',
        other:     'bi-house-fill',
    };
    return { ...p, bi_icon: typeIconMap[p.property_type] || 'bi-house-fill' };
}

function renderListings() {
    const grid    = document.getElementById('listingsGrid');
    const infoEl  = document.getElementById('listingsInfo');
    const moreBtn = document.getElementById('loadMoreBtn');
    if (!grid) return;

    filteredListings.forEach(p => { if (p && p.id != null) LISTING_CACHE.set(String(p.id), p); });
    const slice = filteredListings.slice(0, displayedCount);

    if (slice.length === 0) {
        grid.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="bi bi-house-x-fill"></i></div>
            <h3>No properties found</h3>
            <p>Try adjusting your filters or search terms.</p>
            <button class="btn btn-outline-primary" onclick="filterByType('all')">
                <i class="bi bi-grid-fill"></i> Show All Properties
            </button>
        </div>`;
        if (infoEl) infoEl.textContent = '';
        if (moreBtn) moreBtn.style.display = 'none';
        return;
    }

    const lazyImages = [];
    grid.innerHTML = slice.map((p, i) => buildListingCard(p, i, lazyImages)).join('');

    // Swap heavy base64 covers for light canvas thumbnails after first paint
    if (lazyImages.length) {
        grid.querySelectorAll('img.listing-photo[data-lazy]').forEach(img => {
            const idx = Number(img.getAttribute('data-lazy') || '-1');
            if (idx >= 0 && lazyImages[idx]) {
                makeThumbnail(lazyImages[idx]).then(tiny => {
                    if (tiny && img.isConnected) img.src = tiny;
                });
            }
        });
    }

    if (infoEl) {
        infoEl.textContent = `Showing ${slice.length} of ${filteredListings.length} properties`;
    }
    if (moreBtn) {
        moreBtn.style.display = filteredListings.length > displayedCount ? 'inline-flex' : 'none';
    }
}

/* ── HERO SPOTLIGHT — most viewed listing ───────────────── */
function updateSpotlight() {
    const box     = document.getElementById('hero-spotlight');
    const titleEl = document.getElementById('hero-spotlight-title');
    const priceEl = document.getElementById('hero-spotlight-price');
    if (!box || !titleEl || !priceEl || !allListings?.length) return;
    const top = [...allListings].sort((a, b) => (b.views || 0) - (a.views || 0))[0];
    if (!top) return;
    titleEl.textContent = top.title || 'Featured Listing';
    const price = priceOf(top);
    priceEl.textContent = price ? '$' + Number(price).toLocaleString() : '';
    box.dataset.listingId = top.id;
    // Swap the hero photo to the listing cover — base64 covers go through
    // the lightweight thumbnail maker so the hero stays fast.
    const cover = coverImageOf(top);
    const img = document.querySelector('.hero-visual .hero-img');
    if (img && cover?.url) {
        img.alt = top.title || 'Featured property';
        makeThumbnail(cover.url, 1000).then(tiny => {
            if (tiny && img.isConnected) img.src = tiny;
        });
    }
}

function openSpotlight() {
    const id = document.getElementById('hero-spotlight')?.dataset.listingId;
    if (id) openListingById(id);
}

const PLACEHOLDER_1PX = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const HEAVY_IMG_MIN = 100 * 1024;
const thumbCache = new Map();

// Downscale a base64 data-URL image to a small JPEG so the DOM and memory stay light.
function makeThumbnail(url, maxW = 900) {
    if (!url || !url.startsWith('data:image')) return Promise.resolve(url);
    if (thumbCache.has(url)) return Promise.resolve(thumbCache.get(url));
    return new Promise(resolve => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
            try {
                const scale = Math.min(1, maxW / (img.naturalWidth || 1));
                const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
                const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                const out = cv.toDataURL('image/jpeg', 0.72);
                thumbCache.set(url, out);
                resolve(out);
            } catch (e) { resolve(url); }
        };
        img.onerror = () => resolve(url);
        img.src = url;
    });
}

/* ── VIDEO DETECTION (same rules as mobile app) ──────────── */
const VIDEO_URL_REGEX = /\.(mp4|mov|m4v|webm)(\?.*)?$/i;
function isVideoImg(img) {
    return img && img.url && (
        img.alt_text === 'video' ||
        String(img.url).startsWith('data:video') ||
        VIDEO_URL_REGEX.test(img.url)
    );
}
function coverImageOf(p) {
    return (p.property_images || []).find(img => !isVideoImg(img)) || null;
}
function videoOf(p) {
    return (p.property_images || []).find(isVideoImg) || null;
}
function videoTag(url, attrs = '') {
    return `<video src="${url}" autoplay muted loop playsinline ${attrs} style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>`;
}

// buildListingCard keeps the mover-card anatomy (rating, chips, price, action row) with a themed cover
function buildListingCard(p, index, lazyImages) {
    const badgeClass = p.status === 'available' ? '' : 'badge-soon';
    const badgeText  = p.status === 'available' ? 'Available Now' : 'Coming Soon';
    const agentName  = p.owner_name || 'Local Agent';
    const delay      = Math.min(index % 3, 3);

    const coverClass = 'cover-' + coverFor(p.id, index);

    const coverPhoto = coverImageOf(p);
    const coverUrl   = coverPhoto ? coverPhoto.url : null;

    const heavy      = Boolean(coverUrl && coverUrl.startsWith('data:image') && coverUrl.length > HEAVY_IMG_MIN);
    let lazyIdx      = -1;
    const photoSrc   = coverUrl || '';
    if (heavy && lazyImages) lazyIdx = lazyImages.push(coverUrl) - 1;
    const renderedSrc = heavy ? PLACEHOLDER_1PX : photoSrc;

    const rating     = Number(p.rating);
    const price      = priceOf(p);
    const buy        = currentPurpose === 'buy';

    return `
    <div class="listing-card reveal-up delay-${delay}" onclick="openListingById('${escapeAttr(p.id)}')">
        <div class="listing-img ${coverClass}">
            ${renderedSrc ? `<img class="listing-photo" src="${renderedSrc}" data-lazy="${lazyIdx}" alt="${(p.title || '').replace(/"/g, '&quot;')}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80'">` : ''}
            <div class="listing-badge ${badgeClass}">${badgeText}</div>
            <button class="listing-save-btn" data-save="${escapeAttr(p.id)}">
                <i class="bi bi-heart"></i>
            </button>
        </div>
        <div class="listing-body">
            <div class="listing-loc"><i class="bi bi-geo-alt-fill"></i> ${p.city}${p.suburb ? ', ' + p.suburb : ''}</div>
            <h4 class="listing-title">${p.title}</h4>
            <div class="listing-price">${price ? '$' + Number(price).toLocaleString() : ''}<span>${buy ? ' asking' : '/month'}</span></div>
            <div class="listing-rating">
                ${rating ? renderStars(rating) + ' ' + rating.toFixed(1) : ''}
                ${p.owner_name ? `<span>${agentName}</span>` : ''}
            </div>
            <div class="listing-meta">
                <span class="listing-chip"><i class="bi bi-door-open-fill"></i> ${p.bedrooms} Bed${p.bedrooms !== 1 ? 's' : ''}</span>
                <span class="listing-chip"><i class="bi bi-droplet-fill"></i> ${p.bathrooms} Bath${p.bathrooms !== 1 ? 's' : ''}</span>
                ${p.area_sqm ? `<span class="listing-chip"><i class="bi bi-arrows-fullscreen"></i> ${p.area_sqm}m²</span>` : ''}
            </div>
        </div>
        <div class="listing-footer">
            <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openListingById('${escapeAttr(p.id)}')">
                <i class="bi bi-calendar-check-fill"></i> Request View
            </button>
        </div>
    </div>`;
}

function escapeAttr(id) {
    return String(id != null ? id : '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Open a listing by id — used directly by the card + Request View button so
// the tap always works, no dependence on document-level delegation.
function openListingById(id) {
    const key = String(id != null ? id : '');
    let rec = key ? LISTING_CACHE.get(key) : null;
    if (!rec) rec = (filteredListings || []).find(x => String(x.id) === key) || null;
    if (rec) {
        openListingDetail(rec);
    } else {
        showToast('Could not open this listing.', 'error');
    }
}

// Delegated clicks keep the save (heart) button working from rendered cards.
document.addEventListener('click', e => {
    const saveEl = e.target.closest('[data-save]');
    if (saveEl) {
        e.preventDefault();
        e.stopPropagation();
        toggleSaveProperty(e, saveEl.getAttribute('data-save'));
    }
});

async function toggleSaveProperty(event, propId) {
    if (event) event.stopPropagation();
    
    if (!currentUser) {
        showToast('Please log in to save properties.', 'error');
        openModal('login-modal');
        return;
    }

    const btn = event?.currentTarget;
    const icon = btn?.querySelector('i');
    
    const client = sb();
    if (!client) return;

    // Check if already saved
    const { data: existing } = await client.from('saved_properties')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('property_id', propId)
        .single();

    if (existing) {
        // Remove
        const { error } = await client.from('saved_properties').delete().eq('user_id', currentUser.id).eq('property_id', propId);
        if (!error) {
            if (icon) icon.className = 'bi bi-heart';
            showToast('Property removed from favorites.');
        }
    } else {
        // Add
        const { error } = await client.from('saved_properties').insert({ user_id: currentUser.id, property_id: propId });
        if (!error) {
            if (icon) icon.className = 'bi bi-heart-fill text-danger';
            showToast('Property added to favorites!');
        }
    }
}

let __modalPhotos = [];
function selectListingPhoto(i) {
    const url = __modalPhotos[i];
    if (!url) return;
    const main = document.getElementById('listingModalPhoto');
    if (main) main.src = url;
    document.querySelectorAll('.modal-photo-thumbs img').forEach((el, idx) => el.classList.toggle('active', idx === i));
}

function buildDetailTiles(p) {
    const t = (icon, label) => `<div class="dscr-tile"><i class="bi ${icon}"></i><span>${label}</span></div>`;
    const parts = [];
    if (p.bedrooms != null && p.bedrooms !== '') parts.push(t('bi-door-open-fill', p.bedrooms + ' Bedroom' + (p.bedrooms !== 1 ? 's' : '')));
    if (p.bathrooms != null && p.bathrooms !== '') parts.push(t('bi-droplet-fill', p.bathrooms + ' Bathroom' + (p.bathrooms !== 1 ? 's' : '')));
    if (Number(p.parking_spots) > 0) parts.push(t('bi-car-front-fill', p.parking_spots + ' Parking Lot' + (p.parking_spots > 1 ? 's' : '')));
    if (Number(p.area_sqm) > 0) parts.push(t('bi-arrows-fullscreen', p.area_sqm + ' m²'));
    if (p.property_type) parts.push(t('bi-house-fill', capitalise(p.property_type)));
    if (p.is_furnished != null) parts.push(t('bi-lamp-fill', p.is_furnished ? 'Furnished' : 'Unfurnished'));
    if (p.pets_allowed) parts.push(t('bi-heart-fill', 'Pets OK'));
    if (p.floor_level != null && p.floor_level !== '') parts.push(t('bi-layers-fill', 'Floor ' + p.floor_level));
    return parts.length ? `<div class="dscr-tiles">${parts.join('')}</div>` : '';
}

function buildAmenityTiles(p) {
    const a = [];
    if (p.has_wifi)      a.push(['bi-wifi', 'WiFi']);
    if (p.has_pool)      a.push(['bi-water', 'Pool']);
    if (p.has_gym)       a.push(['bi-trophy-fill', 'Gym']);
    if (p.has_borehole)  a.push(['bi-droplet-fill', 'Borehole']);
    if (p.has_solar)     a.push(['bi-sun-fill', 'Solar']);
    if (p.has_security)  a.push(['bi-shield-fill-check', 'Security']);
    if (p.has_generator) a.push(['bi-lightning-fill', 'Generator']);
    if (p.has_water_tank) a.push(['bi-droplet-half', 'Water Tank']);
    if (p.has_garden)    a.push(['bi-tree-fill', 'Garden']);
    if (p.utilities_inc) a.push(['bi-plug-fill', 'Utils Incl.']);
    if (!a.length) return '';
    return `<div class="dscr-section">
        <h4 class="dscr-section-title"><i class="bi bi-stars"></i> Amenities</h4>
        <div class="dscr-tiles">${a.map(([i, l]) => `<div class="dscr-tile"><i class="bi ${i}"></i><span>${l}</span></div>`).join('')}</div>
    </div>`;
}

function buildDetailRows(p) {
    const fmtMoney = n => (n === undefined || n === null || n === '') ? '' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
    const fmtDate  = d => { if (!d) return ''; const dt = new Date(d); return isNaN(dt) ? String(d) : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };

    const row = (label, val) => {
        let v = (val === undefined || val === null) ? '' : val;
        if (typeof v === 'boolean') v = v ? 'Yes' : 'No';
        return String(v).trim() ? `<div><span>${label}</span><b>${v}</b></div>` : '';
    };

    const rows = [
        row('Deposit', p.deposit_usd !== undefined && p.deposit_usd !== null ? fmtMoney(p.deposit_usd) : ''),
        row('Utilities', p.utilities_inc === true ? 'Included' : (p.utilities_inc === false ? 'Not included' : '')),
        row('Available From', fmtDate(p.available_from)),
        row('Address', p.address),
        row('Province', p.province),
        row('Country', p.country),
        row('Listed On', fmtDate(p.created_at)),
        row('Listing Ref', p.id ? String(p.id).slice(0, 8).toUpperCase() : ''),
    ].filter(Boolean).join('');

    if (!rows) return '';
    return `
    <div class="dscr-section">
        <h4 class="dscr-section-title"><i class="bi bi-list-ul"></i> Additional Details</h4>
        <div class="dscr-more">${rows}</div>
    </div>`;
}

function openListingDetail(p) {
    // Increment view count in DB — never blocks or breaks opening the modal
    const client = sb();
    if (client && p.id && typeof p.id === 'string') {
        try {
            const res = client.rpc('increment_property_views', { prop_id: p.id });
            if (res && typeof res.then === 'function') {
                res.then(() => {}, () => {});
            }
        } catch (e) { /* ignore: counting views must never block the modal */ }
    }
    const isBuy      = currentPurpose === 'buy';
    const price      = priceOf(p);
    const photos     = (p.property_images || []).filter(i => !isVideoImg(i));
    const photoUrl   = photos.length ? photos[0].url : null;
    const photoBlock = `
        ${photoUrl ? `<img id="listingModalPhoto" src="${photoUrl}" alt="${(p.title || '').replace(/"/g, '&quot;')}">` : ''}
        ${photos.length > 1 ? `<div class="modal-photo-thumbs">
            ${photos.map((ph, i) => `<img src="${ph.url}" alt="" class="${i === 0 ? 'active' : ''}" onclick="selectListingPhoto(${i})">`).join('')}
        </div>` : ''}
    `;
    __modalPhotos = photos.map(ph => ph.url);

    const modal = document.createElement('div');
    modal.className = 'modal-overlay open';
    modal.innerHTML = `
    <div class="modal dscr-modal" style="max-width:540px" onclick="event.stopPropagation()">
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove();document.body.style.overflow=''">
            <i class="bi bi-x-lg"></i>
        </button>
        <div class="dscr-cover">
            ${photoBlock}
            <div class="dscr-loc-pill"><i class="bi bi-geo-alt-fill"></i> ${p.city}${p.suburb ? ', ' + p.suburb : ''}</div>
            <div class="dscr-status" style="background:${p.status === 'available' ? '#22c55e' : '#facc15'};color:${p.status === 'available' ? '#fff' : '#020817'}">${p.status === 'available' ? 'Available Now' : 'Coming Soon'}</div>
        </div>
        <div class="dscr-body">
            <div class="dscr-title-row">
                <h3 class="dscr-title">${p.title || 'Property'}</h3>
                <button class="dscr-heart" id="dscr-heart" onclick="event.stopPropagation();toggleSaveFromModal(this,'${p.id}')" aria-label="Save property"><i class="bi bi-heart"></i></button>
            </div>
            <div class="dscr-loc-row"><i class="bi bi-geo-alt-fill"></i> ${p.city}${p.suburb ? ', ' + p.suburb : ''}</div>
            <div class="dscr-rating" id="dscr-rating"></div>
            <div class="dscr-price-row">
                <div class="dscr-price">${price ? '$' + Number(price).toLocaleString() : ''}<span>${isBuy ? ' asking' : '/month'}</span></div>
                ${p.listing_purpose ? `<span class="dscr-purpose">${capitalise(p.listing_purpose)}</span>` : ''}
            </div>
            <div class="dscr-section">
                <h4 class="dscr-section-title"><i class="bi bi-card-text"></i> Descriptions</h4>
                <p class="dscr-desc" id="dscr-desc">${p.description || 'No description provided.'}</p>
                <button class="dscr-readmore" onclick="toggleDscrDesc(this)">Read More</button>
            </div>
            <div class="dscr-section">
                <h4 class="dscr-section-title"><i class="bi bi-list-ul"></i> Property Details</h4>
                ${buildDetailTiles(p)}
            </div>
            ${buildAmenityTiles(p)}
            ${buildDetailRows(p)}
            ${p.owner_name ? `<div class="dscr-section" style="border-top:1px solid var(--border);padding-top:1rem">
                <h4 class="dscr-section-title"><i class="bi bi-person-badge-fill"></i> Agent</h4>
                <div style="display:flex;align-items:center;gap:.65rem">
                    <div style="width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0"><i class="bi bi-person-fill" style="font-size:1.1rem"></i></div>
                    <div>
                        <div style="font-weight:700;color:var(--navy)">${p.owner_name}</div>
                        <div style="font-size:.78rem;color:var(--muted);display:flex;align-items:center;gap:.3rem">Verified <i class="bi bi-patch-check-fill" style="color:#22c55e" title="Verified"></i></div>
                    </div>
                </div>
            </div>` : ''}
        </div>
        <div class="dscr-footer">
            <div>
                <div class="dscr-footer-price-label">${isBuy ? 'Asking price' : 'Rent per month'}</div>
                <div class="dscr-footer-price">${price ? '$' + Number(price).toLocaleString() : ''}</div>
            </div>
            <div class="dscr-footer-btn-row">
                <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove();openMessagesModal('${p.owner_id}', '${(p.owner_name || 'Agent').replace(/'/g, "\\'")}')">
                    <i class="bi bi-chat-dots-fill"></i> Message Agent
                </button>
                <button class="btn btn-success" onclick="contactViaWhatsApp('${p.owner_phone || ''}', 'Hi, I am interested in your property: ${p.title.replace(/'/g, "\\'")} on Hlala Link.');this.closest('.modal-overlay').remove();document.body.style.overflow=''">
                    <i class="bi bi-whatsapp"></i> WhatsApp
                </button>
            </div>
        </div>
    </div>`;
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); document.body.style.overflow = ''; } });
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    if (p.id) { initModalFav(p.id); loadListingRating(p.id); }
}

function toggleDscrDesc(btn) {
    const desc = document.getElementById('dscr-desc');
    if (!desc) return;
    const full = desc.classList.toggle('dscr-desc-full');
    btn.textContent = full ? 'Show less' : 'Read More';
}

async function initModalFav(propId) {
    if (!currentUser || !propId) return;
    const client = sb();
    if (!client) return;
    try {
        const { data } = await client.from('saved_properties').select('*').eq('user_id', currentUser.id).eq('property_id', propId).single();
        const btn = document.getElementById('dscr-heart');
        if (btn && data) {
            btn.classList.add('saved');
            const icon = btn.querySelector('i');
            if (icon) icon.className = 'bi bi-heart-fill';
        }
    } catch (e) { /* ignore */ }
}

async function toggleSaveFromModal(btn, propId) {
    if (!currentUser) {
        showToast('Please log in to save properties.', 'error');
        openModal('login-modal');
        return;
    }
    const icon = btn.querySelector('i');
    const client = sb();
    if (!client) return;

    const { data: existing } = await client.from('saved_properties')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('property_id', propId)
        .single();

    if (existing) {
        const { error } = await client.from('saved_properties').delete().eq('user_id', currentUser.id).eq('property_id', propId);
        if (!error) {
            btn.classList.remove('saved');
            if (icon) icon.className = 'bi bi-heart';
            showToast('Property removed from favorites.');
        }
    } else {
        const { error } = await client.from('saved_properties').insert({ user_id: currentUser.id, property_id: propId });
        if (!error) {
            btn.classList.add('saved');
            if (icon) icon.className = 'bi bi-heart-fill';
            showToast('Property added to favorites!');
        }
    }
}

async function loadListingRating(propId) {
    const client = sb();
    const el = document.getElementById('dscr-rating');
    if (!client || !el) return;
    try {
        const { data, error } = await client.from('reviews').select('rating').eq('property_id', propId);
        if (!error && data && data.length > 0) {
            const avg = (data.reduce((a, r) => a + (Number(r.rating) || 0), 0) / data.length).toFixed(1);
            el.innerHTML = `<i class="bi bi-star-fill"></i> ${avg} <span style="color:var(--muted);font-weight:500;letter-spacing:0">(${data.length} reviews)</span>`;
            el.style.display = 'flex';
        }
    } catch (e) { /* ignore */ }
}

function buildAmenitiesRow(p) {
    const items = [];
    if (p.has_wifi)      items.push('<span><i class="bi bi-wifi"></i> WiFi</span>');
    if (p.has_pool)      items.push('<span><i class="bi bi-water"></i> Pool</span>');
    if (p.has_gym)       items.push('<span><i class="bi bi-trophy-fill"></i> Gym</span>');
    if (p.has_borehole)  items.push('<span><i class="bi bi-droplet-fill"></i> Borehole</span>');
    if (p.has_solar)     items.push('<span><i class="bi bi-sun-fill"></i> Solar</span>');
    if (p.has_security)  items.push('<span><i class="bi bi-shield-fill-check"></i> Security</span>');
    if (p.has_generator) items.push('<span><i class="bi bi-lightning-fill"></i> Generator</span>');
    if (p.has_water_tank) items.push('<span><i class="bi bi-droplet-half"></i> Water Tank</span>');
    if (p.has_garden)    items.push('<span><i class="bi bi-tree-fill"></i> Garden</span>');
    if (p.utilities_inc) items.push('<span><i class="bi bi-plug-fill"></i> Utils. Incl.</span>');
    if (p.parking_spots) items.push(`<span><i class="bi bi-car-front-fill"></i> ${p.parking_spots} Parking Spot${p.parking_spots > 1 ? 's' : ''}</span>`);
    if (!items.length) return '';
    return `<div class="listing-meta" style="margin-bottom:1.25rem;flex-wrap:wrap;gap:.6rem">${items.join('')}</div>`;
}

async function handleApply(propId, propTitle) {
    if (!currentUser) {
        showToast('Please log in to apply for a property.', 'error');
        openModal('login-modal');
        return;
    }
    const client = sb();
    if (!client || typeof propId !== 'string') {
        showToast(`Application submitted for "${propTitle}"! We'll be in touch.`);
        return;
    }
    const { error } = await client.from('applications').insert({
        property_id:  propId,
        applicant_id: currentUser.id,
        status:       'pending',
    });
    if (error && error.code === '23505') {
        showToast('You have already applied for this property.', 'error');
    } else if (error) {
        showToast('Application sent! We will review it shortly.');
    } else {
        showToast(`Application submitted for "${propTitle}"! We'll review and get back to you.`);
    }
}

async function handleEnquire(propId, propTitle) {
    if (!currentUser) {
        showToast('Please log in to send an enquiry.', 'error');
        openModal('login-modal');
        return;
    }
    showToast(`Enquiry sent for "${propTitle}"! The agent will respond within 24 hours.`);
}

function loadMoreListings() {
    displayedCount += PAGE_SIZE;
    renderListings();
    initScrollReveal();
}

/* ── FILTER SYSTEM ───────────────────────────────────────── */
function filterByType(type) {
    currentTypeFilter = type;
    applyListingFilters();
    setActivePill('filter-pills', 'data-filter', type);
    document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' });
}

function filterByCity(city) {
    currentCityFilter = city;
    applyListingFilters();
    document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' });
}

function setPurpose(purpose) {
    currentPurpose = purpose === 'buy' ? 'buy' : 'rent';
    document.getElementById('purposeRent')?.classList.toggle('active', currentPurpose === 'rent');
    document.getElementById('purposeBuy')?.classList.toggle('active', currentPurpose === 'buy');
    const title = document.getElementById('listingsTitle');
    const sub   = document.getElementById('listingsSub');
    if (title) title.textContent = currentPurpose === 'buy' ? 'Homes for Sale in Zimbabwe' : 'Rentals in Zimbabwe';
    if (sub) sub.textContent = currentPurpose === 'buy'
        ? 'Houses, stands and apartments on the market from agents and owners across the country.'
        : 'Houses, flats, cottages and rooms currently available from agents and landlords.';
    applyListingFilters();
}



function filterByPriceRange(min, max) {
    filteredListings = allListings.filter(p => {
        const price = priceOf(p);
        return price >= min && price <= max;
    });
    if (currentTypeFilter !== 'all') {
        filteredListings = filteredListings.filter(p => p.property_type === currentTypeFilter);
    }
    displayedCount = PAGE_SIZE;
    renderListings();
    initScrollReveal();
    document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' });
}

function applyListingFilters() {
    const q = currentSearchQuery.toLowerCase();
    filteredListings = allListings.filter(p => {
        const typeOK = currentTypeFilter === 'all' || p.property_type === currentTypeFilter;
        const cityOK = currentCityFilter === 'all' || (p.city && p.city.toLowerCase().includes(currentCityFilter.toLowerCase()));

        const purpose = p.listing_purpose || 'rent';
        const purposeOK = currentPurpose === 'buy'
            ? (purpose === 'sale' || purpose === 'both')
            : (purpose === 'rent' || purpose === 'both');
        
        let searchOK = true;
        if (q) {
            searchOK = (p.title && p.title.toLowerCase().includes(q)) ||
                       (p.city && p.city.toLowerCase().includes(q)) ||
                       (p.suburb && p.suburb.toLowerCase().includes(q)) ||
                       (p.description && p.description.toLowerCase().includes(q)) ||
                       (p.property_type && p.property_type.toLowerCase().includes(q));
        }
        
        return typeOK && cityOK && searchOK && purposeOK;
    });
    displayedCount = PAGE_SIZE;
    renderListings();
    initScrollReveal();
}

function handleSort(value) {
    const arr = [...filteredListings];
    switch (value) {
        case 'price_asc':  arr.sort((a, b) => priceOf(a) - priceOf(b)); break;
        case 'price_desc': arr.sort((a, b) => priceOf(b) - priceOf(a)); break;
        case 'popular':    arr.sort((a, b) => (b.views || 0) - (a.views || 0)); break;
        case 'newest':     arr.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); break;
        default:           break;
    }
    filteredListings = arr;
    renderListings();
    initScrollReveal();
}

function handleSearch() {
    const query = document.getElementById('heroSearch')?.value.trim();
    const type  = document.getElementById('searchType')?.value;
    const city  = document.getElementById('searchCity')?.value;
    
    currentSearchQuery = query;
    if (type) currentTypeFilter = type;
    if (city) currentCityFilter = city === 'All Locations' ? 'all' : city;

    saveRecentSearch(query);
    hideSuggestions();

    applyListingFilters();
    
    // Smooth scroll to results
    document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' });
    
    // Update active pills if any match
    if (type) setActivePill('filter-pills', 'data-filter', type);
}

function setActivePill(containerId, attr, value) {
    document.querySelectorAll(`#${containerId} .filter-pill`).forEach(pill => {
        pill.classList.toggle('active', pill.getAttribute(attr) === value);
    });
}

/* ── SEARCH RECENTS + AUTOCOMPLETE / AUTO-SUGGEST ─────────── */
const RECENT_SEARCH_KEY = 'hlala_recent_searches';
const MAX_RECENTS = 6;
let sugActiveIndex = -1;

function getRecentSearches() {
    try {
        const raw = localStorage.getItem(RECENT_SEARCH_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

const DEFAULT_RECENTS = ['Harare apartment', 'Borrowdale house', 'Movers in Bulawayo'];
function seedRecentSearches() {
    if (getRecentSearches().length === 0) {
        try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(DEFAULT_RECENTS)); } catch {}
    }
}

function saveRecentSearch(query) {
    const q = (query || '').trim();
    if (!q) return;
    let recents = getRecentSearches().filter(r => r.toLowerCase() !== q.toLowerCase());
    recents.unshift(q);
    recents = recents.slice(0, MAX_RECENTS);
    try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(recents)); } catch {}
}

function clearRecentSearch(query) {
    const recents = getRecentSearches().filter(r => r !== query);
    try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(recents)); } catch {}
    renderSuggestions(document.getElementById('heroSearch')?.value || '');
}

function buildSuggestionPool() {
    const pool = new Map();
    const add = (title, sub, type, icon) => {
        const key = title.toLowerCase();
        if (!pool.has(key)) pool.set(key, { title, sub, type, icon });
    };
    (allListings && allListings.length ? allListings : STATIC_LISTINGS).forEach(p => {
        if (p.title)  add(p.title, `${p.suburb || ''}${p.suburb ? ' · ' : ''}${p.city || ''}`.trim(), 'listing', 'bi-house');
        if (p.city)   add(p.city, 'City', 'city', 'bi-geo-alt');
        if (p.suburb) add(p.suburb, 'Suburb', 'suburb', 'bi-pin-map');
    });
    (allMovers && allMovers.length ? allMovers : STATIC_MOVERS).forEach(m => {
        if (m.company_name) add(m.company_name, 'Mover', 'mover', 'bi-truck');
    });
    return [...pool.values()];
}

function renderSuggestions(query) {
    const box = document.getElementById('searchSuggestions');
    if (!box) return;
    const q = (query || '').trim().toLowerCase();
    sugActiveIndex = -1;

    let html = '';
    const pool = buildSuggestionPool();

    if (!q) {
        const recents = getRecentSearches().slice(0, 3);
        if (recents.length) {
            html += `<div class="sug-section-label">Recent Searches</div>`;
            recents.forEach(r => {
                html += `<div class="sug-item" data-value="${escapeHtml(r)}" data-recent="1">
                    <div class="sug-icon"><i class="bi bi-clock-history"></i></div>
                    <div class="sug-text"><div class="sug-title">${escapeHtml(r)}</div></div>
                    <div class="sug-clear" data-clear="${escapeHtml(r)}" title="Remove"><i class="bi bi-x-lg"></i></div>
                </div>`;
            });
        } else {
            html += `<div class="sug-item"><div class="sug-icon"><i class="bi bi-search"></i></div>
                <div class="sug-text"><div class="sug-title">Try "Harare apartment"</div>
                <div class="sug-sub">Search properties, suburbs or movers</div></div></div>`;
        }
        box.innerHTML = html;
        box.hidden = false;
        return;
    }

    const matches = pool.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.sub.toLowerCase().includes(q)
    ).slice(0, 6);

    const recentHits = getRecentSearches().slice(0, 3);
    if (recentHits.length) {
        html += `<div class="sug-section-label">Recent Searches</div>`;
        recentHits.forEach(r => {
            html += `<div class="sug-item" data-value="${escapeHtml(r)}" data-recent="1">
                <div class="sug-icon"><i class="bi bi-clock-history"></i></div>
                <div class="sug-text"><div class="sug-title">${highlight(r, q)}</div></div>
                <div class="sug-clear" data-clear="${escapeHtml(r)}" title="Remove"><i class="bi bi-x-lg"></i></div>
            </div>`;
        });
    }

    if (matches.length) {
        html += `<div class="sug-section-label">Suggestions</div>`;
        matches.forEach(m => {
            const hl = m.title.replace(new RegExp(`(${escapeRegExp(q)})`, 'ig'), '<mark>$1</mark>');
            html += `<div class="sug-item" data-value="${escapeHtml(m.title)}">
                <div class="sug-icon"><i class="bi ${m.icon}"></i></div>
                <div class="sug-text"><div class="sug-title">${hl}</div>
                <div class="sug-sub">${escapeHtml(m.sub)}</div></div>
            </div>`;
        });
    }

    if (!html) {
        html = `<div class="sug-item" data-value="${escapeHtml(query)}">
            <div class="sug-icon"><i class="bi bi-search"></i></div>
            <div class="sug-text"><div class="sug-title">Search for "${escapeHtml(query)}"</div>
            <div class="sug-sub">Press Enter to see all results</div></div></div>`;
    }

    box.innerHTML = html;
    box.hidden = false;
}

function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function highlight(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    try {
        return safe.replace(new RegExp(`(${escapeRegExp(escapeHtml(q))})`, 'ig'), '<mark>$1</mark>');
    } catch { return safe; }
}

function showSuggestions() { renderSuggestions(document.getElementById('heroSearch')?.value || ''); }
function hideSuggestions() {
    const box = document.getElementById('searchSuggestions');
    if (box) box.hidden = true;
}

let liveSearchTimer = null;
function liveSearch() {
    const input = document.getElementById('heroSearch');
    const q = input ? input.value.trim() : '';
    clearTimeout(liveSearchTimer);
    liveSearchTimer = setTimeout(() => {
        currentSearchQuery = q;
        applyListingFilters();
    }, 120);
}

function selectSuggestion(value) {
    const input = document.getElementById('heroSearch');
    if (input && value != null) input.value = value;
    hideSuggestions();
    handleSearch();
}

function initSearchAutocomplete() {
    const input = document.getElementById('heroSearch');
    const box   = document.getElementById('searchSuggestions');
    if (!input || !box) return;

    seedRecentSearches();

    input.addEventListener('input', () => {
        showSuggestions();
        liveSearch();
    });
    input.addEventListener('focus', () => showSuggestions());

    input.addEventListener('keydown', e => {
        const items = [...box.querySelectorAll('.sug-item')];
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            sugActiveIndex = Math.min(sugActiveIndex + 1, items.length - 1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            sugActiveIndex = Math.max(sugActiveIndex - 1, 0);
        } else if (e.key === 'Enter') {
            if (sugActiveIndex >= 0 && items[sugActiveIndex]) {
                e.preventDefault();
                selectSuggestion(items[sugActiveIndex].getAttribute('data-value'));
                return;
            }
            hideSuggestions();
            return;
        } else if (e.key === 'Escape') {
            hideSuggestions();
            return;
        }
        items.forEach((it, i) => it.classList.toggle('active', i === sugActiveIndex));
        if (sugActiveIndex >= 0) input.value = items[sugActiveIndex].getAttribute('data-value');
    });

    box.addEventListener('mousedown', e => {
        const clear = e.target.closest('[data-clear]');
        if (clear) { e.preventDefault(); clearRecentSearch(clear.getAttribute('data-clear')); return; }
        const item = e.target.closest('.sug-item');
        if (item) { e.preventDefault(); selectSuggestion(item.getAttribute('data-value')); }
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.search-wrapper')) hideSuggestions();
    });
}

function showListingsLoading(show) {
    const skeleton = document.getElementById('listings-loading');
    const grid     = document.getElementById('listingsGrid');
    if (skeleton) skeleton.style.display = show ? 'grid' : 'none';
    if (grid)     grid.style.display     = show ? 'none' : 'grid';
}

/* ── LIST PROPERTY (Agent/Landlord uploads) ─────────────── */
function openListPropertyModal() {
    if (!currentUser) {
        showToast('Please log in as an agent or landlord to list a property.', 'error');
        openModal('login-modal');
        return;
    }
    if (currentProfile && !['landlord', 'agent'].includes(currentProfile.role)) {
        showToast('Only landlords and agents can list properties.', 'error');
        return;
    }
    openModal('list-property-modal');
}

async function handleListProperty(e) {
    e.preventDefault();
    const btn   = document.getElementById('listPropBtn');
    const errEl = document.getElementById('list-prop-error');

    const payload = {
        owner_id:      currentUser?.id,
        title:         document.getElementById('prop-title').value.trim(),
        property_type: document.getElementById('prop-type').value,
        rent_usd:      parseFloat(document.getElementById('prop-rent').value),
        deposit_usd:   parseFloat(document.getElementById('prop-deposit').value) || null,
        bedrooms:      parseInt(document.getElementById('prop-beds').value),
        bathrooms:     parseInt(document.getElementById('prop-baths').value),
        area_sqm:      parseFloat(document.getElementById('prop-area').value) || null,
        available_from: document.getElementById('prop-available').value || null,
        address:       document.getElementById('prop-address').value.trim(),
        suburb:        document.getElementById('prop-suburb').value.trim() || null,
        city:          document.getElementById('prop-city').value,
        country:       'Zimbabwe',
        description:   document.getElementById('prop-desc').value.trim() || null,
        status:        'available',
        has_wifi:      document.getElementById('amen-wifi').checked,
        has_pool:      document.getElementById('amen-pool').checked,
        has_gym:       document.getElementById('amen-gym').checked,
        has_borehole:  document.getElementById('amen-borehole').checked,
        has_solar:     document.getElementById('amen-solar').checked,
        has_security:  document.getElementById('amen-security').checked,
        has_generator: document.getElementById('amen-generator').checked,
        parking_spots: document.getElementById('amen-parking').checked ? 1 : 0,
        is_furnished:  document.getElementById('amen-furnished').checked,
        pets_allowed:  document.getElementById('amen-pets').checked,
        utilities_inc: document.getElementById('amen-utilities').checked,
    };

    if (!payload.owner_id) {
        errEl.textContent = '⚠ You must be logged in to list a property.';
        return;
    }

    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Publishing…';
    btn.disabled  = true;
    errEl.textContent = '';

    const client = sb();
    if (!client) {
        setTimeout(() => {
            closeModal('list-property-modal');
            showToast(`"${payload.title}" listed successfully! It will appear after review.`);
            document.getElementById('list-property-form').reset();
            btn.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Publish Listing';
            btn.disabled  = false;
        }, 1200);
        return;
    }

    const { data, error } = await client.from('properties').insert([payload]).select().single();
    btn.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Publish Listing';
    btn.disabled  = false;

    if (error) {
        errEl.textContent = '⚠ ' + (error.message || 'Failed to publish. Please try again.');
    } else {
        closeModal('list-property-modal');
        document.getElementById('list-property-form').reset();
        showToast(`"${payload.title}" has been listed! It will go live after verification.`);
        // Prepend to local listings
        const normalized = normalizeProperty({ ...data, owner_name: currentProfile?.first_name + ' ' + currentProfile?.last_name });
        allListings.unshift(normalized);
        filteredListings = [...allListings];
        renderListings();
        initScrollReveal();
    }
}

/* ============================
   3. MARKETPLACE — MOVERS
   ============================ */

async function initMovers() {
    showMoversLoading(true);
    const client = sb();

    if (client) {
        try {
            // 1) Mobile parity: movers live in `profiles` (role = 'mover') —
            // the exact source the mobile app lists, chats with, and books.
            const { data: profileMovers, error: profileError } = await client
                .from('profiles')
                .select('id, first_name, last_name, avatar_url, city, phone_number, business_name, bio, vehicle_details, vehicle_photos, average_rating, review_count')
                .eq('role', 'mover')
                .order('created_at', { ascending: false })
                .limit(50);

            if (!profileError && profileMovers && profileMovers.length > 0) {
                allMovers = profileMovers.map(normalizeProfileMover);
            } else {
                // 2) Legacy: dedicated movers table / live view
                const { data: viewData, error: viewError } = await client
                    .from('v_active_movers')
                    .select('*')
                    .order('rating', { ascending: false })
                    .limit(50);

                let realMovers = [];
                if (!viewError && viewData && viewData.length > 0) {
                    realMovers = viewData;
                } else {
                    // 3) Fallback: query the table directly for active movers
                    const { data: tableData, error: tableError } = await client
                        .from('movers')
                        .select('*')
                        .eq('is_active', true)
                        .order('rating', { ascending: false })
                        .limit(50);
                    if (!tableError && tableData && tableData.length > 0) {
                        realMovers = tableData;
                    }
                }

                if (realMovers.length > 0) {
                    allMovers = realMovers.map(normalizeMover);
                } else {
                    allMovers = STATIC_MOVERS;
                }
            }
        } catch (err) {
            allMovers = STATIC_MOVERS;
        }
    } else {
        allMovers = STATIC_MOVERS;
    }

    filteredMovers = [...allMovers];
    renderMovers();
    showMoversLoading(false);
}

// Normalize a `profiles` mover row (mobile parity) into the card shape the
// site renders. id/owner_id stay as the PROFILE id so Message buttons open
// a real chat and bookings resolve exactly like mobile.
function normalizeProfileMover(p) {
    const vd = p.vehicle_details && typeof p.vehicle_details === 'object' ? p.vehicle_details : {};
    const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    return {
        ...p,
        id: p.id,
        owner_id: p.id,
        company_name: p.business_name || fullName || 'Professional Mover',
        contact_name: fullName || null,
        city: p.city || 'Harare',
        service_areas: p.city ? [p.city] : [],
        vehicle_types: vd.type ? [vd.type] : [],
        base_price_usd: vd.base_price ?? vd.price ?? null,
        phone: p.phone_number || '',
        rating: Number(p.average_rating || 0),
        total_reviews: p.review_count || 0,
        total_jobs: 0,
        is_verified: false,
        description: p.bio || '',
        bi_icon: 'bi-truck-front-fill',
    };
}

function normalizeMover(m) {
    const iconMap = { Harare: 'bi-truck-front-fill', Bulawayo: 'bi-box-seam-fill', National: 'bi-buildings-fill' };
    return { ...m, bi_icon: iconMap[m.city] || 'bi-truck-front-fill' };
}

function renderMovers() {
    const grid = document.getElementById('moversGrid');
    if (!grid) return;

    if (filteredMovers.length === 0) {
        grid.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i class="bi bi-truck-front-fill"></i></div>
            <h3>No movers found in this area</h3>
            <p>Try selecting a different city or view all movers.</p>
            <button class="btn btn-outline-primary" onclick="filterMoversByCity('all')">
                <i class="bi bi-geo-fill"></i> Show All Movers
            </button>
        </div>`;
        return;
    }

    grid.innerHTML = filteredMovers.map((m, i) => buildMoverCard(m, i)).join('');
}

function buildMoverCard(m, index) {
    const stars    = renderStars(m.rating);
    const delay    = Math.min(index % 3, 3);
    const areas    = (m.service_areas || []).slice(0, 3).map(a => `<span class="area-tag">${a}</span>`).join('');

    return `
    <div class="mover-card reveal-up delay-${delay}">
        <div class="mover-avatar">${m.avatar_url ? `<img src="${m.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : `<i class="bi ${m.bi_icon || 'bi-truck-front-fill'}"></i>`}</div>
        ${m.is_verified ? '<div class="verified-badge"><i class="bi bi-patch-check-fill"></i> Verified</div>' : ''}
        <h4>${m.company_name}</h4>
        <p class="mover-location"><i class="bi bi-geo-alt-fill"></i> ${m.city}</p>
        <div class="mover-rating">${stars} ${Number(m.rating).toFixed(1)} <span>(${m.total_reviews || 0} reviews, ${m.total_jobs || 0} jobs)</span></div>
        ${areas ? `<div class="mover-areas">${areas}</div>` : ''}
        ${m.base_price_usd != null ? `<div class="mover-price">From $${Number(m.base_price_usd).toLocaleString()}/move</div>` : ''}
        <div style="display:flex;gap:.5rem;width:100%;margin-top:.5rem">
            <button class="btn btn-primary btn-sm" style="flex:1" onclick="openBookingModal('${m.id}','${m.company_name.replace(/'/g, "\\'")}','${m.phone || ''}')">
                <i class="bi bi-calendar-check-fill"></i> Book
            </button>
            <button class="btn btn-outline-primary btn-sm" style="flex:1" onclick="openMessagesModal('${m.owner_id || ''}', '${m.company_name.replace(/'/g, "\\'")}')">
                <i class="bi bi-chat-dots-fill"></i> Message
            </button>
        </div>
    </div>`;
}

function renderStars(rating) {
    const full  = Math.floor(rating);
    const half  = rating % 1 >= 0.5;
    let html    = '';
    for (let i = 0; i < full; i++)  html += '<i class="bi bi-star-fill text-warning"></i>';
    if (half)                         html += '<i class="bi bi-star-half text-warning"></i>';
    return html;
}

function filterMovers(type) {
    // service type filtering (future: match vehicle_types / description)
    filteredMovers = allMovers;
    if (type === 'local') filteredMovers = allMovers.filter(m => (m.service_areas || []).length <= 2);
    else if (type === 'longdistance') filteredMovers = allMovers.filter(m => (m.service_areas || []).length > 2);
    renderMovers();
    initScrollReveal();
}

function filterMoversByCity(city) {
    currentMoverCityFilter = city;
    if (city === 'all') {
        filteredMovers = [...allMovers];
    } else {
        filteredMovers = allMovers.filter(m =>
            m.city?.toLowerCase().includes(city.toLowerCase()) ||
            (m.service_areas || []).some(a => a.toLowerCase().includes(city.toLowerCase()))
        );
    }
    setActivePill('mover-filter-pills', 'data-city', city);
    renderMovers();
    initScrollReveal();
}

function showMoversLoading(show) {
    const skeleton = document.getElementById('movers-loading');
    const grid     = document.getElementById('moversGrid');
    if (skeleton) skeleton.style.display = show ? 'grid' : 'none';
    if (grid)     grid.style.display     = show ? 'none' : 'grid';
}

/* ── MOVER BOOKING ───────────────────────────────────────── */
function openBookingModal(moverId, moverName, moverPhone) {
    document.getElementById('book-mover-id').value    = moverId;
    document.getElementById('book-mover-title').textContent = `Book ${moverName}`;
    document.getElementById('book-mover-sub').textContent   = `Complete the form and ${moverName} will confirm your booking.`;
    // Pre-fill user phone if logged in
    if (currentProfile?.phone_number) {
        document.getElementById('book-phone').value = currentProfile.phone_number;
    }
    // Set min date to today
    document.getElementById('book-date').min = new Date().toISOString().split('T')[0];
    openModal('book-mover-modal');
}

async function handleMoverBooking(e) {
    e.preventDefault();
    const btn    = document.getElementById('bookMoverBtn');
    const errEl  = document.getElementById('book-mover-error');
    const mId    = document.getElementById('book-mover-id').value;

    if (!currentUser) {
        errEl.textContent = '⚠ Please log in to book a mover.';
        return;
    }

    const payload = {
        mover_id:       mId || null,
        client_id:      currentUser.id,
        status:         'pending',
        moving_date:    document.getElementById('book-date').value,
        pickup_address: document.getElementById('book-pickup').value.trim(),
        drop_address:   document.getElementById('book-dropoff').value.trim(),
        notes:          document.getElementById('book-notes').value.trim() || null,
    };

    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Submitting…';
    btn.disabled  = true;
    errEl.textContent = '';

    const client = sb();
    if (!client || !mId || mId.length < 10) {
        setTimeout(() => {
            closeModal('book-mover-modal');
            document.getElementById('book-mover-form').reset();
            showToast('Booking request sent! The mover will contact you to confirm.');
            btn.innerHTML = '<i class="bi bi-send-fill"></i> Confirm Booking Request';
            btn.disabled  = false;
        }, 1000);
        return;
    }

    const doneOk = () => {
        closeModal('book-mover-modal');
        document.getElementById('book-mover-form').reset();
        showToast('Booking request sent! The mover will contact you within 2 hours.');
    };
    const doneErr = (msg) => {
        errEl.textContent = '⚠ ' + msg;
        btn.innerHTML = '<i class="bi bi-send-fill"></i> Confirm Booking Request';
        btn.disabled  = false;
    };

    // Mobile parity: resolve any mover identifier (profiles.id from the new
    // listing source, or legacy movers.id) to a real `movers.id`, because
    // `mover_bookings.mover_id` has a foreign key to `movers(id)`.
    let resolvedId = mId;
    try {
        const direct = await client.from('movers').select('id').eq('id', mId).maybeSingle();
        if (!direct.data?.id) {
            const linked = await client.from('movers').select('id').or(`profile_id.eq.${mId},owner_id.eq.${mId}`).maybeSingle();
            if (linked.data?.id) resolvedId = linked.data.id;
        }
    } catch (_) {}

    const jobDetails = {
        pickup_address: document.getElementById('book-pickup').value.trim(),
        drop_address: document.getElementById('book-dropoff').value.trim(),
        moving_date: document.getElementById('book-date').value || null,
        items_description: document.getElementById('book-notes').value.trim() || null,
        notes: document.getElementById('book-notes').value.trim() || null,
    };

    // 1) Server-side RPC first (mobile parity — auto-provisions a missing
    //    movers row when the hardened RPC is deployed).
    const { error: rpcError } = await client.rpc('create_mover_booking', {
        requester_id: currentUser.id,
        mover_id: resolvedId,
        job_details: jobDetails,
    });
    if (!rpcError) {
        btn.innerHTML = '<i class="bi bi-send-fill"></i> Confirm Booking Request';
        btn.disabled  = false;
        doneOk();
        return;
    }
    // 2) No RPC on this backend yet → legacy direct insert (needs a real
    //    movers row, which we resolved above).
    if (!/does not exist|could not find|not found|pgrst|404/i.test(rpcError.message || '')) {
        // Genuine booking error (e.g. mover has no booking profile yet) —
        // say so plainly instead of leaking constraint text.
        if (/mover_bookings_mover_id_fkey|foreign key/i.test(rpcError.message || '')) {
            doneErr('This mover is still setting up bookings. Please try another mover.');
        } else {
            doneErr(rpcError.message || 'Booking failed. Please try again.');
        }
        return;
    }
    const { error } = await client.from('mover_bookings').insert([{
        mover_id: resolvedId,
        client_id: currentUser.id,
        status: 'pending',
        moving_date: document.getElementById('book-date').value || null,
        pickup_address: jobDetails.pickup_address,
        drop_address: jobDetails.drop_address,
        items_description: jobDetails.items_description,
        notes: jobDetails.notes,
    }]);
    btn.innerHTML = '<i class="bi bi-send-fill"></i> Confirm Booking Request';
    btn.disabled  = false;

    if (error) {
        if (/mover_bookings_mover_id_fkey|foreign key/i.test(error.message || '')) {
            doneErr('This mover is still setting up bookings. Please try another mover.');
        } else {
            doneErr(error.message || 'Booking failed. Please try again.');
        }
    } else {
        doneOk();
    }
}

/* ── MOVER JOIN ──────────────────────────────────────────── */
function openMoverJoinModal() {
    if (!currentUser) {
        showToast('Please log in as a mover to list your company.', 'error');
        openModal('login-modal');
        return;
    }
    openModal('mover-join-modal');
}

async function handleMoverJoin(e) {
    e.preventDefault();
    const btn   = document.getElementById('moverJoinBtn');
    const errEl = document.getElementById('mover-join-error');

    const vehicles = [];
    if (document.getElementById('veh-bakkie').checked) vehicles.push('bakkie');
    if (document.getElementById('veh-van').checked)    vehicles.push('van');
    if (document.getElementById('veh-truck').checked)  vehicles.push('truck');
    if (document.getElementById('veh-trailer').checked) vehicles.push('trailer');

    const payload = {
        owner_id:       currentUser?.id,
        company_name:   document.getElementById('mover-company').value.trim(),
        city:           document.getElementById('mover-city').value,
        base_price_usd: parseFloat(document.getElementById('mover-price').value),
        phone:          document.getElementById('mover-phone').value.trim(),
        whatsapp:       document.getElementById('mover-whatsapp').value.trim() || null,
        email:          document.getElementById('mover-email').value.trim() || null,
        description:    document.getElementById('mover-desc').value.trim() || null,
        vehicle_types:  vehicles,
        service_areas:  [document.getElementById('mover-city').value],
        is_active:      true,
    };

    if (!payload.owner_id) { errEl.textContent = '⚠ Must be logged in.'; return; }

    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Submitting…';
    btn.disabled  = true;
    errEl.textContent = '';

    const client = sb();
    if (!client) {
        setTimeout(() => {
            closeModal('mover-join-modal');
            document.getElementById('mover-join-form').reset();
            showToast(`"${payload.company_name}" submitted! You'll be listed after review.`);
            btn.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Submit Company Profile';
            btn.disabled  = false;
        }, 1200);
        return;
    }

    const { data, error } = await client.from('movers').insert([payload]).select().single();
    btn.innerHTML = '<i class="bi bi-cloud-upload-fill"></i> Submit Company Profile';
    btn.disabled  = false;

    if (error) {
        errEl.textContent = '⚠ ' + (error.message || 'Submission failed. Please try again.');
    } else {
        closeModal('mover-join-modal');
        document.getElementById('mover-join-form').reset();
        showToast(`"${payload.company_name}" submitted! It will appear after verification.`);
        allMovers.unshift(normalizeMover(data));
        filteredMovers = [...allMovers];
        renderMovers();
        initScrollReveal();
    }
}

/* ============================
   4. CONTACT FORM → DB + TEAM AUTO-ALERT
   ============================ */

// Team inbox: every contact message notifies these people automatically.
const CONTACT_TEAM_EMAILS = [
    'radasservices@gmail.com',
    'ndlovugodswills@gmail.com',
    'munasheantonio1@gmail.com',
];
// Support WhatsApp lines — one is picked at random (shuffle) per message.
const SUPPORT_WHATSAPP_LINES = ['0788118836', '0771179613'];

function shufflePick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}
function toIntlZW(num) {
    const d = String(num || '').replace(/\D/g, '');
    if (d.startsWith('263')) return d;
    if (d.startsWith('0'))   return '263' + d.slice(1);
    return d;
}

// Fire-and-forget: notifies the team in the background.
// Never redirects, never blocks the UI, never throws.
async function alertContactTeam(submission) {
    const client = sb();

    // 1. Fetch the team members' numbers (and ids) from the DB.
    let team = [];
    try {
        if (client) {
            const { data, error } = await client.from('profiles')
                .select('id, first_name, last_name, email, phone_number, push_token')
                .in('email', CONTACT_TEAM_EMAILS);
            if (!error && data) team = data;
        }
    } catch (e) { team = []; }

    // 2. In-app notification for each team member found in the DB.
    try {
        if (client && team.length) {
            const preview = `${submission.subject ? submission.subject + ' — ' : ''}${String(submission.message || '').slice(0, 200)}`;
            await client.from('notifications').insert(team.map(t => ({
                user_id: t.id,
                type: 'contact_message',
                title: `New contact message from ${submission.name}`,
                message: preview,
                reference_id: submission.id ? String(submission.id) : null,
                data: { sender_email: submission.email, team_email: t.email },
            }))).then(() => null, () => null);
        }
    } catch (e) { /* background only — ignore */ }

    // 2b. Real push notification to each team member's subscribed devices.
    pushToSubscriptions(
        team.map(t => t.push_token),
        `New contact message from ${submission.name}`,
        `${submission.subject ? submission.subject + ' — ' : ''}${String(submission.message || '').slice(0, 150)}`,
        '/#contact'
    ).catch(() => {});

    // 3. Background WhatsApp alert to ONE shuffled support line (no redirect).
    try {
        const line = toIntlZW(shufflePick(SUPPORT_WHATSAPP_LINES));
        const text = `Hlala Link contact from ${submission.name} (${submission.email}) — ${submission.subject || 'No subject'}: ${String(submission.message || '').slice(0, 300)}`;
        await fetch('/api/contact-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: line,
                text,
                submissionId: submission.id || null,
                team: team.map(t => ({ email: t.email, phone: t.phone_number || null })),
            }),
        }).then(() => null, () => null);
    } catch (e) { /* background only — ignore */ }
}

/* ============================
   3b. WEB PUSH NOTIFICATIONS
   Service worker + VAPID. Subscription is saved to profiles.push_token.
   ============================ */

// Public VAPID key (safe to ship). Server may override via /api/push-config.
const VAPID_PUBLIC_KEY = 'BA4yJOoOZbf46SDN5zp7lxLsKya47uyJLLj2kVZBYozcbZTNrNyFw3RPD8cgTTUHwxO6GuOAUXOC-pTOoTRoW2A';

function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = window.atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

async function getPushPublicKey() {
    try {
        const r = await fetch('/api/push-config').then(res => res.ok ? res.json() : null, () => null);
        if (r?.publicKey) return r.publicKey;
    } catch (e) { /* fall through to bundled key */ }
    return VAPID_PUBLIC_KEY;
}

// Registers the service worker; subscribes only when logged in.
// Never throws, never blocks UI.
async function initPush() {
    try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        await navigator.serviceWorker.register('/sw.js');
    } catch (e) { return; }
    if (!currentUser) return;
    ensurePushSubscription().catch(() => {});
}

async function ensurePushSubscription() {
    try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
        if (!currentUser) return null;
        if (typeof Notification === 'undefined' || Notification.permission === 'denied') return null;
        if (Notification.permission === 'default') {
            const perm = await Notification.requestPermission().catch(() => 'denied');
            if (perm !== 'granted') return null;
        }
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(await getPushPublicKey()),
            });
        }
        const client = sb();
        if (client) {
            await client.from('profiles').update({ push_token: JSON.stringify(sub) }).eq('id', currentUser.id).then(() => null, () => null);
        }
        return sub;
    } catch (e) { return null; }
}

// Fan-out helper: subs may be subscription objects or JSON strings
// (Expo/mobile tokens are ignored automatically).
async function pushToSubscriptions(subs, title, body, url) {
    const list = (subs || []).map(s => {
        try { return typeof s === 'string' ? JSON.parse(s) : s; }
        catch (e) { return null; }
    }).filter(s => s && s.endpoint);
    if (!list.length) return;
    try {
        await fetch('/api/push-send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriptions: list.slice(0, 10), title, body, url: url || '/' }),
        }).then(() => null, () => null);
    } catch (e) { /* background only — ignore */ }
}

async function handleContactSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('contactBtn');
    btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Sending…';
    btn.disabled = true;

    const payload = {
        name:    document.getElementById('contact-name')?.value.trim(),
        email:   document.getElementById('contact-email')?.value.trim(),
        subject: document.getElementById('contact-subject')?.value.trim() || null,
        message: document.getElementById('contact-message')?.value.trim(),
    };

    const client = sb();
    if (client && payload.name && payload.email && payload.message) {
        await client.from('contact_submissions').insert([payload]).catch(() => {});
    }

    // Alert the team in the background — no redirect, no waiting.
    alertContactTeam({ ...payload, id: null }).catch(() => {});

    setTimeout(() => {
        btn.innerHTML = '<i class="bi bi-send-fill"></i> Send Message';
        btn.disabled  = false;
        e.target.reset();
        showToast("Message sent! We'll get back to you within 24 hours.");
    }, 900);
}

/* ============================
   5. MODAL SYSTEM
   ============================ */


/* ── MODAL ANIMATION ───────────────────────────────────── */
function openModal(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
}

function selectSignupRole(el) {
    // Remove active from all
    document.querySelectorAll('.role-option').forEach(opt => opt.classList.remove('active'));
    // Add active to current
    el.classList.add('active');
    // Set hidden input value
    const roleInput = document.getElementById('signup-role');
    if (roleInput) roleInput.value = el.dataset.value;
}

function closeModalOnOverlay(event, id) {
    if (event.target === event.currentTarget) closeModal(id);
}
function switchModal(closeId, openId) {
    closeModal(closeId);
    setTimeout(() => openModal(openId), 180);
    return false;
}
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
        document.body.style.overflow = '';
        closeAllDropdowns();
    }
});

/* ============================
   6. DROPDOWN MENUS
   ============================ */

// IDs of all dropdown menus
const DROPDOWN_IDS = ['dd-listings', 'dd-movers', 'dd-services'];
const ARROW_IDS    = ['arr-listings', 'arr-movers', 'arr-services'];

/**
 * Toggle a specific dropdown by its menu ID.
 * Closes all others before opening the target.
 */
function toggleDropdown(event, menuId) {
    event.preventDefault();
    event.stopPropagation();

    const menu = document.getElementById(menuId);
    if (!menu) return;

    const isOpen = menu.classList.contains('show');

    // Close every dropdown
    closeDropdowns();

    // If it was closed, open it now
    if (!isOpen) {
        menu.classList.add('show');
        // Rotate the matching arrow
        const arrowId = 'arr-' + menuId.replace('dd-', '');
        const arrow   = document.getElementById(arrowId);
        if (arrow) arrow.style.transform = 'rotate(180deg)';
    }
}

function closeDropdowns() {
    DROPDOWN_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('show');
    });
    ARROW_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.transform = '';
    });
}

function closeAllDropdowns() {
    closeDropdowns();
    closeAllUserMenus();
}

function closeAllUserMenus() {
    document.getElementById('user-avatar-btn')?.classList.remove('open');
}

// Click outside closes all dropdowns
document.addEventListener('click', e => {
    if (!e.target.closest('.nav-item')) closeDropdowns();
    if (!e.target.closest('.user-avatar-btn')) closeAllUserMenus();
});

/* ============================
   7. MOBILE HAMBURGER
   ============================ */

function setMenu(open) {
    const nav       = document.getElementById('nav');
    const actions   = document.getElementById('header-actions');
    const icon      = document.getElementById('hamburger-icon');
    if (!nav) return;
    nav.classList.toggle('open', open);
    if (actions) actions.classList.toggle('open', open);
    if (icon) icon.className = open ? 'bi bi-x-lg' : 'bi bi-list';
}

function toggleMenu() {
    const nav = document.getElementById('nav');
    setMenu(!(nav && nav.classList.contains('open')));
}

function closeMenu() {
    setMenu(false);
}

/* ============================
   8. TOAST NOTIFICATIONS
   ============================ */

let toastTimer = null;
function showToast(msg, type = 'success', duration = 3800) {
    const t      = document.getElementById('toast');
    const msgEl  = document.getElementById('toast-msg');
    if (!t || !msgEl) return;
    msgEl.textContent = msg;
    t.className  = 'toast show' + (type === 'error' ? ' toast-error' : '');
    t.querySelector('i').className = type === 'error' ? 'bi bi-exclamation-circle-fill' : 'bi bi-check-circle-fill';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

/* ============================
   9. TYPING ANIMATION
   ============================ */

const TYPING_PHRASES = [
    'Rental Home',
    'Dream Apartment',
    'Cozy Cottage',
    'Safe Haven',
    'Perfect Studio',
    'Family House',
];
let typingIndex = 0;
let charIndex   = 0;
let isDeleting  = false;

function typeLoop() {
    const target  = document.getElementById('typing-target');
    const cursor  = document.getElementById('typing-cursor');
    if (!target) return;

    const currentPhrase = TYPING_PHRASES[typingIndex % TYPING_PHRASES.length];
    let typeSpeed = isDeleting ? 55 : 95;

    if (!isDeleting) {
        target.textContent = currentPhrase.slice(0, ++charIndex);
        if (charIndex === currentPhrase.length) {
            isDeleting = true;
            typeSpeed  = 2200; // pause before deleting
        }
    } else {
        target.textContent = currentPhrase.slice(0, --charIndex);
        if (charIndex === 0) {
            isDeleting  = false;
            typingIndex = (typingIndex + 1) % TYPING_PHRASES.length;
            typeSpeed   = 400;
        }
    }
    setTimeout(typeLoop, typeSpeed);
}

/* ============================
   10. SCROLL REVEAL
   ============================ */

function initScrollReveal() {
    const targets  = document.querySelectorAll('.reveal-up:not(.revealed), .reveal-fade:not(.revealed), .reveal-left:not(.revealed), .reveal-right:not(.revealed)');
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(el => observer.observe(el));
}

/* ============================
   11. HERO PARTICLES
   ============================ */

function initParticles() {
    const container = document.getElementById('hero-particles');
    if (!container) return;
    const count = 18;
    for (let i = 0; i < count; i++) {
        const dot       = document.createElement('div');
        dot.className   = 'particle';
        const size      = Math.random() * 6 + 2;
        const left      = Math.random() * 100;
        const duration  = Math.random() * 18 + 10;
        const delay     = Math.random() * 12;
        dot.style.cssText = `
            width: ${size}px; height: ${size}px;
            left: ${left}%;
            bottom: -${size}px;
            animation-duration: ${duration}s;
            animation-delay: -${delay}s;
            opacity: ${Math.random() * 0.6 + 0.1};
        `;
        container.appendChild(dot);
    }
}

/* ============================
   12. ANIMATED COUNTER
   ============================ */

function animateCounter(el) {
    const target   = parseInt(el.getAttribute('data-target'), 10);
    const duration = 1800;
    const start    = performance.now();
    function update(now) {
        const progress = Math.min((now - start) / duration, 1);
        const ease     = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(ease * target).toLocaleString();
        if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
}

function initCounters() {
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });
    document.querySelectorAll('.stat-number[data-target]').forEach(el => observer.observe(el));
}

/* ============================
   13. TAB SYSTEM
   ============================ */

function switchTab(name, btn) {
    document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById('panel-' + name);
    if (panel) panel.classList.add('active');
    if (btn)   btn.classList.add('active');
}

/* ============================
   14. HEADER: SCROLL + SCROLL SPY + BACK-TO-TOP
   ============================ */

function initHeader() {
    const header    = document.getElementById('header');
    const backToTop = document.getElementById('backToTop');

    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY > 30;
        header.classList.toggle('scrolled', scrolled);
        if (backToTop) backToTop.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
}

function initScrollSpy() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link:not(.nav-dropdown-trigger)');
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                navLinks.forEach(link => {
                    link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id);
                });
            }
        });
    }, { rootMargin: '-40% 0px -60% 0px' });
    sections.forEach(s => observer.observe(s));
}

/* ============================
   15. HERO TAG CLICKS
   ============================ */

function initTagClicks() {
    document.querySelectorAll('.tag[data-type]').forEach(tag => {
        tag.addEventListener('click', () => {
            const type = tag.getAttribute('data-type');
            if (type === 'mover') {
                document.getElementById('movers')?.scrollIntoView({ behavior: 'smooth' });
            } else {
                filterByType(type);
            }
        });
    });
}

/* ============================
   16. MISC HELPERS
   ============================ */

function capitalise(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

/* ============================
   16. MISC HELPERS
   ============================ */

function capitalise(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function contactViaWhatsApp(phone, message) {
    if (!phone) {
        showToast('Contact number not available for this provider.', 'error');
        return;
    }
    const cleaned = phone.replace(/[^\d+]/g, '');
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${cleaned.replace('+', '')}?text=${encoded}`, '_blank');
}

/* ── CSS spin class for loading buttons ─────────────────── */
const styleSheet = document.createElement('style');
styleSheet.textContent = `.spin { animation: spin360 .7s linear infinite; display:inline-block; } @keyframes spin360 { to { transform: rotate(360deg); } }`;
document.head.appendChild(styleSheet);

/* ============================
   16b. SHARED PROFILE LINKS (#profile=<id>)
   A shared link (from the mobile app) lands here: show that agent's
   public profile + their live listings, with "Open in App" (deep link
   into the installed app) and the pinned Get-the-App button as fallback.
   ============================ */
const SITE_URL = 'https://hlala-link.web.app';
// Self-hosted APK (put the file at /downloads/hlala-link.apk). The
// `download` attribute on same-origin links forces a file download.
const APP_DOWNLOAD_URL = './downloads/hlala-link.apk';

function profileIdFromHash() {
    const m = /#profile=([A-Za-z0-9-]+)/.exec(window.location.hash || '');
    return m ? m[1] : null;
}

function openInApp(profileId) {
    if (!profileId) return;
    window.location.href = `hlalalink://profile/${profileId}`;
    // If the app isn't installed we stay on this page — pulse the pinned
    // download button so the visitor notices it.
    setTimeout(() => {
        if (document.hidden) return;
        const fab = document.getElementById('app-download-fab');
        if (!fab) return;
        fab.style.animation = 'none';
        void fab.offsetHeight;
        fab.style.animation = '';
        fab.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 1600);
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function initSharedProfile() {
    const pid = profileIdFromHash();
    if (!pid) return;
    const client = sb();
    if (!client) return;

    try {
        const [{ data: profile }, { data: listings }] = await Promise.all([
            client.from('profiles')
                .select('id, first_name, last_name, business_name, avatar_url, role, city, bio')
                .eq('id', pid)
                .maybeSingle(),
            client.from('properties')
                .select('*, property_images(url, alt_text, is_cover)')
                .eq('owner_id', pid)
                .eq('status', 'available')
                .order('created_at', { ascending: false })
                .limit(50),
        ]);
        if (!profile) return;

        const fullName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
        const displayName = profile.business_name || fullName || 'Hlala Link Agent';
        const initials = (fullName || displayName).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'HL';
        const roleLabel = ({ agent: 'Property Agent', landlord: 'Landlord', mover: 'Mover', admin: 'Hlala Link Official' })[profile.role] || 'Member';
        const live = (listings || []).map(normalizeProperty);

        // Spotlight card above the grid
        const old = document.getElementById('profile-spotlight');
        if (old) old.remove();
        const grid = document.getElementById('listingsGrid');
        const spot = document.createElement('div');
        spot.id = 'profile-spotlight';
        spot.innerHTML = `
        <div class="mover-card" style="text-align:center;align-items:center;max-width:560px;margin:0 auto 1.5rem">
            ${profile.avatar_url
                ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" style="width:84px;height:84px;border-radius:50%;object-fit:cover;margin-bottom:.75rem">`
                : `<div class="mover-avatar" style="margin-bottom:.75rem"><span style="font-weight:800;font-size:22px">${escapeHtml(initials)}</span></div>`}
            <h3 style="margin:0 0 .25rem">${escapeHtml(displayName)}</h3>
            <p class="mover-location" style="margin-bottom:.5rem"><i class="bi bi-patch-check-fill"></i> ${escapeHtml(roleLabel)}${profile.city ? ` · ${escapeHtml(profile.city)}` : ''}</p>
            ${profile.bio ? `<p class="text-muted" style="margin-bottom:.75rem">${escapeHtml(profile.bio)}</p>` : ''}
            <p class="text-muted" style="margin-bottom:1rem">${live.length} live listing${live.length === 1 ? '' : 's'} on Hlala Link</p>
            <div style="display:flex;gap:.5rem;width:100%">
                <button class="btn btn-primary btn-sm" style="flex:1" onclick="openInApp('${escapeHtml(pid)}')">
                    <i class="bi bi-phone-fill"></i> Open in App
                </button>
                <a class="btn btn-outline-primary btn-sm" style="flex:1" href="${APP_DOWNLOAD_URL}" download="hlala-link.apk">
                    <i class="bi bi-download"></i> Download App
                </a>
            </div>
        </div>`;
        grid?.parentNode?.insertBefore(spot, grid);

        // Show only this agent's listings in the grid
        if (live.length > 0) {
            allListings = live;
            filteredListings = [...live];
            const t = document.getElementById('listingsTitle');
            const s = document.getElementById('listingsSub');
            if (t) t.textContent = `Listings by ${displayName}`;
            if (s) s.textContent = 'Shared from the Hlala Link app.';
            renderListings();
            initScrollReveal();
        }
        document.getElementById('listings')?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
        console.log('[profile-link] failed:', e?.message || e);
    }
}

/* ============================
   17. INIT — DOMContentLoaded
   ============================ */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Core UI setup (Sync)
    initHeader();
    initScrollSpy();
    initScrollReveal();
    initTagClicks();
    initLongPressSignOut();

    // 2. Heavy Lifting (Parallel & Async)
    // We don't await initAuth so listings can start loading immediately
    Promise.all([
        initAuth(),
        initListings(),
        initMovers()
    ]).then(() => {
        initScrollReveal(); // Re-scan for new elements
        setTimeout(initScrollReveal, 400);

        // Shared profile links (#profile=<id>) render after data is ready
        initSharedProfile();
        window.addEventListener('hashchange', initSharedProfile);
        
        // 3. Background Real-time & Auto-refresh
        subscribeToProperties();
        // Background refresh every 5 minutes
        setInterval(() => initListings(true), 5 * 60 * 1000);
    });

    // 3. Interactions
    document.getElementById('heroSearch')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleSearch();
    });

    // 4. Effects
    initSearchAutocomplete();

    initAgents();
    initPush();
});

async function initAgents() {
    const grid = document.getElementById('agentsGrid');
    if (!grid) return;
    
    const client = sb();
    if (!client) {
        grid.innerHTML = '<p class="text-muted">Login to view agents.</p>';
        return;
    }
    
    const { data, error } = await client.from('profiles')
        .select('*')
        .in('role', ['agent', 'landlord'])
        .limit(20);
        
    if (data?.length > 0) {
        grid.innerHTML = data.map(a => {
            const fname = a.first_name || '';
            const lname = a.last_name || '';
            const avatar = a.avatar_url
                ? `<img src="${a.avatar_url}" alt="${(fname + ' ' + lname).trim().replace(/"/g, '&quot;')}" loading="lazy" onerror="this.remove()">`
                : (fname.charAt(0) || '?').toUpperCase();
            const roleIcon = a.role === 'agent' ? 'bi-person-badge-fill' : 'bi-house-heart-fill';
            return `
            <div class="agent-card">
                <div class="agent-avatar">${avatar}</div>
                <div class="agent-details">
                    <h3>${fname} ${lname}</h3>
                    <p class="agent-role"><i class="bi ${roleIcon}"></i> ${capitalise(a.role)}</p>
                    <button class="btn btn-ghost btn-sm" onclick="openMessagesModal('${a.id}', '${fname}')">
                        <i class="bi bi-chat-dots"></i> Message
                    </button>
                </div>
            </div>`;
        }).join('');
    } else {
        grid.innerHTML = '<p class="text-muted">No featured agents found.</p>';
    }
    syncAgentArrows();
}

/* ── AGENTS SLIDER ──────────────────────────────────────── */
function slideAgents(dir) {
    const grid = document.getElementById('agentsGrid');
    if (!grid) return;
    const card = grid.querySelector('.agent-card');
    const step = card ? card.offsetWidth + 22 : 360;
    grid.scrollBy({ left: dir * step, behavior: 'smooth' });
}

function syncAgentArrows() {
    const grid = document.getElementById('agentsGrid');
    const prev = document.getElementById('agentsPrev');
    const next = document.getElementById('agentsNext');
    if (!grid || !prev || !next) return;
    const maxScroll = grid.scrollWidth - grid.clientWidth;
    const update = () => {
        const x = grid.scrollLeft;
        prev.classList.toggle('hidden', x <= 8);
        next.classList.toggle('hidden', x >= maxScroll - 8);
    };
    update();
    if (!grid.dataset.arrowsBound) {
        grid.dataset.arrowsBound = '1';
        grid.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
    }
}
