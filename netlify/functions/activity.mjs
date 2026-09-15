import { getSession, activityStore, logActivity, json } from './_utils.mjs';

export default async (req) => {
  const session = getSession(req);
  if (!session) return json(401, { error: 'Not logged in' });

  if (req.method === 'GET') {
    // Only the super admin can view the activity log.
    if (session.role !== 'superadmin') return json(403, { error: 'Only the super admin can view the activity log' });
    const store = activityStore();
    const log = (await store.get('log.json', { type: 'json' })) || [];
    return json(200, { activity: log.slice(0, 50) });
  }

  if (req.method === 'POST') {
    // Any logged-in user (staff or super admin) can log their own actions —
    // e.g. generating a CV — even though only the super admin can read the log back.
    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }
    const action = (body.action || 'action').toString().slice(0, 100);
    const detail = (body.detail || '').toString().slice(0, 300);
    await logActivity(session.email, action, detail);
    return json(200, { message: 'Logged' });
  }

  return json(405, { error: 'Method not allowed' });
};

export const config = { path: '/api/activity' };
