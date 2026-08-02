/**
 * service-worker.js — MV3 后台服务
 * 职责: 右键菜单、全局快捷键、消息路由、填充结果聚合、投递记录联动、本地提醒推送
 */
'use strict';

importScripts(
  '../utils/logger.js',
  '../utils/idb.js',
  '../modules/schema.js',
  '../modules/storage.js',
  '../utils/fuzzy.js',
  '../utils/dates.js',
  '../utils/encrypt.js',
  '../modules/applications.js',
  '../modules/reminders.js',
  '../modules/stats.js'
);

const LOG = AS.logger;

// ---------- 初始化 ----------
async function init() {
  try {
    // 合并新增的内置站点规则(只补缺失 id, 不覆盖用户自定义)
    const rules = await AS.storage.getSiteRules();
    const have = new Set(rules.map((r) => r.id));
    const missing = AS.storage.BUILTIN_RULES.filter((r) => !have.has(r.id));
    if (missing.length) {
      await AS.storage.saveSiteRules(rules.concat(missing));
      LOG.info('bg', 'merged new builtin rules', missing.length);
    }
    await AS.storage.getStatusFlow();   // 播种默认状态流
    await AS.reminders.syncAlarms();
  } catch (e) {
    LOG.error('bg', 'init failed', e);
  }
}

function ensureMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'af-fill-form',
        title: '一键填充当前网申表单',
        contexts: ['all'],
      });
      chrome.contextMenus.create({
        id: 'af-record',
        title: '记录本次投递',
        contexts: ['all'],
      });
      chrome.contextMenus.create({
        id: 'af-show-panel',
        title: '显示悬浮操作面板',
        contexts: ['all'],
      });
      chrome.contextMenus.create({
        id: 'af-capture-selection',
        title: '将选中文字存入开放题库',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: 'af-quiz-lookup',
        title: '在本地笔试题库中查找答案',
        contexts: ['selection'],
      });
      chrome.contextMenus.create({
        id: 'af-open-options',
        title: '打开插件配置页',
        contexts: ['all'],
      });
    });
  } catch (e) {
    LOG.warn('bg', 'menus failed', e);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureMenus();
  init();
  // 更新/安装时自动备份全量数据, 防止意外丢失(保留最近 5 份快照)
  autoBackup(details);
});
chrome.runtime.onStartup.addListener(() => {
  ensureMenus();
  init();
});

// ---------- 数据自保: 版本更新自动备份 ----------
async function autoBackup(details) {
  try {
    const data = await AS.storage.exportAll();
    const key = 'af_auto_backups';
    const r = await chrome.storage.local.get(key);
    const backups = (r && r[key]) || [];
    backups.push({
      at: Date.now(),
      fromVersion: (details && details.previousVersion) || 'unknown',
      toVersion: chrome.runtime.getManifest().version,
      reason: (details && details.reason) || 'update',
      data,
    });
    while (backups.length > 5) backups.shift();
    await chrome.storage.local.set({ [key]: backups });
    LOG.info('bg', 'auto backup saved', backups.length, 'snapshots');
  } catch (e) {
    LOG.warn('bg', 'auto backup failed', e);
  }
}

// ---------- 工具 ----------
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isHttpTab(tab) {
  return tab && /^https?:\/\//.test(tab.url || '');
}

// 核心内容脚本清单(与 manifest content_scripts 一致, 用于兜底注入)
const CORE_CONTENT_SCRIPTS = [
  'src/utils/logger.js',
  'src/modules/schema.js',
  'src/modules/storage.js',
  'src/utils/fuzzy.js',
  'src/utils/dates.js',
  'src/utils/matcher.js',
  'src/content/scanner.js',
  'src/content/filler.js',
  'src/content/overlay.js',
  'src/content/detect.js',
  'src/content/quiz.js',
  'src/content/content.js',
];

// 探测内容脚本是否已注入; 未注入则用 scripting 兜底注入
// (popup 打开 / 右键菜单点击时 activeTab 已授权; 快捷键场景可能无权限, 返回 false)
async function ensureInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'AF_PING' });
    return true;
  } catch (e) {
    LOG.info('bg', 'content script not injected, fallback injecting...', tabId);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: CORE_CONTENT_SCRIPTS,
      });
      return true;
    } catch (e2) {
      LOG.warn('bg', 'fallback injection failed', e2);
      return false;
    }
  }
}

