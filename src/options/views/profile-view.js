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

  function renderProfileForm(container) {
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
            renderProfileForm(container);
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
            renderProfileForm(container);
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
        renderProfileForm(container);
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
          type: 'text', id: `f_${f.key}`, value: encrypted ? '' : value,
          placeholder: encrypted ? '🔒 已加密, 解锁后可见' : '',
          disabled: encrypted ? true : undefined,
          oninput: (e) => { data[f.key] = e.target.value; markDirty(); },
        });
        item.appendChild(labelEl);
        item.appendChild(input);
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
        renderProfileForm(containerRef);
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
      class: 'btn', text: '＋ 新建方案', onclick: () => {
        const name = prompt('方案名称(如: 算法岗 / 腾讯定制版):', '新方案');
        if (!name) return;
        const p = newProfile(name);
        p.data = emptyData();
        AS.storage.saveProfile(p).then(async () => {
          await AS.storage.saveSettings({ activeProfileId: p.id });
          currentProfile = p;
          dirty = false;
          await render(containerRef);
        });
      },
    }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '✏ 重命名', onclick: () => {
        const name = prompt('新的方案名称:', currentProfile.name);
        if (name) { currentProfile.name = name; markDirty(); render(containerRef); }
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
    return toolbar;
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
    renderProfileForm(container);
  }

  AS.views = AS.views || {};
  AS.views.profile = render;
})();
