/* Template 1 — FRST National. Binds the form (f-*) to the placeholders (pv-*). */
window.CV_CONFIG = {
  templateName: 'Template 1 – FRST National',
  titleSuffix: ' CV',
  pageWidthPt: 595.3,
  dateFormat: 'dmy',                       // 29/05/1995
  ageFormat: (n) => `${n}yrs`,             // 30yrs
  prevShowPost: true,
  prevMaxRows: 2,                          // the template has room for two rows

  textMap: {
    'f-fullname': 'pv-fullname', 'f-position': 'pv-position', 'f-salary': 'pv-salary',
    'f-contract': 'pv-contract', 'f-passportno': 'pv-passportno', 'f-issueplace': 'pv-issueplace',
    'f-nationality': 'pv-nationality', 'f-religion': 'pv-religion', 'f-age': 'pv-age',
    'f-pob': 'pv-pob', 'f-contact': 'pv-contact', 'f-marital': 'pv-marital',
    'f-children': 'pv-children', 'f-weight': 'pv-weight', 'f-education': 'pv-education',
    'f-english': 'pv-english', 'f-arabic': 'pv-arabic', 'f-remarks': 'pv-remarks', 'f-skills': 'pv-skills'
  },
  dateMap: { 'f-dob': 'pv-dob', 'f-issuedate': 'pv-issuedate', 'f-expirydate': 'pv-expirydate' },
  checkMap: {
    'f-chk-housekeeping': 'chk-housekeeping',
    'f-chk-cleaning': 'chk-cleaning',
    'f-chk-cooking': 'chk-cooking'
  },

  // Previous employment: rows of Country | Period | Post printed inside the table (2 rows fit).
  renderPrevious(jobs) {
    const host = document.getElementById('pv-prevjobs');
    const rows = jobs.filter(j => j.country || j.period).slice(0, 2);
    host.innerHTML = rows.map((j, i) => {
      const top = (623.66 + i * 18.9).toFixed(2);
      const cell = (left, w, txt) => `<span class="pvj" data-fit-w="${w}" style="left:${left}pt;top:${top}pt">${escapeHtml(txt)}</span>`;
      return cell(91.5, 74, (j.country || '').toUpperCase()) + cell(175.6, 56, j.period) + cell(242.2, 68, j.post);
    }).join('');
    host.querySelectorAll('[data-fit-w]').forEach(fitElement);
  }
};
CVCore.init();
