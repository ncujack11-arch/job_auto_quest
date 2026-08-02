/**
 * profile-view.js — 信息库管理视图
 * 多方案切换、全分类字段编辑、自定义字段、敏感字段加密展示
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  const SKIP_CATS = ['openQuestions']; // 开放题库由独立视图管理

  let currentProfile = null;
  let dirty = false;

  function newProfile(name) {
    const now = Date.now();
    return {
      id: 'p' + now.toString(36) + Math.random().toString(36).slice(2, 7),
      name: name || '新方案',
      description: '',
      createdAt: now,
      updatedAt: now,
      data: {},
    };
  }

  function emptyData() {
    const d = {};
    AS.schema.CATEGORIES.forEach((cat) => {
      if (cat.repeatable) d[cat.id] = [];
      else d[cat.id] = {};
    });
    d.custom = [];
    return d;
  }

  // 敏感字段: 已加密且未解锁时遮蔽
  function fieldInputValue(profile, catId, field, entry) {
    const src = entry !== undefined ? entry : profile.data[catId];
    const raw = src ? src[field.key] : '';
    if (field.sensitive && AS.encrypt.isEncrypted(raw)) return { encrypted: true, value: '' };
    return { encrypted: false, value: raw === undefined || raw === null ? '' : String(raw) };
  }

  async function maybeDecrypt(fieldKey, raw) {
    if (!AS.encrypt.isEncrypted(raw)) return { value: raw, encrypted: false };
    try {
      const r = await chrome.runtime.sendMessage({ type: 'AF_DECRYPT', value: raw });
      if (r && r.value !== undefined) return { value: r.value, encrypted: false };
      if (r && r.error) return { value: '', encrypted: true, error: r.error };
    } catch (e) { /* ignore */ }
    return { value: '', encrypted: true, error: '未解锁' };
  }

  function markDirty() {
    dirty = true;
    document.getElementById('profileSaveBtn').disabled = false;
  }

  // 卡片区容器解析: 避免清空整个视图(含工具条), 保证 markDirty 的保存按钮始终存在
  function formTarget() {
    const el = document.getElementById('profileForm');
    return el && el.isConnected ? el : containerRef;
  }

  function renderProfileForm() {
    const container = formTarget();
    container.innerHTML = '';
    const data = currentProfile.data;

    AS.schema.CATEGORIES.filter((cat) => !SKIP_CATS.includes(cat.id)).forEach((cat) => {
      const card = UI().el('div', { class: 'card' });
      const h3 = UI().el('h3', { text: `${cat.icon} ${cat.name}` });
      if (cat.repeatable) {
        h3.appendChild(UI().el('span', { class: 'badge', text: '可多条' }));
        h3.appendChild(UI().el('span', { class: 'badge', text: `共 ${(data[cat.id] || []).length} 条` }));
      }
      card.appendChild(h3);

      if (!cat.repeatable) {
        card.appendChild(renderStaticFields(cat, data[cat.id]));
      } else {
        const list = data[cat.id] || [];
        list.forEach((entry, idx) => card.appendChild(renderEntryCard(cat, entry, idx)));
        const addBtn = UI().el('button', {
          class: 'add-entry-btn',
          text: `+ 添加${cat.name.slice(0, 2)}`,
          onclick: () => {
            data[cat.id] = data[cat.id] || [];
            data[cat.id].push({});
            markDirty();
            renderProfileForm();
          },
        });
        card.appendChild(addBtn);
      }
      container.appendChild(card);
    });

    // 自定义字段
    const card = UI().el('div', { class: 'card' });
    card.appendChild(UI().el('h3', { text: '✨ 自定义字段', children: [UI().el('span', { class: 'badge', text: '适配小众表单' })] }));
    const customList = data.custom || [];
    customList.forEach((item, idx) => {
      const row = UI().el('div', { class: 'entry-card', style: 'padding:10px' });
      row.appendChild(UI().el('div', { class: 'form-grid' }, [
        fieldWrap('custom_key_' + idx, '字段标识(英文)', item.key, (v) => { item.key = v; markDirty(); }),
        fieldWrap('custom_label_' + idx, '字段名称', item.label, (v) => { item.label = v; markDirty(); }),
        fieldWrap('custom_value_' + idx, '字段值', item.value, (v) => { item.value = v; markDirty(); }),
      ]));
      row.appendChild(UI().el('div', { style: 'margin-top:8px;text-align:right' }, [
        UI().el('button', {
          class: 'btn sm danger', text: '删除', onclick: () => {
            data.custom.splice(idx, 1);
            markDirty();
            renderProfileForm();
          },
        }),
      ]));
      card.appendChild(row);
    });
    card.appendChild(UI().el('button', {
      class: 'add-entry-btn', text: '+ 添加自定义字段', onclick: () => {
        data.custom = data.custom || [];
        data.custom.push({ key: '', label: '', value: '' });
        markDirty();
        renderProfileForm();
      },
    }));
    container.appendChild(card);
  }

  function fieldWrap(id, label, value, onChange, extra) {
    const item = UI().el('div', { class: 'form-item' + (extra && extra.full ? ' full' : '') });
    item.appendChild(UI().el('label', { text: label }));
    const input = UI().el('input', {
      type: 'text', id, value: value === undefined || value === null ? '' : String(value),
      oninput: (e) => onChange(e.target.value),
    });
    item.appendChild(input);
    return item;
  }

  function renderStaticFields(cat, obj) {
    const grid = UI().el('div', { class: 'form-grid' });
    const data = obj || (currentProfile.data[cat.id] = {});
    cat.fields.forEach((f) => {
      const { encrypted, value } = fieldInputValue(currentProfile, cat.id, f);
      const item = UI().el('div', { class: 'form-item' + (f.key === 'majorCourses' || f.key === 'certificates' || f.key === 'awards' ? ' full' : '') });
      const labelEl = UI().el('label', { text: f.label + (f.sensitive ? ' 🔒' : '') });
      if (f.type === 'select') {
        const sel = UI().el('select', {
          id: `f_${f.key}`,
          onchange: (e) => { data[f.key] = e.target.value; markDirty(); },
        });
        sel.appendChild(UI().el('option', { value: '', text: '— 请选择 —' }));
        f.options.forEach((o) => sel.appendChild(UI().el('option', { value: o, text: o })));
        sel.value = encrypted ? '' : value;
        if (encrypted) { sel.disabled = true; sel.appendChild(UI().el('option', { value: '', text: '🔒 已加密(需解锁)' })); }
        item.appendChild(labelEl);
        item.appendChild(sel);
      } else if (f.type === 'date') {
        const input = UI().el('input', {
          type: 'date', id: `f_${f.key}`, value: encrypted ? '' : value,
          onchange: (e) => { data[f.key] = e.target.value; markDirty(); },
        });
        if (encrypted) { input.disabled = true; }
        item.appendChild(labelEl);
        item.appendChild(input);
      } else if (f.type === 'file') {
        const input = UI().el('input', { type: 'file', id: `f_${f.key}`, accept: 'image/*', disabled: true });
        const hint = UI().el('div', { class: 'locked-hint', text: '证件照需在网申页面手动上传, 插件不读取本地图片' });
        item.appendChild(labelEl);
        item.appendChild(input);
        item.appendChild(hint);
      } else {
        const input = UI().el('input', {
          type: f.sensitive ? 'password' : 'text', id: `f_${f.key}`, value: encrypted ? '' : value,
          placeholder: encrypted ? '🔒 已加密, 解锁后可见' : '',
          disabled: encrypted ? true : undefined,
          oninput: (e) => { data[f.key] = e.target.value; markDirty(); },
        });
        item.appendChild(labelEl);
        item.appendChild(input);
        // 敏感字段: 默认打码, 可切换显示明文
        if (f.sensitive && !encrypted) {
          const toggle = UI().el('button', {
            class: 'link-btn', style: 'align-self:flex-start', text: '👁 显示', onclick: (ev) => {
              ev.preventDefault();
              const inp = document.getElementById(`f_${f.key}`);
              if (!inp) return;
              const show = inp.type === 'password';
              inp.type = show ? 'text' : 'password';
              ev.target.textContent = show ? '🙈 隐藏' : '👁 显示';
            },
          });
          item.appendChild(toggle);
        }
        if (encrypted) {
          item.appendChild(UI().el('div', { class: 'locked-hint', style: 'display:flex;justify-content:space-between' }, [
            UI().el('span', { text: '敏感字段已加密存储' }),
            UI().el('button', {
              class: 'link-btn', text: '解锁查看', onclick: async (ev) => {
                ev.preventDefault();
                const { value: plain, error } = await maybeDecrypt(f.key, rawValue(currentProfile, cat.id, f));
                if (!error) {
                  const inp = document.getElementById(`f_${f.key}`);
                  if (inp) { inp.value = plain; inp.disabled = false; data[f.key] = plain; }
                } else {
                  UI().toast('请先在设置中解锁敏感字段', 'error');
                }
              },
            }),
          ]));
        }
      }
      grid.appendChild(item);
    });
    return grid;
  }

  function rawValue(profile, catId, field) {
    return profile.data[catId] ? profile.data[catId][field.key] : '';
  }

  function renderEntryCard(cat, entry, idx) {
    const card = UI().el('div', { class: 'entry-card' });
    const head = UI().el('div', { class: 'entry-head' });
    const title = UI().el('b', {});
    title.appendChild(UI().el('span', { class: 'idx', text: `#${idx + 1} ` }));
    title.appendChild(document.createTextNode(cat.name));
    head.appendChild(title);
    head.appendChild(UI().el('button', {
      class: 'link-btn danger', text: '删除本条', onclick: () => {
        currentProfile.data[cat.id].splice(idx, 1);
        markDirty();
        renderProfileForm();
      },
    }));
    card.appendChild(head);
    const grid = UI().el('div', { class: 'form-grid' });
    cat.fields.forEach((f) => {
      const { encrypted, value } = fieldInputValue(currentProfile, cat.id, f, entry);
      const item = UI().el('div', { class: 'form-item' + (['workContent', 'achievements', 'majorCourses', 'honors', 'projBackground', 'projDuty', 'projOutcome'].includes(f.key) ? ' full' : '') });
      item.appendChild(UI().el('label', { text: f.label + (f.sensitive ? ' 🔒' : '') }));
      if (f.type === 'select') {
        const sel = UI().el('select', {
          onchange: (e) => { entry[f.key] = e.target.value; markDirty(); },
        });
        sel.appendChild(UI().el('option', { value: '', text: '— 请选择 —' }));
        f.options.forEach((o) => sel.appendChild(UI().el('option', { value: o, text: o })));
        sel.value = encrypted ? '' : value;
        item.appendChild(sel);
      } else if (f.type === 'date') {
        item.appendChild(UI().el('input', {
          type: 'date', value: encrypted ? '' : value,
          onchange: (e) => { entry[f.key] = e.target.value; markDirty(); },
        }));
      } else {
        item.appendChild(UI().el('input', {
          type: 'text', value: encrypted ? '' : value,
          oninput: (e) => { entry[f.key] = e.target.value; markDirty(); },
        }));
      }
      grid.appendChild(item);
    });
    card.appendChild(grid);
    return card;
  }
  let containerRef = null;

  function renderTop(container) {
    const toolbar = UI().el('div', { class: 'toolbar' });
    const sel = UI().el('select', {
      style: 'min-width:200px',
      onchange: async (e) => {
        if (dirty) {
          const ok = await doSave();
          if (!ok) return;
        }
        const id = e.target.value;
        if (!id) return;
        await AS.storage.saveSettings({ activeProfileId: id });
        await loadProfile(id);
        await render(containerRef);
      },
    });
    sel.appendChild(UI().el('option', { value: '', text: '— 请选择方案 —' }));
    (currentProfile ? [currentProfile] : []).forEach(() => {});
    toolbar.appendChild(UI().el('span', { text: '当前方案:' }));
    toolbar.appendChild(sel);

    const descInput = UI().el('input', {
      type: 'text', placeholder: '方案描述(如: 技术岗 / 算法岗)', style: 'flex:1;min-width:180px;max-width:340px',
      value: currentProfile ? currentProfile.description || '' : '',
      oninput: (e) => { currentProfile.description = e.target.value; markDirty(); },
    });
    toolbar.appendChild(descInput);

    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '＋ 新建方案', onclick: () => openNewProfileModal(),
    }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '✏ 重命名', onclick: async () => {
        const name = prompt('新的方案名称:', currentProfile.name);
        if (!name || !name.trim()) return;
        currentProfile.name = name.trim();
        currentProfile.updatedAt = Date.now();
        await AS.storage.saveProfile(currentProfile);
        dirty = false;
        UI().toast('已重命名', 'success');
        await render(containerRef);
      },
    }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn danger', text: '🗑 删除方案', onclick: async () => {
        if (!confirm(`确定删除方案「${currentProfile.name}」? 该操作不可恢复`)) return;
        await AS.storage.deleteProfile(currentProfile.id);
        currentProfile = null;
        dirty = false;
        await render(containerRef);
      },
    }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn primary', id: 'profileSaveBtn', disabled: !dirty, text: '💾 保存全部修改',
      onclick: async () => {
        await doSave();
        UI().toast('已保存', 'success');
      },
    }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '📤 复制到其他方案', onclick: () => openCopyToModal(),
    }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '📋 复制视图', onclick: () => openCopyView(),
    }));
    return toolbar;
  }

  // 方案数据量描述(复制选择时展示, 便于判断该复制什么)
  function profileDataSummary(p) {
    const d = p.data || {};
    try {
      const basic = Object.keys(d.basic || {}).length;
      const skills = Object.keys(d.skills || {}).length;
      const intent = Object.keys(d.intent || {}).length;
      const edu = (d.education || []).length;
      const exp = (d.internship || []).length + (d.project || []).length;
      const quiz = (d.openQuestions || []).length;
      const parts = [];
      if (basic) parts.push('基础' + basic + '项');
      if (skills) parts.push('技能' + skills + '项');
      if (intent) parts.push('意向' + intent + '项');
      if (edu) parts.push('教育' + edu + '条');
      if (exp) parts.push('经历' + exp + '条');
      if (quiz) parts.push('题库' + quiz + '题');
      return parts.join(' · ') || '空白方案';
    } catch (e) { return ''; }
  }

  // ---------- 新建方案弹窗(支持从现有方案复制) ----------
  async function openNewProfileModal() {
    const profiles = await AS.storage.getProfiles();
    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal', style: 'width:min(480px,92vw)' }, [])]);
    const box = modal.querySelector('.modal');
    box.appendChild(UI().el('h2', { text: '新建信息方案' }));

    const nameInput = UI().el('input', { type: 'text', placeholder: '方案名称(如: 算法岗 / 腾讯定制版)' });
    const i1 = UI().el('div', { class: 'form-item' });
    i1.appendChild(UI().el('label', { text: '方案名称 *' }));
    i1.appendChild(nameInput);
    box.appendChild(i1);

    // 默认复制最近修改的方案, 避免误建空白方案重复填写
    const recentId = [...profiles].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] ? [...profiles].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id : '';
    const copySel = UI().el('select');
    copySel.appendChild(UI().el('option', { value: '', text: '— 空白方案(不复制)—' }));
    profiles.forEach((p) => {
      const summary = profileDataSummary(p);
      copySel.appendChild(UI().el('option', { value: p.id, text: p.name + (summary ? ' — ' + summary : '') + (p.description ? ' · ' + p.description : '') }));
    });
    copySel.value = recentId;
    const i2 = UI().el('div', { class: 'form-item' });
    i2.appendChild(UI().el('label', { text: '复制自(默认最近方案, 可在此基础上修改避免重复填写)' }));
    i2.appendChild(copySel);
    box.appendChild(i2);
    const srcInfo = UI().el('p', { class: 'view-sub', style: 'margin:4px 0 0 0;color:#64748b;font-size:12px' });
    i2.appendChild(srcInfo);
    const updateSrcInfo = () => {
      const p = profiles.find((x) => x.id === copySel.value);
      srcInfo.textContent = p ? `将复制: ${profileDataSummary(p)}。新建后可在该方案基础上修改。` : '将创建空白方案, 所有内容需手动填写。';
    };
    copySel.addEventListener('change', updateSrcInfo);
    updateSrcInfo();

    box.appendChild(UI().el('div', { class: 'modal-foot' }, [
      UI().el('button', { class: 'btn', text: '取消', onclick: () => modal.remove() }),
      UI().el('button', {
        class: 'btn primary', text: '创建方案', onclick: async () => {
          const name = nameInput.value.trim();
          if (!name) { UI().toast('请填写方案名称', 'error'); return; }
          const p = newProfile(name);
          const srcId = copySel.value;
          if (srcId) {
            const src = profiles.find((x) => x.id === srcId);
            if (src && src.data) {
              // 深拷贝来源方案数据(排除不可复制的开放题库? 开放题可跨方案共用, 复制保留)
              p.data = JSON.parse(JSON.stringify(src.data || {}));
              p.description = (src.description ? '复制自 ' + src.name : '');
            }
          }
          if (!p.data || typeof p.data !== 'object') p.data = emptyData();
          // 结构完整性
          AS.schema.CATEGORIES.forEach((cat) => {
            if (cat.repeatable && !Array.isArray(p.data[cat.id])) p.data[cat.id] = [];
            if (!cat.repeatable && (!p.data[cat.id] || typeof p.data[cat.id] !== 'object')) p.data[cat.id] = {};
          });
          if (!Array.isArray(p.data.custom)) p.data.custom = [];
          await AS.storage.saveProfile(p);
          await AS.storage.saveSettings({ activeProfileId: p.id });
          currentProfile = p;
          dirty = false;
          modal.remove();
          UI().toast(srcId ? `已创建方案「${name}」(复制自 ${profiles.find((x) => x.id === srcId).name})` : `已创建空白方案「${name}」`, 'success');
          await render(containerRef);
        },
      }),
    ]));
    document.body.appendChild(modal);
    nameInput.focus();
  }

  // ---------- 一键复制到其他方案(整体覆盖 / 合并) ----------
  async function openCopyToModal() {
    if (!currentProfile) { UI().toast('请先选择方案', 'error'); return; }
    const profiles = await AS.storage.getProfiles();
    const others = profiles.filter((p) => p.id !== currentProfile.id);
    if (!others.length) { UI().toast('暂无其他方案可复制, 请先新建', 'error'); return; }
    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal', style: 'width:min(440px,92vw)' }, [])]);
    const box = modal.querySelector('.modal');
    box.appendChild(UI().el('h2', { text: `复制「${currentProfile.name}」到其他方案` }));
    box.appendChild(UI().el('p', { class: 'view-sub', text: `来源方案内容: ${profileDataSummary(currentProfile)}` }));

    const targetSel = UI().el('select');
    others.forEach((p) => targetSel.appendChild(UI().el('option', { value: p.id, text: p.name + (p.description ? ' — ' + p.description : '') })));
    const i1 = UI().el('div', { class: 'form-item' });
    i1.appendChild(UI().el('label', { text: '目标方案 *' }));
    i1.appendChild(targetSel);
    box.appendChild(i1);

    const modeSel = UI().el('select');
    modeSel.appendChild(UI().el('option', { value: 'merge', text: '合并: 目标为空白的字段用来源填充(保留目标已有内容)' }));
    modeSel.appendChild(UI().el('option', { value: 'overwrite', text: '整体覆盖: 目标方案完全替换为来源内容(谨慎)' }));
    const i2 = UI().el('div', { class: 'form-item' });
    i2.appendChild(UI().el('label', { text: '复制方式' }));
    i2.appendChild(modeSel);
    box.appendChild(i2);

    box.appendChild(UI().el('div', { class: 'modal-foot' }, [
      UI().el('button', { class: 'btn', text: '取消', onclick: () => modal.remove() }),
      UI().el('button', {
        class: 'btn primary', text: '开始复制', onclick: async () => {
          const target = profiles.find((x) => x.id === targetSel.value);
          if (!target) { UI().toast('请选择目标方案', 'error'); return; }
          const src = currentProfile;
          const mode = modeSel.value;
          const srcData = JSON.parse(JSON.stringify(src.data || {}));
          if (mode === 'overwrite') {
            target.data = srcData;
          } else {
            // 合并: 字段级空值填充 + 经历条目补全
            target.data = target.data || {};
            AS.schema.CATEGORIES.forEach((cat) => {
              const s = srcData[cat.id];
              const t = target.data[cat.id];
              if (!s) return;
              if (cat.repeatable) {
                const tArr = Array.isArray(t) ? t : [];
                // 经历条目: 目标无同语义条目时追加来源条目(按首字段判断)
                const firstKey = cat.fields && cat.fields[0] ? cat.fields[0].key : 'school';
                const tKeys = new Set(tArr.map((e) => String(e[firstKey] || '').trim()));
                const toAdd = (Array.isArray(s) ? s : []).filter((e) => !tKeys.has(String(e[firstKey] || '').trim()));
                target.data[cat.id] = tArr.concat(toAdd);
              } else {
                const tObj = (t && typeof t === 'object') ? t : {};
                Object.keys(s).forEach((k) => {
                  const sv = s[k];
                  const tv = tObj[k];
                  if (sv !== undefined && sv !== null && sv !== '' && (tv === undefined || tv === null || tv === '')) tObj[k] = sv;
                });
                target.data[cat.id] = tObj;
              }
            });
          }
          // 结构完整性
          AS.schema.CATEGORIES.forEach((cat) => {
            if (cat.repeatable && !Array.isArray(target.data[cat.id])) target.data[cat.id] = [];
            if (!cat.repeatable && (!target.data[cat.id] || typeof target.data[cat.id] !== 'object')) target.data[cat.id] = {};
          });
          if (!Array.isArray(target.data.custom)) target.data.custom = [];
          target.updatedAt = Date.now();
          target.description = target.description ? target.description : '复制自 ' + src.name;
          await AS.storage.saveProfile(target);
          modal.remove();
          UI().toast(`已复制到「${target.name}」(${mode === 'overwrite' ? '整体覆盖' : '合并'})`, 'success');
          if (currentProfile.id === target.id) { dirty = true; await render(containerRef); }
        },
      }),
    ]));
    document.body.appendChild(modal);
    targetSel.focus();
  }

  // ---------- 复制视图: 只读展示 + 一键复制 ----------
  function profileToText(profile) {
    const d = profile.data || {};
    const lines = [];
    const push = (name, value) => {
      if (value === undefined || value === null || value === '') return;
      lines.push(`${name}: ${value}`);
    };
    AS.schema.CATEGORIES.forEach((cat) => {
      if (cat.id === 'openQuestions') return;
      if (cat.repeatable) {
        const list = d[cat.id] || [];
        if (!list.length) return;
        lines.push(`【${cat.name}】`);
        list.forEach((entry, i) => {
          lines.push(`[${i + 1}]`);
          cat.fields.forEach((f) => push('  ' + f.label, entry[f.key]));
        });
      } else if (cat.id === 'custom') {
        const list = d.custom || [];
        if (!list.length) return;
        lines.push(`【${cat.name}】`);
        list.forEach((c) => push('  ' + (c.label || c.key || '自定义'), c.value));
      } else {
        const obj = d[cat.id] || {};
        const vals = cat.fields.map((f) => obj[f.key]).filter((v) => v !== undefined && v !== null && v !== '');
        if (!vals.length) return;
        lines.push(`【${cat.name}】`);
        cat.fields.forEach((f) => push('  ' + f.label, obj[f.key]));
      }
    });
    if ((d.openQuestions || []).length) {
      lines.push('【开放题库】');
      d.openQuestions.forEach((q) => push('  ' + (q.question || '开放题'), q.answer));
    }
    return lines.join('\n');
  }

  function copyText(text) {
    return new Promise((resolve, reject) => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(resolve).catch(() => fallback());
      } else fallback();
      function fallback() {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
          resolve();
        } catch (e) { reject(e); }
      }
    });
  }

  function openCopyView() {
    if (!currentProfile) return;
    const modal = UI().el('div', { class: 'modal-mask' }, [UI().el('div', { class: 'modal modal-xl' }, [])]);
    const box = modal.querySelector('.modal');
    box.appendChild(UI().el('h2', { text: `复制视图 — ${currentProfile.name}` }));
    box.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:10px', text: '仅展示已填写内容。当某个表单无法自动填充时, 可在此复制后手动粘贴。加密字段仅在解锁后显示明文。' }));
    const ta = UI().el('textarea', { style: 'width:100%;min-height:360px;font-size:12.5px;line-height:1.8;border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc;font-family:Consolas,monospace' });
    ta.value = profileToText(currentProfile);
    box.appendChild(ta);
    const foot = UI().el('div', { class: 'modal-foot' }, [
      UI().el('button', { class: 'btn', text: '复制为 JSON', onclick: async () => {
        await copyText(JSON.stringify(currentProfile.data, null, 2));
        UI().toast('JSON 已复制', 'success');
      } }),
      UI().el('button', { class: 'btn primary', text: '📋 复制为纯文本', onclick: async () => {
        await copyText(ta.value);
        UI().toast('纯文本已复制', 'success');
      } }),
      UI().el('button', { class: 'btn', text: '关闭', onclick: () => modal.remove() }),
    ]);
    box.appendChild(foot);
    document.body.appendChild(modal);
  }

  async function doSave() {
    if (!currentProfile) return;
    currentProfile.updatedAt = Date.now();
    // 敏感字段加密处理: 加密已启用时必须先解锁
    if (await isEncryptionEnabled()) {
      const unlocked = (await chrome.runtime.sendMessage({ type: 'AF_IS_UNLOCKED' })) || {};
      if (!unlocked.unlocked) {
        const pwd = prompt('加密已启用, 请输入解锁口令以加密保存敏感字段:');
        if (!pwd) { UI().toast('已取消保存', 'error'); return false; }
        const r = await chrome.runtime.sendMessage({ type: 'AF_UNLOCK', password: pwd });
        if (!r || !r.ok) { UI().toast('口令错误, 保存取消', 'error'); return false; }
      }
      await encryptSensitiveFields();
    }
    await AS.storage.saveProfile(currentProfile);
    dirty = false;
    const btn = document.getElementById('profileSaveBtn');
    if (btn) btn.disabled = true;
    return true;
  }

  async function isEncryptionEnabled() {
    const s = await AS.storage.getSettings();
    return !!(s.encryption && s.encryption.enabled);
  }

  // 将明文敏感字段加密(仅当已解锁; 未解锁时保留原值)
  async function encryptSensitiveFields() {
    const unlocked = (await chrome.runtime.sendMessage({ type: 'AF_IS_UNLOCKED' })) || { unlocked: false };
    if (!unlocked.unlocked) return;
    const d = currentProfile.data;
    const encryptField = async (src, key) => {
      const v = src[key];
      if (v && !AS.encrypt.isEncrypted(v)) {
        try {
          const r = await chrome.runtime.sendMessage({ type: 'AF_ENCRYPT', value: String(v) });
          if (r && r.value) src[key] = r.value;
        } catch (e) { /* ignore */ }
      }
    };
    const applyCategory = async (catId) => {
      const cat = AS.schema.findCategory(catId);
      if (!cat) return;
      const sensitive = cat.fields.filter((f) => f.sensitive).map((f) => f.key);
      if (!sensitive.length) return;
      if (cat.repeatable) {
        (d[catId] || []).forEach((entry) => sensitive.forEach((k) => encryptField(entry, k)));
      } else {
        sensitive.forEach((k) => encryptField(d[catId], k));
      }
    };
    await applyCategory('basic');
    await applyCategory('intent');
  }

  async function loadProfile(id) {
    currentProfile = id ? await AS.storage.getProfile(id) : await AS.storage.getActiveProfile();
    if (!currentProfile) return null;
    if (!currentProfile.data || typeof currentProfile.data !== 'object') currentProfile.data = emptyData();
    if (!Array.isArray(currentProfile.data.custom)) currentProfile.data.custom = [];
    AS.schema.CATEGORIES.forEach((cat) => {
      if (cat.repeatable && !Array.isArray(currentProfile.data[cat.id])) currentProfile.data[cat.id] = [];
      if (!cat.repeatable && (!currentProfile.data[cat.id] || typeof currentProfile.data[cat.id] !== 'object')) currentProfile.data[cat.id] = {};
    });
    return currentProfile;
  }

  async function render(container, query) {
    containerRef = container;
    container.innerHTML = ''; // 防止重复调用叠加(新建/切换方案等场景)
    dirty = false;
    const profiles = await AS.storage.getProfiles();
    if (!currentProfile) {
      await loadProfile(null);
    }
    if (!currentProfile) {
      // 首次使用: 引导创建
      container.appendChild(UI().el('div', { class: 'empty' }, [
        UI().el('b', { text: '还没有信息方案' }),
        UI().el('span', { text: '创建一个方案开始录入你的网申信息' }),
      ]));
      container.appendChild(UI().el('div', { style: 'text-align:center' }, [
        UI().el('button', {
          class: 'btn primary', text: '＋ 创建第一个方案', onclick: async () => {
            const p = newProfile('默认方案');
            p.data = emptyData();
            await AS.storage.saveProfile(p);
            await AS.storage.saveSettings({ activeProfileId: p.id });
            currentProfile = p;
            await render(container);
          },
        }),
      ]));
      return;
    }
    const top = renderTop(container);
    container.appendChild(top);
    // 刷新方案下拉框当前值
    const sel = top.querySelector('select');
    if (sel) {
      sel.innerHTML = '';
      profiles.forEach((p) => sel.appendChild(UI().el('option', { value: p.id, text: p.name + (p.description ? ' — ' + p.description : '') })));
      sel.value = currentProfile.id;
    }
    // 卡片区独立容器(与工具条分离, 重渲染不破坏保存按钮)
    const formWrap = UI().el('div', { id: 'profileForm' });
    container.appendChild(formWrap);
    renderProfileForm(formWrap);
  }

  AS.views = AS.views || {};
  AS.views.profile = render;
})();
