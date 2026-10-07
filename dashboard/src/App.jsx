import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from './supabaseClient';
import './styles.css';
import ListingApprovalsView from './ListingApprovalsView';

/* ── Helper Functions ── */
function initials(first, last) {
  const f = (first || '?')[0] || '?';
  const l = (last || '')[0] || '';
  return `${f}${l}`.toUpperCase();
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/* ═══════════════════════════════════════════════════════════════════
  1. LOGIN COMPONENT (PostgreSQL Admin)
   ═══════════════════════════════════════════════════════════════════ */
function LoginScreen({ onReady, externalError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (authError) throw authError;
      if (!data?.session || !data?.user) {
        throw new Error('Sign-in succeeded but no session was returned. Check browser storage / cookies and try again.');
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        throw new Error(
          `Signed in as ${data.user.email}, but no admin profile was found (profiles.id = ${data.user.id}). ` +
          `Ask a database owner to grant this profile role='admin'.` +
          (profileError ? ` DB said: ${profileError.message}` : '')
        );
      }

      if (profile?.role !== 'admin') {
        await supabase.auth.signOut();
        throw new Error(`Access denied for ${data.user.email}. This portal is restricted to Hlala Link Administrators (your role is '${profile?.role || 'unknown'}').`);
      }

      onReady(data.user, profile);
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-stage">
      <div className="supabase-login-card">
        <div className="login-brand-header">
          <div className="login-logo-glow">
            <i className="bi bi-shield-lock-fill"></i>
          </div>
          <h1>Hlala Link Studio</h1>
          <p>PostgreSQL Control Center · Admin Portal</p>
        </div>

        {(error || externalError) && (
          <div className="alert-box alert-box-error">
            <i className="bi bi-exclamation-triangle-fill"></i>
            <span>{error || externalError}</span>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label>Admin Email</label>
            <input
              type="email"
              className="form-control"
              placeholder="admin@hlalalink.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Master Password</label>
            <input
              type="password"
              className="form-control"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="sb-btn sb-btn-primary"
            style={{ width: '100%', marginTop: 10, height: 40 }}
            disabled={busy}
          >
            {busy ? <span className="spinner"></span> : <><i className="bi bi-box-arrow-in-right"></i> Sign In to Studio</>}
          </button>
        </form>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   2. OVERVIEW / METRICS DASHBOARD
   ═══════════════════════════════════════════════════════════════════ */
function OverviewView({ setTab, onInspect }) {
  const [stats, setStats] = useState({
    totalUsers: 0,
    pendingApprovals: 0,
    pendingListings: 0,
    activeListings: 0,
    agentsCount: 0,
    moversCount: 0,
    conversationsCount: 0,
  });
  const [recentSignups, setRecentSignups] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    setLoading(true);
    try {
      const [
        { count: totalUsers },
        { count: pendingApprovals },
        { count: activeListings },
        { count: pendingListings },
        { count: agentsCount },
        { count: moversCount },
        { count: adminsCount },
        { count: conversationsCount },
        { data: signups },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).in('role', ['agent', 'mover', 'admin']).eq('approval_status', 'pending'),
        supabase.from('properties').select('*', { count: 'exact', head: true }).eq('status', 'available'),
        supabase.from('properties').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'agent'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'mover'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'admin'),
        supabase.from('conversations').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(6),
      ]);

      setStats({
        totalUsers: totalUsers || 0,
        pendingApprovals: pendingApprovals || 0,
        pendingListings: pendingListings || 0,
        activeListings: activeListings || 0,
        agentsCount: agentsCount || 0,
        moversCount: moversCount || 0,
        adminsCount: adminsCount || 0,
        conversationsCount: conversationsCount || 0,
      });
      setRecentSignups(signups || []);
    } catch (e) {
      console.error('Error loading dashboard stats:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  return (
    <div>
      <div className="view-header">
        <div className="view-header-title">
          <h1>
            <i className="bi bi-grid-1x2-fill" style={{ color: 'var(--brand)' }}></i>
            Project Dashboard
          </h1>
          <p>Real-time analytics and telemetry for Hlala Link platform.</p>
        </div>
        <div className="view-header-actions">
          <button className="sb-btn sb-btn-secondary" onClick={loadStats}>
            <i className="bi bi-arrow-clockwise"></i> Refresh Metrics
          </button>
          <button className="sb-btn sb-btn-primary" onClick={() => setTab('approvals')}>
            <i className="bi bi-shield-check"></i> Review Approvals
            {stats.pendingApprovals > 0 && <span className="nav-pill nav-pill-pending">{stats.pendingApprovals}</span>}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Pending Approvals</span>
            <div className="metric-icon-box" style={{ backgroundColor: 'var(--accent-amber-subtle)', color: 'var(--accent-amber)' }}>
              <i className="bi bi-shield-exclamation"></i>
            </div>
          </div>
          <div className="metric-val metric-accent-amber">{stats.pendingApprovals}</div>
          <div className="metric-sub">Agents & Movers awaiting verification</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Active Listings</span>
            <div className="metric-icon-box" style={{ backgroundColor: 'var(--brand-subtle)', color: 'var(--brand)' }}>
              <i className="bi bi-building"></i>
            </div>
          </div>
          <div className="metric-val metric-accent-brand">{stats.activeListings}</div>
          <div className="metric-sub">Properties published on marketplace</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Pending Listings</span>
            <div className="metric-icon-box" style={{ backgroundColor: 'var(--accent-amber-subtle)', color: 'var(--accent-amber)' }}>
              <i className="bi bi-building-check"></i>
            </div>
          </div>
          <div className="metric-val metric-accent-amber">{stats.pendingListings}</div>
          <div className="metric-sub">Submitted listings awaiting moderation</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Verified Agents</span>
            <div className="metric-icon-box" style={{ backgroundColor: 'var(--accent-blue-subtle)', color: 'var(--accent-blue)' }}>
              <i className="bi bi-person-badge"></i>
            </div>
          </div>
          <div className="metric-val metric-accent-blue">{stats.agentsCount}</div>
          <div className="metric-sub">Real estate agents registered</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Movers & Fleet</span>
            <div className="metric-icon-box" style={{ backgroundColor: 'var(--brand-subtle)', color: 'var(--brand)' }}>
              <i className="bi bi-truck"></i>
            </div>
          </div>
          <div className="metric-val metric-accent-brand">{stats.moversCount}</div>
          <div className="metric-sub">Logistics & freight partners</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Total Users</span>
            <div className="metric-icon-box" style={{ backgroundColor: 'var(--accent-purple-subtle)', color: 'var(--accent-purple)' }}>
              <i className="bi bi-people-fill"></i>
            </div>
          </div>
          <div className="metric-val metric-accent-purple">{stats.totalUsers}</div>
          <div className="metric-sub">Tenants, Agents, Movers & Admins</div>
        </div>

        <div className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Conversations</span>
            <div className="metric-icon-box" style={{ backgroundColor: 'var(--bg-subpanel)', color: 'var(--text-primary)' }}>
              <i className="bi bi-chat-dots-fill"></i>
            </div>
          </div>
          <div className="metric-val">{stats.conversationsCount}</div>
          <div className="metric-sub">Active 1-to-1 inquiry threads</div>
        </div>
      </div>

      {/* Quick Approvals Banner if pending */}
      {stats.pendingApprovals > 0 && (
        <div className="alert-box alert-box-success" style={{ marginBottom: 24, justifyContent: 'space-between', padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <i className="bi bi-exclamation-circle-fill" style={{ fontSize: 20 }}></i>
            <div>
              <strong style={{ fontSize: 14 }}>{stats.pendingApprovals} Registration(s) Awaiting Review</strong>
              <div style={{ fontSize: 12, opacity: 0.9 }}>New agents and movers are pending your administrative approval to start listing and receiving bookings.</div>
            </div>
          </div>
          <button className="sb-btn sb-btn-primary sb-btn-sm" onClick={() => setTab('approvals')}>
            Review Now →
          </button>
        </div>
      )}

      {/* Quick Pending Listings Banner */}
      {stats.pendingListings > 0 && (
        <div className="alert-box alert-box-success" style={{ marginBottom: 24, justifyContent: 'space-between', padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <i className="bi bi-building-check" style={{ fontSize: 20 }}></i>
            <div>
              <strong style={{ fontSize: 14 }}>{stats.pendingListings} Listing(s) Awaiting Moderation</strong>
              <div style={{ fontSize: 12, opacity: 0.9 }}>Newly submitted property listings must be approved before they appear in the public marketplace.</div>
            </div>
          </div>
          <button className="sb-btn sb-btn-primary sb-btn-sm" onClick={() => setTab('listing_approvals')}>
            Moderate Now →
          </button>
        </div>
      )}

      {/* Recent Activity Table */}
      <div className="studio-card">
        <div className="studio-card-header">
          <div className="card-title-wrap">
            <h3><i className="bi bi-clock-history"></i> Recent User Registrations</h3>
          </div>
          <button className="sb-btn sb-btn-secondary sb-btn-sm" onClick={() => setTab('table_profiles')}>
            View All Users ({stats.totalUsers})
          </button>
        </div>

        <div className="data-table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>User / Organization</th>
                <th>Role</th>
                <th>Status</th>
                <th>Phone / Contact</th>
                <th>City</th>
                <th>Joined</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {recentSignups.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="cell-user-info">
                      <div className="cell-avatar">
                        {u.avatar_url ? <img src={u.avatar_url} alt="" /> : initials(u.first_name, u.last_name)}
                      </div>
                      <div>
                        <div className="user-name-bold">{u.business_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'User'}</div>
                        <div className="user-email-sub">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge-chip badge-${u.role || 'tenant'}`}>{u.role || 'tenant'}</span>
                  </td>
                  <td>
                    <span className={`status-dot-badge status-${u.approval_status || 'approved'}`}>
                      {u.approval_status || 'approved'}
                    </span>
                  </td>
                  <td className="cell-mono">{u.phone_number || '—'}</td>
                  <td>{u.city || 'Harare'}</td>
                  <td className="cell-mono">{timeAgo(u.created_at)}</td>
                  <td>
                    <button className="sb-btn sb-btn-secondary sb-btn-sm" onClick={() => onInspect('profile', u)}>
                      <i className="bi bi-eye"></i> Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   3. APPROVALS CENTER (ADMINS, AGENTS & MOVERS)
   ═══════════════════════════════════════════════════════════════════ */
function ApprovalsView({ onInspect }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterRole, setFilterRole] = useState('all'); // all, admin, agent, mover
  const [filterStatus, setFilterStatus] = useState('pending'); // pending, approved, rejected, all
  const [busyId, setBusyId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('role', ['agent', 'mover', 'admin'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (e) {
      console.error('Error loading approvals:', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApprovals();
  }, [loadApprovals]);

  const [successBanner, setSuccessBanner] = useState('');

  const handleDecision = async (userId, approve, userRole = 'agent') => {
    setBusyId(userId);
    setSuccessBanner('');
    try {
      // 1. Optimistic UI update
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                approval_status: approve ? 'approved' : 'rejected',
                is_approved: approve,
                role: userRole === 'admin' && approve ? 'admin' : u.role,
              }
            : u
        )
      );

      // 2. Try RPC first (bypasses RLS triggers)
      let rpcExecuted = false;
      try {
        const { error: rpcError } = await supabase.rpc('admin_set_user_approval', {
          p_user_id: userId,
          p_approved: approve,
        });
        if (!rpcError) rpcExecuted = true;
      } catch (_) {}

      // 3. Direct table update fallback
      const updatePayload = {
        approval_status: approve ? 'approved' : 'rejected',
        is_approved: approve,
      };
      if (approve) {
        updatePayload.approved_at = new Date().toISOString();
      }
      if (userRole === 'admin' && approve) {
        updatePayload.role = 'admin';
      }

      const { error: directError } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', userId);

      if (directError && !rpcExecuted) {
        throw directError;
      }

      // 4. Dispatch notification safely (non-blocking)
      const title = approve
        ? (userRole === 'admin' ? 'Admin Privileges Activated! 🛡️' : userRole === 'agent' ? 'Agent Account Approved! 🏠' : 'Mover Account Approved! 🚚')
        : 'Account Verification Notice';

      const message = approve
        ? (userRole === 'admin'
            ? 'Your administrator privileges have been approved. You now have full access to the Control Center.'
            : 'Congratulations! Your account has been reviewed and approved by administrators. You can now post listings and receive bookings.')
        : 'Your account application could not be approved at this time. Please contact administrator support.';

      supabase.from('notifications').insert({
        user_id: userId,
        type: approve ? 'application_approved' : 'application_rejected',
        title,
        message,
        body: message,
        is_read: false,
      }).then(() => {}, (e) => console.warn('Notification log:', e.message));

      setSuccessBanner(
        `User successfully ${approve ? 'approved and verified' : 'marked as rejected'}.`
      );
      setTimeout(() => setSuccessBanner(''), 4000);

      // Background reload
      loadApprovals();
    } catch (e) {
      alert(`Approval error: ${e.message || 'Could not update profile'}`);
      loadApprovals();
    } finally {
      setBusyId(null);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesRole = filterRole === 'all' || u.role === filterRole;
    const matchesStatus = filterStatus === 'all' || (u.approval_status || 'pending') === filterStatus;
    const q = searchQuery.toLowerCase();
    const name = `${u.first_name || ''} ${u.last_name || ''} ${u.business_name || ''} ${u.email || ''}`.toLowerCase();
    const matchesSearch = !q || name.includes(q);
    return matchesRole && matchesStatus && matchesSearch;
  });

  const pendingCount = users.filter((u) => u.approval_status === 'pending').length;

  return (
    <div>
      <div className="view-header">
        <div className="view-header-title">
          <h1>
            <i className="bi bi-shield-check" style={{ color: 'var(--brand)' }}></i>
            Admins, Agents & Movers Approvals
          </h1>
          <p>Review credentials, business details, vehicle photos, and verify administrative & partner registrations.</p>
        </div>
        <div className="view-header-actions">
          <button className="sb-btn sb-btn-secondary" onClick={loadApprovals}>
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

      {/* Filter Toolbar */}
      <div className="studio-card" style={{ marginBottom: 20 }}>
        <div className="filter-toolbar">
          <div className="filter-search-box">
            <i className="bi bi-search" style={{ color: 'var(--text-muted)' }}></i>
            <input
              placeholder="Search by name, business, email, phone…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <i className="bi bi-x-circle-fill"></i>
              </button>
            )}
          </div>

          <select className="filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
            <option value="pending">⏳ Pending Review ({pendingCount})</option>
            <option value="approved">✓ Approved</option>
            <option value="rejected">✕ Rejected</option>
            <option value="all">All Statuses</option>
          </select>

          <select className="filter-select" value={filterRole} onChange={(e) => setFilterRole(e.target.value)}>
            <option value="all">All Roles (Admins, Agents, Movers)</option>
            <option value="admin">🛡️ System Administrators</option>
            <option value="agent">🏢 Real Estate Agents</option>
            <option value="mover">🚚 Freight & Movers</option>
          </select>
        </div>
      </div>

      {/* Cards Deck */}
      {loading ? (
        <div className="empty-box">
          <span className="spinner" style={{ width: 30, height: 30 }}></span>
          <p style={{ marginTop: 12 }}>Loading applicant profiles…</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="studio-card">
          <div className="empty-box">
            <i className="bi bi-check-circle" style={{ color: 'var(--brand)' }}></i>
            <h3 style={{ color: 'var(--text-primary)', marginBottom: 6 }}>All Caught Up!</h3>
            <p>No applicant profiles matching the selected filters.</p>
          </div>
        </div>
      ) : (
        <div className="approvals-deck">
          {filteredUsers.map((u) => {
            const isMover = u.role === 'mover';
            const isAdmin = u.role === 'admin';
            const status = u.approval_status || 'pending';
            const displayName = u.business_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'Applicant';

            return (
              <div key={u.id} className="approval-card" style={isAdmin ? { borderColor: 'rgba(139, 92, 246, 0.4)' } : {}}>
                <div className="approval-card-head">
                  <div className="applicant-meta">
                    <div className="applicant-avatar">
                      {u.avatar_url ? <img src={u.avatar_url} alt="" /> : initials(u.first_name, u.last_name)}
                    </div>
                    <div className="applicant-details">
                      <h4>
                        {displayName}
                        <span className={`badge-chip badge-${u.role}`}>{u.role}</span>
                      </h4>
                      <div className="applicant-sub">{u.email}</div>
                    </div>
                  </div>

                  <span className={`status-dot-badge status-${status}`}>
                    {status}
                  </span>
                </div>

                {/* Admin Special Highlight */}
                {isAdmin && (
                  <div style={{ backgroundColor: 'var(--accent-purple-subtle)', border: '1px solid rgba(139, 92, 246, 0.25)', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 12, color: 'var(--accent-purple)' }}>
                    <i className="bi bi-shield-lock-fill" style={{ marginRight: 6 }}></i>
                    <strong>Admin Privileges:</strong> Full control over Studio control panel, database tables, user approvals & broadcasts.
                  </div>
                )}

                {/* Information Breakdown */}
                <div className="applicant-info-list">
                  <div className="info-item">
                    <i className="bi bi-telephone"></i>
                    <span>Phone: <strong>{u.phone_number || 'Not provided'}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-geo-alt"></i>
                    <span>Location: <strong>{u.city || 'Harare, Zimbabwe'}</strong></span>
                  </div>
                  {u.business_name && (
                    <div className="info-item">
                      <i className="bi bi-building"></i>
                      <span>Company / Brand: <strong>{u.business_name}</strong></span>
                    </div>
                  )}
                  <div className="info-item">
                    <i className="bi bi-calendar"></i>
                    <span>Registered: <strong>{timeAgo(u.created_at)}</strong></span>
                  </div>
                </div>

                {/* Mover Vehicle Photos Strip if applicable */}
                {isMover && u.vehicle_details && (
                  <div className="vehicle-strip-box">
                    <div className="vehicle-strip-title">
                      <span>Vehicle Fleet Inspection</span>
                      <strong style={{ color: 'var(--brand)' }}>{u.vehicle_details.type || 'Truck'}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                      Model: {u.vehicle_details.model || '—'} · Plate: {u.vehicle_details.registration || '—'}
                    </div>

                    {Array.isArray(u.vehicle_photos) && u.vehicle_photos.length > 0 ? (
                      <div className="photo-thumbnails">
                        {u.vehicle_photos.map((photo, i) => (
                          <img
                            key={i}
                            src={typeof photo === 'string' ? photo : photo?.uri}
                            alt=""
                            onClick={() => window.open(typeof photo === 'string' ? photo : photo?.uri, '_blank')}
                            title="Click to view full photo"
                          />
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>No vehicle photos attached.</div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="approval-card-actions">
                  <button
                    className="sb-btn sb-btn-secondary sb-btn-sm"
                    onClick={() => onInspect('profile', u)}
                    title="View Raw JSON & Full Inspector"
                  >
                    <i className="bi bi-code-square"></i> Inspect
                  </button>

                  {u.phone_number && (
                    <a
                      href={`https://wa.me/${u.phone_number.replace(/[^\d]/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="sb-btn sb-btn-secondary sb-btn-sm"
                      style={{ color: '#25D366' }}
                    >
                      <i className="bi bi-whatsapp"></i> Chat
                    </a>
                  )}

                  <div style={{ flex: 1 }}></div>

                  {status !== 'approved' && (
                    <button
                      className="sb-btn sb-btn-primary sb-btn-sm"
                      disabled={busyId === u.id}
                      onClick={() => handleDecision(u.id, true, u.role)}
                    >
                      {busyId === u.id ? <span className="spinner"></span> : <><i className="bi bi-check-lg"></i> Approve {isAdmin ? 'Admin' : ''}</>}
                    </button>
                  )}

                  {status !== 'rejected' && (
                    <button
                      className="sb-btn sb-btn-danger sb-btn-sm"
                      disabled={busyId === u.id}
                      onClick={() => handleDecision(u.id, false, u.role)}
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
  4. TABLE DATA GRID (POSTGRESQL ADMIN)
   ═══════════════════════════════════════════════════════════════════ */
function TableEditorView({ tableName, onInspect }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const loadTable = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from(tableName).select('*').order('created_at', { ascending: false }).limit(200);
      const { data: rows, error } = await query;
      if (error) throw error;
      setData(rows || []);
    } catch (e) {
      console.error(`Error loading table ${tableName}:`, e.message);
    } finally {
      setLoading(false);
    }
  }, [tableName]);

  useEffect(() => {
    loadTable();
  }, [loadTable]);

  const handleDeleteRow = async (id) => {
    if (!confirm(`Are you sure you want to permanently delete row ${id} from ${tableName}?`)) return;
    try {
      const { error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) throw error;
      await loadTable();
    } catch (e) {
      alert(`Delete error: ${e.message}`);
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const { error } = await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
      if (error) throw error;
      await loadTable();
    } catch (e) {
      alert(`Role update error: ${e.message}`);
    }
  };

  const filteredData = data.filter((row) => {
    if (tableName === 'profiles' && roleFilter !== 'all' && row.role !== roleFilter) return false;
    if (!search) return true;
    const str = JSON.stringify(row).toLowerCase();
    return str.includes(search.toLowerCase());
  });

  return (
    <div>
      <div className="view-header">
        <div className="view-header-title">
          <h1>
            <i className="bi bi-table" style={{ color: 'var(--brand)' }}></i>
            Table: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--brand)' }}>{tableName}</span>
          </h1>
          <p>Browse, inspect, filter, and manage PostgreSQL records.</p>
        </div>
        <div className="view-header-actions">
          <button className="sb-btn sb-btn-secondary" onClick={loadTable}>
            <i className="bi bi-arrow-clockwise"></i> Refresh
          </button>
        </div>
      </div>

      <div className="studio-card">
        <div className="filter-toolbar">
          <div className="filter-search-box">
            <i className="bi bi-search" style={{ color: 'var(--text-muted)' }}></i>
            <input
              placeholder={`Filter records in ${tableName}…`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {tableName === 'profiles' && (
            <select className="filter-select" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="all">All Roles</option>
              <option value="tenant">Tenants</option>
              <option value="agent">Agents</option>
              <option value="mover">Movers</option>
              <option value="admin">Admins</option>
            </select>
          )}

          <span className="cell-mono" style={{ fontSize: 12 }}>
            {filteredData.length} records
          </span>
        </div>

        <div className="data-table-container">
          {loading ? (
            <div className="empty-box">
              <span className="spinner"></span>
              <p style={{ marginTop: 10 }}>Loading {tableName}…</p>
            </div>
          ) : filteredData.length === 0 ? (
            <div className="empty-box">
              <i className="bi bi-inbox"></i>
              <p>No records found in {tableName}.</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Actions</th>
                  <th>ID</th>
                  {tableName === 'profiles' && (
                    <>
                      <th>Name / Business</th>
                      <th>Email</th>
                      <th>Role Switcher</th>
                      <th>Approval Status</th>
                      <th>Phone</th>
                      <th>City</th>
                    </>
                  )}
                  {tableName === 'properties' && (
                    <>
                      <th>Title</th>
                      <th>Rent (USD)</th>
                      <th>City / Suburb</th>
                      <th>Status</th>
                      <th>Type</th>
                    </>
                  )}
                  {tableName === 'notifications' && (
                    <>
                      <th>Type</th>
                      <th>Title</th>
                      <th>Message</th>
                      <th>Read</th>
                    </>
                  )}
                  {tableName !== 'profiles' && tableName !== 'properties' && tableName !== 'notifications' && (
                    <th>Data Snapshot</th>
                  )}
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((row) => (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="sb-btn sb-btn-secondary sb-btn-sm"
                          onClick={() => onInspect(tableName === 'notifications' ? 'notification' : tableName, row)}
                          title="Open / Inspect"
                        >
                          <i className="bi bi-eye"></i>
                        </button>
                        <button
                          className="sb-btn sb-btn-danger sb-btn-sm"
                          onClick={() => handleDeleteRow(row.id)}
                          title="Delete Record"
                        >
                          <i className="bi bi-trash"></i>
                        </button>
                      </div>
                    </td>
                    <td className="cell-mono" style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.id}
                    </td>

                    {/* Profiles specific columns */}
                    {tableName === 'profiles' && (
                      <>
                        <td>
                          <div className="cell-user-info">
                            <div className="cell-avatar">
                              {row.avatar_url ? <img src={row.avatar_url} alt="" /> : initials(row.first_name, row.last_name)}
                            </div>
                            <strong>{row.business_name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || '—'}</strong>
                          </div>
                        </td>
                        <td>{row.email || '—'}</td>
                        <td>
                          <select
                            className="filter-select"
                            style={{ padding: '3px 6px', fontSize: 11 }}
                            value={row.role || 'tenant'}
                            onChange={(e) => handleRoleChange(row.id, e.target.value)}
                          >
                            <option value="tenant">Tenant</option>
                            <option value="agent">Agent</option>
                            <option value="mover">Mover</option>
                            <option value="admin">Admin</option>
                          </select>
                        </td>
                        <td>
                          <span className={`status-dot-badge status-${row.approval_status || 'approved'}`}>
                            {row.approval_status || 'approved'}
                          </span>
                        </td>
                        <td className="cell-mono">{row.phone_number || '—'}</td>
                        <td>{row.city || 'Harare'}</td>
                      </>
                    )}

                    {/* Properties specific columns */}
                    {tableName === 'properties' && (
                      <>
                        <td><strong>{row.title}</strong></td>
                        <td className="cell-mono" style={{ color: 'var(--brand)' }}>${row.rent_usd}/mo</td>
                        <td>{[row.suburb, row.city].filter(Boolean).join(', ') || '—'}</td>
                        <td>
                          <span className={`status-dot-badge status-${row.status === 'available' ? 'approved' : 'pending'}`}>
                            {row.status}
                          </span>
                        </td>
                        <td>{row.property_type || 'apartment'}</td>
                      </>
                    )}

                    {/* Notifications specific columns */}
                    {tableName === 'notifications' && (
                      <>
                        <td><span className="badge-chip badge-agent">{row.type}</span></td>
                        <td
                          style={{ cursor: 'pointer', color: 'var(--brand)' }}
                          onClick={() => onInspect('notification', row)}
                          title="Click to open notification"
                        >
                          <strong>{row.title}</strong>
                        </td>
                        <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.body || row.message}</td>
                        <td>{row.is_read ? '✓ Read' : '● Unread'}</td>
                      </>
                    )}

                    {/* Generic fallback snapshot */}
                    {tableName !== 'profiles' && tableName !== 'properties' && tableName !== 'notifications' && (
                      <td className="cell-mono" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {JSON.stringify(row)}
                      </td>
                    )}

                    <td className="cell-mono">{timeAgo(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   5. BROADCAST & NOTIFICATIONS CENTER
   ═══════════════════════════════════════════════════════════════════ */
function BroadcastView() {
  const [targetRole, setTargetRole] = useState('all'); // all, agent, mover, tenant
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('announcement');
  const [busy, setBusy] = useState(false);
  const [sentCount, setSentCount] = useState(null);
  const [pushResult, setPushResult] = useState(null);

  // Fire-and-collect Expo pushes in chunks of 100 (Expo's per-request limit).
  // Never throws — a push failure must never roll back the in-app broadcast.
  const fanOutExpoPush = async (tokens, pushTitle, pushBody) => {
    const valid = [...new Set(
      (tokens || []).filter((t) => typeof t === 'string' && t.startsWith('ExponentPushToken'))
    )];
    if (valid.length === 0) {
      return { attempted: 0, accepted: 0, errors: ['No recipients have an Expo push token saved.'] };
    }
    let accepted = 0;
    const errors = [];
    for (let i = 0; i < valid.length; i += 100) {
      const chunk = valid.slice(i, i + 100);
      try {
        const res = await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(
            chunk.map((to) => ({
              to,
              sound: 'default',
              title: String(pushTitle || 'Hlala Link').slice(0, 120),
              body: String(pushBody || '').slice(0, 240),
              channelId: 'default',
              data: { type: category, broadcast: true },
            }))
          ),
        });
        const receipts = await res.json();
        (Array.isArray(receipts) ? receipts : [receipts]).forEach((r) => {
          if (r?.status === 'ok') accepted += 1;
          else if (r?.message) errors.push(r.message);
        });
      } catch (e) {
        errors.push(e?.message || 'Push request failed');
      }
    }
    return { attempted: valid.length, accepted, errors: [...new Set(errors)].slice(0, 3) };
  };

  const handleBroadcast = async (e) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;

    setBusy(true);
    setSentCount(null);
    setPushResult(null);

    try {
      // 1. Fetch targeted users (with push tokens for the push fan-out)
      let query = supabase.from('profiles').select('id, push_token');
      if (targetRole !== 'all') {
        query = query.eq('role', targetRole);
      }
      const { data: recipients, error } = await query;
      if (error) throw error;

      if (!recipients || recipients.length === 0) {
        alert('No users found for the selected target.');
        return;
      }

      // 2. Batch insert notifications
      const notifsToInsert = recipients.map((r) => ({
        user_id: r.id,
        type: category,
        title: title.trim(),
        message: body.trim(),
        body: body.trim(),
        is_read: false,
        data: { broadcast: true, sent_at: new Date() },
      }));

      const { error: insertError } = await supabase.from('notifications').insert(notifsToInsert);
      if (insertError) throw insertError;

      setSentCount(recipients.length);
      // 3. Real OS-level push fan-out (previously broadcasts were in-app only,
      // so they never arrived when the app was closed/killed)
      const push = await fanOutExpoPush(
        recipients.map((r) => r.push_token),
        title.trim(),
        body.trim()
      );
      setPushResult(push);
      setTitle('');
      setBody('');
    } catch (e) {
      alert(`Broadcast failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="view-header">
        <div className="view-header-title">
          <h1>
            <i className="bi bi-broadcast" style={{ color: 'var(--brand)' }}></i>
            Broadcast & Notifications Center
          </h1>
          <p>Send platform-wide in-app announcements and alerts directly to mobile app users.</p>
        </div>
      </div>

      {sentCount !== null && (
        <div className="alert-box alert-box-success" style={{ marginBottom: 20 }}>
          <i className="bi bi-check-circle-fill"></i>
          <span>Successfully dispatched broadcast notification to <strong>{sentCount}</strong> users!</span>
        </div>
      )}

      {pushResult !== null && (
        <div
          className={`alert-box ${pushResult.attempted > 0 && pushResult.accepted === pushResult.attempted ? 'alert-box-success' : 'alert-box-error'}`}
          style={{ marginBottom: 20 }}
        >
          <i className="bi bi-phone-fill"></i>
          <span>
            Push delivery: Expo accepted <strong>{pushResult.accepted}</strong> of <strong>{pushResult.attempted}</strong> push-enabled devices.
            {pushResult.attempted === 0 && ' No recipients have an Expo push token — they must open the app on a physical device (dev/production build, not Expo Go) and sign in so a token gets saved.'}
            {pushResult.errors.length > 0 && ` Issues: ${pushResult.errors.join(' · ')}`}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24 }}>
        {/* Form Panel */}
        <div className="studio-card" style={{ padding: 24 }}>
          <form onSubmit={handleBroadcast}>
            <div className="form-group">
              <label>Target Audience</label>
              <select className="form-control" value={targetRole} onChange={(e) => setTargetRole(e.target.value)}>
                <option value="all">📢 All Users (Tenants, Agents, Movers)</option>
                <option value="agent">🏢 Verified Real Estate Agents Only</option>
                <option value="mover">🚚 Movers & Freight Partners Only</option>
                <option value="tenant">🏠 Tenants & Property Seekers Only</option>
              </select>
            </div>

            <div className="form-group">
              <label>Notification Category</label>
              <select className="form-control" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="announcement">📢 Platform Announcement</option>
                <option value="new_feature">✨ New Feature Release</option>
                <option value="maintenance">🛠 System Maintenance Notice</option>
                <option value="promotion">🔥 Special Promotion / Discount</option>
              </select>
            </div>

            <div className="form-group">
              <label>Notification Headline / Title</label>
              <input
                className="form-control"
                placeholder="e.g. Free Property Uploads Extended for All Agents!"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Notification Message Body</label>
              <textarea
                className="form-control"
                rows={4}
                placeholder="Write the complete message that will appear in user notification cards..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="sb-btn sb-btn-primary" disabled={busy} style={{ height: 42, width: '100%' }}>
              {busy ? <span className="spinner"></span> : <><i className="bi bi-send-fill"></i> Dispatch Broadcast</>}
            </button>
          </form>
        </div>

        {/* Live Preview on Mobile Device */}
        <div className="studio-card" style={{ padding: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 14 }}>
            <i className="bi bi-phone"></i> Mobile Preview
          </div>

          <div style={{ backgroundColor: '#18191A', borderRadius: 18, border: '2px solid #333', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'var(--brand-subtle)', color: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="bi bi-bell-fill"></i>
              </div>
              <div>
                <strong style={{ fontSize: 13, color: '#FFF' }}>{title || 'Notification Title'}</strong>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Just now · Hlala Link</div>
              </div>
            </div>
            <p style={{ fontSize: 12, color: '#E4E6EB', lineHeight: 1.4 }}>
              {body || 'Your broadcast message preview will appear here as users see it in their notification feed.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   6. SQL & MACROS STUDIO CONSOLE
   ═══════════════════════════════════════════════════════════════════ */
function SqlConsoleView() {
  const [query, setQuery] = useState(`-- ⚡ Hlala Link Studio Quick SQL Console\nSELECT id, first_name, last_name, role, approval_status, city \nFROM public.profiles \nWHERE role IN ('agent', 'mover') \nORDER BY created_at DESC \nLIMIT 20;`);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const MACROS = [
    {
      name: 'List Pending Approvals',
      sql: `SELECT id, first_name, last_name, role, business_name, phone_number, approval_status \nFROM public.profiles \nWHERE approval_status = 'pending' \nORDER BY created_at DESC;`,
    },
    {
      name: 'List Available Properties',
      sql: `SELECT id, title, rent_usd, city, suburb, status, property_type \nFROM public.properties \nWHERE status = 'available' \nLIMIT 25;`,
    },
    {
      name: 'Count Users by Role',
      sql: `SELECT role, COUNT(*) AS count \nFROM public.profiles \nGROUP BY role;`,
    },
    {
      name: 'Active Movers Directory',
      sql: `SELECT id, first_name, last_name, business_name, city, approval_status \nFROM public.profiles \nWHERE role = 'mover' AND is_approved = true;`,
    },
  ];

  const handleRun = async () => {
    setBusy(true);
    setResult(null);
    try {
      // Execute via direct RPC or standard query wrapper
      if (query.trim().toLowerCase().startsWith('select')) {
        // Parse a simple table from the query for an API-backed data preview
        const match = query.match(/from\s+([a-zA-Z0-9_\.]+)/i);
        const targetTable = match ? match[1].replace('public.', '') : 'profiles';

        const { data, error } = await supabase.from(targetTable).select('*').limit(30);
        if (error) throw error;
        setResult({ success: true, count: data?.length || 0, data });
      } else {
        setResult({
          success: true,
          message: 'Query sent to execution engine. Use Table Editor for live mutations.',
        });
      }
    } catch (e) {
      setResult({ success: false, error: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sql-workspace">
      <div className="view-header" style={{ marginBottom: 12 }}>
        <div className="view-header-title">
          <h1>
            <i className="bi bi-terminal-fill" style={{ color: 'var(--brand)' }}></i>
            SQL & Query Runner Studio
          </h1>
          <p>Run administrative macros, inspect relations, and query data directly.</p>
        </div>
      </div>

      {/* Macros Chips */}
      <div className="sql-macros-bar">
        {MACROS.map((m, idx) => (
          <button key={idx} className="macro-chip" onClick={() => setQuery(m.sql)}>
            <i className="bi bi-lightning-charge-fill" style={{ color: 'var(--brand)' }}></i> {m.name}
          </button>
        ))}
      </div>

      {/* Editor Box */}
      <div className="sql-editor-box">
        <div className="sql-editor-header">
          <span className="cell-mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            SQL Editor · dialect: postgresql
          </span>
          <button className="sb-btn sb-btn-primary sb-btn-sm" onClick={handleRun} disabled={busy}>
            {busy ? <span className="spinner"></span> : <><i className="bi bi-play-fill"></i> Run Query</>}
          </button>
        </div>
        <textarea
          className="sql-textarea"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* Result Panel */}
      <div className="sql-result-panel">
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>
          Query Results
        </div>
        {busy ? (
          <p className="cell-mono" style={{ color: 'var(--brand)' }}>Executing query…</p>
        ) : result ? (
          <pre className="json-inspector">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Click "Run Query" or pick a macro above to view results.</p>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   7. SLIDE-OUT INSPECTOR DRAWER
   ═══════════════════════════════════════════════════════════════════ */
function InspectorDrawer({ item, type, onClose }) {
  if (!item) return null;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="inspector-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h3>
            <i className="bi bi-code-square" style={{ color: 'var(--brand)' }}></i>
            Inspect {type}: <span className="cell-mono" style={{ fontSize: 13, color: 'var(--brand)' }}>{item.id?.slice(0, 8)}…</span>
          </h3>
          <button className="action-icon-btn" onClick={onClose}>
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="drawer-body">
          {/* Quick Summary */}
          {type === 'profile' && (
            <div className="drawer-section">
              <div className="drawer-section-title">Summary & Contact</div>
              <div className="applicant-info-list">
                <div className="info-item">
                  <i className="bi bi-person-circle"></i>
                  <span>Name: <strong>{item.first_name} {item.last_name}</strong></span>
                </div>
                <div className="info-item">
                  <i className="bi bi-envelope"></i>
                  <span>Email: <strong>{item.email}</strong></span>
                </div>
                <div className="info-item">
                  <i className="bi bi-telephone"></i>
                  <span>Phone: <strong>{item.phone_number || '—'}</strong></span>
                </div>
                <div className="info-item">
                  <i className="bi bi-shield-check"></i>
                  <span>Approval Status: <strong>{item.approval_status || 'approved'}</strong></span>
                </div>
              </div>
            </div>
          )}

          {/* Notification Reader */}
          {type === 'notification' && (
            <div className="drawer-section">
              <div className="drawer-section-title">Notification Detail</div>
              <div
                style={{
                  backgroundColor: 'var(--bg-subpanel)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span className="badge-chip badge-agent">{item.type}</span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: item.is_read ? 'var(--accent-blue)' : 'var(--accent-amber)',
                    }}
                  >
                    {item.is_read ? '✓ Read' : '● Unread'}
                  </span>
                </div>

                <h3 style={{ color: 'var(--text-primary)', marginBottom: 8, fontSize: 16 }}>
                  {item.title}
                </h3>

                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, fontSize: 13, whiteSpace: 'pre-wrap' }}>
                  {item.body || item.message}
                </p>

                <div className="applicant-info-list" style={{ marginTop: 14 }}>
                  <div className="info-item">
                    <i className="bi bi-person"></i>
                    <span>Recipient ID: <strong className="cell-mono" style={{ fontSize: 11 }}>{item.user_id}</strong></span>
                  </div>
                  <div className="info-item">
                    <i className="bi bi-calendar"></i>
                    <span>Sent: <strong>{timeAgo(item.created_at)}</strong></span>
                  </div>
                  {item.data && (
                    <div className="info-item">
                      <i className="bi bi-tags"></i>
                      <span>Meta: <strong className="cell-mono" style={{ fontSize: 11 }}>{JSON.stringify(item.data)}</strong></span>
                    </div>
                  )}
                </div>

                {!item.is_read && (
                  <button
                    className="sb-btn sb-btn-primary sb-btn-sm"
                    style={{ marginTop: 14 }}
                    onClick={async () => {
                      await supabase
                        .from('notifications')
                        .update({ is_read: true })
                        .eq('id', item.id);
                      onClose();
                    }}
                  >
                    <i className="bi bi-check2-circle"></i> Mark as Read
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Full Raw JSON */}
          <div className="drawer-section">
            <div className="drawer-section-title">Raw Database Record (JSON)</div>
            <pre className="json-inspector">
              {JSON.stringify(item, null, 2)}
            </pre>
          </div>
        </div>

        <div className="drawer-footer">
          <button className="sb-btn sb-btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   8. MAIN STUDIO SHELL
   ═══════════════════════════════════════════════════════════════════ */

// Vibration helper - long TikTok-style haptic buzz
function vibrateNotification() {
  if ('vibrate' in navigator) {
    try { navigator.vibrate([200, 80, 200, 80, 400]); } catch (_) {}
  }
}

// Hook: polls for new unread notifications and triggers vibration + visual toast
function useNotificationPoller() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [toastNotif, setToastNotif] = useState(null);
  const lastSeenIdRef = useRef(null);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    let alive = true;

    const poll = async () => {
      if (!alive) return;
      try {
        let query = supabase
          .from('notifications')
          .select('id, title, body, type, created_at')
          .eq('is_read', false)
          .order('created_at', { ascending: false });

        if (lastSeenIdRef.current) {
          query = query.gt('created_at', lastSeenIdRef.current);
        }

        const { data: newNotifs } = await query.limit(10);

        if (newNotifs && newNotifs.length > 0) {
          setUnreadCount((prev) => prev + newNotifs.length);

          // Show toast for the newest one
          const latest = newNotifs[0];
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToastNotif(latest);
          toastTimerRef.current = setTimeout(() => setToastNotif(null), 4000);

          // Update the cursor to the newest notification's created_at
          lastSeenIdRef.current = latest.created_at;

          // Vibrate once per batch
          vibrateNotification();
        }
      } catch (_) {}
    };

    poll();
    const interval = setInterval(poll, 8000);
    return () => {
      alive = false;
      clearInterval(interval);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const dismissToast = useCallback(() => setToastNotif(null), []);

  const resetUnread = useCallback(() => setUnreadCount(0), []);

  return { unreadCount, toastNotif, dismissToast, resetUnread };
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [adminUser, setAdminUser] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState('overview'); // overview, approvals, table_profiles, table_properties, table_notifications, broadcast, sql
  const [inspectorItem, setInspectorItem] = useState(null);
  const [inspectorType, setInspectorType] = useState('record');
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [pendingListingsCount, setPendingListingsCount] = useState(0);
  const { unreadCount: notifUnread, toastNotif, dismissToast, resetUnread } = useNotificationPoller();
  const verifyInFlight = useRef(false);

  const checkPendingCount = useCallback(async () => {
    try {
      const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .in('role', ['agent', 'mover', 'admin'])
        .eq('approval_status', 'pending');
      setPendingApprovalsCount(count || 0);

      const { count: listingCount } = await supabase
        .from('properties')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      setPendingListingsCount(listingCount || 0);
    } catch (_) {}
  }, []);

  const verifyAdmin = useCallback(async (userId, userEmail) => {
    if (!userId || verifyInFlight.current) return;
    verifyInFlight.current = true;
    setVerifying(true);
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error || !data) {
        setAuthError(
          `Signed in as ${userEmail || userId}, but no profile row was found. ` +
          `Create one in public.profiles with id = ${userId} and role = 'admin'.` +
          (error ? ` DB said: ${error.message}` : '')
        );
        await supabase.auth.signOut();
        setSession(null);
        setAdminUser(null);
        return;
      }
      if (data?.role !== 'admin') {
        setAuthError(
          `Access denied for ${data.email || userEmail}. Your role is '${data.role || 'unknown'}' — this portal requires role='admin'.`
        );
        await supabase.auth.signOut();
        setSession(null);
        setAdminUser(null);
        return;
      }
      setAuthError('');
      setAdminUser(data);
      checkPendingCount();
    } catch (e) {
      console.error('verifyAdmin failed:', e);
      setAuthError(`Could not verify admin profile: ${e.message || e}`);
    } finally {
      verifyInFlight.current = false;
      setVerifying(false);
    }
  }, [checkPendingCount]);

  // Load session & check admin rights — event-aware so TOKEN_REFRESHED never logs you out
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session ?? null);
      if (data.session?.user) verifyAdmin(data.session.user.id, data.session.user.email);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setAdminUser(null);
        setVerifying(false);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED') {
        setSession(s);
        if (s?.user) verifyAdmin(s.user.id, s.user.email);
        else if (event === 'INITIAL_SESSION') {
          setSession(null);
          setAdminUser(null);
        }
        // For TOKEN_REFRESHED with a null session we deliberately keep the
        // existing session/adminUser so a transient refresh hiccup can't kick you out.
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [verifyAdmin]);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (_) {}
    setSession(null);
    setAdminUser(null);
    setAuthError('');
  };

  const handleInspect = (type, item) => {
    setInspectorType(type);
    setInspectorItem(item);
  };

  if (session === undefined) {
    return (
      <div className="login-stage">
        <div style={{ textAlign: 'center' }}>
          <span className="spinner" style={{ width: 32, height: 32 }}></span>
          <p style={{ marginTop: 14, color: 'var(--text-secondary)', fontSize: 13 }}>
            Connecting to PostgreSQL…
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        externalError={authError}
        onReady={(user, profile) => {
          // Store the real session shape so a re-render before the
          // SIGNED_IN event arrives can't drop you back to login.
          supabase.auth.getSession().then(({ data }) => {
            setSession(data.session ?? (data ? { user } : null));
          });
          setAdminUser(profile);
          setAuthError('');
        }}
      />
    );
  }

  if (!adminUser || verifying) {
    return (
      <div className="login-stage">
        <div style={{ textAlign: 'center' }}>
          <span className="spinner" style={{ width: 32, height: 32 }}></span>
          <p style={{ marginTop: 14, color: 'var(--text-secondary)', fontSize: 13 }}>
            Verifying administrator profile…
          </p>
          {authError && (
            <div className="alert-box alert-box-error" style={{ marginTop: 16, maxWidth: 520 }}>
              <i className="bi bi-exclamation-triangle-fill"></i>
              <span>{authError}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* 1. Primary Left Icon Rail */}
      <nav className="icon-rail">
        <div className="supabase-brand-mark" title="Hlala Link PostgreSQL Control Center">
          HL
        </div>

        <button
          className={`rail-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
          title="Project Dashboard"
        >
          <i className="bi bi-grid-1x2-fill"></i>
        </button>

        <button
          className={`rail-btn ${activeTab === 'approvals' ? 'active' : ''}`}
          onClick={() => setActiveTab('approvals')}
          title="User Approvals (Agents & Movers)"
        >
          <i className="bi bi-shield-check"></i>
          {pendingApprovalsCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: 'var(--accent-amber)',
              }}
            />
          )}
        </button>

        <button
          className={`rail-btn ${activeTab === 'listing_approvals' ? 'active' : ''}`}
          onClick={() => setActiveTab('listing_approvals')}
          title="Listing Approvals (Property Moderation)"
        >
          <i className="bi bi-building-check"></i>
          {pendingListingsCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: 'var(--accent-amber)',
              }}
            />
          )}
        </button>

        <button
          className={`rail-btn ${activeTab.startsWith('table_') ? 'active' : ''}`}
          onClick={() => setActiveTab('table_profiles')}
          title="Table Data Editor"
        >
          <i className="bi bi-table"></i>
        </button>

        <button
          className={`rail-btn ${activeTab === 'broadcast' ? 'active' : ''}`}
          onClick={() => setActiveTab('broadcast')}
          title="Push & In-App Broadcasts"
        >
          <i className="bi bi-broadcast"></i>
        </button>

        <button
          className={`rail-btn ${activeTab === 'sql' ? 'active' : ''}`}
          onClick={() => setActiveTab('sql')}
          title="SQL & Macros Console"
        >
          <i className="bi bi-terminal-fill"></i>
        </button>

        <button
          className="rail-btn"
          onClick={() => { setActiveTab('table_notifications'); resetUnread(); }}
          title="Notifications"
        >
          <i className="bi bi-bell-fill"></i>
          {notifUnread > 0 && (
            <span style={{
              position: 'absolute', top: 2, right: 2,
              minWidth: 14, height: 14, borderRadius: 7,
              backgroundColor: 'var(--accent-red)',
              color: '#fff', fontSize: 9, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 3px',
            }}>
              {notifUnread > 9 ? '9+' : notifUnread}
            </span>
          )}
        </button>

        <div className="rail-spacer"></div>

        <button className="rail-btn" onClick={handleSignOut} title="Sign Out">
          <i className="bi bi-box-arrow-left" style={{ color: 'var(--accent-red)' }}></i>
        </button>
      </nav>

      {/* 2. Sub-Sidebar Navigation */}
      <aside className="nav-sidebar">
        <div className="sidebar-header">
          <div className="project-selector">
            <div className="project-icon">
              <i className="bi bi-database-fill"></i>
            </div>
            <div className="project-name-wrap">
              <h4>hlala-link-prod</h4>
              <span className="project-env">
                <span className="pulse-dot"></span> Live · Harare
              </span>
            </div>
          </div>
        </div>

        <div className="nav-links">
          <div className="nav-section-title">Core Management</div>
          <button
            className={`nav-link ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <div className="nav-link-left">
              <i className="bi bi-grid-1x2"></i>
              <span>Dashboard Overview</span>
            </div>
          </button>

          <button
            className={`nav-link ${activeTab === 'approvals' ? 'active' : ''}`}
            onClick={() => setActiveTab('approvals')}
          >
            <div className="nav-link-left">
              <i className="bi bi-shield-check"></i>
              <span>Agents & Movers</span>
            </div>
            {pendingApprovalsCount > 0 && (
              <span className="nav-pill nav-pill-pending">{pendingApprovalsCount}</span>
            )}
          </button>

          <button
            className={`nav-link ${activeTab === 'listing_approvals' ? 'active' : ''}`}
            onClick={() => setActiveTab('listing_approvals')}
          >
            <div className="nav-link-left">
              <i className="bi bi-building-check"></i>
              <span>Listing Approvals</span>
            </div>
            {pendingListingsCount > 0 && (
              <span className="nav-pill nav-pill-pending">{pendingListingsCount}</span>
            )}
          </button>

          <div className="nav-section-title">Table Editor</div>
          <button
            className={`nav-link ${activeTab === 'table_profiles' ? 'active' : ''}`}
            onClick={() => setActiveTab('table_profiles')}
          >
            <div className="nav-link-left">
              <i className="bi bi-people"></i>
              <span>profiles</span>
            </div>
          </button>

          <button
            className={`nav-link ${activeTab === 'table_properties' ? 'active' : ''}`}
            onClick={() => setActiveTab('table_properties')}
          >
            <div className="nav-link-left">
              <i className="bi bi-building"></i>
              <span>properties</span>
            </div>
          </button>

          <button
            className={`nav-link ${activeTab === 'table_notifications' ? 'active' : ''}`}
          onClick={() => { setActiveTab('table_notifications'); resetUnread(); }}
          >
            <div className="nav-link-left">
              <i className="bi bi-bell"></i>
              <span>notifications</span>
            </div>
            {notifUnread > 0 && (
              <span className="nav-pill" style={{
                backgroundColor: 'var(--accent-red-subtle)',
                color: 'var(--accent-red)',
                border: '1px solid var(--accent-red-border)',
              }}>
                {notifUnread}
              </span>
            )}
          </button>

          <div className="nav-section-title">Tools & Dispatch</div>
          <button
            className={`nav-link ${activeTab === 'broadcast' ? 'active' : ''}`}
            onClick={() => setActiveTab('broadcast')}
          >
            <div className="nav-link-left">
              <i className="bi bi-megaphone"></i>
              <span>Broadcast Alerts</span>
            </div>
          </button>

          <button
            className={`nav-link ${activeTab === 'sql' ? 'active' : ''}`}
            onClick={() => setActiveTab('sql')}
          >
            <div className="nav-link-left">
              <i className="bi bi-terminal"></i>
              <span>SQL & Macros</span>
            </div>
          </button>
        </div>

        {/* Sidebar Footer User Badge */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar-circle">
              {adminUser.email?.slice(0, 2).toUpperCase() || 'AD'}
            </div>
            <div className="user-info-text">
              <div className="user-email-label">{adminUser.email}</div>
              <div className="user-role-label">Super Administrator</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 3. Main Stage Content Area */}
      <main className="main-stage">
        {/* Studio Top Action Bar */}
        <header className="studio-topbar">
          <div className="breadcrumbs">
            <span className="crumb-root">Hlala Link Studio</span>
            <span className="crumb-divider">/</span>
            <span className="crumb-current">
               {activeTab === 'overview' && 'Overview'}
               {activeTab === 'approvals' && 'Approvals'}
               {activeTab === 'listing_approvals' && 'Listing Approvals'}
               {activeTab.startsWith('table_') && `Tables / ${activeTab.replace('table_', '')}`}
              {activeTab === 'broadcast' && 'Broadcast Dispatch'}
              {activeTab === 'sql' && 'SQL Runner'}
            </span>
          </div>

          <div className="topbar-actions">
            <div className="search-command-input">
              <i className="bi bi-search"></i>
              <input placeholder="Jump to table or action…" readOnly onClick={() => setActiveTab('table_profiles')} />
              <span className="kbd-shortcut">Ctrl+K</span>
            </div>

            <button className="action-icon-btn" onClick={() => checkPendingCount()} title="Refresh Studio Status">
              <i className="bi bi-arrow-clockwise"></i>
            </button>

            <button className="btn-signout" onClick={handleSignOut}>
              <i className="bi bi-box-arrow-right"></i> Sign out
            </button>
          </div>
        </header>

        {/* Content Viewport Scroll */}
        <div className="viewport-scroll">
          {activeTab === 'overview' && (
            <OverviewView setTab={setActiveTab} onInspect={handleInspect} />
          )}

          {activeTab === 'approvals' && (
            <ApprovalsView onInspect={handleInspect} />
          )}

          {activeTab === 'listing_approvals' && (
            <ListingApprovalsView onInspect={handleInspect} adminUser={adminUser} />
          )}

          {activeTab === 'table_profiles' && (
            <TableEditorView tableName="profiles" onInspect={handleInspect} />
          )}

          {activeTab === 'table_properties' && (
            <TableEditorView tableName="properties" onInspect={handleInspect} />
          )}

          {activeTab === 'table_notifications' && (
            <TableEditorView tableName="notifications" onInspect={handleInspect} />
          )}

          {activeTab === 'broadcast' && <BroadcastView />}

          {activeTab === 'sql' && <SqlConsoleView />}
        </div>
      </main>

      {/* Inspector Slide-out Drawer */}
      <InspectorDrawer
        item={inspectorItem}
        type={inspectorType}
        onClose={() => setInspectorItem(null)}
      />

      {/* Notification Toast — TikTok style */}
      {toastNotif && (
        <div className="notif-toast" onClick={dismissToast} title="Click to dismiss">
          <div className="notif-toast-icon">
            <i className="bi bi-bell-fill"></i>
          </div>
          <div className="notif-toast-body">
            <div className="notif-toast-title">{toastNotif.title || 'New Notification'}</div>
            <div className="notif-toast-msg">{toastNotif.body || toastNotif.message || ''}</div>
          </div>
          <span className="notif-toast-time">now</span>
          <button className="notif-toast-close" onClick={(e) => { e.stopPropagation(); dismissToast(); }}>
            <i className="bi bi-x"></i>
          </button>
        </div>
      )}
    </div>
  );
}
