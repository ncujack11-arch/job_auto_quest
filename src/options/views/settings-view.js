/**
 * settings-view.js — 设置视图
 * 填充策略 / 敏感数据加密 / 数据备份与恢复 / 调试
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  let settings = null;

  function sensitiveFieldsList(profile) {
    const list = [];
    if (!profile || !profile.data) return list;
    const d = profile.data;
    const push = (catId, key) => list.push({ catId, key });
    const apply = (catId) => {
      const cat = AS.schema.findCategory(catId);
      if (!cat) return;
      cat.fields.forEach((f) => {
        if (f.sensitive) {
          if (cat.repeatable) (d[catId] || []).forEach((_, i) => push(catId + '[' + i + ']', f.key));
          else push(catId, f.key);
        }
      });
    };
    apply('basic');
    apply('intent');
    return list;
  }

  async function getFieldValue(profile, catKey, fieldKey) {
    const m = catKey.match(/^(\w+)(?:\[(\d+)\])?$/);
    if (!m) return null;
    const [, catId, idx] = m;
    if (idx !== undefined) return profile.data[catId][+idx][fieldKey];
    return profile.data[catId][fieldKey];
  }
  async function setFieldValue(profile, catKey, fieldKey, value) {
    const m = catKey.match(/^(\w+)(?:\[(\d+)\])?$/);
    if (!m) return;
    const [, catId, idx] = m;
    if (idx !== undefined) profile.data[catId][+idx][fieldKey] = value;
    else profile.data[catId][fieldKey] = value;
  }

  // 加密/解密方案中所有敏感字段
  async function transformSensitiveFields(mode, password) {
    const profiles = await AS.storage.getProfiles();
    for (const profile of profiles) {
      const items = sensitiveFieldsList(profile);
      for (const item of items) {
        const v = await getFieldValue(profile, item.catId, item.key);
        if (v === undefined || v === null || v === '') continue;
        const isEnc = AS.encrypt.isEncrypted(v);
        if (mode === 'encrypt' && !isEnc) {
          const r = await chrome.runtime.sendMessage({ type: 'AF_ENCRYPT', value: String(v) });
          if (r && r.value) await setFieldValue(profile, item.catId, item.key, r.value);
        } else if (mode === 'decrypt' && isEnc) {
          const r = await chrome.runtime.sendMessage({ type: 'AF_DECRYPT', value: v });
          if (r && r.value !== undefined) await setFieldValue(profile, item.catId, item.key, r.value);
        }
      }
      profile.updatedAt = Date.now();
      await AS.storage.saveProfile(profile);
    }
    return profiles.length;
  }

  async function genSalt() {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function renderFillPolicy(card) {
    card.appendChild(UI().el('h3', { text: '填充策略' }));
    const form = UI().el('div', { class: 'form-grid' });
    const conflict = UI().el('div', { class: 'form-item' });
    conflict.appendChild(UI().el('label', { text: '页面已有内容时的处理' }));
    const sel = UI().el('select', {
      onchange: async (e) => {
        settings.conflictMode = e.target.value;
        await AS.storage.saveSettings(settings);
      },
    });
    sel.appendChild(UI().el('option', { value: 'skip', text: '跳过(保留页面已有内容)' }));
    sel.appendChild(UI().el('option', { value: 'overwrite', text: '强制覆盖已有内容' }));
    sel.value = settings.conflictMode;
    conflict.appendChild(sel);
    form.appendChild(conflict);

    const typingItem = UI().el('div', { class: 'form-item' });
    typingItem.appendChild(UI().el('label', { text: '人工模拟输入(逐字输入, 规避反爬)' }));
    const tWrap = UI().el('div', { style: 'display:flex;gap:8px;align-items:center' });
    const check = UI().el('input', {
      type: 'checkbox', checked: !!settings.typingMode,
      onchange: async (e) => {
        settings.typingMode = e.target.checked;
        await AS.storage.saveSettings(settings);
      },
    });
    tWrap.appendChild(check);
    tWrap.appendChild(UI().el('span', { style: 'font-size:12px;color:#6b7280', text: `间隔 ${settings.typingMin}~${settings.typingMax}ms` }));
    typingItem.appendChild(tWrap);
    form.appendChild(typingItem);
    card.appendChild(form);
  }

  function renderEncryption(card) {
    const enc = settings.encryption || { enabled: false };
    card.appendChild(UI().el('h3', { text: '敏感数据加密', children: [
      UI().el('span', { class: 'badge', text: enc.enabled ? '已启用' : '未启用' }),
    ] }));
    card.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:12px', text: '身份证号、期望薪资等敏感字段可选口令加密存储(AES-256-GCM)。口令不落盘, 密钥仅存于浏览器内存, 重启浏览器后需重新输入。' }));

    const form = UI().el('div', { class: 'form-grid', style: 'max-width:560px' });
    if (!enc.enabled) {
      const p1 = UI().el('div', { class: 'form-item' });
      p1.appendChild(UI().el('label', { text: '设置加密口令(≥6位)' }));
      p1.appendChild(UI().el('input', { type: 'password', id: 'encPwd1', placeholder: '请输入口令' }));
      const p2 = UI().el('div', { class: 'form-item' });
      p2.appendChild(UI().el('label', { text: '确认口令' }));
      p2.appendChild(UI().el('input', { type: 'password', id: 'encPwd2', placeholder: '再次输入' }));
      form.appendChild(p1);
      form.appendChild(p2);
      card.appendChild(form);
      card.appendChild(UI().el('div', { class: 'toolbar' }, [
        UI().el('button', {
          class: 'btn primary', text: '启用加密并加密现有数据', onclick: async () => {
            const p1 = document.getElementById('encPwd1').value;
            const p2 = document.getElementById('encPwd2').value;
            if (p1.length < 6) return UI().toast('口令至少 6 位', 'error');
            if (p1 !== p2) return UI().toast('两次输入不一致', 'error');
            const salt = await genSalt();
            const hash = await AS.encrypt.sha256Hex(p1);
            settings.encryption = { enabled: true, salt, iterations: 100000, passwordHash: hash, hint: '' };
            await AS.storage.saveSettings(settings);
            const r = await chrome.runtime.sendMessage({ type: 'AF_UNLOCK', password: p1 });
            if (r && r.ok) {
              await transformSensitiveFields('encrypt');
              UI().toast('加密已启用, 敏感字段已加密', 'success');
              render(containerRef);
            } else {
              UI().toast('启用失败', 'error');
            }
          },
        }),
      ]));
    } else {
      card.appendChild(UI().el('div', { class: 'form-item', style: 'max-width:360px' }, [
        UI().el('label', { text: '输入当前口令以更改 / 关闭加密' }),
        UI().el('input', { type: 'password', id: 'encCur', placeholder: '当前口令' }),
      ]));
      const actions = UI().el('div', { class: 'toolbar' });
      actions.appendChild(UI().el('button', {
        class: 'btn', text: '更改口令', onclick: async () => {
          const cur = document.getElementById('encCur').value;
          const np1 = prompt('新口令(≥6位):');
          if (!np1 || np1.length < 6) return;
          const np2 = prompt('确认新口令:');
          if (np1 !== np2) return UI().toast('两次输入不一致', 'error');
          const r = await chrome.runtime.sendMessage({ type: 'AF_UNLOCK', password: cur });
          if (!r || !r.ok) return UI().toast('当前口令错误', 'error');
          // 用新口令重新加密
          const salt = await genSalt();
          const hash = await AS.encrypt.sha256Hex(np1);
          await transformSensitiveFields('decrypt');
          settings.encryption = { enabled: true, salt, iterations: 100000, passwordHash: hash, hint: '' };
          await AS.storage.saveSettings(settings);
          await chrome.runtime.sendMessage({ type: 'AF_UNLOCK', password: np1 });
          await transformSensitiveFields('encrypt');
          UI().toast('口令已更改', 'success');
        },
      }));
      actions.appendChild(UI().el('button', {
        class: 'btn danger', text: '关闭加密(解密所有敏感字段)', onclick: async () => {
          if (!confirm('关闭后将所有敏感字段转为明文存储, 继续?')) return;
          const cur = document.getElementById('encCur').value;
          const r = await chrome.runtime.sendMessage({ type: 'AF_UNLOCK', password: cur });
          if (!r || !r.ok) return UI().toast('口令错误', 'error');
          await transformSensitiveFields('decrypt');
          settings.encryption.enabled = false;
          await AS.storage.saveSettings(settings);
          UI().toast('加密已关闭, 敏感字段已解密', 'success');
          render(containerRef);
        },
      }));
      actions.appendChild(UI().el('button', {
        class: 'btn', text: '立即锁定(清除会话密钥)', onclick: async () => {
          await chrome.runtime.sendMessage({ type: 'AF_LOCK' });
          UI().toast('已锁定', 'success');
        },
      }));
      card.appendChild(actions);
    }
  }

  function renderStatusFlow(card) {
    card.appendChild(UI().el('h3', { text: '进度状态流', children: [UI().el('span', { class: 'badge', text: '台账进度可选状态' })] }));
    card.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:12px', text: '预设标准状态流: 待笔试 → 笔试中 → 一面 → 二面 → 终面 → HR面 → OC → Offer → 已回绝 → 流程终止, 可自定义增删。' }));
    const wrap = UI().el('div', { id: 'statusFlowList' });
    const renderList = async () => {
      const flow = await AS.storage.getStatusFlow();
      wrap.innerHTML = '';
      flow.forEach((s, i) => {
        const row = UI().el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' });
        row.appendChild(UI().el('span', { style: 'color:#9ca3af;font-size:12px', text: `${i + 1}.` }));
        const input = UI().el('input', {
          type: 'text', value: s, style: 'flex:1;max-width:260px;padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px',
          onchange: async (e) => {
            if (!e.target.value.trim()) return;
            const f = await AS.storage.getStatusFlow();
            f[i] = e.target.value.trim();
            await AS.storage.saveStatusFlow(f);
          },
        });
        row.appendChild(input);
        row.appendChild(UI().el('button', {
          class: 'btn sm danger', text: '删除', onclick: async () => {
            if (flow.length <= 1) return UI().toast('至少保留一个状态', 'error');
            const f = await AS.storage.getStatusFlow();
            f.splice(i, 1);
            await AS.storage.saveStatusFlow(f);
            renderList();
          },
        }));
        wrap.appendChild(row);
      });
      const addRow = UI().el('div', { style: 'margin-top:8px' });
      addRow.appendChild(UI().el('button', {
        class: 'btn sm', text: '＋ 新增状态', onclick: async () => {
          const name = prompt('新状态名称(如: 已offer沟通):');
          if (!name) return;
          const f = await AS.storage.getStatusFlow();
          f.push(name);
          await AS.storage.saveStatusFlow(f);
          renderList();
        },
      }));
      addRow.appendChild(UI().el('button', {
        class: 'btn sm', style: 'margin-left:8px', text: '恢复默认', onclick: async () => {
          await AS.storage.saveStatusFlow(AS.storage.DEFAULT_STATUS_FLOW.slice());
          renderList();
          UI().toast('已恢复默认状态流', 'success');
        },
      }));
      wrap.appendChild(addRow);
    };
    renderList();
    card.appendChild(wrap);
  }

  function renderBackup(card) {
    card.appendChild(UI().el('h3', { text: '数据备份与恢复' }));
    card.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:12px', text: '导出全量数据(信息库/台账/规则/设置)为 JSON 备份文件, 可换设备、换浏览器恢复。' }));
    const toolbar = UI().el('div', { class: 'toolbar' });
    toolbar.appendChild(UI().el('button', {
      class: 'btn primary', text: '📤 导出全量备份', onclick: async () => {
        const data = await AS.storage.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `秋招数据备份_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        UI().toast('备份已导出', 'success');
      },
    }));
    const fileInput = UI().el('input', { type: 'file', accept: '.json', style: 'display:none' });
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || !data.data) throw new Error('文件格式无效');
        if (!confirm('导入备份将覆盖当前全部数据, 确认继续?')) return;
        await AS.storage.importAll(data, { overwrite: true });
        await chrome.runtime.sendMessage({ type: 'AF_SYNC_REMINDERS' });
        UI().toast('备份导入成功', 'success');
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        UI().toast('导入失败: ' + err.message, 'error');
      }
    });
    toolbar.appendChild(UI().el('button', { class: 'btn', text: '📥 从备份恢复', onclick: () => fileInput.click() }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn danger', text: '🗑 清空所有数据', onclick: async () => {
        if (!confirm('确定清空所有数据? 此操作不可恢复!')) return;
        if (!confirm('再次确认: 所有信息库、投递台账、规则将被永久删除。')) return;
        await AS.storage.clearAll();
        await chrome.runtime.sendMessage({ type: 'AF_SYNC_REMINDERS' });
        UI().toast('已清空, 页面即将刷新', 'success');
        setTimeout(() => location.reload(), 800);
      },
    }));
    card.appendChild(toolbar);
  }

  function renderDebug(card) {
    card.appendChild(UI().el('h3', { text: '调试' }));
    const form = UI().el('div', { class: 'form-grid', style: 'max-width:400px' });
    const item = UI().el('div', { class: 'form-item' });
    item.appendChild(UI().el('label', { text: '日志级别(控制台过滤)' }));
    const sel = UI().el('select', {
      onchange: async (e) => {
        settings.logLevel = e.target.value;
        await AS.storage.saveSettings(settings);
        AS.logger.setLevel(e.target.value);
      },
    });
    ['debug', 'info', 'warn', 'error'].forEach((l) => sel.appendChild(UI().el('option', { value: l, text: l })));
    sel.value = settings.logLevel;
    item.appendChild(sel);
    form.appendChild(item);
    card.appendChild(form);
  }

  function renderAbout(card) {
    const m = chrome.runtime.getManifest();
    card.appendChild(UI().el('h3', { text: '关于' }));
    const lines = [
      `版本: v${m.version}`,
      '隐私: 纯本地运行, 无任何对外网络请求, 数据仅存储在浏览器本地(chrome.storage.local)',
      '权限: storage / activeTab / scripting / contextMenus / notifications / alarms(仅用于本地提醒)',
      '快捷键: Alt+Shift+F 一键填充 · Alt+Shift+O 打开配置页(可在 chrome://extensions/shortcuts 自定义)',
    ];
    const p = UI().el('p', { class: 'view-sub', style: 'line-height:1.9;margin:0' });
    lines.forEach((l) => p.appendChild(UI().el('div', { text: '· ' + l })));
    card.appendChild(p);
  }

  let containerRef = null;
  async function render(container) {
    containerRef = container;
    container.innerHTML = '';
    settings = await AS.storage.getSettings();

    const c1 = UI().el('div', { class: 'card' });
    renderFillPolicy(c1);
    const cFlow = UI().el('div', { class: 'card' });
    renderStatusFlow(cFlow);
    const c2 = UI().el('div', { class: 'card' });
    renderEncryption(c2);
    const c3 = UI().el('div', { class: 'card' });
    renderBackup(c3);
    const c4 = UI().el('div', { class: 'card' });
    renderDebug(c4);
    const c5 = UI().el('div', { class: 'card' });
    renderAbout(c5);

    container.appendChild(c1);
    container.appendChild(c2);
    container.appendChild(c3);
    container.appendChild(c4);
    container.appendChild(c5);
  }

  AS.views = AS.views || {};
  AS.views.settings = render;
})();
