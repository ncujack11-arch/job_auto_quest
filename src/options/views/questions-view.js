/**
 * questions-view.js — 开放题库管理视图 (v1.2.0)
 * 开放题答案 CRUD、分类检索、按公司沉淀面经
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  let profile = null;
  let list = [];
  let keyword = '';
  let catFilter = '';

  const CATS = ['通用', '自我介绍', '为什么加入', '职业规划', '优缺点', '公司面经', '其他'];

  function sync() {
    list = (profile && profile.data && profile.data.openQuestions) || [];
  }

  function catOf(q) {
    if (q.tags && q.tags.length) {
      const comp = q.tags.find((t) => !['一面', '二面', '终面', 'HR面', '笔试', 'OC沟通'].includes(t));
      if (comp && q.question.startsWith('【')) return '公司面经';
    }
    const qs = String(q.question || '');
    if (/自我介绍|自我评价/.test(qs)) return '自我介绍';
    if (/为什么|加入|选择我们|贵公司/.test(qs)) return '为什么加入';
    if (/规划|发展/.test(qs)) return '职业规划';
    if (/优缺点|优势|劣势/.test(qs)) return '优缺点';
    if (q.category) return q.category;
    return '通用';
  }

  function filtered() {
    const kw = keyword.trim().toLowerCase();
    return list.filter((q) => {
      if (catFilter && catOf(q) !== catFilter) return false;
      if (kw && !((q.question || '') + ' ' + (q.answer || '') + ' ' + ((q.tags || []).join(' '))).toLowerCase().includes(kw)) return false;
      return true;
    });
  }

  function renderList(wrap) {
    wrap.innerHTML = '';
    const items = filtered();
    if (!items.length) {
      wrap.appendChild(UI().el('div', { class: 'empty' }, [
        UI().el('b', { text: '暂无题目' }),
        UI().el('span', { text: '点击「新增题目」录入开放题答案; 投递复盘的面经可在台账详情中一键同步到此' }),
      ]));
      return;
    }
    items.forEach((q, i) => {
      const card = UI().el('div', { class: 'card', style: 'padding:14px 18px' });
      const head = UI().el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' });
      const title = UI().el('b', { style: 'font-size:14px' });
      title.appendChild(document.createTextNode(q.question || '未命名问题'));
      title.appendChild(UI().el('span', { class: 'badge', style: 'margin-left:8px', text: catOf(q) }));
      (q.tags || []).slice(0, 4).forEach((t) => title.appendChild(UI().el('span', { class: 'tag', style: 'margin-left:6px', text: t })));
      head.appendChild(title);
      head.appendChild(UI().el('button', { class: 'link-btn danger', text: '删除', onclick: async () => {
        if (!confirm('删除该题目?')) return;
        list.splice(i, 1);
        await save(); renderList(wrap);
      } }));
      card.appendChild(head);
      const answer = UI().el('div', { style: 'font-size:13px;color:#4b5563;white-space:pre-wrap;line-height:1.7', text: q.answer || '(未填写答案)' });
      card.appendChild(answer);
      card.appendChild(UI().el('div', { style: 'margin-top:10px;text-align:right' }, [
        UI().el('button', { class: 'btn sm', text: '编辑', onclick: () => editQuestion(q) }),
      ]));
      wrap.appendChild(card);
    });
  }

  async function save() {
    if (!profile) return;
    profile.updatedAt = Date.now();
    await AS.storage.saveProfile(profile);
  }

  function editQuestion(q) {
    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal' }, [])]);
    const box = modal.querySelector('.modal');
    box.appendChild(UI().el('h2', { text: q.question ? '编辑题目' : '新增题目' }));
    const item1 = UI().el('div', { class: 'form-item' });
    item1.appendChild(UI().el('label', { text: '问题' }));
    const qInput = UI().el('input', { type: 'text', value: q.question || '' });
    qInput.addEventListener('input', (e) => { q.question = e.target.value; });
    item1.appendChild(qInput);
    const item2 = UI().el('div', { class: 'form-item' });
    item2.appendChild(UI().el('label', { text: '答案' }));
    const aInput = UI().el('textarea', { style: 'min-height:160px' });
    aInput.value = q.answer || '';
    aInput.addEventListener('input', (e) => { q.answer = e.target.value; });
    item2.appendChild(aInput);
    const item3 = UI().el('div', { class: 'form-item' });
    item3.appendChild(UI().el('label', { text: '分类' }));
    const cSel = UI().el('select');
    CATS.forEach((c) => cSel.appendChild(UI().el('option', { value: c, text: c })));
    cSel.value = catOf(q);
    cSel.addEventListener('change', (e) => { q.category = e.target.value; });
    item3.appendChild(cSel);
    box.appendChild(item1);
    box.appendChild(item2);
    box.appendChild(item3);
    box.appendChild(UI().el('div', { class: 'modal-foot' }, [
      UI().el('button', { class: 'btn', text: '取消', onclick: () => modal.remove() }),
      UI().el('button', {
        class: 'btn primary', text: '保存', onclick: async () => {
          if (!q.question || !q.answer) return UI().toast('请填写问题与答案', 'error');
          if (!list.includes(q)) list.push(q);
          await save();
          modal.remove();
          UI().toast('已保存', 'success');
          render(containerRef);
        },
      }),
    ]));
    document.body.appendChild(modal);
  }

  let containerRef = null;
  async function render(container) {
    containerRef = container;
    container.innerHTML = '';
    profile = await AS.storage.getActiveProfile();
    if (!profile) {
      container.appendChild(UI().el('div', { class: 'empty' }, [
        UI().el('b', { text: '请先创建信息方案' }),
        UI().el('span', { text: '开放题库存储在信息方案中, 请前往「信息库」创建方案' }),
      ]));
      return;
    }
    sync();

    const toolbar = UI().el('div', { class: 'toolbar' });
    const search = UI().el('input', {
      type: 'search', placeholder: '搜索问题 / 答案 / 公司...', style: 'width:220px',
      oninput: (e) => { keyword = e.target.value; renderList(document.getElementById('qList')); },
    });
    toolbar.appendChild(search);
    const catSel = UI().el('select', { onchange: (e) => { catFilter = e.target.value; renderList(document.getElementById('qList')); } });
    catSel.appendChild(UI().el('option', { value: '', text: '全部分类' }));
    CATS.forEach((c) => catSel.appendChild(UI().el('option', { value: c, text: c })));
    catSel.value = catFilter;
    toolbar.appendChild(catSel);
    toolbar.appendChild(UI().el('span', { style: 'font-size:13px;color:#6b7280', text: `共 ${list.length} 题` }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn primary', text: '＋ 新增题目', onclick: () => editQuestion({ question: '', answer: '', category: '' }),
    }));
    container.appendChild(toolbar);

    container.appendChild(UI().el('div', { class: 'view-sub', text: '💡 这些答案会在网申页面自动匹配并填充(如: 自我介绍、为什么加入我们、职业规划)。' }));
    const listWrap = UI().el('div', { id: 'qList' });
    container.appendChild(listWrap);
    renderList(listWrap);
  }

  AS.views = AS.views || {};
  AS.views.questions = render;
})();
