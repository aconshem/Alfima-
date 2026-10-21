/* Template 2 — One Stop Recruitment Agency. Binds the form (f-*) to the placeholders (pv-*). */
window.CV_CONFIG = {
  templateName: 'Template 2 – One Stop',
  titleSuffix: '',                         // file name = candidate's full name
  pageWidthPt: 612,
  dateFormat: 'dMonY',                     // 18 JUL 1991
  ageFormat: (n) => `${n} YEARS`,          // 35 YEARS
  prevShowPost: false,
  prevMaxRows: 0,

  textMap: {
    'f-fullname': 'pv-fullname', 'f-position': 'pv-position', 'f-salary': 'pv-salary',
    'f-nationality': 'pv-nationality', 'f-contract': 'pv-contract', 'f-religion': 'pv-religion',
    'f-passportno': 'pv-passportno', 'f-age': 'pv-age', 'f-pob': 'pv-pob', 'f-address': 'pv-address',
    'f-marital': 'pv-marital', 'f-children': 'pv-children', 'f-education': 'pv-education',
    'f-contact': 'pv-contact', 'f-weight': 'pv-weight', 'f-complexion': 'pv-complexion',
    'f-skill1-label': 'pv-skill1-label',
    'f-cpname': 'pv-cpname', 'f-cpnumber': 'pv-cpnumber', 'f-cprel': 'pv-cprel', 'f-cpaddress': 'pv-cpaddress'
  },
  dateMap: { 'f-dob': 'pv-dob' },
  checkMap: {
    'f-chk-skill1': 'chk-skill1', 'f-chk-cleaning': 'chk-cleaning', 'f-chk-ironing': 'chk-ironing',
    'f-chk-sewing': 'chk-sewing', 'f-chk-cooking': 'chk-cooking', 'f-chk-babycare': 'chk-babycare'
  },

  // Single Country / Period cells: several entries are joined with commas.
  renderPrevious(jobs) {
    const rows = jobs.filter(j => j.country || j.period);
    setPv('pv-prevcountry', rows.map(j => j.country).filter(Boolean).join(', '));
    setPv('pv-prevperiod', rows.map(j => j.period).filter(Boolean).join(', '));
  },

  extraInit() {
    // Language proficiency: put "///" under the chosen column (Fluent / Fair / Poor).
    const wireLang = (selectId, prefix) => {
      const sel = document.getElementById(selectId);
      const sync = () => {
        ['fluent', 'fair', 'poor'].forEach(level => {
          document.getElementById(`${prefix}-${level}`).textContent = sel.value.toLowerCase() === level ? '///' : '';
        });
      };
      sel.addEventListener('change', sync);
      sync();
    };
    wireLang('f-english', 'pv-eng');
    wireLang('f-arabic', 'pv-ara');

    // Remarks: one bullet per line.
    const rem = document.getElementById('f-remarks');
    const syncRemarks = () => {
      document.getElementById('pv-remarks').innerHTML = rem.value
        .split('\n').map(s => s.trim()).filter(Boolean)
        .map(s => `<li>${escapeHtml(s)}</li>`).join('');
    };
    rem.addEventListener('input', syncRemarks);
    syncRemarks();
  }
};
CVCore.init();
