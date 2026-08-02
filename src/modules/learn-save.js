/**
 * learn-save.js — 捕获入库核心逻辑(共享: 后台消息 + E2E 实操测试)
 * 快照回滚 / 经历合并 / 自学习 / 溯源 / 历史
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.learnSave) return;

  // items: [{type, fieldKey, key, pageValue, state, confidence, label, selector, module, rowGroup, targetCat, question, answer}]
  // opts: { force, sourceHost }
  // 返回 { saved, updated, added, same, locked, skipped }
  async function save(profile, items, opts) {
    const o = opts || {};
    const d = profile.data;
    const settings = await AS.storage.getSettings();
    let saved = 0, updated = 0, added = 0, same = 0, locked = 0, skipped = 0;
    const learnedMemories = [];
    const learnedAliases = [];
    const sourceHost = o.sourceHost || '';

    // 经历条目: 按 (catId, rowGroup) 分组合成 entry
    const entryGroups = new Map();
    const flatItems = [];
    for (const it of (items || [])) {
      if (it && it.type === 'entry') {
        const catId = String(it.fieldKey || '').replace(/\[\d+\]/g, '').split('.')[0];
        const gkey = catId + '|' + (it.rowGroup || 0);
        if (!entryGroups.has(gkey)) entryGroups.set(gkey, []);
        entryGroups.get(gkey).push(it);
      } else {
        flatItems.push(it);
      }
    }
    const mergeEntry = (catId, groupItems) => {
      const cat = AS.schema.findCategory(catId);
      if (!cat) return 0;
      // 组内全部一致且非强制 → 跳过
      if (!o.force && groupItems.every((g) => g.state === 'same')) return 0;
      const arr = d[catId] || (d[catId] = []);
      const entry = {};
      let anyValue = false;
      groupItems.forEach((it) => {
        const key = String(it.fieldKey || '').replace(/\[\d+\]/g, '').split('.')[1];
        if (key && it.pageValue) {
          entry[key] = String(it.pageValue).trim();
          anyValue = true;
        }
      });
      if (!anyValue) return 0;
      const nameKey = catId === 'education' ? 'school' : catId === 'internship' ? 'intCompany' : 'projName';
      const timeKey = catId === 'education' ? 'eduStart' : catId === 'internship' ? 'intStart' : 'projDuration';
      const exist = arr.find((e) => e[nameKey] && e[nameKey] === entry[nameKey] && (entry[timeKey] ? e[timeKey] === entry[timeKey] : true));
      if (exist) {
        Object.assign(exist, entry);
        updated++;
      } else {
        arr.push(entry);
        added++;
      }
      saved++;
      return 1;
    };
    entryGroups.forEach((g, gkey) => {
      mergeEntry(gkey.split('|')[0], g);
    });

    for (const it of flatItems) {
      if (!it || it.pageValue === undefined || it.pageValue === null || String(it.pageValue).trim() === '') { skipped++; continue; }
      // 一致项默认不写(除非 force)
      if (it.state === 'same' && !o.force) { same++; continue; }
      if (it.type === 'openQuestions') {
        d.openQuestions = d.openQuestions || [];
        const dup = d.openQuestions.some((q) => q.question === it.question && q.answer === it.answer);
        if (!dup) { d.openQuestions.push({ question: it.question || '开放题', answer: String(it.pageValue).trim() }); added++; saved++; }
        else same++;
        continue;
      }
      if (it.type === 'custom') {
        // 归属到指定分类(面板新增项可选归属 basic/skills/intent)
        if (it.targetCat && ['basic', 'skills', 'intent'].includes(it.targetCat)) {
          if (d[it.targetCat] === undefined) d[it.targetCat] = {};
          if (d[it.targetCat][it.key] !== String(it.pageValue).trim()) {
            d[it.targetCat][it.key] = String(it.pageValue).trim();
            updated++; saved++;
          } else same++;
          continue;
        }
        d.custom = d.custom || [];
        const exist = d.custom.find((c) => c.key === it.key);
        if (exist) {
          if (String(exist.value) !== String(it.pageValue).trim()) {
            exist.value = String(it.pageValue).trim();
            exist.label = exist.label || it.label;
            exist._sourceDomain = sourceHost || exist._sourceDomain || '';
            exist._capturedAt = Date.now();
            exist._confidence = it.confidence;
            updated++;
          } else same++;
        } else {
          d.custom.push({ key: it.key || 'f' + Date.now().toString(36), label: it.label || '自定义', value: String(it.pageValue).trim(), _sourceDomain: sourceHost, _capturedAt: Date.now(), _confidence: it.confidence });
          added++;
        }
        saved++;
        continue;
      }
      const base = String(it.fieldKey || '').replace(/\[\d+\]/g, '');
      const [catId, key] = base.split('.');
      const cat = AS.schema.findCategory(catId);
      if (!cat || !key || cat.repeatable) { skipped++; continue; }
      if (d[catId] === undefined || d[catId] === null) d[catId] = {};
      let val = String(it.pageValue).trim();
      const def = AS.schema.getFieldDef(base);
      if (def && def.sensitive && settings.encryption && settings.encryption.enabled) {
        if (AS.encrypt.hasKey()) {
          try { val = await AS.encrypt.encryptWithSession(val); } catch (e) { /* ignore */ }
        } else { locked++; continue; }
      }
      if (d[catId][key] !== val) { d[catId][key] = val; updated++; saved++; }
      else same++;
      // 自学习: 选择器记忆 + 标签别名
      if (it.selector && it.fieldKey && !it.fieldKey.startsWith('reuse.')) {
        learnedMemories.push({ sel: it.selector, fieldKey: it.fieldKey });
      }
      if (it.label && it.fieldKey && it.level !== 'fallback') {
        learnedAliases.push({ fieldKey: it.fieldKey, label: it.label });
      }
    }
    if (saved) { profile.updatedAt = Date.now(); await AS.storage.saveProfile(profile); }
    // 自学习落库
    try {
      for (const m of learnedMemories.slice(0, 15)) await AS.storage.addMemory(sourceHost, m.sel, m.fieldKey);
      for (const a of learnedAliases.slice(0, 15)) await AS.storage.addUserAlias(a.fieldKey, a.label);
    } catch (e) { /* 自学习失败不影响入库 */ }
    // 捕获历史
    try {
      await AS.storage.addCaptureHistory({
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        time: Date.now(), host: sourceHost,
        stats: { saved, updated, added, same, locked, skipped },
        snapshot: await AS.storage.exportAll(),
        items: (items || []).map((it) => ({
          fieldKey: it.fieldKey, label: it.label, pageValue: it.pageValue, state: it.state, confidence: it.confidence,
        })).slice(0, 50),
      });
    } catch (e) { /* ignore */ }
    return { saved, updated, added, same, locked, skipped };
  }

  // 带快照回滚的入口(失败自动恢复)
  async function saveWithRollback(profile, items, opts) {
    let snapshot = null;
    try { snapshot = await AS.storage.exportAll(); } catch (e) { /* ignore */ }
    try {
      return await save(profile, items, opts);
    } catch (e) {
      // 失败回滚
      if (snapshot) {
        try { await AS.storage.importAll(snapshot, { overwrite: true }); } catch (e2) { /* ignore */ }
      }
      throw e;
    }
  }

  AS.learnSave = { save, saveWithRollback };
})();
