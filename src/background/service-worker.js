/**
 * service-worker.js — MV3 后台服务
 * 职责: 右键菜单、全局快捷键、消息路由、填充结果聚合、投递记录联动、本地提醒推送
 */
'use strict';

importScripts(
  '../utils/logger.js',
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
    await AS.storage.getSiteRules();   // 播种内置站点规则
    await AS.storage.getStatusFlow();  // 播种默认状态流
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
    });
  } catch (e) {
    LOG.warn('bg', 'menus failed', e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureMenus();
  init();
});
chrome.runtime.onStartup.addListener(() => {
  ensureMenus();
  init();
});

// ---------- 工具 ----------
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isHttpTab(tab) {
  return tab && /^https?:\/\//.test(tab.url || '');
}

async function triggerFill() {
  const tab = await getActiveTab();
  if (!isHttpTab(tab)) {
    LOG.info('bg', 'no http tab');
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'AF_FILL' });
  } catch (e) {
    LOG.warn('bg', 'trigger fill failed', e);
  }
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

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  switch (msg.type) {
    case 'AF_FILL_DONE':
      aggCollector.push(msg.payload || {});
      aggregateFillResults();
      break;

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
  if (info.menuItemId === 'af-fill-form') {
    if (isHttpTab(tab)) {
      chrome.tabs.sendMessage(tab.id, { type: 'AF_FILL' }).catch((e) => LOG.warn('bg', 'menu fill failed', e));
    }
  } else if (info.menuItemId === 'af-record') {
    if (isHttpTab(tab)) {
      onSubmissionDetected(tab, {});
    }
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
