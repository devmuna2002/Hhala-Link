import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode as decodeBase64 } from 'base-64';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const expoHost = Constants.expoConfig?.hostUri?.split(':')[0];
const apiPort = process.env.EXPO_PUBLIC_API_PORT || '3000';
const defaultApiOrigin = expoHost
  ? `http://${expoHost}:${apiPort}`
  : Platform.OS === 'android' ? `http://10.0.2.2:${apiPort}` : `http://localhost:${apiPort}`;
const API_ORIGIN = (
  process.env.EXPO_PUBLIC_API_URL || Constants.expoConfig?.extra?.apiUrl || defaultApiOrigin
).replace(/\/$/, '');
const API_BASE = `${API_ORIGIN}/api`;
const TOKEN_KEY = 'hlala_link_token';
const USER_KEY = 'hlala_link_user';

let currentUser = null;
let activeToken = null;
const authListeners = new Set();

function notifyAuth(event, user = null) {
  const session = user
    ? { access_token: activeToken, refresh_token: activeToken, user }
    : null;
  for (const callback of authListeners) {
    try {
      callback(event, session);
    } catch (error) {
      console.error('[cPanel auth listener]', error);
    }
  }
}

function asUser(user) {
  if (!user) return null;
  const fullName = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return {
    ...user,
    id: String(user.id),
    user_metadata: {
      role: user.role || 'tenant',
      first_name: user.first_name || fullName.split(/\s+/)[0] || '',
      last_name: user.last_name || fullName.split(/\s+/).slice(1).join(' '),
      phone_number: user.phone_number || user.phone || '',
      ...(user.user_metadata || {}),
    },
  };
}

async function token() {
  if (activeToken) return activeToken;
  try {
    const stored = await AsyncStorage.getItem(TOKEN_KEY);
    if (stored) {
      activeToken = stored;
      return stored;
    }
    const mirrorRaw = await AsyncStorage.getItem('hlala_auth_mirror_v1');
    if (mirrorRaw) {
      const mirror = JSON.parse(mirrorRaw);
      const mirrorToken = mirror?.token || mirror?.session?.access_token || mirror?.access_token;
      if (mirrorToken) {
        activeToken = mirrorToken;
        return mirrorToken;
      }
    }
  } catch (_) {}
  return null;
}

