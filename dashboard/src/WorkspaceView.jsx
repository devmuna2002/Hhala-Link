import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabaseClient';

/* ── Tolerant helpers: the API serves MySQL + Postgres naming side by side ── */

const asStr = (v) => (v == null ? '' : String(v));

function userName(u) {
  if (!u) return 'User';
  return (
    u.business_name ||
    u.full_name ||
    `${asStr(u.first_name)} ${asStr(u.last_name)}`.trim() ||
    (asStr(u.email).includes('@') ? asStr(u.email).split('@')[0] : '') ||
    'User'
  );
}

function userInitials(u) {
  const n = userName(u);
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return n.slice(0, 2).toUpperCase();
}

function ownerOf(p) {
  let o = p?.owner;
  if (typeof o === 'string') {
    try { o = JSON.parse(o); } catch { o = null; }
  }
  return o && typeof o === 'object' ? o : null;
}

function propOwnerName(p, profilesById) {
  const o = ownerOf(p);
  if (o) {
    return (
      o.business_name || o.full_name ||
      `${asStr(o.first_name)} ${asStr(o.last_name)}`.trim() ||
      o.email || '—'
    );
  }
  const m = p?.owner_id ? profilesById.get(p.owner_id) : null;
  return m ? userName(m) : '—';
}

function propOwnerAvatar(p, profilesById) {
  const o = ownerOf(p);
  if (o?.avatar_url) return o.avatar_url;
  const m = p?.owner_id ? profilesById.get(p.owner_id) : null;
  return m?.avatar_url || null;
}

function propImages(p) {
  if (Array.isArray(p?.property_images)) {
    const urls = p.property_images
      .map((i) => (typeof i === 'string' ? i : i?.url))
      .filter(Boolean);
    if (urls.length) return urls;
  }
  for (const k of ['image_urls', 'images']) {
    if (Array.isArray(p?.[k])) {
      const urls = p[k].map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
      if (urls.length) return urls;
    }
  }
  if (p?.image_url) return [p.image_url];
  return [];
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function propPrice(p) {
  const rent = num(p?.rent_usd ?? p?.price);
  const sale = num(p?.sale_price_usd);
  const purpose = asStr(p?.listing_purpose).toLowerCase();
  const fmt = (n) => `$${n.toLocaleString('en-US')}`;
  if (purpose === 'sale' || (sale != null && rent == null)) {
    return sale != null ? fmt(sale) : 'Price on request';
  }
  if (rent != null) return `${fmt(rent)}/month`;
  if (sale != null) return fmt(sale);
  return 'Price on request';
}

function isApprovedProfile(u) {
  if (!u) return false;
  if (u.approval_status) return u.approval_status === 'approved';
  if (typeof u.is_approved === 'boolean') return u.is_approved;
  return true;
}

function relEn(dateStr) {
  if (!dateStr) return '—';
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  try {
    return `on ${new Date(dateStr).toLocaleDateString('en-GB')}`;
  } catch { return '—'; }
}

function hhmm(dateStr) {
  const t = new Date(dateStr);
  if (Number.isNaN(t.getTime())) return '--:--';
  try {
    return t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch { return '--:--'; }
}

function todayEn() {
  try {
    return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
  } catch {
    return 'TODAY';
  }
}

const PERIOD_DAYS = { Day: 1, Week: 7, Month: 30, Year: 365 };
const TYPE_ICON = {
  apartment: 'bi-building', house: 'bi-house-fill', cottage: 'bi-house-heart-fill',
  studio: 'bi-lamp-fill', townhouse: 'bi-buildings-fill', room: 'bi-door-open-fill',
  office: 'bi-briefcase-fill', shops: 'bi-shop', villa: 'bi-house-up-fill',
  stands: 'bi-map-fill', commercial: 'bi-bank', other: 'bi-file-earmark-text-fill',
};

/* Bucket rows by day for the last N days (real DB timestamps) */
function last14Buckets(profiles, properties) {
  const days = [];
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(midnight.getTime() - i * 86400000);
    days.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      label: String(d.getDate()),
      accounts: 0,
      listings: 0,
    });
  }
  const map = new Map(days.map((d) => [d.key, d]));
  for (const u of profiles) {
    const b = u?.created_at && map.get(asStr(u.created_at).slice(0, 10));
    if (b) b.accounts += 1;
  }
  for (const p of properties) {
    const b = p?.created_at && map.get(asStr(p.created_at).slice(0, 10));
    if (b) b.listings += 1;
  }
  return days;
}

