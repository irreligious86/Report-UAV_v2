/**
 * Clipboard helper — Web Clipboard API or Android WebView bridge.
 *
 * EN:
 *   The app runs in two environments: a normal browser tab/PWA and inside
 *   a wrapping Android app's WebView. The WebView injects a JS bridge
 *   `window.AndroidBridge` because old Android WebView versions used to
 *   block `navigator.clipboard`. If the bridge is present we use it; on
 *   plain browsers we use the standard `navigator.clipboard.writeText`.
 *
 *   Returning `false` (instead of throwing) on failure is intentional —
 *   the form flow keeps going even if copy did not work; we just change
 *   the status message and let the user copy manually.
 *
 * UA:
 *   Застосунок працює у двох середовищах: звичайна вкладка/PWA і всередині
 *   Android-обгортки WebView. WebView інʼєктить JS-міст `window.AndroidBridge`,
 *   бо старі версії Android WebView блокували `navigator.clipboard`. Якщо
 *   міст є — використовуємо його; у звичайному браузері — стандартний
 *   `navigator.clipboard.writeText`.
 *
 *   Повертаємо `false` (замість throw) при помилці навмисно — потік форми
 *   продовжується навіть якщо копіювання не вдалося; просто змінюємо
 *   повідомлення статусу, користувач скопіює вручну.
 *
 * @module clipboard
 */

/**
 * EN: Copies text to the clipboard. If `window.AndroidBridge` is injected
 *     by the host app, both `copyToClipboard` and (when available)
 *     `shareText` are called so Android can also offer a share sheet.
 *     Returns true on success.
 * UA: Копіює текст у буфер. Якщо хост-додаток інʼєктнув
 *     `window.AndroidBridge` — викликаються `copyToClipboard` і (за
 *     наявності) `shareText`, щоб Android міг показати меню поширення.
 *     Повертає true при успіху.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  if (window.AndroidBridge) {
    window.AndroidBridge.copyToClipboard(text);
    if (window.AndroidBridge.shareText) window.AndroidBridge.shareText(text);
    return true;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
