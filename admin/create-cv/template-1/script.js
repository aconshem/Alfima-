/* =====================================================================
   0. AUTH GUARD — this page lives inside the admin panel (two levels
   deep: admin/create-cv/template-1/), so it needs a valid session.
===================================================================== */
(async function guard() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await res.json();
    if (!data.authenticated) window.location.href = '../../index.html';
  } catch {
    // If the API isn't reachable (e.g. local testing without functions),
    // don't lock the page — just let it work standalone.
  }
})();

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* =====================================================================
   1. MRZ PARSING (TD3 passport format, 2 lines x 44 chars)
   Implemented from scratch (ICAO 9303 checksum algorithm) — no external
   MRZ library needed, so there's nothing to fail to load from a CDN.
===================================================================== */
const MRZ_WEIGHTS = [7, 3, 1];

function mrzCharValue(ch) {
  if (ch === '<') return 0;
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55; // A=10 ... Z=35
  return 0;
}

function mrzChecksum(str) {
  let sum = 0;
  for (let i = 0; i < str.length; i++) {
    sum += mrzCharValue(str[i]) * MRZ_WEIGHTS[i % 3];
  }
  return sum % 10;
}

function mrzDateToDisplay(yyMMdd, isExpiry) {
  if (!/^\d{6}$/.test(yyMMdd)) return '';
  const yy = parseInt(yyMMdd.slice(0, 2), 10);
  const mm = yyMMdd.slice(2, 4);
  const dd = yyMMdd.slice(4, 6);
  // Expiry dates on a currently-valid passport are always 20XX in practice
  // (10-year validity). Birth dates use "00-30 => 2000s, else 1900s".
  const year = isExpiry ? 2000 + yy : (yy <= 30 ? 2000 + yy : 1900 + yy);
  return `${dd}/${mm}/${year}`;
}

// Normalizes an OCR'd MRZ line: OCR sometimes reads the filler character
// '<' as a guillemet or other lookalike, so those get folded in too.
function normalizeMrzOcrLine(line) {
  return line.toUpperCase().replace(/[«»]/g, '<').replace(/[^A-Z0-9<]/g, '').trim();
}

// Scores every adjacent line pair in the OCR text and returns the most
// MRZ-like pair, rather than requiring the first line to start with
// "P<" exactly (OCR often mangles the first couple of characters).
function findMrzLines(rawText) {
  const lines = rawText.split(/\r?\n/).map(normalizeMrzOcrLine).filter(l => l.length >= 28);
  const candidates = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i], b = lines[i + 1];
    if (a.length < 38 || b.length < 38) continue;
    const score = (a.startsWith('P<') ? 40 : 0) + Math.min(a.length, 44) + Math.min(b.length, 44)
      + (a.includes('<') ? 10 : 0) + (b.includes('<') ? 10 : 0);
    candidates.push([a, b, score]);
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => y[2] - x[2]);
  return candidates[0].slice(0, 2).map(l => (l + '<'.repeat(44)).slice(0, 44));
}

function parseMRZ(rawText) {
  const found = findMrzLines(rawText);
  if (!found) return { success: false };
  const [line1, line2] = found;

  try {
    const surnameGiven = line1.slice(5).split('<<');
    const surname = (surnameGiven[0] || '').replace(/</g, ' ').trim();
    const given = (surnameGiven[1] || '').replace(/</g, ' ').trim();
    const nationality = line1.slice(2, 5).replace(/</g, '');

    const passportNo = line2.slice(0, 9).replace(/</g, '');
    const passportCheck = line2[9];
    const passportValid = String(mrzChecksum(line2.slice(0, 9))) === passportCheck;

    const natCode = line2.slice(10, 13).replace(/</g, '');
    const dob = line2.slice(13, 19);
    const dobCheck = line2[19];
    const dobValid = String(mrzChecksum(line2.slice(13, 19))) === dobCheck;

    const sex = line2[20];
    const expiry = line2.slice(21, 27);
    const expiryCheck = line2[27];
    const expiryValid = String(mrzChecksum(line2.slice(21, 27))) === expiryCheck;

    const validCount = [passportValid, dobValid, expiryValid].filter(Boolean).length;

    return {
      success: true,
      trusted: validCount >= 2,
      fields: {
        surname, given,
        fullName: `${given} ${surname}`.trim().toUpperCase(),
        nationality: natCode || nationality,
        passportNo,
        dob: mrzDateToDisplay(dob, false),
        expiry: mrzDateToDisplay(expiry, true),
        sex: sex === 'M' ? 'Male' : sex === 'F' ? 'Female' : ''
      },
      checks: { passportValid, dobValid, expiryValid }
    };
  } catch {
    return { success: false };
  }
}

