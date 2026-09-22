/* ==========================================================================
   API CLIENT — talks to the BitMine backend.
   - Access token (15 min) + refresh token (60 days, rotating) in storage.
   - A 401 triggers one shared refresh, then the request is retried once.
   - Errors carry the backend's code and user-facing message.
   ========================================================================== */

import { config } from './config.js';

const KEY = 'bitmine.session';

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let session = load();
let refreshing = null;
const listeners = new Set();

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

function save(s) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session lives in memory only */
  }
  listeners.forEach((fn) => fn(Boolean(s)));
}

export const auth = {
  get signedIn() {
    return Boolean(session?.refreshToken);
  },
  get user() {
    return session?.user ?? null;
  },
  /** Called with the backend's session response ({accessToken, refreshToken, user}). */
  set(res) {
    save({ accessToken: res.accessToken, refreshToken: res.refreshToken, user: res.user, expiresAt: Date.now() + (res.accessTokenExpiresIn ?? 900) * 1000 });
  },
  updateUser(user) {
    if (session) save({ ...session, user });
  },
  clear() {
    save(null);
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

async function refreshTokens() {
  if (!session?.refreshToken) throw new ApiError(401, 'session_expired', 'Please sign in again.');
  refreshing ??= (async () => {
    try {
      const res = await raw('POST', '/v1/auth/refresh', { refreshToken: session.refreshToken });
      auth.set(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) auth.clear();
      throw err;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function raw(method, path, body, token) {
  let res;
  try {
    res = await fetch(config.apiUrl + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach BitMine. Check your connection and try again.");
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const { error, message, ...details } = data;
    throw new ApiError(res.status, error || 'error', message || 'Something went wrong. Please try again.', details);
  }
  return data;
}

/** Authenticated request (refreshes the access token when needed). */
export async function api(method, path, body) {
  if (!session) throw new ApiError(401, 'unauthorized', 'Please sign in.');
  if (session.expiresAt && Date.now() > session.expiresAt - 30_000) {
    await refreshTokens().catch(() => undefined);
  }
  try {
    return await raw(method, path, body, session?.accessToken);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && session?.refreshToken) {
      await refreshTokens();
      return raw(method, path, body, session?.accessToken);
    }
    throw err;
  }
}

/** Public request (no sign-in). */
export const publicApi = (method, path, body) => raw(method, path, body);

export const get = (path) => api('GET', path);
export const post = (path, body = {}) => api('POST', path, body);
export const patch = (path, body = {}) => api('PATCH', path, body);
