/**
 * fill-engine.js — 填充引擎(共享: 内容脚本 + E2E 实操测试)
 * buildPlan(字段→计划) + executePlan(计划→填充, 含级联/动态行重试/生效校验)
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.fillEngine) return;

  // ---------- 匹配计划构建 ----------
  // 返回 { items: [{field, fieldKey, value, label, ctx, sel}], valueQueues, seenFields, unmatchedFields }
  // order: { catId: [entryIndex...] } 经历素材选择顺序; refCodes: 内推码库
  function buildPlan(fields, profile, rule, memories, reuseActive, sections, valueQueues, order, refCodes, host) {
    const items = [];
    const seenFields = new Set();
    const getValues = (fieldKey) => {
      const key = fieldKey.replace(/\[\d+\]/g, '');
      if (!valueQueues.has(key)) {
        let vals = AS.matcher.resolveValues(profile, fieldKey);
        const catId = key.split('.')[0];
        if (order && order[catId] && Array.isArray(order[catId])) {
          vals = order[catId].map((idx) => vals[idx]).filter((v) => v !== undefined && v !== null && v !== '');
        }
        valueQueues.set(key, vals);
      }
      return valueQueues.get(key);
    };
    const catAllowed = (fieldKey) => {
      if (!sections || !sections.length) return true;
      const catId = fieldKey.replace(/\[\d+\]/g, '').split('.')[0];
      return sections.includes(catId);
    };
    const matchRefCode = (list, h) => {
      const hh = String(h || '').toLowerCase();
      const hit = (list || []).find((r) => r && r.host && hh === r.host.toLowerCase());
      return hit ? hit.code : '';
    };
    const unmatchedFields = [];

    for (const field of fields) {
      if (seenFields.has(field.el)) continue;
      seenFields.add(field.el);
      const ctx = AS.matcher.buildContext(field.el);
      if (!ctx.visible) continue;
      // 国际区号/前缀框(如 +86): 无 placeholder 且前文本是纯数字区号 → 跳过
      if (!ctx.placeholder && /^\+?\d{1,4}$/.test((ctx.prevText || '').trim())) continue;

      let fieldKey = null;
      let value = null;

      // 0) 内推码
      if (!fieldKey && /(内推码|内推|推荐码|推荐人|referral|邀请码)/i.test(ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name)) {
        const code = matchRefCode(refCodes, host);
        if (code) { fieldKey = 'refCode'; value = code; }
      }
      // 1) 选择器记忆
      if (!fieldKey) {
        const sel = AS.matcher.genSelector(field.el);
        if (memories && sel && memories[sel]) {
          const memKey = memories[sel];
          const vals = getValues(memKey);
          if (vals.length) { fieldKey = memKey; value = vals.shift(); }
        }
      }
      // 2) 复用投递
      if (!fieldKey && reuseActive) {
        if (AS.fuzzy.containsAny(ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name + ' ' + ctx.id, ['公司名称', '公司', '单位名称', 'employer', 'company', 'organization'])) {
          fieldKey = 'reuse.company';
          value = reuseActive.company;
        } else if (AS.fuzzy.containsAny(ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name + ' ' + ctx.id, ['岗位', '职位', '应聘', 'position', 'job title', 'post'])) {
          fieldKey = 'reuse.position';
          value = reuseActive.position;
        }
      }
      // 3) 开放性问题
      if (!fieldKey && AS.matcher.isOpenQuestionField(ctx)) {
        const answer = AS.matcher.resolveOpenQuestion(profile, ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name);
        if (answer !== null) { fieldKey = 'openQuestions'; value = answer; }
      }
      // 4) 站点映射 / 关键词匹配
      if (!fieldKey) {
        const m = AS.matcher.matchField(ctx, rule);
        if (m) {
          fieldKey = m.fieldKey;
          const vals = getValues(m.fieldKey);
          if (!vals.length && AS.matcher.isOpenQuestionField(ctx)) {
            const answer = AS.matcher.resolveOpenQuestion(profile, ctx.labelText + ' ' + ctx.placeholder);
            if (answer !== null) { fieldKey = 'openQuestions'; value = answer; }
          } else if (vals.length) {
            value = vals.shift();
          } else {
            fieldKey = null;
          }
        }
      }
      // 5) 自定义字段匹配
      if (!fieldKey) {
        const cm = AS.matcher.matchCustomField(ctx, profile);
        if (cm) {
          const vals = getValues(cm.fieldKey);
          if (vals.length) { fieldKey = cm.fieldKey; value = vals.shift(); }
        }
      }

      if (!fieldKey || value === null || value === undefined) {
        unmatchedFields.push({
          signature: ctx.name || ctx.id || ctx.labelText || ctx.placeholder || '未知字段',
          label: ctx.labelText || ctx.placeholder || ctx.name || '未知字段',
          reason: !fieldKey ? '未匹配到信息库字段' : '信息库无对应值',
          el: field.el,
        });
        continue;
      }
      if (!catAllowed(fieldKey)) continue;
      const label = ctx.labelText || ctx.placeholder || ctx.name || ctx.id || '未知字段';
      items.push({ field, fieldKey, value, label, ctx, sel: AS.matcher.genSelector(field.el) });
    }
    return { items, valueQueues, seenFields, unmatchedFields };
  }

  // ---------- 执行填充计划 ----------
  // ctx: { report, snapshot(field), highlight(el,kind), showProgress(d,t), closeProgress(),
  //        setFillState(stage,detail), flushMemories(queue), sleep(ms) }
  // 返回 { snapshots, unmatchedEls }
  async function executePlan(plan, selectedSet, opts, ctx) {
    const h = ctx || {};
    const report = h.report || { filled: 0, skipped: 0, unmatched: 0, errors: 0, infos: [], unmatchedItems: [] };
    const sleep = h.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const highlight = h.highlight || (() => {});
    const setFillState = h.setFillState || (() => {});
    const snapshotField = h.snapshot || (() => null);
    const showProgress = h.showProgress || (() => {});
    const closeProgress = h.closeProgress || (() => {});
    const flushMemories = h.flushMemories || (() => {});

    const snapshots = [];
    const items = selectedSet ? plan.items.filter((_, i) => selectedSet.has(i)) : plan.items;
    const memoriesQueue = [];
    const unmatchedEls = [];
    let done = 0;
    const total = items.length;
    if (total > 3) showProgress(0, total, '正在填充');
    // 级联选择器状态: 相同字段的连续下拉(如 籍贯: 省→市→县 / 日期年/月)依次用值的分段
    let cascadeState = null;

    const memPush = (sel, fieldKey) => {
      if (sel && fieldKey && !fieldKey.startsWith('reuse.') && fieldKey !== 'openQuestions') {
        memoriesQueue.push({ sel, fieldKey });
      }
    };

    for (const item of items) {
      report.total = (report.total || 0) + 1;
      done++;
      const { field, fieldKey, value: origValue, label, ctx: fctx, sel } = item;
      if (total > 3 && done % 2 === 0) showProgress(done, total, '正在填充');
      setFillState('filling', `正在填充 ${done}/${total}: ${label || fieldKey || '字段'}`);
      if (!fctx.visible) continue;
      const snap = snapshotField(field);
      if (snap) snapshots.push(snap);

      // 文件框: 区分 简历文件 / 证件照
      if (field.type === 'file') {
        const ctxText = fctx.labelText + ' ' + fctx.placeholder + ' ' + (field.el.accept || '');
        if (/(简历|resume|cv)/i.test(ctxText) && /(pdf|doc)/i.test((field.el.accept || '') + ctxText)) {
          const ok = await AS.filler.fillResumeFile(field.el);
          if (ok) { report.filled++; highlight(field.el, 'af-highlight-ok'); }
          else { report.infos.push({ label, detail: '未配置简历文件, 请手动上传' }); }
          continue;
        }
        const r = await AS.filler.fillField(field, origValue, opts);
        if (r.ok && r.action === 'filled') { report.filled++; }
        else if (r.action === 'info') { report.infos.push({ label, detail: r.detail }); }
        continue;
      }

      // ---------- 级联选择器: 省市区多级 / 日期年月分列 ----------
      if (field.type === 'select') {
        // 1) 续段: 上一 select 为相同 key 且有剩余段 → 直接用下一段
        if (cascadeState && cascadeState.key === fieldKey && cascadeState.parts.length) {
          const seg = cascadeState.parts.shift();
          if (!cascadeState.parts.length) cascadeState = null;
          const rSeg = await AS.filler.fillField(field, seg, opts);
          if (rSeg.ok && rSeg.action === 'filled') {
            report.filled++;
            highlight(field.el, 'af-highlight-ok');
          } else if (rSeg.action === 'skipped') {
            report.skipped++;
          } else {
            report.unmatched++;
            report.unmatchedItems.push({ signature: fctx.name || fctx.id || label, label, reason: rSeg.detail || '未匹配' });
            unmatchedEls.push({ el: field.el, label });
          }
          continue;
        }
        if (cascadeState && cascadeState.key !== fieldKey) cascadeState = null;
        // 2) 先尝试完整值
        const rFull = await AS.filler.fillField(field, origValue, opts);
        if (rFull.ok && rFull.action === 'filled') {
          report.filled++;
          highlight(field.el, 'af-highlight-ok');
          memPush(sel, fieldKey);
          continue;
        }
        // 3) 完整值失败 → 拆段, 用第一段填当前 select, 剩余段留给同 key 的下一 select
        const parts = AS.dates.splitCascadeValue(origValue);
        if (parts.length > 1) {
          const first = parts.shift();
          let rFirst = await AS.filler.fillField(field, first, opts);
          if (!rFirst.ok && !cascadeState) {
            await sleep(500);
            rFirst = await AS.filler.fillField(field, first, opts);
          }
          if (rFirst.ok && rFirst.action === 'filled') {
            cascadeState = { key: fieldKey, parts };
            report.filled++;
            highlight(field.el, 'af-highlight-ok');
            memPush(sel, fieldKey);
            continue;
          }
        }
        // 4) 普通 select 失败: 等待联动选项加载后重试一次
        await sleep(400);
        const retry = await AS.filler.fillField(field, origValue, opts);
        if (retry.ok && retry.action === 'filled') {
          report.filled++;
          highlight(field.el, 'af-highlight-ok');
          memPush(sel, fieldKey);
          continue;
        }
        report.unmatched++;
        report.unmatchedItems.push({ signature: fctx.name || fctx.id || label, label, reason: rFull.detail || '未匹配' });
        unmatchedEls.push({ el: field.el, label });
        highlight(field.el, 'af-highlight');
        continue;
      }

      const r = await AS.filler.fillField(field, origValue, opts);
      if (r.ok && r.action === 'filled') {
        report.filled++;
        highlight(field.el, 'af-highlight-ok');
        memPush(sel, fieldKey);
        // 填充后生效校验: 文本类字段声明成功但值未真正写入 → 标记"未生效"
        if ((field.type === 'text' || field.type === 'textarea') && origValue && String(field.el.value) !== String(origValue)) {
          report.notEffective = (report.notEffective || 0) + 1;
          report.unmatchedItems.push({ signature: fctx.name || fctx.id || label, label, reason: '已填充但值未生效(框架限制)' });
          unmatchedEls.push({ el: field.el, label });
          highlight(field.el, 'af-highlight');
        }
      } else if (r.ok && r.action === 'skipped') {
        report.skipped++;
        highlight(field.el, 'af-highlight-skip');
      } else if (r.action === 'info') {
        report.infos.push({ label, detail: r.detail });
      } else if (r.action === 'error') {
        report.errors++;
        report.unmatchedItems.push({ signature: fctx.name || fctx.id || label, label, reason: r.detail || '填充失败' });
        unmatchedEls.push({ el: field.el, label });
        highlight(field.el, 'af-highlight');
      } else {
        report.unmatched++;
        report.unmatchedItems.push({ signature: fctx.name || fctx.id || label, label, reason: r.detail || '未匹配' });
        unmatchedEls.push({ el: field.el, label });
        highlight(field.el, 'af-highlight');
      }
    }

    // 批量写入选择器记忆(节流: 每轮最多 20 条)
    if (memoriesQueue.length) {
      await flushMemories(memoriesQueue.slice(0, 20));
    }

    if (total > 3) closeProgress();

    return { snapshots, unmatchedEls };
  }

  AS.fillEngine = { buildPlan, executePlan };
})();
