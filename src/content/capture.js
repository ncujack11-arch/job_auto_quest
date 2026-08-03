/**
 * capture.js — 内容捕获引擎(深化版)
 * 全控件取值(真实值+显示文本)、动态行分组、上下文/选择器/模块采集、智能过滤
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.capture) return;

  const LOG = () => AS.logger;
  const FZ = () => AS.fuzzy;

  // ---------- 取值: 双值(真实值 + 显示文本) ----------
  function getValue(field) {
    const el = field.el;
    try {
      switch (field.type) {
        case 'checkbox': {
          if (!el.checked) return { value: '', display: '' };
          const label = (el.labels && el.labels[0] ? el.labels[0].textContent.trim() : '') || '';
          return { value: '是', display: label || '是' };
        }
        case 'radio': {
          const checked = (field.group || []).find((r) => r.checked);
          if (!checked) return { value: '', display: '' };
          const label = (checked.labels && checked.labels[0] ? checked.labels[0].textContent.trim() : '') || checked.value || '';
          return { value: label || '是', display: label || '是' };
        }
        case 'select': {
          const o = el.selectedOptions && el.selectedOptions[0];
          if (!o) return { value: '', display: '' };
          return { value: o.textContent || o.value || '', display: o.textContent || '' };
        }
        case 'textarea':
        case 'text': {
          return { value: el.value || '', display: el.value || '' };
        }
        case 'richtext': {
          const t = (el.textContent || '').trim();
          return { value: t, display: t };
        }
        case 'custom': {
          const input = field.custom ? field.custom.querySelector('input:not([type="hidden"]),textarea') : null;
          const v = input ? input.value : (el.value || '');
          return { value: v || '', display: v || '' };
        }
        case 'date': {
          const v = el.value || '';
          return { value: v, display: v };
        }
        default:
          return { value: el.value || '', display: el.value || '' };
      }
    } catch (e) {
      return { value: '', display: '' };
    }
  }

  // ---------- 选择器(带兜底路径) ----------
  function genSelectorWithPath(el) {
    const sel = AS.matcher.genSelector(el);
    if (sel) return sel;
    try {
      // 生成 nth-child 路径
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && node !== document.documentElement) {
        let part = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
        if (parts.length > 6) break;
      }
      return parts.join(' > ');
    } catch (e) { return ''; }
  }

  // ---------- 模块区域识别 ----------
  function detectModule(el) {
    try {
      let p = el.parentElement;
      for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
        if (p.tagName === 'BODY' || p.tagName === 'HTML') break;
        const cls = String((p.className || '').toString() || '').toLowerCase();
        if (/(section|step|module|panel|form-section|block|group)/.test(cls)) {
          // 区域标题: 容器内短文本(排除控件)
          const texts = Array.from(p.querySelectorAll(':scope > div, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > label, :scope > span, :scope > p'))
            .map((n) => (n.textContent || '').trim())
            .filter((t) => t && t.length >= 2 && t.length <= 20 && !/input|select|textarea/i.test(t));
          const title = texts.find((t) => /(信息|教育|实习|项目|技能|意向|经历|评价|证书|获奖|情况|背景)/.test(t)) || texts[0] || '';
          if (title) return title.slice(0, 12);
        }
      }
    } catch (e) { /* ignore */ }
    return '';
  }

  // ---------- 动态行分组: 重复行容器 ----------
  const ROW_SELECTOR = '.form-row,.form-item-row,.entry,.list-item,.experience-item,.item,.row-item,.form-line,.apply-item,tr,[class*="form-item"],[class*="row-item"],[class*="list-item"],[class*="entry-item"]';
  function rowGroupOf(el) {
    try {
      const row = el.closest && el.closest(ROW_SELECTOR);
      if (!row) return 0;
      // 行序号: 同级相同容器中的位置
      const parent = row.parentElement;
      if (!parent) return 0;
      const siblings = Array.from(parent.children).filter((c) => c.matches ? c.matches(ROW_SELECTOR) || c.tagName === row.tagName : true);
      return Math.max(0, siblings.indexOf(row));
    } catch (e) { return 0; }
  }

  // ---------- 主捕获 ----------
  // 返回 { captured: [item], errors: [] }
  // item: { el, type, value, display, label, name, id, cls, placeholder, selector, module, rowGroup, frame, format }
  async function captureAll() {
    const items = [];
    const errors = [];
    let fields = [];
    try { fields = AS.scanner.scan(); } catch (e) { errors.push('扫描失败: ' + (e.message || e)); }

    for (const field of fields) {
      const el = field.el;
      // 上下文
      let ctx = null;
      try { ctx = AS.matcher.buildContext(el); } catch (e) { /* ignore */ }
      const ctxText = ((ctx ? ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name + ' ' + ctx.id : '') + ' ' + String((el.className || '').toString() || '')).toLowerCase();

      // 智能过滤: 密码/空值/黑名单/文件
      if (field.type === 'file') continue;
      if (field.type === 'text' && (el.type || '').toLowerCase() === 'password') continue;
      const v = getValue(field);
      if (v.value === undefined || v.value === null || String(v.value).trim() === '') continue;
      // 忽略黑名单(异步读取, 循环内 await 开销大 → 前置读取一次)
      if (ignoreCache && ignoreCache.some((k) => ctxText.includes(k))) continue;

      const selector = genSelectorWithPath(el);
      items.push({
        el,
        type: field.type,
        value: String(v.value).trim(),
        display: String(v.display || '').trim(),
        label: ctx ? (ctx.labelText || '') : '',
        name: el.name || '',
        id: el.id || '',
        cls: String((el.className || '').toString() || '').slice(0, 80),
        placeholder: el.placeholder || '',
        selector,
        module: detectModule(el),
        rowGroup: rowGroupOf(el),
        frame: (window.top === window ? 'top' : 'iframe'),
        format: field.type === 'select' ? 'select' : (el.getAttribute ? el.getAttribute('data-type') || '' : ''),
      });
    }
    return { captured: items, errors };
  }
  let ignoreCache = null;

  // ---------- 捕获 → 结构化 items(含三级匹配与三态判定) ----------
  // profile: 当前方案; opts: { rule, memories, aliases }
  // 返回 items: [{type: field|entry|custom|openQuestions, fieldKey, pageValue, state, confidence, label, selector, module, rowGroup, frame, display, question?}]
  async function collect(profile, opts) {
    const o = opts || {};
    const { captured } = await captureAll();
    const items = [];
    const seen = new Set();
    const FZ = AS.fuzzy;

    for (const c of captured) {
      const ctx = AS.matcher.buildContext(c.el);
      // radio/checkbox: labelText 为选项文本(如 "男"/"是"), 需用行首标签(如 "性别"/"是否服从分配")匹配
      if (c.type === 'radio' || c.type === 'checkbox') {
        try {
          const row = c.el.closest('.row, .form-item, li, tr');
          if (row) {
            const firstLbl = row.querySelector(':scope > label, :scope > span > label, :scope > div > label, :scope > label:first-child');
            const t = firstLbl ? (firstLbl.textContent || '').trim() : '';
            if (t && t.length >= 2 && t.length <= 16 && !/(男|女|是|否|同意|愿意)$/.test(t)) {
              ctx.labelText = t;
            }
          }
        } catch (e) { /* ignore */ }
      }

      // 开放题答案 → 题库
      if (AS.matcher.isOpenQuestionField(ctx)) {
        const question = (ctx.labelText || ctx.placeholder || c.name || '开放题').slice(0, 60);
        const inLibrary = (profile.data.openQuestions || []).some((q) => q.question === question && q.answer === c.value);
        if (!inLibrary) {
          items.push({
            type: 'openQuestions', fieldKey: 'openQuestions', question, answer: c.value, pageValue: c.value,
            state: triState(profile, 'openQuestions', c.value), label: question, selector: c.selector,
            module: c.module, rowGroup: c.rowGroup, confidence: 80, frame: c.frame,
          });
        }
        continue;
      }

      const m = AS.matcher.matchForCapture(ctx, c.el, { memories: o.memories, rule: o.rule, profile, aliases: o.aliases });
      if (m) {
        const base = m.fieldKey.replace(/\[\d+\]/g, '');
        const [catId] = base.split('.');
        const cat = AS.schema.findCategory(catId);
        if (!cat || catId === 'openQuestions') continue;
        const state = triState(profile, m.fieldKey, c.value);
        const dupKey = 'f|' + m.fieldKey + '|' + c.rowGroup + '|' + c.value;
        if (seen.has(dupKey)) continue;
        seen.add(dupKey);
        items.push({
          type: cat.repeatable ? 'entry' : 'field',
          fieldKey: m.fieldKey, catId, key: base.split('.')[1],
          pageValue: c.value, state, confidence: m.confidence, level: m.level,
          label: ctx.labelText || c.placeholder || c.name || c.label || '未知字段',
          selector: c.selector, module: c.module, rowGroup: c.rowGroup,
          frame: c.frame, display: c.display,
        });
        continue;
      }

      // 未匹配 → 智能收录为自定义字段
      const labelText = ctx.labelText || c.placeholder || c.name || '';
      const key = labelText ? FZ.normalize(labelText).slice(0, 20) : '';
      if (key && key.length >= 2) {
        const existing = (profile.data.custom || []).find((x) => x.key === key);
        const state = existing ? (String(existing.value) === c.value ? 'same' : 'diff') : 'new';
        const dupKey = 'c|' + key + '|' + c.value;
        if (!seen.has(dupKey)) {
          seen.add(dupKey);
          items.push({
            type: 'custom', fieldKey: 'custom.' + key, key,
            pageValue: c.value, state, confidence: 45, level: 'fallback',
            label: labelText.slice(0, 20), selector: c.selector,
            module: c.module, rowGroup: c.rowGroup, frame: c.frame, display: c.display,
          });
        }
      }
    }
    return items;
  }

  // 空字段格式捕获: 扫描页面为空的表单字段, 提取 标签/类型/选项 收录为自定义字段
  // 与「已填值捕获」并存: 已填捕获识别填写好的内容; 格式捕获把空字段的"格式"记入信息库, 有空再填
  async function collectEmptyFields(profile, opts) {
    const o = opts || {};
    const FZ = AS.fuzzy;
    const fields = AS.scanner.scan();
    const customs = (profile && profile.data && Array.isArray(profile.data.custom)) ? profile.data.custom : [];
    const items = [];
    const seen = new Set();
    const IGNORE_LABELS = /^(请选择|选择|请填入|请填写|请输入|姓名|手机号|邮箱|性别|出生日期|毕业院校)$/;

    for (const field of fields) {
      try {
        const el = field.el;
        // 有值字段 → 交给已填捕获, 格式捕获只收空字段
        const v = getValue(field);
        if (v && v.value && String(v.value).trim()) continue;
        const ctx = AS.matcher.buildContext(el);
        if (!ctx.visible || ctx.readonly) continue;
        // 开放题不收录格式
        if (AS.matcher.isOpenQuestionField(ctx)) continue;
        // 已能匹配库字段 → 无需收录(库已有该格式)
        const m = AS.matcher.matchForCapture(ctx, el, { memories: null, rule: o.rule, profile, aliases: null });
        if (m) continue;
        // 标签提取(去"请输入/请选择"前缀与星号)
        const labelText = String(ctx.labelText || ctx.placeholder || ctx.prevText || '').replace(/\s+/g, ' ').trim();
        const clean = labelText.replace(/^(请输入|请填写|请选择|请填入)/, '').replace(/\*+$/, '').trim().slice(0, 20);
        if (!clean || clean.length < 2 || IGNORE_LABELS.test(clean)) continue;
        // 国际区号前缀框(如 +86)不收录
        if (/^\+?\d{1,4}$/.test(clean)) continue;
        const key = FZ.normalize(clean).slice(0, 20);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // 库中已有同名自定义字段 → 跳过
        if (customs.some((x) => x.key === key || (x.label && FZ.normalize(x.label) === FZ.normalize(clean)))) continue;
        // 选项/类型
        let options = [];
        if (field.type === 'select' && Array.isArray(field.options)) {
          options = field.options.filter((x) => x && x.text).map((x) => x.text);
        } else if (field.type === 'radio' && Array.isArray(field.group)) {
          options = field.group.map((g) => g.value).filter((x) => x);
        }
        items.push({
          type: 'custom', fieldKey: 'custom.' + key, key,
          pageValue: '', state: 'new', confidence: 50, level: 'format',
          label: clean, options, ctype: field.type,
          selector: genSelectorWithPath(el), module: detectModule(el), frame: 'top',
        });
      } catch (e) { /* ignore */ }
    }
    return items;
  }

  // 三态判定: 一致 / 差异 / 新增
  function triState(profile, fieldKey, pageValue) {
    const vals = AS.matcher.resolveValues(profile, fieldKey);
    if (!vals.length) return 'new';
    if (vals.includes(pageValue)) return 'same';
    return 'diff';
  }

  AS.capture = {
    captureAll: async () => {
      try { ignoreCache = await AS.storage.getCaptureIgnore(); } catch (e) { ignoreCache = { keywords: [], exact: [] }; }
      const builtin = (ignoreCache && ignoreCache.keywords) || [];
      ignoreCache = (ignoreCache && ignoreCache.exact) ? builtin.concat(ignoreCache.exact) : builtin;
      ignoreCache = ignoreCache.map((k) => String(k).toLowerCase());
      const r = await captureAll();
      ignoreCache = null;
      return r;
    },
    collect, collectEmptyFields, triState,
    getValue, genSelectorWithPath, detectModule, rowGroupOf,
  };
})();
