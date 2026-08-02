// UI 行为测试: 用 DOM stub 实际运行 Options 视图, 验证渲染/持久化/交互
'use strict';
const path = require('path');
const ROOT = require('path').join(__dirname, '..', '..', 'src');

// ---------- DOM stub ----------
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
    return {
      add: (...c) => c.forEach((x) => self._classes.add(x)),
      remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      contains: (x) => self._classes.has(x),
      toggle: (x) => { if (self._classes.has(x)) self._classes.delete(x); else self._classes.add(x); },
    };
  }
  get textContent() {
    if (!this.children.length) return this._text;
    return this._text + this.children.map((c) => (c.textContent || '')).join('');
  }
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
  // 简单组合: 空格分隔逐级
  if (s.includes(' ')) {
    const parts = s.split(/\s+/);
    let nodes = [el];
    for (const p of parts) {
      const next = [];
      nodes.forEach((n) => queryIn(n, p).forEach((x) => next.push(x)));
      nodes = next;
    }
    return nodes.includes(el);
  }
  return el.tagName === s.toUpperCase() + 'S';
}

function queryIn(root, sel) {
  const out = [];
  const walk = (node) => {
    if (node !== root && matchSel(node, sel)) out.push(node);
    (node.children || []).forEach(walk);
  };
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
global.location = { hash: '#/profile', href: 'chrome-extension://test/options.html', hostname: 'test' };
Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true });
global.prompt = () => null;
global.confirm = () => true;
global.indexedDB = undefined;

// chrome stub
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
    getManifest: () => ({ version: '1.8.0' }),
    sendMessage: async () => ({ ok: true }),
    getURL: (p) => p,
    openOptionsPage() {},
    onMessage: { addListener() {} },
  },
};

function load(rel) {
  (0, eval)(require('fs').readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, ''));
}
load('utils/logger.js');
load('utils/idb.js');
load('modules/schema.js');
load('modules/storage.js');
load('utils/fuzzy.js');
load('utils/dates.js');
load('utils/matcher.js');
load('utils/encrypt.js');
load('modules/applications.js');

const AS = global.AS;
let pass = 0, fail = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘ FAIL:', name, extra ? JSON.stringify(extra) : ''); } };

// 预建 options 页骨架
const nav = new FakeEl('nav');
nav.id = 'nav';
global._idMap['nav'] = nav;
['profile', 'resume', 'applications', 'questions', 'rules', 'stats', 'settings'].forEach((v) => {
  const a = new FakeEl('a');
  a.dataset.view = v;
  nav.appendChild(a);
});
const verLabel = new FakeEl('span');
verLabel.id = 'verLabel';
global._idMap['verLabel'] = verLabel;
const viewEl = new FakeEl('main');
viewEl.id = 'view';
global._idMap['view'] = viewEl;
document.body.appendChild(nav);
document.body.appendChild(verLabel);
document.body.appendChild(viewEl);

// 先注册视图(render 内延迟使用 UI), 再加载 options.js(末尾 route() 立即渲染)
load('options/views/profile-view.js');
load('options/options.js');

