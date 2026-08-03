/**
 * 真实 MOKA 页面(enflame)AI 智能补充实操验证
 * 完整信息库 → 规则填充 + AI 从信息库匹配未填字段 → 脱敏验证
 * 运行: node scripts/e2e/ai-real-e2e.js
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { server, PORT, __mockRequests } = require('./serve');

const REAL_URL = 'https://app.mokahr.com/campus-recruitment/enflame/168420?locale=zh-CN#/job/d3775a8e-1caa-465e-896d-6a073c51a1f3/apply';

const CORE = [
  'src/utils/logger.js', 'src/modules/schema.js', 'src/modules/storage.js', 'src/utils/fuzzy.js',
  'src/utils/dates.js', 'src/utils/matcher.js', 'src/modules/fill-engine.js', 'src/modules/learn-save.js',
  'src/utils/ai.js', 'src/utils/encrypt.js', 'src/content/scanner.js', 'src/content/capture.js',
  'src/content/filler.js', 'src/content/overlay.js', 'src/content/detect.js', 'src/content/quiz.js', 'src/content/content.js',
];

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name, extra ? JSON.stringify(extra).slice(0, 160) : ''); } };

const PROFILE = {
  id: 'e2e', name: '实操验证', data: {
    basic: {
      name: '王实操', phone: '13912345678', email: 'ops@test.com', gender: '男',
      ethnicity: '汉族', nativePlace: '江西 上饶市 余干县', politicalStatus: '共青团员',
      currentLocation: '杭州', birthday: '2001-06',
    },
    skills: { englishLevel: 'CET-6', certificates: '软件设计师' },
    intent: { targetCity: '杭州', targetPosition: '软件开发工程师', expectedSalary: '面议' },
    education: [{ school: '哈尔滨工程大学', major: '软件工程', degree: '本科', eduStart: '2019-09', eduEnd: '2023-06' }],
    internship: [{ intCompany: '中软国际', intPosition: 'Java开发实习生', intStart: '2022-06', intEnd: '2022-09', workContent: '参与企业级项目开发, 负责模块设计与编码' }],
    project: [], custom: [], openQuestions: [],
  },
};

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto(REAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  await page.addScriptTag({ content: `
    window.__afStore = {
      af_settings: { activeProfileId: 'e2e', conflictMode: 'skip', previewMode: false, siteFilter: { mode: 'all', blacklist: [], whitelist: [] }, ai: { enabled: true, endpoint: 'http://127.0.0.1:${PORT}', apiKey: 'sk-test', model: 'deepseek-chat', openQuestionAuto: true } },
      af_profiles: [${JSON.stringify(PROFILE)}],
    };
    window.chrome = { storage: { local: { async get(k) { if (typeof k === 'string') return { [k]: window.__afStore[k] }; const o = {}; (k || []).forEach(x => o[x] = window.__afStore[x]); return o; }, async set(o) { Object.assign(window.__afStore, o); } } }, runtime: { getManifest: () => ({ version: 'x' }), getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } } };
  ` });
  for (const rel of CORE) { try { await page.addScriptTag({ path: path.join(ROOT, rel) }); } catch (e) { console.log('注入失败', rel); } }
  await page.waitForFunction(() => document.querySelectorAll('input,select,textarea').length >= 30, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);

  // 填充前记录关键字段引用(填充后 placeholder 会消失, 无法按 placeholder 查找)
  const refs = await page.evaluate(() => {
    const find = (ph) => {
      const el = Array.from(document.querySelectorAll('input,textarea')).find((i) => (i.placeholder || '').includes(ph) && !i.readOnly);
      return el ? (el.placeholder || '') : '';
    };
    return { nativePh: find('请输入籍贯') || find('籍贯'), locPh: find('所在地') };
  });
  console.log('字段引用:', JSON.stringify(refs));

  // 一键填充(doFill)
  const res = await page.evaluate(async () => {
    const out = {};
    try {
      await AS.contentMain.doFill({ isAuto: false });
    } catch (e) { out.doFillError = e.message; }
    await new Promise((r) => setTimeout(r, 2500));
    // 关键字段检查: 按 placeholder 前缀匹配(填充后 placeholder 仍在但值已填; 取有值的)
    const getByPh = (ph) => {
      const els = Array.from(document.querySelectorAll('input,textarea'));
      const el = els.find((i) => (i.placeholder || '').includes(ph) && !i.readOnly && i.value);
      return el ? el.value : '(未填)';
    };
    out.name = getByPh('姓名');
    out.phone = getByPh('请输入手机号');
    out.email = getByPh('请输入邮箱');
    out.native = getByPh('籍贯');
    out.location = getByPh('所在地');
    out.state = window.__af_fill_state ? window.__af_fill_state.stage + ':' + (window.__af_fill_state.detail || '') : '';
    const cityInput = Array.from(document.querySelectorAll('input')).find((i) => (i.placeholder || '').includes('期望城市'));
    out.city = cityInput ? cityInput.value : '(无)';
    return out;
  }, 120000);
  console.log('填充结果:', JSON.stringify(res, null, 1));
  t('姓名(规则)填入', res.name === '王实操', res.name);
  t('手机号(规则)填入', res.phone === '13912345678', res.phone);
  t('邮箱(规则/AI)填入', res.email === 'ops@test.com' || /^[^@\s]+@[^@\s]+$/.test(res.email || ''), res.email);
  t('籍贯(规则/AI)填入', !refs.nativePh || res.native === '江西 上饶市 余干县' || res.native === '江西 上饶市', { native: res.native, hasField: !!refs.nativePh });
  t('所在地(规则/AI)填入杭州', res.location === '杭州', res.location);

  // 隐私脱敏: mock 收到的 AI 请求不含姓名/手机/邮箱
  await new Promise((r) => setTimeout(r, 500));
  const leaked = __mockRequests.filter((b) => /王实操|13912345678|ops@test\.com/.test(b));
  t('脱敏: AI 请求不含姓名/手机/邮箱', leaked.length === 0, { 请求数: __mockRequests.length, 泄露: leaked.length });
  console.log('  AI 请求数:', __mockRequests.length);
  if (__mockRequests.length) console.log('  请求样本:', __mockRequests[0].slice(0, 200));

  await browser.close();
  server.close();
  console.log(`\n真实页面 AI 实操: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('崩溃:', e.message); try { server.close(); } catch (e2) {} process.exit(1); });
