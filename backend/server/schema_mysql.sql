-- Compatible with MySQL 8+ and MariaDB 10.6+.
CREATE TABLE IF NOT EXISTS profiles (
    id CHAR(36) NOT NULL PRIMARY KEY,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash VARCHAR(255),
    full_name VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(32) NOT NULL DEFAULT 'tenant',
    first_name VARCHAR(120) NOT NULL DEFAULT '',
    last_name VARCHAR(120) NOT NULL DEFAULT '',
    phone_number VARCHAR(64),
    phone VARCHAR(64),
    business_name VARCHAR(255),
    vehicle_details JSON,
    vehicle_photos JSON NOT NULL,
    approval_status VARCHAR(32) NOT NULL DEFAULT 'approved',
    is_approved BOOLEAN NOT NULL DEFAULT TRUE,
    approved_at DATETIME(3),
    avatar_url TEXT,
    bio TEXT,
    city VARCHAR(120) DEFAULT 'Harare',
    push_token TEXT,
    id_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    followers_count INT NOT NULL DEFAULT 0,
    average_rating DECIMAL(3,1) NOT NULL DEFAULT 0,
    review_count INT NOT NULL DEFAULT 0,
    last_seen DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_profiles_role (role),
    KEY idx_profiles_city (city),
    KEY idx_profiles_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
    plan VARCHAR(32) NOT NULL PRIMARY KEY,
    price_usd DECIMAL(8,2) NOT NULL,
    max_listings INT NOT NULL,
    features JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO subscription_plans (plan, price_usd, max_listings, features) VALUES
    ('free', 0, 1, JSON_ARRAY('1 active listing', 'Standard search visibility', 'In-app chat')),
    ('basic', 5, 5, JSON_ARRAY('5 active listings', 'Email support', 'Verified badge')),
    ('pro', 15, 20, JSON_ARRAY('20 active listings', 'Priority search placement', 'Advanced analytics')),
    ('enterprise', 40, 999, JSON_ARRAY('Unlimited listings', 'Dedicated account manager', 'API access'))
ON DUPLICATE KEY UPDATE price_usd = VALUES(price_usd), max_listings = VALUES(max_listings), features = VALUES(features);

CREATE TABLE IF NOT EXISTS subscriptions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    plan VARCHAR(32) NOT NULL DEFAULT 'free',
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    price_usd DECIMAL(10,2) NOT NULL DEFAULT 0,
    starts_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3),
    max_listings INT NOT NULL DEFAULT 1,
    auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
    paynow_reference VARCHAR(255),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_subscriptions_user (user_id),
    KEY idx_subscriptions_status (status, expires_at),
    CONSTRAINT fk_subscriptions_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan) REFERENCES subscription_plans(plan)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS properties (
    id CHAR(36) NOT NULL PRIMARY KEY,
    owner_id CHAR(36) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    property_type VARCHAR(48) NOT NULL DEFAULT 'apartment',
    listing_type VARCHAR(32) NOT NULL DEFAULT 'rent',
    listing_purpose VARCHAR(32) NOT NULL DEFAULT 'rent',
    status VARCHAR(32) NOT NULL DEFAULT 'available',
    address TEXT NOT NULL,
    suburb VARCHAR(160),
    city VARCHAR(120) NOT NULL DEFAULT 'Harare',
    province VARCHAR(120),
    country VARCHAR(120) NOT NULL DEFAULT 'Zimbabwe',
    latitude DOUBLE,
    longitude DOUBLE,
    bedrooms SMALLINT NOT NULL DEFAULT 1,
    bathrooms SMALLINT NOT NULL DEFAULT 1,
    area_sqm DECIMAL(8,2),
    floor_level SMALLINT,
    parking_spots SMALLINT NOT NULL DEFAULT 0,
    is_furnished BOOLEAN NOT NULL DEFAULT FALSE,
    pets_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    available_from DATE,
    rent_usd DECIMAL(10,2),
    sale_price_usd DECIMAL(10,2),
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    images JSON NOT NULL,
    amenities JSON NOT NULL,
    deposit_usd DECIMAL(10,2),
    utilities_inc BOOLEAN NOT NULL DEFAULT FALSE,
    has_wifi BOOLEAN NOT NULL DEFAULT FALSE,
    has_pool BOOLEAN NOT NULL DEFAULT FALSE,
    has_gym BOOLEAN NOT NULL DEFAULT FALSE,
    has_borehole BOOLEAN NOT NULL DEFAULT FALSE,
    has_solar BOOLEAN NOT NULL DEFAULT FALSE,
    has_security BOOLEAN NOT NULL DEFAULT FALSE,
    has_generator BOOLEAN NOT NULL DEFAULT FALSE,
    has_water_tank BOOLEAN NOT NULL DEFAULT FALSE,
    has_garden BOOLEAN NOT NULL DEFAULT FALSE,
    views INT NOT NULL DEFAULT 0,
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_at DATETIME(3),
    reviewed_by CHAR(36),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_properties_city (city),
    KEY idx_properties_suburb (suburb),
    KEY idx_properties_status (status),
    KEY idx_properties_rent (rent_usd),
    KEY idx_properties_owner (owner_id),
    KEY idx_properties_type (property_type),
    KEY idx_properties_featured_created (featured, created_at),
    FULLTEXT KEY idx_properties_search (title, description, city, suburb, address),
    CONSTRAINT fk_properties_owner FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_properties_reviewer FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS property_images (
    id CHAR(36) NOT NULL PRIMARY KEY,
    property_id CHAR(36) NOT NULL,
    url TEXT NOT NULL,
    alt_text TEXT,
    is_cover BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    uploaded_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_property_images_property (property_id, sort_order),
    CONSTRAINT fk_property_images_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_properties (
    user_id CHAR(36) NOT NULL,
    property_id CHAR(36) NOT NULL,
    saved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, property_id),
    CONSTRAINT fk_saved_properties_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_saved_properties_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS saved_searches (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    city VARCHAR(120) NOT NULL,
    suburb VARCHAR(160),
    property_type VARCHAR(48),
    max_price DECIMAL(10,2),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_saved_searches_user (user_id, created_at),
    CONSTRAINT fk_saved_searches_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS applications (
    id CHAR(36) NOT NULL PRIMARY KEY,
    property_id CHAR(36) NOT NULL,
    applicant_id CHAR(36) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    message TEXT,
    move_in_date DATE,
    monthly_income DECIMAL(10,2),
    employer VARCHAR(255),
    num_occupants SMALLINT NOT NULL DEFAULT 1,
    has_pets BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_at DATETIME(3),
    decision_note TEXT,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_applications_property_applicant (property_id, applicant_id),
    KEY idx_applications_property (property_id),
    KEY idx_applications_applicant (applicant_id),
    CONSTRAINT fk_applications_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    CONSTRAINT fk_applications_applicant FOREIGN KEY (applicant_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_follows (
    follower_id CHAR(36) NOT NULL,
    following_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (follower_id, following_id),
    CONSTRAINT fk_user_follows_follower FOREIGN KEY (follower_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_follows_following FOREIGN KEY (following_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS conversations (
    id CHAR(36) NOT NULL PRIMARY KEY,
    participant_one CHAR(36) NOT NULL,
    participant_two CHAR(36) NOT NULL,
    participant_a CHAR(36) NOT NULL,
    participant_b CHAR(36) NOT NULL,
    participant_low CHAR(36) GENERATED ALWAYS AS (LEAST(participant_one, participant_two)) STORED,
    participant_high CHAR(36) GENERATED ALWAYS AS (GREATEST(participant_one, participant_two)) STORED,
    property_id CHAR(36),
    last_message_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_conversation_pair (participant_low, participant_high),
    KEY idx_conversations_participants (participant_a, participant_b),
    CONSTRAINT fk_conversations_one FOREIGN KEY (participant_one) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_conversations_two FOREIGN KEY (participant_two) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_conversations_a FOREIGN KEY (participant_a) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_conversations_b FOREIGN KEY (participant_b) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_conversations_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
    id CHAR(36) NOT NULL PRIMARY KEY,
    conversation_id CHAR(36) NOT NULL,
    sender_id CHAR(36) NOT NULL,
    body TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    status VARCHAR(24) NOT NULL DEFAULT 'sent',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_messages_conversation (conversation_id, created_at),
    KEY idx_messages_sender (sender_id),
    CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS movers (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    owner_id CHAR(36),
    business_name VARCHAR(255),
    company_name VARCHAR(255) NOT NULL,
    description TEXT,
    city VARCHAR(120) NOT NULL DEFAULT 'Harare',
    service_areas JSON NOT NULL,
    service_area TEXT,
    vehicle_types JSON NOT NULL,
    base_price_usd DECIMAL(8,2) NOT NULL DEFAULT 0,
    price_from DECIMAL(8,2),
    price_per_km DECIMAL(8,2) DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    phone VARCHAR(64) NOT NULL,
    whatsapp VARCHAR(64),
    email VARCHAR(320),
    website TEXT,
    rating DECIMAL(3,2) NOT NULL DEFAULT 0,
    total_reviews INT NOT NULL DEFAULT 0,
    total_jobs INT NOT NULL DEFAULT 0,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    avatar_url TEXT,
    logo_url TEXT,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_movers_city (city),
    KEY idx_movers_active (is_active),
    KEY idx_movers_owner (owner_id),
    CONSTRAINT fk_movers_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_movers_owner FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mover_bookings (
    id CHAR(36) NOT NULL PRIMARY KEY,
    mover_id CHAR(36) NOT NULL,
    customer_id CHAR(36) NOT NULL,
    client_id CHAR(36) NOT NULL,
    booking_date DATE NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    bid_amount DECIMAL(10,2),
    moving_date DATE,
    pickup_address TEXT,
    destination_address TEXT NOT NULL DEFAULT '',
    drop_address TEXT,
    pickup_city VARCHAR(120) DEFAULT 'Harare',
    drop_city VARCHAR(120) DEFAULT 'Harare',
    distance_km DECIMAL(8,2),
    estimated_price DECIMAL(10,2),
    price DECIMAL(10,2),
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    final_price DECIMAL(10,2),
    items_description TEXT,
    notes TEXT,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    KEY idx_mover_bookings_mover (mover_id),
    KEY idx_mover_bookings_client (client_id),
    CONSTRAINT fk_mover_bookings_mover FOREIGN KEY (mover_id) REFERENCES movers(id) ON DELETE CASCADE,
    CONSTRAINT fk_mover_bookings_customer FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_mover_bookings_client FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mover_reviews (
    id CHAR(36) NOT NULL PRIMARY KEY,
    mover_id CHAR(36) NOT NULL,
    booking_id CHAR(36) UNIQUE,
    reviewer_id CHAR(36) NOT NULL,
    rating INT NOT NULL,
    comment TEXT,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_mover_reviews_mover (mover_id, created_at),
    CONSTRAINT fk_mover_reviews_mover FOREIGN KEY (mover_id) REFERENCES movers(id) ON DELETE CASCADE,
    CONSTRAINT fk_mover_reviews_booking FOREIGN KEY (booking_id) REFERENCES mover_bookings(id) ON DELETE SET NULL,
    CONSTRAINT fk_mover_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
    id CHAR(36) NOT NULL PRIMARY KEY,
    reviewer_id CHAR(36) NOT NULL,
    property_id CHAR(36),
    target_user_id CHAR(36),
    mover_id CHAR(36),
    rating INT NOT NULL,
    title VARCHAR(255),
    comment TEXT,
    body TEXT,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_reviews_property (property_id, created_at),
    KEY idx_reviews_mover (mover_id, created_at),
    KEY idx_reviews_target_user (target_user_id, created_at),
    CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_property FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_target_user FOREIGN KEY (target_user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_mover FOREIGN KEY (mover_id) REFERENCES movers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    type VARCHAR(64) NOT NULL,
    actor_id CHAR(36),
    reference_id VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    body TEXT,
    data JSON NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_notifications_user (user_id, created_at),
    KEY idx_notifications_unread (user_id, is_read),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contact_submissions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(320) NOT NULL,
    phone VARCHAR(64),
    subject VARCHAR(255),
    message TEXT NOT NULL,
    ip_address VARCHAR(64),
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at DATETIME(3),
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_contact_resolved (is_resolved, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;