/* =====================================================================
   2. OCR — image preprocessing + two focused passes.
   preprocessPassportImage upscales small/low-res photos (a lot of phone
   photos of a passport are lower resolution than Tesseract likes) and
   applies a grayscale + contrast boost to flatten uneven lighting.
   runMrzOcr crops to just the bottom ~42% of the image (where the MRZ
   strip lives) so Tesseract isn't distracted by the photo/other text.
===================================================================== */
function preprocessPassportImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.max(1, Math.min(2.5, 2400 / Math.max(img.width, img.height)));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const g = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
        const v = Math.max(0, Math.min(255, (g - 128) * 1.5 + 128));
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      }
      ctx.putImageData(d, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function runOcrPass(imageDataUrl, onProgress) {
  return Tesseract.recognize(imageDataUrl, 'eng', {
    logger: (m) => { if (m.status === 'recognizing text' && onProgress) onProgress(m.progress); },
    tessedit_pageseg_mode: 6,
    preserve_interword_spaces: 1
  });
}

async function runFullOcr(imageDataUrl, onProgress) {
  return (await runOcrPass(await preprocessPassportImage(imageDataUrl), onProgress)).data;
}

async function runMrzOcr(imageDataUrl) {
  const img = new Image();
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = imageDataUrl; });
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = Math.round(img.height * 0.42);
  c.getContext('2d').drawImage(img, 0, Math.round(img.height * 0.58), img.width, c.height, 0, 0, c.width, c.height);
  return runOcrPass(await preprocessPassportImage(c.toDataURL('image/png')), () => {});
}

/* =====================================================================
   3. HEURISTIC FIELD EXTRACTION — fills whatever the MRZ can't
   (place of birth, height) and acts as a fallback for the core identity
   fields if the MRZ can't be read at all.
===================================================================== */
const DATE_PATTERN = '(\\d{1,2}\\s?[A-Z]{3}\\s?\\d{4}|\\d{2}\\/\\d{2}\\/\\d{4})';

