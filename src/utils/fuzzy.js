/**
 * fuzzy.js — 字符串相似度与模糊匹配工具
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.fuzzy) return;

  // 归一化: 小写、全角转半角、去空白与常见干扰词
  function normalize(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .toLowerCase()
      .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 全角→半角
      .replace(/[\u3000\u00A0]/g, ' ')
      .replace(/[\s:：()（）*#/\\,_，。.、·-]/g, '')
      .replace(/请输入|请填写|请选择|请输|（必填）|(必填)|必填|（选填）|(选填)|选填|请勿填写/g, '');
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = new Array(n + 1).fill(0);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const cur = new Array(n + 1).fill(0);
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // 相似度 0~1 (1 为完全相同)
  function similarity(a, b) {
    const na = normalize(a), nb = normalize(b);
    if (!na.length || !nb.length) return 0;
    if (na === nb) return 1;
    const d = levenshtein(na, nb);
    return 1 - d / Math.max(na.length, nb.length);
  }

  function containsAny(s, keywords) {
    const ns = normalize(s);
    if (!ns) return false;
    return keywords.some((k) => {
      const nk = normalize(k);
      return nk && (ns.includes(nk) || nk.includes(ns));
    });
  }

  // 从候选列表中选出与目标最匹配的一项
  // opts: { minScore: 0.6, aliases: { 目标值: [同义词...] } }
  function closest(text, candidates, opts) {
    const o = opts || {};
    const nt = normalize(text);
    if (!nt || !candidates || !candidates.length) return null;
    let best = null;
    for (let i = 0; i < candidates.length; i++) {
      const raw = String(candidates[i]);
      const n = normalize(raw);
      if (!n) continue;
      let score = similarity(nt, raw);
      // 包含关系加强
      if (nt.includes(n) || n.includes(nt)) score = Math.max(score, 0.55 + 0.45 * (Math.min(nt.length, n.length) / Math.max(nt.length, n.length)));
      // 同义词表加权
      if (o.aliases) {
        for (const [target, list] of Object.entries(o.aliases)) {
          if (nt === normalize(target) && list.includes(raw)) score = Math.max(score, 0.95);
          if (list.includes(nt) && normalize(target) === n) score = Math.max(score, 0.95);
        }
      }
      if (score >= (o.minScore !== undefined ? o.minScore : 0.6) && (!best || score > best.score)) {
        best = { index: i, value: raw, score };
      }
    }
    return best;
  }

  AS.fuzzy = { normalize, levenshtein, similarity, containsAny, closest };
})();
