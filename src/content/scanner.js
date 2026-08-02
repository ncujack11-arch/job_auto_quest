/**
 * scanner.js — 页面表单元素扫描器
 * 识别: 单行输入 / 多行文本 / 下拉 / 单选 / 复选 / 日期 / 文件 / 富文本 / 自定义下拉
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.scanner) return;

  const TEXT_TYPES = ['text', 'email', 'tel', 'number', 'search', 'url', 'password'];
  const DATE_TYPES = ['date', 'datetime-local', 'month', 'time', 'week'];
  const SKIP_TYPES = ['hidden', 'submit', 'button', 'reset', 'image', 'range', 'color'];

  function isVisibleEl(el) {
    if (el.hidden === true) return false;
    try {
      const st = el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle(el);
      if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
    } catch (e) { return true; }
    return true;
  }

  // 是否为常见表单容器内的元素(避免扫描无关输入)
  function inFormLikeContext(el) {
    let p = el.parentElement;
    for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
      if (p.tagName === 'FORM') return true;
      const cls = (p.className || '').toString() + ' ' + (p.id || '');
      if (/form|apply|resume|survey|question|input|field|step|panel/i.test(cls)) return true;
    }
    return true; // 默认视为表单元素
  }

  function collectOptions(sel) {
    return Array.from(sel.options || []).map((o) => ({ text: o.textContent || '', value: o.value, selected: o.selected }));
  }

  // 收集文档内全部元素(穿透 open Shadow DOM, 适配 Web Components 表单组件)
  function collectAllElements(root) {
    const elements = [];
    const walk = (r) => {
      if (!r || !r.querySelectorAll) return;
      const list = r.querySelectorAll('*');
      for (const el of list) {
        elements.push(el);
        if (el.shadowRoot && el.shadowRoot.mode === 'open') walk(el.shadowRoot);
      }
    };
    walk(root || document);
    return elements;
  }

  // 单选组: 按 name 分组, 每组返回一个 field
  function groupRadios(elements) {
    const groups = new Map();
    elements.forEach((r) => {
      if (r.tagName !== 'INPUT' || (r.type || '').toLowerCase() !== 'radio') return;
      if (!isVisibleEl(r) || !inFormLikeContext(r)) return;
      const key = r.name || r.id || ('r_' + r.value);
      if (!groups.has(key)) groups.set(key, { type: 'radio', elements: [] });
      groups.get(key).elements.push(r);
    });
    return Array.from(groups.values());
  }

  function scan() {
    const fields = [];
    const seen = new Set();
    const elements = collectAllElements(document);

    const handle = (el, type, extra) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      fields.push(Object.assign({ el, type }, extra || {}));
    };

    // 文本类输入
    elements.forEach((el) => {
      if (el.tagName !== 'INPUT') return;
      const t = (el.type || 'text').toLowerCase();
      if (SKIP_TYPES.includes(t)) return;
      if (!isVisibleEl(el) || el.disabled || el.readOnly) return;
      if (!inFormLikeContext(el)) return;
      if (TEXT_TYPES.includes(t)) {
        if (t === 'password') return; // 绝不处理密码框
        handle(el, 'text', { inputType: t });
      } else if (DATE_TYPES.includes(t)) {
        handle(el, 'date', { inputType: t });
      } else if (t === 'file') {
        handle(el, 'file');
      } else if (t === 'checkbox') {
        handle(el, 'checkbox');
      }
    });

    elements.forEach((el) => {
      if (el.tagName !== 'TEXTAREA') return;
      if (!isVisibleEl(el) || el.disabled || el.readOnly) return;
      if (!inFormLikeContext(el)) return;
      handle(el, 'textarea');
    });

    elements.forEach((el) => {
      if (el.tagName !== 'SELECT') return;
      if (!isVisibleEl(el) || el.disabled) return;
      if (!inFormLikeContext(el)) return;
      handle(el, 'select', { options: collectOptions(el) });
    });

    // 富文本 / 自定义下拉(避免与普通输入重复)
    elements.forEach((el) => {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      if (!isVisibleEl(el) || el.disabled) return;
      if (!inFormLikeContext(el)) return;
      const role = el.getAttribute && el.getAttribute('role');
      const tag = el.tagName.toLowerCase();
      if (role === 'combobox' || (tag === 'div' && el.querySelector && el.querySelector('input,textarea'))) {
        const inner = el.querySelector('input:not([type="hidden"]),textarea');
        if (inner) { handle(inner, 'text', { custom: el, customRole: 'combobox' }); return; }
        handle(el, 'custom', { customRole: 'combobox' });
      } else if (role === 'textbox' || el.isContentEditable) {
        handle(el, 'richtext');
      }
    });

    // 单选组(合并为一个字段)
    groupRadios(elements).forEach((g) => {
      const first = g.elements[0];
      if (!first) return;
      handle(first, 'radio', { group: g.elements });
    });

    return fields;
  }

  AS.scanner = { scan, collectAllElements };
})();
