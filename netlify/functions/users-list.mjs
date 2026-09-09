import { getSession, loadUsers, json } from './_utils.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const session = getSession(req);
  if (!session) return json(401, { error: 'Not logged in' });
  if (session.role !== 'superadmin') return json(403, { error: 'Only the super admin can manage users' });

  const users = await loadUsers();
  // Never send password hashes to the client.
  const safe = users.map(({ passwordHash, ...rest }) => rest);
  return json(200, { users: safe });
};

export const config = { path: '/api/users/list' };
