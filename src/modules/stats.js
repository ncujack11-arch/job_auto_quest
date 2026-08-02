/**
 * stats.js — 投递数据统计与秋招复盘指标计算
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.stats) return;

  const TERMINAL_STATUS = ['已回绝', '流程终止'];

  function compute(records, statusFlow) {
    const flow = statusFlow || AS.apps.DEFAULT_STATUS;
    const total = records.length;

    // 核心指标
    const offers = records.filter((r) => r.status === 'Offer').length;
    const rejects = records.filter((r) => r.status === '已回绝').length;
    const terminated = records.filter((r) => r.status === '流程终止').length;
    const inProcess = records.filter((r) => !TERMINAL_STATUS.includes(r.status) && r.status !== 'Offer').length;
    const written = records.filter((r) => r.status === '笔试中' || AS.apps.milestones(r).writtenAt).length;
    const interviews = records.filter((r) => (AS.apps.milestones(r).interviewCount || 0) > 0 || /面|OC|HR/.test(r.status)).length;

    // 分布
    const byStatus = {};
    flow.forEach((s) => { byStatus[s] = 0; });
    records.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

    const group = (keyFn) => {
      const m = {};
      records.forEach((r) => {
        const k = keyFn(r) || '未知';
        m[k] = (m[k] || 0) + 1;
      });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const byChannel = group((r) => r.channel);
    const byCategory = group((r) => r.category);
    const byIndustry = group((r) => r.industry || '其他');

    // 时间趋势(近 30 天)
    const trendDaily = (() => {
      const days = [];
      const now = new Date();
      const map = {};
      records.forEach((r) => {
        const t = (r.timeline || []).find((e) => e.type === '投递');
        const ts = t ? t.time : r.createdAt;
        const d = new Date(ts).toISOString().slice(0, 10);
        map[d] = (map[d] || 0) + 1;
      });
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
        days.push({ label: d.slice(5), count: map[d] || 0 });
      }
      return days;
    })();

    // 败因复盘: 流程终止的环节分布
    const failureStages = (() => {
      const m = {};
      records.forEach((r) => {
        if (r.status !== '流程终止') return;
        const events = (r.timeline || []).filter((e) => e.type !== '投递').sort((a, b) => a.time - b.time);
        const stage = events.length ? events[events.length - 1].type : '初筛';
        m[stage] = (m[stage] || 0) + 1;
      });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    })();

    // 薪资分布(解析 "15-25K" "20k-30k" "30K" "年薪30万" 等)
    const salaryDist = (() => {
      const buckets = { '10K以下': 0, '10-20K': 0, '20-30K': 0, '30K以上': 0, '未知': 0 };
      const parseK = (s) => {
        const t = String(s || '');
        let k = null;
        const m = t.match(/(\d+(?:\.\d+)?)\s*[Kk万]/);
        if (m) k = t.includes('万') ? parseFloat(m[1]) * 10 : parseFloat(m[1]);
        return k;
      };
      records.forEach((r) => {
        const k = parseK(r.salary);
        if (k === null) { buckets['未知']++; return; }
        if (k < 10) buckets['10K以下']++;
        else if (k < 20) buckets['10-20K']++;
        else if (k < 30) buckets['20-30K']++;
        else buckets['30K以上']++;
      });
      return Object.entries(buckets);
    })();

    // 时间线: 全部记录的事件按时间排序
    const timeline = (() => {
      const events = [];
      records.forEach((r) => {
        (r.timeline || []).forEach((e) => {
          if (!e.time) return;
          events.push({
            time: e.time,
            type: e.type || '事件',
            note: e.note || '',
            company: r.company,
            position: r.position,
            appId: r.id,
          });
        });
      });
      return events.sort((a, b) => a.time - b.time);
    })();

    return {
      total, offers, rejects, terminated, inProcess, written, interviews,
      applyRate: total ? Math.round((written / total) * 100) : 0,
      writtenRate: written ? Math.round((interviews / written) * 100) : 0,
      interviewRate: interviews ? Math.round((offers / interviews) * 100) : 0,
      byStatus, byChannel, byCategory, byIndustry, trendDaily, failureStages,
      salaryDist, timeline, records,
    };
  }

  AS.stats = { compute, TERMINAL_STATUS };
})();
