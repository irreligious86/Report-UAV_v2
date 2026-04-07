/**
 * Crypto helpers for encrypted JSON import/export.
 * Uses Web Crypto API with PBKDF2 + AES-GCM.
 * Works fully offline in modern browsers.
 * @module crypto/crypto
 */

const CRYPTO_VERSION = 1;
const CRYPTO_ALGO = "AES-GCM";
const PBKDF2_ITERATIONS = 250000;
const KEY_LENGTH_BITS = 256;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/**
 * Ensures Web Crypto API is available.
 * @returns {Crypto}
 */
function getCrypto() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error("Web Crypto API is not available in this browser.");
  }
  return c;
}

/**
 * Converts ArrayBuffer / Uint8Array to base64 string.
 * @param {ArrayBuffer | Uint8Array} input
 * @returns {string}
 */
function bytesToBase64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

/**
 * Converts base64 string to Uint8Array.
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/**
 * Imports passphrase as raw key material for PBKDF2.
 * @param {string} passphrase
 * @returns {Promise<CryptoKey>}
 */
async function importPassphraseKey(passphrase) {
  const cryptoApi = getCrypto();

  return cryptoApi.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
}

/**
 * Derives AES-GCM key from passphrase and salt.
 * @param {string} passphrase
 * @param {Uint8Array} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveAesKey(passphrase, salt) {
  const cryptoApi = getCrypto();
  const keyMaterial = await importPassphraseKey(passphrase);

  return cryptoApi.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    {
      name: "AES-GCM",
      length: KEY_LENGTH_BITS,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Validates passphrase.
 * @param {string} passphrase
 */
function assertPassphrase(passphrase) {
  if (typeof passphrase !== "string" || !passphrase.trim()) {
    throw new Error("Encryption key is empty.");
  }
}

/**
 * Encrypts any JSON-serializable data with a passphrase.
 * Returns a plain object safe to save as .json file.
 *
 * @param {any} data
 * @param {string} passphrase
 * @returns {Promise<{
 *   version: number,
 *   algo: string,
 *   kdf: string,
 *   hash: string,
 *   iterations: number,
 *   salt: string,
 *   iv: string,
 *   data: string
 * }>}
 */
export async function encryptJSON(data, passphrase) {
  assertPassphrase(passphrase);

  const cryptoApi = getCrypto();
  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveAesKey(passphrase, salt);

  const plaintext = TEXT_ENCODER.encode(JSON.stringify(data));

  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    plaintext
  );

  return {
    version: CRYPTO_VERSION,
    algo: CRYPTO_ALGO,
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(ciphertext),
  };
}

/**
 * Decrypts encrypted payload produced by encryptJSON().
 * Returns parsed JSON data.
 *
 * @param {{
 *   version: number,
 *   algo: string,
 *   salt: string,
   *   iv: string,
   *   data: string,
   *   iterations?: number
   * }} payload
 * @param {string} passphrase
 * @returns {Promise<any>}
 */
export async function decryptJSON(payload, passphrase) {
  assertPassphrase(passphrase);

  if (!payload || typeof payload !== "object") {
    throw new Error("Encrypted file has invalid structure.");
  }

  if (payload.version !== CRYPTO_VERSION) {
    throw new Error("Unsupported encrypted file version.");
  }

  if (payload.algo !== CRYPTO_ALGO) {
    throw new Error("Unsupported encryption algorithm.");
  }

  if (
    typeof payload.salt !== "string" ||
    typeof payload.iv !== "string" ||
    typeof payload.data !== "string"
  ) {
    throw new Error("Encrypted file is missing required fields.");
  }

  const salt = base64ToBytes(payload.salt);
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.data);

  const key = await deriveAesKey(passphrase, salt);

  let plaintextBuffer;
  try {
    plaintextBuffer = await getCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      ciphertext
    );
  } catch {
    throw new Error("Failed to decrypt data. Wrong key or damaged file.");
  }

  const plaintext = TEXT_DECODER.decode(plaintextBuffer);

  try {
    return JSON.parse(plaintext);
  } catch {
    throw new Error("Decrypted content is not valid JSON.");
  }
}


