// 复现: 捕获入库 saved=0 问题 + 学习链路检测
'use strict';
const path = require('path');
const ROOT = require('path').join(__dirname, '..', '..', 'src');

// ---- chrome.storage stub ----
const memStore = {};
global.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === 'string') return { [key]: memStore[key] };
        const out = {};
        (key || []).forEach((k) => { out[k] = memStore[k]; });
        return out;
      },
      async set(obj) { Object.assign(memStore, obj); },
    },
  },
  runtime: { sendMessage: async () => ({ ok: true }) },
};

function load(rel) {
  (0, eval)(require('fs').readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, ''));
}
load('utils/logger.js');
load('modules/schema.js');
load('modules/storage.js');
load('utils/fuzzy.js');
load('utils/dates.js');
load('utils/matcher.js');
load('utils/encrypt.js');
load('modules/applications.js');

const AS = global.AS;
let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name); } };

// ---- 后台 AF_LEARN_SAVE 核心逻辑(与 service-worker.js 一致) ----
async function backgroundLearnSave(profile, items, settings) {
  if (!profile) return { saved: 0, error: '无信息方案' };
  const d = profile.data;
  let saved = 0;
  const skipped = [];
  for (const it of items || []) {
    if (!it || it.value === undefined || it.value === null || String(it.value).trim() === '') { skipped.push('empty'); continue; }
    if (it.type === 'openQuestions') {
      d.openQuestions = d.openQuestions || [];
      const dup = d.openQuestions.some((q) => q.question === it.question && q.answer === it.answer);
      if (!dup) { d.openQuestions.push({ question: it.question || '开放题', answer: String(it.value).trim() }); saved++; }
      else skipped.push('oq-dup');
      continue;
    }
    if (it.type === 'custom') {
      d.custom = d.custom || [];
      const exist = d.custom.find((c) => c.key === it.key);
      if (exist) {
        if (String(exist.value) !== String(it.value).trim()) {
          exist.value = String(it.value).trim();
          exist.label = exist.label || it.label;
          saved++;
        }
      } else {
        d.custom.push({ key: it.key || 'f' + Date.now().toString(36), label: it.label || '自定义', value: String(it.value).trim() });
        saved++;
      }
      continue;
    }
    const base = String(it.fieldKey || '').replace(/\[\d+\]/g, '');
    const [catId, key] = base.split('.');
    const cat = AS.schema.findCategory(catId);
    if (!cat || !key || cat.repeatable) { skipped.push('no-cat:' + base); continue; }
    let val = String(it.value).trim();
    const def = AS.schema.getFieldDef(base);
    if (def && def.sensitive && settings.encryption && settings.encryption.enabled) {
      if (AS.encrypt.hasKey()) {
        try { val = await AS.encrypt.encryptWithSession(val); } catch (e) { /* noop */ }
      } else { skipped.push('locked'); continue; }
    }
    if (d[catId] === undefined) { skipped.push('missing-' + catId); continue; }
    if (d[catId][key] !== val) { d[catId][key] = val; saved++; }
    else skipped.push('same:' + base);
  }
  return { saved, skipped };
}

