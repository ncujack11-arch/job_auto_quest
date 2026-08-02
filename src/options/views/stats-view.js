/**
 * stats-view.js — 统计看板视图 (v1.2.0)
 * KPI 指标 / 通过率 / 多维分布 / 时间趋势 / 败因复盘
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  async function render(container) {
    container.innerHTML = '';
    const [records, statusFlow] = await Promise.all([
      AS.storage.getApplications(),
      AS.storage.getStatusFlow(),
    ]);
    if (!records.length) {
      container.appendChild(UI().el('div', { class: 'empty' }, [
        UI().el('b', { text: '暂无投递数据' }),
        UI().el('span', { text: '记录投递后这里将生成完整的秋招复盘看板' }),
      ]));
      return;
    }
    const s = AS.stats.compute(records, statusFlow);

    // KPI
    const kpiGrid = UI().el('div', { class: 'kpi-grid' });
    const kpis = [
      ['总投递数', s.total, 'k-blue'], ['在流程中', s.inProcess, 'k-purple'],
      ['笔试', s.written, 'k-blue'], ['面试', s.interviews, 'k-amber'],
      ['Offer', s.offers, 'k-green'], ['拒信/终止', s.rejects + s.terminated, 'k-red'],
    ];
    kpis.forEach(([label, val, cls]) => {
      const k = UI().el('div', { class: 'kpi ' + cls });
      k.appendChild(UI().el('span', { text: label }));
      k.appendChild(UI().el('b', { text: String(val) }));
      kpiGrid.appendChild(k);
    });
    container.appendChild(kpiGrid);

    // 通过率
    const rateCard = UI().el('div', { class: 'card' });
    rateCard.appendChild(UI().el('h3', { text: '漏斗转化率' }));
    const rateRow = UI().el('div', { style: 'display:flex;gap:28px;flex-wrap:wrap;font-size:13px' });
    const rate = (label, pct, a, b) => UI().el('div', {}, [
      UI().el('span', { text: label + ': ' }),
      UI().el('b', { style: 'font-size:18px;color:#2563eb', text: pct + '%' }),
      UI().el('span', { style: 'color:#9ca3af;font-size:12px', text: ` (${a}/${b})` }),
    ]);
    rateRow.appendChild(rate('网申通过率(进入笔试)', s.applyRate, s.written, s.total));
    rateRow.appendChild(rate('笔试通过率(进入面试)', s.writtenRate, s.interviews, s.written));
    rateRow.appendChild(rate('面试通过率(拿到Offer)', s.interviewRate, s.offers, s.interviews));
    rateCard.appendChild(rateRow);
    container.appendChild(rateCard);

    // 图表区
    const grid = UI().el('div', { class: 'charts-grid' });

    const chartStatus = UI().el('div', { class: 'chart-card' });
    chartStatus.appendChild(UI().el('h4', { text: '进度状态分布' }));
    chartStatus.appendChild(UI().el('canvas', { height: '220' }));
    grid.appendChild(chartStatus);

    const chartChannel = UI().el('div', { class: 'chart-card' });
    chartChannel.appendChild(UI().el('h4', { text: '投递渠道分布(含渠道数)' }));
    chartChannel.appendChild(UI().el('canvas', { height: '220' }));
    grid.appendChild(chartChannel);

    const chartCategory = UI().el('div', { class: 'chart-card' });
    chartCategory.appendChild(UI().el('h4', { text: '岗位类别分布' }));
    chartCategory.appendChild(UI().el('canvas', { height: '220' }));
    grid.appendChild(chartCategory);

    const chartTrend = UI().el('div', { class: 'chart-card' });
    chartTrend.appendChild(UI().el('h4', { text: '近 30 天投递趋势' }));
    chartTrend.appendChild(UI().el('canvas', { height: '220' }));
    grid.appendChild(chartTrend);

    const chartFail = UI().el('div', { class: 'chart-card' });
    chartFail.appendChild(UI().el('h4', { text: '败因复盘 — 流程终止环节分布' }));
    chartFail.appendChild(UI().el('canvas', { height: '220' }));
    grid.appendChild(chartFail);

    const chartIndustry = UI().el('div', { class: 'chart-card' });
    chartIndustry.appendChild(UI().el('h4', { text: '公司行业分布' }));
    chartIndustry.appendChild(UI().el('canvas', { height: '220' }));
    grid.appendChild(chartIndustry);

    const chartSalary = UI().el('div', { class: 'chart-card' });
    chartSalary.appendChild(UI().el('h4', { text: '薪资分布(岗位待遇)' }));
    chartSalary.appendChild(UI().el('canvas', { height: '220' }));
    grid.appendChild(chartSalary);

    container.appendChild(grid);

    // 时间线视图
    const tlCard = UI().el('div', { class: 'card', style: 'margin-top:16px' });
    tlCard.appendChild(UI().el('h3', { text: '🗓 秋招时间线(全部投递/笔试/面试节点)' }));
    const tlWrap = UI().el('div', { style: 'margin-top:10px' });
    const TYPE_COLOR = { '投递': '#2563eb', '笔试通知': '#d97706', '笔试': '#d97706', '一面': '#0891b2', '二面': '#0891b2', '终面': '#0891b2', 'HR面': '#7c3aed', 'OC': '#16a34a', 'Offer': '#16a34a', '拒信': '#dc2626', '状态变更': '#64748b' };
    const fmt = (ts) => {
      const d = new Date(ts);
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    s.timeline.forEach((e) => {
      const row = UI().el('div', { style: 'display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f8fafc;font-size:13px' });
      row.appendChild(UI().el('span', { style: 'width:110px;color:#6b7280;font-size:12px;flex-shrink:0', text: fmt(e.time) }));
      row.appendChild(UI().el('span', { class: 'pill', style: 'width:80px;flex-shrink:0;background:#f1f5f9;color:' + (TYPE_COLOR[e.type] || '#475569'), text: e.type }));
      row.appendChild(UI().el('span', { style: 'flex:1;color:#374151', text: `${e.company || ''} ${e.position || ''}${e.note ? ' — ' + e.note : ''}` }));
      row.appendChild(UI().el('button', {
        class: 'link-btn', text: '查看', onclick: () => {
          location.hash = '#/applications?focus=' + e.appId;
        },
      }));
      tlWrap.appendChild(row);
    });
    if (!s.timeline.length) tlWrap.appendChild(UI().el('div', { style: 'color:#9ca3af;font-size:13px;padding:10px', text: '暂无节点, 记录投递后自动生成' }));
    tlCard.appendChild(tlWrap);
    container.appendChild(tlCard);

    // 渲染图表(下一帧等布局完成)
    requestAnimationFrame(() => {
      try {
        const statusData = {
          labels: Object.keys(s.byStatus),
          values: Object.values(s.byStatus),
        };
        AS.charts.drawDonut(chartStatus.querySelector('canvas'), statusData);

        const chData = { labels: s.byChannel.map(([k]) => k), values: s.byChannel.map(([, v]) => v) };
        AS.charts.drawBars(chartChannel.querySelector('canvas'), Object.assign({ horizontal: true }, chData));

        const catData = { labels: s.byCategory.map(([k]) => k), values: s.byCategory.map(([, v]) => v) };
        AS.charts.drawBars(chartCategory.querySelector('canvas'), Object.assign({}, catData));

        AS.charts.drawLine(chartTrend.querySelector('canvas'), {
          labels: s.trendDaily.map((d) => d.label),
          values: s.trendDaily.map((d) => d.count),
        });

        const failData = { labels: s.failureStages.map(([k]) => k), values: s.failureStages.map(([, v]) => v) };
        AS.charts.drawBars(chartFail.querySelector('canvas'), Object.assign({ horizontal: true, colors: ['#dc2626', '#d97706', '#db2777', '#7c3aed', '#2563eb', '#0891b2'] }, failData));

        const indData = { labels: s.byIndustry.map(([k]) => k), values: s.byIndustry.map(([, v]) => v) };
        AS.charts.drawBars(chartIndustry.querySelector('canvas'), Object.assign({ horizontal: true }, indData));

        const salData = { labels: s.salaryDist.map(([k]) => k), values: s.salaryDist.map(([, v]) => v) };
        AS.charts.drawBars(chartSalary.querySelector('canvas'), Object.assign({ colors: ['#dc2626', '#d97706', '#16a34a', '#2563eb', '#9ca3af'] }, salData));
      } catch (e) {
        AS.logger.error('stats', 'chart render failed', e);
      }
    });

    // 结论提示
    const insight = UI().el('div', { class: 'card', style: 'margin-top:16px' });
    insight.appendChild(UI().el('h3', { text: '💡 数据洞察' }));
    const topChannel = s.byChannel[0];
    const topCategory = s.byCategory[0];
    const topFail = s.failureStages[0];
    const lines = [
      `最高效渠道: ${topChannel ? topChannel[0] + ' (' + topChannel[1] + ' 次投递)' : '暂无数据'}`,
      `最高效岗位方向: ${topCategory ? topCategory[0] + ' (' + topCategory[1] + ' 次)' : '暂无数据'}`,
      `最常终止环节: ${topFail ? topFail[0] + ' (' + topFail[1] + ' 次)' : '暂无数据'}`,
      `当前 Offer 转化: ${s.interviewRate}%(面试${s.interviews} → Offer ${s.offers})`,
    ];
    lines.forEach((l) => insight.appendChild(UI().el('div', { style: 'font-size:13px;line-height:2', text: '· ' + l })));
    container.appendChild(insight);
  }

  AS.views = AS.views || {};
  AS.views.stats = render;
})();
