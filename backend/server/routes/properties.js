const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");
const optionalAuthenticateToken = authenticateToken.optional;

const router = express.Router();

async function attachPropertyImages(properties) {
    if (!properties.length) return properties;
    const placeholders = properties.map((_, index) => `$${index + 1}`).join(", ");
    const result = await pool.query(
        `SELECT * FROM property_images WHERE property_id IN (${placeholders}) ORDER BY sort_order`,
        properties.map(property => property.id)
    );
    const imagesByProperty = new Map();
    for (const image of result.rows) {
        const images = imagesByProperty.get(image.property_id) || [];
        images.push(image);
        imagesByProperty.set(image.property_id, images);
    }
    return properties.map(property => ({
        ...property,
        property_images: imagesByProperty.get(property.id) || []
    }));
}


// =====================================================
// GET ALL PROPERTIES (with filters & search)
// GET /api/properties?city=Harare&type=apartment&min=100&max=500&beds=2&q=borrowdale
// =====================================================

router.get("/", optionalAuthenticateToken, async (req, res) => {
    try {
        const {
            city, suburb, type, status, min, max, beds, baths,
            furnished, pets, wifi, pool: hasPool, solar, borehole, security,
            q, owner_id, featured, limit = 50, offset = 0,
            sort = "newest"
        } = req.query;

        const limitNumber = Number.parseInt(limit, 10);
        const offsetNumber = Number.parseInt(offset, 10);
        if (!Number.isInteger(limitNumber) || limitNumber < 1 || !Number.isInteger(offsetNumber) || offsetNumber < 0) {
            return res.status(400).json({ success: false, message: "Limit and offset must be valid non-negative integers" });
        }
        const pageLimit = Math.min(limitNumber, 100);

        const conditions = ["p.status != 'inactive'"];
        const params = [];
        let paramIdx = 1;

        if (city)     { conditions.push(`LOWER(p.city) = LOWER($${paramIdx++})`);          params.push(city); }
        if (suburb)   { conditions.push(`LOWER(p.suburb) = LOWER($${paramIdx++})`);        params.push(suburb); }
        if (type)     { conditions.push(`p.property_type = $${paramIdx++}`); params.push(type); }
        if (status)   { conditions.push(`p.status = $${paramIdx++}`);       params.push(status); }
        if (min)      { conditions.push(`p.rent_usd >= $${paramIdx++}`);                   params.push(parseFloat(min)); }
        if (max)      { conditions.push(`p.rent_usd <= $${paramIdx++}`);                   params.push(parseFloat(max)); }
        if (beds)     { conditions.push(`p.bedrooms >= $${paramIdx++}`);                   params.push(parseInt(beds)); }
        if (baths)    { conditions.push(`p.bathrooms >= $${paramIdx++}`);                  params.push(parseInt(baths)); }
        if (owner_id) { conditions.push(`p.owner_id = $${paramIdx++}`);                   params.push(owner_id); }
        if (featured === "true") { conditions.push("p.featured = TRUE"); }
        if (furnished === "true") { conditions.push("p.is_furnished = TRUE"); }
        if (pets === "true")  { conditions.push("p.pets_allowed = TRUE"); }
        if (wifi === "true")  { conditions.push("p.has_wifi = TRUE"); }
        if (hasPool === "true") { conditions.push("p.has_pool = TRUE"); }
        if (solar === "true") { conditions.push("p.has_solar = TRUE"); }
        if (borehole === "true") { conditions.push("p.has_borehole = TRUE"); }
        if (security === "true") { conditions.push("p.has_security = TRUE"); }

        if (q) {
            conditions.push(`LOWER(CONCAT_WS(' ', p.title, p.description, p.city, p.suburb, p.address)) LIKE LOWER(CONCAT('%', $${paramIdx++}, '%'))`);
            params.push(q);
        }

        const userParamIdx = paramIdx++;
        params.push(req.user?.userId || null);

        const orderMap = {
            newest:     "p.created_at DESC",
            oldest:     "p.created_at ASC",
            price_asc:  "p.rent_usd ASC",
            price_desc: "p.rent_usd DESC",
            popular:    "p.views DESC"
        };
        const orderBy = orderMap[sort] || "p.created_at DESC";

        const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";

        params.push(pageLimit, offsetNumber);

        const result = await pool.query(
            `SELECT
                p.*,
                TRIM(CONCAT(pr.first_name, ' ', pr.last_name)) AS owner_name,
                pr.avatar_url AS owner_avatar,
                pr.phone_number AS owner_phone,
                pr.id_verified AS owner_verified,
                EXISTS(SELECT 1 FROM saved_properties sp
                      WHERE sp.property_id = p.id AND sp.user_id = $${userParamIdx}) AS is_saved
            FROM properties p
            JOIN profiles pr ON pr.id = p.owner_id
            ${where}
            ORDER BY p.featured DESC, ${orderBy}
            LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
            params
        );

        // Total count for pagination
        const countResult = await pool.query(
            `SELECT COUNT(*) AS count FROM properties p ${where}`,
            params.slice(0, params.length - 3)
        );

        res.json({
            success: true,
            // Light feed mode (?include_images=0) skips the attached image
            // rows so mobile list queries stay small; BEAT 1 enrichment
            // fetches images separately via GET /properties/images.
            properties: req.query.include_images === "0"
                ? result.rows
                : await attachPropertyImages(result.rows),
            total: parseInt(countResult.rows[0].count),
            limit: pageLimit,
            offset: offsetNumber
        });

    } catch (error) {
        console.error("Get properties error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch properties" });
    }
});


// =====================================================
// GET ONE PROPERTY
// =====================================================

router.get("/images", async (req, res) => {
    try {
        const rawIds = req.query.property_ids;
        const ids = (Array.isArray(rawIds) ? rawIds : String(rawIds || "").split(","))
            .flatMap(value => String(value).split(","))
            .map(value => value.trim())
            .filter(Boolean);
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!ids.length || ids.length > 100 || ids.some(id => !uuidPattern.test(id))) {
            return res.status(400).json({ success: false, message: "Provide up to 100 valid property UUIDs" });
        }
        const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
        const result = await pool.query(
            `SELECT * FROM property_images WHERE property_id IN (${placeholders})
             ORDER BY property_id, sort_order`,
            ids
        );
        res.json({ success: true, images: result.rows });
    } catch (error) {
        console.error("Batch property image query error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch property images" });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `SELECT
                p.*,
                TRIM(CONCAT(pr.first_name, ' ', pr.last_name)) AS owner_name,
                pr.email AS owner_email,
                pr.avatar_url AS owner_avatar,
                pr.phone_number AS owner_phone,
                pr.id_verified AS owner_verified,
                pr.average_rating AS owner_rating
            FROM properties p
            JOIN profiles pr ON pr.id = p.owner_id
            WHERE p.id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Property not found" });
        }

        // Increment views asynchronously
        pool.query(
            "UPDATE properties SET views = views + 1 WHERE id = $1",
            [id]
        ).catch(err => console.error("View count error:", err));

        const [property] = await attachPropertyImages(result.rows);
        res.json({ success: true, property });

    } catch (error) {
        console.error("Get property error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch property" });
    }
});

