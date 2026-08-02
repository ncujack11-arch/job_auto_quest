// 视图行为测试: apps(台账)/questions(题库)/rules(规则)/settings(设置) 实际交互
'use strict';
const path = require('path');
const ROOT = require('path').join(__dirname, '..', '..', 'src');

// ---------- DOM stub(与 ui-test 一致) ----------
class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this._classes = new Set();
    this.value = '';
    this._text = '';
    this.checked = false;
    this.disabled = false;
    this.isConnected = true;
    this.id = '';
    this.parentNode = null;
    this.type = '';
    this.name = '';
    this.placeholder = '';
    this.accept = '';
    this.className = '';
    this.maxLength = -1;
    this.files = null;
    this.selectedOptions = [];
    this.options = [];
  }
  appendChild(c) { if (c) { this.children.push(c); c.parentNode = this; } return c; }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'id') { this.id = String(v); global._idMap[String(v)] = this; }
    if (k === 'class') { this.className = String(v); this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    if (k === 'placeholder') this.placeholder = String(v);
    if (k === 'type') this.type = String(v);
    if (k === 'name') this.name = String(v);
    if (k === 'value') this.value = String(v);
    if (k === 'accept') this.accept = String(v);
    if (k === 'maxlength') this.maxLength = parseInt(v, 10) || -1;
    if (k === 'disabled') this.disabled = true;
  }
  getAttribute(k) { return this.attributes[k] !== undefined ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; if (k === 'id' && this.id) { delete global._idMap[this.id]; this.id = ''; } }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { if (this.listeners[t]) this.listeners[t] = this.listeners[t].filter((f) => f !== fn); }
  dispatchEvent() { return true; }
  click() { (this.listeners['click'] || []).forEach((fn) => fn({ target: this })); }
  focus() {}
  blur() {}
  scrollIntoView() {}
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter((c) => c !== this); } this.isConnected = false; }
  get classList() {
    const self = this;
    return { add: (...c) => c.forEach((x) => self._classes.add(x)), remove: (...c) => c.forEach((x) => self._classes.delete(x)), contains: (x) => self._classes.has(x), toggle: (x) => { if (self._classes.has(x)) self._classes.delete(x); else self._classes.add(x); } };
  }
  get textContent() { if (!this.children.length) return this._text; return this._text + this.children.map((c) => (c.textContent || '')).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  matches(sel) { return matchSel(this, sel); }
  querySelector(sel) { return queryIn(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryIn(this, sel); }
  closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parentNode; } return null; }
  getBoundingClientRect() { return { width: 100, height: 30, left: 0, top: 0 }; }
}
function matchSel(el, sel) {
  const s = String(sel).trim();
  if (s.startsWith('#')) return el.id === s.slice(1);
  if (s.startsWith('.')) return el._classes.has(s.slice(1));
  if (/^[a-zA-Z]+$/.test(s)) return el.tagName === s.toUpperCase();
  return el.tagName === s.toUpperCase() + 'S';
}
function queryIn(root, sel) {
  const out = [];
  const walk = (node) => { if (node !== root && matchSel(node, sel)) out.push(node); (node.children || []).forEach(walk); };
  walk(root);
  return out;
}
global._idMap = {};
global.document = {
  createElement: (t) => new FakeEl(t),
  createTextNode: (s) => { const n = new FakeEl('#text'); n.textContent = s; return n; },
  getElementById: (id) => global._idMap[id] || null,
  querySelector: (sel) => { if (sel.startsWith('#')) return global._idMap[sel.slice(1)] || null; return queryIn(global.document.body, sel)[0] || null; },
  querySelectorAll: (sel) => { if (sel.startsWith('#')) return global._idMap[sel.slice(1)] ? [global._idMap[sel.slice(1)]] : []; return queryIn(global.document.body, sel); },
  body: new FakeEl('body'),
  documentElement: new FakeEl('html'),
  addEventListener() {},
};
global.window = global;
global.addEventListener = () => {};
global.location = { hash: '#/applications', href: 'chrome-extension://test/options.html', hostname: 'test' };
Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
global.prompt = () => null;
global.confirm = () => true;

// IndexedDB 最小 stub(设置页简历文件展示用)
global.indexedDB = {
  open() {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      req.result = {
        createObjectStore() {},
        transaction() {
          return {
            objectStore() {
              return {
                get() { const r2 = { onsuccess: null, onerror: null, result: null }; setTimeout(() => { if (r2.onsuccess) r2.onsuccess(); }, 0); return r2; },
                put() { const r2 = { onsuccess: null, onerror: null }; setTimeout(() => { if (r2.onsuccess) r2.onsuccess(); }, 0); return r2; },
                delete() { const r2 = { onsuccess: null, onerror: null }; setTimeout(() => { if (r2.onsuccess) r2.onsuccess(); }, 0); return r2; },
              };
            },
          };
        },
      };
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  },
};

