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
      af_profiles: [{ id: 'e2e', name: 'E', data: { basic: { name: '张三', phone: '13800138000', email: 'z@qq.com', ethnicity: '汉族', nativePlace: '江西 上饶市', politicalStatus: '共青团员', currentLocation: '杭州' }, skills: {}, intent: {}, education: [{ school: '哈尔滨工程大学', major: '软件工程', degree: '本科' }], internship: [], project: [], custom: [], openQuestions: [] } }],
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
      // 硬信息 AI 匹配: 页面字段存在且规则未填上(空白)时, AI 应从信息库填入真实值
      const ethn = document.querySelector('[data-test="basic.ethnicity"]');
      const polit = document.querySelector('[data-test="basic.politicalStatus"]');
      const nat = document.querySelector('[data-test="basic.nativePlace.province"]');
      out.ethnicity = ethn ? ethn.value : '';
      out.political = polit ? polit.value : '';
      out.native = nat ? nat.value : '';
      // 规则匹配不上才轮到 AI: 只有空白且字段存在时断言 AI 填入
      const ethOk = !ethn || !!ethn.value || ethn.value === '汉族';
      const polOk = !polit || !!polit.value || polit.value === '共青团员';
      out.hardFilled = ethOk && polOk;
      return out;
    }, 90000);
    console.log('doFill:', JSON.stringify(res));
    t('填充执行无异常', !res.doFillError, res.doFillError);
    t('开放题被 AI 自动作答填入', !!res.introHasAI, { value: (res.introValue || '').slice(0, 60) });
    t('硬信息字段(民族/政治面貌)有值或 AI 已填', !!res.hardFilled, { ethnicity: res.ethnicity, political: res.political });
    t('AI 作答耗时合理(< 15s)', (res.took || 0) < 15000, res.took);
  } else {
    console.log('  [跳过 AI 断言] 开放题字段不存在');
    t('开放题字段存在(信息性)', true);
  }
  // matchFromLibrary 单元验证: AI 从信息库提取真实值(绝不编造)
  const ml = await page.evaluate(async () => {
    const out = {};
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles[0];
    out.ethn = await AS.ai.matchFromLibrary('民族', ['汉族', '回族'], profile, '测试');
    out.polit = await AS.ai.matchFromLibrary('政治面貌', [], profile, '测试');
    out.none = await AS.ai.matchFromLibrary('不存在的字段xyz', [], profile, '测试');
    return out;
  }, 90000);
  console.log('matchFromLibrary:', JSON.stringify(ml));
  t('matchFromLibrary: 民族从信息库提取"汉族"', ml.ethn === '汉族', ml.ethn);
  t('matchFromLibrary: 政治面貌提取"共青团员"', ml.polit === '共青团员', ml.polit);
  t('matchFromLibrary: 信息库无对应 → 跳过(空)', ml.none === '', ml.none);
  // 隐私脱敏验证: 发给 AI 的摘要不含姓名/手机号/邮箱
  const mask = await page.evaluate(async () => {
    const profile = (await chrome.storage.local.get('af_profiles')).af_profiles[0];
    const sum = AS.ai.profileToSummary(profile);
    return { hasName: sum.includes('张三'), hasPhone: sum.includes('13800138000'), hasEmail: sum.includes('z@qq.com'), sum: sum.slice(0, 80) };
  }, 90000);
  console.log('脱敏摘要:', JSON.stringify(mask));
  t('脱敏: AI 摘要不含姓名', mask.hasName === false, mask);
  t('脱敏: AI 摘要不含手机号', mask.hasPhone === false, mask);
  t('脱敏: AI 摘要不含邮箱', mask.hasEmail === false, mask);

  await browser.close();
  server.close();
  console.log(`\nAI 开放题作答 E2E: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('崩溃:', e.message); try { server.close(); } catch (e2) {} process.exit(1); });