router.post("/:id/view", async (req, res) => {
    try {
        await pool.query("UPDATE properties SET views = views + 1 WHERE id = $1", [req.params.id]);
        const result = await pool.query("SELECT views FROM properties WHERE id = $1", [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Property not found" });
        res.json({ success: true, views: result.rows[0].views });
    } catch (error) {
        console.error("Increment property views error:", error);
        res.status(500).json({ success: false, message: "Could not update property views" });
    }
});


// =====================================================
// CREATE PROPERTY
// =====================================================

router.post("/", authenticateToken, async (req, res) => {
    try {
        const {
            price, sale_price_usd, currency, listing_type, listing_purpose, amenities,
            title, description, property_type, status,
            address, suburb, city, province, country,
            latitude, longitude,
            bedrooms, bathrooms, area_sqm, floor_level, parking_spots,
            is_furnished, pets_allowed, available_from,
            rent_usd, deposit_usd, utilities_inc,
            has_wifi, has_pool, has_gym, has_borehole, has_solar,
            has_security, has_generator, has_water_tank, has_garden,
            featured,
            images  // array of { url, alt_text, is_cover, sort_order }
        } = req.body;

        const listingPurpose = listing_purpose || listing_type || "rent";
        const listingType = listingPurpose === "sale" ? "sale" : "rent";
        const listedAmount = Number(rent_usd ?? sale_price_usd ?? price);
        if (!title || !property_type || (rent_usd === undefined && sale_price_usd === undefined && price === undefined) || !address || !city) {
            return res.status(400).json({
                success: false,
                message: "Title, property type, rent, address and city are required"
            });
        }
        if (!Number.isFinite(listedAmount) || listedAmount <= 0) {
            return res.status(400).json({ success: false, message: "Listing price must be a positive number" });
        }
        if (listingPurpose === "both" && (!Number.isFinite(Number(sale_price_usd)) || Number(sale_price_usd) <= 0)) {
            return res.status(400).json({ success: false, message: "A positive sale price is required for rent-and-sale listings" });
        }
        if (images !== undefined && (!Array.isArray(images) || images.length > 20 || images.some(image =>
            typeof image === "string" ? !image.trim() : !image || typeof image.url !== "string" || !image.url.trim()
        ))) {
            return res.status(400).json({ success: false, message: "Images must be an array of up to 20 items with a URL" });
        }
        const imageRecords = (images || []).map((image, index) => typeof image === "string"
            ? { url: image.trim(), sort_order: index }
            : image);

        const propertyId = randomUUID();
        await pool.query(
            `INSERT INTO properties (
                owner_id, title, description, property_type, status,
                address, suburb, city, province, country,
                latitude, longitude,
                bedrooms, bathrooms, area_sqm, floor_level, parking_spots,
                is_furnished, pets_allowed, available_from,
                rent_usd, deposit_usd, utilities_inc,
                has_wifi, has_pool, has_gym, has_borehole, has_solar,
                has_security, has_generator, has_water_tank, has_garden, featured,
                listing_type, price, currency, images, amenities, sale_price_usd, listing_purpose, id
            ) VALUES (
                $1,$2,$3,$4,$5,
                $6,$7,$8,$9,$10,
                $11,$12,
                $13,$14,$15,$16,$17,
                $18,$19,$20,
                $21,$22,$23,
                $24,$25,$26,$27,$28,
                $29,$30,$31,$32,$33,
                $34,$35,$36,$37,$38,$39,$40,$41
            )`,
            [
                req.user.userId, title, description || null,
                property_type, status || "available",
                address, suburb || null, city, province || null, country || "Zimbabwe",
                latitude || null, longitude || null,
                bedrooms || 1, bathrooms || 1, area_sqm || null, floor_level || null, parking_spots || 0,
                is_furnished || false, pets_allowed || false, available_from || null,
                listingPurpose === "sale" ? null : Number(rent_usd ?? price ?? listedAmount), deposit_usd || null, utilities_inc || false,
                has_wifi || false, has_pool || false, has_gym || false,
                has_borehole || false, has_solar || false,
                has_security || false, has_generator || false,
                has_water_tank || false, has_garden || false,
                req.user.role === "admin" ? Boolean(featured) : false,
                listingType, listedAmount, currency || "USD",
                JSON.stringify(imageRecords), JSON.stringify(amenities || []),
                listingPurpose === "rent" ? null : Number(sale_price_usd ?? (listingPurpose === "sale" ? listedAmount : null)),
                listingPurpose, propertyId
            ]
        );

        const result = await pool.query("SELECT * FROM properties WHERE id = $1", [propertyId]);
        const property = result.rows[0];

        // Insert images if provided
        if (imageRecords.length > 0) {
            for (const [index, image] of imageRecords.entries()) {
                await pool.query(
                    `INSERT INTO property_images (id, property_id, url, alt_text, is_cover, sort_order)
                     VALUES ($1,$2,$3,$4,$5,$6)`,
                    [randomUUID(), property.id, image.url.trim(), image.alt_text || null,
                        Boolean(image.is_cover), Number.isInteger(image.sort_order) ? image.sort_order : index]
                );
            }
        }

        const [propertyWithImages] = await attachPropertyImages([property]);

        res.status(201).json({
            success: true,
            message: "Property created successfully",
            property: propertyWithImages
        });

    } catch (error) {
        console.error("Create property error:", error);
        res.status(500).json({ success: false, message: "Failed to create property" });
    }
});


// =====================================================
// UPDATE PROPERTY
// =====================================================

router.put("/:id", authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Check ownership (allow admin to bypass)
        const ownerCheck = await pool.query(
            "SELECT id FROM properties WHERE id = $1 AND owner_id = $2",
            [id, req.user.userId]
        );

        if (ownerCheck.rows.length === 0 && req.user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "You can only update your own properties"
            });
        }

        const {
            title, description, property_type, status,
            address, suburb, city, province, country,
            latitude, longitude,
            bedrooms, bathrooms, area_sqm, parking_spots,
            is_furnished, pets_allowed, available_from,
            rent_usd, deposit_usd, utilities_inc,
            has_wifi, has_pool, has_gym, has_borehole, has_solar,
            has_security, has_generator, has_water_tank, has_garden, featured
        } = req.body;

        await pool.query(
            `UPDATE properties SET
                title         = COALESCE($1, title),
                description   = COALESCE($2, description),
                property_type = COALESCE($3, property_type),
                status        = COALESCE($4, status),
                address       = COALESCE($5, address),
                suburb        = COALESCE($6, suburb),
                city          = COALESCE($7, city),
                province      = COALESCE($8, province),
                country       = COALESCE($9, country),
                latitude      = COALESCE($10, latitude),
                longitude     = COALESCE($11, longitude),
                bedrooms      = COALESCE($12, bedrooms),
                bathrooms     = COALESCE($13, bathrooms),
                area_sqm      = COALESCE($14, area_sqm),
                parking_spots = COALESCE($15, parking_spots),
                is_furnished  = COALESCE($16, is_furnished),
                pets_allowed  = COALESCE($17, pets_allowed),
                available_from= COALESCE($18, available_from),
                rent_usd      = COALESCE($19, rent_usd),
                price         = COALESCE($19, price),
                deposit_usd   = COALESCE($20, deposit_usd),
                utilities_inc = COALESCE($21, utilities_inc),
                has_wifi      = COALESCE($22, has_wifi),
                has_pool      = COALESCE($23, has_pool),
                has_gym       = COALESCE($24, has_gym),
                has_borehole  = COALESCE($25, has_borehole),
                has_solar     = COALESCE($26, has_solar),
                has_security  = COALESCE($27, has_security),
                has_generator = COALESCE($28, has_generator),
                has_water_tank= COALESCE($29, has_water_tank),
                has_garden    = COALESCE($30, has_garden),
                featured      = COALESCE($31, featured),
                updated_at    = NOW()
            WHERE id = $32`,
            [
                title, description, property_type, status,
                address, suburb, city, province, country,
                latitude, longitude,
                bedrooms, bathrooms, area_sqm, parking_spots,
                is_furnished, pets_allowed, available_from,
                rent_usd, deposit_usd, utilities_inc,
                has_wifi, has_pool, has_gym, has_borehole, has_solar,
                has_security, has_generator, has_water_tank, has_garden,
                req.user.role === "admin" ? featured : undefined,
                id
            ]
        );

        const result = await pool.query("SELECT * FROM properties WHERE id = $1", [id]);
        const [property] = await attachPropertyImages(result.rows);
        res.json({ success: true, message: "Property updated successfully", property });

    } catch (error) {
        console.error("Update property error:", error);
        res.status(500).json({ success: false, message: "Failed to update property" });
    }
});


