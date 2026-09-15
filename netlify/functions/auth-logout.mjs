import { clearSessionCookie, getSession, logActivity, json } from './_utils.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const session = getSession(req);
  if (session) await logActivity(session.email, 'logout', `${session.name || session.email} logged out`);
  return json(200, { message: 'Logged out' }, { 'Set-Cookie': clearSessionCookie() });
};

export const config = { path: '/api/auth/logout' };
