/**
 * dates.js — 日期解析与格式自适应转换
 * 支持: YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYY年MM月DD日 / MM/DD/YYYY / YYYY-MM / YYYY年MM月
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.dates) return;

  // 解析任意常见日期字符串 → {y, m, d} (m/d 可能为 0 表示未给出)
  function parseDateStr(s) {
    if (!s) return null;
    const t = String(s).trim();
    let m = t.match(/(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]?\s*(\d{1,2})?\s*日?/);
    if (m) return { y: +m[1], m: +(m[2] || 0), d: +(m[3] || 0) };
    m = t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月?/);
    if (m) return { y: +m[1], m: +(m[2] || 0), d: 0 };
    m = t.match(/^(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})$/); // MM/DD/YYYY 或 DD/MM/YYYY
    if (m) {
      const a = +m[1], b = +m[2];
      return a <= 12 && b > 12 ? { y: +m[3], m: a, d: b } : { y: +m[3], m: b, d: a };
    }
    return null;
  }

  // 根据目标格式输出字符串
  function formatDate(d, fmt) {
    if (!d || !d.y) return '';
    const pad = (n) => (n > 0 ? String(n).padStart(2, '0') : '');
    const Y = String(d.y), M = pad(d.m), D = pad(d.d);
    const hasD = d.d > 0, hasM = d.m > 0;
    switch (fmt) {
      case 'yyyy-mm-dd': return `${Y}-${M}-${D}`;
      case 'yyyy/mm/dd': return `${Y}/${M}/${D}`;
      case 'yyyy.mm.dd': return `${Y}.${M}.${D}`;
      case 'yyyy年mm月dd日': return `${Y}年${M}月${D}日`;
      case 'yyyy年mm月': return `${Y}年${M}月`;
      case 'mm/dd/yyyy': return `${M}/${D}/${Y}`;
      case 'yyyy-mm': return `${Y}-${M}`;
      case 'yyyy/mm': return `${Y}/${M}`;
      case 'iso': return `${Y}-${M}-${D}`;
      default: return hasD ? `${Y}-${M}-${D}` : hasM ? `${Y}-${M}` : String(d.y);
    }
  }

  // 检测目标输入框的日期格式
  function detectTargetFormat(el) {
    const ph = ((el && (el.placeholder || '')) || '').trim();
    const cls = ((el && el.className) || '').toString();
    const type = el && el.type;
    if (type === 'date' || type === 'datetime-local' || type === 'month') return 'iso';
    if (/年.*月.*日/.test(ph)) return 'yyyy年mm月dd日';
    if (/^\d{4}\s*年/.test(ph) && /月/.test(ph) && !/日/.test(ph)) return 'yyyy年mm月';
    if (/\d{4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{1,2}/.test(ph) || /yyyy[-\/.].*mm/.test(ph.toLowerCase()) || /格式.*\d{4}/.test(ph)) {
      if (ph.includes('/')) return 'yyyy/mm/dd';
      if (ph.includes('.')) return 'yyyy.mm.dd';
      return 'yyyy-mm-dd';
    }
    if (/^\d{4}\s*[-/]/.test(ph) && !/[-/.]\d{1,2}\s*$/.test(ph)) {
      return ph.includes('/') ? 'yyyy/mm' : 'yyyy-mm';
    }
    if (/mm[\/-]dd/.test(ph.toLowerCase()) || /month[\/-]day/.test(ph.toLowerCase()) || /[\/-]\d{1,2}\s*[\/-]\d{4}/.test(ph)) {
      return 'mm/dd/yyyy';
    }
    if (/日期|年月日|birth|date|time/i.test(ph) || /年|月|日/.test(ph)) {
      if (/日/.test(ph)) return 'yyyy年mm月dd日';
      if (/月/.test(ph) && !/日/.test(ph)) return 'yyyy年mm月';
    }
    // 检测已有值格式
    const v = el && el.value ? String(el.value) : '';
    if (v) {
      if (/^\d{4}[./-]\d{1,2}[./-]\d{1,2}$/.test(v)) return v.includes('/') ? 'yyyy/mm/dd' : v.includes('.') ? 'yyyy.mm.dd' : 'yyyy-mm-dd';
      if (/\d{4}年\d{1,2}月(\d{1,2}日)?/.test(v)) return v.includes('日') ? 'yyyy年mm月dd日' : 'yyyy年mm月';
    }
    return 'yyyy-mm-dd';
  }

  function isDateish(el) {
    const t = (el && el.type) || '';
    if (t === 'date' || t === 'datetime-local' || t === 'month') return true;
    const ph = ((el && el.placeholder) || '') + ' ' + ((el && el.name) || '') + ' ' + ((el && el.id) || '');
    return /(日期|年月|生日|出生|时间|date|birth|time|year|month|毕业|入学)/i.test(ph);
  }

  AS.dates = { parseDateStr, formatDate, detectTargetFormat, isDateish };
})();
