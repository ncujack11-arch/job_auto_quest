/**
 * resume-view.js — 简历导入与专业校对页 (v1.7.0)
 * 左右分栏: 左侧原文(可选中标记字段) / 右侧解析结果表单
 * 支持: 置信度数值标注、来源行高亮、文本标记入库、经历拖拽排序、单字段增量保存
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  let parseState = null; // { format, text, structured, confidence, sources, warnings, template, cleanedLines }
  let containerRef = null;
  let leftWrap = null;
  let rightWrap = null;
  let curLine = null;
  let dragCat = null, dragFrom = -1;
  let saveTimer = null;

  // 标记字段菜单(选中原文文字 → 右键 → 标记为)
  const MARK_GROUPS = [
    { name: '基本信息', marks: [
      ['姓名', 'basic.name'], ['手机号', 'basic.phone'], ['邮箱', 'basic.email'], ['性别', 'basic.gender'],
      ['出生日期', 'basic.birthday'], ['身份证号', 'basic.idCard'], ['籍贯', 'basic.nativePlace'],
      ['现居地', 'basic.currentLocation'], ['政治面貌', 'basic.politicalStatus'], ['紧急联系人', 'basic.emergencyContact'],
    ] },
    { name: '教育经历', marks: [
      ['学校名称', 'education.school'], ['学历', 'education.degree'], ['专业', 'education.major'],
      ['入学时间', 'education.eduStart'], ['毕业时间', 'education.eduEnd'], ['GPA', 'education.gpa'],
      ['专业排名', 'education.gpaRank'], ['主修课程', 'education.majorCourses'], ['在校荣誉', 'education.honors'],
    ] },
    { name: '实习经历', marks: [
      ['实习公司', 'internship.intCompany'], ['部门', 'internship.intDepartment'], ['实习岗位', 'internship.intPosition'],
      ['开始时间', 'internship.intStart'], ['结束时间', 'internship.intEnd'],
      ['工作内容', 'internship.workContent'], ['量化成果', 'internship.achievements'],
    ] },
    { name: '项目经历', marks: [
      ['项目名称', 'project.projName'], ['个人角色', 'project.projRole'], ['项目周期', 'project.projDuration'],
      ['技术栈', 'project.projTech'], ['个人职责', 'project.projDuty'], ['项目成果', 'project.projOutcome'],
    ] },
    { name: '技能与意向', marks: [
      ['英语等级', 'skills.englishLevel'], ['计算机等级', 'skills.computerLevel'], ['证书', 'skills.certificates'],
      ['获奖经历', 'skills.awards'], ['期望岗位', 'intent.targetPosition'], ['期望城市', 'intent.targetCity'],
      ['期望薪资', 'intent.expectedSalary'],
    ] },
    { name: '其他', marks: [['开放题答案', 'openQuestions.answer'], ['自我评价', 'openQuestions.intro']] },
  ];

  function confBadge(score) {
    const v = typeof score === 'number' ? score : 50;
    const cls = v >= 85 ? 'conf-high' : v >= 65 ? 'conf-medium' : 'conf-low';
    return UI().el('span', { class: cls, text: '置信度 ' + v });
  }

  // ---------- 左侧: 原文面板 ----------
  function renderLeft(lines) {
    leftWrap.innerHTML = '';
    const panel = UI().el('div', { style: 'white-space:pre-wrap;font-size:12.5px;line-height:1.9;font-family:Consolas,"Microsoft YaHei",monospace;padding:4px 2px' });
    (lines || []).forEach((text, idx) => {
      const row = UI().el('div', {
        class: 'rl-line', style: 'display:flex;gap:8px;padding:1px 6px;border-radius:4px;cursor:pointer',
      });
      row.dataset.idx = String(idx);
      row.appendChild(UI().el('span', { style: 'color:#cbd5e1;user-select:none;min-width:26px;text-align:right;font-size:11px', text: String(idx + 1) }));
      const txt = UI().el('span', { text: text || ' ' });
      row.appendChild(txt);
      row.addEventListener('click', () => {
        curLine = idx;
        highlightLine(idx);
      });
      panel.appendChild(row);
    });
    leftWrap.appendChild(panel);
  }

  function highlightLine(idx, opts) {
    leftWrap.querySelectorAll('.rl-line.hl').forEach((el) => el.classList.remove('hl'));
    if (idx === null || idx === undefined) return;
    const row = leftWrap.querySelector(`.rl-line[data-idx="${idx}"]`);
    if (!row) return;
    row.classList.add('hl');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (opts && opts.flash) {
      row.style.transition = 'background 0.3s';
      row.style.background = '#fde68a';
      setTimeout(() => { row.style.background = ''; }, 1500);
    }
  }

  function lineIndexFromSelection() {
    try {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const node = sel.anchorNode;
      const row = node && node.parentElement ? node.parentElement.closest('.rl-line') : null;
      return row ? +row.dataset.idx : null;
    } catch (e) { return null; }
  }

  // ---------- 右侧: 解析结果表单 ----------
  function mkInput(key, value, srcIdx, onChange) {
    const item = UI().el('div', { class: 'form-item' });
    const l = UI().el('label', {});
    l.appendChild(document.createTextNode(key));
    const input = UI().el('input', { type: 'text', value: value || '' });
    input.addEventListener('input', (e) => onChange(e.target.value));
    item.appendChild(l);
    item.appendChild(input);
    if (srcIdx !== undefined && srcIdx !== null) {
      item.style.cursor = 'pointer';
      item.title = '点击高亮原文位置';
      item.addEventListener('click', (e) => { e.stopPropagation(); highlightLine(srcIdx, { flash: true }); });
    }
    return item;
  }

  function renderRight() {
    const s = parseState;
    if (!s) return;
    rightWrap.innerHTML = '';
    const st = s.structured;

    // 顶部操作条
    const bar = UI().el('div', { class: 'toolbar' });
    bar.appendChild(UI().el('button', {
      class: 'btn primary', text: '✅ 存入信息库', onclick: async () => {
        await mergeToProfile();
        UI().toast('已合并到当前方案', 'success');
      },
    }));
    bar.appendChild(UI().el('span', { id: 'autoSaveHint', style: 'font-size:12px;color:#9ca3af', text: '修改字段后自动保存' }));
    rightWrap.appendChild(bar);

    if (s.warnings && s.warnings.length) {
      const w = UI().el('div', { class: 'card', style: 'background:#fffbeb;border-color:#fde68a;padding:12px 16px' });
      w.appendChild(UI().el('b', { text: '⚠ 提示' }));
      s.warnings.forEach((t) => w.appendChild(UI().el('div', { style: 'font-size:12px;margin-top:4px', text: '· ' + t })));
      rightWrap.appendChild(w);
    }

    // 基本信息
    const c1 = UI().el('div', { class: 'card' });
    c1.appendChild(UI().el('h3', { text: '👤 基本信息' }));
    const g1 = UI().el('div', { class: 'form-grid' });
    AS.schema.findCategory('basic').fields.forEach((f) => {
      if (f.type === 'file') return;
      const score = s.confidence['basic.' + f.key];
      const src = s.sources['basic.' + f.key];
      const item = UI().el('div', { class: 'form-item' });
      const l = UI().el('label', {});
      l.appendChild(document.createTextNode(f.label));
      l.appendChild(confBadge(score));
      const input = UI().el('input', { type: f.type === 'date' ? 'date' : 'text', value: st.basic[f.key] || '' });
      input.addEventListener('input', (e) => { st.basic[f.key] = e.target.value; autoSaveSoon(); });
      item.appendChild(l);
      item.appendChild(input);
      if (src && src.length) {
        item.style.cursor = 'pointer';
        item.title = '点击高亮原文';
        item.addEventListener('click', (e) => { e.stopPropagation(); highlightLine(src[0], { flash: true }); });
      }
      g1.appendChild(item);
    });
    c1.appendChild(g1);
    rightWrap.appendChild(c1);

    // 可重复经历(可拖拽排序)
    const cats = [
      { cat: 'education', title: '🎓 教育经历' },
      { cat: 'internship', title: '💼 实习经历' },
      { cat: 'project', title: '🚀 项目经历' },
    ];
    cats.forEach(({ cat, title }) => {
      const c = UI().el('div', { class: 'card' });
      c.appendChild(UI().el('h3', { text: title, children: [UI().el('span', { class: 'badge', text: `${(st[cat] || []).length} 条` })] }));
      const list = st[cat] || (st[cat] = []);
      if (!list.length) {
        c.appendChild(UI().el('div', { class: 'empty', style: 'padding:14px', text: '未识别到, 可在下方手动添加' }));
      }
      list.forEach((entry, idx) => {
        const ecard = UI().el('div', { class: 'entry-card', draggable: 'true' });
        ecard.dataset.cat = cat;
        ecard.dataset.idx = String(idx);
        ecard.addEventListener('dragstart', (e) => { dragCat = cat; dragFrom = idx; e.dataTransfer.effectAllowed = 'move'; });
        ecard.addEventListener('dragover', (e) => { e.preventDefault(); });
        ecard.addEventListener('drop', (e) => {
          e.preventDefault();
          if (dragCat !== cat) return;
          const to = +e.currentTarget.dataset.idx;
          if (to === dragFrom || to < 0) return;
          const arr = st[cat];
          const [moved] = arr.splice(dragFrom, 1);
          arr.splice(to, 0, moved);
          dragCat = null;
          renderRight();
          autoSaveSoon();
        });
        const head = UI().el('div', { class: 'entry-head' });
        head.appendChild(UI().el('b', {}, [
          UI().el('span', { class: 'idx', text: `#${idx + 1} ` }),
          UI().el('span', { style: 'color:#9ca3af;font-size:11px', text: '⇅ 拖拽排序' }),
          document.createTextNode(' ' + title.slice(2)),
        ]));
        head.appendChild(UI().el('button', {
          class: 'link-btn danger', text: '删除', onclick: () => {
            list.splice(idx, 1);
            renderRight();
            autoSaveSoon();
          },
        }));
        ecard.appendChild(head);
        const grid = UI().el('div', { class: 'form-grid' });
        AS.schema.findCategory(cat).fields.forEach((f) => {
          const item = UI().el('div', { class: 'form-item' });
          item.appendChild(UI().el('label', { text: f.label }));
          const input = UI().el('input', { type: f.type === 'date' ? 'date' : 'text', value: entry[f.key] || '' });
          input.addEventListener('input', (e) => { entry[f.key] = e.target.value; autoSaveSoon(); });
          item.appendChild(input);
          if (entry.srcLine !== undefined) {
            item.title = '点击高亮原文';
            item.style.cursor = 'pointer';
            item.addEventListener('click', (e) => { e.stopPropagation(); highlightLine(entry.srcLine, { flash: true }); });
          }
          grid.appendChild(item);
        });
        ecard.appendChild(grid);
        c.appendChild(ecard);
      });
      c.appendChild(UI().el('button', {
        class: 'add-entry-btn', text: '+ 手动添加一条', onclick: () => {
          list.push({});
          renderRight();
          autoSaveSoon();
        },
      }));
      rightWrap.appendChild(c);
    });

    // 技能 / 意向
    const c2 = UI().el('div', { class: 'card' });
    c2.appendChild(UI().el('h3', { text: '🏅 技能证书 & 求职意向' }));
    const g2 = UI().el('div', { class: 'form-grid' });
    const plainCat = (catId) => {
      AS.schema.findCategory(catId).fields.forEach((f) => {
        const score = s.confidence[catId + '.' + f.key];
        const src = s.sources[catId + '.' + f.key];
        const item = UI().el('div', { class: 'form-item' });
        const l = UI().el('label', {});
        l.appendChild(document.createTextNode(f.label));
        if (score) l.appendChild(confBadge(score));
        const input = UI().el('input', { type: 'text', value: st[catId][f.key] || '' });
        input.addEventListener('input', (e) => { st[catId][f.key] = e.target.value; autoSaveSoon(); });
        item.appendChild(l);
        item.appendChild(input);
        if (src && src.length) {
          item.title = '点击高亮原文';
          item.style.cursor = 'pointer';
          item.addEventListener('click', (e) => { e.stopPropagation(); highlightLine(src[0], { flash: true }); });
        }
        g2.appendChild(item);
      });
    };
    plainCat('skills');
    plainCat('intent');
    c2.appendChild(g2);
    rightWrap.appendChild(c2);

    // 开放题
    if (st.openQuestions && st.openQuestions.length) {
      const c3 = UI().el('div', { class: 'card' });
      c3.appendChild(UI().el('h3', { text: '📝 开放题(自我评价等)' }));
      st.openQuestions.forEach((q, i) => {
        const item = UI().el('div', { class: 'form-item' });
        item.appendChild(UI().el('label', { text: '问题: ' + (q.question || '自我介绍') }));
        const ta = UI().el('textarea', { style: 'min-height:70px' });
        ta.value = q.answer || '';
        ta.addEventListener('input', (e) => { q.answer = e.target.value; autoSaveSoon(); });
        item.appendChild(ta);
        c3.appendChild(item);
      });
      rightWrap.appendChild(c3);
    }
  }

  // ---------- 文本标记入库 ----------
  function showMarkMenu(x, y, text) {
    const menu = UI().el('div', {
      class: 'mark-menu', style: 'position:fixed;z-index:9999;background:#fff;border:1px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.18);max-height:420px;overflow-y:auto;padding:8px;min-width:190px',
    });
    const head = UI().el('div', { style: 'font-size:11.5px;color:#64748b;padding:4px 8px 8px;border-bottom:1px solid #f1f5f9', text: `标记选中文字为: 「${text.slice(0, 18)}${text.length > 18 ? '…' : ''}」` });
    menu.appendChild(head);
    MARK_GROUPS.forEach((g) => {
      menu.appendChild(UI().el('div', { style: 'font-size:11px;color:#94a3b8;padding:6px 8px 2px', text: g.name }));
      g.marks.forEach(([label, fieldKey]) => {
        menu.appendChild(UI().el('div', {
          style: 'padding:5px 10px;font-size:12.5px;cursor:pointer;border-radius:6px',
          text: label, onclick: () => { applyMark(text, fieldKey); menu.remove(); },
        }));
      });
    });
    menu.querySelectorAll('div[style*="cursor:pointer"]').forEach((el) => {
      el.addEventListener('mouseover', () => { el.style.background = '#eff6ff'; });
      el.addEventListener('mouseout', () => { el.style.background = ''; });
    });
    document.body.appendChild(menu);
    // 边界修正
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) menu.style.left = Math.max(8, window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight - 8) menu.style.top = Math.max(8, window.innerHeight - rect.height - 8) + 'px';
    setTimeout(() => {
      const close = (e) => {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', close); }
      };
      document.addEventListener('mousedown', close);
    }, 0);
  }

  function applyMark(text, fieldKey) {
    const st = parseState.structured;
    const [cat, key] = fieldKey.split('.');
    const lineIdx = curLine !== null ? curLine : lineIndexFromSelection();
    if (cat === 'basic' || cat === 'skills' || cat === 'intent') {
      st[cat][key] = text;
      if (lineIdx !== null) { parseState.sources[cat + '.' + key] = [lineIdx]; }
    } else if (cat === 'openQuestions') {
      if (key === 'intro') {
        st.openQuestions = st.openQuestions.filter((q) => q.question !== '自我介绍');
        st.openQuestions.push({ question: '自我介绍', answer: text });
      } else {
        st.openQuestions.push({ question: '开放题(手动标记)', answer: text });
      }
    } else {
      let list = st[cat];
      if (!list.length) list.push({});
      const entry = list.find((e) => !e[key]) || list[list.length - 1];
      entry[key] = text;
      if (lineIdx !== null) entry.srcLine = lineIdx;
    }
    renderRight();
    autoSaveSoon();
    UI().toast(`已标记为「${fieldKey}」`, 'success');
  }

  // ---------- 增量自动保存 ----------
  function autoSaveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      mergeToProfile().then(() => {
        const hint = document.getElementById('autoSaveHint');
        if (hint) {
          hint.textContent = '已自动保存 ✓';
          setTimeout(() => { if (hint) hint.textContent = '修改字段后自动保存'; }, 2500);
        }
      });
    }, 1200);
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
    const cleanEntry = (e) => {
      const copy = Object.assign({}, e);
      delete copy.srcLine;
      return copy;
    };
    Object.assign(d.basic || (d.basic = {}), st.basic);
    ['education', 'internship', 'project'].forEach((cat) => {
      const list = (st[cat] || []).map(cleanEntry).filter((e) => Object.values(e).some((v) => v));
      if (list.length) d[cat] = list;
    });
    Object.assign(d.skills || (d.skills = {}), st.skills);
    Object.assign(d.intent || (d.intent = {}), st.intent);
    if ((st.openQuestions || []).length) {
      d.openQuestions = d.openQuestions || [];
      (st.openQuestions).forEach((q) => {
        if (q.answer && !d.openQuestions.some((e) => e.question === q.question && e.answer === q.answer)) {
          d.openQuestions.push(q);
        }
      });
    }
    profile.updatedAt = Date.now();
    await AS.storage.saveProfile(profile);
    AS.logger.info('resume', 'saved to profile', profile.id);
  }

  // ---------- 入口 ----------
  async function render(container, query) {
    containerRef = container;
    container.innerHTML = '';
    parseState = null;

    const drop = UI().el('div', {
      class: 'card',
      style: 'border:2px dashed #93c5fd;text-align:center;padding:36px 20px;cursor:pointer',
    });
    drop.appendChild(UI().el('b', { style: 'font-size:16px', text: '📄 拖拽简历到此处, 或点击选择文件' }));
    drop.appendChild(UI().el('div', { style: 'font-size:12px;color:#6b7280;margin-top:6px', text: '支持 PDF / DOCX · 全部在本地解析 · 解析后左右分栏校对, 选中原文文字可右键标记为字段' }));
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
        renderSplit(resultWrap);
        UI().toast('解析完成, 红色标注为低置信度字段, 请重点核对', 'success');
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

  // ---------- 左右分栏校对 ----------
  function renderSplit(wrap) {
    wrap.appendChild(UI().el('h3', { text: '左右分栏校对' }));
    wrap.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:12px', text: '💡 点击右侧字段可高亮左侧原文位置; 在左侧选中一段文字后右键, 可标记为对应字段; 经历卡片可拖拽排序; 修改自动保存。' }));

    const layout = UI().el('div', { style: 'display:grid;grid-template-columns:minmax(300px,38%) 1fr;gap:16px;align-items:start' });

    const leftCard = UI().el('div', { class: 'card', style: 'position:sticky;top:16px;max-height:78vh;overflow-y:auto' });
    leftCard.appendChild(UI().el('h3', { text: '📄 简历原文' }));
    leftWrap = UI().el('div', { id: 'origPanel' });
    leftCard.appendChild(leftWrap);
    layout.appendChild(leftCard);

    const rightCard = UI().el('div', { class: 'card', style: 'padding:16px' });
    rightWrap = UI().el('div', { id: 'resultPanel' });
    rightCard.appendChild(rightWrap);
    layout.appendChild(rightCard);

    wrap.appendChild(layout);

    const lines = (parseState.cleanedLines && parseState.cleanedLines.length) ? parseState.cleanedLines : (parseState.text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    renderLeft(lines);
    renderRight();

    // 选中文字 → 右键标记
    leftCard.addEventListener('contextmenu', (e) => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';
      if (!text || text.length < 1 || text.length > 300) return;
      const row = e.target.closest ? e.target.closest('.rl-line') : null;
      if (!row) return;
      e.preventDefault();
      curLine = +row.dataset.idx;
      showMarkMenu(e.clientX, e.clientY, text);
    });
  }

  AS.views = AS.views || {};
  AS.views.resume = render;
})();