const memStore = {};
global.chrome = {
  storage: { local: {
    async get(key) {
      if (typeof key === 'string') return { [key]: memStore[key] };
      const out = {}; (key || []).forEach((k) => { out[k] = memStore[k]; });
      return out;
    },
    async set(obj) { Object.assign(memStore, obj); },
  } },
  runtime: {
    getManifest: () => ({ version: '1.9.0' }),
    sendMessage: async () => ({ ok: true }),
    getURL: (p) => p,
    openOptionsPage() {},
    onMessage: { addListener() {} },
  },
};

function load(rel) { (0, eval)(require('fs').readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, '')); }
load('utils/logger.js');
load('utils/idb.js');
load('modules/schema.js');
load('modules/storage.js');
load('utils/fuzzy.js');
load('utils/dates.js');
load('utils/matcher.js');
load('utils/encrypt.js');
load('modules/applications.js');
load('modules/reminders.js');
load('modules/stats.js');

const AS = global.AS;
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name, extra ? JSON.stringify(extra) : ''); } };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 预建骨架
const nav = new FakeEl('nav'); nav.id = 'nav'; global._idMap['nav'] = nav;
['profile', 'resume', 'applications', 'questions', 'rules', 'stats', 'settings'].forEach((v) => { const a = new FakeEl('a'); a.dataset.view = v; nav.appendChild(a); });
const verLabel = new FakeEl('span'); verLabel.id = 'verLabel'; global._idMap['verLabel'] = verLabel;
const viewEl = new FakeEl('main'); viewEl.id = 'view'; global._idMap['view'] = viewEl;
document.body.appendChild(nav); document.body.appendChild(verLabel); document.body.appendChild(viewEl);

// 先注册视图再加载 options.js(触发 route)
['options/views/apps-view.js', 'options/views/questions-view.js', 'options/views/rules-view.js', 'options/views/settings-view.js'].forEach((v) => load(v));
load('options/options.js');