async function triggerFill() {
  const tab = await getActiveTab();
  if (!isHttpTab(tab)) {
    LOG.info('bg', 'no http tab');
    return;
  }
  const ok = await ensureInjected(tab.id);
  if (!ok) {
    notifyReloadRequired(tab.id);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'AF_FILL' });
  } catch (e) {
    LOG.warn('bg', 'trigger fill failed', e);
  }
}

// 注入失败时提示用户刷新页面
function notifyReloadRequired(tabId) {
  try {
    chrome.notifications.create('af_inject_fail', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('src/assets/icons/icon128.png'),
      title: '秋招网申自动填充',
      message: '无法在当前页面注入插件脚本(可能是扩展刚更新或页面权限受限), 请刷新页面后重试。',
      priority: 2,
    }, () => {});
  } catch (e) { /* ignore */ }
}

// ---------- 填充结果聚合 ----------
let aggTimer = null;
let aggCollector = [];

function aggregateFillResults() {
  clearTimeout(aggTimer);
  aggTimer = setTimeout(async () => {
    const payloads = aggCollector;
    aggCollector = [];
    const summary = payloads.reduce((acc, p) => {
      acc.filled += p.filled || 0;
      acc.skipped += p.skipped || 0;
      acc.unmatched += p.unmatched || 0;
      acc.errors += p.errors || 0;
      acc.total += p.total || 0;
      acc.unmatchedItems = acc.unmatchedItems.concat(p.unmatchedItems || []);
      acc.infos = acc.infos.concat(p.infos || []);
      return acc;
    }, { filled: 0, skipped: 0, unmatched: 0, errors: 0, total: 0, unmatchedItems: [], infos: [] });

    LOG.info('bg', 'fill summary', summary);
    const tab = await getActiveTab();
    if (tab && tab.id !== undefined) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'AF_FILL_SUMMARY', summary });
      } catch (e) { /* tab closed */ }
    }
    try {
      await chrome.runtime.sendMessage({ type: 'AF_FILL_SUMMARY', summary });
    } catch (e) { /* no receiver */ }
  }, 1500);
}

// ---------- 投递完成联动 ----------
async function onSubmissionDetected(tab, msg) {
  const ok = await ensureInjected(tab.id);
  if (!ok) { notifyReloadRequired(tab.id); return; }
  LOG.info('bg', 'submission detected', tab.url);
  let info = { url: msg.url || tab.url, title: msg.title || '' };
  try {
    const grabbed = await chrome.tabs.sendMessage(tab.id, { type: 'AF_GRAB_INFO' });
    if (grabbed) info = Object.assign(info, grabbed);
  } catch (e) {
    LOG.warn('bg', 'grab page info failed', e);
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'AF_SHOW_RECORD', info });
  } catch (e) {
    LOG.warn('bg', 'show record panel failed', e);
  }
}

// ---------- 学习模式: 聚合各框架收集的已填资料 ----------
let learnItems = [];
let learnTimer = null;

function collectLearnItems() {
  clearTimeout(learnTimer);
  learnTimer = setTimeout(() => {
    const items = learnItems;
    learnItems = [];
    chrome.tabs.sendMessage(learnTabId, { type: 'AF_LEARN_SHOW', items }).catch(() => {});
  }, 1200);
}
let learnTabId = null;

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'AF_FILL_DONE':
      aggCollector.push(msg.payload || {});
      aggregateFillResults();
      break;

    case 'AF_LEARN_COLLECT_RESULT':
      if (sender.tab) {
        learnTabId = sender.tab.id;
        learnItems = learnItems.concat(msg.items || []);
        collectLearnItems();
      }
      break;

    case 'AF_LEARN_COLLECT': {
      // 面板/弹窗请求: 转发给当前活动标签页
      getActiveTab().then((tab) => {
        if (!tab) return;
        ensureInjected(tab.id).then((ok) => {
          if (ok) chrome.tabs.sendMessage(tab.id, { type: 'AF_LEARN_COLLECT' }).catch(() => {});
        });
      });
      break;
    }

    case 'AF_ENSURE_INJECTED': {
      getActiveTab().then((tab) => {
        if (!tab || !isHttpTab(tab)) return sendResponse({ ok: false });
        ensureInjected(tab.id).then((ok) => sendResponse({ ok }));
      });
      return true;
    }

    case 'AF_FILL_SECTIONS': {
      getActiveTab().then((tab) => {
        if (!tab) return;
        ensureInjected(tab.id).then((ok) => {
          if (ok) chrome.tabs.sendMessage(tab.id, { type: 'AF_FILL', sections: msg.sections || [] }).catch(() => {});
        });
      });
      break;
    }

    case 'AF_RECORD_NOW': {
      getActiveTab().then((tab) => {
        if (!tab || !isHttpTab(tab)) return;
        onSubmissionDetected(tab, {});
      });
      break;
    }

    case 'AF_GET_RESUME_FILE':
      // 读取本地存储的简历文件(IndexedDB), 供页面 file 控件自动上传
      AS.idb.get('resumeFile').then((file) => {
        if (!file) return sendResponse({ found: false });
        file.arrayBuffer().then((buf) => {
          sendResponse({ found: true, name: file.name, type: file.type || 'application/pdf', size: file.size, data: buf });
        }).catch((e) => sendResponse({ found: false, error: e.message || String(e) }));
      }).catch((e) => sendResponse({ found: false, error: e.message || String(e) }));
      return true;

    case 'AF_ENABLE_MARK_MODE':
      getActiveTab().then((tab) => {
        if (!tab) return;
        ensureInjected(tab.id).then((ok) => {
          if (ok) chrome.tabs.sendMessage(tab.id, { type: 'AF_ENABLE_MARK_MODE' }).catch(() => {});
        });
      });
      break;

    case 'AF_LEARN_SAVE':
      AS.storage.getActiveProfile().then(async (profile) => {
        if (!profile) return sendResponse({ saved: 0, error: '无信息方案' });
        const d = profile.data;
        const settings = await AS.storage.getSettings();
        let saved = 0;
        let same = 0, locked = 0, skipped = 0;
        for (const it of msg.items || []) {
          if (!it || it.value === undefined || it.value === null || String(it.value).trim() === '') { skipped++; continue; }
          if (it.type === 'openQuestions') {
            d.openQuestions = d.openQuestions || [];
            const dup = d.openQuestions.some((q) => q.question === it.question && q.answer === it.answer);
            if (!dup) { d.openQuestions.push({ question: it.question || '开放题', answer: String(it.value).trim() }); saved++; }
            else same++;
            continue;
          }
          if (it.type === 'custom') {
            d.custom = d.custom || [];
            const dup = d.custom.some((c) => c.key === it.key && c.value === it.value);
            if (!dup) {
              d.custom.push({ key: it.key || 'f' + Date.now().toString(36), label: it.label || '自定义', value: String(it.value).trim() });
              saved++;
            } else same++;
            continue;
          }
          const base = String(it.fieldKey || '').replace(/\[\d+\]/g, '');
          const [catId, key] = base.split('.');
          const cat = AS.schema.findCategory(catId);
          if (!cat || !key || cat.repeatable) { skipped++; continue; }
          let val = String(it.value).trim();
          const def = AS.schema.getFieldDef(base);
          if (def && def.sensitive && settings.encryption && settings.encryption.enabled) {
            if (AS.encrypt.hasKey()) {
              try { val = await AS.encrypt.encryptWithSession(val); } catch (e) { LOG.error('bg', 'learn encrypt failed', e); }
            } else {
              locked++; // 加密未解锁, 跳过敏感字段
              continue;
            }
          }
          if (d[catId][key] !== val) { d[catId][key] = val; saved++; }
          else same++;
        }
        if (saved) { profile.updatedAt = Date.now(); await AS.storage.saveProfile(profile); }
        LOG.info('bg', 'learn saved', saved, { same, locked, skipped });
        sendResponse({ saved, same, locked, skipped });
      }).catch((e) => { LOG.error('bg', 'learn save failed', e); sendResponse({ saved: 0, error: e.message || String(e) }); });
      return true;

    case 'AF_SUBMISSION': {
      const tab = sender.tab;
      if (tab) onSubmissionDetected(tab, msg);
      break;
    }

    case 'AF_TRIGGER_FILL':
      triggerFill();
      break;

    case 'AF_IS_UNLOCKED':
      sendResponse({ unlocked: AS.encrypt.hasKey() });
      break;

    case 'AF_UNLOCK':
      AS.storage.getSettings().then((settings) => {
        AS.encrypt.unlock(msg.password || '', settings).then((ok) => {
          sendResponse({ ok });
          if (ok) LOG.info('bg', 'encryption unlocked');
        }).catch((e) => {
          LOG.error('bg', 'unlock error', e);
          sendResponse({ ok: false });
        });
      });
      return true;

    case 'AF_DECRYPT':
      // 会话内解密(选项页展示敏感字段)
      AS.encrypt.decryptWithSession(msg.value).then((v) => sendResponse({ value: v }))
        .catch((e) => sendResponse({ error: e.message || String(e) }));
      return true;

    case 'AF_ENCRYPT':
      // 会话内加密(保存敏感字段)
      AS.encrypt.encryptWithSession(msg.value).then((v) => sendResponse({ value: v }))
        .catch((e) => sendResponse({ error: e.message || String(e) }));
      return true;

    case 'AF_LOCK':
      AS.encrypt.clearSessionKey();
      sendResponse({ ok: true });
      break;

    case 'AF_SYNC_REMINDERS':
      AS.reminders.syncAlarms().then((n) => sendResponse({ scheduled: n }));
      return true;

    case 'AF_OPEN_OPTIONS':
      chrome.runtime.openOptionsPage();
      break;

    default:
      break;
  }
});

