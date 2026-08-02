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

  // ---------- 批量导入 ----------
  const CSV_HEADERS = {
    '公司名称': 'company', '公司': 'company', '企业': 'company',
    '岗位名称': 'position', '岗位': 'position', '职位': 'position',
    '岗位类别': 'category', '类别': 'category',
    '工作城市': 'city', '城市': 'city', '地点': 'city',
    '投递渠道': 'channel', '渠道': 'channel', '来源': 'channel',
    '状态': 'status', '进度': 'status',
    '优先级': 'priority',
    '标签': 'tags', '备注标签': 'tags',
    '投递时间': 'appliedAt', '投递日期': 'appliedAt', '申请时间': 'appliedAt', '时间': 'appliedAt',
    '岗位链接': 'url', '链接': 'url', 'URL': 'url', 'url': 'url',
    '薪资': 'salary', '薪资待遇': 'salary', '薪酬': 'salary',
    'base地点': 'base', 'base': 'base',
    '联系人': 'contact', 'HR': 'contact',
    '备注': 'note', '说明': 'note', '备注内容': 'note',
    'JD': 'jdSnapshot', 'JD快照': 'jdSnapshot', '职位描述': 'jdSnapshot',
    '公司行业': 'industry', '行业': 'industry',
  };

  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += c;
      } else if (c === '"') {
        inQ = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((x) => x && x.trim())) rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some((x) => x && x.trim())) rows.push(row); }
    return rows;
  }

  function parseTs(s) {
    if (!s) return null;
    const t = String(s).trim().replace(/[./]/g, '-');
    const m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
    if (m) {
      const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
      return isNaN(d.getTime()) ? null : d.getTime();
    }
    const m2 = t.match(/^(\d{4})-(\d{1,2})$/);
    if (m2) { const d = new Date(+m2[1], +m2[2] - 1, 1); return isNaN(d.getTime()) ? null : d.getTime(); }
    return null;
  }

  // 导入 CSV / JSON 文本 → { records: 待导入记录[], errors: [] }
  function importRecords(text, { format }) {
    const records = [];
    const errors = [];
    const applyField = (rec, key, value) => {
      const v = value === null || value === undefined ? '' : String(value).trim();
      if (!v) return;
      const mapped = CSV_HEADERS[key] || key;
      if (mapped === 'tags') {
        rec.tags = [...new Set([...(rec.tags || []), ...v.split(/[,，、|;；]/).map((t) => t.trim()).filter(Boolean)])];
      } else if (mapped === 'appliedAt') {
        const ts = parseTs(v);
        if (ts) {
          rec.timeline = rec.timeline || [];
          const existing = rec.timeline.find((e) => e.type === '投递');
          if (existing) existing.time = ts;
          else rec.timeline.unshift({ id: uid(), type: '投递', time: ts, note: '投递(批量导入)' });
        }
      } else if (mapped === 'note') {
        rec.notes = rec.notes || {};
        rec.notes.content = v;
      } else if (mapped in rec) {
        rec[mapped] = v;
      }
    };

    if (format === 'csv') {
      const rows = parseCSV(text);
      if (rows.length < 2) { errors.push('CSV 无数据行(需要表头 + 至少一行数据)'); return { records, errors }; }
      const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row.some((c) => c && c.trim())) continue;
        const rec = newRecord();
        header.forEach((h, idx) => applyField(rec, h, row[idx]));
        if (rec.company || rec.position) records.push(rec);
        else errors.push(`第 ${i + 1} 行缺少公司/岗位, 已跳过`);
      }
    } else {
      let data = text;
      try { data = JSON.parse(text); } catch (e) { errors.push('JSON 解析失败: ' + e.message); return { records, errors }; }
      const list = Array.isArray(data) ? data : (data && Array.isArray(data.records) ? data.records : null);
      if (!list) { errors.push('JSON 需为数组或 { records: [...] } 结构'); return { records, errors }; }
      list.forEach((item, i) => {
        if (!item || typeof item !== 'object') { errors.push(`第 ${i + 1} 条不是对象, 已跳过`); return; }
        const rec = newRecord();
        Object.entries(item).forEach(([k, v]) => applyField(rec, k, v));
        if (rec.company || rec.position) records.push(rec);
        else errors.push(`第 ${i + 1} 条缺少公司/岗位, 已跳过`);
      });
    }
    return { records, errors };
  }

  AS.apps = {
    DEFAULT_STATUS, EVENT_TYPES, PRIORITIES, uid,
    newRecord, createRecord, setStatus, addEvent, removeEvent, milestones,
    fromGrab, toCSV, downloadCSV, importRecords,
  };
})();
