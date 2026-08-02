/**
 * encrypt.js — 敏感字段可选加密 (WebCrypto AES-GCM + PBKDF2)
 * 密钥仅缓存在后台 Service Worker 内存中, 重启浏览器后需重新输入口令
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.encrypt) return;

  const ENC_PREFIX = 'enc:v1:';
  let sessionKey = null; // CryptoKey, 仅内存

  async function sha256Hex(str) {
    const buf = new TextEncoder().encode(str);
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function deriveKey(password, salt, iterations) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode(salt), iterations: iterations || 100000, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function b64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin);
  }
  function fromB64(s) {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  async function encryptString(key, plain) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(String(plain))
    );
    return ENC_PREFIX + b64(iv) + ':' + b64(data);
  }

  async function decryptString(key, str) {
    if (typeof str !== 'string' || !str.startsWith(ENC_PREFIX)) return str;
    const parts = str.slice(ENC_PREFIX.length).split(':');
    if (parts.length !== 2) throw new Error('加密数据格式错误');
    const iv = fromB64(parts[0]);
    const data = fromB64(parts[1]);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plain);
  }

  function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(ENC_PREFIX);
  }

  // 后台: 验证口令并缓存密钥
  async function unlock(password, settings) {
    if (!settings || !settings.encryption) return false;
    const enc = settings.encryption;
    if (!enc.enabled || !enc.passwordHash) return false;
    const hash = await sha256Hex(password || '');
    if (hash !== enc.passwordHash) return false;
    sessionKey = await deriveKey(password, enc.salt, enc.iterations);
    return true;
  }

  function hasKey() { return !!sessionKey; }

  async function decryptWithSession(value) {
    if (!sessionKey) throw new Error('未解锁');
    return decryptString(sessionKey, value);
  }

  async function encryptWithSession(value) {
    if (!sessionKey) throw new Error('未解锁');
    return encryptString(sessionKey, value);
  }

  function clearSessionKey() { sessionKey = null; }

  // 深度解密(用于解锁后填充/重加密)
  async function deepDecrypt(obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') {
      try { return await decryptWithSession(obj); } catch (e) { return obj; }
    }
    if (Array.isArray(obj)) {
      const out = [];
      for (const item of obj) out.push(await deepDecrypt(item));
      return out;
    }
    if (typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) out[k] = await deepDecrypt(obj[k]);
      return out;
    }
    return obj;
  }

  AS.encrypt = {
    ENC_PREFIX, isEncrypted, sha256Hex, deriveKey,
    encryptString, decryptString, deepDecrypt,
    unlock, hasKey, decryptWithSession, encryptWithSession, clearSessionKey,
  };
})();