function heuristicExtract(ocrText) {
  const lines = ocrText.replace(/\r/g, '').split('\n');
  const text = lines.join('\n');
  const out = {};

  const passportMatch = text.match(/\b([A-Z]{1,2}\d{6,8})\b/);
  if (passportMatch) out.passportNo = passportMatch[1];

  const dobMatch = text.match(new RegExp(`Date\\s*of\\s*Birth[^\\n\\r]{0,15}${DATE_PATTERN}`, 'i'));
  if (dobMatch) out.dob = normalizeDate(dobMatch[1]);

  const issueDateMatch = text.match(new RegExp(`Date\\s*of\\s*Issue[^\\n\\r]{0,15}${DATE_PATTERN}`, 'i'));
  if (issueDateMatch) out.issueDate = normalizeDate(issueDateMatch[1]);

  const expiryMatch = text.match(new RegExp(`Date\\s*of\\s*Expir\\w*[^\\n\\r]{0,15}${DATE_PATTERN}`, 'i'));
  if (expiryMatch) out.expiry = normalizeDate(expiryMatch[1]);

  const givenMatch = text.match(/Given Names?[\/:\s]*([A-Z][A-Z ]{1,39})(?=[\n\r]|$)/i);
  const surnameMatch = text.match(/Surname[\/:\s]*([A-Z][A-Z ]{1,39})(?=[\n\r]|$)/i);
  const given = givenMatch ? givenMatch[1].trim() : '';
  const surname = surnameMatch ? surnameMatch[1].trim() : '';
  if (given || surname) out.fullName = `${given} ${surname}`.trim();

  const natMatch = text.match(/\b(KENYAN|UGANDAN|TANZANIAN|ETHIOPIAN|NIGERIAN|GHANAIAN|SOMALI)\b/i);
  if (natMatch) out.nationality = natMatch[1].toUpperCase();

  const sexMatch = text.match(/\bSex[\/:\s]*([MF])\b/i);
  if (sexMatch) out.sex = sexMatch[1].toUpperCase() === 'M' ? 'Male' : 'Female';

  const issuePlaceMatch = text.match(/Issuing\s*Authority[\/:\s]*([A-Z][A-Z\s]{1,39})(?=[\n\r]|$)/i)
                        || text.match(/Place\s*of\s*Issue[\/:\s]*([A-Z][A-Z\s]{1,39})(?=[\n\r]|$)/i);
  if (issuePlaceMatch) out.issuePlace = issuePlaceMatch[1].trim();

  // Place of birth — not in the MRZ. Usually printed as "Place of Birth" /
  // "Mahali pa Kuzaliwa" on the visible bio page.
  const pobMatch = text.match(/(?:Place\s*of\s*Birth|Birth\s*Place)[\/:\s]*([^\n\r]{2,60})/i);
  if (pobMatch) out.pob = pobMatch[1].replace(/\s{2,}/g, ' ').trim();

  // Height — not in the MRZ, and usually on a separate "Description" page
  // of the passport rather than the photo page (e.g. "Height 5'8\" ft/in
  // 1.73 m/cm"). Only findable if that page was included in the upload.
  const heightMatch = text.match(/\bHeight[\/:\s]*([0-9]{1,2})\s*(?:ft|feet|')[,\s-]*([0-9]{1,2})?\s*(?:in|inches|")?/i);
  if (heightMatch) { out.heightFt = heightMatch[1]; out.heightIn = heightMatch[2] || '0'; }

  return out;
}

function normalizeDate(str) {
  const m = str.match(/(\d{1,2})\s?([A-Z]{3})\s?(\d{4})/);
  if (m) {
    const months = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
    const mm = months[m[2].toUpperCase()] || '01';
    return `${m[1].padStart(2,'0')}/${mm}/${m[3]}`;
  }
  return str;
}

/* ---------------------------------------------------------------------
   Date helpers — inputs use native <input type="date"> (ISO YYYY-MM-DD)
   for the calendar picker; the CV preview displays DD/MM/YYYY.
--------------------------------------------------------------------- */
function displayToIso(display) {
  const m = (display || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function isoToDisplay(iso) {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Kenyan (and most) passports are valid for exactly 10 years minus a day
// (e.g. issued 08/06/2026 -> expires 07/06/2036) — confirmed against a
// real passport. Used to fill in whichever of the two dates OCR/MRZ missed.
function shiftDisplayDate(display, yearsDelta, dayDelta) {
  const m = (display || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const d = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
  d.setFullYear(d.getFullYear() + yearsDelta);
  d.setDate(d.getDate() + dayDelta);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}
const computeExpiryFromIssue = (issueDisplay) => shiftDisplayDate(issueDisplay, 10, -1);
const computeIssueFromExpiry = (expiryDisplay) => shiftDisplayDate(expiryDisplay, -10, 1);

/* =====================================================================
   4. WIRE UP PASSPORT UPLOAD -> EXTRACTION -> AUTOFILL
===================================================================== */
const ocrStatus = $('ocrStatus');
const ocrProgressWrap = $('ocrProgressWrap');
const ocrProgressFill = $('ocrProgressFill');

function setStatus(el, text, type) {
  el.textContent = text;
  el.className = `status-msg status-${type}`;
  el.style.display = text ? 'block' : 'none';
}

function markField(inputId, needsReview, message) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const field = input.closest('.field');
  if (needsReview) {
    input.classList.add('needs-review');
    if (field) {
      field.classList.add('flagged');
      let flag = field.querySelector('.review-flag');
      if (!flag) {
        flag = document.createElement('div');
        flag.className = 'review-flag';
        field.appendChild(flag);
      }
      flag.textContent = message || 'Please double-check this — OCR was not fully confident.';
    }
  } else {
    input.classList.remove('needs-review');
    if (field) field.classList.remove('flagged');
  }
}

function fillField(id, value, trusted, message) {
  if (value === undefined || value === null || value === '') return;
  const input = document.getElementById(id);
  if (!input) return;
  input.value = input.type === 'date' ? displayToIso(value) : value;
  markField(id, !trusted, message);
  input.dispatchEvent(new Event('input'));
}

function calcAge(dobStr) {
  const m = dobStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  const dob = new Date(+m[3], +m[2] - 1, +m[1]);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hasHadBirthday = (now.getMonth() > dob.getMonth()) || (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hasHadBirthday) age--;
  return `${age}yrs`;
}

$('passportInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    const dataUrl = evt.target.result;
    $('passportPreviewImg').src = dataUrl;
    $('passportPreviewImg').style.display = 'block';
    $('passportUploadLabel').textContent = file.name;

    // The passport scan image itself also goes onto page 2 of the CV.
    $('pv-passportscan').src = dataUrl;
    $('pv-passportscan').style.display = 'block';
    $('pv-passportscan-placeholder').style.display = 'none';

    ocrProgressWrap.style.display = 'block';
    ocrProgressFill.style.width = '0%';
    setStatus(ocrStatus, 'Reading passport — trying the machine-readable zone first…', 'info');

    try {
      const mrzData = await runMrzOcr(dataUrl);
      const mrz = parseMRZ(mrzData.data.text);
      const ocrData = await runFullOcr(dataUrl, (p) => { ocrProgressFill.style.width = `${Math.round(p * 100)}%`; });
      const heuristic = heuristicExtract(ocrData.text);
      const combined = Object.assign({}, heuristic, mrz.success ? mrz.fields : {});

      if (mrz.success && mrz.trusted) {
        setStatus(ocrStatus, 'MRZ read successfully; visual passport fields also checked by OCR.', 'success');
        applyExtractedFields(combined, true, mrz.checks);
      } else if (mrz.success) {
        setStatus(ocrStatus, 'MRZ found but some checksums looked off — fields filled in, please verify.', 'error');
        applyExtractedFields(combined, false, mrz.checks);
      } else {
        setStatus(ocrStatus, 'MRZ could not be verified — full-page OCR filled what it could. Please review highlighted fields.', 'error');
        applyExtractedFields(combined, false);
      }
    } catch (err) {
      setStatus(ocrStatus, 'Could not read the passport automatically. Please fill in the fields manually.', 'error');
      console.error(err);
    } finally {
      ocrProgressWrap.style.display = 'none';
    }
  };
  reader.readAsDataURL(file);
});

// Passport drag-and-drop — reuses the exact same handler as click-to-browse
// by handing the dropped file to the real file input via DataTransfer, so
// there's only ever one code path processing a passport file.
const passportUploadBox = $('passportUploadBox');
['dragenter', 'dragover'].forEach(type => passportUploadBox.addEventListener(type, e => {
  e.preventDefault();
  passportUploadBox.classList.add('drag-over');
}));
['dragleave', 'drop'].forEach(type => passportUploadBox.addEventListener(type, e => {
  e.preventDefault();
  passportUploadBox.classList.remove('drag-over');
}));
passportUploadBox.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const dt = new DataTransfer();
  dt.items.add(file);
  $('passportInput').files = dt.files;
  $('passportInput').dispatchEvent(new Event('change', { bubbles: true }));
});
// Stop the browser from navigating to a file dropped outside the box.
['dragover', 'drop'].forEach(evtName => window.addEventListener(evtName, (e) => e.preventDefault()));

function applyExtractedFields(fields, trusted, checks) {
  const passportTrust = checks ? checks.passportValid : trusted;
  const dobTrust = checks ? checks.dobValid : trusted;
  const expiryTrust = checks ? checks.expiryValid : trusted;

  let computedIssue = false, computedExpiry = false;
  if (fields.expiry && !fields.issueDate) {
    fields.issueDate = computeIssueFromExpiry(fields.expiry);
    computedIssue = true;
  } else if (fields.issueDate && !fields.expiry) {
    fields.expiry = computeExpiryFromIssue(fields.issueDate);
    computedExpiry = true;
  }

  if (fields.fullName) fillField('f-fullname', fields.fullName, trusted);
  if (fields.nationality) fillField('f-nationality', fields.nationality, trusted);
  if (fields.passportNo) fillField('f-passportno', fields.passportNo, passportTrust);
  if (fields.dob) {
    fillField('f-dob', fields.dob, dobTrust);
    fillField('f-age', calcAge(fields.dob), dobTrust);
  }
  if (fields.expiry) fillField('f-expirydate', fields.expiry, expiryTrust && !computedExpiry,
    computedExpiry ? 'Computed from the date of issue (10 years minus a day) — please verify.' : undefined);
  if (fields.issueDate) fillField('f-issuedate', fields.issueDate, !computedIssue,
    computedIssue ? 'Computed from the date of expiry (10 years minus a day) — please verify.' : undefined);
  if (fields.issuePlace) fillField('f-issueplace', fields.issuePlace, false);
  if (fields.pob) fillField('f-pob', fields.pob, false);
  if (fields.heightFt) {
    $('f-height-ft').value = fields.heightFt;
    $('f-height-in').value = fields.heightIn || '0';
    syncHeight();
    markField('f-height-ft', false, 'Read from the passport\u2019s description page — please verify.');
    markField('f-height-in', false, 'Read from the passport\u2019s description page — please verify.');
  }
}

/* =====================================================================
   5. PHOTO UPLOADS (headshot / full-body) — preview only, no OCR
===================================================================== */
function wirePhotoUpload(inputId, labelId, previewId, cvTargetId) {
  $(inputId).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      $(labelId).textContent = file.name;
      $(previewId).src = evt.target.result;
      $(previewId).style.display = 'block';
      $(cvTargetId).src = evt.target.result;
    };
    reader.readAsDataURL(file);
  });
}
wirePhotoUpload('headshotInput', 'headshotLabel', 'headshotPreviewImg', 'pv-headshot');
wirePhotoUpload('fullbodyInput', 'fullbodyLabel', 'fullbodyPreviewImg', 'pv-fullbody');

