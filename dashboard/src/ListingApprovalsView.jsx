import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabaseClient';

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatListingPrice(p) {
  const rent = p?.rent_usd != null ? `$${p.rent_usd}/mo` : null;
  const sale = p?.sale_price_usd != null ? `$${p.sale_price_usd}` : null;
  if (rent && sale) return `${rent} · ${sale} (sale)`;
  if (rent) return rent;
  if (sale) return `${sale} (sale)`;
  return 'Price on request';
}

export default function ListingApprovalsView({ onInspect, adminUser }) {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('pending'); // pending, rejected, all
  const [busyId, setBusyId] = useState(null);
  const [search, setSearch] = useState('');
  const [successBanner, setSuccessBanner] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [adminId, setAdminId] = useState(adminUser?.id || null);
  const [viewing, setViewing] = useState(null); // listing shown in detail modal
  const [lightbox, setLightbox] = useState(null); // full-screen image url

  useEffect(() => {
    setAdminId(adminUser?.id || null);
  }, [adminUser]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase
        .from('properties')
        .select(
          '*, property_images(url, alt_text, is_cover, sort_order), owner:profiles!owner_id(first_name, last_name, business_name, email, phone_number, avatar_url)'
        )
        .in('status', ['pending', 'rejected'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      setListings(data || []);
    } catch (e) {
      console.error('Error loading listing approvals:', e.message);
      setErrorMsg(e.message || 'Failed to load listings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDecision = async (id, approve) => {
    setBusyId(id);
    setSuccessBanner('');
    try {
      const newStatus = approve ? 'available' : 'rejected';
      const { error } = await supabase
        .from('properties')
        .update({
          status: newStatus,
          reviewed_at: new Date().toISOString(),
          reviewed_by: adminId,
        })
        .eq('id', id);
      if (error) throw error;

      const listing = listings.find((l) => l.id === id);
      const ownerId = listing?.owner_id;
      if (ownerId) {
        const msg = approve
          ? `Your listing "${listing.title}" has been approved and is now live on the marketplace.`
          : `Your listing "${listing.title}" was not approved. Please review our guidelines and resubmit.`;
        supabase
          .from('notifications')
          .insert({
            user_id: ownerId,
            type: approve ? 'listing_approved' : 'listing_rejected',
            title: approve ? 'Listing Approved! 🎉' : 'Listing Needs Attention',
            message: msg,
            body: msg,
            is_read: false,
            data: { propertyId: id },
          })
          .then(() => {}, (e) => console.warn('Notif:', e.message));
      }

      setSuccessBanner(
        `Listing successfully ${approve ? 'approved and published' : 'rejected'}.`
      );
      setTimeout(() => setSuccessBanner(''), 4000);
      load();
    } catch (e) {
      alert(`Listing approval error: ${e.message}`);
      load();
    } finally {
      setBusyId(null);
    }
  };

  const filtered = listings.filter((l) => {
    const matchesStatus = filterStatus === 'all' || l.status === filterStatus;
    const q = search.toLowerCase();
    const hay = `${l.title || ''} ${l.city || ''} ${l.suburb || ''} ${
      l.owner?.business_name || ''
    } ${l.owner?.email || ''}`.toLowerCase();
    return matchesStatus && (!q || hay.includes(q));
  });

  const pendingCount = listings.filter((l) => l.status === 'pending').length;

  const sortedImages = (l) =>
    Array.isArray(l.property_images)
      ? l.property_images.slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      : [];

  const cover = (l) => {
    const imgs = sortedImages(l);
    return imgs.length ? imgs[0].url : null;
  };

  return (
    <div>
      <div className="view-header">
        <div className="view-header-title">
          <h1>
            <i className="bi bi-building-check" style={{ color: 'var(--brand)' }}></i>
            Listing Approvals
          </h1>
          <p>Review newly submitted property listings and publish them to the marketplace or reject them.</p>
        </div>
        <div className="view-header-actions">
          <button className="sb-btn sb-btn-secondary" onClick={load}>
            <i className="bi bi-arrow-clockwise"></i> Refresh
          </button>
        </div>
      </div>

      {successBanner && (
        <div className="alert-box alert-box-success" style={{ marginBottom: 18 }}>
          <i className="bi bi-check-circle-fill"></i>
          <span>{successBanner}</span>
        </div>
      )}

      {errorMsg && (
        <div className="alert-box alert-box-error" style={{ marginBottom: 18 }}>
          <i className="bi bi-exclamation-triangle-fill"></i>
          <span>Could not load listings: {errorMsg}</span>
        </div>
      )}

      <div className="studio-card" style={{ marginBottom: 20 }}>
        <div className="filter-toolbar">
          <div className="filter-search-box">
            <i className="bi bi-search" style={{ color: 'var(--text-muted)' }}></i>
            <input
              placeholder="Search by title, location, agent…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="pending">⏳ Pending Review ({pendingCount})</option>
            <option value="rejected">✕ Rejected</option>
            <option value="all">All (Pending + Rejected)</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="empty-box">
          <span className="spinner" style={{ width: 30, height: 30 }}></span>
          <p style={{ marginTop: 12 }}>Loading listings…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="studio-card">
          <div className="empty-box">
            <i className="bi bi-check-circle" style={{ color: 'var(--brand)' }}></i>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: 6 }}>All Caught Up!</h3>
            <p>No listings matching the selected filter.</p>
          </div>
        </div>
      ) : (
        <div className="approvals-deck">
          {filtered.map((l) => {
            const owner = l.owner || {};
            const ownerName =
              owner.business_name ||
              `${owner.first_name || ''} ${owner.last_name || ''}`.trim() ||
              'Unknown agent';
            const img = cover(l);
            const imgs = sortedImages(l);
            return (
              <div key={l.id} className="approval-card">
                <div className="approval-card-head">
                  {img ? (
                    <img
                      src={img}
                      alt=""
                      style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="applicant-avatar">
                      <i className="bi bi-house"></i>
                    </div>
                  )}
                  <div className="applicant-details" style={{ flex: 1 }}>
                    <h4 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {l.title || 'Untitled Listing'}
                      <span
                        className={`status-dot-badge status-${
                          l.status === 'available' ? 'approved' : 'pending'
                        }`}
                      >
                        {l.status}
                      </span>
                    </h4>
                    <div className="applicant-sub">
                      {ownerName} · {[l.suburb, l.city].filter(Boolean).join(', ') || 'Zimbabwe'}
                    </div>
                  </div>
                </div>

                <div className="applicant-info-list">
                  <div className="info-item">
                    <i className="bi bi-tag"></i>
                    <span>Price: <strong>{formatListingPrice(l)}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-house-door"></i>
                    <span>Type: <strong>{l.property_type || 'apartment'}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-calendar"></i>
                    <span>Submitted: <strong>{timeAgo(l.created_at)}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-images"></i>
                    <span>Photos: <strong>{imgs.length}</strong></span>
                  </div>
                </div>

                {l.description && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      margin: '8px 0',
                      lineHeight: 1.45,
                    }}
                  >
                    {l.description.length > 160
                      ? l.description.slice(0, 160) + '…'
                      : l.description}
                  </div>
                )}

                <div className="approval-card-actions">
                  <button
                    className="sb-btn sb-btn-secondary sb-btn-sm"
                    onClick={() => setViewing(l)}
                  >
                    <i className="bi bi-eye"></i> View Listing
                  </button>
                  <button
                    className="sb-btn sb-btn-secondary sb-btn-sm"
                    onClick={() => onInspect('properties', l)}
                    title="Raw database record"
                  >
                    <i className="bi bi-code-square"></i> Raw
                  </button>
                  <div style={{ flex: 1 }}></div>
                  {l.status !== 'available' && (
                    <button
                      className="sb-btn sb-btn-primary sb-btn-sm"
                      disabled={busyId === l.id}
                      onClick={() => handleDecision(l.id, true)}
                    >
                      {busyId === l.id ? (
                        <span className="spinner"></span>
                      ) : (
                        <>
                          <i className="bi bi-check-lg"></i> Approve
                        </>
                      )}
                    </button>
                  )}
                  {l.status !== 'rejected' && (
                    <button
                      className="sb-btn sb-btn-danger sb-btn-sm"
                      disabled={busyId === l.id}
                      onClick={() => handleDecision(l.id, false)}
                    >
                      <i className="bi bi-x-lg"></i> Reject
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal with photo gallery + full info */}
      {viewing && (
        <div className="drawer-overlay" onClick={() => setViewing(null)}>
          <div
            className="inspector-drawer"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 600, width: '100%' }}
          >
            <div className="drawer-header">
              <h3>
                <i className="bi bi-house" style={{ color: 'var(--brand)' }}></i>
                Listing Details
                <span
                  className={`status-dot-badge status-${
                    viewing.status === 'available' ? 'approved' : 'pending'
                  }`}
                  style={{ marginLeft: 8 }}
                >
                  {viewing.status}
                </span>
              </h3>
              <button className="action-icon-btn" onClick={() => setViewing(null)}>
                <i className="bi bi-x-lg"></i>
              </button>
            </div>

            <div className="drawer-body">
              {/* Photo gallery */}
              <div className="drawer-section">
                <div className="drawer-section-title">
                  Photos ({sortedImages(viewing).length})
                </div>
                {sortedImages(viewing).length > 0 ? (
                  <div className="photo-thumbnails">
                    {sortedImages(viewing).map((img, i) => (
                      <img
                        key={i}
                        src={img.url}
                        alt={img.alt_text || ''}
                        onClick={() => setLightbox(img.url)}
                        title="Click to enlarge"
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    No photos uploaded for this listing.
                  </div>
                )}
              </div>

              {/* Full information */}
              <div className="drawer-section">
                <div className="drawer-section-title">Information</div>
                <div className="applicant-info-list">
                  <div className="info-item">
                    <i className="bi bi-tag"></i>
                    <span>Price: <strong>{formatListingPrice(viewing)}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-house-door"></i>
                    <span>Type: <strong>{viewing.property_type || 'apartment'}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-door-open"></i>
                    <span>Bedrooms: <strong>{viewing.bedrooms ?? '—'}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-water"></i>
                    <span>Bathrooms: <strong>{viewing.bathrooms ?? '—'}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-expand"></i>
                    <span>Area: <strong>{viewing.area_sqm ? `${viewing.area_sqm} m²` : '—'}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-geo-alt"></i>
                    <span>
                      Location: <strong>{[viewing.suburb, viewing.city].filter(Boolean).join(', ') || 'Zimbabwe'}</strong>
                    </span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-person"></i>
                    <span>
                      Agent:{' '}
                      <strong>
                        {(viewing.owner?.business_name ||
                          `${viewing.owner?.first_name || ''} ${viewing.owner?.last_name || ''}`.trim()) ||
                          'Unknown'}
                      </strong>
                    </span>
                  </div>
                  {viewing.owner?.email && (
                    <div className="info-item">
                      <i className="bi bi-envelope"></i>
                      <span>Email: <strong>{viewing.owner.email}</strong></span>
                    </div>
                  )}
                  {viewing.owner?.phone_number && (
                    <div className="info-item">
                      <i className="bi bi-telephone"></i>
                      <span>Phone: <strong>{viewing.owner.phone_number}</strong></span>
                    </div>
                  )}
                  <div className="info-item">
                    <i className="bi bi-calendar"></i>
                    <span>Submitted: <strong>{timeAgo(viewing.created_at)}</strong></span>
                  </div>
                </div>

                {viewing.description && (
                  <div
                    style={{
                      marginTop: 12,
                      fontSize: 13,
                      color: 'var(--text-secondary)',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {viewing.description}
                  </div>
                )}
              </div>
            </div>

            <div className="drawer-footer">
              <button className="sb-btn sb-btn-secondary" onClick={() => setViewing(null)}>
                Close
              </button>
              <div style={{ flex: 1 }}></div>
              {viewing.status !== 'available' && (
                <button
                  className="sb-btn sb-btn-primary sb-btn-sm"
                  disabled={busyId === viewing.id}
                  onClick={() => {
                    handleDecision(viewing.id, true);
                    setViewing(null);
                  }}
                >
                  <i className="bi bi-check-lg"></i> Approve
                </button>
              )}
              {viewing.status !== 'rejected' && (
                <button
                  className="sb-btn sb-btn-danger sb-btn-sm"
                  disabled={busyId === viewing.id}
                  onClick={() => {
                    handleDecision(viewing.id, false);
                    setViewing(null);
                  }}
                >
                  <i className="bi bi-x-lg"></i> Reject
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Full-screen image lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <img
            src={lightbox}
            alt=""
            style={{ maxWidth: '92%', maxHeight: '92%', borderRadius: 8 }}
          />
        </div>
      )}
    </div>
  );
}
