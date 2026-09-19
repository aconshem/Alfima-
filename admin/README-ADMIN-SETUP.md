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

## Create CV

There's a **Create CV** page (linked from the top of the dashboard) for
generating application-for-employment PDFs, one candidate at a time. It
runs entirely in the browser — no server involved except to check you're
logged in and to record the activity log entry.

Clicking "Create CV" opens a **template picker** first, not the editor
directly — this is because more templates are planned. Right now there's
one: **Template 1** (the FRST National bilingual English/Arabic form).
Adding a new template later means dropping a new folder in
`admin/create-cv/template-2/` (etc.) with its own `index.html`/`script.js`/
`styles.css`, and adding a card for it on the picker page — the existing
templates are unaffected.

How Template 1 works:
1. Upload a passport photo/scan (click, or drag-and-drop). The page tries
   to read the Machine Readable Zone (the two lines of text at the bottom
   of the photo page) and checksum-validates it — the most reliable path
   — while a second OCR pass reads the rest of the visible page for
   details like place of birth and height.
2. Every autofilled field stays fully editable. Anything the extraction
   wasn't confident about is highlighted in amber — always double-check
   those before generating.
3. Upload a headshot and a full-body photo, fill in everything the
   passport can't tell you (phone number, position, salary, religion,
   marital status, etc.), add one row per country under Previous
   Employment Abroad if needed, and the live preview on the right updates
   as you type.
4. **Generate PDF** builds the finished two-page CV (the form itself,
   then the passport scan as page 2) and downloads it automatically —
   a "Download Again" button appears afterward in case the browser
   blocks or misplaces the first download. It also logs who generated a
   CV for which candidate, and when, to the Activity Log.

Note on PDF quality: this generates the PDF by rendering the page as an
image (via html2pdf.js), which keeps everything automatic but means the
text isn't selectable/searchable in the PDF like a native document would
be. If that ever becomes a problem, the alternative is a "Print / Save as
PDF" flow using the browser's own print dialog, which produces a sharper,
text-based PDF at the cost of one extra manual click — happy to add that
as a second option if useful.

The visual template (fonts, borders, bilingual Arabic labels, the blue/
orange side bar, photo placement) is built to match the official Word
template as closely as possible. The Arabic labels are reproduced exactly
as they appear in that template, right-aligned — nothing was reworded or
re-centered.

## Notes

- Staff accounts can edit site content and generate CVs, but cannot
  approve/revoke other users or view the Activity Log — those are
  super-admin only.
- Passwords are never stored in plain text (hashed with scrypt) and session
  cookies are HTTP-only, so they can't be read by page scripts.
- If you ever need a second super admin, you'd add another set of env vars
  and a small code tweak — reach out if you want that.
