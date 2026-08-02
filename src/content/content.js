/**
 * content.js — 内容脚本入口
 * 负责: 表单扫描 + 匹配 + 填充编排、页面信息抓取、投递检测联动、加密解锁协调
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.contentMain) return;

  const LOG = () => AS.logger;

  const frameLabel = () => (window.top === window ? 'top' : 'iframe');

  // 递归查找方案中是否含加密值
  function hasEncryptedValue(profile) {
    if (!profile || !profile.data) return false;
    try {
      return JSON.stringify(profile.data).includes('"enc:v1:');
    } catch (e) { return false; }
  }

  async function ensureUnlocked() {
    const settings = await AS.storage.getSettings();
    if (!settings.encryption || !settings.encryption.enabled) return true;
    const r = await chrome.runtime.sendMessage({ type: 'AF_IS_UNLOCKED' });
    return !!(r && r.unlocked);
  }

  async function unlockFlow() {
    return new Promise((resolve) => {
      AS.overlay.showUnlockPrompt(() => resolve(true), () => resolve(false));
    });
  }

  // ---------- 域名黑白名单 ----------
  function isSiteAllowed(host, filter) {
    if (!filter || !filter.mode || filter.mode === 'all') return true;
    const h = String(host || '').toLowerCase();
    const match = (list) => (list || []).some((d) => {
      const x = String(d).trim().toLowerCase().replace(/^\*\./, '');
      return x && (h === x || h.endsWith('.' + x));
    });
    if (filter.mode === 'blacklist') return !match(filter.blacklist);
    if (filter.mode === 'whitelist') return match(filter.whitelist);
    return true;
  }

  // ---------- 撤销快照 ----------
  function snapshotField(field) {
    const el = field.el;
    try {
      if (field.type === 'checkbox') {
        return { el, restore: () => { if (el.checked) { el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); } } };
      }
      if (field.type === 'radio') {
        const checked = (field.group || []).find((r) => r.checked);
        return {
          el: checked || field.group[0],
          restore: () => { if (checked) { checked.checked = true; checked.dispatchEvent(new Event('click', { bubbles: true })); } },
        };
      }
      if (field.type === 'select') {
        const oldValue = el.value;
        return { el, restore: () => { el.value = oldValue; el.dispatchEvent(new Event('change', { bubbles: true })); } };
      }
      const oldValue = el.value;
      return { el, restore: () => { AS.filler.setNativeValue(el, oldValue); } };
    } catch (e) { return null; }
  }

  // ---------- 字段快照恢复(撤销) ----------
  async function undoAll(snapshots) {
    for (const s of snapshots) {
      if (s && s.restore) {
        try { s.restore(); } catch (e) { /* ignore */ }
      }
    }
    AS.overlay.clearHighlights();
  }

  // ---------- 匹配计划构建 ----------
  // 返回 { items: [{field, fieldKey, value, label, ctx}], valueQueues, seenFields }
  // order: { catId: [entryIndex...] } 经历素材选择顺序; refCodes: 内推码库
  function buildPlan(fields, profile, rule, memories, reuseActive, sections, valueQueues, order, refCodes) {
    const items = [];
    const seenFields = new Set();
    const getValues = (fieldKey) => {
      const key = fieldKey.replace(/\[\d+\]/g, '');
      if (!valueQueues.has(key)) {
        let vals = AS.matcher.resolveValues(profile, fieldKey);
        const catId = key.split('.')[0];
        if (order && order[catId] && Array.isArray(order[catId])) {
          vals = order[catId].map((idx) => vals[idx]).filter((v) => v !== undefined && v !== null && v !== '');
        }
        valueQueues.set(key, vals);
      }
      return valueQueues.get(key);
    };
    const catAllowed = (fieldKey) => {
      if (!sections || !sections.length) return true;
      const catId = fieldKey.replace(/\[\d+\]/g, '').split('.')[0];
      return sections.includes(catId);
    };
    const matchRefCode = (list, host) => {
      const h = String(host || '').toLowerCase();
      const hit = (list || []).find((r) => r && r.host && h === r.host.toLowerCase());
      return hit ? hit.code : '';
    };

    for (const field of fields) {
      if (seenFields.has(field.el)) continue;
      seenFields.add(field.el);
      const ctx = AS.matcher.buildContext(field.el);
      if (!ctx.visible) continue;

      let fieldKey = null;
      let value = null;

      // 0) 内推码: 识别"内推码/推荐码"字段
      if (!fieldKey && /(内推码|内推|推荐码|推荐人|referral|邀请码)/i.test(ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name)) {
        const code = matchRefCode(refCodes, location.hostname);
        if (code) { fieldKey = 'refCode'; value = code; }
      }
      // 1) 选择器记忆: 同一域名二次填充优先精准选择器
      if (!fieldKey) {
        const sel = AS.matcher.genSelector(field.el);
        if (memories && sel && memories[sel]) {
          const memKey = memories[sel];
          const vals = getValues(memKey);
          if (vals.length) { fieldKey = memKey; value = vals.shift(); }
        }
      }
      // 2) 复用投递
      if (!fieldKey && reuseActive) {
        if (AS.fuzzy.containsAny(ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name + ' ' + ctx.id, ['公司名称', '公司', '单位名称', 'employer', 'company', 'organization'])) {
          fieldKey = 'reuse.company';
          value = reuseActive.company;
        } else if (AS.fuzzy.containsAny(ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name + ' ' + ctx.id, ['岗位', '职位', '应聘', 'position', 'job title', 'post'])) {
          fieldKey = 'reuse.position';
          value = reuseActive.position;
        }
      }
      // 3) 开放性问题
      if (!fieldKey && AS.matcher.isOpenQuestionField(ctx)) {
        const answer = AS.matcher.resolveOpenQuestion(profile, ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name);
        if (answer !== null) { fieldKey = 'openQuestions'; value = answer; }
      }
      // 4) 站点映射 / 关键词匹配
      if (!fieldKey) {
        const m = AS.matcher.matchField(ctx, rule);
        if (m) {
          fieldKey = m.fieldKey;
          const vals = getValues(m.fieldKey);
          if (!vals.length && AS.matcher.isOpenQuestionField(ctx)) {
            const answer = AS.matcher.resolveOpenQuestion(profile, ctx.labelText + ' ' + ctx.placeholder);
            if (answer !== null) { fieldKey = 'openQuestions'; value = answer; }
          } else if (vals.length) {
            value = vals.shift();
          } else {
            fieldKey = null;
          }
        }
      }

      if (!fieldKey || value === null || value === undefined) continue;
      if (!catAllowed(fieldKey)) continue;
      const label = ctx.labelText || ctx.placeholder || ctx.name || ctx.id || '未知字段';
      items.push({ field, fieldKey, value, label, ctx, sel: AS.matcher.genSelector(field.el) });
    }
    return { items, valueQueues, seenFields };
  }

  // ---------- 执行填充计划 ----------
  async function executePlan(plan, selectedSet, opts, settings, report) {
    const snapshots = [];
    const items = selectedSet ? plan.items.filter((_, i) => selectedSet.has(i)) : plan.items;
    const memoriesQueue = [];

    for (const item of items) {
      report.total++;
      const { field, fieldKey, value, label, ctx, sel } = item;
      if (!ctx.visible) continue;
      const snap = snapshotField(field);
      if (snap) snapshots.push(snap);
      const r = await AS.filler.fillField(field, value, opts);
      if (r.ok && r.action === 'filled') {
        report.filled++;
        AS.overlay.highlight(field.el, 'af-highlight-ok');
        // 记录选择器记忆(成功填充且非临时字段)
        if (sel && fieldKey && !fieldKey.startsWith('reuse.') && fieldKey !== 'openQuestions') {
          memoriesQueue.push({ sel, fieldKey });
        }
      } else if (r.ok && r.action === 'skipped') {
        report.skipped++;
        AS.overlay.highlight(field.el, 'af-highlight-skip');
      } else if (r.action === 'info') {
        report.infos.push({ label, detail: r.detail });
      } else if (r.action === 'error') {
        report.errors++;
        report.unmatchedItems.push({ signature: ctx.name || ctx.id || label, label, reason: r.detail || '填充失败' });
        AS.overlay.highlight(field.el, 'af-highlight');
      } else {
        report.unmatched++;
        report.unmatchedItems.push({ signature: ctx.name || ctx.id || label, label, reason: r.detail || '未匹配' });
        AS.overlay.highlight(field.el, 'af-highlight');
      }
    }

    // 批量写入选择器记忆(节流: 每轮最多 20 条)
    try {
      const host = location.hostname;
      const slice = memoriesQueue.slice(0, 20);
      for (const m of slice) {
        await AS.storage.addMemory(host, m.sel, m.fieldKey);
      }
    } catch (e) { LOG().warn('content', 'save memory failed', e); }

    return snapshots;
  }

  // ---------- 动态行表单: 查找"添加经历"按钮 ----------
  function findAddRowButton() {
    try {
      const candidates = document.querySelectorAll('button, a, span, div, [role="button"]');
      for (const el of candidates) {
        if (el.children && el.children.length > 2) continue;
        const t = (el.textContent || '').trim();
        if (!t || t.length > 14) continue;
        if (/^(添加|新增|增加)\s*(一条|一个)?\s*(经历|教育|实习|项目|工作|荣誉|技能)/.test(t) ||
            /(添加|新增)\s*(实习经历|教育经历|项目经历|工作经历|更多|条目)/.test(t) ||
            /^(\+|\+|＋)\s*(添加|新增)/.test(t)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return el;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ---------- 多页表单: 查找"下一步"按钮(排除提交类) ----------
  function findNextButton() {
    try {
      const els = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
      for (const el of els) {
        const t = ((el.textContent || el.value || '')).trim();
        if (!t || t.length > 14) continue;
        if (/^(下一步|保存并下一步|保存并继续|下一页|继续填写|继续|下一部分|下一页继续)/.test(t) && !/提交|完成|报名|确认|投递|最后/.test(t)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) return el;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---------- 多页自动下一步续填(用户开启, 绝不触碰提交按钮) ----------
  async function autoNextLoop() {
    for (let i = 0; i < 6; i++) {
      const btn = findNextButton();
      if (!btn) break;
      const urlBefore = location.href;
      const countBefore = document.querySelectorAll('input,textarea,select').length;
      try { btn.click(); } catch (e) { break; }
      await sleep(1500);
      // 页面无变化(URL 与表单数量都未变)则停止, 避免死循环
      const countAfter = document.querySelectorAll('input,textarea,select').length;
      if (location.href === urlBefore && countAfter === countBefore) break;
      // 续填新一页(无预览, 静默)
      await doFill({ sections: null, auto: true });
    }
  }

  // ---------- 核心填充流程 ----------
  async function doFill(msg) {
    LOG().info('content', 'fill requested in', frameLabel(), frame());
    const t0 = Date.now();
    const sections = msg && msg.sections && msg.sections.length ? msg.sections : null;
    const isAuto = !!(msg && msg.auto);

    const [settings, profile, rule, reuse, memories] = await Promise.all([
      AS.storage.getSettings(),
      AS.storage.getActiveProfile(),
      AS.storage.getSiteRuleForHost(location.hostname),
      AS.storage.getReusePayload(),
      AS.storage.getMemoriesForHost(location.hostname),
    ]);

    // 黑白名单
    if (!isSiteAllowed(location.hostname, settings.siteFilter)) {
      AS.overlay.toast('当前网站已被插件禁用(黑白名单设置)');
      chrome.runtime.sendMessage({
        type: 'AF_FILL_DONE', payload: { filled: 0, skipped: 0, unmatched: 0, errors: 0, total: 0, unmatchedItems: [], infos: [], blocked: true },
      }).catch(() => {});
      return;
    }

    // 复用载荷
    let reuseActive = null;
    if (reuse && reuse.url && reuse.url.indexOf(location.hostname) >= 0) {
      reuseActive = reuse;
    }

    const report = { filled: 0, skipped: 0, unmatched: 0, errors: 0, total: 0, unmatchedItems: [], infos: [] };

    if (!profile) {
      AS.overlay.toast('信息库为空, 请先在配置页录入信息');
      chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: Object.assign(report, { noProfile: true }) }).catch(() => {});
      return;
    }

    // 加密检查
    if (hasEncryptedValue(profile)) {
      const unlocked = await ensureUnlocked();
      if (!unlocked) {
        const ok = await unlockFlow();
        if (!ok) {
          AS.overlay.toast('已取消: 敏感字段尚未解锁');
          chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: Object.assign(report, { cancelled: true }) }).catch(() => {});
          return;
        }
      }
    }

    const opts = {
      typing: !!settings.typingMode,
      typingMin: settings.typingMin || 30,
      typingMax: settings.typingMax || 120,
      conflictMode: settings.conflictMode || 'skip',
      photoDataUrl: settings.photoDataUrl || '',
    };

    const valueQueues = new Map();
    const seenFields = new Set();

    // 经历素材选择器(仅手动模式 + 预览开启时)
    let expOrder = null;
    if (!isAuto && settings.previewMode && hasMultiEntries(profile)) {
      expOrder = await new Promise((resolve) => {
        AS.overlay.showExperiencePicker(profile, resolve);
      });
      if (expOrder === undefined) {
        // 面板被直接关闭: 视为取消本次填充
        chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: report }).catch(() => {});
        return;
      }
    }

    let plan = buildPlan(AS.scanner.scan(), profile, rule, memories, reuseActive, sections, valueQueues, expOrder || null, settings.refCodes);
    plan.items.forEach((it) => seenFields.add(it.field.el));

    const finish = async (snapshots, withPanel) => {
      LOG().info('content', 'fill done in ' + frameLabel(), { filled: report.filled, unmatched: report.unmatched, took: (Date.now() - t0) + 'ms' });
      try { await chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: report }); } catch (e) { /* noop */ }
      if (report.filled > 0 || report.skipped > 0) {
        setTimeout(() => AS.detect.arm(), 800);
      }
      if (reuseActive) AS.storage.clearReusePayload();
      if (!withPanel) return;
      if (report.filled > 0) {
        AS.overlay.showSummary(report, snapshots && snapshots.length ? () => undoAll(snapshots) : null);
      } else if (report.unmatched > 0 || report.errors > 0) {
        AS.overlay.showSummary(report, null);
      }
    };

    // 预览模式(手动)
    if (!isAuto && settings.previewMode && plan.items.length) {
      AS.overlay.showPreview(plan.items, async (selectedSet) => {
        const snapshots = await executePlan(plan, selectedSet, opts, settings, report);
        await finish(snapshots, true);
        AS.overlay.ensureFloatBall();
        if (settings.autoNext) autoNextLoop();
      }, () => {
        chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: report }).catch(() => {});
      });
      return;
    }

    let snapshots = await executePlan(plan, null, opts, settings, report);

    // 动态行续填: 值队列还有剩余且存在"添加"按钮
    const hasRemaining = () => {
      for (const q of valueQueues.values()) { if (q.length) return true; }
      return false;
    };
    let rounds = 0;
    while (hasRemaining() && rounds < 3) {
      const addBtn = findAddRowButton();
      if (!addBtn) break;
      LOG().info('content', 'dynamic row button found, clicking to add more');
      try {
        addBtn.click();
      } catch (e) { break; }
      await sleep(700);
      const fresh = AS.scanner.scan().filter((f) => !seenFields.has(f.el));
      if (!fresh.length) break;
      const extra = buildPlan(fresh, profile, rule, null, reuseActive, sections, valueQueues, null, settings.refCodes);
      extra.items.forEach((it) => seenFields.add(it.field.el));
      if (!extra.items.length) break;
      const extraSnaps = await executePlan(extra, null, opts, settings, report);
      snapshots = snapshots.concat(extraSnaps);
      rounds++;
    }

    await finish(snapshots, !isAuto);
    if (!isAuto) {
      AS.overlay.ensureFloatBall();
      if (settings.autoNext) autoNextLoop();
    }
  }

  // 是否存在多条可选择的经历
  function hasMultiEntries(profile) {
    if (!profile || !profile.data) return false;
    return ['education', 'internship', 'project'].some((c) => (profile.data[c] || []).length > 1);
  }

  // ---------- 页面信息抓取 ----------
  function grabPageInfo() {
    const doc = document;
    const title = doc.title || '';
    const hostname = location.hostname.replace(/^www\./, '');
    const meta = (name) => {
      const el = doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
      return el ? (el.content || '').trim() : '';
    };

    let company = meta('og:site_name') || meta('application-name') || '';
    let position = '';
    let city = '';
    let pending = false;

    // 公司: 标题模式 "公司-岗位" 或 "岗位-公司"
    const titleParts = title.split(/[-_|｜·]/).map((s) => s.trim()).filter(Boolean);
    if (!company && titleParts.length) {
      // 招聘标题常见: 岗位-公司
      const jobLike = /(工程师|开发|算法|数据|产品|运营|设计|销售|测试|实习|管培生|研究员|顾问|专员|经理|分析师|研发|技术|架构|实施|招聘|校招|秋招)/;
      const nonJob = titleParts.filter((p) => !jobLike.test(p) && p.length >= 2 && p.length <= 20);
      company = nonJob[0] || '';
    }
    if (!company) {
      const h1 = doc.querySelector('h1');
      if (h1 && h1.textContent.trim().length <= 30) company = h1.textContent.trim();
    }
    if (!company) {
      company = hostname.replace(/\.(com|cn|net|org|co|xyz|top|info|io|edu|site)$/i, '').replace(/\./g, ' ');
      pending = true;
    }

    // 岗位
    const jobLike = /(工程师|开发|算法|数据|产品|运营|设计|销售|测试|实习|管培生|研究员|顾问|专员|经理|分析师|研发|技术|架构|实施|招聘|开发工程师|后端|前端|客户端|算法工程师|运维)/;
    if (titleParts.length) {
      position = titleParts.find((p) => jobLike.test(p)) || '';
    }
    if (!position) {
      const h1 = doc.querySelector('h1');
      if (h1 && jobLike.test(h1.textContent)) position = h1.textContent.trim();
    }
    if (!position) {
      const h2s = Array.from(doc.querySelectorAll('h1,h2,h3'));
      position = (h2s.find((h) => jobLike.test(h.textContent) && h.textContent.trim().length <= 40) || {}).textContent || '';
    }
    if (!position) { pending = true; }

    // 城市
    const bodyText = (doc.body && doc.body.innerText) || '';
    const cityMatch = bodyText.match(/(?:工作地点|工作城市|城市|base|地点)\s*[:：]\s*([^\n\r,，。；;]{2,20})/);
    if (cityMatch) city = cityMatch[1].trim();
    if (!city) pending = true;

    // JD 快照
    let jd = '';
    const jdSelectors = ['#job-desc', '#jobDescription', '.job-desc', '.job-description', '.job-detail', '.job_detail', '.position-desc', '.position_detail', '.describtion', '.description', '[class*="job-desc"]', '[class*="job_detail"]', '[class*="position-desc"]'];
    for (const sel of jdSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 30) { jd = el.textContent.trim(); break; }
    }
    if (!jd) {
      const marker = bodyText.indexOf('职位描述');
      if (marker >= 0) jd = bodyText.slice(marker, marker + 2500).trim();
      else if (bodyText.indexOf('岗位职责') >= 0) {
        const m2 = bodyText.indexOf('岗位职责');
        jd = bodyText.slice(m2, m2 + 2500).trim();
      }
    }
    if (jd.length > 4000) jd = jd.slice(0, 4000);

    // 渠道
    const ruleHost = hostname;
    const channel = title.includes('智联') ? '智联招聘' : title.includes('牛客') ? '牛客网' : title.includes('前程无忧') ? '前程无忧' : ruleHost;

    return {
      company: company.slice(0, 60),
      position: position.slice(0, 80),
      city: city.slice(0, 40),
      channel,
      url: location.href,
      title,
      jdSnapshot: jd,
      pending,
      siteName: ruleHost,
    };
  }

  // ---------- 学习模式: 捕获页面手动填写内容 ----------
  function fieldValue(field) {
    const el = field.el;
    try {
      switch (field.type) {
        case 'checkbox': return el.checked ? '是' : '';
        case 'radio': {
          const checked = (field.group || []).find((r) => r.checked);
          if (!checked) return '';
          const label = checked.labels && checked.labels[0] ? checked.labels[0].textContent.trim() : '';
          return label || checked.value || '是';
        }
        case 'select': {
          const o = el.selectedOptions && el.selectedOptions[0];
          return o ? (o.textContent || o.value || '') : '';
        }
        case 'richtext': return (el.textContent || '').trim();
        case 'custom': {
          const input = field.custom ? field.custom.querySelector('input:not([type="hidden"]),textarea') : null;
          return input ? input.value : (el.value || '');
        }
        default: return el.value || '';
      }
    } catch (e) { return ''; }
  }

  async function collectManualInputs() {
    const settings = await AS.storage.getSettings();
    if (!isSiteAllowed(location.hostname, settings.siteFilter)) {
      AS.overlay.toast('当前网站已被插件禁用(黑白名单设置)');
      return [];
    }
    const profile = await AS.storage.getActiveProfile();
    if (!profile) {
      AS.overlay.toast('信息库为空, 请先在配置页创建方案');
      return [];
    }
    const rule = await AS.storage.getSiteRuleForHost(location.hostname);
    const fields = AS.scanner.scan();
    const items = [];
    const seen = new Set();
    for (const field of fields) {
      const raw = fieldValue(field);
      const value = raw === null || raw === undefined ? '' : String(raw).trim();
      if (!value) continue;
      const ctx = AS.matcher.buildContext(field.el);

      // 开放题答案 → 题库
      if (AS.matcher.isOpenQuestionField(ctx)) {
        const question = (ctx.labelText || ctx.placeholder || ctx.name || '开放题').slice(0, 60);
        const dupKey = 'oq|' + question + '|' + value;
        if (!seen.has(dupKey)) { seen.add(dupKey); items.push({ type: 'openQuestions', question, answer: value, value }); }
        continue;
      }
      const m = AS.matcher.matchField(ctx, rule);
      if (!m) continue;
      const base = m.fieldKey.replace(/\[\d+\]/g, '');
      const [catId] = base.split('.');
      const cat = AS.schema.findCategory(catId);
      if (!cat || cat.repeatable || catId === 'openQuestions') continue;
      const vals = AS.matcher.resolveValues(profile, m.fieldKey);
      if (vals.includes(value)) continue; // 库中已有相同值
      const dupKey = 'f|' + base + '|' + value;
      if (seen.has(dupKey)) continue;
      seen.add(dupKey);
      items.push({
        type: 'field', fieldKey: m.fieldKey, catId, key: base.split('.')[1],
        label: ctx.labelText || ctx.placeholder || ctx.name || '未知字段',
        value,
      });
    }
    LOG().info('content', 'learn collected', items.length, 'items in', frameLabel());
    return items;
  }

  // ---------- 右键选中文字存入题库 ----------
  async function saveSelectionToQuiz(text) {
    const promptText = text.length > 60 ? text.slice(0, 60) + '...' : text;
    const question = window.prompt('选中文字将存入开放题库。\n请输入问题标题(留空则用选中文字作为问题):\n\n选中内容: ' + promptText);
    if (question === null) return;
    try {
      const profile = await AS.storage.getActiveProfile();
      if (!profile) { AS.overlay.toast('无信息方案, 请先创建'); return; }
      profile.data.openQuestions = profile.data.openQuestions || [];
      const q = question.trim() || text.slice(0, 40);
      profile.data.openQuestions.push({ question: q, answer: text });
      profile.updatedAt = Date.now();
      await AS.storage.saveProfile(profile);
      AS.overlay.toast('已存入开放题库 ✔');
    } catch (e) {
      AS.overlay.toast('保存失败: ' + (e.message || e));
    }
  }

  // ---------- 笔试题库: 右键查答案 ----------
  async function lookupQuizAnswer(text) {
    try {
      const quiz = await AS.storage.getQuiz();
      const fz = AS.fuzzy;
      const nt = fz.normalize(text);
      let best = null;
      for (const q of quiz) {
        const nq = fz.normalize(q.question);
        if (!nq) continue;
        let score = 0;
        if (nq && (nt.includes(nq) || nq.includes(nt))) score = 0.95;
        else score = fz.similarity(nt, nq);
        if (score > 0.6 && (!best || score > best.score)) best = { score, q };
      }
      if (best && best.q.answer) {
        AS.overlay.toast(`📝 题库命中(相似度 ${Math.round(best.score * 100)}%):\n${best.q.answer}`, 25000);
      } else {
        AS.overlay.toast('题库中未找到该题, 可右键「将选中文字存入开放题库」或到配置页录入', 6000);
      }
    } catch (e) {
      AS.overlay.toast('查询失败: ' + (e.message || e));
    }
  }

  // ---------- 消息路由 ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    LOG().debug('content', 'msg received', msg.type);
    switch (msg.type) {
      case 'AF_FILL':
        doFill(msg);
        break;
      case 'AF_GRAB_INFO':
        sendResponse(grabPageInfo());
        break;
      case 'AF_SHOW_RECORD':
        if (window.top === window) {
          setTimeout(() => AS.overlay.showRecordPanel(msg.info || {}), 200);
        }
        break;
      case 'AF_SHOW_FLOAT':
        if (window.top === window) {
          AS.overlay.ensureFloatBall();
          AS.overlay.toast('悬浮操作面板已显示 (可拖拽)');
        }
        break;
      case 'AF_SAVE_SELECTION':
        if (window.top === window && msg.text && msg.text.trim()) {
          saveSelectionToQuiz(msg.text.trim());
        }
        break;
      case 'AF_QUIZ_LOOKUP':
        if (window.top === window && msg.text && msg.text.trim()) {
          lookupQuizAnswer(msg.text.trim());
        }
        break;
      case 'AF_SCAN_COUNT': {
        const fields = AS.scanner.scan();
        sendResponse({ total: fields.length, hostname: location.hostname });
        break;
      }
      case 'AF_LEARN_COLLECT':
        collectManualInputs().then((items) => {
          if (items.length) {
            chrome.runtime.sendMessage({ type: 'AF_LEARN_COLLECT_RESULT', items }).catch((e) => LOG().warn('content', 'learn result send failed', e));
          }
        });
        break;
      case 'AF_LEARN_SHOW':
        if (window.top === window && msg.items && msg.items.length) {
          AS.overlay.showLearnPanel(msg.items);
        }
        break;
      case 'AF_FILL_SUMMARY':
        if (window.top === window && msg.summary) {
          AS.overlay.showSummary(msg.summary);
        }
        break;
      default:
        break;
    }
    return true;
  });

  AS.contentMain = { doFill, grabPageInfo, collectManualInputs };
})();
