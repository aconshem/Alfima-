// Shared helpers used by every function in this folder.
// Nothing here is a route by itself (no `config.path` export), so Netlify
// won't expose it as an endpoint — it's just a shared module.

import { scrypt, randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getStore } from '@netlify/blobs';

const scryptAsync = promisify(scrypt);

/* ---------------- Password hashing (scrypt) ---------------- */

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, keyHex] = stored.split(':');
  const keyBuffer = Buffer.from(keyHex, 'hex');
  const derived = await scryptAsync(password, salt, 64);
  if (derived.length !== keyBuffer.length) return false;
  return timingSafeEqual(derived, keyBuffer);
}

export function newId() {
  return randomUUID();
}

/* ---------------- Session tokens (HMAC-signed cookie) ---------------- */

const SESSION_COOKIE_NAME = 'alfima_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error('SESSION_SECRET environment variable is not set. Add it in Netlify: Site settings -> Environment variables.');
  }
  return secret;
}

export function signSession(payload) {
  const secret = getSessionSecret();
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySessionToken(token) {
  try {
    const secret = getSessionSecret();
    if (!token) return null;
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const expected = createHmac('sha256', secret).update(data).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  const parts = header.split(';').map(p => p.trim());
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

export function getSession(req) {
  const token = getCookie(req, SESSION_COOKIE_NAME);
  return verifySessionToken(token);
}

export function buildSessionCookie(payload) {
  const token = signSession({ ...payload, exp: Date.now() + SESSION_TTL_MS });
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/* ---------------- Blobs stores ---------------- */

export function usersStore() {
  return getStore('alfima-users');
}
export function contentStore() {
  return getStore('alfima-content');
}
export function activityStore() {
  return getStore('alfima-activity');
}

export async function loadUsers() {
  const store = usersStore();
  const data = await store.get('users.json', { type: 'json' });
  return Array.isArray(data) ? data : [];
}
export async function saveUsers(users) {
  const store = usersStore();
  await store.setJSON('users.json', users);
}

export async function logActivity(actor, action, detail) {
  try {
    const store = activityStore();
    const existing = (await store.get('log.json', { type: 'json' })) || [];
    existing.unshift({ ts: Date.now(), actor, action, detail: detail || '' });
    await store.setJSON('log.json', existing.slice(0, 200));
  } catch {
    // Activity logging is best-effort; never block the main action on it.
  }
}

/* ---------------- Response helpers ---------------- */

export function json(status, body, extraHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) }
  });
}

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ---------------- Superadmin (root account, defined via env vars only) ---------------- */

export function checkSuperadmin(email, password) {
  const suEmail = process.env.SUPERADMIN_EMAIL;
  const suPassword = process.env.SUPERADMIN_PASSWORD;
  if (!suEmail || !suPassword) return false;
  const emailMatches = email.toLowerCase() === suEmail.toLowerCase();
  const a = Buffer.from(password);
  const b = Buffer.from(suPassword);
  const passwordMatches = a.length === b.length && timingSafeEqual(a, b);
  return emailMatches && passwordMatches;
}
