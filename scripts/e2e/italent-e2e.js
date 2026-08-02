/**
 * italent 真实站点闭环实测 — 捕获→入库→填充(生产引擎), 支持 iframe 表单
 * 用法: TARGET_URL="https://..." node scripts/e2e/italent-e2e.js
 * 输出: reports/italent-test-<ts>.json + 控制台摘要
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');

const TARGET = process.env.TARGET_URL;
if (!TARGET) { console.error('请设置 TARGET_URL 环境变量为投递表单链接'); process.exit(1); }

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
      runtime: { getManifest: () => ({ version: 'italent-e2e' }), getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
    });
  }
`;

function makeProfile() {
  const ts = String(Date.now() % 100000);
  return {
    id: 'e2e', name: 'E2E实测', data: {
      basic: {
        name: '张' + ts, phone: '138' + String(Date.now() % 1000000000).padStart(8, '0').slice(0, 8),
        email: 'e2e' + ts + '@qq.com', gender: '男', ethnicity: '汉族',
        politicalStatus: '共青团员', nativePlace: '江西 上饶市 余干县', birthday: '2001-06',
        maritalStatus: '未婚', overseas: '否', currentLocation: '杭州',
      },
      skills: { englishLevel: 'CET-6', certificates: '软件设计师' },
      intent: { targetCity: '杭州', targetPosition: '后端开发工程师', expectedSalary: '面议', complyAssignment: '是' },
      education: [{ school: '哈尔滨工程大学', major: '软件工程', degree: '本科', startDate: '2019-09', endDate: '2023-06' }],
      openQuestions: [
        { question: '自我介绍', answer: '热爱技术, 学习能力强, 团队协作好, 责任心强, 追求极致, 持续学习。' },
        { question: '为什么选择我们公司', answer: '认同公司价值观, 希望与技术团队共同成长。' },
      ],
    },
  };
}

async function injectInto(frame) {
  await frame.addScriptTag({ content: STUB });
  for (const rel of CORE_SCRIPTS) {
    try { await frame.addScriptTag({ path: path.join(ROOT, rel) }); }
    catch (e) { console.error('注入失败', rel, e.message); }
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const report = { url: TARGET, ts: new Date().toISOString(), steps: [] };
  const step = (name, ok, detail) => { report.steps.push({ name, ok, detail }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : ''}`); };

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  // 登录墙/失效检测
  const pageText = await page.evaluate(() => (document.body ? document.body.innerText.slice(0, 300) : ''));
  if (/登录|Login/.test(await page.title()) || /当前页面已失效|请登录/.test(pageText)) {
    step('页面可达(未重定向到登录/失效页)', false, { title: await page.title(), text: pageText.slice(0, 120) });
    await browser.close();
    console.log('\n链接需重新生成或需登录态。');
    process.exit(1);
  }
  step('页面可达', true, await page.title());

  await injectInto(page.mainFrame());
  // iframe 表单支持: 注入所有同源/可访问 iframe
  const frames = page.frames();
  for (const fr of frames) {
    if (fr === page.mainFrame()) continue;
    try { await injectInto(fr); } catch (e) { /* 跨域忽略 */ }
  }
  console.log('frames:', frames.length);

  // 选择有表单的 frame
  const formFrame = await (async () => {
    for (const fr of [page.mainFrame(), ...frames]) {
      try {
        const n = await fr.evaluate(() => document.querySelectorAll('input,select,textarea').length);
        if (n > 0) return fr;
      } catch (e) { /* ignore */ }
    }
    return null;
  })();
  if (!formFrame) { step('发现表单字段', false, '页面无输入控件'); await browser.close(); process.exit(1); }
  step('发现表单字段', true, { frame: formFrame.url().slice(0, 80) });

  // 扫描 + 字段清单
  const scan = await formFrame.evaluate(() => {
    const fields = AS.scanner.scan();
    return fields.map((f) => {
      let label = '';
      try { label = AS.matcher.buildContext(f.el).labelText || ''; } catch (e) { /* ignore */ }
      return { type: f.type, label, ph: f.el.placeholder || '', name: f.el.name || '' };
    });
  });
  console.log('字段清单(' + scan.length + '):');
  scan.forEach((f) => console.log(`  [${f.type}] ${f.label || f.ph || f.name}`));
  step('扫描字段数', scan.length >= 5, scan.length);

  // 初始化库 + 设置测试 profile
  await formFrame.evaluate((prof) => {
    window.__afStore.af_settings = { activeProfileId: 'e2e', conflictMode: 'skip', typingMode: false, typingMin: 30, typingMax: 120, previewMode: false, logLevel: 'info', encryption: { enabled: false }, siteFilter: { mode: 'all', blacklist: [], whitelist: [] }, autoNext: false, photoDataUrl: '', refCodes: [] };
    window.__afStore.af_profiles = [prof];
  }, makeProfile());

  // 闭环1: 捕获页面已有内容
  let items = [];
  try {
    items = await formFrame.evaluate(async () => {
      const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
      const [rule, memories, aliases] = await Promise.all([AS.storage.getSiteRuleForHost(location.hostname), AS.storage.getMemoriesForHost(location.hostname), AS.storage.getUserAliases()]);
      return AS.capture.collect(profile, { rule, memories, aliases });
    });
  } catch (e) { items = []; console.error('捕获异常:', e.message); }
  const filledVals = items.filter((i) => i.state === 'new' || i.state === 'diff').map((i) => i.fieldKey + '=' + i.pageValue);
  step('捕获页面已填内容', items.length > 0, { items: items.length, filled: filledVals.slice(0, 8) });
  console.log('  捕获明细:', items.slice(0, 10).map((i) => `[${i.state}] ${i.fieldKey}=${i.pageValue}`).join(' | '));

  // 闭环2: 入库
  let saveRes = null;
  try {
    saveRes = await formFrame.evaluate(async (its) => {
      const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
      return AS.learnSave.save(profile, its, { sourceHost: location.hostname });
    }, items);
  } catch (e) { console.error('入库异常:', e.message); }
  step('捕获内容入库', saveRes && saveRes.saved > 0, saveRes);

  // 闭环3: 填充
  let fill = null;
  try {
    fill = await formFrame.evaluate(async () => {
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
  } catch (e) { console.error('填充异常:', e.message); }
  step('填充执行', fill && fill.filled > 0, fill);
  console.log('  填充明细:', fill ? JSON.stringify(fill.unmatchedItems.slice(0, 8)) : 'null');

  // 闭环4: 填充后抽检 —— 页面值核对(取已填充字段)
  if (fill && fill.filled > 0) {
    const verify = await formFrame.evaluate(() => {
      const fields = AS.scanner.scan();
      const withVal = [];
      fields.forEach((f) => {
        const v = f.type === 'select' && f.el.selectedIndex > 0 ? f.el.options[f.el.selectedIndex].textContent : f.el.value;
        if (v && !/(请选择|请输入|年月)/.test(String(v))) withVal.push({ label: (f.el.placeholder || f.el.name || '') , val: String(v).slice(0, 30) });
      });
      return withVal.slice(0, 12);
    });
    step('填充后页面值抽检', verify.length >= fill.filled, verify);
  }

  // 保存报告
  const outDir = path.join(ROOT, 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outFile = path.join(outDir, 'italent-test-' + Date.now() + '.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log('\n报告已保存:', outFile);
  await browser.close();
})().catch((e) => { console.error('崩溃:', e.message); process.exit(1); });
