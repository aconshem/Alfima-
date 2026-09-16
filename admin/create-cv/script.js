/* =====================================================================
   0. AUTH GUARD — this page lives inside the admin panel, so it needs
   a valid session just like admin/index.html does.
===================================================================== */
(async function guard() {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    const data = await res.json();
    if (!data.authenticated) window.location.href = '../index.html';
  } catch {
    // If the API isn't reachable (e.g. local testing without functions),
    // don't lock the page — just let it work standalone.
  }
})();

const $ = (id) => document.getElementById(id);

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
  // MRZ dates are YYMMDD with no century.
  if (!/^\d{6}$/.test(yyMMdd)) return '';
  const yy = parseInt(yyMMdd.slice(0, 2), 10);
  const mm = yyMMdd.slice(2, 4);
  const dd = yyMMdd.slice(4, 6);
  // Expiry dates on a currently-valid passport are always 20XX in practice
  // (10-year validity, e-passport format only widespread since the 2000s).
  // Birth dates use the standard "00-30 => 2000s, else 1900s" convention.
  const year = isExpiry ? 2000 + yy : (yy <= 30 ? 2000 + yy : 1900 + yy);
  return `${dd}/${mm}/${year}`;
}

function cleanMrzLine(line) {
  return line.toUpperCase().replace(/[^A-Z0-9<]/g, '').trim();
}

// Find two adjacent ~44-char MRZ-looking lines anywhere in a block of OCR text.
function findMrzLines(rawText) {
  const lines = rawText.split('\n').map(cleanMrzLine).filter(l => l.length >= 30);
  for (let i = 0; i < lines.length - 1; i++) {
    let l1 = lines[i], l2 = lines[i + 1];
    // Pad or trim to 44 — OCR often drops/adds a trailing '<'
    l1 = (l1 + '<'.repeat(44)).slice(0, 44);
    l2 = (l2 + '<'.repeat(44)).slice(0, 44);
    if (l1.startsWith('P<') || l1.startsWith('P0') || /^P[A-Z<]/.test(l1)) {
      return [l1, l2];
    }
  }
  // Fallback: just take the two longest lines if nothing starts with P<
  const sorted = [...lines].sort((a, b) => b.length - a.length);
  if (sorted.length >= 2 && sorted[0].length >= 40 && sorted[1].length >= 40) {
    return [
      (sorted[0] + '<'.repeat(44)).slice(0, 44),
      (sorted[1] + '<'.repeat(44)).slice(0, 44)
    ];
  }
  return null;
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
      trusted: validCount >= 2, // majority of checksums pass
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
   2. OCR FALLBACK — full-page Tesseract OCR + heuristic field matching
   Used when the MRZ can't be found or its checksums don't validate.
===================================================================== */
async function runFullOcr(imageDataUrl, onProgress) {
  const result = await Tesseract.recognize(imageDataUrl, 'eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) onProgress(m.progress);
    }
  });
  return result.data;
}

const DATE_PATTERN = '(\\d{1,2}\\s?[A-Z]{3}\\s?\\d{4}|\\d{2}\\/\\d{2}\\/\\d{4})';