(async () => {
  await delay(30);
  const view = global._idMap['view'];
  t('路由渲染出视图容器', !!view && view.children.length > 0);
  t('初始无方案时显示创建引导', queryIn(view, '.empty').length > 0);

  // ---- 创建第一个方案 ----
  const createBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('创建第一个方案'));
  t('存在创建按钮', !!createBtn);
  if (createBtn) await createBtn.click();
  await delay(50);
  let profiles = await AS.storage.getProfiles();
  t('创建后 storage 有 1 个方案', profiles.length === 1);
  t('创建后显示方案工具栏', queryIn(view, '.toolbar').length > 0);
  t('创建后显示保存按钮', !!global._idMap['profileSaveBtn']);
  t('创建后显示教育经历卡片', queryIn(view, '.card').some((c) => (c.textContent || '').includes('教育经历')));
  const childrenBefore = view.children.length;

  // ---- render 不叠加 ----
  await AS.views.profile(view);
  await delay(50);
  t('重复 render 不叠加(children 数量不变)', view.children.length === childrenBefore);

  // ---- 添加教育经历 ----
  const addEduBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('添加教育'));
  t('存在添加教育按钮', !!addEduBtn);
  if (addEduBtn) addEduBtn.click();
  await delay(30);
  const eduCards = queryIn(view, '.entry-card');
  t('添加后出现教育经历条目卡片', eduCards.length >= 1);
  // 填入学校字段(教育经历条目卡片的第一个输入框)
  const eduCard = queryIn(view, '.entry-card')[0];
  const schoolInput = eduCard ? queryIn(eduCard, 'input')[0] : null;
  t('教育条目有学校输入框', !!schoolInput);
  if (schoolInput) {
    schoolInput.value = '清华大学';
    (schoolInput.listeners['input'] || []).forEach((fn) => fn({ target: schoolInput }));
  }
  const saveBtn = global._idMap['profileSaveBtn'];
  t('保存按钮已启用(dirty)', saveBtn && saveBtn.disabled === false);
  if (saveBtn) await saveBtn.click();
  await delay(50);
  profiles = await AS.storage.getProfiles();
  const edu = profiles[0].data.education || [];
  t('保存后教育经历入库', edu.length === 1 && edu[0].school === '清华大学');

  // ---- 新建方案(复制自方案1) ----
  const newBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('新建方案'));
  t('存在新建方案按钮', !!newBtn);
  if (newBtn) newBtn.click();
  await delay(30);
  const modals = queryIn(document.body, '.modal-mask');
  t('弹出新建方案弹窗', modals.length > 0);
  if (modals.length) {
    const modal = modals[modals.length - 1];
    const nameInput = queryIn(modal, 'input').find((i) => i.placeholder.includes('方案名称'));
    t('弹窗有名称输入框', !!nameInput);
    if (nameInput) nameInput.value = '算法岗';
    const copySel = queryIn(modal, 'select')[0];
    t('弹窗有复制来源下拉', !!copySel);
    if (copySel) {
      copySel.value = profiles[0].id;
      (copySel.listeners['change'] || []).forEach((fn) => fn({ target: copySel }));
    }
    const confirmBtn = queryIn(modal, 'button').find((b) => (b.textContent || '').includes('创建方案'));
    t('弹窗有创建按钮', !!confirmBtn);
    if (confirmBtn) await confirmBtn.click();
    await delay(50);
  }
  profiles = await AS.storage.getProfiles();
  t('复制创建后 storage 有 2 个方案', profiles.length === 2);
  const p2 = profiles.find((p) => p.name === '算法岗');
  t('新方案名称为 算法岗', !!p2);
  t('新方案复制了教育经历数据', p2 && (p2.data.education || []).length === 1 && p2.data.education[0].school === '清华大学');
  const selEl = queryIn(view, 'select')[0];
  t('工具栏下拉包含新方案', !!selEl && (selEl.textContent || '').includes('算法岗'));
  t('当前方案切换为新方案', (await AS.storage.getActiveProfile()).id === p2.id);

  // ---- 重命名 ----
  global.prompt = () => '算法岗-腾讯版';
  const renameBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('重命名'));
  t('存在重命名按钮', !!renameBtn);
  if (renameBtn) await renameBtn.click();
  await delay(50);
  profiles = await AS.storage.getProfiles();
  const renamed = profiles.find((p) => p.id === p2.id);
  t('重命名已持久化到 storage', !!renamed && renamed.name === '算法岗-腾讯版');

  // ---- 删除方案 ----
  global.confirm = () => true;
  const delBtn = queryIn(view, 'button').find((b) => (b.textContent || '').includes('删除方案'));
  t('存在删除方案按钮', !!delBtn);
  if (delBtn) await delBtn.click();
  await delay(50);
  profiles = await AS.storage.getProfiles();
  t('删除后剩 1 个方案', profiles.length === 1);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试崩溃:', e); process.exit(1); });

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }
