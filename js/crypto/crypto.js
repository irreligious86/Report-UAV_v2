/**
 * Encrypted backup primitives — passphrase-based JSON encryption / decryption.
 *
 * EN:
 *   This module implements the cryptographic core used by the encrypted backup
 *   feature ("Експорт / Імпорт" on the Data screen). Everything happens inside
 *   the browser via the Web Crypto API — no key, no plaintext, and no report
 *   ever leaves the device for any server we control.
 *
 *   Algorithm choices, why exactly these:
 *     • KDF: PBKDF2 with SHA-256 and 250 000 iterations. PBKDF2 is well
 *       supported by Web Crypto in every browser we care about. The high
 *       iteration count makes brute-force attacks on the passphrase costly
 *       even on a stronger machine than the user's phone.
 *     • Cipher: AES-256-GCM. GCM provides BOTH confidentiality and integrity
 *       (authenticated encryption with associated data, AEAD) — if anyone
 *       tampers with the file or the wrong key is supplied, decrypt() throws.
 *     • Salt: 16 random bytes per export. Different salts mean two exports of
 *       the same data with the same passphrase produce different ciphertext.
 *     • IV (nonce): 12 random bytes per export — the value recommended for
 *       AES-GCM.
 *
 *   File format (JSON returned by `encryptJSON`):
 *     {
 *       version, algo, kdf, hash, iterations,
 *       salt: base64, iv: base64, data: base64
 *     }
 *   The cipher metadata is stored alongside the ciphertext so decryption is
 *   self-contained — the user only needs the passphrase, not separate notes.
 *
 *   The passphrase itself is NEVER stored — it lives only as a JS string on
 *   the call stack during encrypt/decrypt and disappears with that stack.
 *
 * UA:
 *   Цей модуль — криптографічне ядро функції зашифрованого резервного
 *   копіювання («Експорт / Імпорт» на екрані «Дані та інтеграція»). Усі
 *   обчислення виконуються у браузері через Web Crypto API — пароль і самі
 *   дані ніколи не надсилаються нашому серверу (його просто немає).
 *
 *   Чому саме такі алгоритми:
 *     • KDF: PBKDF2 з SHA-256 і 250 000 ітерацій. PBKDF2 підтримується Web
 *       Crypto у всіх браузерах. Велика кількість ітерацій робить підбір
 *       паролю на чужій машині дуже дорогим.
 *     • Шифр: AES-256-GCM. GCM забезпечує і конфіденційність, і
 *       автентичність (AEAD): якщо файл підмінено або введено неправильний
 *       ключ — decrypt() кине виняток.
 *     • Сіль: 16 випадкових байтів для кожного експорту. Різні солі
 *       гарантують, що два експорти однакових даних з тим самим паролем
 *       дають різний ciphertext.
 *     • IV (nonce): 12 випадкових байтів — значення, рекомендоване для
 *       AES-GCM.
 *
 *   Формат файлу (JSON, який повертає `encryptJSON`):
 *     { version, algo, kdf, hash, iterations,
 *       salt: base64, iv: base64, data: base64 }
 *   Метадані шифру лежать поруч із ciphertext, щоб розшифровка була
 *   самодостатньою — користувачу потрібен лише пароль, без додаткових нотаток.
 *
 *   Пароль НІДЕ не зберігається — він існує лише як JS-рядок у стеку виклику
 *   encrypt/decrypt і зникає разом із цим стеком.
 *
 * @module crypto/crypto
 */

/** EN: File-format version stored in the envelope; bump on incompatible changes. UA: Версія формату файлу (зміни — підвищувати). */
const CRYPTO_VERSION = 1;

/** EN: AES mode used for the payload. UA: Режим AES для шифрування корисного навантаження. */
const CRYPTO_ALGO = "AES-GCM";

/** EN: PBKDF2 iteration count — high enough to slow down brute force on offline copies. UA: Кількість ітерацій PBKDF2 — щоб ускладнити підбір пароля на чужому залізі. */
const PBKDF2_ITERATIONS = 250000;

/** EN: Derived AES key length in bits. UA: Довжина похідного AES-ключа у бітах. */
const KEY_LENGTH_BITS = 256;

/** EN: Random salt length (bytes) — fresh per export. UA: Довжина солі (байти) — нова на кожен експорт. */
const SALT_LENGTH = 16;

