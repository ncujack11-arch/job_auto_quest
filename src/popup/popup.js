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
    await scanCount();
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

  async function fill() {
    if (!currentTab) return;
    $('fillBtn').disabled = true;
    $('fillBtn').textContent = '填充中...';
    $('fillStatus').classList.add('hidden');
    try {
      const active = await AS.storage.getActiveProfile();
      if (!active) {
        showStatus('error', '信息库为空, 请先在配置页录入个人信息');
        return;
      }
      // 确保内容脚本已注入(扩展更新后旧页面可能未加载新脚本, 自动兜底注入)
      const r = await chrome.runtime.sendMessage({ type: 'AF_ENSURE_INJECTED' });
      if (!r || !r.ok) {
        showStatus('error', '无法注入脚本, 请刷新当前页面后重试');
        return;
      }
      // 分段填充: 收集勾选模块
      const all = $('allSections').checked;
      const sections = all ? [] : Array.from(document.querySelectorAll('#sectionsGrid input:checked')).map((c) => c.value);
      await chrome.tabs.sendMessage(currentTab.id, { type: 'AF_FILL', sections });
      showStatus('ok', '已触发填充, 结果将显示在页面右下角');
    } catch (e) {
      showStatus('error', '填充失败: ' + (e.message || e) + ' — 请刷新页面后重试');
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
