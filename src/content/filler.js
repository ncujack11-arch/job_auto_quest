/**
 * filler.js — 填充执行引擎
 * 支持: 原生值设置(兼容 React/Vue)、逐字模拟输入、下拉模糊匹配、日期格式自适应、
 *       单选/复选、富文本、自定义下拉组件
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.filler) return;

  const LOG = () => AS.logger;
  const FUZZY = () => AS.fuzzy;

  // 值同义词表(学历/性别等常见变体)
  const VALUE_ALIASES = {
    '本科': ['本科', '全日制本科', '大学本科', '本科学历', '本科(统招)', '学士', '学士学位', 'bachelor', '本科在读'],
    '硕士': ['硕士', '硕士研究生', '研究生', '全日制硕士', '硕士学位', 'master', '硕士在读'],
    '博士': ['博士', '博士研究生', '博士学位', 'phd', '博士在读'],
    '大专': ['大专', '专科', '大学专科', '高职', '专科在读'],
    '高中': ['高中', '普通高中', '中专', '中技'],
    '男': ['男', '男性', 'male', 'm'],
    '女': ['女', '女性', 'female', 'f'],
    '中共党员': ['中共党员', '中国共产党党员', '党员', '正式党员'],
    '共青团员': ['共青团员', '团员'],
    '应届毕业生': ['应届毕业生', '应届', '2025届', '2026届', '2027届'],
  };

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // 核心: 绕过框架的 value 写入
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // 逐字模拟输入
  async function simulateTyping(el, value, minMs, maxMs) {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
    const chars = Array.from(value);
    let current = '';
    setter.call(el, '');
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    for (const ch of chars) {
      current += ch;
      setter.call(el, current);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await sleep(minMs + Math.random() * (maxMs - minMs));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function fillSelect(el, value) {
    const opts = Array.from(el.options || []);
    if (!opts.length) return false;
    const candidates = opts.map((o) => o.textContent || o.value || '');
    const aliases = VALUE_ALIASES[String(value)] ? { [value]: VALUE_ALIASES[String(value)] } : undefined;
    let hit = FUZZY().closest(String(value), candidates, { minScore: 0.55, aliases });
    // 数字型选项(如排名 1-100)精确匹配
    if (!hit) {
      const idx = candidates.findIndex((c) => c.trim() === String(value).trim());
      if (idx >= 0) hit = { index: idx, value: candidates[idx], score: 1 };
    }
    // 日期型选项(如毕业年份)
    if (!hit && AS.dates && AS.dates.parseDateStr(String(value))) {
      const dv = AS.dates.parseDateStr(String(value));
      hit = FUZZY().closest(AS.dates.formatDate(dv, 'yyyy'), candidates, { minScore: 0.5 }) ||
            FUZZY().closest(AS.dates.formatDate(dv, 'yyyy-mm'), candidates, { minScore: 0.5 });
    }
    if (!hit) return false;
    el.value = opts[hit.index].value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }

  function fillRadio(group, value) {
    const fz = FUZZY();
    const vs = String(value);
    // 优先文本匹配, 再值匹配
    for (const r of group) {
      const label = (r.labels && r.labels[0] ? r.labels[0].textContent : '') || r.getAttribute('aria-label') || '';
      const text = (label || '') + ' ' + r.value;
      const hit = fz.closest(vs, [r.value, label].filter(Boolean), { minScore: 0.6 }) ||
                  (label && fz.closest(vs, [label], { minScore: 0.7 }));
      if (hit) {
        r.checked = true;
        r.dispatchEvent(new Event('click', { bubbles: true }));
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    // 兜底: 值完全相等
    const exact = group.find((r) => String(r.value) === vs);
    if (exact) { exact.checked = true; exact.dispatchEvent(new Event('click', { bubbles: true })); return true; }
    return false;
  }

  function fillCheckbox(el, value) {
    const v = String(value).trim().toLowerCase();
    const positive = /^(是|有|true|yes|1|同意|接受|确认|参加|愿意)$/.test(v);
    if (!positive) return false;
    if (!el.checked) {
      el.click();
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function fillRichText(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = String(value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }
    return false;
  }

  // 自定义下拉组件(ElementUI / AntD / 原生角色)
  async function fillCustom(el, custom, value) {
    const root = custom || el;
    // 尝试输入
    const input = root.querySelector ? root.querySelector('input:not([type="hidden"]),textarea') : null;
    if (input) {
      setNativeValue(input, String(value));
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // 输入后再尝试点击匹配项
      await sleep(120);
      const items = document.querySelectorAll('[role="option"],[role="listbox"] li,[role="listbox"] [class*="option"],.el-select-dropdown__item,.ant-select-item-option,[class*="dropdown"] li,[class*="select"] [class*="item"]');
      let best = null, bestScore = 0;
      items.forEach((it) => {
        const t = it.textContent || '';
        const hit = FUZZY().closest(String(value), [t], { minScore: 0.6, aliases: VALUE_ALIASES[String(value)] ? { [value]: VALUE_ALIASES[String(value)] } : undefined });
        if (hit && hit.score > bestScore) { bestScore = hit.score; best = it; }
      });
      if (best) {
        best.scrollIntoView({ block: 'center' });
        await sleep(80);
        best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        best.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        best.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }
      // 无匹配项时保留已输入文本
      return true;
    }
    // 无内部输入框: 直接尝试点击匹配项
    if (root.querySelector) {
      const items = Array.from(document.querySelectorAll('[role="option"],[class*="dropdown"] li,[class*="select"] [class*="item"]'));
      const hit = FUZZY().closest(String(value), items.map((i) => i.textContent), { minScore: 0.6 });
      if (hit) {
        items[hit.index].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }
    }
    return false;
  }

  // 主填充函数
  // field: scanner 产出的字段; value: 字符串值; opts: {typing, typingMin, typingMax, conflictMode}
  // 返回: {ok: bool, action: 'filled'|'skipped'|'info', detail}
  async function fillField(field, value, opts) {
    const o = opts || {};
    const el = field.el;
    const type = field.type;

    // 文件框无法程序赋值
    if (type === 'file') {
      return { ok: false, action: 'info', detail: '文件上传框需手动操作' };
    }
    if (el.disabled) return { ok: false, action: 'skipped', detail: '字段禁用' };
    if (el.readOnly && type !== 'select') return { ok: false, action: 'skipped', detail: '只读字段' };

    const hasValue = type === 'checkbox' ? el.checked : !!(el.value && String(el.value).trim());
    if (hasValue && o.conflictMode !== 'overwrite') {
      return { ok: true, action: 'skipped', detail: '已有内容, 已跳过' };
    }

    try {
      switch (type) {
        case 'text': {
          const target = String(value || '');
          if (o.typing) { await simulateTyping(el, target, o.typingMin || 30, o.typingMax || 120); }
          else { setNativeValue(el, target); }
          return { ok: true, action: 'filled' };
        }
        case 'textarea': {
          setNativeValue(el, String(value || ''));
          return { ok: true, action: 'filled' };
        }
        case 'date': {
          if (el.type === 'month') {
            const d = AS.dates.parseDateStr(String(value));
            if (!d) return { ok: false, action: 'unmatched', detail: '无法解析日期' };
            setNativeValue(el, AS.dates.formatDate(d, 'yyyy-mm'));
            return { ok: true, action: 'filled' };
          }
          if (el.type === 'date' || el.type === 'datetime-local') {
            const d = AS.dates.parseDateStr(String(value));
            if (!d) return { ok: false, action: 'unmatched', detail: '无法解析日期' };
            const iso = AS.dates.formatDate(d, 'iso');
            if (el.type === 'datetime-local') setNativeValue(el, `${iso}T00:00`);
            else setNativeValue(el, iso);
            return { ok: true, action: 'filled' };
          }
          const fmt = AS.dates.detectTargetFormat(el);
          const d = AS.dates.parseDateStr(String(value));
          if (!d) return { ok: false, action: 'unmatched', detail: '无法解析日期' };
          setNativeValue(el, AS.dates.formatDate(d, fmt));
          return { ok: true, action: 'filled' };
        }
        case 'select': {
          const ok = fillSelect(el, value);
          return ok ? { ok: true, action: 'filled' } : { ok: false, action: 'unmatched', detail: '下拉无匹配选项' };
        }
        case 'radio': {
          const ok = fillRadio(field.group, value);
          return ok ? { ok: true, action: 'filled' } : { ok: false, action: 'unmatched', detail: '单选无匹配项' };
        }
        case 'checkbox': {
          const ok = fillCheckbox(el, value);
          return ok ? { ok: true, action: 'filled' } : { ok: false, action: 'skipped', detail: '非肯定值, 未勾选' };
        }
        case 'richtext': {
          const ok = fillRichText(el, value);
          return ok ? { ok: true, action: 'filled' } : { ok: false, action: 'unmatched', detail: '富文本写入失败' };
        }
        case 'custom': {
          const ok = await fillCustom(el, field.custom, value);
          return ok ? { ok: true, action: 'filled' } : { ok: false, action: 'unmatched', detail: '自定义组件填充失败' };
        }
        default:
          return { ok: false, action: 'skipped', detail: `不支持的类型: ${type}` };
      }
    } catch (e) {
      LOG().error('filler', 'fill error', e);
      return { ok: false, action: 'error', detail: e.message || String(e) };
    }
  }

  AS.filler = { fillField, setNativeValue, fillSelect, VALUE_ALIASES };
})();
