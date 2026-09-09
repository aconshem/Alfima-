import { getSession, contentStore, loadUsers, logActivity, json } from './_utils.mjs';

const DEFAULT_CONTENT = {
  contact: {
    phone1: '+254 721 630 420',
    phone2: '+254 753 646 819',
    whatsapp: '254116252454',
    email: 'alfimaagencyltd@gmail.com',
    location: 'Nairobi, Kenya',
    facebook: '#',
    instagram: '#',
    linkedin: '#',
    tiktok: '#'
  },
  jobs: [
    { title: 'Certified Caregiver', country: 'Germany', category: 'Caregiving', salary: 'KES 180,000 – 220,000 / month', flagEmoji: '🇩🇪', desc: 'Provide daily living support and companionship to elderly residents in a licensed care facility near Munich.' },
    { title: 'Elderly Care Assistant', country: 'Canada', category: 'Caregiving', salary: 'KES 210,000 – 260,000 / month', flagEmoji: '🇨🇦', desc: 'Support seniors with mobility, medication reminders, and companionship in a private residential care setting.' },
    { title: 'Logistics Associate', country: 'Dubai, UAE', category: 'General Employment', salary: 'KES 90,000 – 120,000 / month', flagEmoji: '🇦🇪', desc: 'Handle inventory management, order fulfilment, and warehouse operations for a growing distribution company.' },
    { title: 'Hospitality Staff', country: 'Canada', category: 'General Employment', salary: 'KES 160,000 – 190,000 / month', flagEmoji: '🇨🇦', desc: 'Front-of-house and housekeeping roles available at a 4-star hotel group in Alberta.' },
    { title: 'Domestic Housekeeper', country: 'Saudi Arabia', category: 'Household', salary: 'KES 70,000 – 95,000 / month', flagEmoji: '🇸🇦', desc: 'Manage household chores and childcare support for a verified family employer in Riyadh.' },
    { title: 'Retail Sales Associate', country: 'Dubai, UAE', category: 'General Employment', salary: 'KES 95,000 – 115,000 / month', flagEmoji: '🇦🇪', desc: 'Assist customers on the shop floor of a major retail chain in a busy Dubai mall location.' }
  ]
};

export default async (req) => {
  const store = contentStore();

  if (req.method === 'GET') {
    let data = await store.get('content.json', { type: 'json' });
    if (!data) {
      data = DEFAULT_CONTENT;
      await store.setJSON('content.json', data); // seed it on first run
    }
    return json(200, data, { 'Cache-Control': 'no-store' });
  }

  if (req.method === 'POST') {
    const session = getSession(req);
    if (!session) return json(401, { error: 'Not logged in' });

    // Re-check live status for staff sessions, in case they were revoked
    // after their session token was issued.
    if (session.role === 'staff') {
      const users = await loadUsers();
      const user = users.find(u => u.id === session.uid);
      if (!user || user.status !== 'approved') {
        return json(403, { error: 'Your access has been revoked. Please contact the super admin.' });
      }
    }

    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Invalid request body' }); }

    if (typeof body.contact !== 'object' || !Array.isArray(body.jobs)) {
      return json(400, { error: 'Content must include a contact object and a jobs array' });
    }

    await store.setJSON('content.json', { contact: body.contact, jobs: body.jobs });
    await logActivity(session.email, 'content_update', 'Updated contact info and/or job listings');

    return json(200, { message: 'Saved' });
  }

  return json(405, { error: 'Method not allowed' });
};

export const config = { path: '/api/content' };
