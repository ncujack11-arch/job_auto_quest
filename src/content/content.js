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

  // buildPlan/executePlan 已抽离至 modules/fill-engine.js (AS.fillEngine)

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
  // 支持 button/a/input/div/span/role=button(MOKA 等自研系统的分步按钮常为 div)
  function findNextButton() {
    try {
      const els = document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], div, span');
      for (const el of els) {
        const t = ((el.textContent || el.value || '')).trim();
        if (!t || t.length > 14) continue;
        if (/^(下一步|保存并下一步|保存并继续|下一页|继续填写|继续|下一部分|下一页继续)/.test(t) && !/提交|完成|报名|确认|投递|最后/.test(t)) {
          // div/span 需要是类按钮形态(点击区域), 避免误点长文本容器
          const tag = el.tagName.toLowerCase();
          if ((tag === 'div' || tag === 'span') && el.children.length > 1) continue;
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

  // 填充状态机(隔离世界全局, popup 轮询读取, 绕开消息链路保证可见)
  function setFillState(stage, detail) {
    try {
      window.__af_fill_state = { stage: stage || '', detail: detail || '', ts: Date.now(), v: AS.__v || '' };
    } catch (e) { /* ignore */ }
  }

  // 进度上报(经后台广播给 popup, 不依赖页面 overlay, 保证状态可见)
  function reportProgress(stage, extra) {
    try {
      chrome.runtime.sendMessage(Object.assign({ type: 'AF_FILL_PROGRESS', stage }, extra || {})).catch(() => {});
    } catch (e) { /* ignore */ }
  }
  function safeToast(msg, ms) {
    try { AS.overlay.toast(msg, ms); } catch (e) { /* overlay 不可用时静默 */ }
  }

  // ---------- 核心填充流程 ----------
  // 防重复: 同页面可能并存多个版本的 listener, 用版本化锁保证仅一个 doFill 执行
  function acquireFillLock() {
    if (window.__af_fill_lock === CURRENT_VERSION) return false;
    window.__af_fill_lock = CURRENT_VERSION;
    setTimeout(() => { if (window.__af_fill_lock === CURRENT_VERSION) window.__af_fill_lock = ''; }, 60000);
    return true;
  }
  // 填充引擎上下文(buildPlan/executePlan 位于 modules/fill-engine.js, 与 E2E 共用)
  function engineContext(report) {
    return {
      report,
      snapshot: snapshotField,
      highlight: (el, kind) => AS.overlay.highlight(el, kind),
      showProgress: (d, t, l) => { if (t > 3) AS.overlay.showProgress(d, t, l); },
      closeProgress: () => AS.overlay.closeProgress(),
      setFillState,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      flushMemories: async (queue) => {
        try {
          const host = location.hostname;
          for (const m of queue) await AS.storage.addMemory(host, m.sel, m.fieldKey);
        } catch (e) { LOG().warn('content', 'save memory failed', e); }
      },
    };
  }
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('超时: ' + label + ' (' + ms / 1000 + 's)')), ms)),
    ]);
  }
  async function doFill(msg) {
    LOG().info('content', 'fill requested in', frameLabel());
    if (!acquireFillLock()) {
      LOG().warn('content', 'fill already in progress, skipped');
      return;
    }
    const t0 = Date.now();
    try {
      if (window.top === window) {
        safeToast('▶ 收到填充命令, 开始执行...', 2500);
      }
      setFillState('start', 'doFill 已开始');
      reportProgress('start');
      await withTimeout(doFillInner(msg, t0), 45000, 'fill');
    } catch (e) {
      LOG().error('content', 'doFill failed', e);
      setFillState('error', (e && e.message ? e.message.slice(0, 120) : String(e)));
      reportProgress('error', { message: (e && e.message ? e.message.slice(0, 120) : String(e)) });
      try {
        AS.overlay.toast('填充异常: ' + (e && e.message ? e.message.slice(0, 80) : e));
      } catch (e2) { /* ignore */ }
      chrome.runtime.sendMessage({
        type: 'AF_FILL_DONE',
        payload: { filled: 0, skipped: 0, unmatched: 0, errors: 1, total: 0, unmatchedItems: [{ label: '内部错误', reason: (e && e.message) || String(e) }], infos: [] },
      }).catch(() => {});
    }
  }

  async function doFillInner(msg, t0) {
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
      setFillState('waiting-picker', '等待在页面选择经历(如面板不可见将 60 秒后自动继续)');
      expOrder = await withTimeout(new Promise((resolve) => {
        AS.overlay.showExperiencePicker(profile, resolve);
      }), 60000, 'experience-picker').catch(() => null);
      if (expOrder === undefined || expOrder === null) {
        expOrder = null; // 超时/关闭: 使用全部经历继续
      }
    }

    const scannedFields = AS.scanner.scan();
    report.total = scannedFields.length;
    setFillState('scan', `扫描到 ${scannedFields.length} 个表单字段`);
    reportProgress('scan', { total: scannedFields.length });
    if (window.top === window && scannedFields.length > 0) {
      safeToast(`🔍 扫描到 ${scannedFields.length} 个表单字段, 正在匹配...`, 3000);
    }
    let plan = AS.fillEngine.buildPlan(scannedFields, profile, rule, memories, reuseActive, sections, valueQueues, expOrder || null, settings.refCodes, location.hostname);
    plan.items.forEach((it) => seenFields.add(it.field.el));
    // 未匹配字段计入报告(供结果面板展示与点击定位)
    plan.unmatchedFields.forEach((u) => {
      report.unmatched++;
      report.unmatchedItems.push({ signature: u.signature, label: u.label, reason: u.reason });
    });
    setFillState('match', `匹配到 ${plan.items.length} 个字段可填充, 未匹配 ${plan.unmatchedFields.length}`);
    reportProgress('match', { matched: plan.items.length, unmatched: plan.unmatchedFields.length });
    if (!plan.items.length) {
      // 完全没有可填充字段: 明确反馈, 避免"没反应"
      if (report.unmatched > 0) {
        AS.overlay.showSummary(report, null, plan.unmatchedFields.map((u) => ({ el: u.el, label: u.label })));
      } else {
        safeToast(`未在页面找到可填充的表单字段(扫描 ${scannedFields.length} 个元素)`);
      }
      chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: report }).catch(() => {});
      return;
    }
    if (window.top === window) {
      safeToast(`🎯 匹配到 ${plan.items.length} 个字段, 开始写入...`, 3000);
    }

    const finish = async (snapshots, unmatchedEls, withPanel) => {
      LOG().info('content', 'fill done in ' + frameLabel(), { filled: report.filled, unmatched: report.unmatched, took: (Date.now() - t0) + 'ms' });
      setFillState('done', `成功 ${report.filled} · 跳过 ${report.skipped} · 未匹配 ${report.unmatched}${report.notEffective ? ' · 未生效 ' + report.notEffective : ''}`);
      reportProgress('done', { filled: report.filled, skipped: report.skipped, unmatched: report.unmatched, errors: report.errors, notEffective: report.notEffective || 0 });
      // 填充完成后自动提取页面投递信息(供 Popup 一键保存投递)
      if (window.top === window && (report.filled > 0 || report.skipped > 0)) {
        try {
          const info = grabPageInfo();
          chrome.runtime.sendMessage({
            type: 'AF_GRAB_READY',
            info: {
              company: info.company, position: info.position, city: info.city, salary: info.salary,
              url: info.url, channel: info.channel, grabbedAt: Date.now(),
            },
          }).catch(() => {});
        } catch (e) { /* ignore */ }
      }
      try { await chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: report }); } catch (e) { /* noop */ }
      if (report.filled > 0 || report.skipped > 0) {
        setTimeout(() => AS.detect.arm(), 800);
      }
      // 滑块/验证码提示
      if (report.filled > 0 && detectSliderCaptcha()) {
        setTimeout(() => AS.overlay.toast('⚠ 检测到滑块/验证码组件, 请手动完成验证'), 1200);
      }
      if (reuseActive) AS.storage.clearReusePayload();
      if (!withPanel) return;
      if (report.filled > 0) {
        AS.overlay.showSummary(report, snapshots && snapshots.length ? () => undoAll(snapshots) : null, unmatchedEls);
      } else if (report.unmatched > 0 || report.errors > 0) {
        AS.overlay.showSummary(report, null, unmatchedEls);
      }
    };

    // 预览模式(手动)
    if (!isAuto && settings.previewMode && plan.items.length) {
      setFillState('waiting-preview', '等待在预览面板点击「确认填充」(如面板不可见将 120 秒后自动继续)');
      // 保存确认回调: popup 可发送 AF_PREVIEW_CONFIRM 直接确认, 无需在页面点击
      window.__af_preview_confirm = (selectedSet) => {
        AS.fillEngine.executePlan(plan, selectedSet, opts, engineContext(report))
          .then((r) => finish(r.snapshots, r.unmatchedEls, true))
          .catch((e) => LOG().warn('content', 'preview confirm exec failed', e));
        AS.overlay.ensureFloatBall();
        if (settings.autoNext) autoNextLoop();
      };
      AS.overlay.showPreview(plan.items, (selectedSet) => {
        window.__af_preview_confirm = null;
        window.__af_preview_confirm_cb && (window.__af_preview_confirm_cb = null);
        window.__af_preview_confirm(selectedSet);
      }, () => {
        window.__af_preview_confirm = null;
        setFillState('cancelled', '用户在预览面板取消');
        chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: report }).catch(() => {});
      });
      // 预览确认超时保护: 面板不可见时 120 秒后按全部字段继续
      setTimeout(() => {
        if (window.__af_preview_confirm && (!window.__af_fill_state || window.__af_fill_state.stage === 'waiting-preview')) {
          setFillState('auto-continue', '预览等待超时, 自动按全部字段继续');
          const fn = window.__af_preview_confirm;
          window.__af_preview_confirm = null;
          fn(null);
        }
      }, 120000);
      return;
    }

    let r = await AS.fillEngine.executePlan(plan, null, opts, engineContext(report));
    let snapshots = r.snapshots;
    let unmatchedEls = r.unmatchedEls;

    // 动态行续填: 值队列还有剩余且存在"添加"按钮
    const hasRemaining = () => {
      for (const q of valueQueues.values()) { if (q.length) return true; }
      return false;
    };
    let rounds = 0;
    while (hasRemaining() && rounds < 3) {
      const addBtn = findAddRowButton();
      if (!addBtn) break;
      if (rowLimitReached(addBtn)) break;
      LOG().info('content', 'dynamic row button found, clicking to add more');
      try {
        addBtn.click();
      } catch (e) { break; }
      await sleep(700);
      const fresh = AS.scanner.scan().filter((f) => !seenFields.has(f.el));
      if (!fresh.length) break;
      const extra = AS.fillEngine.buildPlan(fresh, profile, rule, null, reuseActive, sections, valueQueues, null, settings.refCodes, location.hostname);
      extra.items.forEach((it) => seenFields.add(it.field.el));
      if (!extra.items.length) break;
      const er = await AS.fillEngine.executePlan(extra, null, opts, engineContext(report));
      // 行内漏填重试: 嵌套下拉/日期控件偶发未写入时, 等待联动加载后重试
      for (const it of extra.items) {
        try {
          if (it.field.type === 'select' && !it.field.el.value) {
            await sleep(500);
            const r3 = await AS.filler.fillField(it.field, it.value, opts);
            if (r3.ok && r3.action === 'filled') {
              report.filled++;
              AS.overlay.highlight(it.field.el, 'af-highlight-ok');
            }
          }
        } catch (e) { /* ignore */ }
      }
      snapshots = snapshots.concat(er.snapshots);
      unmatchedEls = unmatchedEls.concat(er.unmatchedEls);
      rounds++;
    }

    await finish(snapshots, unmatchedEls, !isAuto);
    // 自动勾选用户协议/隐私政策复选框(设置开启时, 严格匹配协议类关键词)
    if (settings.autoAgreeProtocol !== false) {
      try {
        const agreed = AS.filler.fillAgreementCheckboxes();
        if (agreed > 0) safeToast(`☑ 已自动勾选 ${agreed} 个协议复选框`, 2200);
      } catch (e) { /* ignore */ }
    }
    if (!isAuto) {
      AS.overlay.ensureFloatBall();
      if (settings.autoNext) autoNextLoop();
    }
  }

  // ---------- 动态行"最多 N 行"限制识别: 防止无脑点新增 ----------
  function countDynamicRows(btn) {
    try {
      let node = btn;
      for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
        if (!node || !node.children) continue;
        for (const blk of node.children) {
          if (!blk.querySelector || !blk.querySelector('input,select,textarea')) continue;
          const cls = String(blk.className || '').trim();
          const selector = cls ? '.' + cls.split(/\s+/).join('.') : null;
          const same = selector ? Array.from(node.querySelectorAll(selector)) : [];
          const cnt = same.filter((b) => b.querySelector && b.querySelector('input,select,textarea')).length;
          if (cnt >= 2) return cnt;
        }
      }
    } catch (e) { /* ignore */ }
    return 0;
  }
  function rowLimitReached(addBtn) {
    try {
      if (addBtn.disabled || addBtn.getAttribute('aria-disabled') === 'true') return true;
      const texts = [];
      let node = addBtn;
      for (let i = 0; i < 3 && node; i++, node = node.parentElement) texts.push((node.textContent || '').trim());
      const joined = texts.join(' ');
      const m = joined.match(/(?:最多|上限|至多|只能|最多可)\s*(?:添加|新增|填写)?\s*(\d+)\s*(?:条|个|段|份)/);
      if (m && parseInt(m[1], 10) > 0) {
        const rows = countDynamicRows(addBtn);
        if (rows >= parseInt(m[1], 10)) {
          LOG().info('content', 'dynamic row limit reached', { limit: m[1], rows });
          return true;
        }
      }
      if (/已满|已达上限|已到上限|不能再添加|已达最大/.test(joined)) return true;
    } catch (e) { /* ignore */ }
    return false;
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

    // 薪资(从页面文本/标题提取, 如 15-25K / 20k-30k / 年薪 30万)
    let salary = '';
    const salM = bodyText.match(/(?:薪资|薪酬|待遇|工资)\s*(?:范围|待遇|区间)?\s*[:：]?\s*(\d{1,3}\s*[Kk万Ww]\s*[-—~至到]\s*\d{1,3}\s*[Kk万Ww]|\d{1,3}\s*[Kk万Ww]|\d{4,6}\s*[-—~至到]\s*\d{4,6})/);
    if (salM) salary = salM[1].replace(/\s+/g, '').slice(0, 30);
    if (!salary) {
      const tM = (doc.title || '').match(/(\d{1,3}[Kk万Ww][-—~至到]?\d{0,3}[Kk万Ww]?)/);
      if (tM) salary = tM[1];
    }

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
      salary,
      channel,
      url: location.href,
      title,
      jdSnapshot: jd,
      pending,
      siteName: ruleHost,
    };
  }

  // ---------- 学习模式: 捕获页面已填内容(深化版) ----------
  // 实际匹配逻辑位于 capture.js (AS.capture.collect), 此处仅编排数据获取
  function fieldValue(field) {
    const v = AS.capture.getValue(field);
    return v ? v.value : '';
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
    const [rule, memories, aliases] = await Promise.all([
      AS.storage.getSiteRuleForHost(location.hostname),
      AS.storage.getMemoriesForHost(location.hostname),
      AS.storage.getUserAliases(),
    ]);
    const items = await AS.capture.collect(profile, { rule, memories, aliases });
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

  // ---------- 标记模式: 点击输入框 → 选择对应字段 → 记忆选择器 ----------
  let markModeActive = false;
  function enableMarkMode() {
    if (markModeActive) return;
    markModeActive = true;
    AS.overlay.toast('🖱 标记模式已开启: 点击页面任意输入框, 选择它对应的信息库字段 (60 秒后自动关闭)');
    document.addEventListener('click', onMarkClick, true);
    setTimeout(() => {
      if (markModeActive) {
        markModeActive = false;
        document.removeEventListener('click', onMarkClick, true);
        AS.overlay.toast('标记模式已关闭');
      }
    }, 60000);
  }

  async function onMarkClick(e) {
    const el = e.target;
    if (!el || !el.tagName || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    e.stopPropagation();
    e.preventDefault();
    const sel = AS.matcher.genSelector(el);
    if (!sel) {
      AS.overlay.toast('该元素没有 id/name, 无法记忆(可先在信息库用学习模式导入)');
      markModeActive = false;
      document.removeEventListener('click', onMarkClick, true);
      return;
    }
    AS.overlay.showFieldPicker((fieldKey) => {
      markModeActive = false;
      document.removeEventListener('click', onMarkClick, true);
      if (fieldKey) {
        AS.storage.addMemory(location.hostname, sel, fieldKey)
          .then(() => AS.overlay.toast(`已记忆: ${sel} → ${fieldKey} ✔ 下次自动填充`))
          .catch(() => AS.overlay.toast('记忆保存失败'));
      }
    }, el);
  }

  // ---------- 滑块/验证码检测 ----------
  function detectSliderCaptcha() {
    try {
      const els = document.querySelectorAll('[class*="captcha"],[class*="slider"],[class*="verify"],[class*="geetest"],[class*="nc_wrapper"],[id*="captcha"],[role="slider"]');
      for (const el of els) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 40 && rect.height > 10) return true;
      }
      const body = (document.body && document.body.innerText) || '';
      return /(拖动滑块|滑动验证|拖动.*到.*验证|完成.*安全验证|请完成验证|验证通过后|拖动到最右边)/.test(body.slice(0, 3000));
    } catch (e) { return false; }
  }

  // ---------- 全局错误守卫: 插件内部错误不阻塞页面、不污染页面控制台 ----------
  // (隔离世界内注册, 只捕获插件自身错误, 不影响页面主世界)
  window.addEventListener('error', (e) => {
    try {
      const msg = (e && e.message) ? String(e.message) : 'unknown error';
      const src = (e && e.filename) ? String(e.filename) : '';
      if (/^chrome-extension:\/\//.test(src) || /autofill|AF:/.test(msg)) {
        LOG().warn('guard', 'extension error captured', msg.slice(0, 200));
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      }
    } catch (err) { /* 守卫自身异常忽略 */ }
  }, true);

  // ---------- 网申避坑提示(每会话一次) ----------
  let tipsShown = false;
  async function showSiteTips() {
    if (tipsShown) return;
    tipsShown = true;
    try {
      const tips = await AS.storage.getTipsForHost(location.hostname);
      if (tips && tips.length) {
        setTimeout(() => {
          tips.forEach((t, i) => setTimeout(() => AS.overlay.toast('💡 ' + t, 9000), i * 5000));
        }, 1800);
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- 页面诊断: 收集当前表单 DOM 结构摘要(排障用) ----------
  function collectDiagnostic() {
    let fields = [];
    try { fields = AS.scanner.scan(); } catch (e) { /* ignore */ }
    const samples = fields.slice(0, 12).map((f) => {
      let ctx = null;
      try { ctx = AS.matcher.buildContext(f.el); } catch (e) { /* ignore */ }
      const el = f.el;
      return {
        tag: el.tagName ? el.tagName.toLowerCase() : '?',
        type: el.type || '',
        name: String(el.name || '').slice(0, 30),
        id: String(el.id || '').slice(0, 30),
        ph: String(el.placeholder || '').slice(0, 30),
        cls: String((el.className || '').toString() || '').slice(0, 60),
        label: ctx ? String(ctx.labelText || '').slice(0, 20) : '',
        row: ctx ? String(ctx.rowText || '').slice(0, 30) : '',
        prev: ctx ? String(ctx.prevText || '').slice(0, 16) : '',
      };
    });
    return {
      frame: frameLabel(),
      href: location.href.slice(0, 140),
      total: fields.length,
      sample: samples,
    };
  }

  // ---------- 消息路由 ----------
  // 注意: 内容脚本的所有响应均为同步 sendResponse, 即发即弃消息(AF_FILL 等)不返回 true,
  // 否则多 frame 页面每个 frame 都保持消息通道, SPA 切换/iframe 销毁时触发
  // "message channel closed before a response was received"
  const CURRENT_VERSION = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) ? chrome.runtime.getManifest().version : '';
  // 旧版本脚本的监听器仍在时, 由版本守卫确保仅当前版本处理消息
  const isCurrent = () => !CURRENT_VERSION || AS.__v === CURRENT_VERSION;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || typeof msg !== 'object') return;
      LOG().debug('content', 'msg received', msg.type);
      switch (msg.type) {
        case 'AF_FILL':
          if (isCurrent()) doFill(msg);
          break;
      case 'AF_GRAB_INFO':
        if (isCurrent()) sendResponse(grabPageInfo());
        break;
      case 'AF_SHOW_RECORD':
        if (isCurrent() && window.top === window) {
          setTimeout(() => AS.overlay.showRecordPanel(msg.info || {}), 200);
        }
        break;
      case 'AF_SHOW_FLOAT':
        if (isCurrent() && window.top === window) {
          AS.overlay.ensureFloatBall();
          AS.overlay.toast('悬浮操作面板已显示 (可拖拽)');
        }
        break;
      case 'AF_ENABLE_MARK_MODE':
        if (isCurrent() && window.top === window) enableMarkMode();
        break;
      case 'AF_SAVE_SELECTION':
        if (isCurrent() && window.top === window && msg.text && msg.text.trim()) {
          saveSelectionToQuiz(msg.text.trim());
        }
        break;
      case 'AF_QUIZ_LOOKUP':
        if (isCurrent() && window.top === window && msg.text && msg.text.trim()) {
          lookupQuizAnswer(msg.text.trim());
        }
        break;
      case 'AF_SCAN_COUNT': {
        if (isCurrent()) {
          const fields = AS.scanner.scan();
          sendResponse({ total: fields.length, hostname: location.hostname });
        }
        break;
      }
      case 'AF_PING':
        sendResponse({ pong: true, v: AS.__v || '' });
        break;
      case 'AF_GET_FILL_STATE':
        sendResponse({ state: (window.__af_fill_state || null), scanned: (() => {
          try { return AS.scanner.scan().length; } catch (e) { return -1; }
        })() });
        break;
      case 'AF_PREVIEW_CONFIRM':
        // popup 一键确认预览(无需在页面点击)
        if (window.__af_preview_confirm) {
          const fn = window.__af_preview_confirm;
          window.__af_preview_confirm = null;
          fn(null);
        }
        break;
      case 'AF_LEARN_COLLECT':
        if (isCurrent()) {
          collectManualInputs().then((items) => {
            if (items.length) {
              chrome.runtime.sendMessage({ type: 'AF_LEARN_COLLECT_RESULT', items }).catch((e) => LOG().warn('content', 'learn result send failed', e));
            }
          }).catch((e) => LOG().warn('content', 'learn collect failed', e));
        }
        break;
      case 'AF_LEARN_SHOW':
        if (isCurrent() && window.top === window && msg.items && msg.items.length) {
          AS.overlay.showLearnPanel(msg.items);
        }
        break;
      case 'AF_FILL_SUMMARY':
        if (isCurrent() && window.top === window && msg.summary) {
          AS.overlay.showSummary(msg.summary);
        }
        break;
      case 'AF_DIAGNOSTIC':
        if (isCurrent()) {
          chrome.runtime.sendMessage({ type: 'AF_DIAG_RESULT', data: collectDiagnostic() }).catch(() => {});
        }
        break;
      case 'AF_DIAG_SHOW':
        if (isCurrent() && window.top === window && msg.text) {
          AS.overlay.showDiagnostic(msg.text);
        }
        break;
      default:
        break;
    }
    // 不返回 true: 避免 fire-and-forget 消息长时间占用消息通道
    return false;
    } catch (e) {
      // listener 异常捕获: 记录日志并响应(若需要)
      LOG().warn('content', 'listener error', e);
      try { sendResponse({ error: (e && e.message) || String(e) }); } catch (e2) { /* ignore */ }
      return false;
    }
  });

  AS.contentMain = { doFill, grabPageInfo, collectManualInputs };

  // ---------- 右键快捷复制: 输入框右键弹「快速复制」菜单, 一键复制常用字段值 ----------
  const COPY_FIELDS = [
    ['姓名', 'basic.name'], ['手机号', 'basic.phone'], ['邮箱', 'basic.email'], ['身份证号', 'basic.idCard'],
    ['出生日期', 'basic.birthday'], ['籍贯', 'basic.nativePlace'], ['现居地', 'basic.currentLocation'],
    ['政治面貌', 'basic.politicalStatus'], ['民族', 'basic.ethnicity'], ['性别', 'basic.gender'],
    ['期望城市', 'intent.targetCity'], ['期望岗位', 'intent.targetPosition'],
  ];
  let copyMenuEl = null;
  const mel = (tag, attrs, children) => {
    const el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'onclick' || k === 'onmouseenter' || k === 'onmouseleave') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    (children || []).forEach((c) => el.appendChild(c));
    return el;
  };
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) { return false; }
    }
  }
  function closeCopyMenu() {
    if (copyMenuEl) { copyMenuEl.remove(); copyMenuEl = null; }
  }
  document.addEventListener('contextmenu', async (e) => {
    try {
      const target = e.target.closest ? e.target.closest('input,textarea,[contenteditable="true"]') : null;
      if (!target || !isCurrent() || window.top !== window) return;
      const settings = await AS.storage.getSettings();
      if (settings.rightClickCopy === false) return;
      const profile = await AS.storage.getActiveProfile();
      if (!profile) return;
      // 取可复制值
      const items = [];
      COPY_FIELDS.forEach(([label, key]) => {
        const [cat, f] = key.split('.');
        const v = profile.data && profile.data[cat] ? profile.data[cat][f] : '';
        if (v !== undefined && v !== null && String(v).trim()) items.push({ label, key, value: String(v) });
      });
      if (!items.length) return;
      e.preventDefault();
      closeCopyMenu();
      const menu = mel('div', {
        class: 'af-copy-menu',
        style: { position: 'fixed', zIndex: 2147483647, minWidth: '150px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 6px 24px rgba(0,0,0,.12)', padding: '6px 0', fontSize: '13px', color: '#334155' },
      });
      menu.appendChild(mel('div', { style: { padding: '4px 14px', fontSize: '11px', color: '#94a3b8', borderBottom: '1px solid #f1f5f9', marginBottom: '4px' }, text: '⚡ 快速复制当前方案字段' }));
      items.forEach((it) => {
        const row = mel('div', {
          style: { padding: '6px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center' },
          onmouseenter: (ev) => { ev.currentTarget.style.background = '#f8fafc'; },
          onmouseleave: (ev) => { ev.currentTarget.style.background = ''; },
          onclick: async () => {
            const ok = await copyToClipboard(it.value);
            closeCopyMenu();
            if (window.top === window) safeToast(ok ? `已复制 ${it.label}: ${it.value.slice(0, 18)}` : '复制失败, 请手动复制', 1600);
          },
        });
        row.appendChild(mel('span', { text: it.label }));
        row.appendChild(mel('span', { style: { color: '#94a3b8', fontSize: '12px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, text: it.value }));
        menu.appendChild(row);
      });
      menu.appendChild(mel('div', {
        style: { padding: '6px 14px', fontSize: '12px', color: '#64748b', borderTop: '1px solid #f1f5f9', marginTop: '4px', cursor: 'pointer' },
        text: '关闭菜单(点击页面任意处)',
        onclick: closeCopyMenu,
      }));
      document.body.appendChild(menu);
      const x = Math.min(e.clientX, window.innerWidth - 190);
      const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
      menu.style.left = x + 'px'; menu.style.top = Math.max(8, y) + 'px';
      copyMenuEl = menu;
    } catch (err) { /* ignore */ }
  });
  document.addEventListener('click', (e) => {
    if (copyMenuEl && !copyMenuEl.contains(e.target)) closeCopyMenu();
  });
  window.addEventListener('scroll', closeCopyMenu, true);

  // 注入后: 显示站点避坑提示(仅顶层框架)
  if (window.top === window) {
    showSiteTips();
    // 就绪提示(诊断用, 每会话一次): 确认插件已注入且能扫描到字段
    try {
      if (!sessionStorage.getItem('af_ready_shown')) {
        sessionStorage.setItem('af_ready_shown', '1');
        setTimeout(() => {
          try {
            AS.overlay.toast(`✅ 插件已就绪 v${AS.__v}, 扫描到 ${AS.scanner.scan().length} 个字段`, 5000);
          } catch (e) { /* ignore */ }
        }, 900);
      }
    } catch (e) { /* ignore */ }
  }
})();
