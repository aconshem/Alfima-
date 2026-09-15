import { getSession, loadUsers, saveUsers, logActivity, json } from './_utils.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const session = getSession(req);
  if (!session) return json(401, { error: 'Not logged in' });
  if (session.role !== 'superadmin') return json(403, { error: 'Only the super admin can manage users' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
  const { id } = body;
  if (!id) return json(400, { error: 'Missing user id' });

  const users = await loadUsers();
  const target = users.find(u => u.id === id);
  if (!target) return json(404, { error: 'User not found' });

  target.status = 'revoked';
  await saveUsers(users);
  await logActivity(session.email, 'revoke_user', `Revoked ${target.name} (${target.email})`);

  return json(200, { message: 'User access revoked' });
};

export const config = { path: '/api/users/revoke' };
