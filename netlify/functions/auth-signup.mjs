import { hashPassword, newId, loadUsers, saveUsers, logActivity, json, isValidEmail } from './_utils.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }

  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!name) return json(400, { error: 'Name is required' });
  if (!isValidEmail(email)) return json(400, { error: 'A valid email is required' });
  if (password.length < 8) return json(400, { error: 'Password must be at least 8 characters' });

  const users = await loadUsers();
  const existing = users.find(u => u.email === email);

  if (existing && existing.status === 'approved') {
    return json(409, { error: 'An account with this email already exists. Please log in instead.' });
  }
  if (existing && existing.status === 'pending') {
    return json(409, { error: 'A request for this email is already pending approval.' });
  }

  const passwordHash = await hashPassword(password);
  const record = {
    id: existing ? existing.id : newId(),
    name,
    email,
    passwordHash,
    role: 'staff',
    status: 'pending',
    createdAt: Date.now(),
    approvedAt: null
  };

  const nextUsers = existing
    ? users.map(u => (u.id === existing.id ? record : u))
    : [...users, record];

  await saveUsers(nextUsers);
  await logActivity(email, 'signup_request', `${name} requested staff access`);

  return json(200, { message: 'Request submitted. An admin will need to approve your account before you can log in.' });
};

export const config = { path: '/api/auth/signup' };
