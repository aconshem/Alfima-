import { getSession, json } from './_utils.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });
  const session = getSession(req);
  if (!session) return json(200, { authenticated: false });
  return json(200, {
    authenticated: true,
    user: { email: session.email, role: session.role, name: session.name }
  });
};

export const config = { path: '/api/auth/me' };