// ---- 收集端逻辑(与 content.js collectManualInputs 一致) ----
function collectSimulate(profile, rule, fields) {
  const items = [];
  for (const f of fields) {
    const ctx = f.ctx;
    const value = f.value;
    if (!value) continue;
    if (AS.matcher.isOpenQuestionField(ctx)) {
      const question = (ctx.labelText || ctx.placeholder || ctx.name || '开放题').slice(0, 60);
      const answer = value;
      // 与库去重(与 content.js collectManualInputs 修复一致)
      const inLibrary = (profile.data.openQuestions || []).some((q) => q.question === question && q.answer === answer);
      if (!inLibrary) items.push({ type: 'openQuestions', question, answer: value, value });
      continue;
    }
    const m = AS.matcher.matchField(ctx, rule);
    if (m) {
      const base = m.fieldKey.replace(/\[\d+\]/g, '');
      const [catId] = base.split('.');
      const cat = AS.schema.findCategory(catId);
      if (cat && !cat.repeatable && catId !== 'openQuestions') {
        const vals = AS.matcher.resolveValues(profile, m.fieldKey);
        if (!vals.includes(value)) items.push({ type: 'field', fieldKey: m.fieldKey, catId, key: base.split('.')[1], label: ctx.labelText || 'x', value });
      }
      continue;
    }
    // 未匹配字段 → 智能收录为自定义字段
    const labelText = ctx.labelText || ctx.placeholder || ctx.name || '';
    const key = labelText ? AS.fuzzy.normalize(labelText).slice(0, 20) : '';
    if (key && key.length >= 2 && !/(验证码|captcha|滑块|校验码)/i.test(labelText)) {
      items.push({ type: 'custom', key, label: labelText.slice(0, 20), value });
    }
  }
  return items;
}

