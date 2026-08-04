/* ==========================================================================
   crypto.js — password hashing and the device identifier.

   CLAUDE.md Section 4.2: plain-text passwords never leave the browser. Every
   password is hashed here, in the browser, before it goes anywhere near api.js.
   ========================================================================== */

/** localStorage key for this browser's device fingerprint (sent with `login`). */
const DEVICE_ID_KEY = 'ohsp_device_id';

/**
 * SHA-256 a string and return it as lowercase hex — the exact format stored in
 * `Users.password_hash`.
 *
 * NOTE: `crypto.subtle` only exists in a secure context — https:// or
 * http://localhost. GitHub Pages is https, and Live Server runs on localhost,
 * so both work. Opening the app from a plain http:// LAN address will not.
 *
 * @param {string} text
 * @returns {Promise<string>} 64-character lowercase hex digest
 */
export async function sha256Hex(text) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('crypto.subtle unavailable — the app must be served over https:// or localhost.');
  }

  const bytes = new TextEncoder().encode(String(text));
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * A stable per-device identifier, generated once and kept in localStorage.
 * Sent with `login` and recorded in the `Sessions` row (Section 2, `device_id`).
 *
 * It is not a security control — it is a debugging aid that answers "which
 * machine kicked my session out?" under the single-active-session rule (4.1.b).
 *
 * @returns {string}
 */
export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (id) return id;

  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    id = window.crypto.randomUUID();
  } else {
    // Fallback for older browsers: random enough to tell two devices apart.
    id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
