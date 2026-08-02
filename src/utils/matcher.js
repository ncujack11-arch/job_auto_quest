/**
 * matcher.js — 表单字段识别与信息库字段匹配引擎
 * 多维度信号: label / name / placeholder / id / aria / data-* / 相邻文本
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.matcher) return;

  const FUZZY = () => AS.fuzzy;
  const SCHEMA = () => AS.schema;

  // ---------- 元素上下文提取 ----------
  function cleanText(s, maxLen) {
    if (!s) return '';
    return String(s).replace(/\s+/g, ' ').trim().slice(0, maxLen || 40);
  }

  function buildContext(el) {
    const ctx = {
      tag: el.tagName.toLowerCase(),
      type: (el.type || '').toLowerCase(),
      name: el.name || '',
      id: el.id || '',
      placeholder: el.placeholder || '',
      ariaLabel: el.getAttribute && (el.getAttribute('aria-label') || ''),
      dataTexts: [],
      labelText: '',
      rowText: '',
      prevText: '',
      disabled: el.disabled || false,
      readonly: el.readOnly || false,
      hidden: false,
      visible: true,
    };

    // data-* 属性(常见自定义绑定)
    if (el.getAttribute) {
      ['data-field', 'data-name', 'data-key', 'data-label', 'data-bind', 'data-id', 'data-fieldname', 'data-property'].forEach((a) => {
        const v = el.getAttribute(a);
        if (v) ctx.dataTexts.push(v);
      });
    }

    // 关联 label
    try {
      if (el.labels && el.labels.length) {
        ctx.labelText = cleanText(Array.from(el.labels).map((l) => l.textContent).join(' '), 30);
      }
    } catch (e) { /* ignore */ }
    if (!ctx.labelText && el.id) {
      const lbl = el.ownerDocument && el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) ctx.labelText = cleanText(lbl.textContent, 30);
    }
    if (!ctx.labelText && el.getAttribute) {
      const alb = el.getAttribute('aria-labelledby');
      if (alb) {
        const t = alb.split(/\s+/).map((id) => {
          const n = el.ownerDocument && el.ownerDocument.getElementById(id);
          return n ? n.textContent : '';
        }).join(' ');
        ctx.labelText = cleanText(t, 30);
      }
    }
    if (!ctx.labelText && el.getAttribute && el.getAttribute('aria-label')) {
      ctx.labelText = cleanText(el.getAttribute('aria-label'), 30);
    }

    // 包裹 label(标签包 input 的情况)
    if (!ctx.labelText) {
      let p = el.parentElement;
      for (let i = 0; i < 2 && p; i++, p = p.parentElement) {
        if (p.tagName === 'LABEL') { ctx.labelText = cleanText(p.textContent, 30); break; }
      }
    }

    // 所在行/单元格文本(去 label 噪音)
    let row = el.closest && el.closest('.form-item,.form-group,.form-row,.el-form-item,.ant-form-item,.field,.row,.form-field,.form-control-wrap,li,tr,td,label');
    if (row && row.textContent) {
      const rowText = cleanText(row.textContent, 60);
      if (rowText && !ctx.labelText.includes(rowText.slice(0, 10))) ctx.rowText = rowText;
    }
    // 兜底: 向上找最近"合理文本容器"(MOKA/自研组件化表单, class 结构未知时也能拿到标签)
    if (!ctx.rowText) {
      let p = el.parentElement;
      for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
        const tag = p.tagName;
        if (tag === 'BODY' || tag === 'HTML' || tag === 'FORM') break;
        const txt = cleanText(p.textContent, 50);
        if (txt && txt.length >= 2 && txt.length <= 40 && !txt.includes(String(el.value || '').slice(0, 5))) {
          ctx.rowText = txt;
          break;
        }
      }
    }

    // 前一兄弟文本
    const prev = el.previousElementSibling;
    if (prev && !prev.matches('input,textarea,select,button')) {
      ctx.prevText = cleanText(prev.textContent, 20);
    }
    // 上一单元格文本
    if (!ctx.prevText && el.parentElement && el.parentElement.previousElementSibling) {
      ctx.prevText = cleanText(el.parentElement.previousElementSibling.textContent, 20);
    }
    // 兜底: 逐层向上找前兄弟容器文本(组件化表单的 label 常在 input 容器的前兄弟内)
    if (!ctx.prevText) {
      let p = el.parentElement;
      for (let i = 0; i < 3 && p; i++, p = p.parentElement) {
        if (p.previousElementSibling) {
          const t = cleanText(p.previousElementSibling.textContent, 16);
          if (t && t.length >= 2 && t.length <= 12 && !/\d{6,}/.test(t)) { ctx.prevText = t; break; }
        }
        // 容器第一个子元素可能是标签(如 MOKA sd-Input 组件: label 是输入容器前的独立节点)
        if (p.firstElementChild && p.firstElementChild !== el) {
          const t = cleanText(p.firstElementChild.textContent, 16);
          if (t && t.length >= 2 && t.length <= 10 && !/^\d+$/.test(t) && !/\d{6,}/.test(t)) { ctx.prevText = t; break; }
        }
      }
    }

    // 可见性
    ctx.hidden = el.hidden === true || el.getAttribute('type') === 'hidden';
    const style = el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle(el);
    if (style) ctx.visible = style.display !== 'none' && style.visibility !== 'hidden';
    else ctx.visible = !ctx.hidden;

    return ctx;
  }

  // 供站点映射使用的字段签名(匹配 mapping key)
  function signatureOf(ctx) {
    return [
      ctx.name ? ctx.name : '',
      ctx.id ? ctx.id : '',
      ctx.labelText ? FUZZY().normalize(ctx.labelText) : '',
      ctx.placeholder ? FUZZY().normalize(ctx.placeholder) : '',
    ].filter(Boolean);
  }

  // ---------- 匹配 ----------
  const KEYWORD_WEIGHTS = { labelText: 6, placeholder: 4, ariaLabel: 4, name: 3, dataTexts: 3, id: 2, prevText: 2, rowText: 1 };
  const MATCH_THRESHOLD = 4;

  // 站点映射命中
  function matchMapping(ctx, rule) {
    if (!rule || !rule.mapping) return null;
    const sigs = signatureOf(ctx);
    const entries = Object.entries(rule.mapping);
    if (!sigs.length || !entries.length) return null;
    // 优先级: name > id > label > placeholder
    for (let si = 0; si < Math.min(2, sigs.length); si++) {
      const s = sigs[si];
      for (const [k, v] of entries) {
        const nk = FUZZY().normalize(k);
        if (!nk) continue;
        if (s === nk || s.includes(nk) || nk.includes(s)) {
          return { fieldKey: v, score: 99, confidence: 'high', via: 'site-mapping' };
        }
      }
    }
    return null;
  }

  function matchSchema(ctx) {
    const fz = FUZZY();
    const schema = SCHEMA();
    // 特殊强信号
    if (ctx.type === 'email') return { fieldKey: 'basic.email', score: 99, confidence: 'high', via: 'type' };
    if (ctx.type === 'tel') {
      if (fz.containsAny(ctx.labelText + ctx.placeholder + ctx.name, ['紧急', 'emergency'])) {
        return { fieldKey: 'basic.emergencyPhone', score: 30, confidence: 'high', via: 'type' };
      }
      return { fieldKey: 'basic.phone', score: 15, confidence: 'medium', via: 'type' };
    }
    const allText = `${ctx.labelText} ${ctx.placeholder} ${ctx.ariaLabel} ${ctx.name} ${ctx.id} ${ctx.dataTexts.join(' ')} ${ctx.prevText}`;
    if (/(身份证|证件号码|证件号|idcard|identity)/i.test(allText) && !/紧急|contact|emergency/.test(allText)) {
      return { fieldKey: 'basic.idCard', score: 99, confidence: 'high', via: 'regex' };
    }
    if (/(出生日期|生日|出生年月)/.test(allText)) {
      return { fieldKey: 'basic.birthday', score: 99, confidence: 'high', via: 'regex' };
    }

    // 下拉框特殊推断: 性别 / 学历
    if (ctx.tag === 'select' || ctx.tag === 'input') {
      const opts = ctx.tag === 'select' ? Array.from(ctx.ownerDocument ? ctx.ownerDocument.querySelectorAll(`select[name="${CSS.escape(ctx.name)}"] option`) : []).map((o) => o.textContent) : [];
      if (opts.length) {
        const joined = opts.join(' ');
        if (/^[男女性别]+$/.test(joined.replace(/\s/g, '')) || (joined.includes('男') && joined.includes('女') && joined.length < 10)) {
          return { fieldKey: 'basic.gender', score: 40, confidence: 'high', via: 'options' };
        }
        if (/(博士|硕士|本科|大专|学士)/.test(joined)) {
          return { fieldKey: 'education[0].degree', score: 30, confidence: 'medium', via: 'options' };
        }
        if (/(中共党员|共青团员|群众)/.test(joined)) {
          return { fieldKey: 'basic.politicalStatus', score: 40, confidence: 'high', via: 'options' };
        }
      }
    }

    // 关键词匹配
    let best = null;
    for (const [fieldKey, def] of Object.entries(schema.FLAT)) {
      if (!def.kw || !def.kw.length) continue;
      let score = 0;
      const hits = [];
      // 标签来源: labelText 优先; 缺失时从行文本前缀提取(MOKA/自研系统标签在父容器文本, 如 "姓名*请输入姓名")
      const effectiveLabel = ctx.labelText || (ctx.rowText ? String(ctx.rowText).split(/[\s*:：|｜]/)[0].slice(0, 12) : '');
      // labelText 优先: 命中关键词越长越具体, 权重越高
      if (effectiveLabel) {
        const nl = fz.normalize(effectiveLabel);
        let bestKwLen = 0;
        for (const k of def.kw) {
          const nk = fz.normalize(k);
          if (nk && nl.includes(nk)) bestKwLen = Math.max(bestKwLen, nk.length);
        }
        if (bestKwLen) {
          score += Math.min(10, 3 + bestKwLen * 1.2);
          hits.push(ctx.labelText ? 'label' : 'row-label');
          // label 与字段名完全一致时再加权, 解决同分冲突
          if (nl === fz.normalize(def.label)) score += 4;
        }
      }
      if (ctx.placeholder && fz.containsAny(ctx.placeholder, def.kw)) { score += 4; hits.push('placeholder'); }
      if (ctx.ariaLabel && fz.containsAny(ctx.ariaLabel, def.kw)) { score += 4; hits.push('aria'); }
      if (ctx.name && fz.containsAny(ctx.name, def.kw)) { score += 3; hits.push('name'); }
      if (ctx.dataTexts.length && ctx.dataTexts.some((d) => fz.containsAny(d, def.kw))) { score += 3; hits.push('data'); }
      if (ctx.id && fz.containsAny(ctx.id, def.kw)) { score += 2; hits.push('id'); }
      if (ctx.prevText && fz.containsAny(ctx.prevText, def.kw)) { score += 2; hits.push('prev'); }
      if (ctx.rowText && fz.containsAny(ctx.rowText, def.kw)) { score += 1; hits.push('row'); }
      if (score === 0) continue;
      if (!best || score > best.score) best = { fieldKey, score, hits };
    }
    if (!best || best.score < MATCH_THRESHOLD) return null;

    const score = best.score;
    const confidence = score >= 12 ? 'high' : score >= 8 ? 'medium' : 'low';
    return { fieldKey: best.fieldKey, score, confidence, via: 'keyword' };
  }

  // 主入口: 返回 {fieldKey, score, confidence, via} 或 null
  function matchField(ctx, rule) {
    const m = matchMapping(ctx, rule);
    if (m) return m;
    return matchSchema(ctx);
  }

  // ---------- 值解析 ----------
  // 根据 fieldKey 从方案中取候选值数组(可重复分类返回多值)
  function resolveValues(profile, fieldKey) {
    if (!profile || !profile.data) return [];
    const base = fieldKey.replace(/\[\d+\]/g, '');
    const parts = base.split('.');
    const catId = parts[0], field = parts[1];
    const data = profile.data;
    const cat = SCHEMA().findCategory(catId);
    if (!cat || !data) return [];

    // 自定义字段(需在 repeatable 分支之前, 因为 custom 分类本身是 repeatable)
    if (catId === 'custom') {
      const list = Array.isArray(data.custom) ? data.custom : [];
      const targetKey = fieldKey.startsWith('custom.') ? fieldKey.slice('custom.'.length) : fieldKey;
      const fz = FUZZY();
      return list
        .filter((c) => c && (fz.normalize(c.key) === fz.normalize(targetKey) || (c.label && fz.normalize(c.label) === fz.normalize(targetKey))))
        .map((c) => c.value)
        .filter((v) => v);
    }
    if (cat.repeatable) {
      const list = Array.isArray(data[catId]) ? data[catId] : [];
      if (catId === 'openQuestions') return list; // 特殊处理
      return list.map((item) => (item && item[field]) || '').filter((v) => v !== '' && v !== undefined && v !== null);
    }
    const v = data[catId] ? data[catId][field] : undefined;
    return v === undefined || v === null || v === '' ? [] : [String(v)];
  }

  // 自定义字段匹配: 学习模式自动收录的字段(key/label 作为关键词)参与后续填充
  function matchCustomField(ctx, profile) {
    const customs = (profile && profile.data && Array.isArray(profile.data.custom)) ? profile.data.custom : [];
    if (!customs.length) return null;
    const text = (ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name + ' ' + ctx.id).trim();
    if (!text) return null;
    const fz = FUZZY();
    for (const c of customs) {
      if (!c || c.value === undefined || c.value === null || String(c.value).trim() === '') continue;
      const kw = [c.key, c.label].filter(Boolean);
      if (!kw.length) continue;
      if (fz.containsAny(text, kw)) {
        return { fieldKey: 'custom.' + c.key, score: 50, confidence: 'high', via: 'custom' };
      }
    }
    return null;
  }

  // 开放题匹配: 在开放题库中找与表单字段语义最接近的问题答案
  // 场景标签加权: 答案带 tags(如 公司认知/职业规划/自我介绍)时按表单场景加权
  const OPEN_SCENES = [
    { kw: ['公司', '贵司', '贵公司', '加入我们', '选择我们', '本公司'], tag: '公司认知' },
    { kw: ['规划', '发展', '未来'], tag: '职业规划' },
    { kw: ['介绍', '评价', '描述', '自我介绍'], tag: '自我介绍' },
    { kw: ['缺点', '优点', '优势', '劣势'], tag: '优缺点' },
    { kw: ['行为', '宝洁', '团队', '冲突', '领导力', '困难'], tag: '行为面' },
  ];
  function resolveOpenQuestion(profile, text) {
    if (!profile || !profile.data || !Array.isArray(profile.data.openQuestions)) return null;
    const fz = FUZZY();
    const nt = fz.normalize(text);
    if (!nt) return null;
    // 命中场景 → 期望标签
    const scene = OPEN_SCENES.find((s) => s.kw.some((k) => fz.normalize(k) && (nt.includes(fz.normalize(k)) || fz.normalize(k).includes(nt))));
    let best = null;
    profile.data.openQuestions.forEach((q, idx) => {
      if (!q || !q.answer) return;
      const nq = fz.normalize(q.question || '');
      let score = 0;
      if (nq && (nt.includes(nq) || nq.includes(nt))) score = 0.9;
      else if (nq) score = fz.similarity(nt, nq);
      // 模板关键词兜底
      const tpl = SCHEMA().OPEN_TEMPLATES.find((t) => t.kw.some((k) => fz.normalize(k) && (nt.includes(fz.normalize(k)) || fz.normalize(k).includes(nt))));
      if (tpl && !nq) score = Math.max(score, 0.7);
      // 场景标签加权
      if (scene && (q.tags || []).includes(scene.tag)) score += 0.15;
      if (score > 0.55 && (!best || score > best.score)) best = { index: idx, answer: q.answer, score };
    });
    return best ? best.answer : null;
  }

  // 开放题判断: 表单字段是否像开放性问题
  function isOpenQuestionField(ctx) {
    const text = `${ctx.labelText} ${ctx.placeholder} ${ctx.name} ${ctx.id}`;
    const fz = FUZZY();
    if (!text) return false;
    const nt = fz.normalize(text);
    if (nt.length < 2) return false;
    // 明确个人信息标签(整段仅为字段名) → 不是开放题
    if (/^(姓名|真实姓名|手机号|手机号码|联系电话|电话号码|联系手机|邮箱|电子邮箱|联系邮箱|家庭住址|通讯地址|户籍地址|证件号|身份证号|生日|出生日期|政治面貌|紧急联系人)$/.test(nt)) return false;
    // 开放题关键词命中
    if (/(为什么|如何|怎样|怎么|请|评价|介绍|规划|看法|理解|描述|谈谈|describe|why|how)/i.test(text)) {
      return true;
    }
    return false;
  }

  // 生成元素选择器(供选择器记忆使用)
  function genSelector(el) {
    try {
      if (!el) return '';
      if (el.id) return '#' + CSS.escape(String(el.id));
      const tag = el.tagName ? el.tagName.toLowerCase() : '';
      if (el.name && /^(input|textarea|select|button)$/.test(tag)) {
        return tag + '[name="' + String(el.name).replace(/"/g, '\\"') + '"]';
      }
      return '';
    } catch (e) { return ''; }
  }

  AS.matcher = { buildContext, signatureOf, matchField, matchCustomField, resolveValues, resolveOpenQuestion, isOpenQuestionField, genSelector, MATCH_THRESHOLD };
})();