/* =====================================================================
   6. LIVE PREVIEW BINDING — every text field mirrors into the CV preview
===================================================================== */
const FIELD_MAP = {
  'f-fullname': 'pv-fullname',
  'f-position': 'pv-position',
  'f-salary': 'pv-salary',
  'f-contract': 'pv-contract',
  'f-passportno': 'pv-passportno',
  'f-issueplace': 'pv-issueplace',
  'f-nationality': 'pv-nationality',
  'f-religion': 'pv-religion',
  'f-age': 'pv-age',
  'f-pob': 'pv-pob',
  'f-contact': 'pv-contact',
  'f-marital': 'pv-marital',
  'f-children': 'pv-children',
  'f-weight': 'pv-weight',
  'f-education': 'pv-education',
  'f-english': 'pv-english',
  'f-arabic': 'pv-arabic',
  'f-remarks': 'pv-remarks',
  'f-skills': 'pv-skills'
};
const DATE_FIELD_MAP = {
  'f-dob': 'pv-dob',
  'f-issuedate': 'pv-issuedate',
  'f-expirydate': 'pv-expirydate'
};

Object.entries(FIELD_MAP).forEach(([inputId, previewId]) => {
  const input = $(inputId);
  const preview = $(previewId);
  if (!input || !preview) return;
  const sync = () => { preview.textContent = input.value || '\u00A0'; };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  sync();
});

