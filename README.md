# Offline travel companion

A small static web app for opening a self-contained HTML itinerary and separate PDFs offline.

## Use

1. Open the app over HTTPS and install it using the browser's installation or Add to Home Screen option.
2. Launch the installed app and import local files.
3. Check Offline status, then test reopening the app and its files with the network disconnected.

The app preserves imported filenames and supports replacing the itinerary or individual PDFs. See the in-app guide for usage and recovery instructions.

## Local storage

Imported files are stored in the browser's IndexedDB. A service worker caches the generic app shell. The app has no upload, account-sync or analytics service and no external runtime dependencies.

Keep independent originals outside the browser. Local storage can be cleared or evicted, and native PDF viewing varies by browser. Install first and import from the installed app, since browser and installed-app storage may differ.

## Hosting

Serve the static shell over HTTPS. No build step or package installation is required. GitHub Pages is supported; a custom hostname, when configured, is recorded in `CNAME`.

Publish only the app shell. Keep imported HTML, PDFs and personal deployment notes outside the public repository.

For app releases, update the version in `core.js` and `sw.js` together. Shell updates preserve the imported-file database. A file check is useful, but offline launch and document viewing must also be tested on the intended device.
