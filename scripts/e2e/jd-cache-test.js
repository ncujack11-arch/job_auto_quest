/**
 * JD 详情页缓存 → 投递表单页回退 全链路验证
 * 步骤: 打开岗位详情页 → 注入 → cacheCurrentJD → 检查缓存
 *       打开投递表单页(同岗位) → matchCachedJD → 校验通过
 *       打开无关页面 → matchCachedJD → 校验拒绝(防串台)
 */
'use strict';
const { chromium } = require('playwright-core');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const JOB_ID = 'd768bd4a-a1a2-4339-8e37-704d2a687e73';
const DETAIL_URL = `https://app.mokahr.com/campus-recruitment/honganrobots/150155?sessionid=#/job/${JOB_ID}`;
const APPLY_URL = `https://app.mokahr.com/campus-recruitment/honganrobots/150155?sessionid=#/job/${JOB_ID}/apply`;
const OTHER_URL = `https://app.mokahr.com/campus-recruitment/honganrobots/150155?sessionid=#/job/00000000-0000-0000-0000-000000000000`;

const CORE = ['src/utils/logger.js','src/modules/schema.js','src/modules/storage.js','src/utils/fuzzy.js','src/utils/dates.js','src/utils/matcher.js','src/modules/fill-engine.js','src/utils/encrypt.js','src/content/scanner.js','src/content/capture.js','src/content/filler.js','src/modules/learn-save.js','src/content/overlay.js','src/content/content.js'];

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name, extra ? JSON.stringify(extra).slice(0, 140) : ''); } };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });

  // ===== 1. 岗位详情页: 自动缓存 JD =====
  const page = await ctx.newPage();
  await page.goto(DETAIL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  await page.addScriptTag({ content: `
    window.__afStore = window.__afStore || {};
    const mem = window.__afStore;
    if (!window.chrome || !window.chrome.storage) {
      window.chrome = Object.assign(window.chrome || {}, {
        storage: { local: {
          async get(key) { if (typeof key === 'string') return { [key]: mem[key] }; const out = {}; (key || []).forEach((k) => { out[k] = mem[k]; }); return out; },
          async set(obj) { Object.assign(mem, obj); },
        } },
        runtime: { getManifest: () => ({ version: 'jd-test' }), getURL: (p) => p, sendMessage: async () => ({ ok: true }), onMessage: { addListener() {} } },
      });
    }
  ` });
  for (const rel of CORE) { try { await page.addScriptTag({ path: path.join(ROOT, rel) }); } catch (e) { console.log('注入失败', rel); } }
  console.log('\n== 阶段1: 岗位详情页自动缓存 ==');
  const detail = await page.evaluate(async () => {
    const isDetail = AS.contentMain && (await (async () => {
      try { return AS.contentMain.isJDPageLike ? AS.contentMain.isJDPageLike() : null; } catch (e) { return null; }
    })());
    const cached = await chrome.storage.local.get('af_last_jd');
    return { cached: cached.af_last_jd || null };
  });
  // content.js 注入后 1.5s 自动缓存; 若没触发则手动调用
  await page.waitForTimeout(3000);
  const detail2 = await page.evaluate(async () => {
    const r = await chrome.storage.local.get('af_last_jd');
    return r.af_last_jd || null;
  });
  t('详情页自动缓存 JD', !!detail2 && !!detail2.jdSnapshot && detail2.jdSnapshot.length > 60, detail2 ? { len: detail2.jdSnapshot.length, jobId: detail2.jobId, company: detail2.company } : null);
  if (detail2) console.log('  缓存:', JSON.stringify({ company: detail2.company, position: detail2.position, jobId: detail2.jobId, jdLen: detail2.jdSnapshot.length, hostname: detail2.hostname }));

  // ===== 2. 投递表单页(同岗位): 校验通过 =====
  const page2 = await ctx.newPage();
  await page2.goto(APPLY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page2.waitForTimeout(8000);
  await page2.addScriptTag({ content: `window.__afStore = ${JSON.stringify({ af_last_jd: detail2 })}; window.chrome={storage:{local:{async get(k){ if(typeof k==='string') return {[k]: window.__afStore[k]}; const o={};(k||[]).forEach(x=>o[x]=window.__afStore[x]); return o;},async set(o){Object.assign(window.__afStore,o);}}},runtime:{getManifest:()=>({version:'jd-test'}),getURL:(p)=>p,sendMessage:async()=>({ok:true}),onMessage:{addListener(){}}}};` });
  for (const rel of CORE) { try { await page2.addScriptTag({ path: path.join(ROOT, rel) }); } catch (e) { /* ignore */ } }
  console.log('\n== 阶段2: 投递表单页回退校验(同岗位) ==');
  const applyCheck = await page2.evaluate(async () => {
    const m = await (async () => {
      try { return AS.contentMain.matchCachedJD ? await AS.contentMain.matchCachedJD() : null; } catch (e) { return { err: e.message }; }
    })();
    return m;
  });
  t('同岗位表单页: 校验通过并回退 JD', !!applyCheck && !!applyCheck.jdSnapshot, applyCheck ? { src: applyCheck.sourceLabel } : null);

  // ===== 3. 无关岗位页: 校验拒绝(防串台) =====
  const page3 = await ctx.newPage();
  await page3.goto(OTHER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page3.waitForTimeout(8000);
  await page3.addScriptTag({ content: `window.__afStore = ${JSON.stringify({ af_last_jd: detail2 })}; window.chrome={storage:{local:{async get(k){ if(typeof k==='string') return {[k]: window.__afStore[k]}; const o={};(k||[]).forEach(x=>o[x]=window.__afStore[x]); return o;},async set(o){Object.assign(window.__afStore,o);}}},runtime:{getManifest:()=>({version:'jd-test'}),getURL:(p)=>p,sendMessage:async()=>({ok:true}),onMessage:{addListener(){}}}};` });
  for (const rel of CORE) { try { await page3.addScriptTag({ path: path.join(ROOT, rel) }); } catch (e) { /* ignore */ } }
  console.log('\n== 阶段3: 无关岗位页回退校验(防串台) ==');
  const otherCheck = await page3.evaluate(async () => {
    try { return AS.contentMain.matchCachedJD ? await AS.contentMain.matchCachedJD() : null; } catch (e) { return { err: e.message }; }
  });
  t('不同岗位页: 拒绝回退(null)', otherCheck === null, otherCheck);

  await browser.close();
  console.log(`\nJD 缓存链路验证: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('崩溃:', e.message); try { process.exit(1); } catch (e2) {} });
