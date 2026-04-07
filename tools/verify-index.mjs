/**
 * Перевірка цілісності index.html (швидкий страховочний скрипт для CI / перед комітом).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

if (!html.includes('type="module"') || !html.includes("js/app.js")) {
  console.error("verify-index: у index.html має бути <script type=\"module\" src=\"js/app.js\">");
  process.exit(1);
}
if (!/<\/html>\s*$/i.test(html.trim())) {
  console.error("verify-index: index.html має закінчуватися тегом </html>");
  process.exit(1);
}
console.log("verify-index: OK");
