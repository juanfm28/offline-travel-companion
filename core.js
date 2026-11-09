/* Shared, dependency-free helpers. No file contents are sent over the network. */
(function (root) {
  'use strict';
  const VERSION = '1.0.4';
  const CACHE_PREFIX = 'travel-companion-shell-';
  const SHELL_FILES = [
    './', './index.html', './styles.css', './core.js', './storage.js', './app.js',
    './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
    './icons/apple-touch-icon.png', './guide.html'
  ];
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  function cleanFolder(value) {
    const parts = String(value).replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.some(p => p === '.' || p === '..' || /[\u0000-\u001f]/.test(p))) {
      throw new Error('Use folder names without “.”, “..” or control characters.');
    }
    return parts.join('/');
  }
  function documentPath(folder, name) {
    if (!name || /[/\\\u0000-\u001f]/.test(name)) throw new Error('This filename is not supported.');
    return [cleanFolder(folder), name].filter(Boolean).join('/');
  }
  function filenameDate(name) {
    let match = /^(\d{4})[-_](\d{2})[-_](\d{2})(?:\D|$)/.exec(name);
    let month, day;
    if (match) { month = +match[2]; day = +match[3]; }
    else {
      match = /^(\d{2})(\d{2})(?:\D|$)/.exec(name);
      if (!match) return Infinity;
      day = +match[1]; month = +match[2];
    }
    const limits = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= limits[month] ? month * 100 + day : Infinity;
  }
  function compareDocuments(a, b) {
    const folderOrder = collator.compare(a.folder, b.folder);
    if (folderOrder) return folderOrder;
    const ad = filenameDate(a.name), bd = filenameDate(b.name);
    return (ad === bd ? 0 : ad < bd ? -1 : 1) || collator.compare(a.name, b.name);
  }
  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  async function hashBlob(blob) {
    const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
  }
  function validateHtml(name, html, size) {
    if (!/\.html?$/i.test(name)) throw new Error('Choose an .html or .htm itinerary file.');
    if (!size || size > 25 * 1024 * 1024) throw new Error('Choose a non-empty HTML file smaller than 25 MB.');
    if (!/<html\b/i.test(html) || !/<head\b[^>]*>/i.test(html)) throw new Error('Choose a complete HTML document with a head section.');
    if (/<script\b[^>]*\bsrc\s*=/i.test(html) || /<link\b[^>]*\brel\s*=\s*["']?stylesheet/i.test(html)) {
      throw new Error('This itinerary uses external scripts or styles. Import a self-contained HTML file instead.');
    }
  }
  async function validatePdf(file) {
    if (!/\.pdf$/i.test(file.name) || !file.size || file.size > 100 * 1024 * 1024) {
      throw new Error('Choose non-empty PDF files smaller than 100 MB each.');
    }
    const header = await file.slice(0, 1024).text();
    if (!header.includes('%PDF-')) throw new Error(`“${file.name}” does not appear to be a PDF.`);
  }
  function isolatedHtml(html, token) {
    // The saved file stays byte-for-byte intact. These controls apply only to its in-memory view.
    const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="referrer" content="no-referrer">`;
    const bridge = `<script>(()=>{let failed=false;addEventListener('error',()=>{failed=true});document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a||e.defaultPrevented)return;const h=a.getAttribute('href');if(h.startsWith('#')){e.preventDefault();try{const t=document.getElementById(decodeURIComponent(h.slice(1)));if(t)t.scrollIntoView({behavior:'smooth',block:'start'});else if(h==='#')scrollTo(0,0)}catch{}}else if(/^(https?:|mailto:|tel:)/i.test(h)){a.target='_blank';a.rel='noopener noreferrer'}});addEventListener('load',()=>parent.postMessage({type:'itinerary-view-ready',token:${JSON.stringify(token)},scriptError:failed},'*'));})()<\/script>`;
    // Put the bridge first so it can report errors in the itinerary's existing inline scripts.
    return html.replace(/<head\b[^>]*>/i, match => match + meta + bridge);
  }
  function parseRange(header, size) {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!match || (!match[1] && !match[2]) || !size) return false;
    let start, end;
    if (!match[1]) {
      const count = Number(match[2]);
      if (!Number.isSafeInteger(count) || count <= 0) return false;
      start = Math.max(0, size - count); end = size - 1;
    } else {
      start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return false;
      end = Math.min(end, size - 1);
    }
    return { start, end };
  }
  const api = { VERSION, CACHE_PREFIX, SHELL_FILES, cleanFolder, documentPath, compareDocuments, filenameDate,
    formatBytes, hashBlob, validateHtml, validatePdf, isolatedHtml, parseRange };
  root.CompanionCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
