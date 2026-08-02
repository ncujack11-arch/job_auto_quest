/**
 * storage.js — 数据访问层 (chrome.storage.local)
 * 所有数据仅存本地, 无任何网络请求
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.storage) return;

  const KEYS = {
    SETTINGS: 'af_settings',
    PROFILES: 'af_profiles',
    SITE_RULES: 'af_site_rules',
    APPLICATIONS: 'af_applications',
    REMINDERS: 'af_reminders',
    STATUS_FLOW: 'af_status_flow',
    REUSE: 'af_reuse_payload',
    SITE_MEMORIES: 'af_site_memories',
    LOGS: 'af_logs',
    QUIZ: 'af_quiz',
  };

  const DEFAULT_SETTINGS = {
    version: '1.7.0',
    activeProfileId: null,
    conflictMode: 'skip',        // 'skip' | 'overwrite'
    typingMode: false,           // 逐字模拟输入
    typingMin: 30,               // 逐字输入间隔范围(ms)
    typingMax: 120,
    previewMode: true,           // 填充前预览确认
    siteFilter: { mode: 'all', blacklist: [], whitelist: [] },  // 域名黑白名单
    autoNext: false,             // 多页表单自动下一步续填(默认关, 绝不自动提交)
    photoDataUrl: '',            // 证件照 dataURL(可选, 用于自动上传)
    refCodes: [],                // 内推码库 [{host, code}]
    logLevel: 'info',
    encryption: { enabled: false, salt: '', iterations: 100000, passwordHash: '', hint: '' },
  };

  const DEFAULT_STATUS_FLOW = ['待笔试', '笔试中', '一面', '二面', '终面', 'HR面', 'OC', 'Offer', '已回绝', '流程终止'];

  // 内置站点规则: 主流网申系统
  const BUILTIN_RULES = [
    {
      id: 'rule_beisen', siteName: '北森', host: 'beisen.com', builtin: true, enabled: true,
      mapping: {
        'name': 'basic.name', 'mobile': 'basic.phone', 'phone': 'basic.phone', 'telephone': 'basic.phone',
        'email': 'basic.email', 'gender': 'basic.gender', 'birthday': 'basic.birthday', 'birth_date': 'basic.birthday',
        'idcard': 'basic.idCard', 'id_card': 'basic.idCard', 'native_place': 'basic.nativePlace',
        'current_city': 'basic.currentLocation', 'political': 'basic.politicalStatus', 'political_status': 'basic.politicalStatus',
        'school': 'education[0].school', 'school_name': 'education[0].school', 'degree': 'education[0].degree',
        'major': 'education[0].major', 'major_name': 'education[0].major', 'enroll_time': 'education[0].eduStart',
        'graduate_time': 'education[0].eduEnd', 'graduation_time': 'education[0].eduEnd', 'gpa': 'education[0].gpa',
        'major_rank': 'education[0].gpaRank', 'expected_position': 'intent.targetPosition',
        'expected_city': 'intent.targetCity', 'expected_salary': 'intent.expectedSalary',
        'entry_time': 'intent.availableDate', 'job_status': 'intent.jobStatus',
        'intern_company': 'internship[0].intCompany', 'intern_position': 'internship[0].intPosition',
      },
    },
    {
      id: 'rule_cnkix', siteName: '肯耐珂萨', host: 'cnkix.com', builtin: true, enabled: true,
      mapping: {
        'name': 'basic.name', 'mobile': 'basic.phone', 'phone': 'basic.phone', 'email': 'basic.email',
        'gender': 'basic.gender', 'birthday': 'basic.birthday', 'idcard': 'basic.idCard',
        'school': 'education[0].school', 'degree': 'education[0].degree', 'major': 'education[0].major',
        'graduate_date': 'education[0].eduEnd', 'graduate': 'education[0].eduEnd',
        'position': 'intent.targetPosition', 'city': 'intent.targetCity', 'salary': 'intent.expectedSalary',
      },
    },
    {
      id: 'rule_zhaopin', siteName: '智联招聘', host: 'zhaopin.com', builtin: true, enabled: true,
      mapping: {
        'realName': 'basic.name', 'name': 'basic.name', 'phone': 'basic.phone', 'mobile': 'basic.phone',
        'email': 'basic.email', 'sex': 'basic.gender', 'gender': 'basic.gender',
        'birthday': 'basic.birthday', 'resumeCity': 'basic.currentLocation', 'city': 'basic.currentLocation',
        'school': 'education[0].school', 'education': 'education[0].degree', 'degree': 'education[0].degree',
        'major': 'education[0].major', 'graduationTime': 'education[0].eduEnd', 'graduation': 'education[0].eduEnd',
        'jobName': 'intent.targetPosition', 'expectSalary': 'intent.expectedSalary',
      },
    },
    {
      id: 'rule_51job', siteName: '前程无忧', host: '51job.com', builtin: true, enabled: true,
      mapping: {
        'name': 'basic.name', 'mobile': 'basic.phone', 'telephone': 'basic.phone', 'email': 'basic.email',
        'gender': 'basic.gender', 'birthday': 'basic.birthday', 'degree': 'education[0].degree',
        'school': 'education[0].school', 'major': 'education[0].major', 'graduate': 'education[0].eduEnd',
        'graduation': 'education[0].eduEnd', 'jobtitle': 'intent.targetPosition', 'city': 'intent.targetCity',
      },
    },
    {
      id: 'rule_nowcoder', siteName: '牛客网', host: 'nowcoder.com', builtin: true, enabled: true,
      mapping: {
        'name': 'basic.name', 'realName': 'basic.name', 'mobile': 'basic.phone', 'phone': 'basic.phone',
        'email': 'basic.email', 'gender': 'basic.gender', 'birthday': 'basic.birthday',
        'school': 'education[0].school', 'degree': 'education[0].degree', 'major': 'education[0].major',
        'graduateTime': 'education[0].eduEnd', 'position': 'intent.targetPosition',
      },
    },
    {
      id: 'rule_shixiseng', siteName: '实习僧', host: 'shixiseng.com', builtin: true, enabled: true,
      mapping: {
        'name': 'basic.name', 'mobile': 'basic.phone', 'phone': 'basic.phone', 'email': 'basic.email',
        'gender': 'basic.gender', 'school': 'education[0].school', 'degree': 'education[0].degree',
        'major': 'education[0].major', 'graduate': 'education[0].eduEnd', 'job': 'intent.targetPosition',
        'city': 'intent.targetCity',
      },
    },
    {
      id: 'rule_campusbox', siteName: '校招盒子', host: 'xiaozhaobox.com', builtin: true, enabled: true,
      mapping: {
        'name': 'basic.name', 'phone': 'basic.phone', 'mobile': 'basic.phone', 'email': 'basic.email',
        'gender': 'basic.gender', 'birthday': 'basic.birthday', 'school': 'education[0].school',
        'degree': 'education[0].degree', 'major': 'education[0].major', 'graduate_time': 'education[0].eduEnd',
        'position': 'intent.targetPosition', 'expect_city': 'intent.targetCity',
      },
    },
  ];

  async function get(key, fallback) {
    try {
      const r = await chrome.storage.local.get(key);
      return r[key] !== undefined ? r[key] : fallback;
    } catch (e) {
      AS.logger && AS.logger.warn('storage', 'read failed', key, e);
      return fallback;
    }
  }
  async function set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }

  // ---------- 设置 ----------
  async function getSettings() {
    const s = await get(KEYS.SETTINGS, null);
    return Object.assign({}, DEFAULT_SETTINGS, s || {});
  }
  async function saveSettings(partial) {
    const cur = await getSettings();
    const next = Object.assign({}, cur, partial);
    await set(KEYS.SETTINGS, next);
    return next;
  }

  // ---------- 信息方案 ----------
  async function getProfiles() { return (await get(KEYS.PROFILES, [])) || []; }
  async function saveProfiles(list) { await set(KEYS.PROFILES, list || []); }
  async function getProfile(id) {
    const list = await getProfiles();
    return list.find((p) => p.id === id) || null;
  }
  async function getActiveProfile() {
    const s = await getSettings();
    const list = await getProfiles();
    if (!list.length) return null;
    return list.find((p) => p.id === s.activeProfileId) || list[0];
  }
  async function saveProfile(profile) {
    const list = await getProfiles();
    const i = list.findIndex((p) => p.id === profile.id);
    if (i >= 0) list[i] = profile; else list.unshift(profile);
    await saveProfiles(list);
    const s = await getSettings();
    if (!s.activeProfileId) await saveSettings({ activeProfileId: profile.id });
    return profile;
  }
  async function deleteProfile(id) {
    const list = await getProfiles();
    await saveProfiles(list.filter((p) => p.id !== id));
    const s = await getSettings();
    if (s.activeProfileId === id) {
      const rest = list.filter((p) => p.id !== id);
      await saveSettings({ activeProfileId: rest.length ? rest[0].id : null });
    }
  }

  // ---------- 站点规则 ----------
  async function getSiteRules() {
    let list = await get(KEYS.SITE_RULES, null);
    if (list === null || list === undefined) { list = JSON.parse(JSON.stringify(BUILTIN_RULES)); await set(KEYS.SITE_RULES, list); }
    return list;
  }
  async function saveSiteRules(list) { await set(KEYS.SITE_RULES, list || []); }
  async function getSiteRuleForHost(host) {
    const list = await getSiteRules();
    const h = String(host || '').toLowerCase();
    const hit = list.find((r) => r.enabled !== false && r.host && h.endsWith(r.host.toLowerCase().replace(/^\*\./, '')));
    return hit || null;
  }

  // ---------- 投递台账 ----------
  async function getApplications() { return (await get(KEYS.APPLICATIONS, [])) || []; }
  async function saveApplications(list) { await set(KEYS.APPLICATIONS, list || []); }
  async function getApplication(id) {
    const list = await getApplications();
    return list.find((a) => a.id === id) || null;
  }
  async function upsertApplication(app) {
    const list = await getApplications();
    const i = list.findIndex((a) => a.id === app.id);
    app.updatedAt = Date.now();
    if (i >= 0) list[i] = app; else list.unshift(app);
    await saveApplications(list);
    return app;
  }
  async function removeApplications(ids) {
    const set = new Set(ids);
    const list = await getApplications();
    await saveApplications(list.filter((a) => !set.has(a.id)));
  }
  async function bulkUpdate(ids, patch) {
    const list = await getApplications();
    let changed = 0;
    list.forEach((a) => {
      if (ids.includes(a.id)) { Object.assign(a, patch, { updatedAt: Date.now() }); changed++; }
    });
    if (changed) await saveApplications(list);
    return changed;
  }

  // ---------- 状态流 ----------
  async function getStatusFlow() {
    let f = await get(KEYS.STATUS_FLOW, null);
    if (!f || !f.length) { f = DEFAULT_STATUS_FLOW.slice(); await set(KEYS.STATUS_FLOW, f); }
    return f;
  }
  async function saveStatusFlow(list) { await set(KEYS.STATUS_FLOW, list || DEFAULT_STATUS_FLOW.slice()); }

  // ---------- 提醒 ----------
  async function getReminders() { return (await get(KEYS.REMINDERS, [])) || []; }
  async function saveReminders(list) { await set(KEYS.REMINDERS, list || []); }

  // ---------- 复用投递载荷 ----------
  async function setReusePayload(payload) { await set(KEYS.REUSE, payload); }
  async function getReusePayload() { return (await get(KEYS.REUSE, null)) || null; }
  async function clearReusePayload() { await set(KEYS.REUSE, null); }

  // ---------- 选择器记忆 (同一域名填充成功后记忆 选择器→字段) ----------
  async function getSiteMemories() { return (await get(KEYS.SITE_MEMORIES, {})) || {}; }
  async function saveSiteMemories(map) { await set(KEYS.SITE_MEMORIES, map || {}); }
  async function getMemoriesForHost(host) {
    const map = await getSiteMemories();
    return map[String(host || '').toLowerCase()] || null;
  }
  async function addMemory(host, selector, fieldKey) {
    const map = await getSiteMemories();
    const h = String(host || '').toLowerCase();
    if (!map[h]) map[h] = {};
    map[h][selector] = fieldKey;
    // 单域名记忆上限, 防膨胀
    const keys = Object.keys(map[h]);
    if (keys.length > 400) {
      keys.slice(0, keys.length - 400).forEach((k) => delete map[h][k]);
    }
    await set(KEYS.SITE_MEMORIES, map);
  }
  async function clearMemoriesForHost(host) {
    const map = await getSiteMemories();
    delete map[String(host || '').toLowerCase()];
    await set(KEYS.SITE_MEMORIES, map);
  }
  async function countMemories() {
    const map = await getSiteMemories();
    return Object.values(map).reduce((a, h) => a + Object.keys(h || {}).length, 0);
  }

  // ---------- 本地日志缓冲 (环形) ----------
  const LOG_MAX = 300;
  async function appendLog(entry) {
    try {
      const list = (await get(KEYS.LOGS, [])) || [];
      list.push(entry);
      while (list.length > LOG_MAX) list.shift();
      await set(KEYS.LOGS, list);
    } catch (e) { /* 日志写入失败不影响主流程 */ }
  }
  async function getLogs() { return (await get(KEYS.LOGS, [])) || []; }
  async function clearLogs() { await set(KEYS.LOGS, []); }

  // ---------- 笔试题库 ----------
  async function getQuiz() { return (await get(KEYS.QUIZ, [])) || []; }
  async function saveQuiz(list) { await set(KEYS.QUIZ, list || []); }
  async function addQuizItem(item) {
    const list = await getQuiz();
    const dup = list.some((q) => q.question === item.question && q.answer === item.answer);
    if (!dup) { list.push(item); await saveQuiz(list); }
    return !dup;
  }

  // ---------- 备份 / 恢复 ----------
  async function exportAll() {
    return {
      exportedAt: new Date().toISOString(),
      app: 'resume-auto-fill-extension',
      version: DEFAULT_SETTINGS.version,
      data: {
        settings: await getSettings(),
        profiles: await getProfiles(),
        siteRules: await getSiteRules(),
        applications: await getApplications(),
        reminders: await getReminders(),
        statusFlow: await getStatusFlow(),
        siteMemories: await getSiteMemories(),
        quiz: await getQuiz(),
      },
    };
  }
  async function importAll(payload, { overwrite = true } = {}) {
    if (!payload || !payload.data) throw new Error('备份文件格式无效');
    const d = payload.data;
    if (overwrite || d.settings) await set(KEYS.SETTINGS, d.settings || DEFAULT_SETTINGS);
    if (overwrite || d.profiles) await set(KEYS.PROFILES, d.profiles || []);
    if (overwrite || d.siteRules) await set(KEYS.SITE_RULES, d.siteRules || BUILTIN_RULES);
    if (overwrite || d.applications) await set(KEYS.APPLICATIONS, d.applications || []);
    if (overwrite || d.reminders) await set(KEYS.REMINDERS, d.reminders || []);
    if (overwrite || d.statusFlow) await set(KEYS.STATUS_FLOW, d.statusFlow || DEFAULT_STATUS_FLOW);
    if (overwrite || d.siteMemories) await set(KEYS.SITE_MEMORIES, d.siteMemories || {});
    if (overwrite || d.quiz) await set(KEYS.QUIZ, d.quiz || []);
  }
  async function clearAll() {
    await chrome.storage.local.clear();
  }

  AS.storage = {
    KEYS, DEFAULT_SETTINGS, DEFAULT_STATUS_FLOW, BUILTIN_RULES,
    get, set,
    getSettings, saveSettings,
    getProfiles, saveProfiles, getProfile, getActiveProfile, saveProfile, deleteProfile,
    getSiteRules, saveSiteRules, getSiteRuleForHost,
    getApplications, saveApplications, getApplication, upsertApplication, removeApplications, bulkUpdate,
    getStatusFlow, saveStatusFlow,
    getReminders, saveReminders,
    setReusePayload, getReusePayload, clearReusePayload,
    getSiteMemories, saveSiteMemories, getMemoriesForHost, addMemory, clearMemoriesForHost, countMemories,
    appendLog, getLogs, clearLogs,
    getQuiz, saveQuiz, addQuizItem,
    exportAll, importAll, clearAll,
  };
})();
