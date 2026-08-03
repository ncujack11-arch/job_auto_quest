/**
 * AI 开放题自动作答 E2E: 填充时开放题信息库无答案 → 调大模型(mock) → 答案填入
 * 运行: node scripts/e2e/ai-fill-e2e.js
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const { server, PORT } = require('./serve');

const CORE = [
  'src/utils/logger.js', 'src/modules/schema.js', 'src/modules/storage.js', 'src/utils/fuzzy.js',
  'src/utils/dates.js', 'src/utils/matcher.js', 'src/modules/fill-engine.js', 'src/modules/learn-save.js',
  'src/utils/ai.js', 'src/utils/encrypt.js', 'src/content/scanner.js', 'src/content/capture.js',
  'src/content/filler.js', 'src/content/overlay.js', 'src/content/detect.js', 'src/content/quiz.js', 'src/content/content.js',
];

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name, extra ? JSON.stringify(extra).slice(0, 160) : ''); } };

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + PORT + '/form.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.addScriptTag({ content: `
    window.__afStore = {
      af_settings: { activeProfileId: 'e2e', conflictMode: 'skip', previewMode: false, typingMode: false, siteFilter: { mode: 'all', blacklist: [], whitelist: [] }, ai: { enabled: true, endpoint: 'http://127.0.0.1:${PORT}', apiKey: 'sk-test', model: 'deepseek-chat', openQuestionAuto: true } },
      af_profiles: [{ id: 'e2e', name: 'E', data: { basic: { name: '张三', phone: '13800138000', email: 'z@qq.com' }, skills: {}, intent: {}, education: [{ school: '哈尔滨工程大学', major: '软件工程', degree: '本科' }], internship: [], project: [], custom: [], openQuestions: [] } }],
    };
    window.__afListeners = [];
    window.chrome = {
      storage: { local: { async get(k) { if (typeof k === 'string') return { [k]: window.__afStore[k] }; const o = {}; (k || []).forEach(x => o[x] = window.__afStore[x]); return o; }, async set(o) { Object.assign(window.__afStore, o); } } },
      runtime: { getManifest: () => ({ version: 'x' }), getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener: (fn) => window.__afListeners.push(fn) } },
    };
  ` });
  for (const rel of CORE) { try { await page.addScriptTag({ path: path.join(ROOT, rel) }); } catch (e) { console.log('注入失败', rel); } }
  await page.waitForTimeout(500);

  // 清空开放题与职业规划字段(模拟"页面空白+信息库无答案"场景, 确保触发 AI)
  await page.evaluate(() => {
    document.querySelectorAll('[data-test="openQuestions.intro"],[data-test="uncommon.plan"]').forEach((el) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  const intro = await page.evaluate(() => {
    const el = document.querySelector('[data-test="openQuestions.intro"]');
    return { exists: !!el, value: el ? el.value : '' };
  });
  console.log('开放题字段:', JSON.stringify(intro));
  t('开放题字段存在', intro.exists);

  if (intro.exists) {
    // 通过 doFill 触发填充(含 AI 开放题作答 + 未填好字段补充)
    const res = await page.evaluate(async () => {
      const out = {};
      const t0 = Date.now();
      try {
        await AS.contentMain.doFill({ isAuto: false });
        out.took = Date.now() - t0;
      } catch (e) {
        out.doFillError = e.message;
      }
      await new Promise((r) => setTimeout(r, 800));
      const el = document.querySelector('[data-test="openQuestions.intro"]');
      out.introValue = el ? el.value : '';
      out.introHasAI = el ? /这是AI根据我的信息生成的回答/.test(el.value) : false;
      const plan = document.querySelector('[data-test="uncommon.plan"]');
      out.planValue = plan ? plan.value : '';
      out.planHasAI = plan ? /职业规划|技术|成长/.test(plan.value) : false;
      return out;
    }, 90000);
    console.log('doFill:', JSON.stringify(res));
    t('填充执行无异常', !res.doFillError, res.doFillError);
    t('开放题被 AI 自动作答填入', !!res.introHasAI, { value: (res.introValue || '').slice(0, 60) });
    t('未填好字段(职业规划)被 AI 补充填写', !!res.planHasAI, { value: (res.planValue || '').slice(0, 60) });
    t('AI 作答耗时合理(< 15s)', (res.took || 0) < 15000, res.took);
  } else {
    console.log('  [跳过 AI 断言] 开放题字段不存在');
    t('开放题字段存在(信息性)', true);
  }

  await browser.close();
  server.close();
  console.log(`\nAI 开放题作答 E2E: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('崩溃:', e.message); try { server.close(); } catch (e2) {} process.exit(1); });
