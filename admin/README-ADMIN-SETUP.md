# Al Fima Agency — Admin Panel Setup (one-time)

Your site has a custom admin panel at **yoursite.netlify.app/admin/**. It's
built with Netlify Functions + Netlify Blobs — no third-party auth service,
no external database, nothing to pay for beyond Netlify's free tier.

How it works:
- A single **super admin** account is configured entirely through Netlify's
  environment variables (below). It can't be revoked or deleted from the
  panel itself — think of it as the root account.
- Everyone else (staff) requests access from the `/admin/` login page. The
  super admin approves or revokes those requests from inside the panel — no
  need to touch the Netlify dashboard for day-to-day staff management.
- Site content (contact info + job listings) lives in Netlify Blobs and is
  edited from the **Site Content** tab. Changes go live immediately — no
  redeploy needed.
- Every login, approval, revocation, and content edit is recorded in the
  **Activity Log** tab.

## One-time setup

### 1. Set environment variables
In the Netlify dashboard: **Site settings → Environment variables**, add:

| Key | Value |
|---|---|
| `SUPERADMIN_EMAIL` | the email you'll log in with, e.g. `admin@alfimaagency.com` |
| `SUPERADMIN_PASSWORD` | a strong password — this is your root login |
| `SESSION_SECRET` | any long random string (used to sign login sessions) |

For `SESSION_SECRET`, anything long and random works — for example, run this
once on your computer and paste the output:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Deploy
Push this project to GitHub as usual and let Netlify build it. Netlify will
automatically detect `netlify/functions/` and deploy the API routes
(`/api/auth/login`, `/api/content`, etc.) alongside the site — no extra
configuration needed beyond the `netlify.toml` and `package.json` already
included.

Netlify Blobs (used to store staff accounts, site content, and the activity
log) works automatically on Netlify — no setup, no separate database to
provision.

### 3. Log in
Go to `https://yoursite.netlify.app/admin/` and log in with
`SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.

## Day-to-day use

**Adding a staff member:** send them the `/admin/` link. They click
"Request staff access", fill in their name/email/password, and submit. Their
request appears under the **Users** tab (only visible to the super admin)
with an **Approve** button. Once approved, they can log in with the password
they chose.

**Removing a staff member:** Users tab → **Revoke** next to their name. This
takes effect immediately, even if they're already logged in.

**Editing contact info or job listings:** Site Content tab → edit the
fields or add/remove job cards → **Save Changes**. The public site reads
this live, so changes appear right away.

## Notes

- Staff accounts can edit site content but cannot approve/revoke other
  users — only the super admin account can do that.
- Passwords are never stored in plain text (hashed with scrypt) and session
  cookies are HTTP-only, so they can't be read by page scripts.
- If you ever need a second super admin, you'd add another set of env vars
  and a small code tweak — reach out if you want that.
