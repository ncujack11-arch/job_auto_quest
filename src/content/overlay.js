/**
 * overlay.js — 页面内悬浮 UI (Shadow DOM, 与页面样式完全隔离)
 * 功能: 填充结果反馈 / 投递记录面板 / 加密解锁 / Toast
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.overlay) return;

  const LOG = () => AS.logger;

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
.af-root { position: fixed; top: 16px; right: 16px; width: 340px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
  background: #fff; color: #1f2937; border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.22); z-index: 2147483647;
  font-size: 13px; line-height: 1.5; overflow: hidden; display: flex; flex-direction: column; }
.af-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: #2563eb; color: #fff; }
.af-title { font-weight: 600; font-size: 14px; }
.af-close { background: none; border: 0; color: #fff; font-size: 18px; cursor: pointer; line-height: 1; opacity: .85; }
.af-close:hover { opacity: 1; }
.af-body { padding: 14px; overflow-y: auto; }
.af-stat { display: flex; gap: 8px; margin-bottom: 12px; }
.af-stat div { flex: 1; text-align: center; padding: 8px 4px; border-radius: 8px; background: #f3f4f6; }
.af-stat b { display: block; font-size: 18px; }
.af-stat .ok b { color: #16a34a; } .af-stat .skip b { color: #d97706; } .af-stat .bad b { color: #dc2626; }
.af-stat span { font-size: 11px; color: #6b7280; }
.af-list { max-height: 220px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
.af-item { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.af-item:last-child { border-bottom: 0; }
.af-item .t { color: #374151; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-item .d { color: #9ca3af; flex-shrink: 0; }
.af-preview-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
.af-preview-item:last-child { border-bottom: 0; }
.af-preview-item .pv-label { flex: 0 0 34%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6b7280; }
.af-preview-item .pv-value { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #111827; font-weight: 500; }
.af-highlight { outline: 2px solid #dc2626 !important; outline-offset: 1px !important; border-color: #dc2626 !important; }
.af-highlight-ok { outline: 2px solid #16a34a !important; outline-offset: 1px !important; }
.af-highlight-skip { outline: 1px dashed #d97706 !important; outline-offset: 1px !important; }
.af-actions { display: flex; gap: 8px; margin-top: 12px; }
.af-btn { flex: 1; padding: 8px 10px; border: 0; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500; }
.af-btn.primary { background: #2563eb; color: #fff; }
.af-btn.ghost { background: #f3f4f6; color: #374151; }
.af-btn.danger { background: #fee2e2; color: #dc2626; }
.af-btn:disabled { opacity: .5; cursor: not-allowed; }
.af-form { display: flex; flex-direction: column; gap: 10px; }
.af-row { display: flex; flex-direction: column; gap: 4px; }
.af-row label { font-size: 12px; color: #6b7280; }
.af-row input, .af-row select, .af-row textarea { padding: 7px 9px; border: 1px solid #d1d5db; border-radius: 7px; font-size: 13px; font-family: inherit; background: #fff; color: #1f2937; width: 100%; }
.af-row textarea { resize: vertical; min-height: 44px; }
.af-row input:focus, .af-row select:focus, .af-row textarea:focus { outline: 2px solid #bfdbfe; border-color: #2563eb; }
.af-hint { font-size: 11px; color: #9ca3af; }
.af-conf { display: inline-block; padding: 1px 6px; border-radius: 5px; font-size: 11px; margin-left: 6px; background: #fef3c7; color: #b45309; }
.af-toast { position: fixed; right: 16px; bottom: 24px; background: #111827; color: #fff; padding: 10px 16px; border-radius: 8px;
  font-size: 13px; z-index: 2147483647; box-shadow: 0 8px 24px rgba(0,0,0,.25); max-width: 320px; }
.af-float-ball { position: fixed; right: 20px; bottom: 90px; width: 46px; height: 46px; border-radius: 50%;
  background: linear-gradient(135deg, #2563eb, #1e40af); color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 20px; cursor: move; z-index: 2147483646; box-shadow: 0 6px 20px rgba(37,99,235,.45); user-select: none; }
.af-float-panel { position: fixed; right: 20px; bottom: 142px; width: 250px; background: #fff; border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.22); z-index: 2147483646; font-size: 12.5px; color: #1f2937; overflow: hidden; }
.af-float-panel .fp-head { background: #2563eb; color: #fff; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; cursor: move; }
.af-float-panel .fp-body { padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow-y: auto; }
.af-fp-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 7px; cursor: pointer; }
.af-fp-row:hover { background: #eff6ff; }
.af-fp-row .fp-icon { width: 20px; text-align: center; }
.af-fp-row .fp-text { flex: 1; }
.af-fp-count { display: inline-block; background: #eff6ff; color: #2563eb; border-radius: 10px; padding: 0 8px; font-size: 11px; }
.af-fp-divider { border-top: 1px solid #f1f5f9; margin: 4px 0; }
`;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);

  let activePanel = null;

  function closePanel() {
    if (activePanel) { activePanel.remove(); activePanel = null; }
  }

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === undefined || v === null || v === false) { /* 忽略空/假值属性 */ }
      else if (v === true && (k === 'disabled' || k === 'readonly')) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    (children || []).forEach((c) => { if (c) el.appendChild(c); });
    return el;
  }

  function showPanel(content) {
    closePanel();
    const root = h('div', { class: 'af-root' }, [content]);
    shadow.appendChild(root);
    activePanel = root;
    return root;
  }

  function head(title, extra) {
    return h('div', { class: 'af-head' }, [
      h('span', { class: 'af-title', text: title }),
      extra || h('button', { class: 'af-close', text: '×', onclick: closePanel }),
    ]);
  }

  // ---------- 填充预览 ----------
  function showPreview(items, onConfirm, onCancel) {
    if (!items || !items.length) { onConfirm && onConfirm(new Set()); return; }
    const selected = new Set(items.map((_, i) => i));
    const rows = items.map((it, i) => {
      const cb = h('input', { type: 'checkbox', checked: '', dataIdx: String(i) });
      cb.addEventListener('change', (e) => {
        if (e.target.checked) selected.add(i); else selected.delete(i);
      });
      return h('div', { class: 'af-preview-item' }, [
        cb,
        h('span', { class: 'pv-label', text: (it.label || '未知字段').slice(0, 24) }),
        h('span', { class: 'pv-value', text: String(it.value).slice(0, 40) }),
      ]);
    });
    const panel = showPanel(h('div', {}, [
      head('填充预览', h('button', { class: 'af-close', text: '×', onclick: () => { closePanel(); onCancel && onCancel(); } })),
      h('div', { class: 'af-body' }, [
        h('p', { style: 'font-size:12px;color:#6b7280;margin-bottom:8px', text: `共 ${items.length} 个字段将填入以下内容, 取消勾选可跳过个别字段。` }),
        h('div', { class: 'af-list', style: 'max-height:300px' }, rows),
        h('div', { class: 'af-actions' }, [
          h('button', { class: 'af-btn ghost', text: '取消', onclick: () => { closePanel(); onCancel && onCancel(); } }),
          h('button', { class: 'af-btn primary', text: `确认填充 (${items.length})`, onclick: () => { closePanel(); onConfirm && onConfirm(selected); } }),
        ]),
      ]),
    ]));
    return panel;
  }

  // ---------- 填充结果 ----------
  let lastSummaryAt = 0;
  function showSummary(summary, undoFn) {
    if (!summary || (summary.total === 0 && !summary.blocked)) return;
    const now = Date.now();
    if (now - lastSummaryAt < 4000) return; // 内容脚本本地显示与后台广播去重
    lastSummaryAt = now;
    const filled = summary.filled || 0, skipped = summary.skipped || 0, bad = (summary.unmatched || 0) + (summary.errors || 0);
    const unmatched = summary.unmatchedItems || [];
    const list = unmatched.slice(0, 12).map((u) => h('div', { class: 'af-item' }, [
      h('span', { class: 't', text: u.label || u.signature || '未知字段' }),
      h('span', { class: 'd', text: u.reason || '未匹配' }),
    ]));
    const panel = showPanel(h('div', {}, [
      head('一键填充完成'),
      h('div', { class: 'af-body' }, [
        h('div', { class: 'af-stat' }, [
          h('div', { class: 'ok' }, [h('b', { text: String(filled) }), h('span', { text: '成功填充' })]),
          h('div', { class: 'skip' }, [h('b', { text: String(skipped) }), h('span', { text: '已有内容跳过' })]),
          h('div', { class: 'bad' }, [h('b', { text: String(bad) }), h('span', { text: '未匹配/失败' })]),
        ]),
        bad > 0 ? [
          h('div', { class: 'af-list' }, list),
          h('div', { class: 'af-actions' }, [
            h('button', { class: 'af-btn ghost', text: '手动映射未匹配字段', onclick: () => {
              const u = new URL(chrome.runtime.getURL('src/options/options.html'));
              u.hash = '#/rules?focus=mapping&host=' + encodeURIComponent(location.hostname);
              window.open(u.toString(), '_blank');
            } }),
          ]),
        ] : null,
        h('div', { class: 'af-actions' }, [
          undoFn ? h('button', { class: 'af-btn ghost', text: '↩ 撤销本次填充', onclick: async () => {
            const btn = panel.querySelector('.af-btn');
            btn.disabled = true;
            await undoFn();
            toast('已撤销, 恢复原内容');
          } }) : null,
          h('button', {
            class: 'af-btn ghost', text: '📥 导入页面已填资料到信息库', onclick: () => {
              closePanel();
              chrome.runtime.sendMessage({ type: 'AF_LEARN_COLLECT' });
            },
          }),
        ]),
        h('div', { class: 'af-hint', text: '插件绝不会自动提交表单, 请自行检查并点击提交。' }),
      ]),
    ]));
    setTimeout(() => { try { panel.querySelector('.af-close').click(); } catch (e) { /* ignore */ } }, 12000);
    return panel;
  }

  // ---------- 投递记录面板 ----------
  function showRecordPanel(info) {
    const f = info || {};
    const nowIso = new Date().toISOString().slice(0, 16);
    const mk = (id, label, value, ph) => {
      const row = h('div', { class: 'af-row' }, [
        h('label', { text: label }),
        h('input', { id: 'af-' + id, value: value || '', placeholder: ph || '' }),
      ]);
      return row;
    };
    const rows = [
      mk('company', '公司名称', f.company, '如: 阿里巴巴'),
      mk('position', '岗位名称', f.position, '如: 前端开发工程师'),
      mk('category', '岗位类别', f.category, '如: 技术类 / 非技术类'),
      mk('city', '工作城市', f.city, '如: 杭州'),
      mk('channel', '投递渠道', f.channel || f.siteName, '如: 官网 / 牛客网 / 内推'),
      h('div', { class: 'af-row' }, [
        h('label', { text: '岗位链接' }),
        h('input', { id: 'af-url', value: f.url || location.href, readonly: '' }),
      ]),
      h('div', { class: 'af-row' }, [
        h('label', { text: 'JD 快照' }),
        h('textarea', { id: 'af-jd', text: f.jdSnapshot || '', style: 'min-height:70px' }),
      ]),
      h('div', { class: 'af-row' }, [
        h('label', { text: '备注' }),
        h('input', { id: 'af-note', value: '', placeholder: '选填' }),
      ]),
      h('div', { class: 'af-hint', text: f.pending ? '以下字段为自动抓取, 置信度低, 请核对后再保存。' : '' }),
    ];
    const panel = showPanel(h('div', {}, [
      head('记录本次投递'),
      h('div', { class: 'af-body' }, [
        h('div', { class: 'af-form' }, rows),
        h('div', { class: 'af-actions' }, [
          h('button', { class: 'af-btn ghost', text: '取消', onclick: closePanel }),
          h('button', { class: 'af-btn primary', text: '保存到投递台账', onclick: async () => {
            const g = (id) => shadow.querySelector('#af-' + id).value.trim();
            const record = {
              company: g('company') || '未知公司',
              position: g('position') || '未知岗位',
              category: g('category'), city: g('city'), channel: g('channel'),
              url: g('url'), jdSnapshot: g('jd'), fromPage: true,
            };
            const note = g('note');
            if (note) record.notes = { content: note };
            try {
              const ASM = window.AS;
              const saved = await ASM.apps.createRecord(record);
              ASM.logger.info('overlay', 'record saved', saved.id);
              toast('已保存到投递台账 ✔');
              closePanel();
            } catch (e) {
              LOG().error('overlay', 'save record failed', e);
              toast('保存失败: ' + (e.message || e));
            }
          } }),
        ]),
      ]),
    ]));
    return panel;
  }

  // ---------- 加密解锁 ----------
  function showUnlockPrompt(onOk, onCancel) {
    const panel = showPanel(h('div', {}, [
      head('敏感字段已加密', h('button', { class: 'af-close', text: '×', onclick: () => { closePanel(); onCancel && onCancel(); } })),
      h('div', { class: 'af-body' }, [
        h('p', { style: 'margin-bottom:10px', text: '本方案包含加密字段(身份证号/期望薪资), 请输入解锁口令后继续填充。' }),
        h('div', { class: 'af-form' }, [
          h('div', { class: 'af-row' }, [
            h('label', { text: '解锁口令' }),
            h('input', { id: 'af-pwd', type: 'password', placeholder: '请输入口令' }),
          ]),
        ]),
        h('div', { class: 'af-actions' }, [
          h('button', { class: 'af-btn ghost', text: '取消', onclick: () => { closePanel(); onCancel && onCancel(); } }),
          h('button', { class: 'af-btn primary', text: '解锁', onclick: async () => {
            const pwd = shadow.querySelector('#af-pwd').value;
            if (!pwd) return;
            const btn = shadow.querySelector('.af-btn.primary');
            btn.disabled = true; btn.textContent = '验证中...';
            try {
              const r = await chrome.runtime.sendMessage({ type: 'AF_UNLOCK', password: pwd });
              if (r && r.ok) { toast('解锁成功'); closePanel(); onOk && onOk(); }
              else { btn.disabled = false; btn.textContent = '解锁'; toast('口令错误'); }
            } catch (e) { btn.disabled = false; btn.textContent = '解锁'; toast('解锁失败: ' + (e.message || e)); }
          } }),
        ]),
      ]),
    ]));
    return panel;
  }

  // ---------- 学习模式: 捕获页面已填内容 ----------
  function showLearnPanel(items, onDone) {
    if (!items || !items.length) {
      toast('未发现可导入的新资料(页面填写内容与信息库相同, 或字段无法识别)');
      return;
    }
    const selected = new Set(items.map((_, i) => i));
    const rows = items.map((it, i) => {
      const label = it.type === 'openQuestions' ? ('开放题: ' + (it.question || '开放题')) : it.label || it.fieldKey || '字段';
      const cb = h('input', { type: 'checkbox', checked: '', dataIdx: String(i) });
      cb.addEventListener('change', (e) => {
        if (e.target.checked) selected.add(i); else selected.delete(i);
      });
      return h('div', { class: 'af-item' }, [
        cb,
        h('span', { class: 't', style: 'flex:1', text: label }),
        h('span', { style: 'color:#2563eb;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: String(it.value).slice(0, 30) }),
      ]);
    });
    const panel = showPanel(h('div', {}, [
      head('发现可导入的新资料'),
      h('div', { class: 'af-body' }, [
        h('p', { style: 'font-size:12px;color:#6b7280;margin-bottom:8px', text: '以下内容与信息库不同/缺失, 勾选后导入本地信息库, 下次遇到匹配字段将自动填充。' }),
        h('div', { class: 'af-list', style: 'max-height:300px' }, rows),
        h('div', { class: 'af-actions' }, [
          h('button', { class: 'af-btn ghost', text: '取消', onclick: closePanel }),
          h('button', { class: 'af-btn primary', text: '导入所选', onclick: async () => {
            const chosen = items.filter((_, i) => selected.has(i));
            if (!chosen.length) { toast('未选择任何项'); return; }
            const btn = panel.querySelector('.af-btn.primary');
            btn.disabled = true; btn.textContent = '导入中...';
            try {
              const r = await chrome.runtime.sendMessage({ type: 'AF_LEARN_SAVE', items: chosen });
              if (r && r.saved > 0) {
                toast(`已导入 ${r.saved} 项到信息库 ✔`);
                closePanel();
                onDone && onDone(r.saved);
              } else {
                btn.disabled = false; btn.textContent = '导入所选';
                toast(r && r.error ? '导入失败: ' + r.error : '没有可导入的新内容');
              }
            } catch (e) {
              btn.disabled = false; btn.textContent = '导入所选';
              toast('导入失败: ' + (e.message || e));
            }
          } }),
        ]),
      ]),
    ]));
    return panel;
  }

  function toast(msg, ms) {
    const t = h('div', { class: 'af-toast', text: msg });
    shadow.appendChild(t);
    setTimeout(() => t.remove(), ms || 3000);
  }

  // 页面字段高亮(用于失败/成功定位)
  function highlight(el, kind) {
    if (!el || !el.classList) return;
    el.classList.remove('af-highlight', 'af-highlight-ok', 'af-highlight-skip');
    if (kind) el.classList.add(kind);
  }
  function clearHighlights() {
    document.querySelectorAll('.af-highlight,.af-highlight-ok,.af-highlight-skip').forEach((el) => {
      el.classList.remove('af-highlight', 'af-highlight-ok', 'af-highlight-skip');
    });
  }

  // ---------- 悬浮操作面板(可拖拽小球) ----------
  const FLOAT_SECTIONS = [
    ['basic', '👤', '基本信息'],
    ['education', '🎓', '教育经历'],
    ['internship', '💼', '实习经历'],
    ['project', '🚀', '项目经历'],
    ['skills', '🏅', '技能证书'],
    ['intent', '🎯', '求职意向'],
    ['openQuestions', '📝', '开放题'],
    ['custom', '✨', '自定义'],
  ];
  let floatState = { created: false, expanded: false, x: null, y: null };

  function makeDraggable(handle, target) {
    let sx = 0, sy = 0, dx = 0, dy = 0, dragging = false;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const rect = target.getBoundingClientRect();
      dx = rect.left; dy = rect.top;
      e.preventDefault();
      const onMove = (ev) => {
        if (!dragging) return;
        let nx = dx + ev.clientX - sx;
        let ny = dy + ev.clientY - sy;
        nx = Math.max(0, Math.min(window.innerWidth - 60, nx));
        ny = Math.max(0, Math.min(window.innerHeight - 60, ny));
        target.style.left = nx + 'px';
        target.style.right = 'auto';
        target.style.top = ny + 'px';
        target.style.bottom = 'auto';
        floatState.x = nx; floatState.y = ny;
      };
      const onUp = () => {
        dragging = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  function ensureFloatBall() {
    if (floatState.created) return;
    floatState.created = true;

    const ball = h('div', { class: 'af-float-ball', text: '⚡', title: '秋招网申自动填充' });
    if (floatState.x !== null) {
      ball.style.left = floatState.x + 'px';
      ball.style.right = 'auto';
      ball.style.top = floatState.y + 'px';
      ball.style.bottom = 'auto';
    }
    shadow.appendChild(ball);
    makeDraggable(ball, ball);

    const panel = h('div', { class: 'af-float-panel', style: 'display:none' });
    shadow.appendChild(panel);

    ball.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });

    function buildPanelBody() {
      panel.innerHTML = '';
      const head = h('div', { class: 'fp-head' }, [
        h('span', { text: '⚡ 自动填充助手' }),
        h('button', { class: 'af-close', text: '×', onclick: () => togglePanel(false) }),
      ]);
      makeDraggable(head, panel);
      const body = h('div', { class: 'fp-body' });
      const addRow = (icon, text, onclick) => {
        const row = h('div', { class: 'af-fp-row', onclick }, [
          h('span', { class: 'fp-icon', text: icon }),
          h('span', { class: 'fp-text', text }),
        ]);
        body.appendChild(row);
      };
      addRow('⚡', '一键填充当前表单', () => { togglePanel(false); chrome.runtime.sendMessage({ type: 'AF_TRIGGER_FILL' }); });
      const countRow = h('div', { class: 'af-fp-row' });
      countRow.appendChild(h('span', { class: 'fp-icon', text: '🧩' }));
      countRow.appendChild(h('span', { class: 'fp-text', text: '分段填充:' }));
      countRow.appendChild(h('span', { class: 'af-fp-count', id: 'fpFieldCount', text: '…' }));
      body.appendChild(countRow);
      body.appendChild(h('div', { class: 'af-fp-divider' }));
      FLOAT_SECTIONS.forEach(([key, icon, name]) => {
        addRow(icon, name, () => { togglePanel(false); chrome.runtime.sendMessage({ type: 'AF_FILL_SECTIONS', sections: [key] }); });
      });
      body.appendChild(h('div', { class: 'af-fp-divider' }));
      addRow('📋', '记录本次投递', () => { togglePanel(false); chrome.runtime.sendMessage({ type: 'AF_RECORD_NOW' }); });
      addRow('📥', '捕获页面已填内容', () => { togglePanel(false); chrome.runtime.sendMessage({ type: 'AF_LEARN_COLLECT' }); });
      panel.appendChild(head);
      panel.appendChild(body);
      if (floatState.x !== null) {
        panel.style.left = Math.max(0, floatState.x - 200) + 'px';
        panel.style.right = 'auto';
      }
    }

    function togglePanel(force) {
      const show = force !== undefined ? force : !floatState.expanded;
      floatState.expanded = show;
      panel.style.display = show ? 'block' : 'none';
      if (show) buildPanelBody();
    }

    // 扫描字段数
    let lastCount = null;
    async function refreshCount() {
      try {
        const fields = AS.scanner.scan();
        const countEl = panel.querySelector('#fpFieldCount');
        if (countEl) countEl.textContent = String(fields.length);
        if (fields.length !== lastCount) {
          lastCount = fields.length;
          if (floatState.expanded) buildPanelBody();
        }
      } catch (e) { /* ignore */ }
    }
    refreshCount();
    setInterval(refreshCount, 4000);
    // SPA 路由变化时重新扫描
    window.addEventListener('popstate', () => setTimeout(refreshCount, 800));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(refreshCount, 600); });

    return { ball, panel, togglePanel };
  }

  // ---------- 经历素材选择器(勾选本次要展示的经历并排序) ----------
  function showExperiencePicker(profile, onDone) {
    const repeatCats = ['education', 'internship', 'project'];
    const cats = repeatCats.map((id) => ({
      id,
      name: (AS.schema.findCategory(id) || {}).name || id,
      entries: (profile.data && profile.data[id]) || [],
    })).filter((c) => c.entries.length > 1);
    if (!cats.length) { onDone && onDone(null); return null; }

    const order = {}; // catId -> [entryIndex...]
    cats.forEach((c) => { order[c.id] = c.entries.map((_, i) => i); });

    const body = h('div', { class: 'af-body' });
    const panels = {};
    cats.forEach((c) => {
      const block = h('div', { style: 'margin-bottom:10px' });
      block.appendChild(h('div', { style: 'font-weight:600;font-size:12.5px;margin-bottom:4px', text: c.name + ' (勾选要展示的条目, 可排序)' }));
      const list = h('div', { class: 'af-list', style: 'max-height:180px' });
      const renderList = () => {
        list.innerHTML = '';
        order[c.id].forEach((idx, pos) => {
          const entry = c.entries[idx];
          const title = entry.school || entry.intCompany || entry.projName || `条目 ${idx + 1}`;
          const row = h('div', { class: 'af-preview-item' }, [
            h('span', { style: 'color:#9ca3af;width:16px', text: String(pos + 1) }),
            h('span', { class: 'pv-label', style: 'flex:1', text: String(title).slice(0, 20) }),
            h('button', { class: 'af-btn ghost', style: 'padding:1px 6px;font-size:11px', text: '↑', onclick: () => {
              if (pos === 0) return;
              const arr = order[c.id];
              [arr[pos - 1], arr[pos]] = [arr[pos], arr[pos - 1]];
              renderList();
            } }),
            h('button', { class: 'af-btn ghost', style: 'padding:1px 6px;font-size:11px', text: '↓', onclick: () => {
              const arr = order[c.id];
              if (pos === arr.length - 1) return;
              [arr[pos + 1], arr[pos]] = [arr[pos], arr[pos + 1]];
              renderList();
            } }),
            h('button', { class: 'af-btn ghost', style: 'padding:1px 6px;font-size:11px;color:#dc2626', text: '✕', onclick: () => {
              order[c.id].splice(pos, 1);
              renderList();
            } }),
          ]);
          list.appendChild(row);
        });
      };
      renderList();
      block.appendChild(list);
      body.appendChild(block);
      panels[c.id] = list;
    });

    const panel = showPanel(h('div', {}, [
      head('选择本次要填充的经历', h('button', { class: 'af-close', text: '×', onclick: () => { closePanel(); onDone && onDone(undefined); } })),
      body,
      h('div', { class: 'af-body' }, [
        h('div', { class: 'af-actions' }, [
          h('button', { class: 'af-btn ghost', text: '全部使用', onclick: () => { closePanel(); onDone && onDone(null); } }),
          h('button', { class: 'af-btn primary', text: '按以上顺序填充', onclick: () => { closePanel(); onDone && onDone(order); } }),
        ]),
      ]),
    ]));
    return panel;
  }

  AS.overlay = {
    showSummary, showRecordPanel, showUnlockPrompt, showLearnPanel, showPreview,
    showExperiencePicker,
    highlight, clearHighlights, toast, closePanel, ensureFloatBall,
  };
})();
