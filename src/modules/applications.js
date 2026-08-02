/**
 * applications.js — 投递台账数据模型与操作
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.apps) return;

  const DEFAULT_STATUS = ['待笔试', '笔试中', '一面', '二面', '终面', 'HR面', 'OC', 'Offer', '已回绝', '流程终止'];
  const EVENT_TYPES = ['投递', '笔试通知', '笔试', '一面', '二面', '终面', 'HR面', 'OC', 'Offer', '拒信', '状态变更', '自定义'];
  const PRIORITIES = ['高', '中', '低'];

  function uid() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newRecord(partial) {
    const now = Date.now();
    const rec = {
      id: uid(),
      company: '', position: '', category: '', city: '', channel: '',
      url: '', jdSnapshot: '', industry: '',
      status: partial && partial.status ? partial.status : DEFAULT_STATUS[0],
      priority: '中',
      tags: [],
      timeline: [
        { id: uid(), type: '投递', time: now, note: '投递' },
      ],
      notes: { content: '' },
      interviews: [],   // [{id, round, time, question, answer, review}]
      profileId: null,
      resumeVersion: '',
      salary: '', base: '', contact: '',
      createdAt: now,
      updatedAt: now,
      fromPage: false,
    };
    return Object.assign(rec, partial || {});
  }

  async function createRecord(partial) {
    const rec = newRecord(partial);
    await AS.storage.upsertApplication(rec);
    return rec;
  }

  // 状态流事件记录: 切换状态时写入时间线
  async function setStatus(id, status) {
    const app = await AS.storage.getApplication(id);
    if (!app) return null;
    const prev = app.status;
    app.status = status;
    if (prev !== status) {
      app.timeline = app.timeline || [];
      app.timeline.push({ id: uid(), type: '状态变更', time: Date.now(), note: `${prev} → ${status}` });
    }
    await AS.storage.upsertApplication(app);
    return app;
  }

  async function addEvent(id, event) {
    const app = await AS.storage.getApplication(id);
    if (!app) return null;
    app.timeline = app.timeline || [];
    app.timeline.push({ id: uid(), type: event.type || '自定义', time: event.time || Date.now(), note: event.note || '' });
    app.timeline.sort((a, b) => a.time - b.time);
    await AS.storage.upsertApplication(app);
    return app;
  }

  async function removeEvent(id, eventId) {
    const app = await AS.storage.getApplication(id);
    if (!app) return null;
    app.timeline = (app.timeline || []).filter((e) => e.id !== eventId);
    await AS.storage.upsertApplication(app);
    return app;
  }

  // 里程碑时间速查: 各类型事件最近一次时间
  function milestones(app) {
    const m = {};
    (app.timeline || []).forEach((e) => {
      const t = e.time || 0;
      if (e.type === '投递') m.appliedAt = m.appliedAt === undefined ? t : m.appliedAt;
      if (e.type === '笔试通知') m.writtenNotifyAt = t;
      if (e.type === '笔试') m.writtenAt = t;
      if (/^[一二三四五]面|终面|HR面$/.test(e.type)) {
        m.lastInterviewAt = t;
        m.interviewCount = (m.interviewCount || 0) + 1;
      }
      if (e.type === 'OC') m.ocAt = t;
      if (e.type === 'Offer') m.offerAt = t;
      if (e.type === '拒信') m.rejectAt = t;
    });
    return m;
  }

  // 从面板/页面信息创建记录(去空字段)
  function fromGrab(info) {
    const rec = newRecord();
    ['company', 'position', 'category', 'city', 'channel', 'url', 'jdSnapshot', 'note'].forEach((k) => {
      if (info[k]) rec[k] = info[k];
    });
    if (info.fromPage) rec.fromPage = true;
    if (info.note) { rec.notes = { content: info.note }; }
    return rec;
  }

  // CSV 导出(UTF-8 BOM 兼容 Excel)
  function toCSV(list) {
    const headers = ['公司名称', '岗位名称', '岗位类别', '工作城市', '投递渠道', '状态', '优先级', '标签', '投递时间', '岗位链接', '薪资', 'base地点', '联系人', '备注'];
    const esc = (v) => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""').replace(/\n/g, ' ') + '"';
    const rows = [headers.map(esc).join(',')];
    list.forEach((a) => {
      const applied = (a.timeline || []).find((e) => e.type === '投递');
      rows.push([
        a.company, a.position, a.category, a.city, a.channel, a.status, a.priority,
        (a.tags || []).join('|'),
        applied ? new Date(applied.time).toLocaleString('zh-CN') : '',
        a.url, a.salary, a.base, a.contact,
        (a.notes && a.notes.content) || '',
      ].map(esc).join(','));
    });
    return '\uFEFF' + rows.join('\r\n');
  }

  function downloadCSV(list, filename) {
    const blob = new Blob([toCSV(list)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || `投递台账_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  AS.apps = {
    DEFAULT_STATUS, EVENT_TYPES, PRIORITIES, uid,
    newRecord, createRecord, setStatus, addEvent, removeEvent, milestones,
    fromGrab, toCSV, downloadCSV,
  };
})();
