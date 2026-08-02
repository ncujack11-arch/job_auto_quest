/**
 * italent 真实站点探测 — 打开投递表单页, 注入核心模块, 输出字段清单与可达性
 * 运行: node scripts/e2e/italent-probe.js
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const TARGET = process.env.TARGET_URL || 'https://cloud.italent.cn/PageHome/Index?product=MicroRecommend&keyName=Nusion&pageCode=DeliveryForm&appCode=MicroRecommend&submissionKey=50d16b76-ca99-484c-af85-c927c7af5959&language=zh_CN&PaaS_Lang=zh_CN&shadow_context=%7B%22elinkId%22%3A%22c1cf2d45-9fb8-462f-922f-021643d1d13e%22%7D&_qsrcapp=MicroRecommend&_qrt=html&quark_s=3f3a30db13d5e0a72c12fc40bc26618e6957c5e3030aa730036021420851657c#/viewDynamic?t=t&quark_s=ca2a9f3e372fcb28c84246c94a5133271304a379927479f62605fb16f0961807';

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

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 200)));

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('标题:', await page.title());
  console.log('URL:', page.url());
  await page.waitForTimeout(6000);

  const body = await page.evaluate(() => {
    const b = document.body;
    return b ? b.innerText.slice(0, 800) : '(no body)';
  });
  console.log('页面文本:', JSON.stringify(body));

  // 注入 stub + 核心模块
  await page.addScriptTag({ content: `
    window.__afStore = {};
    const mem = window.__afStore;
    window.chrome = {
      storage: { local: {
        async get(key) { if (typeof key === 'string') return { [key]: mem[key] }; const out = {}; (key || []).forEach((k) => { out[k] = mem[k]; }); return out; },
        async set(obj) { Object.assign(mem, obj); },
      } },
      runtime: { getManifest: () => ({ version: 'probe' }), getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
    };
  ` });
  for (const rel of CORE_SCRIPTS) {
    try { await page.addScriptTag({ path: path.join(ROOT, rel) }); }
    catch (e) { logs.push('注入失败 ' + rel + ': ' + e.message); }
  }

  const res = await page.evaluate(() => {
    const fields = AS.scanner.scan();
    const detail = fields.map((f) => {
      const el = f.el;
      return {
        type: f.type,
        label: (() => {
          try { return AS.matcher.buildContext(el).labelText || ''; } catch (e) { return ''; }
        })(),
        placeholder: el.placeholder || '',
        name: el.name || '',
        visible: (() => { try { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; } catch (e) { return false; } })(),
        outer: (el.outerHTML || '').slice(0, 110),
      };
    });
    return { total: fields.length, fields: detail, iframes: document.querySelectorAll('iframe').length };
  });
  console.log('扫描字段数:', res.total, '| iframes:', res.iframes);
  res.fields.slice(0, 40).forEach((f) => {
    console.log(`  [${f.type}] ${f.label || '(无标签)'} | ph=${f.placeholder} | name=${f.name} | vis=${f.visible}`);
    console.log(`      ${f.outer}`);
  });

  console.log('\n页面日志(前 12 条):');
  logs.slice(0, 12).forEach((l) => console.log('  ', l));
  await browser.close();
})().catch((e) => { console.error('崩溃:', e.message); process.exit(1); });
