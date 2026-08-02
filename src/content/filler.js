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
    '是': ['是', '是的', '愿意', '服从', '同意', '参加', '有', '可以', '会', '有海外经历', '是，愿意'],
    '否': ['否', '不是', '不愿意', '没有', '无', '不可以', '不会', '无海外经历', '否，不愿意'],
    '汉族': ['汉族', '汉', 'han'],
  };

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // 核心: 绕过框架的 value 写入(兼容 React 受控组件)
  // 补全完整原生事件流: focus → keydown → input → keyup → change → blur
  // 确保 React/Vue 校验与数据绑定 100% 触发
  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    // React 17+: 同步 value tracker, 欺骗 React 认为值由用户输入产生(onChange 才会触发)
    try {
      if (el._valueTracker && typeof el._valueTracker.setValue === 'function') {
        el._valueTracker.setValue(String(el.value));
      }
    } catch (e) { /* ignore */ }
    setter.call(el, value);
    // 完整事件序列(模拟真人输入)
    try {
      if (typeof el.focus === 'function') el.focus();
      el.dispatchEvent(new Event('focus', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(value), inputType: 'insertText' }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch (e) { /* 个别环境事件构造失败时降级 */ }
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
    // 日期型选项(如毕业年份/月份)
    if (!hit && AS.dates && AS.dates.parseDateStr(String(value))) {
      const dv = AS.dates.parseDateStr(String(value));
      hit = FUZZY().closest(AS.dates.formatDate(dv, 'yyyy'), candidates, { minScore: 0.5 }) ||
            FUZZY().closest(AS.dates.formatDate(dv, 'yyyy-mm'), candidates, { minScore: 0.5 }) ||
            (dv.m ? FUZZY().closest(String(dv.m), candidates, { minScore: 0.5 }) : null) ||
            (dv.y ? FUZZY().closest(String(dv.y), candidates, { minScore: 0.5 }) : null);
    }
    if (!hit) return false;
    el.value = opts[hit.index].value;
    // 完整事件序列
    try { if (typeof el.focus === 'function') el.focus(); } catch (e) { /* ignore */ }
    el.dispatchEvent(new Event('focus', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
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
      // 用 innerText 保留换行(UEditor/TinyMCE 等富文本编辑器兼容)
      el.innerText = String(value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }
    return false;
  }

  // 手机号格式适配: 目标框带分隔占位(如 xxx-xxxx-xxxx)时转 3-4-4
  function adaptPhoneFormat(el, value) {
    const v = String(value || '');
    const digits = v.replace(/\D/g, '');
    if (!/^1\d{10}$/.test(digits)) return v;
    const ph = (el && (el.placeholder || '')) || '';
    const ctx = ((el && (el.className || '')) + ' ' + (el && el.name ? el.name : '') + ' ' + ph).toLowerCase();
    if (ph.includes('-') || /xxx|___|---/.test(ph) || (ctx.includes('phone') && (ctx.includes('-') || ctx.includes('_')))) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }
    if (/86[- ]/.test(ph)) return '+86 ' + digits;
    return v;
  }

  // 中英文标点自动适配: 目标输入框为英文环境(placeholder 纯英文)时, 中文标点转英文
  function adaptPunctuation(el, value) {
    const ph = (el && (el.placeholder || '')) || '';
    if (!ph || !/^[\x00-\x7F\s]*$/.test(ph)) return value;
    if (!/[，。、；：！？（）""'']/.test(value)) return value;
    return String(value)
      .replace(/，/g, ', ').replace(/。/g, '. ').replace(/、/g, ', ')
      .replace(/；/g, '; ').replace(/：/g, ': ').replace(/！/g, '! ').replace(/？/g, '? ')
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/"/g, '"').replace(/"/g, '"').replace(/'/g, "'").replace(/'/g, "'");
  }

  // 长度自适应截断
  function truncateFor(el, value) {
    const max = el && typeof el.maxLength === 'number' ? el.maxLength : 0;
    if (max > 0 && String(value).length > max) {
      return { value: String(value).slice(0, max), truncated: true, max };
    }
    return { value, truncated: false };
  }

  // 下拉窗口选择: 打开选项层(点击触发), 轮询等待选项, 模糊匹配目标值后点击
  // 支持 MOKA(sd-Select-common-item) / ElementUI / AntD / role=option 等
  async function fillPanelSelect(el, value) {
    const target = String(value || '');
    if (!target) return false;
    try {
      // 1. 打开选项层
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(500);
      // 2. 轮询: 可见层内匹配选项
      for (let i = 0; i < 10; i++) {
        let panel = null;
        document.querySelectorAll('[class*="Dropdown-dropdown"],[class*="select-dropdown"],[class*="picker-dropdown"],[class*="dropdown-menu"]').forEach((p) => {
          if (panel) return;
          const r = p.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) panel = p;
        });
        if (panel) {
          let hit = null, bestScore = 0;
          const items = panel.querySelectorAll('[class*="common-item"],[class*="option"],[role="option"],[class*="menu-item"],[class*="item"]');
          items.forEach((it) => {
            if (it.children.length > 4) return;
            const t = (it.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t || t.length > 30) return;
            const r2 = FUZZY().closest(target, [t], { minScore: 0.7, aliases: VALUE_ALIASES[target] ? { [target]: VALUE_ALIASES[target] } : undefined });
            if (r2 && r2.score > bestScore) { bestScore = r2.score; hit = it; }
          });
          if (hit) {
            hit.scrollIntoView({ block: 'center' });
            await sleep(80);
            hit.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            hit.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await sleep(250);
            return true;
          }
          // 层出现但无匹配(如"暂无选项"): 停止轮询
          if (/暂无|没有找到|无数据/.test(panel.textContent || '')) break;
        }
        await sleep(300);
      }
      dismissOverlays();
      return false;
    } catch (e) { return false; }
  }

  // 关闭残留弹层(Escape 键 + 失焦), 避免遮挡页面
  function dismissOverlays() {
    try {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const esc = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true });
      document.dispatchEvent(esc);
      document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));
    } catch (e) { /* ignore */ }
  }

  // 自定义下拉组件(ElementUI / AntD / 原生角色 / MOKA 搜索式学校专业)
  async function fillCustom(el, custom, value) {
    const root = custom || el;
    // 尝试输入
    const input = root.querySelector ? root.querySelector('input:not([type="hidden"]),textarea') : null;
    if (input) {
      if (input.readOnly) {
        // 只读输入框: 打开下拉窗口从选项中选择
        const okP = await fillPanelSelect(input, String(value));
        if (okP) return true;
      } else {
        setNativeValue(input, String(value));
        input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(150);
        // 输入未生效(受控组件拦截) → 打开下拉窗口选择
        if (String(input.value) !== String(value)) {
          const okP = await fillPanelSelect(input, String(value));
          if (okP) return true;
          dismissOverlays();
          return true;
        }
      }
      // 搜索式下拉(学校/专业/城市): 输入后异步出结果, 轮询等待匹配项
      let best = null, bestScore = 0;
      for (let i = 0; i < 8 && !best; i++) {
        await sleep(250);
        const items = document.querySelectorAll('[role="option"],[role="listbox"] li,[role="listbox"] [class*="option"],.el-select-dropdown__item,.ant-select-item-option,[class*="dropdown"] li,[class*="select"] [class*="item"],[class*="dropdown-menu"] [class*="item"],[class*="option-item"],[class*="list-item"]');
        items.forEach((it) => {
          const t = it.textContent || '';
          const hit = FUZZY().closest(String(value), [t], { minScore: 0.6, aliases: VALUE_ALIASES[String(value)] ? { [value]: VALUE_ALIASES[String(value)] } : undefined });
          if (hit && hit.score > bestScore) { bestScore = hit.score; best = it; }
        });
        // 菜单已消失(组件自关闭)则停止轮询
        if (!items.length && document.querySelector('[class*="dropdown"], [class*="select-dropdown"]')) break;
      }
      if (best) {
        best.scrollIntoView({ block: 'center' });
        await sleep(80);
        best.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        best.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        best.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(200);
        return true;
      }
      // 无匹配项: 保留已输入文本并关闭残留菜单
      dismissOverlays();
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

  // 年月面板日期组件(MOKA/北森 sd- 系列: 左箭头/年文本/右箭头 + 十二个月表格)
  // trigger: 只读 input; ym: 'YYYY-MM'
  async function fillYearMonthPanel(trigger, ym) {
    const mt = String(ym).match(/^(\d{4})-(\d{1,2})/);
    if (!mt) return false;
    const targetY = parseInt(mt[1], 10);
    const targetM = parseInt(mt[2], 10);
    const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
    try {
      // 1. 打开面板
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(600);
      // 2. 找可见面板
      let panel = null;
      document.querySelectorAll('[class*="Dropdown-dropdown"],[class*="picker-panel"],[class*="picker-dropdown"]').forEach((p) => {
        if (panel) return;
        const r = p.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) panel = p;
      });
      if (!panel) return false;
      // 3. 年份: 解析当前年, 点箭头直到匹配
      const yearEl = panel.querySelector('[class*="basic-selector-year"], [class*="select-year"], [class*="picker-year"]');
      if (!yearEl) return false;
      const curYear = () => parseInt((yearEl.textContent || '').replace(/\D/g, ''), 10) || 0;
      let guard = 0;
      while (curYear() !== targetY && guard < 80) {
        const cls = curYear() < targetY ? 'icondoubleRight' : 'icondoubleLeft';
        const arrow = panel.querySelector('[class*="' + cls + '"], [class*="next-year"], [class*="prev-year"]');
        if (!arrow) break;
        arrow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await sleep(160);
        guard++;
      }
      if (curYear() !== targetY) return false;
      // 4. 月份: 点月份项
      let hit = null;
      panel.querySelectorAll('[class*="year-item"],[class*="month-item"],[class*="cell"],li').forEach((it) => {
        if (!hit && (it.textContent || '').trim() === MONTHS[targetM - 1]) hit = it;
      });
      if (!hit) return false;
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await sleep(300);
      return true;
    } catch (e) { return false; }
  }

  // 证件照自动上传(DataTransfer 赋值, 部分站点受限则报 infos)
  async function fillFileUpload(el, dataUrl) {
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // 简历文件自动上传(文件存于本地 IndexedDB, 经后台中转)
  async function fillResumeFile(el) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'AF_GET_RESUME_FILE' });
      if (!r || !r.found || !r.data) return false;
      const file = new File([r.data], r.name || 'resume.pdf', { type: r.type || 'application/pdf' });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.files = dt.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // 终极降级: execCommand 原生输入(触发浏览器级 input 事件, React/Vue/自研框架均能感知)
  async function insertTextFallback(el, text) {
    try {
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, '');
      if (typeof el.setSelectionRange === 'function') el.setSelectionRange(0, 0);
      const ok = document.execCommand('insertText', false, String(text));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return ok && String(el.value) === String(text);
    } catch (e) {
      return false;
    }
  }

  // 主填充函数
  // field: scanner 产出的字段; value: 字符串值; opts: {typing, typingMin, typingMax, conflictMode, photoDataUrl}
  // 返回: {ok: bool, action: 'filled'|'skipped'|'info', detail}
  async function fillField(field, value, opts) {
    const o = opts || {};
    const el = field.el;
    const type = field.type;

    // 文件框: 已配置证件照则尝试自动上传
    if (type === 'file') {
      if (o.photoDataUrl) {
        const ok = await fillFileUpload(el, o.photoDataUrl);
        return ok
          ? { ok: true, action: 'filled', detail: '证件照已自动上传' }
          : { ok: false, action: 'info', detail: '上传受限, 请手动上传证件照' };
      }
      return { ok: false, action: 'info', detail: '未配置证件照, 需手动上传' };
    }
    if (el.disabled) return { ok: false, action: 'skipped', detail: '字段禁用' };
    // 只读组件(如 MOKA 自定义下拉): 走组件点击路径, 不当作普通只读跳过
    if (el.readOnly && type !== 'select' && !field.readonlyComponent) {
      return { ok: false, action: 'skipped', detail: '只读字段' };
    }

    const hasValue = type === 'checkbox' ? el.checked : !!(el.value && String(el.value).trim());
    if (hasValue && o.conflictMode !== 'overwrite') {
      return { ok: true, action: 'skipped', detail: '已有内容, 已跳过' };
    }

    try {
      switch (type) {
        case 'text': {
          // 只读组件(自定义下拉/日期组件): 尝试弹层点击 + 输入
          if (el.readOnly) {
            // 日期组件(出生日期/生日等年月面板): 点箭头切年 + 选月
            if (/(出生日期|生日|出生年月|日期)/.test(el.placeholder || '')) {
              const d = AS.dates.parseDateStr(String(value));
              if (d) {
                const ok = await fillYearMonthPanel(el, AS.dates.formatDate(d, 'yyyy-mm'));
                if (ok) return { ok: true, action: 'filled', detail: '日期面板选择完成' };
              }
            }
            // 其他只读下拉: 打开下拉窗口选择
            const okP = await fillPanelSelect(el, String(value));
            if (okP) return { ok: true, action: 'filled', detail: '下拉选项选择完成' };
            const ok = await fillCustom(el, el, value);
            if (ok) return { ok: true, action: 'filled', detail: '组件选择完成' };
            // 兜底: 直接写值并触发事件(部分框架可接受)
            try {
              setNativeValue(el, String(value));
              return { ok: true, action: 'filled' };
            } catch (e) {
              return { ok: false, action: 'unmatched', detail: '只读组件无法写入' };
            }
          }
          // 验证码字段绝不填充
          if (/(验证码|图形码|校验码|captcha|verify)/i.test(((el.placeholder || '') + ' ' + (el.name || '') + ' ' + (el.className || '')).replace(/(滑块|滑动)/g, ''))) {
            return { ok: false, action: 'info', detail: '验证码字段, 请手动填写' };
          }
          // 下拉选择型(placeholder=请选择 等): 打开下拉窗口从选项中选择
          if (/^请选择/.test(String(el.placeholder || '').trim())) {
            const okP = await fillPanelSelect(el, String(value));
            if (okP) return { ok: true, action: 'filled', detail: '下拉选项选择完成' };
          }
          let target = String(value || '');
          const fmt = adaptPhoneFormat(el, target);
          target = adaptPunctuation(el, fmt);
          const tr = truncateFor(el, target);
          target = tr.value;
          if (o.typing) { await simulateTyping(el, target, o.typingMin || 30, o.typingMax || 120); }
          else {
            setNativeValue(el, target);
            // 受控组件校验: 值未真正生效时逐级降级(逐字模拟 → execCommand 原生输入)
            if (target && String(el.value) !== target) {
              await simulateTyping(el, target, 15, 45);
              if (String(el.value) !== target) {
                await insertTextFallback(el, target);
              }
            }
          }
          return tr.truncated
            ? { ok: true, action: 'filled', detail: `已按长度限制截断为 ${tr.max} 字` }
            : { ok: true, action: 'filled' };
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
          if (ok) {
            // 级联选择器联动: 省份/城市等选择后等待动态加载下级选项
            await sleep(220);
          }
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

  AS.filler = { fillField, setNativeValue, fillSelect, fillFileUpload, fillResumeFile, insertTextFallback, VALUE_ALIASES };
})();