(async () => {
  console.log('== 学习链路: 收集 → 保存 ==');
  const profile = {
    id: 'p1', name: '测试', data: {
      basic: { name: '张三', phone: '' },
      skills: {}, intent: {}, education: [], internship: [], project: [], custom: [], openQuestions: [],
    },
  };
  await AS.storage.saveProfile(profile);
  const settings = await AS.storage.getSettings();

  // 模拟页面字段: 姓名(相同值)、手机号(新值)、邮箱(新值)、期望岗位
  const mkCtx = (o) => Object.assign({ tag: 'input', type: 'text', name: '', id: '', placeholder: '', ariaLabel: '', dataTexts: [], labelText: '', rowText: '', prevText: '' }, o);
  const fields = [
    { ctx: mkCtx({ labelText: '姓名' }), value: '张三' },        // 与库相同 → 不应收集
    { ctx: mkCtx({ labelText: '手机号' }), value: '13900000001' }, // 新值 → 收集
    { ctx: mkCtx({ labelText: '邮箱' }), value: 'a@b.com' },      // 新值 → 收集
    { ctx: mkCtx({ labelText: '期望岗位' }), value: '前端开发' },  // 新值 → 收集
  ];
  const items = collectSimulate(profile, null, fields);
  t('收集: 姓名相同值被过滤(3项)', items.length === 3);
  t('收集: 手机号项', items.some((i) => i.fieldKey === 'basic.phone'));
  t('收集: 期望岗位项', items.some((i) => i.fieldKey === 'intent.targetPosition'));

  // 后台保存
  const r = await backgroundLearnSave(profile, items, settings);
  console.log('  保存结果:', JSON.stringify({ saved: r.saved, skipped: r.skipped }));
  t('保存: 3 项入库', r.saved === 3);
  const after = await AS.storage.getProfile('p1');
  t('保存后 phone 正确', after.data.basic.phone === '13900000001');
  t('保存后 targetPosition 正确', after.data.intent.targetPosition === '前端开发');

  // 再次保存相同 items → 应 saved=0(去重)
  const r2 = await backgroundLearnSave(profile, items, settings);
  t('重复导入 saved=0(去重生效)', r2.saved === 0);

  // 开放题收集
  const oqFields = [
    { ctx: mkCtx({ labelText: '请做一下自我介绍' }), value: '我叫张三' },
    { ctx: mkCtx({ labelText: '为什么想加入我们公司' }), value: '因为技术氛围好' },
  ];
  const oqItems = collectSimulate(profile, null, oqFields);
  t('开放题收集 2 项', oqItems.length === 2);
  const r3 = await backgroundLearnSave(profile, oqItems, settings);
  t('开放题保存 2 项', r3.saved === 2);

  // 修复验证: 库中已有相同开放题答案 → 收集时应过滤
  const oqSame = [
    { ctx: mkCtx({ labelText: '请做一下自我介绍' }), value: '我叫张三' }, // 已入库
    { ctx: mkCtx({ labelText: '为什么想加入我们公司' }), value: '因为技术氛围好' }, // 已入库
  ];
  const oqSameItems = collectSimulate(profile, null, oqSame);
  t('修复: 开放题与库相同值被过滤(0项)', oqSameItems.length === 0);
  const r3b = await backgroundLearnSave(profile, oqSameItems, settings);
  t('修复: 重复开放题导入 saved=0', r3b.saved === 0);

  // 混合场景: 2 新 + 1 相同 → 只收集 2 新
  const mixedFields = [
    { ctx: mkCtx({ labelText: '请做一下自我介绍' }), value: '我叫张三' },       // 相同
    { ctx: mkCtx({ labelText: '您的职业规划是什么' }), value: '深耕技术路线' },  // 新
    { ctx: mkCtx({ labelText: '邮箱' }), value: 'new@mail.com' },               // 新
  ];
  const mixedItems = collectSimulate(profile, null, mixedFields);
  t('混合场景只收集 2 项新值', mixedItems.length === 2);

  // 智能收录: 未匹配字段自动生成 custom 条目
  const unknownFields = [
    { ctx: mkCtx({ labelText: '是否愿意服从调剂' }), value: '是' },
    { ctx: mkCtx({ labelText: '有无特殊技能爱好' }), value: '摄影' },
  ];
  const unknownItems = collectSimulate(profile, null, unknownFields);
  t('智能收录: 未知字段生成 2 个 custom 条目', unknownItems.length === 2 && unknownItems.every((i) => i.type === 'custom'));
  const r6 = await backgroundLearnSave(profile, unknownItems, settings);
  t('智能收录: custom 条目入库', r6.saved === 2);
  const profAfter = await AS.storage.getProfile(profile.id);
  t('智能收录: 信息库 custom 含新字段', (profAfter.data.custom || []).some((c) => c.key === '是否愿意服从调剂' && c.value === '是'));
  // 再次收录相同字段不同值 → 更新而非新增
  const r7 = await backgroundLearnSave(profile, [{ type: 'custom', key: '是否愿意服从调剂', label: '是否愿意服从调剂', value: '否' }], settings);
  const profAfter2 = await AS.storage.getProfile(profile.id);
  t('智能收录: 同 key 更新值不重复新增', r7.saved === 1 && (profAfter2.data.custom || []).filter((c) => c.key === '是否愿意服从调剂').length === 1 && profAfter2.data.custom.find((c) => c.key === '是否愿意服从调剂').value === '否');
  // 自定义字段参与后续填充匹配
  const cm = AS.matcher.matchCustomField(mkCtx({ labelText: '是否愿意服从调剂' }), profAfter2);
  t('智能收录: 自定义字段可被再次匹配填充', !!cm && cm.fieldKey === 'custom.是否愿意服从调剂');
  const cv = AS.matcher.resolveValues(profAfter2, 'custom.是否愿意服从调剂');
  t('智能收录: 自定义字段值解析', cv.length === 1 && cv[0] === '否');

  // 敏感字段加密路径
  const s2 = await AS.storage.saveSettings({ encryption: { enabled: true, salt: 's', iterations: 100, passwordHash: 'x', hint: '' } });
  const encItems = [{ type: 'field', fieldKey: 'basic.idCard', value: '110101199001011234' }];
  const r4 = await backgroundLearnSave(profile, encItems, s2);
  t('未解锁时敏感字段跳过(locked)', r4.saved === 0 && r4.skipped.includes('locked'));

  // 缺少分类对象 → 防御
  const brokenProfile = { id: 'p2', name: 'broken', data: { basic: undefined, custom: [] } };
  const r5 = await backgroundLearnSave(brokenProfile, [{ type: 'field', fieldKey: 'basic.name', value: '李四' }], settings);
  t('缺少分类对象不崩溃(missing-basic)', r5.saved === 0 && r5.skipped.includes('missing-basic'));

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试崩溃:', e); process.exit(1); });