(async () => {
  await delay(30);

  // ===== A. 投递台账 =====
  console.log('== 台账视图 ==');
  location.hash = '#/applications';
  await AS.optionsUI.route();
  await delay(30);
  let view = global._idMap['view'];
  let tableWrap = global._idMap['tableWrap'];
  t('空态提示显示', !!tableWrap && (tableWrap.textContent || '').includes('暂无投递记录'));

  // 新增投递
  const addBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('新增投递'));
  t('存在新增投递按钮', !!addBtn);
  if (addBtn) addBtn.click();
  await delay(20);
  let modal = queryIn(document.body, '.modal-mask').pop();
  t('弹出新增投递弹窗', !!modal);
  // 弹窗内输入框顺序: 公司名称 → 岗位名称 → ...
  let modalInputs = modal ? queryIn(modal, 'input') : [];
  let companyInput = modalInputs[0];
  let posInput = modalInputs[1];
  t('弹窗有公司/岗位输入框', !!companyInput && !!posInput);
  if (companyInput) { companyInput.value = '腾讯'; (companyInput.listeners['input'] || []).forEach((fn) => fn({ target: companyInput })); }
  if (posInput) { posInput.value = '前端开发'; (posInput.listeners['input'] || []).forEach((fn) => fn({ target: posInput })); }
  const saveModalBtn = modal && queryIn(modal, 'button').find((b) => (b.textContent || '').includes('保存'));
  t('弹窗有保存按钮', !!saveModalBtn);
  if (saveModalBtn) await saveModalBtn.click();
  await delay(50);
  let apps = await AS.storage.getApplications();
  t('保存后台账 1 条记录', apps.length === 1 && apps[0].company === '腾讯' && apps[0].position === '前端开发');
  view = global._idMap['view'];
  tableWrap = global._idMap['tableWrap'];
  t('列表渲染出记录', !!tableWrap && (tableWrap.textContent || '').includes('腾讯'));

  // 分组视图切换
  const groupBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('平铺列表'));
  t('存在分组切换按钮', !!groupBtn);
  if (groupBtn) groupBtn.click();
  await delay(30);
  t('分组视图显示公司卡片', queryIn(view, '.card').some((c) => (c.textContent || '').includes('腾讯') && (c.textContent || '').includes('个岗位')));
  const backBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('按公司分组'));
  t('可切回平铺', !!backBtn);
  if (backBtn) backBtn.click();

  // ===== B. 开放题库 =====
  console.log('== 开放题库视图 ==');
  const prof = { id: 'p-q', name: '题库方案', data: { basic: {}, skills: {}, intent: {}, education: [], internship: [], project: [], custom: [], openQuestions: [{ question: '自我介绍', answer: '我叫张三' }] } };
  await AS.storage.saveProfile(prof);
  await AS.storage.saveSettings({ activeProfileId: 'p-q' });
  location.hash = '#/questions';
  await AS.optionsUI.route();
  await delay(30);
  view = global._idMap['view'];
  t('题库列表显示已有题目', (view.textContent || '').includes('自我介绍'));
  // 新增题目
  const qAddBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('新增题目'));
  t('存在新增题目按钮', !!qAddBtn);
  if (qAddBtn) qAddBtn.click();
  await delay(20);
  modal = queryIn(document.body, '.modal-mask').pop();
  t('弹出新增题目弹窗', !!modal);
  if (modal) {
    const qInput = queryIn(modal, 'input').find((i) => i.type === 'text');
    const tArea = queryIn(modal, 'textarea')[0];
    if (qInput) { qInput.value = '为什么选择我们公司'; (qInput.listeners['input'] || []).forEach((fn) => fn({ target: qInput })); }
    if (tArea) { tArea.value = '因为技术氛围与成长空间'; (tArea.listeners['input'] || []).forEach((fn) => fn({ target: tArea })); }
    const saveQ = queryIn(modal, 'button').find((b) => (b.textContent || '').trim() === '保存');
    t('弹窗有保存按钮', !!saveQ);
    if (saveQ) await saveQ.click();
    await delay(40);
  }
  const prof2 = await AS.storage.getProfile('p-q');
  t('新增题目已入库', (prof2.data.openQuestions || []).length === 2);

  // 一键微调(占位符替换)
  const editBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('编辑'));
  t('存在编辑按钮', !!editBtn);
  if (editBtn) editBtn.click();
  await delay(20);
  modal = queryIn(document.body, '.modal-mask').pop();
  if (modal) {
    const companyI = queryIn(modal, 'input').find((i) => (i.placeholder || '').includes('公司名'));
    const tArea = queryIn(modal, 'textarea')[0];
    tArea.value = '加入{{公司}}做{{岗位}}是我期待的方向';
    (tArea.listeners['input'] || []).forEach((fn) => fn({ target: tArea }));
    if (companyI) { companyI.value = '腾讯'; (companyI.listeners['input'] || []).forEach((fn) => fn({ target: companyI })); }
    const genBtn = queryIn(modal, 'button').find((b) => (b.textContent || '').includes('生成针对性答案'));
    t('存在一键微调按钮', !!genBtn);
    if (genBtn) await genBtn.click();
    await delay(40);
  }
  const prof3 = await AS.storage.getProfile('p-q');
  const tuned = (prof3.data.openQuestions || []).find((q) => (q.answer || '').includes('加入腾讯做'));
  t('一键微调生成占位符替换答案(公司已替换, 未填岗位保留占位符)', !!tuned && tuned.answer.includes('加入腾讯做') && tuned.answer.includes('{{岗位}}'));

  // ===== C. 站点规则 =====
  console.log('== 站点规则视图 ==');
  location.hash = '#/rules';
  await AS.optionsUI.route();
  await delay(30);
  view = global._idMap['view'];
  const rulesBefore = (await AS.storage.getSiteRules()).length;
  t('内置规则列表已渲染(≥15条)', rulesBefore >= 15 && (view.textContent || '').includes('北森'));
  // 新增规则
  global.prompt = (msg) => (msg.includes('域名') ? 'testcorp.com' : '测试集团');
  const ruleAddBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('新增站点规则'));
  t('存在新增规则按钮', !!ruleAddBtn);
  if (ruleAddBtn) ruleAddBtn.click();
  await delay(40);
  const rulesAfter = await AS.storage.getSiteRules();
  t('新增规则已入库', rulesAfter.length === rulesBefore + 1 && rulesAfter.some((r) => r.host === 'testcorp.com'));
  global.prompt = () => null;

  // ===== D. 设置 =====
  console.log('== 设置视图 ==');
  location.hash = '#/settings';
  await AS.optionsUI.route();
  await delay(30);
  view = global._idMap['view'];
  t('设置页渲染(填充策略/黑白名单/加密/状态流/进阶/备份/调试)', ['填充策略', '域名黑白名单', '敏感数据加密', '进度状态流', '进阶功能', '数据备份与恢复', '调试'].every((k) => (view.textContent || '').includes(k)));
  // autoLock 开关切换
  const lockChk = global._idMap['autoLockChk'];
  t('存在自动锁定开关', !!lockChk);
  const autoLock = (await AS.storage.getSettings()).autoLock;
  if (lockChk) {
    lockChk.checked = !autoLock;
    (lockChk.listeners['change'] || []).forEach((fn) => fn({ target: lockChk }));
    await delay(20);
  }
  const settings2 = await AS.storage.getSettings();
  t('自动锁定开关持久化', settings2.autoLock === !autoLock);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试崩溃:', e); process.exit(1); });
