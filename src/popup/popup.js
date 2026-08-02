/**
 * popup.js — 弹窗逻辑
 */
(function () {
  'use strict';
  const AS = window.AS;
  const $ = (id) => document.getElementById(id);

  let currentTab = null;

  async function init() {
    await loadProfiles();
    await loadSite();
    // 确保注入后扫描字段数(popup 打开即获得 activeTab 授权)
    if (currentTab) {
      const ok = await ensureContentScript();
      if (ok) await scanCount();
    }
    bindEvents();
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function loadProfiles() {
    const profiles = await AS.storage.getProfiles();
    const active = await AS.storage.getActiveProfile();
    const sel = $('profileSelect');
    sel.innerHTML = '';
    if (!profiles.length) {
      const opt = document.createElement('option');
      opt.textContent = '暂无方案, 请先在配置页创建';
      opt.value = '';
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }
    profiles.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = active ? active.id : profiles[0].id;
  }

  async function loadSite() {
    const tab = await getActiveTab();
    if (!tab || !/^https?:\/\//.test(tab.url || '')) {
      $('site').textContent = '当前页面: 非网页(填充不可用)';
      $('fillBtn').disabled = true;
      return;
    }
    currentTab = tab;
    try {
      const host = new URL(tab.url).hostname;
      const rule = await AS.storage.getSiteRuleForHost(host);
      $('site').textContent = `当前页面: ${host}${rule ? ' (适配: ' + rule.siteName + ')' : ''}`;
    } catch (e) {
      $('site').textContent = '当前页面: ' + (tab.url || '');
    }
    await loadGrabCard();
  }

  // 上次填充的页面投递信息 → 一键保存
  async function loadGrabCard() {
    try {
      const r = await chrome.storage.local.get('af_last_grab');
      const g = r.af_last_grab;
      if (!g || !g.grabbedAt || Date.now() - g.grabbedAt > 24 * 3600 * 1000) return;
      const el = $('grabCard');
      el.classList.remove('hidden');
      $('grabInfo').innerHTML = '';
      const parts = [];
      if (g.company) parts.push(`<b>${g.company}</b>`);
      if (g.position) parts.push(g.position);
      if (g.city) parts.push(g.city);
      if (g.salary) parts.push(g.salary);
      $('grabInfo').innerHTML = '上次填充页面: ' + (parts.join(' · ') || '未知岗位');
    } catch (e) { /* ignore */ }
  }

  async function scanCount() {
    if (!currentTab) return;
    try {
      const r = await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_SCAN_COUNT' });
      if (r && r.total !== undefined) {
        $('fieldCount').textContent = r.total;
        $('scanInfo').classList.remove('hidden');
      }
    } catch (e) { /* 内容脚本未注入 */ }
  }

  // 本地确保内容脚本已注入(popup 打开时 activeTab 已授权, 不依赖后台消息通道)
  // 版本不一致(旧脚本残留)时强制重新注入
  async function ensureContentScript() {
    try {
      const r = await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_PING' });
      if (r && r.pong && r.v === chrome.runtime.getManifest().version) return true;
    } catch (e) { /* 未注入 */ }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTab.id, allFrames: true },
        files: AS.storage.CORE_CONTENT_SCRIPTS,
      });
      return true;
    } catch (e2) {
      return false;
    }
  }

  // 状态显示(多行诊断)
  function setStatus(cls, lines) {
    const el = $('fillStatus');
    el.className = 'fill-status ' + cls;
    el.innerHTML = '';
    (Array.isArray(lines) ? lines : [lines]).forEach((l) => {
      const d = document.createElement('div');
      d.textContent = l;
      el.appendChild(d);
    });
    el.classList.remove('hidden');
  }

  async function pingTab() {
    try {
      const r = await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_PING' });
      return { ok: !!(r && r.pong), v: r ? (r.v || '?') : '' };
    } catch (e) {
      return { ok: false, v: '' };
    }
  }

  async function fill() {
    if (!currentTab) return;
    $('fillBtn').disabled = true;
    $('fillBtn').textContent = '填充中...';
    try {
      const active = await AS.storage.getActiveProfile();
      if (!active) {
        setStatus('error', ['信息库为空, 请先在配置页录入个人信息']);
        return;
      }
      const mine = chrome.runtime.getManifest().version;
      const p1 = await pingTab();
      setStatus('', [`扩展版本: v${mine}`, `页面脚本: ${p1.ok ? '已注入 v' + p1.v : '未注入'}`]);
      // 确保内容脚本已注入(版本不一致自动重注入)
      const ok = await ensureContentScript();
      if (!ok) {
        setStatus('error', ['无法注入脚本, 请刷新当前页面后重试']);
        return;
      }
      const p2 = await pingTab();
      let fields = -1;
      try {
        const sc = await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_SCAN_COUNT' });
        fields = sc ? sc.total : -1;
      } catch (e) { /* ignore */ }
      setStatus('ok', [
        `注入完成: v${p2.v}${p2.v === mine ? ' (最新)' : ' (警告: 版本不符)'}`,
        `扫描到字段: ${fields}`,
        '正在发送填充命令, 请查看页面右下角...',
      ]);
      // 分段填充: 收集勾选模块
      const all = $('allSections').checked;
      const sections = all ? [] : Array.from(document.querySelectorAll('#sectionsGrid input:checked')).map((c) => c.value);
      await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_FILL', sections });
      // 轮询填充状态(直接查询内容脚本, 绕开后台上报链路)
      const t0poll = Date.now();
      let lastStage = '';
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const st = await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_GET_FILL_STATE' });
          if (st && st.state) {
            const s = st.state;
            const line = `填充状态 [${s.v}]: ${s.stage}${s.detail ? ' — ' + s.detail : ''}`;
            // 预览等待: 显示一键确认按钮
            const confirmBtn = $('previewConfirmBtn');
            if (s.stage === 'waiting-preview') {
              confirmBtn.classList.remove('hidden');
              confirmBtn.textContent = '✔ 立即确认填充(' + ((st.scanned > 0 ? st.scanned : '?') + ' 个字段)');
            } else {
              confirmBtn.classList.add('hidden');
            }
            if (s.stage !== lastStage) {
              lastStage = s.stage;
              setStatus(s.stage === 'error' || s.stage === 'cancelled' ? 'error' : 'ok', [
                `注入完成: v${p2.v}`,
                `扫描到字段: ${fields}`,
                line,
              ]);
            }
            if (s.stage === 'done' || s.stage === 'error' || s.stage === 'cancelled') {
              if (s.stage !== 'done') {
                setStatus('error', [`填充结束: ${s.stage}`, s.detail || '']);
              }
              break;
            }
          } else {
            setStatus('', [`注入完成: v${p2.v}`, `扫描到字段: ${fields}`, '等待内容脚本响应填充状态...']);
          }
        } catch (e) {
          setStatus('error', ['状态查询失败: ' + (e.message || e), '请刷新页面后重试']);
          break;
        }
        if (Date.now() - t0poll > 25000) {
          setStatus('', [`注入完成: v${p2.v}`, `扫描到字段: ${fields}`, '填充执行中(>25秒), 请查看页面右下角面板']);
          break;
        }
      }
      if (!lastStage) {
        setStatus('ok', [
          `注入完成: v${p2.v}`,
          `扫描到字段: ${fields}`,
          '填充命令已发送 ✓ 请查看页面右下角的提示',
        ]);
      }
    } catch (e) {
      setStatus('error', ['填充失败: ' + (e.message || e), '— 请刷新页面后重试']);
    } finally {
      $('fillBtn').disabled = false;
      $('fillBtn').textContent = '⚡ 一键填充当前表单';
    }
  }

  function showStatus(kind, text) {
    const el = $('fillStatus');
    el.className = 'fill-status ' + kind;
    el.textContent = text;
  }

  function bindEvents() {
    $('fillBtn').addEventListener('click', fill);
    $('allSections').addEventListener('change', (e) => {
      document.querySelectorAll('#sectionsGrid input').forEach((c) => { c.checked = e.target.checked; });
    });
    $('profileSelect').addEventListener('change', async (e) => {
      await AS.storage.saveSettings({ activeProfileId: e.target.value });
    });
    $('manageProfiles').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
    $('refreshScan').addEventListener('click', scanCount);
    $('learnBtn').addEventListener('click', async () => {
      if (!currentTab) return;
      try {
        await chrome.runtime.sendMessage({ type: 'AF_LEARN_COLLECT' });
        window.close();
      } catch (e) {
        showStatus('error', '无法在此页面捕获');
      }
    });
    $('floatBtn').addEventListener('click', async () => {
      if (!currentTab) return;
      const ok = await ensureContentScript();
      if (!ok) { showStatus('error', '无法注入脚本, 请刷新页面'); return; }
      await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_SHOW_FLOAT' }).catch(() => {});
      window.close();
    });
    $('diagBtn').addEventListener('click', async () => {
      if (!currentTab) return;
      const ok = await ensureContentScript();
      if (!ok) { showStatus('error', '无法注入脚本, 请刷新页面'); return; }
      await chrome.runtime.sendMessage({ type: 'AF_DIAGNOSTIC' }).catch(() => {});
      window.close();
    });
    $('previewConfirmBtn').addEventListener('click', async () => {
      if (!currentTab) return;
      try {
        await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_PREVIEW_CONFIRM' });
        $('previewConfirmBtn').classList.add('hidden');
      } catch (e) {
        showStatus('error', '确认失败: ' + (e.message || e));
      }
    });
    $('saveGrabBtn').addEventListener('click', async () => {
      if (!currentTab) return;
      try {
        await chrome.runtime.sendMessage({ type: 'AF_RECORD_NOW' });
        window.close();
      } catch (e) {
        showStatus('error', '保存失败: ' + (e.message || e));
      }
    });
    $('manualRecord').addEventListener('click', async () => {
      if (!currentTab) return;
      try {
        await chrome.runtime.sendMessage({ type: 'AF_RECORD_NOW' });
        window.close();
      } catch (e) {
        showStatus('error', '无法在此页面记录投递');
      }
    });
  }

  // 实时接收后台广播的填充进度(不依赖页面 overlay)
  let progressLines = [];
  let progressDone = false;
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'AF_FILL_PROGRESS') return;
    if (msg.stage === 'start') {
      progressLines = ['▶ 填充命令已到达页面'];
      progressDone = false;
    } else if (msg.stage === 'scan') {
      progressLines.push(`🔍 扫描到 ${msg.total} 个表单字段`);
    } else if (msg.stage === 'match') {
      progressLines.push(`🎯 匹配到 ${msg.matched} 个字段` + (msg.unmatched ? `, ${msg.unmatched} 个未匹配` : ''));
    } else if (msg.stage === 'done') {
      progressDone = true;
      progressLines.push(`✅ 完成: 成功 ${msg.filled} · 跳过 ${msg.skipped} · 未匹配 ${msg.unmatched}${msg.notEffective ? ` · ⚠未生效 ${msg.notEffective}` : ''}`);
    } else if (msg.stage === 'error') {
      progressDone = true;
      progressLines.push('❌ 异常: ' + (msg.message || '未知错误'));
    }
    setStatus(progressDone ? (msg.stage === 'error' ? 'error' : 'ok') : 'ok', progressLines);
    if (progressDone) {
      setTimeout(() => { progressLines = []; }, 8000);
    }
  });

  // 实时接收后台聚合的填充结果
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'AF_FILL_SUMMARY' && msg.summary) {
      const s = msg.summary;
      showStatus(
        s.errors > 0 ? 'bad' : 'ok',
        `填充完成: 成功 ${s.filled} · 跳过 ${s.skipped} · 未匹配 ${s.unmatched}${s.errors ? ' · 失败 ' + s.errors : ''}`
      );
    }
  });

  init();
})();
