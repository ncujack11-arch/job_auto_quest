/**
 * E2E 实操测试 v3: 随机表单 + 1:1 预填/空白 + 动态断言
 * 每次运行: 字段组合/表述/预填内容全部随机
 * 闭环: 读取页面预填 → 捕获(AS.capture.collect) → 入库(AS.learnSave.save) → 验证信息库
 *       → 补充填写 → 再捕获入库 → 填充(AS.fillEngine, 生产引擎) → 验证页面
 * 运行: node scripts/e2e/e2e-test.js
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const { server, PORT } = require('./serve');

const ROOT = path.join(__dirname, '..', '..');
const FORM_URL = 'http://127.0.0.1:' + PORT + '/form.html';

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

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name, extra ? JSON.stringify(extra).slice(0, 160) : ''); } };

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  console.log('E2E 随机表单服务已启动');

  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();

  await page.goto(FORM_URL, { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // 注入 chrome.storage stub + 核心模块
  await page.addScriptTag({ content: `
    window.__afStore = {};
    const mem = window.__afStore;
    window.chrome = {
      storage: { local: {
        async get(key) { if (typeof key === 'string') return { [key]: mem[key] }; const out = {}; (key || []).forEach((k) => { out[k] = mem[k]; }); return out; },
        async set(obj) { Object.assign(mem, obj); },
      } },
      runtime: { getManifest: () => ({ version: 'e2e' }), getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
    };
  ` });
  for (const rel of CORE_SCRIPTS) {
    await page.addScriptTag({ path: path.join(ROOT, rel) });
  }

  // 读取页面表单状态(动态断言基准)
  const formState = await page.evaluate(() => {
    const filled = [];
    const blank = [];
    const collect = (sel, getV) => {
      document.querySelectorAll(sel).forEach((el) => {
        const test = el.getAttribute('data-test');
        if (!test) return;
        const v = getV(el);
        if (v && String(v).trim() !== '' && !(el.selectedIndex === 0)) filled.push({ test, value: String(v).trim() });
        else blank.push({ test, tag: el.tagName, type: el.type || (el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : 'text') });
      });
    };
    collect('input[data-test]:not([type="radio"]):not([type="checkbox"])', (el) => el.value);
    collect('select[data-test]', (el) => (el.selectedIndex > 0 ? (el.options[el.selectedIndex].textContent || el.value) : ''));
    collect('textarea[data-test]', (el) => el.value);
    // radio / checkbox
    document.querySelectorAll('input[type="radio"]:checked').forEach((el) => {
      const wrap = el.closest('.row');
      const label = wrap ? wrap.querySelector('label:first-child').textContent.trim() : '';
      if (label) filled.push({ test: 'basic.gender', value: el.value });
    });
    document.querySelectorAll('input[type="checkbox"]:checked').forEach((el) => {
      const test = el.getAttribute('data-test');
      if (test) filled.push({ test, value: '是' });
      else blank.push({ test: 'intent.complyAssignment', tag: 'INPUT', type: 'checkbox' });
    });
    return { filled, blank };
  });
  const filledCount = formState.filled.length;
  const blankCount = formState.blank.length;
  const inputCount = await page.evaluate(() => document.querySelectorAll('input,textarea,select').length);
  console.log(`页面控件 ${inputCount} | 预填 ${filledCount} | 空白 ${blankCount}`);
  t('页面控件 ≥ 10', inputCount >= 10);
  t('1:1 内容量(预填与空白均 ≥ 3)', filledCount >= 3 && blankCount >= 3, { filledCount, blankCount });
  t('核心字段必含(姓名/手机/邮箱)', formState.filled.some((f) => f.test === 'basic.name') && formState.filled.some((f) => f.test === 'basic.phone') && formState.filled.some((f) => f.test === 'basic.email'), formState.filled.map((f) => f.test));

  // 初始化空库
  await page.evaluate(() => {
    window.__afStore.af_settings = { activeProfileId: 'e2e', conflictMode: 'skip', typingMode: false, typingMin: 30, typingMax: 120, previewMode: false, logLevel: 'info', encryption: { enabled: false, salt: '', iterations: 100000, passwordHash: '', hint: '' }, siteFilter: { mode: 'all', blacklist: [], whitelist: [] }, autoNext: false, photoDataUrl: '', refCodes: [], autoLock: true, ai: { enabled: false, endpoint: '', model: '' } };
    window.__afStore.af_profiles = [{ id: 'e2e', name: 'E2E测试', data: { basic: {}, skills: {}, intent: {}, education: [], internship: [], project: [], custom: [], openQuestions: [] } }];
  });
  const profile = () => page.evaluate(async () => (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e'));

  // ===== 闭环1: 捕获 =====
  console.log('\n== 闭环1: 捕获(预填 ' + filledCount + ' 项) ==');
  const items1 = await page.evaluate(async () => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    const [rule, memories, aliases] = await Promise.all([AS.storage.getSiteRuleForHost(location.hostname), AS.storage.getMemoriesForHost(location.hostname), AS.storage.getUserAliases()]);
    return AS.capture.collect(profile, { rule, memories, aliases });
  });
  const pageValues = formState.filled.map((f) => f.value);
  const missing = pageValues.filter((v) => !items1.some((i) => String(i.pageValue) === String(v)));
  if (missing.length) {
    console.log('  缺失值:', missing.map((v) => '[' + v + ']').join(','));
    console.log('  预填明细:', formState.filled.map((f) => `${f.test}=[${f.value}]`).join(' | '));
    console.log('  items 明细:', items1.map((i) => `${i.type}|${i.fieldKey}|${i.label}|[${i.pageValue}]`).join('\n        '));
  }
  t('捕获覆盖全部预填值', missing.length === 0);
  const byState = items1.reduce((a, i) => { a[i.state] = (a[i.state] || 0) + 1; return a; }, {});
  console.log('  捕获 items:', items1.length, '状态:', JSON.stringify(byState));

  // ===== 闭环2: 入库 =====
  console.log('\n== 闭环2: 入库 ==');
  const save1 = await page.evaluate(async (items) => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    return AS.learnSave.save(profile, items, { sourceHost: '127.0.0.1' });
  }, items1);
  console.log('  入库:', JSON.stringify(save1));
  t('入库成功', save1.saved > 0);
  const prof1 = await profile();
  // 验证每个预填值已入库(按 data-test 映射字段)
  const testToKey = { 'basic.name': 'basic.name', 'basic.phone': 'basic.phone', 'basic.email': 'basic.email', 'basic.gender': 'basic.gender', 'basic.politicalStatus': 'basic.politicalStatus', 'basic.ethnicity': 'basic.ethnicity', 'basic.overseas': 'basic.overseas', 'basic.currentLocation': 'basic.currentLocation', 'intent.targetCity': 'intent.targetCity', 'skills.englishLevel': 'skills.englishLevel', 'skills.certificates': 'skills.certificates', 'education.school': 'education.school', 'education.major': 'education.major', 'education.degree': 'education.degree', 'openQuestions.intro': 'openQuestions' };
  const storeContains = (prof, key, value) => {
    if (key === 'openQuestions') return (prof.data.openQuestions || []).some((q) => (q.answer || '').includes(value));
    if (key === 'education.school' || key === 'education.major' || key === 'education.degree') {
      const f = key.split('.')[1];
      return (prof.data.education || []).some((e) => e[f] === value);
    }
    const [cat, f] = key.split('.');
    return prof.data[cat] && prof.data[cat][f] === value;
  };
  const notStored = formState.filled.filter((f) => testToKey[f.test]).filter((f) => !storeContains(prof1, testToKey[f.test], f.value)).map((f) => f.test + '=' + f.value);
  t('入库: 全部预填值写入信息库', notStored.length === 0, { notStored: notStored.slice(0, 6) });

  // ===== 闭环3: 补充填写(空白字段随机 2-3 个)→ 再捕获入库 =====
  console.log('\n== 闭环3: 补充填写再捕获入库 ==');
  const fillTargets = formState.blank.filter((b) => b.test !== 'basic.birthday.year' && b.test !== 'basic.birthday.month' && !String(b.test).includes('nativePlace')).slice(0, 3);
  console.log('  补充填写:', fillTargets.map((f) => f.test + '/' + f.tag).join(', '));
  await page.evaluate((targets) => {
    const setV = (el, v) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    targets.forEach(({ test, tag, type }) => {
      const el = document.querySelector('[data-test="' + test + '"]');
      if (!el) return;
      if (tag === 'SELECT') {
        if (el.options.length > 1) { el.selectedIndex = 1; el.dispatchEvent(new Event('change', { bubbles: true })); }
      } else {
        setV(el, 'E2E补充' + test.replace(/[^a-zA-Z]/g, '') + String(Date.now() % 1000));
      }
    });
  }, fillTargets);
  const items2 = await page.evaluate(async () => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    return AS.capture.collect(profile, { rule: null, memories: null, aliases: null });
  });
  const byState2 = items2.reduce((a, i) => { a[i.state] = (a[i.state] || 0) + 1; return a; }, {});
  console.log('  二次捕获:', items2.length, '状态:', JSON.stringify(byState2));
  // 预填值在二次捕获中不应为 new(已入库 → same/diff)
  const prefilledNew = formState.filled.filter((f) => {
    const hit = items2.find((i) => String(i.pageValue) === String(f.value));
    return hit && hit.state === 'new';
  }).map((f) => f.test + '=' + f.value);
  t('已入库预填值不再判为 new', prefilledNew.length === 0, { prefilledNew: prefilledNew.slice(0, 5) });
  const save2 = await page.evaluate(async (items) => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    return AS.learnSave.save(profile, items, { sourceHost: '127.0.0.1' });
  }, items2);
  console.log('  二次入库:', JSON.stringify(save2));
  t('二次入库成功', save2.saved > 0);

  // ===== 闭环4: 填充(生产 fillEngine) =====
  console.log('\n== 闭环4: 填充空白字段(AS.fillEngine) ==');
  // 为空白字段设置 profile 值(按字段语义构造)
  const blankTests = formState.blank.map((b) => b.test);
  const valueFor = (test) => {
    if (test === 'basic.ethnicity') return '汉族';
    if (test === 'basic.overseas') return '否';
    if (test === 'basic.currentLocation') return '成都';
    if (test === 'intent.targetCity') return '上海';
    if (test === 'skills.englishLevel') return 'CET-6';
    if (test === 'basic.politicalStatus') return '群众';
    if (test === 'basic.gender') return '女';
    if (test === 'basic.nativePlace.province') return '浙江 杭州市 西湖区';
    if (test === 'basic.birthday.year') return '2002-06';
    if (test === 'education.major') return '人工智能';
    if (test === 'education.degree') return '硕士';
    if (test === 'basic.name') return '李四';
    if (test === 'basic.phone') return '13900001111';
    if (test === 'basic.email') return 'fill@test.com';
    return null;
  };
  const fillSet = {};
  const usableBlank = [];
  const occupied = new Set(fillTargets.map((f) => f.test)); // 闭环3 已占用字段, 闭环4 不再选
  blankTests.forEach((test) => {
    const v = valueFor(test);
    if (v && !fillSet[test] && !occupied.has(test)) { fillSet[test] = v; usableBlank.push(test); }
  });
  console.log('  将填充:', JSON.stringify(fillSet));
  await page.evaluate(async (fs2) => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    Object.entries(fs2).forEach(([test, v]) => {
      if (test === 'basic.nativePlace.province') profile.data.basic.nativePlace = v;
      else if (test === 'basic.birthday.year') profile.data.basic.birthday = v;
      else if (test === 'education.major') { profile.data.education = profile.data.education || []; if (!profile.data.education[0]) profile.data.education[0] = {}; profile.data.education[0].major = v; }
      else if (test === 'education.degree') { profile.data.education = profile.data.education || []; if (!profile.data.education[0]) profile.data.education[0] = {}; profile.data.education[0].degree = v; }
      else { const [cat, f] = test.split('.'); profile.data[cat] = profile.data[cat] || {}; profile.data[cat][f] = v; }
    });
    await chrome.storage.local.set({ af_profiles: [profile] });
  }, fillSet);

  const fillResult = await page.evaluate(async () => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles.find((p) => p.id === 'e2e');
    const rule = await AS.storage.getSiteRuleForHost(location.hostname);
    const memories = await AS.storage.getMemoriesForHost(location.hostname);
    const fields = AS.scanner.scan();
    const valueQueues = new Map();
    const plan = AS.fillEngine.buildPlan(fields, profile, rule, memories, null, null, valueQueues, null, null, location.hostname);
    const report = { filled: 0, skipped: 0, unmatched: 0, errors: 0, total: 0, infos: [], unmatchedItems: [] };
    await AS.fillEngine.executePlan(plan, null, { conflictMode: 'skip', typing: false, photoDataUrl: '' }, {
      report,
      snapshot: () => null,
      highlight: () => {},
      showProgress: () => {},
      closeProgress: () => {},
      setFillState: () => {},
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      flushMemories: async () => {},
    });
    return report;
  });
  console.log('  填充报告:', JSON.stringify(fillResult));
  t('填充至少命中 1 个字段', fillResult.filled >= 1);

  const pageAfter = await page.evaluate((tests) => {
    const out = {};
    tests.forEach((test) => {
      const el = document.querySelector('[data-test="' + test + '"]');
      if (!el) return;
      if (el.tagName === 'SELECT') out[test] = el.selectedIndex > 0 ? (el.options[el.selectedIndex].textContent || el.value) : '';
      else out[test] = el.value || '';
    });
    return out;
  }, usableBlank);
  console.log('  页面填充后:', JSON.stringify(pageAfter));
  // 分段比对: 级联/年月按拆段后的对应段期望
  const expectFor = (test) => {
    const v = String(fillSet[test]);
    if (test === 'basic.nativePlace.province') return v.split(/\s+/)[0];
    if (test === 'basic.nativePlace.city') return v.split(/\s+/)[1];
    if (test === 'basic.nativePlace.county') return v.split(/\s+/)[2];
    if (test === 'basic.birthday.year') return v.split('-')[0];
    if (test === 'basic.birthday.month') return v.split('-')[1];
    return v;
  };
  const mismatches = usableBlank.filter((test) => String(pageAfter[test] || '') !== String(expectFor(test)));
  t('填充值写入页面(逐字段比对)', mismatches.length === 0, { mismatches, pageAfter });

  await browser.close();
  server.close();
  console.log(`\nE2E 结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E 崩溃:', e); try { server.close(); } catch (e2) { /* ignore */ } process.exit(1); });
