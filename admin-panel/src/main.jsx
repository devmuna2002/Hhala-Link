import React, { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://ntzjjfbmpxgmjuorzwmv.supabase.co',
  'sb_publishable_8vLXHSsl6aVGAULRwATw0Q_SmyWGHEe',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } }
)

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handle = async e => {
    e.preventDefault()
    setError('')
    try {
      const { data, error: ae } = await supabase.auth.signInWithPassword({ email, password })
      if (ae) throw ae
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
      if (profile?.role !== 'admin') {
        await supabase.auth.signOut()
        throw new Error('Admin access required.')
      }
      onLogin(data.user, profile)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="auth-window">
      <div className="auth-card">
        <h1>Hlala Link</h1>
        <p>Admin Panel</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handle}>
          <input type="email" placeholder="admin@hlalalink.com" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} required />
          <button className="btn">Sign In</button>
        </form>
      </div>
    </div>
  )
}

function Topbar({ page, setPage, onLogout }) {
  const tabs = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'users', label: 'Users' },
    { id: 'properties', label: 'Properties' },
    { id: 'movers', label: 'Movers' },
  ]
  return (
    <div className="topbar">
      <div className="brand">
        <span className="mark">HL</span>
        Hlala Link <em className="muted">Admin Panel</em>
      </div>
      <div className="tabs">
        {tabs.map(t => (
          <button key={t.id} className={'tab' + (page === t.id ? ' active' : '')} onClick={() => setPage(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <button className="btn-small" onClick={onLogout}>Sign out</button>
    </div>
  )
}

function Dashboard({ users, properties, movers }) {
  const roleCount = r => users.filter(u => u.role === r).length
  const stats = [
    { label: 'Users', value: users.length, id: 'stat-users' },
    { label: 'Properties', value: properties.length, id: 'stat-properties' },
    { label: 'Movers', value: movers.length, id: 'stat-movers' },
  ]
  return (
    <div className="main">
      <h2>Overview</h2>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        {stats.map(s => (
          <div className="card" style={{ flex: 1, marginTop: 0 }} key={s.id}>
            <div className="muted" style={{ fontSize: 12 }}>{s.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        {['admin', 'agent', 'mover', 'landlord', 'tenant'].map(r => (
          <div className="card" style={{ flex: 1, marginTop: 0 }} key={r}>
            <span className={'badge badge-' + r}>{r}</span>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 8 }}>{roleCount(r)}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Pending approvals</h2>
        {users.filter(u => u.approval_status === 'pending').length === 0 ? (
          <div className="empty">No pending user approvals.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>City</th><th>Status</th></tr>
              </thead>
              <tbody>
                {users.filter(u => u.approval_status === 'pending').map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.first_name || '—'} {u.last_name || ''}</strong></td>
                    <td>{u.email || '—'}</td>
                    <td>{u.role}</td>
                    <td>{u.city || '—'}</td>
                    <td><span className={'status status-' + u.approval_status}>{u.approval_status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function UsersPage({ users, refresh }) {
  const [q, setQ] = useState('')
  const [fr, setFr] = useState('all')

  const filt = users.filter(u =>
    (fr === 'all' || u.role === fr) &&
    (((u.first_name || '') + ' ' + (u.last_name || '')).toLowerCase().includes(q.toLowerCase()) ||
      (u.email || '').toLowerCase().includes(q.toLowerCase()) ||
      (u.city || '').toLowerCase().includes(q.toLowerCase()))
  )

  const setApproval = async (id, approved) => {
    const { error } = await supabase.rpc('admin_set_user_approval', { p_user_id: id, p_approved: approved })
    if (error) alert(error.message)
    else {
      alert(approved ? 'Approved' : 'Rejected')
      refresh()
    }
  }

  return (
    <div className="main">
      <h2>Users</h2>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <input className="search" style={{ marginBottom: 0 }} placeholder="Search name, email, city..." value={q} onChange={e => setQ(e.target.value)} />
        <select value={fr} onChange={e => setFr(e.target.value)} style={{ height: 44, padding: '0 12px', border: '1.5px solid var(--border)', borderRadius: 12, fontFamily: 'inherit', background: 'var(--card)' }}>
          <option value="all">All roles</option>
          <option value="admin">Admin</option>
          <option value="agent">Agent</option>
          <option value="mover">Mover</option>
          <option value="tenant">Tenant</option>
          <option value="landlord">Landlord</option>
        </select>
      </div>
      <div className="card">
        {filt.length === 0 ? (
          <div className="empty">No users found.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>City</th><th>Approval</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filt.map(u => (
                  <tr key={u.id}>
                    <td><strong>{u.first_name || '—'} {u.last_name || ''}</strong></td>
                    <td>{u.email || '—'}</td>
                    <td><span className={'badge badge-' + u.role}>{u.role}</span></td>
                    <td>{u.city || '—'}</td>
                    <td><span className={'status status-' + (u.approval_status || 'approved')}>{u.approval_status || 'approved'}</span></td>
                    <td>
                      {u.role !== 'admin' && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-small approve" onClick={() => setApproval(u.id, true)}>Approve</button>
                          <button className="btn-small reject" onClick={() => setApproval(u.id, false)}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function PropertiesPage({ properties, refresh }) {
  const [q, setQ] = useState('')
  const [fs, setFs] = useState('all')

  const filt = properties.filter(p =>
    (fs === 'all' || p.status === fs) &&
    ((p.title || '').toLowerCase().includes(q.toLowerCase()) ||
      (p.city || '').toLowerCase().includes(q.toLowerCase()) ||
      (p.address || '').toLowerCase().includes(q.toLowerCase()))
  )

  const setStatus = async (id, status) => {
    const { error } = await supabase.from('properties').update({ status }).eq('id', id)
    if (error) alert(error.message)
    else {
      alert(status === 'available' ? 'Approved' : 'Rejected')
      refresh()
    }
  }

  return (
    <div className="main">
      <h2>Properties</h2>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <input className="search" style={{ marginBottom: 0 }} placeholder="Search title, city, address..." value={q} onChange={e => setQ(e.target.value)} />
        <select value={fs} onChange={e => setFs(e.target.value)} style={{ height: 44, padding: '0 12px', border: '1.5px solid var(--border)', borderRadius: 12, fontFamily: 'inherit', background: 'var(--card)' }}>
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="available">Available</option>
          <option value="rented">Rented</option>
          <option value="inactive">Inactive</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      <div className="card">
        {filt.length === 0 ? (
          <div className="empty">No properties found.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Title</th><th>Type</th><th>City</th><th>Rent (USD)</th><th>Bed</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filt.map(p => (
                  <tr key={p.id}>
                    <td><strong>{p.title || '—'}</strong></td>
                    <td>{p.property_type || '—'}</td>
                    <td>{p.city || '—'}</td>
                    <td>{p.rent_usd || '—'}</td>
                    <td>{p.bedrooms ?? '—'}</td>
                    <td><span className={'status status-' + p.status}>{p.status}</span></td>
                    <td>
                      {p.status !== 'available' && (
                        <button className="btn-small approve" onClick={() => setStatus(p.id, 'available')}>Approve</button>
                      )}
                      {p.status === 'available' && (
                        <button className="btn-small reject" onClick={() => setStatus(p.id, 'rejected')}>Reject</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function MoversPage({ movers }) {
  return (
    <div className="main">
      <h2>Movers</h2>
      <div className="card">
        {movers.length === 0 ? (
          <div className="empty">No movers registered.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Phone</th><th>City</th><th>Base price</th><th>Rating</th><th>Approval</th></tr>
              </thead>
              <tbody>
                {movers.map(m => (
                  <tr key={m.id}>
                    <td><strong>{m.name || m.owner_name || '—'}</strong></td>
                    <td>{m.phone_number || '—'}</td>
                    <td>{m.city || '—'}</td>
                    <td>{m.base_price_usd ?? '—'}</td>
                    <td>{m.rating ?? '—'}</td>
                    <td><span className={'status status-' + (m.approval_status || 'pending')}>{m.approval_status || 'pending'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [users, setUsers] = useState([])
  const [properties, setProperties] = useState([])
  const [movers, setMovers] = useState([])
  const [loading, setLoading] = useState(true)

  const loadData = async () => {
    try {
      const [usr, prop, mov] = await Promise.all([
        supabase.from('profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('properties').select('*').order('created_at', { ascending: false }),
        supabase.from('movers').select('*'),
      ])
      if (usr.error) throw usr.error
      if (prop.error) throw prop.error
      setUsers(usr.data || [])
      setProperties(prop.data || [])
      setMovers(mov.error ? [] : (mov.data || []))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) loadData()
  }, [user])

  if (!user) return <Login onLogin={() => setUser(true)} />

  return (
    <div className="shell">
      <Topbar page={page} setPage={setPage} onLogout={() => { supabase.auth.signOut(); setUser(null) }} />
      {loading ? <div className="empty">Loading…</div> : page === 'dashboard' && <Dashboard users={users} properties={properties} movers={movers} />}
      {!loading && page === 'users' && <UsersPage users={users} refresh={loadData} />}
      {!loading && page === 'properties' && <PropertiesPage properties={properties} refresh={loadData} />}
      {!loading && page === 'movers' && <MoversPage movers={movers} />}
    </div>
  )
}

import { createRoot } from 'react-dom/client'
createRoot(document.getElementById('root')).render(<App />)