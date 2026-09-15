import { verifyPassword, loadUsers, buildSessionCookie, checkSuperadmin, logActivity, json, isValidEmail } from './_utils.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';

  if (!isValidEmail(email) || !password) {
    return json(400, { error: 'Email and password are required' });
  }

  // 1. Root superadmin — credentials live only in Netlify environment variables,
  //    never stored in Blobs, and can't be revoked from inside the panel.
  if (checkSuperadmin(email, password)) {
    const cookie = buildSessionCookie({ uid: 'superadmin', email, role: 'superadmin', name: 'Super Admin' });
    await logActivity(email, 'login', 'Super admin logged in');
    return json(200, { user: { email, role: 'superadmin', name: 'Super Admin' } }, { 'Set-Cookie': cookie });
  }

  // 2. Regular staff account — must exist and be approved.
  const users = await loadUsers();
  const user = users.find(u => u.email === email);

  if (!user || user.status !== 'approved') {
    return json(401, { error: 'Invalid credentials, or your account is not yet approved.' });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return json(401, { error: 'Invalid credentials, or your account is not yet approved.' });
  }

  const cookie = buildSessionCookie({ uid: user.id, email: user.email, role: 'staff', name: user.name });
  await logActivity(email, 'login', `${user.name} logged in`);
  return json(200, { user: { email: user.email, role: 'staff', name: user.name } }, { 'Set-Cookie': cookie });
};

export const config = { path: '/api/auth/login' };
