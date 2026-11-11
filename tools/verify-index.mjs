/**
 * Pre-commit sanity check (`npm run verify`). No dependencies, plain Node.
 *
 * EN: Catches the mistakes that break the app only later and only offline:
 *       1. index.html lost its module entry point or closing tag,
 *       2. a first-party JS file is missing from `sw.js` ASSETS (works online,
 *          fails on the first offline start),
 *       3. `sw.js` ASSETS lists a file that does not exist (the whole SW
 *          install fails — `cache.addAll` is all-or-nothing),
 *       4. a module statically imports from a CDN (no network → the whole
 *          module graph, i.e. the app, does not boot),
 *       5. the version in `js/constants.js` and `manifest.json` disagree.
 * UA: Ловить помилки, які ламають застосунок лише згодом і лише офлайн:
 *       1. index.html втратив точку входу-модуль або закриваючий тег,
 *       2. власний JS-файл відсутній у `sw.js` ASSETS (онлайн працює, падає
 *          при першому офлайн-запуску),
 *       3. у `sw.js` ASSETS є файл, якого не існує (падає все встановлення
 *          SW — `cache.addAll` працює за принципом «усе або нічого»),
 *       4. модуль статично імпортує з CDN (без мережі не стартує весь граф
 *          модулів, тобто застосунок),
 *       5. версія у `js/constants.js` і `manifest.json` не збігається.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

const errors = [];
const fail = (msg) => errors.push(msg);

// ── 1. index.html ──────────────────────────────────────────────────────────
const html = read("index.html");
if (!html.includes('type="module"') || !html.includes("js/app.js")) {
  fail('у index.html має бути <script type="module" src="js/app.js">');
}
if (!/<\/html>\s*$/i.test(html.trim())) {
  fail("index.html має закінчуватися тегом </html>");
}
for (const m of html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith("#")) continue;
  if (!exists(ref)) fail(`index.html посилається на неіснуючий файл: ${ref}`);
}

// ── 2–3. sw.js ASSETS vs files on disk ─────────────────────────────────────
const sw = read("sw.js");
const assetsBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!assetsBlock) {
  fail("у sw.js не знайдено масив ASSETS");
}
const assets = new Set(
  [...(assetsBlock?.[1] ?? "").matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]),
);

/** @param {string} dir @returns {string[]} */
function listJs(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return listJs(rel);
    return e.name.endsWith(".js") ? [rel] : [];
  });
}
const jsFiles = listJs("js");

for (const file of jsFiles) {
  if (!assets.has(file)) fail(`${file} відсутній у sw.js ASSETS (офлайн не завантажиться)`);
}
for (const asset of assets) {
  if (asset === "") continue; // './' — the start URL itself
  if (!exists(asset)) fail(`sw.js ASSETS містить неіснуючий файл: ${asset}`);
}

// ── 4. no static imports from a CDN ────────────────────────────────────────
for (const file of jsFiles) {
  if (file.startsWith("js/vendor/")) continue;
  const src = read(file);
  for (const m of src.matchAll(/^\s*import\s[^;]*?from\s+["'](https?:\/\/[^"']+)["']/gm)) {
    fail(`${file}: статичний import із мережі (${m[1]}) — без інтернету застосунок не запуститься`);
  }
}

// ── 5. version consistency ─────────────────────────────────────────────────
const version = read("js/constants.js").match(/export const APP_VERSION = "([^"]+)"/)?.[1];
if (!version) {
  fail("у js/constants.js не знайдено APP_VERSION");
} else {
  const manifest = JSON.parse(read("manifest.json"));
  if (!String(manifest.name || "").includes(`v${version}`)) {
    fail(`manifest.json name ("${manifest.name}") не містить v${version}`);
  }
  if (!html.includes(`v${version}`)) {
    fail(`index.html не містить v${version}`);
  }
}

if (errors.length) {
  for (const e of errors) console.error("verify: " + e);
  process.exit(1);
}
console.log(
  `verify: OK (${jsFiles.length} JS-файлів у ASSETS, версія ${version}, CACHE ${sw.match(/CACHE_NAME = '([^']+)'/)?.[1]})`,
);
