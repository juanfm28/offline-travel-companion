(function (root) {
  'use strict';
  let opening;
  function database() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('Local file storage is unavailable in this browser.')); return; }
      const request = indexedDB.open('offline-travel-companion', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('itineraries', { keyPath: 'id' });
        db.createObjectStore('documents', { keyPath: 'id' }).createIndex('path', 'path', { unique: true });
        db.createObjectStore('files', { keyPath: 'id' });
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other tabs of this app, then try again.'));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function run(stores, mode, task) {
    const db = await database();
    return new Promise((resolve, reject) => {
      let tx, requests;
      try {
        tx = db.transaction(stores, mode);
        tx.oncomplete = () => resolve(Object.fromEntries(Object.entries(requests || {}).map(([key, request]) => [key, request.result])));
        tx.onabort = () => reject(tx.error || new Error('The save was interrupted. Previous files were kept.'));
        tx.onerror = () => { /* onabort reports the transaction's final result. */ };
        // No awaits inside an IndexedDB transaction: keep all operations in its active task.
        requests = task(tx) || {};
      } catch (error) {
        if (tx) tx.abort();
        reject(error);
      }
    });
  }
  function snapshot() {
    return run(['itineraries', 'documents'], 'readonly', tx => ({
      itinerary: tx.objectStore('itineraries').get('active'),
      documents: tx.objectStore('documents').getAll()
    }));
  }
  function saveItinerary(record) {
    return run(['itineraries'], 'readwrite', tx => { tx.objectStore('itineraries').put({ ...record, id: 'active' }); });
  }
  function saveDocuments(records) {
    return run(['documents', 'files'], 'readwrite', tx => {
      for (const record of records) {
        const { blob, ...metadata } = record;
        tx.objectStore('documents').put(metadata);
        tx.objectStore('files').put({ id: record.id, blob });
      }
    });
  }
  function readDocument(id) {
    return run(['documents', 'files'], 'readonly', tx => ({
      metadata: tx.objectStore('documents').get(id), file: tx.objectStore('files').get(id)
    }));
  }
  function removeDocument(id) {
    return run(['documents', 'files'], 'readwrite', tx => {
      tx.objectStore('documents').delete(id); tx.objectStore('files').delete(id);
    });
  }
  root.CompanionStore = { snapshot, saveItinerary, saveDocuments, readDocument, removeDocument };
})(globalThis);