Object.entries(DATE_FIELD_MAP).forEach(([inputId, previewId]) => {
  const input = $(inputId);
  const preview = $(previewId);
  if (!input || !preview) return;
  const sync = () => { preview.textContent = isoToDisplay(input.value) || '\u00A0'; };
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  sync();
});

// Height is entered as two number inputs (feet / inches) and shown on the
// CV as "5'8\"" (matches how it's written on the passport itself).
function syncHeight() {
  const ft = $('f-height-ft').value, inches = $('f-height-in').value;
  const preview = $('pv-height');
  if (ft === '' && inches === '') { preview.textContent = '\u00A0'; return; }
  preview.textContent = `${ft || 0}'${inches || 0}"`;
}
$('f-height-ft').addEventListener('input', syncHeight);
$('f-height-in').addEventListener('input', syncHeight);
syncHeight();

function syncCheckbox(inputId, previewId) {
  const input = $(inputId);
  const preview = $(previewId);
  const sync = () => { preview.textContent = input.checked ? ' \u2713' : ''; };
  input.addEventListener('change', sync);
  sync();
}
syncCheckbox('f-chk-housekeeping', 'chk-housekeeping');
syncCheckbox('f-chk-cleaning', 'chk-cleaning');
syncCheckbox('f-chk-cooking', 'chk-cooking');

/* =====================================================================
   7. PREVIOUS EMPLOYMENT ABROAD — repeatable country/period/post rows.
   The preview side uses its own dedicated <tbody>, so there's no
   leftover static row to worry about hiding or cleaning up.
===================================================================== */
const previousJobs = [];
const previousEmploymentFields = $('previousEmploymentFields');
const countryOptions = ['Saudi Arabia', 'Qatar', 'Bahrain', 'Iraq', 'Dubai'];