// =====================================================
// DELETE PROPERTY
// =====================================================

router.delete("/:id", authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await pool.query("SELECT id FROM properties WHERE id = $1 AND owner_id = $2", [id, req.user.userId]);
        if (!existing.rows.length) {
            return res.status(404).json({ success: false, message: "Property not found or you do not have permission to delete it" });
        }
        await pool.query("DELETE FROM properties WHERE id = $1 AND owner_id = $2", [id, req.user.userId]);
        res.json({ success: true, message: "Property deleted successfully" });
    } catch (error) {
        console.error("Delete property error:", error);
        res.status(500).json({ success: false, message: "Failed to delete property" });
    }
});


// =====================================================
// SAVE / UNSAVE PROPERTY (Favorites)
// =====================================================

router.post("/:id/save", authenticateToken, async (req, res) => {
    try {
        await pool.query(
            "INSERT INTO saved_properties (user_id, property_id) VALUES ($1, $2) ON DUPLICATE KEY UPDATE user_id = user_id",
            [req.user.userId, req.params.id]
        );
        res.json({ success: true, message: "Property saved" });
    } catch (error) {
        console.error("Save property error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.delete("/:id/save", authenticateToken, async (req, res) => {
    try {
        await pool.query("DELETE FROM saved_properties WHERE user_id = $1 AND property_id = $2", [req.user.userId, req.params.id]);
        res.json({ success: true, message: "Property unsaved" });
    } catch (error) {
        console.error("Unsave property error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// =====================================================
// GET SAVED PROPERTIES FOR CURRENT USER
// =====================================================

router.get("/saved/me", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*, sp.property_id, sp.user_id, sp.saved_at,
                    TRIM(CONCAT(pr.first_name, ' ', pr.last_name)) AS owner_name,
                    pr.avatar_url AS owner_avatar,
                    JSON_OBJECT('id', pr.id, 'first_name', pr.first_name, 'last_name', pr.last_name,
                        'full_name', pr.full_name, 'business_name', pr.business_name,
                        'avatar_url', pr.avatar_url, 'role', pr.role) AS owner
             FROM saved_properties sp
             JOIN properties p ON p.id = sp.property_id
             JOIN profiles pr ON pr.id = p.owner_id
             WHERE sp.user_id = $1
             ORDER BY sp.saved_at DESC`,
            [req.user.userId]
        );
        res.json({ success: true, saved: await attachPropertyImages(result.rows) });
    } catch (error) {
        console.error("Get saved properties error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch saved properties" });
    }
});


// =====================================================
// ADD PROPERTY IMAGES
// =====================================================

router.post("/:id/images", authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { images } = req.body;
        const ownerCheck = await pool.query("SELECT id FROM properties WHERE id = $1 AND owner_id = $2", [id, req.user.userId]);
        if (!ownerCheck.rows.length) return res.status(403).json({ success: false, message: "Not your property" });
        if (!images || images.length === 0) return res.status(400).json({ success: false, message: "No images provided" });

        const insertedImages = [];
        for (const image of images) {
            const imageId = randomUUID();
            await pool.query(
                `INSERT INTO property_images (id, property_id, url, alt_text, is_cover, sort_order)
                 VALUES ($1,$2,$3,$4,$5,$6)`,
                [imageId, id, image.url, image.alt_text || null, Boolean(image.is_cover), image.sort_order || 0]
            );
            const result = await pool.query("SELECT * FROM property_images WHERE id = $1", [imageId]);
            insertedImages.push(result.rows[0]);
        }
        res.status(201).json({ success: true, images: insertedImages });
    } catch (error) {
        console.error("Add images error:", error);
        res.status(500).json({ success: false, message: "Failed to add images" });
    }
});

module.exports = router;