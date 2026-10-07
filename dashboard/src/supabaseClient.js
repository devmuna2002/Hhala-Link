const API_BASE = (import.meta.env.VITE_POSTGRES_API_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const TOKEN_KEY = 'hlala_admin_api_token';
const USER_KEY = 'hlala_admin_api_user';
const authListeners = new Set();

function storedSession() {
  try {
    const access_token = localStorage.getItem(TOKEN_KEY);
    const user = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    return access_token && user ? { access_token, refresh_token: access_token, user } : null;
  } catch {
    return null;
  }
}

function notifyAuth(event, session = null) {
  authListeners.forEach((callback) => {
    try { callback(event, session); } catch (error) { console.error('[Dashboard auth listener]', error); }
  });
}

async function request(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      body: options.body === undefined || typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) return { data: null, error: { message: payload?.message || `Request failed (${response.status})`, status: response.status } };
    return { data: payload, error: null };
  } catch (error) {
    return { data: null, error: { message: error?.message || 'Could not connect to the PostgreSQL API.' } };
  }
}

const auth = {
  async signInWithPassword({ email, password }) {
    const response = await request('/auth/login', { method: 'POST', body: { email, password } });
    if (response.error) return { data: { user: null, session: null }, error: response.error };
    const session = { access_token: response.data.token, refresh_token: response.data.token, user: response.data.user };
    localStorage.setItem(TOKEN_KEY, session.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    notifyAuth('SIGNED_IN', session);
    return { data: { user: session.user, session }, error: null };
  },
  async getSession() {
    const current = storedSession();
    if (!current) return { data: { session: null }, error: null };
    const response = await request('/auth/session');
    if (response.error) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return { data: { session: null }, error: response.error };
    }
    const session = {
      access_token: response.data.token,
      refresh_token: response.data.token,
      user: response.data.user,
    };
    localStorage.setItem(TOKEN_KEY, session.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(session.user));
    return { data: { session }, error: null };
  },
  async getUser() {
    return { data: { user: storedSession()?.user || null }, error: null };
  },
  onAuthStateChange(callback) {
    authListeners.add(callback);
    this.getSession().then(({ data }) => callback(data.session ? 'INITIAL_SESSION' : 'SIGNED_OUT', data.session));
    return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } };
  },
  async signOut() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    notifyAuth('SIGNED_OUT');
    return { error: null };
  },
};

function compare(row, filter) {
  const actual = row?.[filter.column];
  const expected = filter.value;
  switch (filter.operator) {
    case 'eq': return String(actual) === String(expected);
    case 'neq': return String(actual) !== String(expected);
    case 'gt': return actual > expected;
    case 'gte': return actual >= expected;
    case 'lt': return actual < expected;
    case 'lte': return actual <= expected;
    case 'in': return expected.some(value => String(actual) === String(value));
    default: return true;
  }
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.operation = 'select';
    this.filters = [];
    this.orderings = [];
    this.maxRows = null;
    this.values = null;
    this.singleResult = false;
    this.maybeSingleResult = false;
    this.countMode = null;
    this.head = false;
  }

  select(_columns = '*', options = {}) { this.operation = 'select'; this.countMode = options.count || null; this.head = Boolean(options.head); return this; }
  eq(column, value) { this.filters.push({ column, operator: 'eq', value }); return this; }
  neq(column, value) { this.filters.push({ column, operator: 'neq', value }); return this; }
  gt(column, value) { this.filters.push({ column, operator: 'gt', value }); return this; }
  gte(column, value) { this.filters.push({ column, operator: 'gte', value }); return this; }
  lt(column, value) { this.filters.push({ column, operator: 'lt', value }); return this; }
  lte(column, value) { this.filters.push({ column, operator: 'lte', value }); return this; }
  in(column, values) { this.filters.push({ column, operator: 'in', value: Array.isArray(values) ? values : [values] }); return this; }
  order(column, { ascending = true } = {}) { this.orderings.push({ column, ascending }); return this; }
  limit(value) { this.maxRows = Math.max(0, Number(value) || 0); return this; }
  single() { this.singleResult = true; return this; }
  maybeSingle() { this.maybeSingleResult = true; return this; }
  update(values) { this.operation = 'update'; this.values = values || {}; return this; }
  insert(values) { this.operation = 'insert'; this.values = Array.isArray(values) ? values : [values]; return this; }
  delete() { this.operation = 'delete'; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  catch(reject) { return this.execute().catch(reject); }

  async execute() {
    if (this.operation === 'select') {
      const response = await request(`/admin/data/${encodeURIComponent(this.table)}`);
      if (response.error) return { data: null, error: response.error, count: null };
      let rows = response.data?.rows || [];
      rows = rows.filter(row => this.filters.every(filter => compare(row, filter)));
      const count = rows.length;
      for (const { column, ascending } of this.orderings) {
        rows.sort((a, b) => {
          const left = a?.[column]; const right = b?.[column];
          const order = left == null ? (right == null ? 0 : -1) : right == null ? 1 : left < right ? -1 : left > right ? 1 : 0;
          return ascending ? order : -order;
        });
      }
      if (this.maxRows != null) rows = rows.slice(0, this.maxRows);
      if (this.head) return { data: null, error: null, count };
      if (this.singleResult) return rows.length === 1 ? { data: rows[0], error: null, count } : { data: null, error: { message: 'Expected one row.', status: 406 }, count };
      if (this.maybeSingleResult) return { data: rows[0] || null, error: null, count };
      return { data: rows, error: null, count: this.countMode ? count : null };
    }

    const id = this.filters.find(filter => filter.column === 'id' && filter.operator === 'eq')?.value;
    if (this.operation === 'update') {
      if (!id) return { data: null, error: { message: 'Updates require an id filter.' } };
      const response = await request(`/admin/data/${encodeURIComponent(this.table)}/${encodeURIComponent(id)}`, { method: 'PATCH', body: this.values });
      return response.error ? { data: null, error: response.error } : { data: response.data?.row || null, error: null };
    }
    if (this.operation === 'delete') {
      if (!id) return { data: null, error: { message: 'Deletes require an id filter.' } };
      return request(`/admin/data/${encodeURIComponent(this.table)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    if (this.operation === 'insert') {
      const response = await request(`/admin/data/${encodeURIComponent(this.table)}`, { method: 'POST', body: this.values });
      return response.error ? { data: null, error: response.error } : { data: response.data?.rows || [], error: null };
    }
    return { data: null, error: { message: `Unsupported ${this.operation} operation.` } };
  }
}

const supabase = {
  auth,
  from(table) { return new QueryBuilder(table); },
  async rpc(name, params = {}) {
    if (name === 'admin_set_user_approval') {
      return request(`/admin/profiles/${encodeURIComponent(params.p_user_id)}/approval`, {
        method: 'POST',
        body: { approved: params.p_approved },
      });
    }
    return { data: null, error: { message: `Unsupported PostgreSQL admin operation: ${name}` } };
  },
};

export { supabase };
