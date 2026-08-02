/**
 * reminders.js — 本地日程提醒数据模型
 * 配合后台 chrome.alarms + notifications 实现本地推送
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.reminders) return;

  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  async function list() { return AS.storage.getReminders(); }
  async function save(list) { await AS.storage.saveReminders(list); }

  async function upsert(item) {
    const list = await list();
    const i = list.findIndex((r) => r.id === item.id);
    if (i >= 0) list[i] = item; else list.unshift(item);
    await save(list);
    return item;
  }

  async function remove(id) {
    const list = await list();
    await save(list.filter((r) => r.id !== id));
  }

  async function removeByApplication(appId) {
    const list = await list();
    await save(list.filter((r) => r.applicationId !== appId));
  }

  // 获取需要提醒但尚未触发的条目
  async function upcoming(now) {
    const list = await list();
    return list.filter((r) => !r.notified && r.time > (now || Date.now()));
  }

  // 同步 chrome.alarms(仅后台可调用)
  function syncAlarms() {
    return chrome.alarms.clearAll().then(async () => {
      const ups = await upcoming();
      ups.forEach((r) => {
        const delay = r.time - Date.now();
        if (delay <= 0) return;
        chrome.alarms.create('reminder_' + r.id, { when: Date.now() + Math.max(delay, 60 * 1000) });
      });
      return ups.length;
    }).catch((e) => {
      AS.logger && AS.logger.warn('reminders', 'sync alarms failed', e);
      return 0;
    });
  }

  async function markNotified(id) {
    const list = await list();
    const item = list.find((r) => r.id === id);
    if (item) { item.notified = true; item.notifiedAt = Date.now(); await save(list); }
    return item;
  }

  AS.reminders = { uid, list, save, upsert, remove, removeByApplication, upcoming, syncAlarms, markNotified };
})();
