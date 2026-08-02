/**
 * charts.js — 轻量本地 Canvas 图表(零依赖)
 * 支持: 环形图 / 柱状图 / 折线图
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.charts) return;

  const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#9333ea', '#475569'];

  function setup(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  function colorAt(i, colors) {
    return (colors && colors[i]) || PALETTE[i % PALETTE.length];
  }

  // 环形图(带图例)
  function drawDonut(canvas, { labels, values, colors }) {
    const total = values.reduce((a, b) => a + b, 0);
    const W = canvas.clientWidth || 320;
    const H = canvas.clientHeight || 220;
    const ctx = setup(canvas, W, H);
    const cx = W * 0.32, cy = H / 2, R = Math.min(W, H) / 2 - 14, r = R * 0.62;
    if (!total) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', cx, cy);
      return;
    }
    let start = -Math.PI / 2;
    const legendX = W * 0.62;
    values.forEach((v, i) => {
      const angle = (v / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, start, start + angle);
      ctx.closePath();
      ctx.fillStyle = colorAt(i, colors);
      ctx.fill();
      start += angle;
      // 图例
      const ly = 24 + i * 22;
      ctx.fillStyle = colorAt(i, colors);
      ctx.fillRect(legendX, ly - 9, 12, 12);
      ctx.fillStyle = '#374151';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      const pct = total ? Math.round((v / total) * 100) : 0;
      ctx.fillText(`${labels[i]}  ${v} (${pct}%)`, legendX + 18, ly);
      if (ly > H - 10 && i < values.length - 1) { /* 忽略超出 */ }
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(total), cx, cy - 4);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText('总数', cx, cy + 14);
  }

  // 柱状图
  function drawBars(canvas, { labels, values, colors, horizontal }) {
    const W = canvas.clientWidth || 320;
    const H = canvas.clientHeight || 220;
    const ctx = setup(canvas, W, H);
    const padL = 34, padR = 10, padT = 16, padB = 30;
    if (!values.length) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2);
      return;
    }
    const max = Math.max(...values, 1);
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#6b7280';
    // Y 轴刻度
    for (let i = 0; i <= 4; i++) {
      const y = padT + ((H - padT - padB) / 4) * i;
      const val = Math.round(max * (1 - i / 4));
      ctx.textAlign = 'right';
      ctx.fillText(String(val), padL - 6, y + 3);
      ctx.strokeStyle = '#f1f5f9';
      ctx.beginPath();
      ctx.moveTo(padL, y + 0.5);
      ctx.lineTo(W - padR, y + 0.5);
      ctx.stroke();
    }
    if (horizontal) {
      const bw = Math.min(26, (H - padT - padB) / values.length - 6);
      values.forEach((v, i) => {
        const y = padT + (H - padT - padB) / values.length * i + 3;
        const barW = ((W - padL - padR - 40) * v) / max;
        ctx.fillStyle = colorAt(i, colors);
        ctx.fillRect(padL, y, Math.max(barW, 1), bw);
        ctx.fillStyle = '#374151';
        ctx.textAlign = 'left';
        ctx.font = '11px sans-serif';
        ctx.fillText(`${labels[i]} ${v}`, padL + barW + 6, y + bw / 2 + 4);
      });
    } else {
      const bw = Math.min(40, ((W - padL - padR) / values.length) * 0.55);
      const gap = (W - padL - padR) / values.length;
      values.forEach((v, i) => {
        const x = padL + gap * i + (gap - bw) / 2;
        const bh = ((H - padT - padB) * v) / max;
        ctx.fillStyle = colorAt(i, colors);
        ctx.fillRect(x, H - padB - bh, bw, bh);
        ctx.fillStyle = '#6b7280';
        ctx.textAlign = 'center';
        ctx.font = '10px sans-serif';
        const label = labels[i].length > 8 ? labels[i].slice(0, 7) + '…' : labels[i];
        ctx.fillText(label, x + bw / 2, H - padB + 14);
      });
    }
  }

  // 折线图
  function drawLine(canvas, { labels, values, colors }) {
    const W = canvas.clientWidth || 320;
    const H = canvas.clientHeight || 220;
    const ctx = setup(canvas, W, H);
    const padL = 34, padR = 10, padT = 16, padB = 28;
    if (!values.length) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无数据', W / 2, H / 2);
      return;
    }
    const max = Math.max(...values, 1);
    const cw = W - padL - padR, ch = H - padT - padB;
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#6b7280';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (ch / 4) * i;
      ctx.textAlign = 'right';
      ctx.fillText(String(Math.round(max * (1 - i / 4))), padL - 6, y + 3);
      ctx.strokeStyle = '#f1f5f9';
      ctx.beginPath();
      ctx.moveTo(padL, y + 0.5);
      ctx.lineTo(W - padR, y + 0.5);
      ctx.stroke();
    }
    const color = (colors && colors[0]) || '#2563eb';
    const step = values.length > 1 ? cw / (values.length - 1) : cw;
    const pts = values.map((v, i) => [padL + step * i, padT + ch - (ch * v) / max]);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); });
    ctx.stroke();
    // 填充渐变
    const grad = ctx.createLinearGradient(0, padT, 0, padT + ch);
    grad.addColorStop(0, color + '44');
    grad.addColorStop(1, color + '00');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], padT + ch);
    pts.forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.lineTo(pts[pts.length - 1][0], padT + ch);
    ctx.closePath();
    ctx.fill();
    // 点与标签
    const labelStep = Math.max(1, Math.ceil(values.length / 14));
    pts.forEach((p, i) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2);
      ctx.fill();
      if (i % labelStep === 0) {
        ctx.fillStyle = '#9ca3af';
        ctx.textAlign = 'center';
        ctx.font = '9.5px sans-serif';
        ctx.fillText(labels[i], p[0], H - padB + 12);
      }
    });
  }

  AS.charts = { drawDonut, drawBars, drawLine };
})();
