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

    const previewItem = UI().el('div', { class: 'form-item' });
    previewItem.appendChild(UI().el('label', { text: '填充前预览确认' }));
    const pWrap = UI().el('div', { style: 'display:flex;gap:8px;align-items:center' });
    const pCheck = UI().el('input', {
      type: 'checkbox', checked: settings.previewMode !== false,
      onchange: async (e) => {
        settings.previewMode = e.target.checked;
        await AS.storage.saveSettings(settings);
      },
    });
    pWrap.appendChild(pCheck);
    pWrap.appendChild(UI().el('span', { style: 'font-size:12px;color:#6b7280', text: '填充前展示每个字段将填入的值, 可勾选跳过, 填充后可一键撤销' }));
    previewItem.appendChild(pWrap);
    form.appendChild(previewItem);

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

  // ---------- 域名黑白名单 ----------
  function renderSiteFilter(card) {
    const filter = settings.siteFilter || { mode: 'all', blacklist: [], whitelist: [] };
    settings.siteFilter = filter;
    card.appendChild(UI().el('h3', { text: '域名黑白名单', children: [UI().el('span', { class: 'badge', text: '隐私保护' })] }));
    card.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:12px', text: '银行、支付、政务等敏感网站建议加入黑名单, 插件将拒绝在其页面上运行, 防止误操作。' }));

    const modeSel = UI().el('select', {
      style: 'padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;max-width:320px',
      onchange: async (e) => {
        filter.mode = e.target.value;
        await AS.storage.saveSettings(settings);
      },
    });
    modeSel.appendChild(UI().el('option', { value: 'all', text: '全部网站运行(默认)' }));
    modeSel.appendChild(UI().el('option', { value: 'blacklist', text: '黑名单模式: 仅黑名单网站禁用' }));
    modeSel.appendChild(UI().el('option', { value: 'whitelist', text: '白名单模式: 仅白名单招聘网站启用' }));
    modeSel.value = filter.mode;
    card.appendChild(UI().el('div', { class: 'form-item', style: 'max-width:360px' }, [UI().el('label', { text: '运行模式' }), modeSel]));

    const renderList = (listKey, title, ph) => {
      const wrap = UI().el('div', { style: 'margin-top:14px' });
      wrap.appendChild(UI().el('b', { style: 'font-size:13px', text: title }));
      const listEl = UI().el('div', { style: 'margin-top:6px' });
      const renderItems = () => {
        listEl.innerHTML = '';
        (filter[listKey] || []).forEach((d, i) => {
          const row = UI().el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px;max-width:420px' });
          row.appendChild(UI().el('span', { style: 'flex:1;font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:5px 10px', text: d }));
          row.appendChild(UI().el('button', {
            class: 'btn sm danger', text: '移除', onclick: async () => {
              filter[listKey] = filter[listKey].filter((x) => x !== d);
              await AS.storage.saveSettings(settings);
              renderItems();
            },
          }));
          listEl.appendChild(row);
        });
      };
      renderItems();
      const input = UI().el('input', {
        type: 'text', placeholder: ph, style: 'max-width:300px;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px',
        onkeydown: async (e) => {
          if (e.key === 'Enter' && e.target.value.trim()) {
            filter[listKey] = filter[listKey] || [];
            const v = e.target.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            if (!filter[listKey].includes(v)) filter[listKey].push(v);
            await AS.storage.saveSettings(settings);
            e.target.value = '';
            renderItems();
          }
        },
      });
      wrap.appendChild(listEl);
      wrap.appendChild(input);
      return wrap;
    };
    card.appendChild(renderList('blacklist', '黑名单(输入域名后回车)', '如: icbc.com.cn (支持子域名自动匹配)'));
    card.appendChild(renderList('whitelist', '白名单', '如: zhaopin.com'));
  }

  // ---------- 选择器记忆管理 ----------
  function renderMemories(card) {
    card.appendChild(UI().el('h3', { text: '选择器记忆', children: [UI().el('span', { class: 'badge', text: '同站二次填充更准' })] }));
    card.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:12px', text: '填充成功后自动记录该网站每个字段对应的元素选择器, 下次优先精准填充。' }));
    const info = UI().el('div', { style: 'font-size:13px;color:#374151;margin-bottom:10px' });
    const renderInfo = async () => {
      const map = await AS.storage.getSiteMemories();
      const hosts = Object.keys(map).filter((h) => map[h] && Object.keys(map[h]).length);
      info.innerHTML = '';
      info.appendChild(document.createTextNode(`已记忆 ${hosts.length} 个域名`));
      hosts.slice(0, 8).forEach((h) => info.appendChild(UI().el('div', { style: 'font-size:12px;color:#6b7280;margin-top:2px', text: `· ${h} (${Object.keys(map[h]).length} 条)` })));
      if (hosts.length > 8) info.appendChild(UI().el('div', { style: 'font-size:12px;color:#9ca3af', text: `· 等 ${hosts.length - 8} 个更多` }));
    };
    renderInfo();
    card.appendChild(info);
    card.appendChild(UI().el('div', { class: 'toolbar' }, [
      UI().el('button', {
        class: 'btn danger', text: '清空全部记忆', onclick: async () => {
          if (!confirm('清空所有站点的选择器记忆?')) return;
          await AS.storage.saveSiteMemories({});
          renderInfo();
          UI().toast('已清空', 'success');
        },
      }),
    ]));
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

  // ---------- 自动下一步 / 证件照 / 内推码 ----------
  function renderAdvanced(card) {
    card.appendChild(UI().el('h3', { text: '进阶功能' }));

    // 自动下一步
    const autoItem = UI().el('div', { class: 'form-item', style: 'max-width:520px' });
    autoItem.appendChild(UI().el('label', { text: '多页表单自动下一步(SPA/分步网申)' }));
    const aWrap = UI().el('div', { style: 'display:flex;gap:8px;align-items:center' });
    const aCheck = UI().el('input', {
      type: 'checkbox', checked: !!settings.autoNext,
      onchange: async (e) => {
        settings.autoNext = e.target.checked;
        await AS.storage.saveSettings(settings);
      },
    });
    aWrap.appendChild(aCheck);
    aWrap.appendChild(UI().el('span', { style: 'font-size:12px;color:#6b7280', text: '填充后自动点击「下一步」并续填下一页, 到达提交页或页面无变化时停止(插件绝不会点击提交/完成按钮)' }));
    autoItem.appendChild(aWrap);
    card.appendChild(autoItem);

    // 证件照
    const photoItem = UI().el('div', { class: 'form-item', style: 'max-width:520px;margin-top:14px' });
    photoItem.appendChild(UI().el('label', { text: '证件照(本地存储, 用于网申上传照片控件自动上传)' }));
    const pWrap = UI().el('div', { style: 'display:flex;gap:10px;align-items:center' });
    const preview = UI().el('img', { style: 'width:56px;height:56px;border-radius:8px;border:1px solid #e2e8f0;object-fit:cover' });
    const photoInput = UI().el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
    const statusTxt = UI().el('span', { style: 'font-size:12px;color:#6b7280' });
    const updatePhoto = () => {
      if (settings.photoDataUrl) {
        preview.src = settings.photoDataUrl;
        statusTxt.textContent = '已配置 ✓';
      } else {
        preview.removeAttribute('src');
        statusTxt.textContent = '未配置';
      }
    };
    updatePhoto();
    photoInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const dataUrl = await compressImage(f, 420, 0.82);
        settings.photoDataUrl = dataUrl;
        await AS.storage.saveSettings(settings);
        updatePhoto();
        UI().toast('证件照已保存(仅存本地)', 'success');
      } catch (err) {
        UI().toast('图片处理失败: ' + err.message, 'error');
      }
    });
    pWrap.appendChild(preview);
    pWrap.appendChild(UI().el('button', { class: 'btn sm', text: settings.photoDataUrl ? '更换照片' : '上传照片', onclick: () => photoInput.click() }));
    pWrap.appendChild(statusTxt);
    if (settings.photoDataUrl) {
      pWrap.appendChild(UI().el('button', { class: 'btn sm danger', text: '移除', onclick: async () => {
        settings.photoDataUrl = '';
        await AS.storage.saveSettings(settings);
        updatePhoto();
      } }));
    }
    photoItem.appendChild(pWrap);
    photoItem.appendChild(photoInput);
    card.appendChild(photoItem);

    // 自动锁定
    const lockItem = UI().el('div', { class: 'form-item', style: 'max-width:520px;margin-top:14px' });
    lockItem.appendChild(UI().el('label', { text: '闲置自动锁定(5 分钟无操作自动清除会话密钥, 保护敏感字段)' }));
    const lWrap = UI().el('div', { style: 'display:flex;gap:8px;align-items:center' });
    const lCheck = UI().el('input', {
      type: 'checkbox', checked: settings.autoLock !== false,
      onchange: async (e) => {
        settings.autoLock = e.target.checked;
        await AS.storage.saveSettings(settings);
      },
    });
    lWrap.appendChild(lCheck);
    lWrap.appendChild(UI().el('span', { style: 'font-size:12px;color:#6b7280', text: '开启后离开电脑自动锁定, 填充敏感字段前需重新输入口令' }));
    lockItem.appendChild(lWrap);
    card.appendChild(lockItem);

    // 简历文件(存 IndexedDB, 供网申"上传简历"控件自动上传)
    const resumeItem = UI().el('div', { class: 'form-item', style: 'max-width:520px;margin-top:14px' });
    resumeItem.appendChild(UI().el('label', { text: '简历文件(PDF, 本地 IndexedDB 存储, 网申上传简历控件自动填充)' }));
    const rWrap = UI().el('div', { style: 'display:flex;gap:10px;align-items:center' });
    const rStatus = UI().el('span', { style: 'font-size:12px;color:#6b7280' });
    const resumeInput = UI().el('input', { type: 'file', accept: '.pdf,.docx', style: 'display:none' });
    const refreshResume = async () => {
      const f = await AS.idb.get('resumeFile');
      rStatus.textContent = f ? `已配置: ${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)` : '未配置';
    };
    refreshResume();
    resumeInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        await AS.idb.put('resumeFile', f);
        refreshResume();
        UI().toast('简历文件已保存(仅存本地)', 'success');
      } catch (err) {
        UI().toast('保存失败: ' + err.message, 'error');
      }
    });
    rWrap.appendChild(UI().el('button', { class: 'btn sm', text: '选择简历文件', onclick: () => resumeInput.click() }));
    rWrap.appendChild(rStatus);
    rWrap.appendChild(UI().el('button', {
      class: 'btn sm danger', text: '移除', onclick: async () => {
        await AS.idb.remove('resumeFile');
        refreshResume();
      },
    }));
    resumeItem.appendChild(rWrap);
    resumeItem.appendChild(resumeInput);
    card.appendChild(resumeItem);

    // 内推码库
    const refItem = UI().el('div', { class: 'form-item', style: 'max-width:520px;margin-top:14px' });
    refItem.appendChild(UI().el('label', { text: '内推码库(自动填入"内推码"字段, 按站点域名匹配)' }));
    const refWrap = UI().el('div', { style: 'margin-top:6px' });
    const renderRefs = () => {
      refWrap.innerHTML = '';
      (settings.refCodes || []).forEach((r, i) => {
        const row = UI().el('div', { style: 'display:flex;gap:8px;margin-bottom:6px;align-items:center' });
        row.appendChild(UI().el('span', { style: 'font-size:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:4px 10px', text: `${r.host} → ${r.code}` }));
        row.appendChild(UI().el('button', {
          class: 'btn sm danger', text: '删', onclick: async () => {
            settings.refCodes.splice(i, 1);
            await AS.storage.saveSettings(settings);
            renderRefs();
          },
        }));
        refWrap.appendChild(row);
      });
      const addRow = UI().el('div', { style: 'display:flex;gap:8px' });
      const hostI = UI().el('input', { type: 'text', placeholder: '站点域名(如 company.com)', style: 'flex:1;padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px' });
      const codeI = UI().el('input', { type: 'text', placeholder: '内推码', style: 'width:140px;padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px' });
      const addB = UI().el('button', {
        class: 'btn sm', text: '添加', onclick: async () => {
          if (!hostI.value.trim() || !codeI.value.trim()) return UI().toast('请填写域名与内推码', 'error');
          settings.refCodes = settings.refCodes || [];
          settings.refCodes.push({ host: hostI.value.trim(), code: codeI.value.trim() });
          await AS.storage.saveSettings(settings);
          renderRefs();
        },
      });
      addRow.appendChild(hostI);
      addRow.appendChild(codeI);
      addRow.appendChild(addB);
      refWrap.appendChild(addRow);
    };
    renderRefs();
    refItem.appendChild(refWrap);
    card.appendChild(refItem);
  }

  // 图片压缩为 dataURL
  function compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('图片无法读取'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  // ---------- 网申避坑提示库 ----------
  function renderSiteTips(card) {
    card.appendChild(UI().el('h3', { text: '网申避坑提示', children: [UI().el('span', { class: 'badge', text: '进入对应网站自动提示' })] }));
    card.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:12px', text: '如「北森系统切换页面会清空已填内容」「牛客笔试勿切屏」等, 进入网站时悬浮提示一次。' }));
    const listEl = UI().el('div', { style: 'margin-bottom:8px' });
    const renderItems = async () => {
      const map = await AS.storage.getSiteTips();
      listEl.innerHTML = '';
      Object.entries(map).forEach(([host, tips]) => {
        tips.forEach((tip, i) => {
          const row = UI().el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px;max-width:640px;font-size:12.5px' });
          row.appendChild(UI().el('span', { style: 'flex:0 0 120px;color:#2563eb', text: host }));
          row.appendChild(UI().el('span', { style: 'flex:1;color:#374151', text: tip }));
          row.appendChild(UI().el('button', {
            class: 'btn sm danger', text: '删', onclick: async () => {
              const m = await AS.storage.getSiteTips();
              m[host] = (m[host] || []).filter((x) => x !== tip);
              if (!m[host].length) delete m[host];
              await AS.storage.saveSiteTips(m);
              renderItems();
            },
          }));
          listEl.appendChild(row);
        });
      });
    };
    renderItems();
    card.appendChild(listEl);
    const addRow = UI().el('div', { style: 'display:flex;gap:8px;max-width:640px' });
    const hostI = UI().el('input', { type: 'text', placeholder: '域名(如 campus.meituan.com)', style: 'flex:1;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px' });
    const tipI = UI().el('input', { type: 'text', placeholder: '提示内容(进入该网站时显示)', style: 'flex:2;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px' });
    const addB = UI().el('button', {
      class: 'btn sm', text: '添加', onclick: async () => {
        const h = hostI.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const t = tipI.value.trim();
        if (!h || !t) return UI().toast('请填写域名与提示内容', 'error');
        const m = await AS.storage.getSiteTips();
        m[h] = m[h] || [];
        m[h].push(t);
        await AS.storage.saveSiteTips(m);
        hostI.value = ''; tipI.value = '';
        renderItems();
      },
    });
    addRow.appendChild(hostI);
    addRow.appendChild(tipI);
    addRow.appendChild(addB);
    card.appendChild(addRow);
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

    // ---------- 更新自动备份快照 ----------
    const auto = UI().el('div', { style: 'margin-top:16px;border-top:1px solid #f1f5f9;padding-top:14px' });
    auto.appendChild(UI().el('h4', { style: 'font-size:13.5px;margin-bottom:4px', text: '🛡 更新自动备份(扩展每次更新时自动留存全量快照)' }));
    auto.appendChild(UI().el('p', { class: 'view-sub', text: '正常「重新加载扩展」不会删除本地数据; 此快照用于极端情况下的恢复兜底。保留最近 5 份。' }));
    const snapList = UI().el('div', { style: 'margin-top:8px' });
    const renderSnaps = async () => {
      snapList.innerHTML = '';
      const r = await chrome.storage.local.get('af_auto_backups');
      const backups = (r && r.af_auto_backups) || [];
      if (!backups.length) {
        snapList.appendChild(UI().el('div', { style: 'font-size:12px;color:#9ca3af', text: '暂无自动备份(扩展更新时自动生成)' }));
        return;
      }
      backups.slice().reverse().forEach((b) => {
        const row = UI().el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:6px;font-size:12.5px;max-width:560px' });
        const label = `${new Date(b.at).toLocaleString('zh-CN')} · v${b.fromVersion} → v${b.toVersion}`;
        row.appendChild(UI().el('span', { style: 'flex:1;color:#374151', text: label }));
        row.appendChild(UI().el('button', {
          class: 'btn sm', text: '恢复此快照', onclick: async () => {
            if (!confirm('用该快照覆盖当前全部数据? 当前数据将丢失, 请确认。')) return;
            await AS.storage.importAll(b.data, { overwrite: true });
            await chrome.runtime.sendMessage({ type: 'AF_SYNC_REMINDERS' });
            UI().toast('已恢复快照', 'success');
            setTimeout(() => location.reload(), 800);
          },
        }));
        snapList.appendChild(row);
      });
    };
    renderSnaps();
    auto.appendChild(snapList);
    card.appendChild(auto);
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
    const toolbar = UI().el('div', { class: 'toolbar' });
    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '📤 导出本地日志(warn/error)', onclick: async () => {
        const logs = await AS.storage.getLogs();
        const text = logs.map((l) => `${new Date(l.t).toISOString()} [${l.lv}] ${l.tag}: ${l.msg}`).join('\n');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `插件日志_${new Date().toISOString().slice(0, 10)}.log`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        UI().toast(`已导出 ${logs.length} 条日志`, 'success');
      },
    }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn danger', text: '清空日志', onclick: async () => {
        await AS.storage.clearLogs();
        UI().toast('日志已清空', 'success');
      },
    }));
    card.appendChild(toolbar);
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
    const cFilter = UI().el('div', { class: 'card' });
    renderSiteFilter(cFilter);
    const cMem = UI().el('div', { class: 'card' });
    renderMemories(cMem);
    const cFlow = UI().el('div', { class: 'card' });
    renderStatusFlow(cFlow);
    const cAdv = UI().el('div', { class: 'card' });
    renderAdvanced(cAdv);
    const cTips = UI().el('div', { class: 'card' });
    renderSiteTips(cTips);
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
