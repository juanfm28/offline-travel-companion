/* Browser application. All imported bytes stay in IndexedDB on this origin. */
(() => {
  'use strict';
  const C = CompanionCore, S = CompanionStore;
  const $ = id => document.getElementById(id);
  const base = new URL('./', location.href);
  let state = { documents: [], itinerary: null };
  let busy = false, registration, renderedHash, frameToken, replacingId, pdfObjectUrl;
  let applyUpdate = false, routeGeneration = 0;
  function announce(message, kind = 'info') {
    $('message').textContent = message;
    $('message').dataset.kind = kind;
    $('message').hidden = false;
  }
  function errorText(error) {
    if (error?.name === 'QuotaExceededError') return 'Device storage is full. Previous files were kept. Free some space and try again; keep your originals in Files.';
    if (error?.name === 'ConstraintError') return 'Another file already uses that folder and filename. No files were changed by this import.';
    return error?.message || 'The operation failed. Keep your originals in Files and try again.';
  }
  async function work(action) {
    if (busy) return;
    busy = true;
    document.body.classList.add('busy');
    const controls = [...document.querySelectorAll('button, input')].map(el => [el, el.disabled]);
    controls.forEach(([el]) => { el.disabled = true; });
    try { await action(); }
    catch (error) { announce(errorText(error), 'error'); }
    finally {
      controls.forEach(([el, disabled]) => { el.disabled = disabled; });
      document.body.classList.remove('busy');
      busy = false;
    }
  }
  function displayTime(value) { return new Date(value).toLocaleString(); }
  function networkHint() {
    $('network-hint').textContent = navigator.onLine ? 'Files stay on this device' : 'Device reports offline';
  }
  function standalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }
  function renderItinerary() {
    const record = state.itinerary;
    $('itinerary-empty').hidden = !!record;
    $('itinerary-toolbar').hidden = !record;
    $('itinerary-status').textContent = record ? `${record.name} · ${C.formatBytes(record.size)} · saved ${displayTime(record.savedAt)}` : 'No saved itinerary found. Import from your independent device backup.';
    if (!record) {
      $('itinerary-view').replaceChildren(); renderedHash = undefined; return;
    }
    $('itinerary-label').textContent = record.name;
    if ($('panel-itinerary').hidden || renderedHash === record.sha256) return;
    const expectedHash = record.sha256;
    record.blob.text().then(html => {
      if (state.itinerary?.sha256 !== expectedHash || $('panel-itinerary').hidden) return;
      const frame = document.createElement('iframe');
      frame.title = 'Your imported itinerary';
      frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
      frame.referrerPolicy = 'no-referrer';
      frameToken = crypto.randomUUID();
      frame.srcdoc = C.isolatedHtml(html, frameToken);
      $('itinerary-view').replaceChildren(frame);
      renderedHash = expectedHash;
    }).catch(error => announce(errorText(error), 'error'));
  }
  function renderDocuments() {
    const filter = $('document-search').value.toLocaleLowerCase();
    const docs = [...state.documents].sort(C.compareDocuments).filter(doc => doc.path.toLocaleLowerCase().includes(filter));
    $('document-count').textContent = state.documents.length;
    $('documents-status').textContent = `${state.documents.length} PDF${state.documents.length === 1 ? '' : 's'} saved locally · ${C.formatBytes(state.documents.reduce((sum, doc) => sum + doc.size, 0))}`;
    $('documents-empty').hidden = !!docs.length;
    $('documents-empty').textContent = state.documents.length ? 'No matching filenames or folders.' : 'No PDFs imported. Your originals remain available independently in Files.';
    const nodes = [];
    let lastFolder;
    for (const doc of docs) {
      if (lastFolder !== doc.folder) {
        const heading = document.createElement('h2');
        heading.className = 'folder-heading'; heading.textContent = doc.folder || 'Documents'; nodes.push(heading);
        lastFolder = doc.folder;
      }
      const row = document.createElement('div'); row.className = 'document-row';
      const main = document.createElement('div'); main.className = 'document-main';
      const open = document.createElement('button'); open.type = 'button'; open.textContent = doc.name;
      open.addEventListener('click', () => { location.hash = `pdf/${doc.id}`; });
      const info = document.createElement('p'); info.className = 'small';
      info.textContent = `${C.formatBytes(doc.size)} · saved ${displayTime(doc.savedAt)}`;
      main.append(open, info);
      const actions = document.createElement('div'); actions.className = 'document-actions';
      const replace = document.createElement('button'); replace.type = 'button'; replace.className = 'quiet'; replace.textContent = 'Replace';
      replace.setAttribute('aria-label', `Replace ${doc.name}`);
      replace.addEventListener('click', () => { replacingId = doc.id; $('replace-pdf-input').click(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'quiet'; remove.textContent = 'Remove copy';
      remove.setAttribute('aria-label', `Remove local copy of ${doc.name}`);
      remove.addEventListener('click', () => work(async () => {
        if (!confirm(`Remove the app's copy of “${doc.name}”? The original in Files will remain.`)) return;
        await S.removeDocument(doc.id); await loadState();
        $('verification-result').textContent = 'Files changed. Run the saved-file check again.';
        announce('Local PDF copy removed.');
      }));
      actions.append(replace, remove); row.append(main, actions); nodes.push(row);
    }
    $('document-list').replaceChildren(...nodes);
    const folders = new Set(['Entry and travel documents', 'Transportation', 'Accommodation', 'Activities', ...state.documents.map(doc => doc.folder).filter(Boolean)]);
    $('folder-options').replaceChildren(...[...folders].sort().map(folder => {
      const option = document.createElement('option'); option.value = folder; return option;
    }));
  }
  async function loadState() {
    state = await S.snapshot();
    renderItinerary(); renderDocuments();
  }
  function releasePdf() {
    $('pdf-view').replaceChildren();
    if (pdfObjectUrl) URL.revokeObjectURL(pdfObjectUrl);
    pdfObjectUrl = undefined;
  }
  async function openPdf(id, generation) {
    const record = await S.readDocument(id);
    if (generation !== routeGeneration) return;
    if (!record.metadata || !record.file?.blob) throw new Error('This PDF is missing from local storage. Restore it from Files.');
    const meta = record.metadata;
    let url;
    if (navigator.serviceWorker?.controller) {
      // A virtual local URL handled entirely by the service worker, including byte ranges.
      // No private filename or file bytes are included in a hosting request.
      url = new URL(`__local__/document/${meta.id}.pdf`, base).href;
    } else {
      pdfObjectUrl = URL.createObjectURL(record.file.blob.slice(0, record.file.blob.size, 'application/pdf'));
      url = pdfObjectUrl;
    }
    $('pdf-title').textContent = meta.name;
    $('pdf-fullscreen').href = url;
    const frame = document.createElement('iframe'); frame.title = meta.name; frame.referrerPolicy = 'no-referrer'; frame.src = url;
    $('pdf-view').replaceChildren(frame);
  }
  async function route() {
    const generation = ++routeGeneration;
    const path = location.hash.slice(1) || 'itinerary';
    const tab = path.startsWith('pdf/') ? 'pdf' : ['itinerary', 'documents', 'status'].includes(path) ? path : 'itinerary';
    for (const name of ['itinerary', 'documents', 'status', 'pdf']) $('panel-' + name).hidden = name !== tab;
    document.querySelectorAll('.tabs a').forEach(a => {
      if (a.hash === '#' + (tab === 'pdf' ? 'documents' : tab)) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (tab !== 'itinerary') { document.body.classList.remove('expanded'); $('expand-itinerary').textContent = 'Expand view'; }
    releasePdf();
    if (tab === 'itinerary') renderItinerary();
    if (tab === 'status') await refreshStatus();
    if (tab === 'pdf') await openPdf(path.slice(4), generation);
  }
  async function importItinerary(file) {
    if (!file) return;
    announce('Reading the itinerary on this device…');
    if (file.size > 25 * 1024 * 1024) throw new Error('Choose an HTML file smaller than 25 MB.');
    const html = await file.text();
    C.validateHtml(file.name, html, file.size);
    if (state.itinerary && !confirm(`Replace “${state.itinerary.name}” with “${file.name}”? Saved PDFs will stay in the app.`)) {
      announce('Import cancelled. The saved itinerary was kept.'); return;
    }
    const record = { name: file.name, size: file.size, savedAt: Date.now(), sha256: await C.hashBlob(file), blob: file };
    await S.saveItinerary(record);
    await loadState();
    $('verification-result').textContent = 'Itinerary changed. Run the saved-file check again.';
    location.hash = 'itinerary';
    await requestPersistence(false);
    announce('Itinerary saved on this device. Check its navigation, then complete the airplane-mode test.');
    await refreshStatus();
  }
  async function importPdfs(files, folderTree = false, replaceId = null) {
    if (!files.length) return;
    const candidates = folderTree ? files.filter(file => /\.pdf$/i.test(file.name)) : files;
    if (!candidates.length) throw new Error('No PDF files were found in that selection.');
    if (candidates.reduce((sum, f) => sum + f.size, 0) > 500 * 1024 * 1024) throw new Error('Import smaller batches of PDFs, up to 500 MB per batch.');
    const existing = replaceId ? state.documents.find(doc => doc.id === replaceId) : null;
    if (replaceId && !existing) throw new Error('The PDF to replace is no longer stored. Refresh the document list.');
    const records = [], paths = new Set();
    for (const [index, file] of candidates.entries()) {
      announce(`Checking PDF ${index + 1} of ${candidates.length} on this device…`);
      await C.validatePdf(file);
      const pathParts = folderTree ? file.webkitRelativePath.split('/') : [];
      pathParts.pop();
      const folder = C.cleanFolder(existing ? existing.folder : folderTree ? pathParts.join('/') : $('folder-name').value);
      const path = C.documentPath(folder, file.name);
      if (paths.has(path)) throw new Error('Two selected PDFs have the same folder and filename. Import them into different folders.');
      paths.add(path);
      const matching = state.documents.find(doc => doc.path === path);
      if (existing && matching && matching.id !== existing.id) throw new Error('Another PDF already has that folder and filename. No files were replaced.');
      records.push({ id: existing?.id || matching?.id || crypto.randomUUID(), name: file.name, folder, path,
        size: file.size, savedAt: Date.now(), sha256: await C.hashBlob(file), blob: file });
    }
    const replacements = records.filter(doc => state.documents.some(old => old.id === doc.id)).length;
    if (replacements && !confirm(`Replace ${replacements} saved PDF${replacements === 1 ? '' : 's'}? Other documents and the itinerary will stay in the app.`)) {
      announce('Import cancelled. The saved documents were kept.'); return;
    }
    await S.saveDocuments(records);
    await loadState();
    $('verification-result').textContent = 'Documents changed. Run the saved-file check again.';
    location.hash = 'documents';
    await requestPersistence(false);
    announce(`${records.length} PDF${records.length === 1 ? '' : 's'} saved locally${folderTree && files.length > candidates.length ? '; non-PDF files were skipped' : ''}. Keep the originals in Files.`);
    await refreshStatus();
  }
  async function requestPersistence(explicit) {
    try {
      const storage = navigator.storage;
      const persistent = storage?.persisted ? await storage.persisted() : false;
      if (storage?.persist && !persistent) await storage.persist();
      await storageStatus();
      if (explicit) announce('Storage protection checked. The result is shown below; keep independent originals in Files.');
    } catch (error) {
      if (explicit) throw error;
      // A denied persistence request must not make a successful import look unsuccessful.
    }
  }
  async function storageStatus() {
    const storage = navigator.storage;
    if (storage?.persisted) {
      const persistent = await storage.persisted();
      $('persistence-status').textContent = persistent ? 'Persistent storage granted. Originals in Files are still your backup.' : 'Persistence not granted. Keep the app in use and retain originals in Files.';
    } else $('persistence-status').textContent = 'This browser does not report persistence. Keep independent originals in Files.';
    if (storage?.estimate) {
      const estimate = await storage.estimate();
      $('storage-space').textContent = `Browser reports ${C.formatBytes(estimate.usage || 0)} used of an estimated ${C.formatBytes(estimate.quota || 0)} allowance. This is not guaranteed free device space.`;
    }
  }
  function shellAudit() {
    return new Promise((resolve, reject) => {
      const controller = navigator.serviceWorker?.controller;
      if (!controller) { resolve({ controlled: false, complete: false }); return; }
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('The offline shell check timed out. Reopen the app and try again.')); }, 4000);
      channel.port1.onmessage = event => {
        clearTimeout(timeout); channel.port1.close();
        if (event.data?.error) reject(new Error(event.data.error));
        else resolve({ ...event.data, controlled: true });
      };
      controller.postMessage({ type: 'AUDIT_SHELL' }, [channel.port2]);
    });
  }
  async function refreshStatus() {
    networkHint();
    $('install-hint').hidden = standalone();
    try {
      const audit = await shellAudit();
      $('shell-status').textContent = audit.complete ? `All ${audit.total} shell assets are cached · app ${audit.version}. Confirm by reopening in Airplane Mode.` : audit.controlled ? 'Some shell assets are missing. Reconnect and check for an app update before travelling offline.' : 'The offline shell is not controlling this window yet. Stay online, then reopen the app and check again.';
    } catch (error) { $('shell-status').textContent = errorText(error); }
    try { await storageStatus(); }
    catch { $('persistence-status').textContent = 'Storage protection could not be checked. Keep originals in Files.'; }
  }
  async function verifyFiles() {
    await loadState();
    const audit = await shellAudit();
    if (!audit.complete) throw new Error('The shell cache is not complete. Reconnect and finish installing the app before testing offline.');
    if (!state.itinerary) throw new Error('No saved itinerary found. Import it from Files.');
    const trip = state.itinerary;
    if (trip.blob.size !== trip.size || await C.hashBlob(trip.blob) !== trip.sha256) throw new Error('The saved itinerary did not pass its file check. Replace it from the original in Files.');
    for (const [index, meta] of state.documents.entries()) {
      $('verification-result').textContent = `Reading PDF ${index + 1} of ${state.documents.length}…`;
      const record = await S.readDocument(meta.id);
      if (!record.file?.blob || record.file.blob.size !== meta.size || await C.hashBlob(record.file.blob) !== meta.sha256) throw new Error(`“${meta.name}” is missing or failed its file check. Replace its app copy from Files.`);
    }
    $('verification-result').textContent = `Checked ${displayTime(Date.now())}: cached app, itinerary and ${state.documents.length} PDFs could all be read locally and matched their saved fingerprints. Device airplane-mode and restart tests are still required.`;
    announce('Saved files passed their local check. Now run the airplane-mode checklist.');
  }
  async function registerWorker() {
    if (!('serviceWorker' in navigator) || !isSecureContext) {
      $('shell-status').textContent = 'Offline installation requires HTTPS (or localhost for desktop development).'; return;
    }
    try {
      registration = await navigator.serviceWorker.register(new URL('sw.js', base), { scope: base.href, updateViaCache: 'none' });
      const showWaiting = () => { $('update-banner').hidden = !registration.waiting; };
      showWaiting();
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed') { showWaiting(); refreshStatus(); }
          if (installing.state === 'redundant') announce('An app update could not be installed. The existing app and local files have been kept.', 'error');
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (applyUpdate) location.reload();
        else refreshStatus();
      });
      await refreshStatus();
    } catch (error) {
      $('shell-status').textContent = 'Offline shell installation failed. Reconnect and reopen this HTTPS address.';
      announce(errorText(error), 'error');
    }
  }
  function inputAction(id, handler) {
    $(id).addEventListener('change', event => {
      const files = [...event.target.files]; event.target.value = '';
      work(() => handler(files));
    });
  }
  inputAction('itinerary-input', files => importItinerary(files[0]));
  inputAction('pdf-input', files => importPdfs(files));
  inputAction('folder-input', files => importPdfs(files, true));
  inputAction('replace-pdf-input', files => importPdfs(files.slice(0, 1), false, replacingId));
  document.querySelectorAll('[data-choose]').forEach(button => {
    button.addEventListener('click', () => { if (!busy) $(button.dataset.choose).click(); });
  });
  $('folder-import-label').hidden = !('webkitdirectory' in $('folder-input'));
  $('document-search').addEventListener('input', renderDocuments);
  $('close-pdf').addEventListener('click', () => { location.hash = 'documents'; });
  $('expand-itinerary').addEventListener('click', () => {
    const expanded = document.body.classList.toggle('expanded');
    $('expand-itinerary').textContent = expanded ? 'Show navigation' : 'Expand view';
  });
  $('request-persistence').addEventListener('click', () => work(() => requestPersistence(true)));
  $('verify-files').addEventListener('click', () => work(verifyFiles));
  $('check-update').addEventListener('click', () => work(async () => {
    if (!registration) await registerWorker();
    if (!registration) throw new Error('App updates require an HTTPS address and a service-worker-capable browser.');
    await registration.update(); await refreshStatus();
    if (registration.waiting) $('update-banner').hidden = false;
    announce('App update check requested. An available update will appear above; saved files stay on this device.');
  }));
  $('apply-update').addEventListener('click', () => work(async () => {
    if (!registration?.waiting) { $('update-banner').hidden = true; return; }
    applyUpdate = true;
    registration.waiting.postMessage({ type: 'APPLY_UPDATE' });
  }));
  addEventListener('message', event => {
    const frame = $('itinerary-view').querySelector('iframe');
    if (event.source !== frame?.contentWindow || event.origin !== 'null' || event.data?.token !== frameToken || event.data?.type !== 'itinerary-view-ready') return;
    if (event.data.scriptError) announce('The itinerary reported a script error. Check its map and day controls; the saved original is unchanged.', 'error');
  });
  addEventListener('hashchange', () => { route().catch(error => announce(errorText(error), 'error')); });
  addEventListener('online', refreshStatus);
  addEventListener('offline', networkHint);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !busy) loadState().then(refreshStatus).catch(error => announce(errorText(error), 'error'));
  });
  $('app-version').textContent = `App ${C.VERSION} · ${location.origin} · local imports only`;
  networkHint();
  (async () => {
    try { await loadState(); await route(); }
    catch (error) { announce(errorText(error), 'error'); }
    await registerWorker();
  })();
})();