// ---------- 快捷键 ----------
chrome.commands.onCommand.addListener((command) => {
  if (command === 'fill-form') triggerFill();
  if (command === 'open-options') chrome.runtime.openOptionsPage();
});

// ---------- 右键菜单 ----------
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const sendToTab = (type, extra) => {
    if (!isHttpTab(tab)) return;
    ensureInjected(tab.id).then((ok) => {
      if (!ok) { notifyReloadRequired(tab.id); return; }
      chrome.tabs.sendMessage(tab.id, Object.assign({ type }, extra || {})).catch((e) => LOG.warn('bg', 'menu msg failed', e));
    });
  };
  if (info.menuItemId === 'af-fill-form') {
    sendToTab('AF_FILL');
  } else if (info.menuItemId === 'af-record') {
    if (isHttpTab(tab)) onSubmissionDetected(tab, {});
  } else if (info.menuItemId === 'af-show-panel') {
    sendToTab('AF_SHOW_FLOAT');
  } else if (info.menuItemId === 'af-capture-selection') {
    sendToTab('AF_SAVE_SELECTION', { text: info.selectionText || '' });
  } else if (info.menuItemId === 'af-quiz-lookup') {
    sendToTab('AF_QUIZ_LOOKUP', { text: info.selectionText || '' });
  } else if (info.menuItemId === 'af-open-options') {
    chrome.runtime.openOptionsPage();
  }
});

// ---------- 本地提醒 ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm || !alarm.name || !alarm.name.startsWith('reminder_')) return;
  const id = alarm.name.slice('reminder_'.length);
  const [reminders, applications] = await Promise.all([AS.storage.getReminders(), AS.storage.getApplications()]);
  const reminder = reminders.find((r) => r.id === id);
  if (!reminder) return;
  const app = applications.find((a) => a.id === reminder.applicationId);
  const company = app ? app.company : '';
  const position = app ? app.position : '';
  const timeStr = new Date(reminder.time).toLocaleString('zh-CN');

  const nid = 'af_remind_' + id;
  chrome.notifications.create(nid, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/assets/icons/icon128.png'),
    title: '秋招提醒: ' + (reminder.label || '节点'),
    message: `${company || ''} ${position || ''} — ${timeStr}`,
    priority: 2,
    contextMessage: '点击查看投递记录',
    requireInteraction: true,
  }, () => {});
  await AS.reminders.markNotified(id);
});

chrome.notifications.onClicked.addListener((nid) => {
  if (!nid.startsWith('af_remind_')) return;
  const id = nid.slice('af_remind_'.length);
  chrome.notifications.clear(nid);
  chrome.tabs.create({
    url: chrome.runtime.getURL('src/options/options.html#/applications?focus=' + id),
  });
});

init();
