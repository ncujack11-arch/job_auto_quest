/**
 * apps-view.js — 投递台账管理视图 (v1.2.0)
 * 列表总览 / 多维筛选 / 搜索 / 进度快捷切换 / 时间线 / 批量操作 / 标签 / 提醒 / 跨模块联动
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  let records = [];
  let statusFlow = [];
  let profiles = [];
  let filters = { keyword: '', status: '', category: '', channel: '', tag: '' };
  let selected = new Set();
  let containerRef = null;
  let editingId = null;
  let groupMode = false; // 按公司归组视图

  const STATUS_COLOR = {
    '待笔试': 'pill warn', '笔试中': 'pill warn', '一面': 'pill primary', '二面': 'pill primary',
    '终面': 'pill primary', 'HR面': 'pill primary', 'OC': 'pill primary', 'Offer': 'pill success',
    '已回绝': 'pill danger', '流程终止': 'pill muted',
  };

  async function reload() {
    [records, statusFlow, profiles] = await Promise.all([
      AS.storage.getApplications(),
      AS.storage.getStatusFlow(),
      AS.storage.getProfiles(),
    ]);
  }

  function filtered() {
    const kw = filters.keyword.trim().toLowerCase();
    return records.filter((r) => {
      if (filters.status && r.status !== filters.status) return false;
      if (filters.category && r.category !== filters.category) return false;
      if (filters.channel && r.channel !== filters.channel) return false;
      if (filters.tag && !(r.tags || []).includes(filters.tag)) return false;
      if (kw) {
        const hay = [r.company, r.position, r.category, r.city, r.channel, r.url, r.industry, (r.notes && r.notes.content) || '', (r.tags || []).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }

  function fmtTime(ts) {
    if (!ts) return '-';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function appliedTime(r) {
    const t = (r.timeline || []).find((e) => e.type === '投递');
    return t ? t.time : r.createdAt;
  }

  function renderToolbar() {
    const bar = UI().el('div', { class: 'toolbar' });
    bar.appendChild(UI().el('span', { style: 'font-size:13px;color:#6b7280;white-space:nowrap', text: `共 ${records.length} 条投递` }));
    const search = UI().el('input', {
      type: 'search', placeholder: '搜索公司 / 岗位 / 关键词...', value: filters.keyword,
      oninput: (e) => { filters.keyword = e.target.value; renderTable(); },
    });
    bar.appendChild(search);

    const statusSel = UI().el('select', { onchange: (e) => { filters.status = e.target.value; renderTable(); } });
    statusSel.appendChild(UI().el('option', { value: '', text: '全部状态' }));
    statusFlow.forEach((s) => statusSel.appendChild(UI().el('option', { value: s, text: s })));
    statusSel.value = filters.status;
    bar.appendChild(statusSel);

    const catSel = UI().el('select', { onchange: (e) => { filters.category = e.target.value; renderTable(); } });
    catSel.appendChild(UI().el('option', { value: '', text: '全部类别' }));
    [...new Set(records.map((r) => r.category).filter(Boolean))].forEach((c) => catSel.appendChild(UI().el('option', { value: c, text: c })));
    catSel.value = filters.category;
    bar.appendChild(catSel);

    const chSel = UI().el('select', { onchange: (e) => { filters.channel = e.target.value; renderTable(); } });
    chSel.appendChild(UI().el('option', { value: '', text: '全部渠道' }));
    [...new Set(records.map((r) => r.channel).filter(Boolean))].forEach((c) => chSel.appendChild(UI().el('option', { value: c, text: c })));
    chSel.value = filters.channel;
    bar.appendChild(chSel);

    const tagSel = UI().el('select', { onchange: (e) => { filters.tag = e.target.value; renderTable(); } });
    tagSel.appendChild(UI().el('option', { value: '', text: '全部标签' }));
    [...new Set(records.flatMap((r) => r.tags || []))].forEach((t) => tagSel.appendChild(UI().el('option', { value: t, text: '#' + t })));
    tagSel.value = filters.tag;
    bar.appendChild(tagSel);

    bar.appendChild(UI().el('button', { class: 'btn primary', text: '＋ 新增投递', onclick: () => openDetail(null) }));
    bar.appendChild(UI().el('button', {
      class: 'btn' + (groupMode ? ' primary' : ''), text: groupMode ? '🏢 按公司分组' : '📋 平铺列表',
      onclick: () => { groupMode = !groupMode; renderAll(); },
    }));
    bar.appendChild(UI().el('button', { class: 'btn', text: '📥 批量导入', onclick: () => openImport() }));
    bar.appendChild(UI().el('button', {
      class: 'btn', text: '📤 导出 CSV', onclick: () => {
        const list = selected.size ? records.filter((r) => selected.has(r.id)) : filtered();
        AS.apps.downloadCSV(list);
        UI().toast('已导出 CSV', 'success');
      },
    }));
    return bar;
  }

  // ---------- 批量导入 ----------
  function openImport() {
    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal' }, [])]);
    const box = modal.querySelector('.modal');
    box.appendChild(UI().el('h2', { text: '批量导入投递记录' }));
    box.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:12px', text: '支持 CSV(与「导出 CSV」格式一致)或 JSON(数组 / { records: [...] })。表头支持中文: 公司名称, 岗位名称, 岗位类别, 工作城市, 投递渠道, 状态, 优先级, 标签, 投递时间, 岗位链接, 薪资, base地点, 联系人, 备注。' }));

    const fileInput = UI().el('input', { type: 'file', accept: '.csv,.json', style: 'display:none' });
    const statusEl = UI().el('div', { class: 'empty', style: 'padding:24px', text: '请选择文件' });
    const previewEl = UI().el('div', {});

    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      statusEl.textContent = '解析中...';
      previewEl.innerHTML = '';
      try {
        const text = await f.text();
        const format = f.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
        const { records: list, errors } = AS.apps.importRecords(text, { format });
        if (!list.length) {
          statusEl.className = 'empty';
          statusEl.innerHTML = '';
          statusEl.appendChild(UI().el('b', { text: '未解析到有效记录' }));
          statusEl.appendChild(UI().el('span', { text: errors.join('; ') || '请检查文件格式' }));
          return;
        }
        statusEl.className = '';
        statusEl.textContent = `共解析 ${list.length} 条记录${errors.length ? ', ' + errors.length + ' 条跳过' : ''}`;
        previewEl.innerHTML = '';
        previewEl.appendChild(UI().el('div', { class: 'table-wrap', style: 'max-height:260px;overflow-y:auto' }, [renderImportPreview(list)]));
        box.dataset.records = JSON.stringify(list);
        if (errors.length) {
          previewEl.appendChild(UI().el('div', { style: 'color:#b45309;font-size:12px;margin-top:8px', text: errors.slice(0, 8).join('\n') }));
        }
      } catch (err) {
        statusEl.innerHTML = '';
        statusEl.appendChild(UI().el('b', { text: '解析失败' }));
        statusEl.appendChild(UI().el('span', { text: err.message }));
      }
    });

    box.appendChild(UI().el('div', { class: 'toolbar' }, [
      UI().el('button', { class: 'btn primary', text: '选择 CSV / JSON 文件', onclick: () => fileInput.click() }),
    ]));
    box.appendChild(fileInput);
    box.appendChild(statusEl);
    box.appendChild(previewEl);
    box.appendChild(UI().el('div', { class: 'modal-foot' }, [
      UI().el('button', { class: 'btn', text: '取消', onclick: () => modal.remove() }),
      UI().el('button', {
        class: 'btn primary', text: '确认导入全部', onclick: async () => {
          const list = box.dataset.records ? JSON.parse(box.dataset.records) : [];
          if (!list.length) return UI().toast('没有可导入的记录', 'error');
          if (!confirm(`确认导入 ${list.length} 条记录?`)) return;
          for (const rec of list) await AS.storage.upsertApplication(rec);
          modal.remove();
          UI().toast(`已导入 ${list.length} 条`, 'success');
          await reload(); renderAll();
        },
      }),
    ]));
    document.body.appendChild(modal);
  }

  function renderImportPreview(list) {
    const table = UI().el('table', { class: 'list' });
    table.appendChild(UI().el('thead', {}, [UI().el('tr', {}, [
      UI().el('th', { text: '公司' }), UI().el('th', { text: '岗位' }),
      UI().el('th', { text: '类别' }), UI().el('th', { text: '城市' }),
      UI().el('th', { text: '渠道' }), UI().el('th', { text: '状态' }), UI().el('th', { text: '投递时间' }),
    ])]));
    const tbody = UI().el('tbody');
    list.slice(0, 20).forEach((r) => {
      const t = (r.timeline || []).find((e) => e.type === '投递');
      tbody.appendChild(UI().el('tr', {}, [
        UI().el('td', { text: r.company }), UI().el('td', { text: r.position }),
        UI().el('td', { text: r.category || '-' }), UI().el('td', { text: r.city || '-' }),
        UI().el('td', { text: r.channel || '-' }), UI().el('td', { text: r.status }),
        UI().el('td', { text: t ? fmtTime(t.time) : '-' }),
      ]));
    });
    table.appendChild(tbody);
    return table;
  }

  function renderBatchBar() {
    const bar = UI().el('div', { class: 'card', style: 'display:' + (selected.size ? 'flex' : 'none') + ';align-items:center;gap:10px;padding:12px 16px' });
    bar.id = 'batchBar';
    bar.appendChild(UI().el('b', { text: `已选 ${selected.size} 条` }));
    const statusSel = UI().el('select', { style: 'padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px' });
    statusSel.appendChild(UI().el('option', { value: '', text: '批量改状态...' }));
    statusFlow.forEach((s) => statusSel.appendChild(UI().el('option', { value: s, text: s })));
    statusSel.addEventListener('change', async (e) => {
      if (!e.target.value) return;
      await AS.storage.bulkUpdate([...selected], { status: e.target.value });
      UI().toast(`已更新 ${selected.size} 条状态`, 'success');
      selected.clear();
      await reload(); renderAll();
    });
    bar.appendChild(statusSel);

    bar.appendChild(UI().el('button', {
      class: 'btn sm', text: '批量打标签', onclick: async () => {
        const tag = prompt('输入标签(多个用逗号分隔):');
        if (!tag) return;
        const tags = tag.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
        for (const id of selected) {
          const app = await AS.storage.getApplication(id);
          if (app) {
            app.tags = [...new Set([...(app.tags || []), ...tags])];
            await AS.storage.upsertApplication(app);
          }
        }
        UI().toast('标签已添加', 'success');
        await reload(); renderAll();
      },
    }));
    bar.appendChild(UI().el('button', {
      class: 'btn sm danger', text: '批量删除', onclick: async () => {
        if (!confirm(`确定删除选中的 ${selected.size} 条记录?`)) return;
        await AS.storage.removeApplications([...selected]);
        await removeRemindersFor([...selected]);
        UI().toast('已删除', 'success');
        selected.clear();
        await reload(); renderAll();
      },
    }));
    bar.appendChild(UI().el('button', {
      class: 'btn sm', text: '批量导出', onclick: () => {
        AS.apps.downloadCSV(records.filter((r) => selected.has(r.id)));
        UI().toast('已导出', 'success');
      },
    }));
    bar.appendChild(UI().el('button', { class: 'btn sm', text: '取消选择', onclick: () => { selected.clear(); renderAll(); } }));
    return bar;
  }

  async function removeRemindersFor(ids) {
    const list = await AS.storage.getReminders();
    await AS.storage.saveReminders(list.filter((r) => !ids.includes(r.applicationId)));
    chrome.runtime.sendMessage({ type: 'AF_SYNC_REMINDERS' });
  }

  // ---------- 败因快速打标: 标记「挂」时弹出快捷标签 + 一句话备注 ----------
  const FAIL_REASONS = ['笔试挂', '一面挂', '二面挂', 'HR面挂', '学历不符', '无回应', '已读不回', '流程终止'];
  function openFailReasonModal(app) {
    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal', style: 'width:min(460px,92vw)' }, [])]);
    const box = modal.querySelector('.modal');
    box.appendChild(UI().el('h2', { text: `标记失败 — ${app.company || '未命名'} ${app.position || ''}` }));
    box.appendChild(UI().el('p', { class: 'view-sub', text: '选择败因标签(可自定义), 支持一句话备注, 统计看板会自动汇总败因分布。' }));

    const labelWrap = UI().el('div', { style: 'display:flex;flex-wrap:wrap;gap:8px;margin:12px 0' });
    let selected = '';
    FAIL_REASONS.forEach((r) => {
      const chip = UI().el('button', {
        class: 'status-chip', style: 'padding:4px 12px;border:1px solid #e2e8f0;border-radius:14px;background:#fff;cursor:pointer;font-size:12.5px;color:#475569',
        text: r, onclick: () => {
          selected = r;
          labelWrap.querySelectorAll('.status-chip').forEach((c) => { c.style.borderColor = '#e2e8f0'; c.style.background = '#fff'; });
          chip.style.borderColor = '#dc2626'; chip.style.background = '#fef2f2';
        },
      });
      labelWrap.appendChild(chip);
    });
    box.appendChild(labelWrap);

    const customInput = UI().el('input', { type: 'text', placeholder: '或自定义败因(如: 时间冲突放弃/简历未过筛)' });
    const noteInput = UI().el('textarea', { placeholder: '一句话备注(选填): 如 笔试只做了一半 / 面试表现不佳...', style: 'min-height:54px' });
    box.appendChild(UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '自定义标签' }), customInput]));
    box.appendChild(UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '败因备注' }), noteInput]));

    box.appendChild(UI().el('div', { class: 'modal-foot' }, [
      UI().el('button', { class: 'btn', text: '取消', onclick: () => modal.remove() }),
      UI().el('button', {
        class: 'btn danger', text: '标记失败', onclick: async () => {
          const label = (customInput.value || '').trim() || selected;
          if (!label) { UI().toast('请选择或填写败因标签', 'error'); return; }
          app.failReason = { label, note: (noteInput.value || '').trim(), time: Date.now() };
          await AS.apps.setStatus(app.id, '已回绝');
          modal.remove();
          UI().toast(`已标记「${label}」`, 'success');
          await reload();
          renderAll();
        },
      }),
    ]));
    document.body.appendChild(modal);
  }

  function statusSelect(app, onChange) {
    const wrap = UI().el('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:150px' });
    const row1 = UI().el('div', { style: 'display:flex;gap:4px' });
    // 快捷状态按钮: 点一下即切换并记录时间; 「挂」弹出败因快速打标
    const QUICK = [['笔试', '笔试中'], ['一面', '一面'], ['二面', '二面'], ['OC', 'OC'], ['挂', '已回绝']];
    QUICK.forEach(([label, status]) => {
      const chip = UI().el('button', {
        class: 'status-chip' + (app.status === status ? ' active' : ''),
        style: 'font-size:10.5px;padding:1px 7px;border:1px solid #e2e8f0;border-radius:9px;background:#fff;cursor:pointer;color:#475569',
        text: label,
        onclick: async () => {
          if (label === '挂') { openFailReasonModal(app); return; }
          await AS.apps.setStatus(app.id, status);
          UI().toast(`${app.company} → ${status}`, 'success');
          await reload();
          renderAll();
        },
      });
      row1.appendChild(chip);
    });
    wrap.appendChild(row1);
    const sel = UI().el('select', {
      style: 'padding:3px 6px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px',
      onchange: async (e) => {
        const st = e.target.value;
        if (st === '已回绝' || st === '流程终止') { openFailReasonModal(app); sel.value = app.status; return; }
        await AS.apps.setStatus(app.id, st);
        UI().toast(`${app.company} → ${st}`, 'success');
        await reload();
        renderAll();
      },
    });
    statusFlow.forEach((s) => sel.appendChild(UI().el('option', { value: s, text: s })));
    sel.value = app.status;
    wrap.appendChild(sel);
    // 已标记败因: 列表显示标签
    if (app.failReason && app.failReason.label) {
      wrap.appendChild(UI().el('span', { class: 'pill', style: 'align-self:flex-start;background:#fef2f2;color:#dc2626', text: '❌ ' + app.failReason.label }));
    }
    return wrap;
  }

  function renderTable() {
    const wrap = document.getElementById('tableWrap');
    const list = filtered().sort((a, b) => appliedTime(b) - appliedTime(a));
    wrap.innerHTML = '';
    if (!list.length) {
      wrap.appendChild(UI().el('div', { class: 'empty' }, [
        UI().el('b', { text: '暂无投递记录' }),
        UI().el('span', { text: '填充后提交成功会自动弹出记录面板, 也可点击「新增投递」手动添加' }),
      ]));
      return;
    }
    const table = UI().el('table', { class: 'list' });
    const thead = UI().el('thead', {}, [UI().el('tr', {}, [
      UI().el('th', { style: 'width:30px' }),
      UI().el('th', { text: '公司' }),
      UI().el('th', { text: '岗位' }),
      UI().el('th', { text: '类别' }),
      UI().el('th', { text: '城市' }),
      UI().el('th', { text: '渠道' }),
      UI().el('th', { text: '状态' }),
      UI().el('th', { text: '投递时间' }),
      UI().el('th', { text: '标签' }),
      UI().el('th', { style: 'width:110px', text: '操作' }),
    ])]);
    const tbody = UI().el('tbody');
    list.forEach((app) => {
      const tr = UI().el('tr');
      const cb = UI().el('input', {
        type: 'checkbox', checked: selected.has(app.id),
        onchange: (e) => {
          if (e.target.checked) selected.add(app.id); else selected.delete(app.id);
          renderBatchBar();
        },
      });
      tr.appendChild(UI().el('td', {}, [cb]));
      tr.appendChild(UI().el('td', { style: 'font-weight:500', text: app.company }));
      tr.appendChild(UI().el('td', { text: app.position }));
      tr.appendChild(UI().el('td', { text: app.category || '-' }));
      tr.appendChild(UI().el('td', { text: app.city || '-' }));
      tr.appendChild(UI().el('td', { text: app.channel || '-' }));
      const st = UI().el('td', {}, [statusSelect(app)]);
      tr.appendChild(st);
      tr.appendChild(UI().el('td', { text: fmtTime(appliedTime(app)) }));
      tr.appendChild(UI().el('td', {}, (app.tags || []).map((t) => UI().el('span', { class: 'tag', text: t }))));
      const ops = UI().el('td', {}, [UI().el('div', { class: 'row-actions' }, [
        UI().el('button', { class: 'link-btn', text: '详情', onclick: () => openDetail(app.id) }),
        UI().el('button', { class: 'link-btn', text: '时间线', onclick: () => openTimeline(app.id) }),
        UI().el('button', { class: 'link-btn danger', text: '删', onclick: async () => {
          if (!confirm(`删除 ${app.company} ${app.position}?`)) return;
          await AS.storage.removeApplications([app.id]);
          await removeRemindersFor([app.id]);
          selected.delete(app.id);
          await reload(); renderAll();
        } }),
      ])]);
      tr.appendChild(ops);
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    renderBatchBar();
  }

  // ---------- 按公司归组视图 ----------
  function renderGrouped() {
    const wrap = document.getElementById('tableWrap');
    const list = filtered().sort((a, b) => appliedTime(b) - appliedTime(a));
    wrap.innerHTML = '';
    if (!list.length) {
      wrap.appendChild(UI().el('div', { class: 'empty' }, [
        UI().el('b', { text: '暂无投递记录' }),
        UI().el('span', { text: '填充后提交成功会自动弹出记录面板, 也可点击「新增投递」手动添加' }),
      ]));
      return;
    }
    const byCompany = {};
    list.forEach((r) => {
      const key = r.company || '未知公司';
      byCompany[key] = byCompany[key] || [];
      byCompany[key].push(r);
    });
    const companies = Object.entries(byCompany).sort((a, b) => b[1].length - a[1].length || (b[1][0] && appliedTime(b[1][0]) - appliedTime(a[1][0])));

    companies.forEach(([company, apps]) => {
      const card = UI().el('div', { class: 'card', style: 'padding:14px 16px' });
      const head = UI().el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:10px' });
      head.appendChild(UI().el('b', { style: 'font-size:14px', text: company }));
      head.appendChild(UI().el('span', { class: 'badge', text: `${apps.length} 个岗位` }));
      const statusCount = {};
      apps.forEach((a) => { statusCount[a.status] = (statusCount[a.status] || 0) + 1; });
      Object.entries(statusCount).forEach(([s, n]) => {
        const cls = STATUS_COLOR[s] || 'pill muted';
        head.appendChild(UI().el('span', { class: cls, style: 'font-size:11px', text: `${s}×${n}` }));
      });
      head.appendChild(UI().el('span', { style: 'flex:1' }));
      head.appendChild(UI().el('button', {
        class: 'link-btn danger', text: '删除整组', onclick: async () => {
          if (!confirm(`删除 ${company} 的 ${apps.length} 条投递记录?`)) return;
          await AS.storage.removeApplications(apps.map((a) => a.id));
          await removeRemindersFor(apps.map((a) => a.id));
          await reload(); renderAll();
        },
      }));
      card.appendChild(head);

      apps.forEach((app) => {
        const row = UI().el('div', { style: 'display:flex;align-items:center;gap:10px;padding:7px 8px;border-top:1px solid #f1f5f9;font-size:13px' });
        row.appendChild(UI().el('span', { style: 'flex:1;font-weight:500', text: app.position }));
        row.appendChild(UI().el('span', { style: 'width:70px;color:#6b7280;font-size:12px', text: app.city || '-' }));
        row.appendChild(UI().el('span', { style: 'width:110px', text: (() => {
          const sel = UI().el('select', { style: 'padding:2px 6px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px' });
          statusFlow.forEach((s) => sel.appendChild(UI().el('option', { value: s, text: s })));
          sel.value = app.status;
          sel.addEventListener('change', async () => {
            await AS.apps.setStatus(app.id, sel.value);
            await reload(); renderAll();
          });
          return sel;
        })() }));
        row.appendChild(UI().el('span', { style: 'width:150px;color:#9ca3af;font-size:12px', text: fmtTime(appliedTime(app)) }));
        row.appendChild(UI().el('span', { style: 'width:80px', text: (app.salary || '') } ));
        row.appendChild(UI().el('button', { class: 'link-btn', text: '详情', onclick: () => openDetail(app.id) }));
        row.appendChild(UI().el('button', {
          class: 'link-btn danger', text: '删', onclick: async () => {
            await AS.storage.removeApplications([app.id]);
            await removeRemindersFor([app.id]);
            await reload(); renderAll();
          },
        }));
        card.appendChild(row);
      });
      wrap.appendChild(card);
    });
  }

  function renderAll() {
    if (!containerRef) return;
    containerRef.innerHTML = '';
    containerRef.appendChild(renderToolbar());
    containerRef.appendChild(renderBatchBar());
    containerRef.appendChild(UI().el('div', { id: 'tableWrap' }));
    if (groupMode) renderGrouped();
    else renderTable();
  }

  // ---------- 详情弹窗 ----------
  function openDetail(id) {
    editingId = id;
    const app = id ? records.find((r) => r.id === id) : AS.apps.newRecord();
    if (!app) return;

    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal modal-xl' }, [])]);
    const box = modal.querySelector('.modal');
    const mk = (key, label, type, full) => {
      const item = UI().el('div', { class: 'form-item' + (full ? ' full' : '') });
      item.appendChild(UI().el('label', { text: label }));
      const input = UI().el('input', { type: type || 'text' });
      input.value = app[key] || '';
      input.addEventListener('input', (e) => { app[key] = e.target.value; });
      item.appendChild(input);
      return item;
    };
    const mkText = (key, label) => {
      const item = UI().el('div', { class: 'form-item full' });
      item.appendChild(UI().el('label', { text: label }));
      const ta = UI().el('textarea');
      ta.value = app[key] || '';
      ta.addEventListener('input', (e) => { app[key] = e.target.value; });
      item.appendChild(ta);
      return item;
    };

    // 基本信息
    const c1 = UI().el('div', { class: 'card' });
    c1.appendChild(UI().el('h3', { text: '基本信息' }));
    c1.appendChild(UI().el('div', { class: 'form-grid' }, [
      mk('company', '公司名称 *'), mk('position', '岗位名称 *'), mk('category', '岗位类别'),
      mk('city', '工作城市'), mk('channel', '投递渠道'), mk('industry', '公司行业'),
      mk('priority', '优先级'),
      mk('salary', '薪资待遇'), mk('base', 'base 地点'), mk('contact', '联系人'),
      mk('url', '岗位链接', 'url', true),
      (() => { app.failReasonNote = (app.failReason && app.failReason.note) || ''; return mkText('failReasonNote', '败因备注(标记失败时填写)'); })(),
      mkText('jdSnapshot', 'JD 快照'),
      mkText('notes.content', '备注 / 复盘总记'),
    ]));

    // 状态与时间线
    const c2 = UI().el('div', { class: 'card' });
    const stRow = UI().el('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:12px' });
    stRow.appendChild(UI().el('label', { text: '当前状态:' }));
    const stSel = UI().el('select', { style: 'padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px' });
    statusFlow.forEach((s) => stSel.appendChild(UI().el('option', { value: s, text: s })));
    stSel.value = app.status;
    stSel.addEventListener('change', () => {
      const prev = app.status;
      app.status = stSel.value;
      app.timeline = app.timeline || [];
      if (prev !== app.status) app.timeline.push({ id: AS.apps.uid(), type: '状态变更', time: Date.now(), note: `${prev} → ${app.status}` });
    });
    stRow.appendChild(stSel);
    c2.appendChild(stRow);

    c2.appendChild(UI().el('h4', { style: 'font-size:13px;color:#475569;margin-bottom:8px', text: '完整时间线' }));
    const tlWrap = UI().el('div', { class: 'timeline' });
    const renderTL = () => {
      tlWrap.innerHTML = '';
      (app.timeline || []).slice().sort((a, b) => (a.time || 0) - (b.time || 0)).forEach((ev) => {
        const item = UI().el('div', { class: 'tl-item' + (ev.type === '拒信' ? ' type-reject' : ev.type === 'Offer' ? ' type-offer' : '') });
        item.appendChild(UI().el('div', { class: 'tl-time', text: fmtTime(ev.time) + ' · ' + ev.type }));
        if (ev.note) item.appendChild(UI().el('div', { class: 'tl-note', text: ev.note }));
        item.appendChild(UI().el('button', {
          class: 'link-btn danger tl-del', text: '删除', onclick: async () => {
            app.timeline = (app.timeline || []).filter((x) => x.id !== ev.id);
            renderTL();
          },
        }));
        tlWrap.appendChild(item);
      });
    };
    renderTL();
    c2.appendChild(tlWrap);

    const addEventRow = UI().el('div', { class: 'form-grid', style: 'margin-top:10px' });
    const typeSel = UI().el('select');
    AS.apps.EVENT_TYPES.forEach((t) => typeSel.appendChild(UI().el('option', { value: t, text: t })));
    const timeInput = UI().el('input', { type: 'datetime-local' });
    timeInput.value = new Date().toISOString().slice(0, 16);
    const noteInput = UI().el('input', { type: 'text', placeholder: '备注(选填)' });
    const addBtn = UI().el('button', {
      class: 'btn primary', text: '＋ 添加节点', onclick: () => {
        app.timeline = app.timeline || [];
        const t = timeInput.value ? new Date(timeInput.value).getTime() : Date.now();
        app.timeline.push({ id: AS.apps.uid(), type: typeSel.value, time: t, note: noteInput.value.trim() });
        noteInput.value = '';
        renderTL();
      },
    });
    addEventRow.appendChild(UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '节点类型' }), typeSel]));
    addEventRow.appendChild(UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '时间' }), timeInput]));
    addEventRow.appendChild(UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '备注' }), noteInput]));
    addEventRow.appendChild(UI().el('div', { class: 'form-item', style: 'justify-content:flex-end' }, [addBtn]));
    c2.appendChild(addEventRow);
    c2.appendChild(UI().el('div', { class: 'form-item', style: 'margin-top:8px' }, [
      UI().el('label', { text: '同步提醒(可选, 到点浏览器本地通知)' }),
      UI().el('button', { class: 'btn sm', text: '＋ 添加提醒', onclick: () => {
        if (!records.some((r) => r.id === app.id)) return UI().toast('请先保存该记录再添加提醒', 'error');
        const label = prompt('提醒名称(如 一面 / 笔试):', '面试');
        if (!label) return;
        const t = prompt('提醒时间(格式: YYYY-MM-DD HH:MM):', '');
        if (!t) return;
        const ts = new Date(t.replace(' ', 'T')).getTime();
        if (isNaN(ts)) return UI().toast('时间格式错误', 'error');
        AS.reminders.upsert({ id: AS.reminders.uid(), applicationId: app.id, label, time: ts, notified: false }).then(() => {
          chrome.runtime.sendMessage({ type: 'AF_SYNC_REMINDERS' });
          renderReminderList();
          UI().toast('提醒已添加', 'success');
        });
      } }),
    ]));
    const reminderList = UI().el('div', { class: 'form-item', style: 'margin-top:6px' });
    const renderReminderList = async () => {
      const list = await AS.storage.getReminders();
      reminderList.innerHTML = '';
      list.filter((r) => r.applicationId === app.id).forEach((r) => {
        reminderList.appendChild(UI().el('div', { style: 'display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0' }, [
          UI().el('span', { text: `⏰ ${r.label} · ${fmtTime(r.time)}${r.notified ? ' (已提醒)' : ''}` }),
          UI().el('button', { class: 'link-btn danger', text: '删', onclick: async () => {
            await AS.reminders.remove(r.id);
            chrome.runtime.sendMessage({ type: 'AF_SYNC_REMINDERS' });
            renderReminderList();
          } }),
        ]));
      });
    };
    renderReminderList();
    c2.appendChild(reminderList);

    // 复盘面试
    const c3 = UI().el('div', { class: 'card' });
    c3.appendChild(UI().el('h3', { text: '笔面试复盘', children: [UI().el('span', { class: 'badge', text: '可一键同步至开放题库' })] }));
    const ivWrap = UI().el('div');
    const renderIV = () => {
      ivWrap.innerHTML = '';
      (app.interviews || []).forEach((iv, i) => {
        const card = UI().el('div', { class: 'entry-card' });
        card.appendChild(UI().el('div', { class: 'entry-head' }, [
          UI().el('b', { text: `轮次 #${i + 1}: ${iv.round || '面试'}` }),
          UI().el('button', { class: 'link-btn danger', text: '删除', onclick: () => { app.interviews.splice(i, 1); renderIV(); } }),
        ]));
        card.appendChild(UI().el('div', { class: 'form-grid' }, [
          UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '轮次' }), (() => {
            const s = UI().el('select');
            ['一面', '二面', '终面', 'HR面', '笔试', 'OC沟通'].forEach((x) => s.appendChild(UI().el('option', { value: x, text: x })));
            s.value = iv.round || '一面';
            s.addEventListener('change', (e) => { iv.round = e.target.value; });
            return s;
          })()]),
          UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '时间' }), (() => {
            const d = UI().el('input', { type: 'datetime-local' });
            d.value = iv.time ? new Date(iv.time).toISOString().slice(0, 16) : '';
            d.addEventListener('change', (e) => { iv.time = new Date(e.target.value).getTime(); });
            return d;
          })()]),
          UI().el('div', { class: 'form-item full' }, [UI().el('label', { text: '面试问题' }), (() => {
            const d = UI().el('input', { type: 'text' });
            d.value = iv.question || '';
            d.addEventListener('input', (e) => { iv.question = e.target.value; });
            return d;
          })()]),
          UI().el('div', { class: 'form-item full' }, [UI().el('label', { text: '回答 / 复盘' }), (() => {
            const d = UI().el('textarea');
            d.value = iv.answer || '';
            d.addEventListener('input', (e) => { iv.answer = e.target.value; });
            return d;
          })()]),
        ]));
        ivWrap.appendChild(card);
      });
    };
    renderIV();
    c3.appendChild(ivWrap);
    c3.appendChild(UI().el('button', {
      class: 'add-entry-btn', text: '+ 添加一轮复盘', onclick: () => {
        app.interviews = app.interviews || [];
        app.interviews.push({ round: '一面', time: Date.now(), question: '', answer: '' });
        renderIV();
      },
    }));
    c3.appendChild(UI().el('div', { class: 'toolbar', style: 'margin-top:10px' }, [
      UI().el('button', {
        class: 'btn', text: '📥 同步面经至开放题库', onclick: async () => {
          const profile = await AS.storage.getActiveProfile();
          if (!profile) return UI().toast('无信息方案', 'error');
          profile.data.openQuestions = profile.data.openQuestions || [];
          let n = 0;
          (app.interviews || []).forEach((iv) => {
            if (iv.question && iv.answer) {
              profile.data.openQuestions.push({
                question: `【${app.company}】${iv.round}: ${iv.question}`,
                answer: iv.answer,
                tags: [app.company, iv.round],
              });
              n++;
            }
          });
          if (n) { await AS.storage.saveProfile(profile); UI().toast(`已同步 ${n} 条面经到开放题库`, 'success'); }
          else UI().toast('没有填写问题与答案的复盘', '');
        },
      }),
    ]));

    // 关联与复用
    const c4 = UI().el('div', { class: 'card' });
    c4.appendChild(UI().el('h3', { text: '跨模块联动' }));
    const linkGrid = UI().el('div', { class: 'form-grid' });
    const profSel = UI().el('select', { onchange: (e) => { app.profileId = e.target.value; } });
    profSel.appendChild(UI().el('option', { value: '', text: '— 选择本次使用的信息方案 —' }));
    profiles.forEach((p) => profSel.appendChild(UI().el('option', { value: p.id, text: p.name })));
    profSel.value = app.profileId || '';
    linkGrid.appendChild(UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '关联信息方案' }), profSel]));
    linkGrid.appendChild(UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '简历版本描述' }), (() => {
      const i = UI().el('input', { type: 'text', placeholder: '如: v2 技术岗简历' });
      i.value = app.resumeVersion || '';
      i.addEventListener('input', (e) => { app.resumeVersion = e.target.value; });
      return i;
    })()]));
    linkGrid.appendChild(UI().el('div', { class: 'form-item' }, [UI().el('label', { text: '标签(逗号分隔)' }), (() => {
      const i = UI().el('input', { type: 'text' });
      i.value = (app.tags || []).join(', ');
      i.addEventListener('input', (e) => { app.tags = e.target.value.split(/[,，]/).map((t) => t.trim()).filter(Boolean); });
      return i;
    })()]));
    c4.appendChild(linkGrid);
    c4.appendChild(UI().el('div', { class: 'toolbar', style: 'margin-top:10px' }, [
      UI().el('button', {
        class: 'btn', text: '📖 回溯信息方案', onclick: () => {
          location.hash = '#/profile';
        },
      }),
      UI().el('button', {
        class: 'btn primary', text: '🚀 一键复用投递同公司其他岗位', onclick: async () => {
          if (!app.url) return UI().toast('该记录没有岗位链接', 'error');
          await AS.storage.setReusePayload({
            url: app.url,
            company: app.company,
            position: app.position,
            createdAt: Date.now(),
          });
          UI().toast('已设置复用载荷, 打开岗位链接后按 Alt+Shift+F 自动填充公司/岗位', 'success');
          window.open(app.url, '_blank');
        },
      }),
    ]));

    box.appendChild(c1);
    box.appendChild(c2);
    box.appendChild(c3);
    box.appendChild(c4);

    const foot = UI().el('div', { class: 'modal-foot' }, [
      UI().el('button', { class: 'btn', text: '取消', onclick: () => modal.remove() }),
      UI().el('button', {
        class: 'btn primary', text: '💾 保存', onclick: async () => {
          if (!app.company || !app.position) return UI().toast('公司名称与岗位名称为必填', 'error');
          await AS.storage.upsertApplication(app);
          modal.remove();
          UI().toast('已保存', 'success');
          await reload(); renderAll();
        },
      }),
    ]);
    box.appendChild(foot);
    document.body.appendChild(modal);
  }

  // ---------- 时间线弹窗(只读时间线) ----------
  function openTimeline(id) {
    const app = records.find((r) => r.id === id);
    if (!app) return;
    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal' }, [])]);
    const box = modal.querySelector('.modal');
    box.appendChild(UI().el('h2', { text: `${app.company} ${app.position} — 完整时间线` }));
    const tl = UI().el('div', { class: 'timeline' });
    (app.timeline || []).slice().sort((a, b) => (a.time || 0) - (b.time || 0)).forEach((ev) => {
      const item = UI().el('div', { class: 'tl-item' + (ev.type === '拒信' ? ' type-reject' : ev.type === 'Offer' ? ' type-offer' : '') });
      item.appendChild(UI().el('div', { class: 'tl-time', text: fmtTime(ev.time) + ' · ' + ev.type }));
      if (ev.note) item.appendChild(UI().el('div', { class: 'tl-note', text: ev.note }));
      tl.appendChild(item);
    });
    box.appendChild(tl);
    box.appendChild(UI().el('div', { class: 'modal-foot' }, [UI().el('button', { class: 'btn', text: '关闭', onclick: () => modal.remove() })]));
    document.body.appendChild(modal);
  }

  async function render(container, query) {
    containerRef = container;
    await reload();
    if (query && query.focus) {
      const target = records.find((r) => r.id === query.focus);
      if (target) openDetail(target.id);
    }
    renderAll();
  }

  AS.views = AS.views || {};
  AS.views.applications = render;
})();
