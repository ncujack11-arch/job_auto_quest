/**
 * logger.js — 分级日志输出
 * 全局命名空间: AS (AutoFill System)
 * 级别: debug < info < warn < error,可通过设置中的 logLevel 调整
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  // 版本自愈: 扩展更新后, 残留的旧内容脚本会在注入新脚本时被识别并整体清除, 确保新代码完整初始化
  let V = '';
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      V = chrome.runtime.getManifest().version;
    }
  } catch (e) { /* ignore */ }
  if (G.AS && G.AS.__v && V && G.AS.__v !== V) {
    // 标记旧脚本失效: 旧 listener 的版本守卫(AS.__v === 旧版本)将判定失败, 不再处理任何消息
    try { G.AS.__v = 'stale'; } catch (e) { /* ignore */ }
    try { delete G.AS; } catch (e) { G.AS = undefined; }
  }
  const AS = (G.AS = G.AS || {});
  if (V) AS.__v = V;
  if (AS.logger) return;

  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  let level = LEVELS.info;

  function now() {
    return new Date().toISOString().slice(11, 23);
  }

  function setLevel(lv) {
    level = LEVELS[lv] !== undefined ? LEVELS[lv] : LEVELS.info;
  }
  function getLevelName() {
    return Object.keys(LEVELS).find((k) => LEVELS[k] === level) || 'info';
  }

  function out(lv, args, tag) {
    if (LEVELS[lv] < level) return;
    const prefix = `[AF:${tag || '?'}] ${now()}`;
    const fn = lv === 'debug' ? console.debug : lv === 'warn' ? console.warn : lv === 'error' ? console.error : console.info;
    fn(prefix, ...args);
    // warn/error 持久化到本地日志缓冲(设置页可导出排查)
    if ((lv === 'warn' || lv === 'error') && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const text = args.map((a) => (a && a.message ? a.message : a)).join(' ').slice(0, 400);
        chrome.storage.local.get('af_logs').then((r) => {
          const list = (r && r.af_logs) || [];
          list.push({ t: Date.now(), lv, tag: tag || '?', msg: text });
          while (list.length > 300) list.shift();
          chrome.storage.local.set({ af_logs: list });
        }).catch(() => {});
      } catch (e) { /* ignore */ }
    }
  }

  AS.logger = {
    LEVELS,
    setLevel,
    getLevelName,
    debug: (tag, ...a) => out('debug', a, tag),
    info: (tag, ...a) => out('info', a, tag),
    warn: (tag, ...a) => out('warn', a, tag),
    error: (tag, ...a) => out('error', a, tag),
  };

  // 读取持久化的日志级别(后台与选项页有 chrome.storage)
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('af_settings').then((r) => {
        if (r.af_settings && r.af_settings.logLevel) setLevel(r.af_settings.logLevel);
      }).catch(() => {});
    }
  } catch (e) { /* ignore */ }
})();
