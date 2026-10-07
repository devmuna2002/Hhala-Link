/**
 * HLALA LINK — ZERO-SUPABASE BROWSER CLIENT
 * Lightweight, 100% offline-compatible pure JavaScript API client.
 * Connects directly to the local standalone server (Port 8000).
 */
(function() {
  const API_URL = (window.HLALA_CONFIG && window.HLALA_CONFIG.apiUrl) || 'http://localhost:8000';
  const STORAGE_KEY = 'hlala_standalone_session';

  class BrowserQueryBuilder {
    constructor(table) {
      this.table = table;
      this.params = [];
      this.method = 'GET';
      this.body = null;
      this.isSingle = false;
    }

    select(columns = '*') {
      this.params.push('select=' + encodeURIComponent(columns));
      return this;
    }

    insert(values) {
      this.method = 'POST';
      this.body = values;
      return this;
    }

    update(values) {
      this.method = 'PATCH';
      this.body = values;
      return this;
    }

    delete() {
      this.method = 'DELETE';
      return this;
    }

    eq(column, value) {
      this.params.push(encodeURIComponent(column) + '=eq.' + encodeURIComponent(value));
      return this;
    }

    neq(column, value) {
      this.params.push(encodeURIComponent(column) + '=neq.' + encodeURIComponent(value));
      return this;
    }

    in(column, values) {
      const list = Array.isArray(values) ? values.join(',') : values;
      this.params.push(encodeURIComponent(column) + '=in.(' + encodeURIComponent(list) + ')');
      return this;
    }

    ilike(column, pattern) {
      this.params.push(encodeURIComponent(column) + '=ilike.' + encodeURIComponent(pattern));
      return this;
    }

    gt(column, value) {
      this.params.push(encodeURIComponent(column) + '=gt.' + encodeURIComponent(value));
      return this;
    }

    lt(column, value) {
      this.params.push(encodeURIComponent(column) + '=lt.' + encodeURIComponent(value));
      return this;
    }

    order(column, { ascending = true } = {}) {
      this.params.push('order=' + encodeURIComponent(column) + '.' + (ascending ? 'asc' : 'desc'));
      return this;
    }

    limit(count) {
      this.params.push('limit=' + count);
      return this;
    }

    single() {
      this.isSingle = true;
      return this;
    }

    maybeSingle() {
      this.isSingle = true;
      return this;
    }

    then(onFulfilled, onRejected) {
      return this.execute().then(onFulfilled, onRejected);
    }

    catch(onRejected) {
      return this.execute().catch(onRejected);
    }

    async execute() {
      try {
        const qs = this.params.length > 0 ? '?' + this.params.join('&') : '';
        const url = `${API_URL}/rest/v1/${this.table}${qs}`;
        
        let token = null;
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) token = JSON.parse(raw)?.access_token;
        } catch (_) {}

        const headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const options = { method: this.method, headers };
        if (this.body !== null) options.body = JSON.stringify(this.body);

        const res = await fetch(url, options);
        if (!res.ok) {
          let errJson = {};
          try { errJson = await res.json(); } catch (_) {}
          return { data: null, error: { message: errJson.message || errJson.error || `HTTP ${res.status}` } };
        }

        if (res.status === 204) return { data: null, error: null };
        let data = await res.json();
        if (this.isSingle && Array.isArray(data)) data = data[0] || null;
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { message: e?.message || 'Network request failed' } };
      }
    }
  }

  const client = {
    supabaseUrl: API_URL,
    from: (table) => new BrowserQueryBuilder(table),
    auth: {
      async getSession() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          return { data: { session: raw ? JSON.parse(raw) : null }, error: null };
        } catch (_) {
          return { data: { session: null }, error: null };
        }
      },
      async getUser() {
        const { data: { session } } = await client.auth.getSession();
        return { data: { user: session?.user || null }, error: null };
      },
      async signInWithPassword({ email, password }) {
        try {
          const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
          });
          const data = await res.json();
          if (!res.ok || data.error) {
            return { data: { user: null, session: null }, error: { message: data.message || data.error_description || 'Invalid login credentials' } };
          }
          const session = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user: data.user,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
          return { data: { user: session.user, session }, error: null };
        } catch (e) {
          return { data: { user: null, session: null }, error: { message: e?.message || 'Network request failed' } };
        }
      },
      async signUp({ email, password, options = {} }) {
        try {
          const res = await fetch(`${API_URL}/auth/v1/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim().toLowerCase(), password, data: options.data || {} }),
          });
          const data = await res.json();
          if (!res.ok || data.error) {
            return { data: { user: null, session: null }, error: { message: data.message || data.error || 'Signup failed' } };
          }
          const session = {
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user: data.user,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
          return { data: { user: session.user, session }, error: null };
        } catch (e) {
          return { data: { user: null, session: null }, error: { message: e?.message || 'Network request failed' } };
        }
      },
      async signOut() {
        try { await fetch(`${API_URL}/auth/v1/logout`, { method: 'POST' }); } catch (_) {}
        localStorage.removeItem(STORAGE_KEY);
        return { error: null };
      },
      onAuthStateChange(cb) {
        client.auth.getSession().then(({ data: { session } }) => {
          if (session) cb('SIGNED_IN', session);
          else cb('SIGNED_OUT', null);
        });
        return { data: { subscription: { unsubscribe: () => {} } } };
      }
    },
    rpc: async (fn, params = {}) => {
      try {
        const res = await fetch(`${API_URL}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
        const data = await res.json();
        return { data, error: null };
      } catch (e) {
        return { data: null, error: { message: e?.message || 'RPC failed' } };
      }
    },
    storage: {
      from: (bucket) => ({
        getPublicUrl: (path) => ({
          data: { publicUrl: `${API_URL}/storage/v1/object/public/${bucket}/${path.replace(/^\//, '')}` }
        }),
        upload: async (path, file) => {
          try {
            const res = await fetch(`${API_URL}/storage/v1/object/${bucket}/${path.replace(/^\//, '')}`, {
              method: 'POST',
              body: file,
            });
            const data = await res.json();
            return { data, error: null };
          } catch (e) {
            return { data: null, error: { message: e?.message || 'Upload failed' } };
          }
        }
      })
    },
    channel: () => ({ on: function() { return this; }, subscribe: (cb) => { if (cb) cb('SUBSCRIBED'); return this; }, unsubscribe: () => {} }),
    removeChannel: () => {}
  };

  // Expose as window.supabase and window.HlalaDB for 100% backward compatibility
  window.supabase = client;
  window.supabase.createClient = () => client;
  window.HlalaDB = client;
  console.log('[Hlala Standalone] Native client loaded. Zero external cloud dependencies.');
})();
