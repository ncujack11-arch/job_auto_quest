/**
 * resume-view.js — 简历导入视图 (v1.1.0)
 * 上传 PDF/DOCX → 本地解析 → 置信度标注预览 → 手动校正 → 一键入库
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  let parseState = null; // { format, text, structured, confidence, warnings }

  function confBadge(level) {
    const text = level === 'high' ? '高' : level === 'medium' ? '中' : '低';
    return UI().el('span', { class: 'conf-' + level, text: '置信度:' + text });
  }

  function renderResult(container) {
    const s = parseState;
    if (!s) return;
    container.appendChild(UI().el('h3', { text: '解析结果预览(请核对并修正后入库)' }));

    if (s.warnings && s.warnings.length) {
      const w = UI().el('div', { class: 'card', style: 'background:#fffbeb;border-color:#fde68a' });
      w.appendChild(UI().el('b', { text: '⚠ 提示' }));
      s.warnings.forEach((t) => w.appendChild(UI().el('div', { style: 'font-size:12px;margin-top:4px', text: '· ' + t })));
      container.appendChild(w);
    }

    const st = s.structured;

    // 基本信息
    const card = UI().el('div', { class: 'card' });
    card.appendChild(UI().el('h3', { text: '👤 基本信息' }));
    const grid = UI().el('div', { class: 'form-grid' });
    const basicDefs = AS.schema.findCategory('basic').fields;
    basicDefs.forEach((f) => {
      if (f.type === 'file') return;
      const item = UI().el('div', { class: 'form-item' });
      const l = UI().el('label', {});
      l.appendChild(document.createTextNode(f.label));
      l.appendChild(confBadge(s.confidence['basic.' + f.key] || 'low'));
      item.appendChild(l);
      const input = UI().el('input', {
        type: f.type === 'date' ? 'date' : 'text',
        value: st.basic[f.key] || '',
        oninput: (e) => { st.basic[f.key] = e.target.value; },
      });
      item.appendChild(input);
      grid.appendChild(item);
    });
    card.appendChild(grid);
    container.appendChild(card);

    // 可重复经历
    const entries = [
      { cat: 'education', title: '🎓 教育经历', fields: AS.schema.findCategory('education').fields.map((f) => f.key), confKey: 'education.school' },
      { cat: 'internship', title: '💼 实习经历', fields: AS.schema.findCategory('internship').fields.map((f) => f.key), confKey: 'internship.intCompany' },
      { cat: 'project', title: '🚀 项目经历', fields: AS.schema.findCategory('project').fields.map((f) => f.key), confKey: 'project.projName' },
    ];
    entries.forEach(({ cat, title, fields }) => {
      const card = UI().el('div', { class: 'card' });
      card.appendChild(UI().el('h3', { text: title, children: [UI().el('span', { class: 'badge', text: `${(st[cat] || []).length} 条` })] }));
      const list = st[cat] || [];
      if (!list.length) {
        card.appendChild(UI().el('div', { class: 'empty', style: 'padding:16px', text: '未识别到, 可在下方手动添加' }));
        card.appendChild(UI().el('button', {
          class: 'add-entry-btn', text: '+ 手动添加一条', onclick: () => {
            list.push({});
            renderResult(container);
          },
        }));
        container.appendChild(card);
        return;
      }
      list.forEach((entry, idx) => {
        const ecard = UI().el('div', { class: 'entry-card' });
        const head = UI().el('div', { class: 'entry-head' });
        head.appendChild(UI().el('b', {}, [UI().el('span', { class: 'idx', text: `#${idx + 1} ` }), document.createTextNode(title.slice(2))]));
        head.appendChild(UI().el('button', {
          class: 'link-btn danger', text: '删除', onclick: () => {
            list.splice(idx, 1);
            renderResult(container);
          },
        }));
        ecard.appendChild(head);
        const grid = UI().el('div', { class: 'form-grid' });
        const catDefs = AS.schema.findCategory(cat).fields;
        catDefs.forEach((f) => {
          const item = UI().el('div', { class: 'form-item' });
          item.appendChild(UI().el('label', { text: f.label }));
          const input = UI().el('input', {
            type: f.type === 'date' ? 'date' : 'text',
            value: entry[f.key] || '',
            oninput: (e) => { entry[f.key] = e.target.value; },
          });
          item.appendChild(input);
          grid.appendChild(item);
        });
        ecard.appendChild(grid);
        container.appendChild(ecard);
      });
      card.appendChild(UI().el('button', {
        class: 'add-entry-btn', text: '+ 手动添加一条', onclick: () => {
          list.push({});
          renderResult(container);
        },
      }));
      container.appendChild(card);
    });

    // 技能 / 意向 / 开放题
    const card2 = UI().el('div', { class: 'card' });
    card2.appendChild(UI().el('h3', { text: '🏅 技能证书 & 求职意向' }));
    const grid2 = UI().el('div', { class: 'form-grid' });
    const skDefs = AS.schema.findCategory('skills').fields;
    skDefs.forEach((f) => {
      const item = UI().el('div', { class: 'form-item' });
      item.appendChild(UI().el('label', { text: f.label }));
      const input = UI().el('input', { type: 'text', value: st.skills[f.key] || '', oninput: (e) => { st.skills[f.key] = e.target.value; } });
      item.appendChild(input);
      grid2.appendChild(item);
    });
    AS.schema.findCategory('intent').fields.forEach((f) => {
      const item = UI().el('div', { class: 'form-item' });
      item.appendChild(UI().el('label', { text: f.label }));
      const input = UI().el('input', { type: 'text', value: st.intent[f.key] || '', oninput: (e) => { st.intent[f.key] = e.target.value; } });
      item.appendChild(input);
      grid2.appendChild(item);
    });
    card2.appendChild(grid2);
    container.appendChild(card2);

    // 自我评价 → 开放题库
    if (st.openQuestions && st.openQuestions.length) {
      const card3 = UI().el('div', { class: 'card' });
      card3.appendChild(UI().el('h3', { text: '📝 自我评价(自动存入开放题库)' }));
      st.openQuestions.forEach((q, i) => {
        const item = UI().el('div', { class: 'form-item' });
        item.appendChild(UI().el('label', { text: '问题: ' + (q.question || '自我介绍') }));
        const ta = UI().el('textarea', { style: 'min-height:80px' });
        ta.value = q.answer || '';
        ta.addEventListener('input', (e) => { q.answer = e.target.value; });
        item.appendChild(ta);
        card3.appendChild(item);
      });
      container.appendChild(card3);
    }

    // 操作按钮
    const actions = UI().el('div', { class: 'toolbar' });
    actions.appendChild(UI().el('button', {
      class: 'btn primary', text: '✅ 确认无误, 存入信息库', onclick: async () => {
        await mergeToProfile();
        UI().toast('已合并到当前方案', 'success');
      },
    }));
    actions.appendChild(UI().el('button', {
      class: 'btn', text: '查看原始文本', onclick: () => {
        const ta = document.getElementById('rawText');
        if (ta) ta.style.display = ta.style.display === 'none' ? 'block' : 'none';
      },
    }));
    container.appendChild(actions);
    container.appendChild(UI().el('textarea', { id: 'rawText', style: 'display:none;width:100%;min-height:200px;font-size:12px;border:1px solid #e2e8f0;border-radius:8px;padding:10px', text: s.text }));
  }

  async function mergeToProfile() {
    const s = parseState;
    if (!s) return;
    let profile = await AS.storage.getActiveProfile();
    if (!profile) {
      const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      profile = { id, name: '默认方案', description: '由简历解析创建', createdAt: Date.now(), updatedAt: Date.now(), data: {} };
      await AS.storage.saveProfile(profile);
      await AS.storage.saveSettings({ activeProfileId: id });
    }
    const d = profile.data;
    const st = s.structured;
    // 基本信息(覆盖)
    Object.assign(d.basic || (d.basic = {}), st.basic);
    // 教育/实习/项目(合并去重)
    const mergeEntries = (cat) => {
      const existing = d[cat] || (d[cat] = []);
      (st[cat] || []).forEach((entry) => {
        const key = entry.school || entry.intCompany || entry.projName || '';
        if (key && !existing.some((e) => (e.school || e.intCompany || e.projName) === key)) existing.push(entry);
      });
    };
    mergeEntries('education');
    mergeEntries('internship');
    mergeEntries('project');
    // 技能/意向(有值才覆盖)
    Object.assign(d.skills || (d.skills = {}), st.skills);
    Object.assign(d.intent || (d.intent = {}), st.intent);
    // 开放题(去重添加)
    d.openQuestions = d.openQuestions || [];
    (st.openQuestions || []).forEach((q) => {
      if (q.answer && !d.openQuestions.some((e) => e.question === q.question)) d.openQuestions.push(q);
    });
    profile.updatedAt = Date.now();
    await AS.storage.saveProfile(profile);
    AS.logger.info('resume', 'merged resume to profile', profile.id);
  }

  async function render(container, query) {
    container.innerHTML = '';
    parseState = null;

    const drop = UI().el('div', {
      class: 'card',
      style: 'border:2px dashed #93c5fd;text-align:center;padding:40px 20px;cursor:pointer',
      text: '',
    });
    drop.appendChild(UI().el('b', { style: 'font-size:16px', text: '📄 拖拽简历到此处, 或点击选择文件' }));
    drop.appendChild(UI().el('div', { style: 'font-size:12px;color:#6b7280;margin-top:6px', text: '支持 PDF / DOCX · 全部在本地解析, 不上传任何数据' }));
    drop.appendChild(UI().el('div', { style: 'font-size:11px;color:#9ca3af;margin-top:4px', text: '提示: 旧版 .doc 格式请先另存为 .docx' }));

    const fileInput = UI().el('input', { type: 'file', accept: '.pdf,.docx,.doc', style: 'display:none' });
    fileInput.addEventListener('change', (e) => e.target.files[0] && doParse(e.target.files[0]));
    drop.appendChild(fileInput);
    drop.addEventListener('click', () => fileInput.click());
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = '#2563eb'; }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = '#93c5fd'; }));
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) doParse(f);
    });
    container.appendChild(drop);

    const resultWrap = UI().el('div', { id: 'resumeResult' });
    container.appendChild(resultWrap);

    async function doParse(file) {
      resultWrap.innerHTML = '';
      resultWrap.appendChild(UI().el('div', { class: 'empty', text: '正在本地解析...' }));
      try {
        const r = await AS.parser.parseResume(file);
        parseState = r;
        resultWrap.innerHTML = '';
        renderResult(resultWrap);
        UI().toast('解析完成, 请核对低置信度字段', 'success');
      } catch (e) {
        AS.logger.error('resume', 'parse failed', e);
        resultWrap.innerHTML = '';
        resultWrap.appendChild(UI().el('div', { class: 'empty' }, [
          UI().el('b', { text: '解析失败' }),
          UI().el('span', { text: (e.message || String(e)) + ' — 可手动在信息库录入' }),
        ]));
      }
    }
  }

  AS.views = AS.views || {};
  AS.views.resume = render;
})();