function renderPreviousJobs() {
  previousEmploymentFields.innerHTML = '';
  previousJobs.forEach((job, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'previous-job';
    wrap.innerHTML = `
      <div class="previous-job-head">
        <strong>Employment ${i + 1}</strong>
        ${previousJobs.length > 1 ? '<button type="button" class="remove-job">Remove</button>' : ''}
      </div>
      <div class="field"><label>Country</label>
        <select class="prev-country">
          <option value="">Select country</option>
          ${countryOptions.map(c => `<option ${job.country === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label>Period</label><input class="prev-period" type="text" value="${escapeHtml(job.period)}" placeholder="e.g. 2019\u20132022"></div>
        <div class="field"><label>Post</label><input class="prev-post" type="text" value="${escapeHtml(job.post || 'MAID')}"></div>
      </div>`;
    wrap.querySelector('.prev-country').addEventListener('change', (e) => { job.country = e.target.value; syncPreviousPreview(); });
    wrap.querySelector('.prev-period').addEventListener('input', (e) => { job.period = e.target.value; syncPreviousPreview(); });
    wrap.querySelector('.prev-post').addEventListener('input', (e) => { job.post = e.target.value; syncPreviousPreview(); });
    const remove = wrap.querySelector('.remove-job');
    if (remove) remove.addEventListener('click', () => { previousJobs.splice(i, 1); renderPreviousJobs(); syncPreviousPreview(); });
    previousEmploymentFields.appendChild(wrap);
  });
}

function syncPreviousPreview() {
  const tbody = $('pv-prevjobs-body');
  const rows = previousJobs.filter(j => j.country || j.period || j.post);
  const list = rows.length ? rows : [{ country: '', period: '', post: '' }];
  tbody.innerHTML = list.map(j => `
    <tr>
      <td>${escapeHtml(j.country) || '&nbsp;'}</td>
      <td>${escapeHtml(j.period) || '&nbsp;'}</td>
      <td>${escapeHtml(j.post) || '&nbsp;'}</td>
    </tr>
  `).join('');
}

previousJobs.push({ country: '', period: '', post: 'MAID' });
renderPreviousJobs();
syncPreviousPreview();
$('addPreviousEmploymentBtn').addEventListener('click', () => {
  previousJobs.push({ country: '', period: '', post: 'MAID' });
  renderPreviousJobs();
  syncPreviousPreview();
});

/* =====================================================================
   8. GENERATE PDF — automatic download via html2pdf.js.
   html2canvas needs the element to actually be laid out in the document
   — a detached node (never appended anywhere) renders blank — so the
   preview is cloned into an off-screen container that IS attached to
   the page, every image inside it is awaited, then it's snapshotted.
===================================================================== */
let lastPdfBlobUrl = null;

function safeFileName(name) {
  return (name || 'CV').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'CV';
}

function waitForImages(container) {
  const imgs = Array.from(container.querySelectorAll('img'));
  return Promise.all(imgs.map(img => {
    if (!img.src) return Promise.resolve();
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }));
}

async function generatePdf() {
  const genStatus = $('genStatus');
  const btn = $('generateBtn');
  btn.disabled = true;
  setStatus(genStatus, 'Building PDF…', 'info');

  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.top = '0';
  wrapper.style.left = '-99999px';
  wrapper.appendChild($('cvPage1').cloneNode(true));
  wrapper.appendChild($('cvPage2').cloneNode(true));
  document.body.appendChild(wrapper);

  const fileName = `${safeFileName($('f-fullname').value)}_CV.pdf`;

  const opt = {
    margin: 0,
    filename: fileName,
    image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css'] }
  };

  try {
    await waitForImages(wrapper);
    const worker = html2pdf().set(opt).from(wrapper);
    const pdfBlob = await worker.outputPdf('blob');
    if (lastPdfBlobUrl) URL.revokeObjectURL(lastPdfBlobUrl);
    lastPdfBlobUrl = URL.createObjectURL(pdfBlob);

    triggerDownload(lastPdfBlobUrl, fileName);
    setStatus(genStatus, 'PDF generated and download started.', 'success');
    $('downloadAgainBtn').style.display = 'block';

    logCvGeneration($('f-fullname').value);
  } catch (err) {
    console.error(err);
    setStatus(genStatus, 'Something went wrong generating the PDF. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    wrapper.remove();
  }
}

function triggerDownload(blobUrl, fileName) {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

$('generateBtn').addEventListener('click', generatePdf);
$('downloadAgainBtn').addEventListener('click', () => {
  if (lastPdfBlobUrl) triggerDownload(lastPdfBlobUrl, `${safeFileName($('f-fullname').value)}_CV.pdf`);
});

/* =====================================================================
   9. ACTIVITY LOG — record every CV generated, by whom, when
===================================================================== */
async function logCvGeneration(candidateName) {
  try {
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        action: 'cv_generated',
        detail: `Generated CV for ${candidateName || 'unnamed candidate'} (Template 1)`
      })
    });
  } catch {
    // Non-critical — don't block the download if logging fails.
  }
}