/** EN: AES-GCM IV/nonce length (bytes) — 12 is the standard for GCM. UA: IV/nonce для AES-GCM (стандарт — 12 байтів). */
const IV_LENGTH = 12;

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/**
 * EN: Returns the Web Crypto API. Throws when running in a browser without
 *     `crypto.subtle` (very old / non-secure context). The user-facing layer
 *     should treat this as a fatal error and tell the user to update.
 * UA: Повертає Web Crypto API. Кидає виняток у браузерах без `crypto.subtle`
 *     (дуже старі або не-secure контексти). UI-шар має сприйняти це як
 *     фатальну помилку і попросити користувача оновити браузер.
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
 * EN: Encodes raw bytes (ArrayBuffer or Uint8Array) into a base64 string.
 *     We chunk the input because `String.fromCharCode(...veryBigArray)` blows
 *     the JS argument stack on large payloads.
 * UA: Кодує сирі байти (ArrayBuffer або Uint8Array) у base64-рядок. Ділимо
 *     ввід на шматки, бо `String.fromCharCode(...великийМасив)` переповнює
 *     стек аргументів JS на великих обсягах.
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
 * EN: Decodes a base64 string into a Uint8Array.
 * UA: Декодує base64-рядок у Uint8Array.
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
 * EN: Wraps the user's passphrase as a non-extractable PBKDF2 key. The result
 *     is the input to `deriveAesKey` — it is NOT yet usable for encryption.
 * UA: Огортає пароль користувача у непохідний (non-extractable) PBKDF2-ключ.
 *     Це ще не AES-ключ, а лише матеріал для `deriveAesKey`.
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
 * EN: Runs PBKDF2(passphrase, salt) → 256-bit AES-GCM key. The key is marked
 *     non-extractable, so even an attacker with JS access cannot read its
 *     bytes — they can only call encrypt/decrypt while the page lives.
 * UA: Виконує PBKDF2(пароль, сіль) → 256-бітний AES-GCM ключ. Ключ
 *     non-extractable: навіть зі скриптів не можна прочитати його байти —
 *     лише викликати encrypt/decrypt у межах життя сторінки.
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
 * EN: Throws if the passphrase is empty / not a string. We do NOT impose
 *     length or complexity rules on purpose — users may want a long
 *     diceware phrase or a short field code. The user is responsible for
 *     the strength.
 * UA: Кидає виняток, якщо пароль порожній або не рядок. Жодних правил на
 *     довжину/складність свідомо не накладаємо: можна як довгу мнемофразу,
 *     так і короткий польовий код. Сила пароля — на відповідальності
 *     користувача.
 * @param {string} passphrase
 */
function assertPassphrase(passphrase) {
  if (typeof passphrase !== "string" || !passphrase.trim()) {
    throw new Error("Encryption key is empty.");
  }
}

/**
 * EN: Encrypts any JSON-serializable value with the given passphrase.
 *     Steps performed:
 *       1) Generate fresh salt (16 B) and IV (12 B) via the OS CSPRNG.
 *       2) Derive a 256-bit AES-GCM key from passphrase + salt (PBKDF2).
 *       3) UTF-8-encode JSON.stringify(data) → plaintext bytes.
 *       4) Encrypt with AES-GCM(iv) → ciphertext bytes.
 *     Returns a plain JSON-friendly envelope (base64 fields) that can be
 *     written directly to a .json file.
 *
 * UA: Шифрує довільне JSON-сериалізоване значення заданим паролем.
 *     Кроки:
 *       1) Згенерувати свіжу сіль (16 Б) і IV (12 Б) через CSPRNG ОС.
 *       2) Похідним шляхом отримати 256-бітний AES-GCM ключ із пароля та
 *          солі (PBKDF2).
 *       3) UTF-8-кодувати JSON.stringify(data) → байти plaintext.
 *       4) Зашифрувати AES-GCM(iv) → байти ciphertext.
 *     Повертає JSON-сумісну "обгортку" (поля у base64), яку можна одразу
 *     записати у .json файл.
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
 * EN: Inverse of {@link encryptJSON}. Validates the envelope shape, derives
 *     the same AES key from passphrase + stored salt, and decrypts. AES-GCM
 *     authenticates the ciphertext, so any of:
 *       - wrong passphrase,
 *       - tampered ciphertext / iv / salt,
 *       - mismatched algo / version,
 *     causes a thrown error rather than silent garbage output.
 *
 * UA: Зворотна до {@link encryptJSON}. Перевіряє форму обгортки, виводить
 *     той самий AES-ключ із пароля + збереженої солі, розшифровує. GCM
 *     автентифікує ciphertext, тому будь-який із цих випадків:
 *       - неправильний пароль,
 *       - зіпсовані ciphertext / iv / salt,
 *       - невідповідні algo / version
 *     призводить до виключення, а не до "сміття" на виході.
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