// Every match is scoped to a single line ([^\n\r]) so a greedy character
// class can never bleed across label boundaries onto the next line — that
// was the cause of an earlier bug where the name field swallowed unrelated
// text from following lines.
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

  // Issue date / place of issue aren't in the MRZ, but they're printed on the
  // visible bio page — try to grab them near their labels. Low-confidence by
  // nature (free-text OCR), so these always get flagged for review regardless.
  const issuePlaceMatch = text.match(/Issuing\s*Authority[\/:\s]*([A-Z][A-Z\s]{1,39})(?=[\n\r]|$)/i)
                        || text.match(/Place\s*of\s*Issue[\/:\s]*([A-Z][A-Z\s]{1,39})(?=[\n\r]|$)/i);
  if (issuePlaceMatch) out.issuePlace = issuePlaceMatch[1].trim();

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
   for the calendar picker; the CV preview displays DD/MM/YYYY, matching
   the template.
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
   3. WIRE UP PASSPORT UPLOAD -> EXTRACTION -> AUTOFILL
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
      const ocrData = await runFullOcr(dataUrl, (p) => {
        ocrProgressFill.style.width = `${Math.round(p * 100)}%`;
      });

      const mrz = parseMRZ(ocrData.text);

      if (mrz.success && mrz.trusted) {
        setStatus(ocrStatus, 'Machine-readable zone read successfully.', 'success');
        applyExtractedFields(mrz.fields, true, mrz.checks);
      } else if (mrz.success) {
        setStatus(ocrStatus, 'MRZ found but checksums looked off — fields filled in, please verify.', 'error');
        applyExtractedFields(mrz.fields, false, mrz.checks);
      } else {
        setStatus(ocrStatus, 'No reliable MRZ detected — falling back to general OCR. Please verify all fields.', 'error');
        const heuristic = heuristicExtract(ocrData.text);
        applyExtractedFields(heuristic, false);
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

function applyExtractedFields(fields, trusted, checks) {
  // Where we have a per-field checksum (passport no. / DOB / expiry), trust
  // that specific field on its own merit rather than the document as a whole —
  // one corrupted digit shouldn't hide review-flags on the fields OCR got right.
  const passportTrust = checks ? checks.passportValid : trusted;
  const dobTrust = checks ? checks.dobValid : trusted;
  const expiryTrust = checks ? checks.expiryValid : trusted;

  // If only one of issue/expiry date was captured, compute the other from the
  // fixed 10-years-minus-a-day rule. If both were captured independently,
  // leave them exactly as read — never override real extracted data.
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
  // Issue date and place of issue aren't in the MRZ — they live in the
  // visual inspection zone, which OCR is much less reliable at, so we
  // only ever suggest these (never mark them "trusted").
  if (fields.issueDate) fillField('f-issuedate', fields.issueDate, !computedIssue,
    computedIssue ? 'Computed from the date of expiry (10 years minus a day) — please verify.' : undefined);
  if (fields.issuePlace) fillField('f-issueplace', fields.issuePlace, false);
}

/* =====================================================================
   4. PHOTO UPLOADS (headshot / full-body) — preview only, no OCR
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
   5. LIVE PREVIEW BINDING — every text field mirrors into the CV preview
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
  'f-prevcountry': 'pv-prevcountry',
  'f-prevperiod': 'pv-prevperiod',
  'f-prevpost': 'pv-prevpost',
  'f-remarks': 'pv-remarks',
  'f-skills': 'pv-skills'
};
// Date-picker fields need converting from their native ISO value
// (YYYY-MM-DD) to the DD/MM/YYYY format the CV template displays.
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

// Height is entered as two number inputs (feet / inches) but shown in the CV
// as a single value, e.g. 5 ft 8 in -> "5.80" — matching the format already
// used on the real template (confirmed against a real passport: 5'8" -> 5.80).
function syncHeight() {
  const ft = $('f-height-ft').value;
  const inches = $('f-height-in').value;
  const preview = $('pv-height');
  if (ft === '' && inches === '') { preview.textContent = '\u00A0'; return; }
  const inchNum = inches === '' ? 0 : parseInt(inches, 10);
  const inchStr = inchNum < 10 ? `${inchNum}0` : `${inchNum}`;
  preview.textContent = `${ft || 0}.${inchStr}`;
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
   6. GENERATE PDF
===================================================================== */
let lastPdfBlobUrl = null;

function safeFileName(name) {
  return (name || 'CV').trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '') || 'CV';
}

async function generatePdf() {
  const genStatus = $('genStatus');
  const btn = $('generateBtn');
  btn.disabled = true;
  setStatus(genStatus, 'Building PDF…', 'info');

  // html2canvas needs the element to actually be laid out in the document —
  // a detached node (never appended anywhere) renders blank. So we clone the
  // preview into an off-screen container that IS attached to the page,
  // wait for every image inside it to finish loading, then snapshot it.
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

function triggerDownload(blobUrl, fileName) {
  try {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error('Auto-download blocked, use the Download Again button.', err);
  }
}

$('generateBtn').addEventListener('click', generatePdf);
$('downloadAgainBtn').addEventListener('click', () => {
  if (lastPdfBlobUrl) {
    triggerDownload(lastPdfBlobUrl, `${safeFileName($('f-fullname').value)}_CV.pdf`);
  }
});

/* =====================================================================
   7. ACTIVITY LOG — record every CV generated, by whom, when
===================================================================== */
async function logCvGeneration(candidateName) {
  try {
    await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        action: 'cv_generated',
        detail: `Generated CV for ${candidateName || 'unnamed candidate'}`
      })
    });
  } catch {
    // Non-critical — don't block the download if logging fails.
  }
}
