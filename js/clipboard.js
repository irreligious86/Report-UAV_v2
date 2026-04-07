/**
 * Copy text to clipboard: Web Clipboard API or Android WebView bridge.
 * Копирование текста в буфер: Web Clipboard API или мост Android WebView.
 * @module clipboard
 */

/**
 * Copies text to clipboard. Uses AndroidBridge if present (WebView), else navigator.clipboard.
 * Копирует текст в буфер. Использует AndroidBridge при наличии (WebView), иначе navigator.clipboard.
 * @param {string} text - Text to copy. Текст для копирования.
 * @returns {Promise<boolean>} true if copy succeeded. true при успешном копировании.
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