async function apiRequest(path, options = {}) {
  // Per-call override (file uploads need longer); default 25s so a stalled
  // request (login on a dying connection, hung query) always settles instead
  // of spinning forever.
  const { timeoutMs, ...fetchOptions } = options;
  const headers = { Accept: 'application/json', ...(fetchOptions.headers || {}) };
  const body = fetchOptions.body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const isBlob = typeof Blob !== 'undefined' && body instanceof Blob;
  const isBinary = body instanceof ArrayBuffer || ArrayBuffer.isView(body) || isFormData || isBlob;
  if (body !== undefined && !isBinary && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const accessToken = await token();
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs || 25000) : null;
  try {
    const requestUrl = path.startsWith('/storage/v1/')
      ? `${API_ORIGIN}${path}`
      : `${API_BASE}${path}`;
    const response = await fetch(requestUrl, {
      ...fetchOptions,
      headers,
      body: body !== undefined && typeof body !== 'string' && !isBinary ? JSON.stringify(body) : body,
      ...(controller ? { signal: controller.signal } : {}),
    });
    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      return {
        data: null,
        error: {
          message: data?.message || `Request failed (${response.status})`,
          status: response.status,
          code: data?.code,
        },
      };
    }
    return { data, error: null };
  } catch (error) {
    // Expo iOS reports an aborted fetch as FetchRequestCanceledException
    // (not AbortError) — map every abort/cancel to the friendly timeout
    // message so screens fall back to cache quietly instead of logging raw
    // native errors for what is usually just a reload-killed request.
    const msg = String(error?.message || '');
    const timedOut = error?.name === 'AbortError' || /abort|cancel|timed\s?out/i.test(msg);
    return { data: null, error: { message: timedOut ? 'Request timed out. Please check your connection and try again.' : (error?.message || 'Could not connect to the cPanel MySQL API.') } };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function requestPushNotification(payload) {
  return apiRequest('/notifications/push', { method: 'POST', body: payload });
}

function result(data, error = null) {
  return { data, error };
}

function dataUriToBytes(dataUri) {
  const match = String(dataUri).match(/^data:([^;,]+)?;base64,(.+)$/s);
  if (!match) return null;
  const binary = decodeBase64(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { bytes, contentType: match[1] || 'application/octet-stream' };
}

async function uploadDataUri(bucket, filePath, value) {
  const decoded = dataUriToBytes(value);
  if (!decoded) return { url: value };
  const response = await supabase.storage.from(bucket).upload(filePath, decoded.bytes.buffer, { contentType: decoded.contentType });
  if (response.error) {
    // Never fall through with the raw data URI: a single phone photo is
    // 100KB+ of base64 and overflows the MySQL TEXT column (65,535 bytes),
    // failing the whole save with ER_DATA_TOO_LONG. Surface the upload
    // failure — with the actual status — so the caller aborts instead.
    const status = response.error?.status;
    const detail = response.error?.message || '';
    let message = 'Photo upload failed. Please check your connection and try again.';
    if (status === 404) {
      message = 'Photo uploads are not enabled on the server yet (404). Please ask the backend to redeploy the API, then try again.';
    } else if (status === 401 || status === 403) {
      message = 'Your session expired. Please sign out and sign in again, then retry the upload.';
    } else if (detail && !/^request failed/i.test(detail)) {
      message = `Photo upload failed: ${detail}`;
    }
    return { url: null, error: { message, status } };
  }
  return { url: supabase.storage.from(bucket).getPublicUrl(filePath).data.publicUrl };
}

// Convert any embedded image data in a profile payload into storage URLs
// before it reaches the API. Returns { values } on success or { error }.
async function uploadProfileMedia(profileValues, currentId) {
  if (typeof profileValues.avatar_url === 'string' && profileValues.avatar_url.startsWith('data:')) {
    const uploaded = await uploadDataUri('avatars', `${currentId}/${Date.now()}.jpg`, profileValues.avatar_url);
    if (uploaded.error) return uploaded;
    profileValues.avatar_url = uploaded.url;
  }
  if (Array.isArray(profileValues.vehicle_photos)) {
    const photos = [];
    for (const [index, photo] of profileValues.vehicle_photos.entries()) {
      const path = `${currentId}/vehicles/${Date.now()}-${index}.jpg`;
      const uploaded = await uploadDataUri('properties', path, photo);
      if (uploaded.error) return uploaded;
      photos.push(uploaded.url);
    }
    profileValues.vehicle_photos = photos;
  }
  // Last line of defense: never PUT embedded image data to the MySQL API.
  if (typeof profileValues.avatar_url === 'string' && profileValues.avatar_url.startsWith('data:')) {
    return { error: { message: 'Profile photo is still uploading. Please wait for the upload to finish and try again.' } };
  }
  return { values: profileValues };
}

function errorResult(message, status = 501) {
  return result(null, { message, status });
}

function readRows(payload, key) {
  const value = payload?.[key];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function matchesFilter(row, filter) {
  let value = row?.[filter.column];
  if (value === undefined) {
    if (filter.column === 'participant_a') value = row?.participant_one ?? row?.participant_a;
    else if (filter.column === 'participant_b') value = row?.participant_two ?? row?.participant_b;
    else if (filter.column === 'participant_one') value = row?.participant_a ?? row?.participant_one;
    else if (filter.column === 'participant_two') value = row?.participant_b ?? row?.participant_two;
    else if (filter.column === 'body') value = row?.message ?? row?.body;
    else if (filter.column === 'message') value = row?.body ?? row?.message;
    else if (filter.column === 'id') value = row?.id;
  }
  const expected = filter.value;
  const strVal = value == null ? '' : String(value).trim();
  const strExp = expected == null ? '' : String(expected).trim();

  switch (filter.operator) {
    case 'eq': {
      if (typeof value === 'boolean' || typeof expected === 'boolean') {
        return Boolean(value) === Boolean(expected);
      }
      return strVal.toLowerCase() === strExp.toLowerCase();
    }
    case 'neq': {
      if (typeof value === 'boolean' || typeof expected === 'boolean') {
        return Boolean(value) !== Boolean(expected);
      }
      return strVal.toLowerCase() !== strExp.toLowerCase();
    }
    case 'gt': return Number(value) > Number(expected);
    case 'gte': return Number(value) >= Number(expected);
    case 'lt': return Number(value) < Number(expected);
    case 'lte': return Number(value) <= Number(expected);
    case 'in': {
      const arr = Array.isArray(expected) ? expected : [expected];
      return arr.some(item => String(item ?? '').trim().toLowerCase() === strVal.toLowerCase());
    }
    case 'notIn': {
      const arr = Array.isArray(expected) ? expected : [expected];
      return !arr.some(item => String(item ?? '').trim().toLowerCase() === strVal.toLowerCase());
    }
    case 'is': {
      if (expected === null) return value == null;
      if (typeof expected === 'boolean') return Boolean(value) === Boolean(expected);
      return strVal.toLowerCase() === strExp.toLowerCase();
    }
    case 'like':
    case 'ilike': {
      const pattern = String(expected).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
      return new RegExp(`^${pattern}$`, 'i').test(strVal);
    }
    default: return true;
  }
}

function filterRows(rows, builder) {
  let filtered = rows.filter(row => builder.filters.every(filter => matchesFilter(row, filter)));
  if (builder.orFilter) {
    const grouped = [];
    const andPattern = /and\(([^()]*)\)/g;
    let match;
    while ((match = andPattern.exec(builder.orFilter)) !== null) {
      grouped.push(match[1]);
    }
    const alternatives = (grouped.length ? grouped : builder.orFilter.split(',')).map(group =>
      group.split(',').map(part => {
        const [column, operator, ...rest] = part.split('.');
        return {
          column: column ? column.trim() : '',
          operator: (operator === 'eq' ? 'eq' : operator || 'eq').trim(),
          value: rest.join('.').trim(),
        };
      })
    );
    filtered = filtered.filter(row => alternatives.some(group => group.every(filter => matchesFilter(row, filter))));
  }
  if (builder.ordering) {
    const { column, ascending } = builder.ordering;
    filtered.sort((left, right) => {
      const a = left?.[column];
      const b = right?.[column];
      const cmp = a == null ? (b == null ? 0 : -1) : b == null ? 1 : a < b ? -1 : a > b ? 1 : 0;
      return ascending ? cmp : -cmp;
    });
  }
  if (builder.rangeValues) {
    const [from, to] = builder.rangeValues;
    filtered = filtered.slice(from, to + 1);
  } else if (builder.maxRows != null) {
    filtered = filtered.slice(0, builder.maxRows);
  }
  return filtered;
}

class QueryBuilder {
  constructor(table) {
    this.table = table;
    this.operation = 'select';
    this.values = null;
    this.filters = [];
    this.orFilter = null;
    this.ordering = null;
    this.maxRows = null;
    this.rangeValues = null;
    this.singleResult = false;
    this.maybeSingleResult = false;
    this.returning = false;
  }

  select(_columns = '*', options = {}) {
    this.returning = true;
    this.selectColumns = typeof _columns === 'string' ? _columns : '*';
    this.countMode = options?.count || null;
    this.head = !!options?.head;
    return this;
  }
  insert(values) { this.operation = 'insert'; this.values = Array.isArray(values) ? values : [values]; return this; }
  upsert(values) { this.operation = 'upsert'; this.values = Array.isArray(values) ? values : [values]; return this; }
  update(values) { this.operation = 'update'; this.values = values || {}; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(column, value) { this.filters.push({ column, value, operator: 'eq' }); return this; }
  neq(column, value) { this.filters.push({ column, value, operator: 'neq' }); return this; }
  gt(column, value) { this.filters.push({ column, value, operator: 'gt' }); return this; }
  gte(column, value) { this.filters.push({ column, value, operator: 'gte' }); return this; }
  lt(column, value) { this.filters.push({ column, value, operator: 'lt' }); return this; }
  lte(column, value) { this.filters.push({ column, value, operator: 'lte' }); return this; }
  in(column, values) { this.filters.push({ column, value: Array.isArray(values) ? values : [values], operator: 'in' }); return this; }
  notIn(column, values) { this.filters.push({ column, value: Array.isArray(values) ? values : [values], operator: 'notIn' }); return this; }
  like(column, value) { this.filters.push({ column, value, operator: 'like' }); return this; }
  ilike(column, value) { this.filters.push({ column, value, operator: 'ilike' }); return this; }
  is(column, value) { this.filters.push({ column, value, operator: 'is' }); return this; }
  not(column, operator, value) {
    if (operator === 'is') this.filters.push({ column, value, operator: 'is' });
    else if (operator === 'in') this.filters.push({ column, value: Array.isArray(value) ? value : [value], operator: 'notIn' });
    else this.filters.push({ column, value, operator: 'neq' });
    return this;
  }
  or(expression) { this.orFilter = expression; return this; }
  match(values) { Object.entries(values || {}).forEach(([column, value]) => this.eq(column, value)); return this; }
  order(column, { ascending = true } = {}) { this.ordering = { column, ascending }; return this; }
  limit(count) { this.maxRows = Math.max(0, Number(count) || 0); return this; }
  range(from, to) { this.rangeValues = [Math.max(0, from), Math.max(from, to)]; return this; }
  single() { this.singleResult = true; return this; }
  maybeSingle() { this.maybeSingleResult = true; return this; }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
  catch(reject) { return this.execute().catch(reject); }

  async execute() {
    try {
      const response = await this.executeTable();
      if (response.error) return response;
      let rows = Array.isArray(response.data) ? response.data : response.data == null ? [] : [response.data];
      let count = null;
      if (this.operation === 'select' || this.operation === 'upsert') {
        if (this.countMode === 'exact') {
          count = filterRows(rows, { ...this, maxRows: null, rangeValues: null }).length;
        }
        rows = filterRows(rows, this);
      }
      const makeResult = data => ({
        ...result(this.head ? null : data),
        ...(count === null ? {} : { count }),
      });
      if (this.singleResult) {
        if (rows.length !== 1) return { ...errorResult(rows.length ? 'Expected one row, received multiple.' : 'No rows found.', 406), count };
        return makeResult(rows[0]);
      }
      if (this.maybeSingleResult) return makeResult(rows[0] || null);
      return makeResult(rows);
    } catch (error) {
      return result(null, { message: error?.message || String(error) });
    }
  }

  async executeTable() {
    const id = this.filters.find(filter => filter.column === 'id' && filter.operator === 'eq')?.value;
    const current = currentUser || await AsyncStorage.getItem(USER_KEY).then(value => value ? JSON.parse(value) : null).catch(() => null);
    const currentId = current?.id;
    const byId = path => apiRequest(path);
    const method = (path, body) => apiRequest(path, { method: 'POST', body });

    if (this.table === 'properties') {
      if (this.operation === 'select') {
        const response = id ? await byId(`/properties/${encodeURIComponent(id)}`) : await apiRequest(`/properties?limit=100${/property_images|profiles!|owner:/.test(this.selectColumns || '') ? '' : '&include_images=0'}`);
        return response.error ? response : result(id ? response.data?.property || null : readRows(response.data, 'properties'));
      }
      if (this.operation === 'insert') {
        const inserted = [];
        for (const item of this.values) {
          const response = await method('/properties', item);
          if (response.error) return response;
          inserted.push(response.data?.property);
        }
        return result(inserted);
      }
      if (this.operation === 'update' && id) {
        const response = await apiRequest(`/properties/${encodeURIComponent(id)}`, { method: 'PUT', body: this.values });
        return response.error ? response : result(response.data?.property || null);
      }
      if (this.operation === 'delete') return this.deleteByIds('properties', id);
    }

    if (this.table === 'profiles') {
      if (this.operation === 'select') {
        const isCurrent = id && currentId && String(id).toLowerCase() === String(currentId).toLowerCase();
        if (isCurrent) {
          const response = await apiRequest('/profiles/me');
          if (response.error) {
            const fallback = await byId(`/profiles/${encodeURIComponent(id)}`);
            if (!fallback.error && fallback.data?.profile) return result([fallback.data.profile]);
            return response;
          }
          const prof = response.data?.profile || response.data?.user || null;
          return result(prof ? [prof] : []);
        }
        if (id) {
          const response = await byId(`/profiles/${encodeURIComponent(id)}`);
          if (response.error) {
            if (currentId && String(id).toLowerCase() === String(currentId).toLowerCase()) {
              const meResp = await apiRequest('/profiles/me');
              const prof = meResp.data?.profile || meResp.data?.user || null;
              if (prof) return result([prof]);
            }
            return response;
          }
          const prof = response.data?.profile || null;
          return result(prof ? [prof] : []);
        }
        const response = await byId('/profiles');
        return response.error ? response : result(readRows(response.data, 'profiles'));
      }
      if (this.operation === 'update' && (!id || (currentId && String(id).toLowerCase() === String(currentId).toLowerCase()))) {
        const converted = await uploadProfileMedia({ ...this.values }, currentId);
        if (converted.error) return result(null, converted.error);
        const response = await apiRequest('/profiles/me', { method: 'PUT', body: converted.values });
        return response.error ? response : result(response.data?.profile || null);
      }
      if (this.operation === 'delete' && id && currentId && String(id).toLowerCase() === String(currentId).toLowerCase()) {
        return apiRequest('/profiles/me', { method: 'DELETE' });
      }
      if ((this.operation === 'insert' || this.operation === 'upsert') && this.values?.length === 1 && currentId && String(this.values[0]?.id).toLowerCase() === String(currentId).toLowerCase()) {
        // Same media conversion as update: EditProfileScreen saves via upsert,
        // and an unconverted data URI overflows the MySQL avatar column.
        const converted = await uploadProfileMedia({ ...this.values[0] }, currentId);
        if (converted.error) return result(null, converted.error);
        const response = await apiRequest('/profiles/me', { method: 'PUT', body: converted.values });
        return response.error ? response : result(response.data?.profile || null);
      }
    }

    if (this.table === 'applications') {
      if (this.operation === 'select') {
        const endpoint = id ? `/applications/${encodeURIComponent(id)}` : this.filters.some(f => f.column === 'applicant_id' && currentId && String(f.value).toLowerCase() === String(currentId).toLowerCase()) ? '/applications/my' : '/applications/received';
        const response = await byId(endpoint);
        if (response.error) return response;
        return result(id ? response.data?.application || null : readRows(response.data, 'applications'));
      }
      if (this.operation === 'insert') {
        const inserted = [];
        for (const item of this.values) {
          const response = await method('/applications', item);
          if (response.error) return response;
          inserted.push(response.data?.application);
        }
        return result(inserted);
      }
      if (this.operation === 'update' && id && this.values?.status) {
        const response = await apiRequest(`/applications/${encodeURIComponent(id)}/status`, { method: 'PUT', body: this.values });
        return response.error ? response : result(response.data?.application || null);
      }
    }

    if (this.table === 'saved_properties') {
      if (this.operation === 'select') {
        const response = await byId('/properties/saved/me');
        if (response.error) return response;
        const rows = readRows(response.data, 'saved').map(row => ({
          ...row,
          properties: row.properties || {
            ...row,
            property_images: row.property_images || [],
            owner: row.owner || {
              id: row.owner_id,
              full_name: row.owner_name || '',
              avatar_url: row.owner_avatar || null,
            },
          },
        }));
        return result(rows);
      }
      const insertedValue = Array.isArray(this.values) ? this.values[0] : this.values;
      const propertyId = insertedValue?.property_id || this.filters.find(f => f.column === 'property_id')?.value;
      if (propertyId && this.operation === 'insert') {
        const response = await method(`/properties/${encodeURIComponent(propertyId)}/save`, {});
        return response.error ? response : result(this.values);
      }
      if (propertyId && this.operation === 'delete') {
        return apiRequest(`/properties/${encodeURIComponent(propertyId)}/save`, { method: 'DELETE' });
      }
    }

    if (this.table === 'conversations') {
      if (this.operation === 'select') {
        const response = await byId('/conversations');
        if (response.error) return response;
        const list = readRows(response.data, 'conversations').map(row => {
          const pA = row.participant_a || row.participant_one;
          const pB = row.participant_b || row.participant_two;
          return {
            ...row,
            participant_a: pA,
            participant_b: pB,
            participant_one: pA,
            participant_two: pB,
            participant_a_profile: row.participant_a_profile || (row.other_user_id === pA ? row.other_user : null),
            participant_b_profile: row.participant_b_profile || (row.other_user_id === pB ? row.other_user : null),
            messages: Array.isArray(row.messages)
              ? row.messages.map(m => ({ ...m, body: m.body || m.message || '', message: m.message || m.body || '' }))
              : [],
          };
        });
        return result(list);
      }
      if (this.operation === 'insert') {
        const inserted = [];
        for (const item of this.values) {
          const participantId = (currentId && String(item.participant_a).toLowerCase() === String(currentId).toLowerCase())
            ? item.participant_b
            : item.participant_a;
          const response = await method('/conversations', { participant_id: participantId, property_id: item.property_id });
          if (response.error) return response;
          const conv = response.data?.conversation;
          if (conv) {
            const pA = conv.participant_a || conv.participant_one;
            const pB = conv.participant_b || conv.participant_two;
            inserted.push({ ...conv, participant_a: pA, participant_b: pB, participant_one: pA, participant_two: pB });
          }
        }
        return result(inserted);
      }
      if (this.operation === 'update' && id && Object.keys(this.values || {}).every(key => key === 'last_message_at')) return result(null);
      if (this.operation === 'delete' && id) return apiRequest(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    if (this.table === 'messages') {
      const conversationFilter = this.filters.find(f => f.column === 'conversation_id');
      const conversationIds = conversationFilter
        ? conversationFilter.operator === 'in' ? conversationFilter.value : [conversationFilter.value]
        : [];
      if (this.operation === 'select' && conversationIds.length) {
        const responses = await Promise.all(conversationIds.map(conversationId =>
          byId(`/conversations/${encodeURIComponent(conversationId)}/messages`)
        ));
        const failed = responses.find(response => response.error);
        if (failed) return failed;
        const allMessages = responses.flatMap(response => readRows(response.data, 'messages')).map(m => ({
          ...m,
          body: m.body || m.message || '',
          message: m.message || m.body || '',
          is_read: Boolean(m.is_read),
        }));
        return result(allMessages);
      }
      if (this.operation === 'select') {
        const response = await byId('/messages');
        if (response.error) return response;
        const allMessages = readRows(response.data, 'messages').map(m => ({
          ...m,
          body: m.body || m.message || '',
          message: m.message || m.body || '',
          is_read: Boolean(m.is_read),
        }));
        return result(allMessages);
      }
      if (this.operation === 'insert') {
        const inserted = [];
        for (const item of this.values) {
          if (!item.conversation_id) return errorResult('conversation_id is required to send a message.', 400);
          const bodyPayload = {
            ...item,
            body: item.body || item.message || '',
          };
          const response = await method(`/conversations/${encodeURIComponent(item.conversation_id)}/messages`, bodyPayload);
          if (response.error) return response;
          const msg = response.data?.message;
          inserted.push(msg ? { ...msg, body: msg.body || msg.message || '', message: msg.message || msg.body || '', is_read: Boolean(msg.is_read) } : msg);
        }
        return result(inserted);
      }
      if (this.operation === 'update' && (this.values?.status === 'read' || this.values?.is_read === true) && conversationIds.length) {
        const responses = await Promise.all(conversationIds.map(conversationId =>
          apiRequest(`/conversations/${encodeURIComponent(conversationId)}/read`, { method: 'PATCH' })
        ));
        return responses.find(response => response.error) || result(null);
      }
      if (this.operation === 'update' && id) {
        const convId = conversationIds[0] || this.filters.find(f => f.column === 'conversation_id')?.value;
        const path = convId
          ? `/conversations/${encodeURIComponent(convId)}/messages/${encodeURIComponent(id)}`
          : `/messages/${encodeURIComponent(id)}`;
        const response = await apiRequest(path, { method: 'PATCH', body: this.values });
        return response.error ? response : result(response.data?.message || null);
      }
      if (this.operation === 'delete' && id) return apiRequest(`/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    if (this.table === 'movers') {
      if (this.operation === 'select') {
        const response = await byId(id ? `/movers/${encodeURIComponent(id)}` : '/movers');
        return response.error ? response : result(id ? response.data?.mover || null : readRows(response.data, 'movers'));
      }
      if (this.operation === 'insert') {
        const inserted = [];
        for (const item of this.values) {
          const response = await method('/movers', item);
          if (response.error) return response;
          inserted.push(response.data?.mover);
        }
        return result(inserted);
      }
      if (this.operation === 'update' && id) {
        const response = await apiRequest(`/movers/${encodeURIComponent(id)}`, { method: 'PATCH', body: this.values });
        return response.error ? response : result(response.data?.mover || null);
      }
    }

    if (this.table === 'mover_bookings') {
      if (this.operation === 'select') {
        const response = await byId('/movers/bookings/me');
        return response.error ? response : result(readRows(response.data, 'bookings'));
      }
      if (this.operation === 'insert') {
        const inserted = [];
        for (const item of this.values) {
          const response = await method(`/movers/${encodeURIComponent(item.mover_id)}/bookings`, item);
          if (response.error) return response;
          inserted.push(response.data?.booking);
        }
        return result(inserted);
      }
      if (this.operation === 'update' && id && this.values?.status) {
        const response = await apiRequest(`/movers/bookings/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: this.values });
        return response.error ? response : result(response.data?.booking || null);
      }
    }

    if (this.table === 'notifications') {
      if (this.operation === 'select') {
        const response = await byId('/notifications/me');
        if (response.error) return response;
        const rawList = readRows(response.data, 'notifications');
        const notifications = rawList.map(n => {
          let actor = n.actor;
          if (typeof actor === 'string') {
            try { actor = JSON.parse(actor); } catch (_) {}
          }
          let notifData = n.data;
          if (typeof notifData === 'string') {
            try { notifData = JSON.parse(notifData); } catch (_) {}
          }
          return {
            ...n,
            actor: actor || null,
            data: notifData || {},
            body: n.body || n.message || '',
            message: n.message || n.body || '',
            is_read: Boolean(n.is_read),
          };
        });
        return result(notifications);
      }
      if (this.operation === 'update') {
        if (id) {
          const response = await apiRequest(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
          return response.error ? response : result(response.data);
        }
        const response = await apiRequest('/notifications/read-all', { method: 'PATCH' });
        return response.error ? response : result(response.data);
      }
      if (this.operation === 'delete' && id) return apiRequest(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }

    if (this.table === 'subscriptions' && this.operation === 'select') {
      const response = await byId('/subscriptions/me');
      return response.error ? response : result(readRows(response.data, 'subscription'));
    }

    if (this.table === 'property_images' && this.operation === 'select') {
      const propertyFilter = this.filters.find(filter => filter.column === 'property_id');
      if (!propertyFilter) return result([]);
      const ids = propertyFilter.operator === 'in' ? propertyFilter.value : [propertyFilter.value];
      const response = await byId(`/properties/images?property_ids=${encodeURIComponent(ids.join(','))}`);
      return response.error ? response : result(readRows(response.data, 'images'));
    }

    if (this.table === 'property_images' && this.operation === 'insert') {
      const inserted = [];
      for (const [index, image] of this.values.entries()) {
        const propertyId = image.property_id;
        if (!propertyId) return errorResult('property_id is required to attach an image.', 400);
        let imageUrl = image.url;
        if (typeof imageUrl === 'string' && imageUrl.startsWith('data:')) {
          const user = current || {};
          const uploaded = await uploadDataUri('properties', `${user.id}/properties/${propertyId}/${Date.now()}-${index}.jpg`, imageUrl);
          if (uploaded.error) return uploaded;
          imageUrl = uploaded.url;
        }
        const response = await method(`/properties/${encodeURIComponent(propertyId)}/images`, { images: [{ ...image, url: imageUrl }] });
        if (response.error) return response;
        inserted.push(...readRows(response.data, 'images'));
      }
      return result(inserted);
    }

    if (this.table === 'saved_searches') {
      const response = await this.savedSearches();
      return response;
    }

    if (this.table === 'mover_reviews' && this.operation === 'select') {
      const moverId = this.filters.find(filter => filter.column === 'mover_id')?.value;
      if (!moverId) return result([]);
      const response = await byId(`/movers/${encodeURIComponent(moverId)}/reviews`);
      return response.error ? response : result(readRows(response.data, 'reviews'));
    }

    if (this.table === 'mover_reviews' && this.operation === 'insert') {
      const review = this.values[0];
      const booking = review.booking_id;
      if (!booking) return errorResult('booking_id is required to submit a mover review.', 400);
      const response = await method(`/movers/bookings/${encodeURIComponent(booking)}/reviews`, review);
      return response.error ? response : result(response.data?.review || null);
    }

    if (this.table === 'reviews') {
      if (this.operation === 'select') {
        const propertyId = this.filters.find(f => f.column === 'property_id')?.value;
        const moverId = this.filters.find(f => f.column === 'mover_id')?.value;
        const query = propertyId ? `?property_id=${encodeURIComponent(propertyId)}` : moverId ? `?mover_id=${encodeURIComponent(moverId)}` : '';
        const response = await byId(`/reviews${query}`);
        return response.error ? response : result(readRows(response.data, 'reviews'));
      }
      if (this.operation === 'insert') {
        const response = await method('/reviews', this.values[0]);
        return response.error ? response : result(response.data?.review || null);
      }
    }

    if (this.table === 'user_follows') {
      const follower = this.filters.find(filter => filter.column === 'follower_id')?.value;
      const following = this.filters.find(filter => filter.column === 'following_id')?.value;
      const target = following || this.values?.[0]?.following_id;
      if (this.operation === 'select') {
        if (!target) return errorResult('Checking follow status requires a following_id filter.', 400);
        const response = await byId(`/profiles/${encodeURIComponent(target)}/is-following`);
        if (response.error) return response;
        const row = response.data?.is_following ? { follower_id: follower || currentId, following_id: target } : null;
        return result(row);
      }
      if (this.operation === 'insert') {
        if (!target) return errorResult('Following requires a following_id.', 400);
        const response = await method(`/profiles/${encodeURIComponent(target)}/follow`, {});
        return response.error ? response : result([{ follower_id: follower || currentId, following_id: target }]);
      }
      if (this.operation === 'delete') {
        if (!target) return errorResult('Unfollowing requires a following_id.', 400);
        const response = await apiRequest(`/profiles/${encodeURIComponent(target)}/follow`, { method: 'DELETE' });
        return response.error ? response : result(null);
      }
    }

    if (this.table === 'property_images') {
      if (this.operation === 'select') {
        const ids = this.filters.find(filter => filter.column === 'property_id')?.value;
        const list = (Array.isArray(ids) ? ids : String(ids || '').split(',')).flatMap(v => String(v).split(',')).map(v => v.trim()).filter(Boolean);
        if (!list.length) return errorResult('Loading property images requires a property_id filter.', 400);
        const response = await byId(`/properties/images?property_ids=${list.slice(0, 100).map(encodeURIComponent).join(',')}`);
        return response.error ? response : result(readRows(response.data, 'images'));
      }
      if (this.operation === 'delete') {
        const propertyFilter = this.filters.find(filter => filter.column === 'property_id');
        const propertyId = propertyFilter
          ? (Array.isArray(propertyFilter.value) ? propertyFilter.value[0] : propertyFilter.value)
          : null;
        if (!propertyId) return errorResult('Deleting property images requires a property_id filter.', 400);
        const urlFilter = this.filters.find(filter => filter.column === 'url' && (filter.operator === 'in' || filter.operator === 'eq'));
        const urlList = urlFilter ? (Array.isArray(urlFilter.value) ? urlFilter.value : [urlFilter.value]) : [];
        if (!urlList.length) return errorResult('No images provided.', 400);
        return apiRequest(`/properties/${encodeURIComponent(propertyId)}/images`, { method: 'DELETE', body: { urls: urlList } });
      }
    }

    return errorResult(`The cPanel MySQL API does not support ${this.operation} on "${this.table}" yet.`);
  }

  async deleteByIds(resource, id) {
    const ids = id ? [id] : this.filters.find(filter => filter.column === 'id' && filter.operator === 'in')?.value;
    if (!ids?.length) return errorResult(`Deleting ${resource} requires an id filter.`, 400);
    const responses = await Promise.all(ids.map(item => apiRequest(`/${resource}/${encodeURIComponent(item)}`, { method: 'DELETE' })));
    const failed = responses.find(response => response.error);
    return failed || result(null);
  }

  async savedSearches() {
    const id = this.filters.find(filter => filter.column === 'id')?.value;
    if (this.operation === 'select') {
      const response = await apiRequest('/saved-searches');
      return response.error ? response : result(readRows(response.data, 'saved_searches'));
    }
    if (this.operation === 'insert') {
      const inserted = [];
      for (const item of this.values) {
        const response = await apiRequest('/saved-searches', { method: 'POST', body: item });
        if (response.error) return response;
        inserted.push(response.data?.saved_search);
      }
      return result(inserted);
    }
    if (this.operation === 'delete' && id) return apiRequest(`/saved-searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return errorResult('Unsupported saved search operation.');
  }
}

const auth = {
  async getSession() {
    let accessToken = activeToken || await AsyncStorage.getItem(TOKEN_KEY);
    let rawUser = currentUser ? JSON.stringify(currentUser) : await AsyncStorage.getItem(USER_KEY);

    if (!accessToken || !rawUser) {
      try {
        const mirrorRaw = await AsyncStorage.getItem('hlala_auth_mirror_v1');
        if (mirrorRaw) {
          const mirror = JSON.parse(mirrorRaw);
          accessToken = accessToken || mirror?.token || mirror?.session?.access_token || mirror?.access_token;
          if (!rawUser && mirror?.user) rawUser = JSON.stringify(mirror.user);
        }
      } catch (_) {}
    }

    if (!accessToken || !rawUser) return result({ session: null });
    try {
      const cachedUser = asUser(JSON.parse(rawUser));
      activeToken = accessToken;
      currentUser = cachedUser;

      const response = await apiRequest('/auth/session');
      if (response.error?.status === 401) {
        await clearSession();
        return result({ session: null });
      }

      const user = response.error ? cachedUser : asUser(response.data?.user || cachedUser);
      const sessionToken = response.error ? accessToken : response.data?.token || accessToken;
      if (!response.error) await saveSession(sessionToken, user);
      currentUser = user;
      activeToken = sessionToken;
      return result({ session: { access_token: sessionToken, refresh_token: sessionToken, user } });
    } catch {
      if (accessToken && rawUser) {
        try {
          const fallbackUser = asUser(JSON.parse(rawUser));
          currentUser = fallbackUser;
          activeToken = accessToken;
          return result({ session: { access_token: accessToken, refresh_token: accessToken, user: fallbackUser } });
        } catch (_) {}
      }
      await clearSession();
      return result({ session: null });
    }
  },
  async getUser() {
    const { data } = await this.getSession();
    return result({ user: data.session?.user || null });
  },
  onAuthStateChange(callback) {
    authListeners.add(callback);
    this.getSession().then(({ data }) => callback(data.session ? 'SIGNED_IN' : 'SIGNED_OUT', data.session));
    return { data: { subscription: { unsubscribe: () => authListeners.delete(callback) } } };
  },
  async setSession({ access_token }) {
    if (!access_token) return result({ session: null }, { message: 'Access token is required.' });
    await AsyncStorage.setItem(TOKEN_KEY, access_token);
    const response = await apiRequest('/profiles/me');
    if (response.error) {
      await clearSession();
      return result({ session: null }, response.error);
    }
    const user = asUser(response.data?.user || response.data?.profile);
    await saveSession(access_token, user);
    notifyAuth('SIGNED_IN', user);
    return result({ session: { access_token, refresh_token: access_token, user } });
  },
  async signInWithPassword({ email, password }) {
    const response = await apiRequest('/auth/login', { method: 'POST', body: { email, password } });
    if (response.error) return result({ user: null, session: null }, response.error);
    const user = asUser(response.data.user);
    await saveSession(response.data.token, user);
    notifyAuth('SIGNED_IN', user);
    return result({ user, session: { access_token: response.data.token, refresh_token: response.data.token, user } });
  },
  async signUp({ email, password, options = {} }) {
    const metadata = options.data || {};
    const response = await apiRequest('/auth/register', {
      method: 'POST',
      body: {
        email,
        password,
        first_name: metadata.first_name,
        last_name: metadata.last_name,
        phone_number: metadata.phone_number,
        role: metadata.role,
        city: metadata.city,
      },
    });
    if (response.error) return result({ user: null, session: null }, response.error);
    const user = asUser({ ...response.data.user, user_metadata: metadata });
    await saveSession(response.data.token, user);
    notifyAuth('SIGNED_IN', user);
    return result({ user, session: { access_token: response.data.token, refresh_token: response.data.token, user } });
  },
  async signOut() {
    await clearSession();
    currentUser = null;
    notifyAuth('SIGNED_OUT');
    return { error: null };
  },
  async updateUser(updates) {
    const avatarUrl = updates?.data?.avatar_url;
    if (typeof avatarUrl === 'string' && avatarUrl.startsWith('data:')) {
      return result({ user: null }, { message: 'Profile photo must finish uploading before saving. Please try again.' });
    }
    const response = await apiRequest('/profiles/me', { method: 'PUT', body: updates.data || {} });
    if (response.error) return result({ user: null }, response.error);
    const user = asUser(response.data?.profile || currentUser);
    if (user) {
      await saveSession(activeToken, user);
    }
    currentUser = user;
    return result({ user });
  },
  get currentUser() { return currentUser; },
};

async function saveSession(accessToken, user) {
  currentUser = user;
  activeToken = accessToken;
  const mirrorData = {
    token: accessToken,
    access_token: accessToken,
    user,
    session: { access_token: accessToken, refresh_token: accessToken, user },
  };
  await Promise.all([
    AsyncStorage.setItem(TOKEN_KEY, accessToken || ''),
    AsyncStorage.setItem(USER_KEY, JSON.stringify(user || {})),
    AsyncStorage.setItem('hlala_auth_mirror_v1', JSON.stringify(mirrorData)).catch(() => {}),
  ]);
}

async function clearSession() {
  activeToken = null;
  currentUser = null;
  await Promise.all([
    AsyncStorage.removeItem(TOKEN_KEY),
    AsyncStorage.removeItem(USER_KEY),
    AsyncStorage.removeItem('hlala_auth_mirror_v1').catch(() => {}),
  ]);
}

function makeChannel(name) {
  const registrations = [];
  let timer = null;
  let subscribed = false;

  const channel = {
    on(_type, options, callback) {
      registrations.push({ options: options || {}, callback, previous: new Map(), initialized: false });
      return channel;
    },
    subscribe(statusCallback) {
      if (subscribed) return channel;
      subscribed = true;
      let pollInFlight = false;
      const poll = async (initial = false) => {
        // Slow network: a poll can outlast the 4s interval. Overlapping polls
        // diff against the same stale snapshot and double-fire INSERT
        // callbacks (duplicate popups, duplicate chat echoes) — skip instead.
        if (!initial && pollInFlight) return;
        pollInFlight = true;
        try {
        for (const registration of registrations) {
          const { options, callback, previous } = registration;
          const query = new QueryBuilder(options.table || '');
          query.select('*');
          const expression = options.filter?.match(/^([^=]+)=eq\.(.+)$/);
          if (expression) query.eq(expression[1], expression[2]);
          const response = await query.execute();
          if (response.error) continue;
          const rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
          const next = new Map(rows.filter(row => row?.id != null).map(row => [String(row.id), row]));
          if (!initial && registration.initialized) {
            for (const [rowId, row] of next) {
              const old = previous.get(rowId);
              if (!old) callback({ eventType: 'INSERT', new: row, old: {} });
              else if (JSON.stringify(old) !== JSON.stringify(row)) callback({ eventType: 'UPDATE', new: row, old });
            }
            for (const [rowId, old] of previous) {
              if (!next.has(rowId)) callback({ eventType: 'DELETE', new: {}, old });
            }
          }
          registration.previous = next;
          registration.initialized = true;
        }
        } finally {
          pollInFlight = false;
        }
        if (initial) statusCallback?.('SUBSCRIBED');
      };
      poll(true);
      timer = setInterval(() => poll(false), 4000);
      return channel;
    },
    unsubscribe() {
      subscribed = false;
      if (timer) clearInterval(timer);
      timer = null;
      return Promise.resolve('ok');
    },
    topic: name,
  };
  return channel;
}

const storage = {
  from(bucket) {
    return {
      async upload(filePath, source, options = {}) {
        try {
          let body = source;
          let contentType = options.contentType;
          if (typeof source === 'string' && source.startsWith('data:')) {
            const decoded = dataUriToBytes(source);
            if (decoded) {
              body = decoded.bytes.buffer;
              contentType = contentType || decoded.contentType;
            }
          }
          if (typeof source === 'string' && (/^(file|content|data):/.test(source))) {
            if (!source.startsWith('data:')) {
              const fileResponse = await fetch(source);
              body = await fileResponse.blob();
            }
          }
          const headers = {};
          if (contentType) headers['Content-Type'] = contentType;
          const response = await apiRequest(`/storage/v1/object/${encodeURIComponent(bucket)}/${filePath.split('/').map(encodeURIComponent).join('/')}`, {
            method: 'POST',
            headers,
            body,
            // Photo/video uploads on slow mobile data need longer than the
            // default 25s request timeout.
            timeoutMs: 120000,
          });
          return response.error ? response : result({ path: filePath });
        } catch (error) {
          return result(null, { message: error?.message || 'Upload failed.' });
        }
      },
      getPublicUrl(filePath) {
        return { data: { publicUrl: `${API_ORIGIN}/storage/v1/object/public/${encodeURIComponent(bucket)}/${filePath.split('/').map(encodeURIComponent).join('/')}` } };
      },
      async remove(paths) {
        const responses = await Promise.all(paths.map(filePath => apiRequest(`/storage/v1/object/${encodeURIComponent(bucket)}/${filePath.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' })));
        return responses.find(response => response.error) || result({ paths });
      },
    };
  },
};

const rpc = async (name, params = {}) => {
  if (name === 'increment_property_views') {
    return apiRequest(`/properties/${encodeURIComponent(params.prop_id)}/view`, { method: 'POST' });
  }
  if (name === 'get_user_conversations') {
    const response = await apiRequest('/conversations');
    return response.error ? response : result(readRows(response.data, 'conversations'));
  }
  const bookingId = params.booking_id;
  if (name === 'create_mover_booking') {
    const response = await apiRequest(`/movers/${encodeURIComponent(params.mover_id)}/bookings`, { method: 'POST', body: params.job_details || {} });
    return response.error ? response : result(response.data?.booking || null);
  }
  if (['place_bid', 'accept_booking', 'update_booking_status'].includes(name) && bookingId) {
    const status = name === 'place_bid' ? 'bidded' : name === 'accept_booking' ? 'accepted' : params.new_status;
    const response = await apiRequest(`/movers/bookings/${encodeURIComponent(bookingId)}/status`, {
      method: 'PATCH',
      body: { status, bid_amount: params.amount, ...(params.extra_data || {}) },
    });
    return response.error ? response : result(response.data?.booking || null);
  }
  return errorResult(`RPC "${name}" is not implemented by the cPanel MySQL API.`, 501);
};

export const supabase = {
  supabaseUrl: API_ORIGIN,
  auth,
  storage,
  from(table) { return new QueryBuilder(table); },
  channel(name) { return makeChannel(name); },
  removeChannel(channel) { return channel?.unsubscribe?.(); },
  rpc,
};

export async function getSessionUser() {
  const { data } = await auth.getUser();
  return data.user;
}

export { API_ORIGIN };

console.log('[Hlala Link] cPanel MySQL Expo adapter loaded:', API_ORIGIN);