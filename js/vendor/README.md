# Vendored third-party libraries

Local copies of the libraries the app cannot run without. They are served from
the app's own origin and listed in `sw.js` `ASSETS`, so the PWA boots and works
fully offline (no CDN round-trip on start).

| File | Library | Version | License | Source |
|------|---------|---------|---------|--------|
| `mgrs.esm.js` | mgrs (MGRS ↔ WGS84) | 2.1.0 | MIT | https://github.com/proj4js/mgrs |
| `Sortable.min.js` | SortableJS (drag & drop) | 1.15.2 | MIT | https://github.com/SortableJS/Sortable |

Files are unmodified upstream builds (`dist/mgrs.esm.js` without the source-map
comment, `Sortable.min.js`). To update: replace the file with the new upstream
build, update this table and bump `CACHE_NAME` in `sw.js`.

Leaflet is still loaded from a CDN: the map needs network for tiles anyway and
the app degrades gracefully when `window.L` is missing.
