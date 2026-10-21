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

Clicking "Create CV" opens a **template picker** first. Two templates are
available:

- **Template 1 — FRST National** (A4, bilingual English/Arabic).
- **Template 2 — One Stop Recruitment Agency** (US Letter).

Each template is its own folder (`admin/create-cv/template-1/`, `template-2/`)
containing `index.html` (form + the printable pages), `template.css` (the
page design), `script.js` (which form field feeds which placeholder) and
`img/logo.jpg` (the fixed logo). Passport reading, autofill, live preview
and printing live once in `admin/create-cv/shared/` (`cv-core.js`,
`builder.css`). To add Template 3, copy a template folder, swap in the new
design, give each changing text a `pv-*` id, map it in `script.js`, and add
a card on the picker page.

Placeholders: every value that changes per candidate is an element with an
id starting `pv-` (e.g. `pv-fullname`, `pv-passportno`); photos are
`pv-headshot`, `pv-fullbody` and `pv-passportscan` (page 2). Everything
else — headings, Arabic text, lines, the logo — is fixed.

How it works:
1. Upload a passport photo/scan (click, or drag-and-drop). The page reads
   the Machine Readable Zone first (checksum-validated) and also OCRs the
   visible page for details like place of birth and height.
2. Every autofilled field stays editable. Amber fields were not read with
   full confidence — double-check them.
3. Upload the photo(s), fill in the rest, add previous-employment
   countries if needed. The live preview on the right updates as you type;
   the form (left) and the preview (right) scroll independently.
4. **Generate PDF** — or **Ctrl+P** (Cmd+P on Mac) — opens the browser's
   print dialog showing only the CV pages. Choose **Save as PDF**. Nothing
   downloads automatically. The suggested file name is the candidate's
   name. Each print is recorded in the Activity Log (who, which candidate,
   which template, when).

Because the PDF comes from the browser's print engine, the text stays
sharp and selectable. If the dialog shows headers/footers or margins,
set Margins to "None" and untick "Headers and footers" (the page already
requests zero margins, which Chrome and Edge honour).

Template 1 has room for two rows of previous employment; Template 2 joins
several countries/periods with commas in its single Country and Period
cells. Template 2's first work-experience box has no label in the supplied
template, so the form lets you type one (leave empty to match the
template).

## Notes

- Staff accounts can edit site content and generate CVs, but cannot
  approve/revoke other users or view the Activity Log — those are
  super-admin only.
- Passwords are never stored in plain text (hashed with scrypt) and session
  cookies are HTTP-only, so they can't be read by page scripts.
- If you ever need a second super admin, you'd add another set of env vars
  and a small code tweak — reach out if you want that.
