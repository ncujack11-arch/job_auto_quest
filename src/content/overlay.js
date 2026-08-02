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

  // ---------- 填充结果 ----------
  function showSummary(summary) {
    if (!summary || (summary.total === 0)) return;
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

  AS.overlay = { showSummary, showRecordPanel, showUnlockPrompt, showLearnPanel, toast, closePanel };
})();
