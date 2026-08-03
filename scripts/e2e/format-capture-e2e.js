/**
 * 捕获表单格式 完整闭环实操: 扫描 → 格式捕获 → 入库 → 填值 → 填充验证
 * 环境1: 真实 MOKA 页面(enflame)  环境2: 自建随机表单(含未知字段)
 * 运行: node scripts/e2e/format-capture-e2e.js
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..', '..');
const { server, PORT } = require('./serve');

const REAL_URL = process.env.TARGET_URL || 'https://app.mokahr.com/campus-recruitment/enflame/168420?locale=zh-CN#/job/d3775a8e-1caa-465e-896d-6a073c51a1f3/apply';

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
      runtime: { getManifest: () => ({ version: 'fmt-e2e' }), getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
    });
  }
`;

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name, extra ? JSON.stringify(extra).slice(0, 180) : ''); } };

function emptyProfile() {
  return { id: 'e2e', name: '格式测试', data: { basic: {}, skills: {}, intent: {}, education: [], internship: [], project: [], custom: [], openQuestions: [] } };
}

async function inject(page) {
  await page.addScriptTag({ content: STUB });
  for (const rel of CORE_SCRIPTS) {
    try { await page.addScriptTag({ path: path.join(ROOT, rel) }); }
    catch (e) { console.log('注入失败', rel); }
  }
}

// ============ 环境1: 真实 MOKA 页面 ============
async function realPageTest(browser) {
  console.log('\n========== 环境1: 真实 MOKA 页面(enflame) ==========');
  const page = await browser.newPage();
  await page.goto(REAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  await inject(page);

  const res = await page.evaluate(async () => {
    const out = {};
    await chrome.storage.local.set({ af_profiles: [{
      id: 'e2e', name: '格式测试', data: { basic: {}, skills: {}, intent: {}, education: [], internship: [], project: [], custom: [], openQuestions: [] },
    }] });
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles[0];
    const rule = await AS.storage.getSiteRuleForHost(location.hostname);

    // 1. 格式捕获
    const items = await AS.capture.collectEmptyFields(profile, { rule });
    out.capturedCount = items.length;
    out.sample = items.slice(0, 6).map((i) => ({ label: i.label, ctype: i.ctype, options: (i.options || []).slice(0, 3) }));
    const save = await AS.learnSave.save(profile, items, { sourceHost: location.hostname });
    out.save = save;

    // 2. 给捕获的自定义字段填值(模拟用户有空再填写)
    const prof2 = (await chrome.storage.local.get('af_profiles')).af_profiles[0];
    const customs = prof2.data.custom || [];
    const toFill = customs.slice(0, 3).map((c, i) => {
      const val = ['内推人小王', '15K', '校园招聘'][i] || '测试值';
      c.value = val;
      c._pending = false;
      return { key: c.key, label: c.label, value: val };
    });
    out.filledCustoms = toFill;
    await chrome.storage.local.set({ af_profiles: [prof2] });

    // 3. 重新填充: 匹配自定义字段并写入页面
    const prof3 = (await chrome.storage.local.get('af_profiles')).af_profiles[0];
    const memories = await AS.storage.getMemoriesForHost(location.hostname);
    const fields = AS.scanner.scan();
    const vq = new Map();
    const plan = AS.fillEngine.buildPlan(fields, prof3, rule, memories, null, null, vq, null, null, location.hostname);
    const customPlan = plan.items.filter((it) => it.fieldKey.startsWith('custom.'));
    out.customPlan = customPlan.map((it) => ({ key: it.fieldKey, value: it.value, label: it.label, ph: it.field.el.placeholder }));
    const rep = { filled: 0, skipped: 0, unmatched: 0, errors: 0, total: 0, infos: [], unmatchedItems: [] };
    await AS.fillEngine.executePlan({ items: customPlan }, null, { conflictMode: 'overwrite', typing: false, photoDataUrl: '' }, {
      report: rep, snapshot: () => null, highlight: () => {}, showProgress: () => {}, closeProgress: () => {},
      setFillState: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), flushMemories: async () => {},
    });
    await new Promise((r) => setTimeout(r, 1000));
    out.fillReport = rep;
    // 4. 验证页面值
    const verify = [];
    customPlan.forEach((it) => {
      const el = it.field.el;
      const v = el && el.value !== undefined ? el.value : '';
      verify.push({ label: it.label, expected: it.value, pageValue: v, ok: v === it.value });
    });
    out.verify = verify;
    return out;
  }, 120000);

  console.log('捕获数量:', res.capturedCount);
  console.log('捕获样本:', JSON.stringify(res.sample));
  console.log('入库:', JSON.stringify(res.save));
  console.log('填入值:', JSON.stringify(res.filledCustoms));
  console.log('填充计划(custom):', JSON.stringify(res.customPlan));
  console.log('填充报告:', JSON.stringify(res.fillReport));
  console.log('页面验证:', JSON.stringify(res.verify));
  t('真实页面: 格式捕获 ≥ 2 项', res.capturedCount >= 2, res.capturedCount);
  t('真实页面: 捕获内容入库', res.save && res.save.added >= 2, res.save);
  t('真实页面: 填值后可匹配为 custom 字段', res.customPlan && res.customPlan.length >= 1, res.customPlan);
  t('真实页面: 填充写入页面', res.verify && res.verify.length >= 1 && res.verify.every((v) => v.ok), res.verify);
  await page.close();
}

// ============ 环境2: 自建随机表单 ============
async function localFormTest(browser) {
  console.log('\n========== 环境2: 自建随机表单(含未知字段) ==========');
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + PORT + '/form.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await inject(page);
  const res = await page.evaluate(async () => {
    const out = {};
    await chrome.storage.local.set({ af_profiles: [{
      id: 'e2e', name: '格式测试', data: { basic: {}, skills: {}, intent: {}, education: [], internship: [], project: [], custom: [], openQuestions: [] },
    }] });
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles[0];
    const rule = await AS.storage.getSiteRuleForHost(location.hostname);
    // 1. 格式捕获
    const items = await AS.capture.collectEmptyFields(profile, { rule });
    out.captured = items.map((i) => i.label);
    await AS.learnSave.save(profile, items, { sourceHost: '127.0.0.1' });
    // 2. 填值
    const prof2 = (await chrome.storage.local.get('af_profiles')).af_profiles[0];
    const customs = prof2.data.custom || [];
    customs.forEach((c) => {
      if (c.label.includes('推荐人')) c.value = '张推荐';
      else if (c.label.includes('来源')) c.value = '牛客网';
      else if (c.label.includes('薪资')) c.value = '12K';
    });
    await chrome.storage.local.set({ af_profiles: [prof2] });
    // 3. 填充匹配
    const prof3 = (await chrome.storage.local.get('af_profiles')).af_profiles[0];
    const fields = AS.scanner.scan();
    const vq = new Map();
    const plan = AS.fillEngine.buildPlan(fields, prof3, rule, null, null, null, vq, null, null, location.hostname);
    const customPlan = plan.items.filter((it) => it.fieldKey.startsWith('custom.'));
    out.customPlan = customPlan.map((it) => ({ key: it.fieldKey, value: it.value, label: it.label }));
    const rep = { filled: 0, skipped: 0, unmatched: 0, errors: 0, total: 0, infos: [], unmatchedItems: [] };
    await AS.fillEngine.executePlan({ items: customPlan }, null, { conflictMode: 'overwrite', typing: false, photoDataUrl: '' }, {
      report: rep, snapshot: () => null, highlight: () => {}, showProgress: () => {}, closeProgress: () => {},
      setFillState: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), flushMemories: async () => {},
    });
    await new Promise((r) => setTimeout(r, 500));
    out.fillReport = rep;
    // 4. 页面验证
    const verify = [];
    customPlan.forEach((it) => {
      const el = it.field.el;
      const v = el && el.value !== undefined ? el.value : '';
      verify.push({ label: it.label, expected: it.value, pageValue: v, ok: v === it.value });
    });
    out.verify = verify;
    return out;
  }, 90000);
  console.log('捕获:', JSON.stringify(res.captured));
  console.log('custom 计划:', JSON.stringify(res.customPlan));
  console.log('填充报告:', JSON.stringify(res.fillReport));
  console.log('页面验证:', JSON.stringify(res.verify));
  t('自建表单: 未知字段被格式捕获(推荐人/薪资)', res.captured.some((l) => l.includes('推荐人')) && res.captured.some((l) => l.includes('薪资')), res.captured);
  t('自建表单: 填值后可匹配填充', res.customPlan.length >= 2, res.customPlan);
  t('自建表单: 填充写入页面', res.verify.length >= 2 && res.verify.every((v) => v.ok), res.verify);
  await page.close();
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  await realPageTest(browser);
  await localFormTest(browser);
  await browser.close();
  server.close();
  console.log(`\n格式捕获闭环: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('崩溃:', e.message); try { server.close(); } catch (e2) {} process.exit(1); });