/* Smooth-ish SVG area path from a value series */
function areaPath(vals, w, h, pad = 3) {
  if (!vals.length) return { line: '', area: '' };
  const max = Math.max(...vals, 1);
  const step = (w - pad * 2) / Math.max(vals.length - 1, 1);
  const pts = vals.map((v, i) => [pad + i * step, h - pad - (v / max) * (h - pad * 2)]);
  const line = 'M' + pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' L');
  return { line, area: `${line} L${(w - pad).toFixed(1)},${h} L${pad},${h} Z` };
}

function Avatar({ url, name, size }) {  if (url) return <img src={url} alt={name || ''} style={size ? { width: size, height: size } : undefined} />;
  return (
    <span className="wd-avatar-fallback" style={size ? { width: size, height: size, fontSize: size * 0.32 } : undefined}>
      {userInitials({ business_name: null, full_name: name })}
    </span>
  );
}

export default function WorkspaceView({ setTab, onInspect }) {
  const [profiles, setProfiles] = useState([]);
  const [properties, setProperties] = useState([]);
  const [movers, setMovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [period, setPeriod] = useState('Day');
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [pr, pp, mv] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('properties').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('movers').select('*').order('created_at', { ascending: false }).limit(1000),
      ]);
      const firstErr = pr.error || pp.error || mv.error;
      if (firstErr) throw firstErr;
      setProfiles(pr.data || []);
      setProperties(pp.data || []);
      setMovers(mv.data || []);
    } catch (e) {
      setLoadError(e?.message || 'Could not connect to the database.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const profilesById = useMemo(() => {
    const m = new Map();
    for (const u of profiles) if (u?.id) m.set(u.id, u);
    return m;
  }, [profiles]);

  const stats = useMemo(() => {
    const agents = profiles.filter((u) => u.role === 'agent' || u.role === 'landlord');
    const moverProfiles = profiles.filter((u) => u.role === 'mover');
    const tenants = profiles.filter((u) => !u.role || u.role === 'tenant');
    const admins = profiles.filter((u) => u.role === 'admin');
    const partners = [...agents, ...moverProfiles];

    const pctApproved = (arr) => {
      if (!arr.length) return 0;
      return Math.round((arr.filter(isApprovedProfile).length / arr.length) * 100);
    };
    const pendingProfiles = profiles.filter((u) => u.approval_status === 'pending');

    const available = properties.filter((p) => p.status === 'available');
    const pendingProps = properties.filter((p) => p.status === 'pending');
    const decidedProps = properties.filter((p) => p.status && p.status !== 'pending');
    const propsPct = properties.length ? Math.round((available.length / properties.length) * 100) : 0;

    const reviewable = partners.length + properties.length;
    const reviewed = partners.filter(isApprovedProfile).length + decidedProps.length;
    const global = reviewable ? Math.round((reviewed / reviewable) * 1000) / 10 : 0;

    const weekAgo = Date.now() - 7 * 86400000;
    const isNew = (r) => r?.created_at && new Date(r.created_at).getTime() >= weekAgo;
    const newUsers = profiles.filter(isNew).length;
    const newPending = [...pendingProfiles, ...pendingProps].filter(isNew).length;

    const cityCount = {};
    for (const p of properties) {
      const c = asStr(p.city).trim() || 'Harare';
      cityCount[c] = (cityCount[c] || 0) + 1;
    }
    const topCity = Object.entries(cityCount).sort((a, b) => b[1] - a[1])[0] || null;

    return {
      total: profiles.length, newUsers,
      pendingTotal: pendingProfiles.length + pendingProps.length, newPending,
      validated: partners.filter(isApprovedProfile).length + available.length,
      global,
      agents, moverProfiles, tenants, admins,
      agentsPct: pctApproved(agents),
      moversPct: pctApproved(moverProfiles.length ? moverProfiles : movers.map((v) => ({ approval_status: v.is_verified ? 'approved' : 'pending' }))),
      tenantsPct: tenants.length ? Math.round((tenants.filter((u) => u.is_active !== false).length / tenants.length) * 100) : 0,
      propsPct, available: available.length, pendingProps: pendingProps.length,
      topCity,
    };
  }, [profiles, properties, movers]);

  const events = useMemo(() => {
    const evs = [
      ...properties.map((p) => ({
        kind: 'listing', at: p.created_at, title: p.title || 'Untitled',
        sub: [p.property_type, p.city].filter(Boolean).join(' · ') || 'Listing',
        ref: p, dark: true,
      })),
      ...profiles.map((u) => ({
        kind: 'user', at: u.created_at, title: userName(u),
        sub: u.role || 'tenant', ref: u, dark: false,
      })),
    ]
      .filter((e) => e.at && !Number.isNaN(new Date(e.at).getTime()))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    const days = PERIOD_DAYS[period] || 1;
    const cutoff = Date.now() - days * 86400000;
    return evs.filter((e) => new Date(e.at).getTime() >= cutoff).slice(0, 6);
  }, [profiles, properties, period]);

  const q = query.trim().toLowerCase();
  const visibleEvents = events.filter(
    (e) => !q || e.title.toLowerCase().includes(q) || asStr(e.sub).toLowerCase().includes(q)
  );

  const files = useMemo(() => properties.slice(0, 4).map((p) => ({
    id: p.id,
    name: p.title || 'Untitled',
    meta: [p.property_type, p.city, propPrice(p)].filter(Boolean).join(' · '),
    icon: TYPE_ICON[asStr(p.property_type).toLowerCase()] || 'bi-file-earmark-text-fill',
    ref: p,
  })), [properties]);

  const visibleFiles = files.filter(
    (f) => !q || f.name.toLowerCase().includes(q) || asStr(f.meta).toLowerCase().includes(q)
  );

  const featured = useMemo(() => {
    if (!properties.length) return null;
    const withImg = properties.find((p) => propImages(p).length > 0);
    const p = withImg || properties[0];
    const imgs = propImages(p);
    return {
      title: p.title || 'Untitled',
      price: propPrice(p),
      city: p.city || '',
      by: propOwnerName(p, profilesById),
      byAvatar: propOwnerAvatar(p, profilesById),
      when: relEn(p.created_at),
      img: imgs[0] || null,
      ref: p,
    };
  }, [properties, profilesById]);

  const activity = useMemo(() => last14Buckets(profiles, properties), [profiles, properties]);

  const activityMax = useMemo(
    () => Math.max(1, ...activity.map((d) => Math.max(d.accounts, d.listings))),
    [activity]
  );

  const totals14 = useMemo(() => activity.map((d) => d.accounts + d.listings), [activity]);
  const accounts14 = useMemo(() => activity.map((d) => d.accounts), [activity]);
  const totalsArea = useMemo(() => areaPath(totals14, 200, 60), [totals14]);
  const accountsArea = useMemo(() => areaPath(accounts14, 120, 24), [accounts14]);

  const cities = useMemo(() => {
    const counts = {};
    for (const p of properties) {
      const c = asStr(p.city).trim() || 'Unknown';
      counts[c] = (counts[c] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [properties]);

  const cityMax = cities.length ? Math.max(...cities.map((c) => c.count)) : 1;

  const teams = useMemo(() => ([
    {
      key: 'agents', name: 'Agents', sub: 'Manage & publish',
      members: stats.agents, pct: stats.agentsPct,
      tab: 'approvals',
    },
    {
      key: 'movers', name: 'Movers', sub: 'Transport & delivery',
      members: stats.moverProfiles.length ? stats.moverProfiles : movers.map((v) => ({
        id: v.id, business_name: v.company_name, avatar_url: v.avatar_url || v.logo_url,
        approval_status: v.is_verified ? 'approved' : 'pending', created_at: v.created_at,
      })),
      pct: stats.moversPct, tab: 'approvals',
    },
    {
      key: 'tenants', name: 'Tenants', sub: 'Rent & live',
      members: stats.tenants, pct: stats.tenantsPct,
      tab: 'table_profiles',
    },
  ]), [stats, movers]);

  const nav = [
    { key: 'overview', icon: 'bi-house', label: 'Home' },
    { key: 'approvals', icon: 'bi-layers', label: 'Approvals', badge: stats.pendingTotal },
    { key: 'listing_approvals', icon: 'bi-building-check', label: 'Listings', badge: stats.pendingProps },
    { key: 'table_profiles', icon: 'bi-people', label: 'Accounts' },
    { key: 'table_properties', icon: 'bi-bar-chart', label: 'Properties' },
    { key: 'table_notifications', icon: 'bi-bell', label: 'Alerts' },
    { key: 'broadcast', icon: 'bi-megaphone', label: 'Broadcast' },
    { key: 'sql', icon: 'bi-terminal', label: 'SQL' },
  ];

  const maxStrip = Math.max(stats.total, stats.pendingTotal, stats.validated, 1);

  return (
    <div className="wd-stage">
      <div className="wd-shell">
        {/* ── Sidebar ─────────────────────────────── */}
        <aside className="wd-side">
          <nav className="wd-nav">
            {nav.map((n) => (
              <button
                key={n.key}
                className={`wd-nav-item ${n.key === 'overview' ? 'on' : ''}`}
                onClick={() => setTab(n.key)}
                title={n.label}
              >
                <i className={`bi ${n.icon}`} />
                <span>{n.label}</span>
                {n.badge > 0 && <b className="wd-nav-badge">{n.badge}</b>}
              </button>
            ))}
          </nav>
          <div className="wd-user">
            <div className="wd-user-av">
              <Avatar name={`${stats.total} accounts`} />
            </div>
            <div className="wd-user-name">{stats.total} accounts</div>
            <div className="wd-user-role">{stats.available} live</div>
            <button
              className="wd-signout"
              onClick={() => supabase.auth.signOut()}
              title="Sign out"
            >
              <i className="bi bi-box-arrow-left" /> Sign out
            </button>
          </div>
        </aside>

        {/* ── Main ────────────────────────────────── */}
        <div className="wd-main">
          <header className="wd-top">
            <h1 className="wd-title">Hlala<br /><span className="wd-title-blue">Link</span></h1>
            <div className="wd-top-pills">
              <span className="wd-pill">
                <span className="wd-pill-ic"><i className="bi bi-calendar-event" /></span>
                Day view
              </span>
              <span className="wd-pill wd-pill-weather">
                <i className="bi bi-geo-alt-fill" />
                {stats.topCity ? `${stats.topCity[0]}` : 'Harare'}
                <em>{stats.topCity ? `${stats.topCity[1]} listing${stats.topCity[1] > 1 ? 's' : ''}` : 'Live DB'}</em>
              </span>
            </div>
            <div className="wd-search">
              <span className="wd-search-ic"><i className="bi bi-search" /></span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" />
              {q && <button className="wd-search-clear" onClick={() => setQuery('')}><i className="bi bi-x-circle-fill" /></button>}
            </div>
            <button className="wd-iconbtn" onClick={() => setTab('approvals')} title="Pending approvals">
              <i className="bi bi-bell" />
              {stats.pendingTotal > 0 && <b className="wd-dot">{stats.pendingTotal}</b>}
            </button>
            <button className="wd-iconbtn wd-iconbtn-ghost" onClick={() => setTab('broadcast')} title="Broadcast">
              <i className="bi bi-three-dots" />
            </button>
          </header>

          <div className="wd-daterow">
            <span className="wd-date">{todayEn()}</span>
            <div className="wd-period">
              {Object.keys(PERIOD_DAYS).map((p) => (
                <button key={p} className={period === p ? 'on' : ''} onClick={() => setPeriod(p)}>{p}</button>
              ))}
            </div>
          </div>

          {loadError && (
            <div className="wd-err">
              <i className="bi bi-exclamation-triangle-fill" />
              <span>{loadError}</span>
              <button onClick={load}>Retry</button>
            </div>
          )}

          {/* Top 3 cards */}
          <div className="wd-grid-top">
            <section className="wd-card wd-timeline">
              {loading ? (
                <div className="wd-loading">Loading database…</div>
              ) : visibleEvents.length === 0 ? (
                <div className="wd-loading">
                  {properties.length + profiles.length === 0
                    ? 'Empty database — no listings or accounts yet.'
                    : `Nothing in this period${q ? ` for "${query}"` : ''}.`}
                </div>
              ) : visibleEvents.map((e, i) => (
                <div className="wd-tl-row" key={`${e.kind}-${e.ref?.id || i}`}>
                  <span className="wd-tl-time">{hhmm(e.at)}</span>
                  <button
                    className={`wd-tl-pill ${e.dark ? 'dark' : 'light'}`}
                    onClick={() => e.ref && onInspect(e.kind === 'listing' ? 'properties' : 'profile', e.ref)}
                    title={`${e.sub} · ${relEn(e.at)} — click to inspect`}
                  >
                    <span className="wd-tl-label">{e.title}</span>
                    <span className="wd-tl-avs">
                      <Avatar
                        url={e.kind === 'listing' ? propOwnerAvatar(e.ref, profilesById) : e.ref?.avatar_url}
                        name={e.kind === 'listing' ? propOwnerName(e.ref, profilesById) : userName(e.ref)}
                        size={26}
                      />
                    </span>
                  </button>
                </div>
              ))}
              <div className="wd-legend">
                <span><b className="d1" /> Listings</span>
                <span><b className="d2" /> Accounts</span>
              </div>
            </section>

            <section className="wd-card wd-progress">
              <div className="wd-card-head">
                <h3>Projects in progress</h3>
                <button className="wd-headbtn" onClick={() => setTab('listing_approvals')} title="Moderate">
                  <i className="bi bi-grid-3x3-gap" />
                </button>
              </div>
              <div className="wd-big">{stats.global}%</div>
              <div className="wd-sub">Verified accounts & listings</div>
              <svg className="wd-curve" viewBox="0 0 200 60" preserveAspectRatio="none">
                <path d={totalsArea.area} fill="rgba(10,132,255,0.12)" stroke="none" />
                <path d={totalsArea.line} fill="none" stroke="#0A84FF" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <ul className="wd-break">
                <li><b /> Agents <span>{stats.agentsPct}%</span></li>
                <li><b className="g" /> Movers <span>{stats.moversPct}%</span></li>
                <li><b /> Listings <span>{stats.propsPct}%</span></li>
              </ul>
            </section>

            <section className="wd-card wd-preview">
              <div className="wd-card-head light">
                <h3>File preview</h3>
                <i className="bi bi-stars" />
              </div>
              {!featured ? (
                <div className="wd-loading light">No listings in the database.</div>
              ) : (
                <>
                  <button
                    className="wd-preview-img"
                    onClick={() => featured.ref && onInspect('properties', featured.ref)}
                    title="Inspect listing"
                  >
                    {featured.img
                      ? <img src={featured.img} alt={featured.title} />
                      : <span className="wd-noimg"><i className="bi bi-image" /></span>}
                  </button>
                  <div className="wd-preview-name">{featured.title}</div>
                  <div className="wd-preview-size">{featured.price}{featured.city ? ` · ${featured.city}` : ''}</div>
                  <div className="wd-preview-by">
                    <span className="wd-tl-avs">
                      <Avatar url={featured.byAvatar} name={featured.by} size={26} />
                    </span>
                    <span><strong>{featured.by}</strong><em>{featured.when}</em></span>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* Analytics — real charts from live data */}
          <div className="wd-analytics">
            <section className="wd-card">
              <div className="wd-card-head">
                <h3>Activity</h3>
                <span className="wd-range">Last 14 days</span>
              </div>
              <div className="wd-legend-chips">
                <span><b className="wd-chip-dot" style={{ background: '#111' }} />Accounts</span>
                <span><b className="wd-chip-dot" style={{ background: '#0A84FF' }} />Listings</span>
              </div>
              {activityMax <= 0 || (stats.total + properties.length === 0) ? (
                <div className="wd-loading">No activity recorded yet.</div>
              ) : (
                <svg className="wd-chart" viewBox="0 0 420 190" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Signups and listings per day">
                  {[0, 1, 2, 3, 4].map((g) => {
                    const y = 8 + (g * 150) / 4;
                    const v = Math.round(activityMax * (1 - g / 4));
                    return (
                      <g key={g}>
                        <line x1="24" x2="412" y1={y} y2={y} className="wd-grid-line" />
                        <text x="0" y={y + 3} className="wd-axis">{v}</text>
                      </g>
                    );
                  })}
                  {activity.map((d, i) => {
                    const gx = 30 + i * 28;
                    const aH = (d.accounts / activityMax) * 140;
                    const lH = (d.listings / activityMax) * 140;
                    return (
                      <g key={d.key}>
                        <rect x={gx} y={158 - aH} width="11" height={aH || 2} rx="3" fill="#111" />
                        <rect x={gx + 13} y={158 - lH} width="11" height={lH || 2} rx="3" fill="#0A84FF" />
                        <text x={gx + 12} y="174" textAnchor="middle" className="wd-axis">{d.label}</text>
                      </g>
                    );
                  })}
                </svg>
              )}
            </section>

            <section className="wd-card">
              <div className="wd-card-head">
                <h3>Listings by city</h3>
                <span className="wd-range">{properties.length} total</span>
              </div>
              {cities.length === 0 ? (
                <div className="wd-loading">No listings in the database.</div>
              ) : cities.map((c) => (
                <div className="wd-city-row" key={c.name}>
                  <span className="wd-city-name" title={c.name}>{c.name}</span>
                  <span className="wd-city-track">
                    <span className="wd-city-fill" style={{ display: 'block', width: `${Math.round((c.count / cityMax) * 100)}%` }} />
                  </span>
                  <span className="wd-city-count">{c.count}</span>
                </div>
              ))}
            </section>
          </div>

          {/* Bottom row */}
          <div className="wd-grid-bottom">
            <section className="wd-card wd-files">
              <div className="wd-card-head">
                <h3>All listings</h3>
                <button className="wd-add" onClick={() => setTab('listing_approvals')} title="Moderate">+</button>
              </div>
              {visibleFiles.length === 0 ? (
                <div className="wd-loading">No listings{q ? ` for "${query}"` : ''}.</div>
              ) : (
                <ul>
                  {visibleFiles.map((f) => (
                    <li key={f.id}>
                      <button onClick={() => f.ref && onInspect('properties', f.ref)} title={f.meta}>
                        <span className="wd-file-ic"><i className={`bi ${f.icon}`} /></span>
                        <span className="wd-file-txt">{f.name}<em>{f.meta}</em></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="wd-right">
              <section className="wd-card wd-teamstrip">
                <h3>Team</h3>
                <div className="wd-teamstats">
                  <div>
                    <em>Total accounts</em><strong>{stats.total}</strong>
                    <span className="wd-bar"><i style={{ width: `${Math.round((stats.total / maxStrip) * 100)}%` }} /></span>
                    <small>+{stats.newUsers} this week</small>
                  </div>
                  <div>
                    <em>Pending</em><strong>{stats.pendingTotal}</strong>
                    <span className="wd-bar"><i style={{ width: `${Math.round((stats.pendingTotal / maxStrip) * 100)}%` }} /></span>
                    <small>+{stats.newPending} this week</small>
                  </div>
                  <div>
                    <em>Verified</em><strong>{stats.validated}</strong>
                    <span className="wd-bar"><i style={{ width: `${Math.round((stats.validated / maxStrip) * 100)}%` }} /></span>
                    <small>accounts + live</small>
                  </div>
                </div>
                <svg className="wd-spark" viewBox="0 0 120 24" preserveAspectRatio="none">
                  <path d={accountsArea.area} fill="rgba(10,132,255,0.12)" stroke="none" />
                  <path d={accountsArea.line} fill="none" stroke="#0A84FF" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </section>

              <section className="wd-teams">
                {teams.map((t) => (
                  <div className="wd-team" key={t.key}>
                    <div className="wd-team-head">
                      <div><h4>{t.name}</h4><p>{t.sub}</p></div>
                      <button className="wd-headbtn light" onClick={() => setTab(t.tab)} title={`View ${t.name}`}>
                        <i className="bi bi-three-dots" />
                      </button>
                    </div>
                    <div className="wd-tl-avs lg">
                      {t.members.length === 0 && <span className="wd-team-empty">—</span>}
                      {t.members.slice(0, 3).map((m) => (
                        <Avatar key={m.id || m.business_name} url={m.avatar_url} name={userName(m)} size={34} />
                      ))}
                    </div>
                    <div className="wd-team-prog">
                      <span>Progress</span>
                      <div className="wd-team-bar"><i style={{ width: `${t.pct}%` }} /></div>
                      <em>{t.pct}%</em>
                    </div>
                    <div className="wd-team-foot">
                      <span><i className="bi bi-check-circle" /> {t.members.length}</span>
                      <span><i className="bi bi-people" /> {new Set(t.members.map((m) => m.id)).size || t.members.length}</span>
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
