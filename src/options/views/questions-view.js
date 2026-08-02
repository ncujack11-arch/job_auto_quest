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

    // ---------- 笔试题库 ----------
    container.appendChild(UI().el('h3', { style: 'margin:20px 0 6px', text: '📚 笔试题库(行测/笔试/编程题)' }));
    container.appendChild(UI().el('p', { class: 'view-sub', text: '做题时自动识别页面题目并弹答案; 也可右键选中题目选择「在本地笔试题库中查找答案」。' }));
    const quizBox = UI().el('div', { id: 'quizBox' });
    container.appendChild(quizBox);
    await renderQuiz(quizBox);
  }

  // ---------- 笔试题库管理 ----------
  async function renderQuiz(wrap) {
    const quiz = await AS.storage.getQuiz();
    let kw = '';
    wrap.innerHTML = '';
    const toolbar = UI().el('div', { class: 'toolbar' });
    const search = UI().el('input', {
      type: 'search', placeholder: '搜索题目...', style: 'width:200px',
      oninput: (e) => { kw = e.target.value; renderList(); },
    });
    toolbar.appendChild(search);
    toolbar.appendChild(UI().el('span', { style: 'font-size:13px;color:#6b7280', text: `共 ${quiz.length} 题` }));
    toolbar.appendChild(UI().el('button', { class: 'btn primary', text: '＋ 新增题目', onclick: () => editQuizItem(null, renderList) }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '📤 导出题库', onclick: () => {
        const blob = new Blob([JSON.stringify(quiz, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `笔试题库_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
    }));
    const fileInput = UI().el('input', { type: 'file', accept: '.json', style: 'display:none' });
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!Array.isArray(data)) throw new Error('格式错误');
        if (!confirm(`导入 ${data.length} 题? 将合并到现有题库`)) return;
        let n = 0;
        for (const item of data) {
          if (item && item.question && item.answer) {
            const added = await AS.storage.addQuizItem({ id: AS.apps ? AS.apps.uid() : 'q' + Date.now().toString(36), question: item.question, answer: item.answer, category: item.category || '通用' });
            if (added) n++;
          }
        }
        UI().toast(`已导入 ${n} 题`, 'success');
        await renderQuiz(wrap);
      } catch (err) {
        UI().toast('导入失败: ' + err.message, 'error');
      }
    });
    toolbar.appendChild(UI().el('button', { class: 'btn', text: '📥 导入题库', onclick: () => fileInput.click() }));
    toolbar.appendChild(fileInput);
    wrap.appendChild(toolbar);

    const listWrap = UI().el('div', { id: 'quizList' });
    wrap.appendChild(listWrap);
    async function renderList() {
      const list = await AS.storage.getQuiz();
      listWrap.innerHTML = '';
      const k = kw.trim().toLowerCase();
      const items = list.filter((q) => !k || ((q.question || '') + ' ' + (q.answer || '')).toLowerCase().includes(k));
      if (!items.length) {
        listWrap.appendChild(UI().el('div', { class: 'empty', text: '暂无题目, 点击「新增题目」录入' }));
        return;
      }
      const card = UI().el('div', { class: 'card', style: 'padding:10px 14px' });
      items.slice(0, 30).forEach((q, i) => {
        const row = UI().el('div', { style: 'display:flex;gap:8px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #f1f5f9' });
        row.appendChild(UI().el('div', { style: 'flex:1;font-size:13px' }, [
          UI().el('div', { text: `${i + 1}. ${q.question}` }),
          UI().el('div', { style: 'color:#4b5563;font-size:12px;white-space:pre-wrap;margin-top:2px', text: q.answer }),
        ]));
        row.appendChild(UI().el('button', {
          class: 'link-btn danger', text: '删', onclick: async () => {
            const list2 = await AS.storage.getQuiz();
            await AS.storage.saveQuiz(list2.filter((x) => x.id !== q.id));
            await renderQuiz(wrap);
          },
        }));
        card.appendChild(row);
      });
      if (items.length > 30) card.appendChild(UI().el('div', { style: 'color:#9ca3af;font-size:12px;padding:6px', text: `... 还有 ${items.length - 30} 题, 请搜索筛选` }));
      listWrap.appendChild(card);
    }
    renderList();
  }

  function editQuizItem(item, onDone) {
    const q = item || { id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), question: '', answer: '', category: '通用' };
    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal' }, [])]);
    const box = modal.querySelector('.modal');
    box.appendChild(UI().el('h2', { text: item ? '编辑题目' : '新增题目' }));
    const i1 = UI().el('div', { class: 'form-item' });
    i1.appendChild(UI().el('label', { text: '题目' }));
    const qInput = UI().el('input', { type: 'text', value: q.question });
    qInput.addEventListener('input', (e) => { q.question = e.target.value; });
    i1.appendChild(qInput);
    const i2 = UI().el('div', { class: 'form-item' });
    i2.appendChild(UI().el('label', { text: '答案 / 解析' }));
    const aInput = UI().el('textarea', { style: 'min-height:120px' });
    aInput.value = q.answer || '';
    aInput.addEventListener('input', (e) => { q.answer = e.target.value; });
    i2.appendChild(aInput);
    const i3 = UI().el('div', { class: 'form-item' });
    i3.appendChild(UI().el('label', { text: '分类' }));
    const cInput = UI().el('input', { type: 'text', value: q.category || '通用' });
    cInput.addEventListener('input', (e) => { q.category = e.target.value; });
    i3.appendChild(cInput);
    box.appendChild(i1);
    box.appendChild(i2);
    box.appendChild(i3);
    box.appendChild(UI().el('div', { class: 'modal-foot' }, [
      UI().el('button', { class: 'btn', text: '取消', onclick: () => modal.remove() }),
      UI().el('button', {
        class: 'btn primary', text: '保存', onclick: async () => {
          if (!q.question || !q.answer) return UI().toast('请填写题目与答案', 'error');
          await AS.storage.addQuizItem(q);
          modal.remove();
          UI().toast('已保存', 'success');
          onDone && onDone();
        },
      }),
    ]));
    document.body.appendChild(modal);
  }

  AS.views = AS.views || {};
  AS.views.questions = render;
})();
