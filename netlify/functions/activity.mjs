import { getSession, activityStore, json } from './_utils.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const session = getSession(req);
  if (!session) return json(401, { error: 'Not logged in' });

  const store = activityStore();
  const log = (await store.get('log.json', { type: 'json' })) || [];
  return json(200, { activity: log.slice(0, 50) });
};

export const config = { path: '/api/activity' };
