/**
 * italent/MOKA 真实页面全方面实测 — 写入模拟 → 捕获读取 → 入库 → 填充
 * 运行: node scripts/e2e/italent-full.js
 * 环境变量 TARGET_URL 覆盖默认 MOKA 链接
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');

const TARGET = process.env.TARGET_URL || 'https://app.mokahr.com/campus-recruitment/honganrobots/150155?sessionid=#/job/d768bd4a-a1a2-4339-8e37-704d2a687e73/apply';

const CORE_SCRIPTS = [
  'src/utils/logger.js',
  'src/modules/schema.js',
  'src/modules/storage.js',
  'src/utils/fuzzy.js',
  'src/utils/dates.js',
  'src/utils/matcher.js',
  'src/modules/fill-engine.js',
  'src/utils/encrypt.js',
  'src/content/scanner.js',
  'src/content/capture.js',
  'src/content/filler.js',
  'src/modules/learn-save.js',
];

const STUB = `
  window.__afStore = window.__afStore || {};
  const mem = window.__afStore;
  if (!window.chrome || !window.chrome.storage) {
    window.chrome = Object.assign(window.chrome || {}, {
      storage: { local: {
        async get(key) { if (typeof key === 'string') return { [key]: mem[key] }; const out = {}; (key || []).forEach((k) => { out[k] = mem[k]; }); return out; },
        async set(obj) { Object.assign(mem, obj); },
      } },
      runtime: { getManifest: () => ({ version: 'italent-full' }), getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
    });
  }
`;

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 240) : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const pageLogs = [];
  page.on('pageerror', (e) => pageLogs.push(String(e).slice(0, 160)));

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const title = await page.title();
  const bodyText = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 200) : ''));
  if (/登录|Login/.test(title) || /当前页面已失效|请登录/.test(bodyText)) {
    report('页面可达', false, { title, text: bodyText.slice(0, 80) });
    console.log('页面不可达, 需新链接或登录态');
    await browser.close();
    process.exit(1);
  }
  report('页面可达', true, title);

  await page.addScriptTag({ content: STUB });
  for (const rel of CORE_SCRIPTS) await page.addScriptTag({ path: path.join(ROOT, rel) });

  // ===== 阶段1: 字段盘点 =====
  const scan = await page.evaluate(() => {
    const fields = AS.scanner.scan();
    return fields.map((f) => {
      let label = '';
      try { label = AS.matcher.buildContext(f.el).labelText || ''; } catch (e) {}
      const el = f.el;
      return { type: f.type, label, ph: el.placeholder || '', name: el.name || '', readOnly: !!el.readOnly, tag: el.tagName };
    });
  });
  report('阶段1 字段盘点', scan.length >= 5, { total: scan.length });
  console.log('  ' + scan.map((f) => `[${f.type}]${f.readOnly ? 'RO' : ''} ${f.label || f.ph || f.name}`).join('\n  '));

  // ===== 阶段2: 模拟真人写入(各种类型) =====
  const ts = String(Date.now() % 100000);
  const WRITES = [
    { kind: 'text-cn', ph: '姓名', val: '模拟' + ts },
    { kind: 'text-phone', ph: '请输入手机号', val: '139' + String(Date.now() % 100000000).padStart(8, '0') },
    { kind: 'text-email', ph: '邮箱', val: 'moke' + ts + '@qq.com' },
    { kind: 'text-school', ph: '请输入就读学校', val: '模拟大学' + ts.slice(0, 3) },
    { kind: 'text-major', ph: '请输入专业名称', val: '模拟专业' },
  ];
  const written = await page.evaluate((list) => {
    const done = [];
    const setVal = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    list.forEach((w) => {
      const el = Array.from(document.querySelectorAll('input,textarea')).find((i) => (i.placeholder || '') === w.ph);
      if (!el || el.readOnly) { done.push({ ph: w.ph, status: 'skip' }); return; }
      setVal(el, w.val);
      done.push({ ph: w.ph, val: w.val, status: 'ok' });
    });
    return done;
  }, WRITES);
  report('阶段2 模拟真人写入', written.filter((w) => w.status === 'ok').length >= 3, written);
  console.log('  写入:' + written.map((w) => `${w.ph}=${w.val || '(跳过)'}`).join(' | '));

  // ===== 阶段3: 捕获读取 — 写入什么必须读回什么 =====
  const items = await page.evaluate(async () => {
    const profile = { id: 'e2e', name: 'E2E', data: {} };
    const [rule, memories, aliases] = await Promise.all([AS.storage.getSiteRuleForHost(location.hostname), AS.storage.getMemoriesForHost(location.hostname), AS.storage.getUserAliases()]);
    return AS.capture.collect(profile, { rule, memories, aliases });
  });
  report('阶段3 捕获读取(捕获到 ' + items.length + ' 项)', items.length >= 3, items.slice(0, 6).map((i) => `${i.fieldKey}=${i.pageValue}`));
  const miss = written.filter((w) => w.status === 'ok' && !items.some((i) => String(i.pageValue) === String(w.val)));
  report('  写入值全部被捕获读回', miss.length === 0, { 未读回: miss.map((m) => m.ph) });

  // ===== 阶段4: 入库 =====
  await page.evaluate(() => {
    window.__afStore.af_settings = { activeProfileId: 'e2e', conflictMode: 'skip', typingMode: false, typingMin: 30, typingMax: 120, previewMode: false, logLevel: 'info', encryption: { enabled: false }, siteFilter: { mode: 'all', blacklist: [], whitelist: [] }, autoNext: false, photoDataUrl: '', refCodes: [] };
    window.__afStore.af_profiles = [{ id: 'e2e', name: 'E2E', data: { basic: {}, skills: {}, intent: {}, education: [], internship: [], project: [], custom: [], openQuestions: [] } }];
  });
  const save = await page.evaluate(async (its) => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    return AS.learnSave.save(profile, its, { sourceHost: location.hostname });
  }, items);
  report('阶段4 捕获内容入库', save.saved > 0, save);
  const profileCheck = await page.evaluate(async () => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    const d = profile.data;
    return { basic: Object.keys(d.basic || {}), edu: (d.education || []).map((e) => e.school), open: (d.openQuestions || []).length, skills: Object.keys(d.skills || {}) };
  });
  report('  入库内容核对', (profileCheck.basic.length + profileCheck.edu.length) >= 3, profileCheck);

  // ===== 阶段5: 填充剩余空白字段(生产 fillEngine) =====
  await page.evaluate(async () => {
    const prof = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    const fill = { name: '正式姓名', phone: '13711112222', email: 'real@qq.com', politicalStatus: '共青团员', ethnicity: '汉族', birthday: '2001-06' };
    Object.assign(prof.data.basic, fill);
    const edu = prof.data.education && prof.data.education[0];
    if (edu) { edu.school = '哈尔滨工程大学'; edu.major = '软件工程'; }
    await chrome.storage.local.set({ af_profiles: [prof] });
  });
  const fill = await page.evaluate(async () => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    const rule = await AS.storage.getSiteRuleForHost(location.hostname);
    const memories = await AS.storage.getMemoriesForHost(location.hostname);
    const fields = AS.scanner.scan();
    const valueQueues = new Map();
    const plan = AS.fillEngine.buildPlan(fields, profile, rule, memories, null, null, valueQueues, null, null, location.hostname);
    const rep = { filled: 0, skipped: 0, unmatched: 0, errors: 0, total: 0, infos: [], unmatchedItems: [] };
    await AS.fillEngine.executePlan(plan, null, { conflictMode: 'skip', typing: false, photoDataUrl: '' }, {
      report: rep, snapshot: () => null, highlight: () => {}, showProgress: () => {}, closeProgress: () => {},
      setFillState: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), flushMemories: async () => {},
    });
    return rep;
  });
  report('阶段5 填充执行', fill.filled > 0, { filled: fill.filled, total: fill.total, notEffective: fill.notEffective || 0 });
  console.log('  未匹配/未生效:', JSON.stringify(fill.unmatchedItems.slice(0, 10)));
  // 出生日期面板验证(input 有值即生效; 组件会补全年龄后缀)
  const birthCheck = await page.evaluate(() => {
    const bd = Array.from(document.querySelectorAll('input')).find((i) => {
      const lbl = i.closest('label');
      const lblCls = lbl ? (lbl.className || '') : '';
      const val = i.value || '';
      return lblCls.includes('day_info') || (i.placeholder || '').includes('出生日期') || /^\d{4}-\d{2}\s*\(/.test(val);
    });
    return { filled: bd ? bd.value : '(无字段)', ok: !!(bd && bd.value) };
  });
  report('阶段5b 出生日期面板选择', birthCheck.ok, birthCheck);

  // ===== 阶段5c: 下拉窗口选择(打开+匹配逻辑验证; 未登录态 MOKA 拦截值写入) =====
  const panelCheck = await page.evaluate(async () => {
    const out = { opened: false, matched: false, valueWritten: false };
    // 移除登录引导弹层(未登录测试环境限制)
    const portal = document.querySelector('[class*="sd-Modal-portal"]');
    if (portal) portal.remove();
    const inp = Array.from(document.querySelectorAll('input')).find((i) => (i.placeholder || '') === '请选择');
    if (!inp) return out;
    inp.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    inp.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 1200));
    const panel = Array.from(document.querySelectorAll('[class*="Dropdown-dropdown"]')).find((p) => { const rc = p.getBoundingClientRect(); return rc.width > 0 && rc.height > 0; });
    if (!panel) return out;
    out.opened = true;
    // 用生产函数匹配并点击选项(未登录态可能被系统拦截写入)
    const r = await AS.filler.fillField({ el: inp, type: 'text', readonlyComponent: false }, '男', { conflictMode: 'skip', typing: false, photoDataUrl: '' });
    out.matched = r.ok && r.action === 'filled';
    out.valueWritten = !!inp.value;
    out.detail = r.detail;
    return out;
  }, 90000);
  report('阶段5c 下拉窗口选择(打开+匹配)', panelCheck.opened && panelCheck.matched, panelCheck);
  // ===== 阶段5d: 协议复选框自动勾选(真实页面) =====
  const agreeCheck = await page.evaluate(() => {
    const before = [];
    document.querySelectorAll('input[type="checkbox"],[role="checkbox"],[role="switch"]').forEach((el) => {
      let text = '';
      try {
        if (el.closest && el.closest('label')) text = el.closest('label').textContent || '';
        if (!text) { let n = el; for (let i = 0; i < 3 && n; i++, n = n.parentElement) { if ((n.textContent || '').trim()) { text = n.textContent; break; } } }
      } catch (e) {}
      if (/协议|条款|政策|声明|须知|同意/.test(text || '')) before.push({ checked: !!el.checked, text: (text || '').replace(/\s+/g, '').slice(0, 40) });
    });
    const agreed = AS.filler.fillAgreementCheckboxes();
    const after = [];
    document.querySelectorAll('input[type="checkbox"],[role="checkbox"],[role="switch"]').forEach((el) => {
      let text = '';
      try {
        if (el.closest && el.closest('label')) text = el.closest('label').textContent || '';
        if (!text) { let n = el; for (let i = 0; i < 3 && n; i++, n = n.parentElement) { if ((n.textContent || '').trim()) { text = n.textContent; break; } } }
      } catch (e) {}
      if (/协议|条款|政策|声明|须知|同意/.test(text || '')) after.push({ checked: !!el.checked, text: (text || '').replace(/\s+/g, '').slice(0, 40) });
    });
    return { before, agreed, after };
  }, 90000);
  report('阶段5d 协议复选框自动勾选', agreeCheck.agreed >= 0 && agreeCheck.after.every((x) => x.checked), agreeCheck);

  // ===== 阶段6: 弹层清理检查("暂无选项"提示层为非交互提示, 不阻塞) =====
  // 模拟用户点击页面空白处关闭选择完成后的残留面板
  await page.mouse.click(1300, 250);
  await page.waitForTimeout(500);
  const leftover = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[class*="Dropdown-dropdown"]').forEach((p) => {
      const r = p.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ cls: String(p.className).slice(0, 45), text: (p.textContent || '').replace(/\s+/g, ' ').slice(0, 40) });
    });
    return out;
  });
  const harmful = leftover.filter((l) => !/暂无选项|没有找到/.test(l.text));
  report('阶段6 弹层清理(无阻塞性残留)', harmful.length === 0, { 残留: leftover, 阻塞: harmful });

  const outDir = path.join(ROOT, 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outFile = path.join(outDir, 'italent-full-' + Date.now() + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ url: TARGET, ts: new Date().toISOString(), pageLogs, results }, null, 2));
  console.log('\n报告:', outFile);
  console.log(`汇总: ${results.filter((r) => r.ok).length}/${results.length} 项通过`);
  await browser.close();
})().catch((e) => { console.error('崩溃:', e.message); process.exit(1); });
