/**
 * quiz.js — 笔试题库自动识别(本地题库, 零联网)
 * 周期扫描页面候选题目文本, 与本地题库模糊匹配, 命中后展示答案卡片
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.quizScan) return;

  const LOG = () => AS.logger;
  const SHOWN_LIMIT = 20; // 每会话最多提示条数, 防打扰

  let timer = null;
  let shownCount = 0;

  function buildCard(question, answer) {
    // 复用 overlay: 在 shadow 中插入答案卡片(用 toast 升级版)
    AS.overlay.toast(`📝 题库命中: ${question}\n答: ${answer}`, 20000);
  }

  async function scanOnce() {
    if (window.top !== window) return;
    if (shownCount >= SHOWN_LIMIT) { stop(); return; }
    let quiz;
    try {
      quiz = await AS.storage.getQuiz();
    } catch (e) { return; }
    if (!quiz || !quiz.length) return;

    // 收集候选文本(常见题干容器, 限制数量控制开销)
    const candidates = [];
    try {
      const els = document.querySelectorAll('div,li,td,p,h3,h4,span,label');
      for (const el of els) {
        const t = (el.textContent || '').trim();
        if (t.length < 6 || t.length > 150) continue;
        if (el.children && el.children.length > 2) continue;
        if (/^(function|var |const |let |http)/.test(t)) continue;
        candidates.push(t);
        if (candidates.length >= 60) break;
      }
    } catch (e) { /* ignore */ }

    const fz = AS.fuzzy;
    for (const q of quiz) {
      const nq = fz.normalize(q.question);
      if (!nq || nq.length < 4) continue;
      for (const c of candidates) {
        const nc = fz.normalize(c);
        if (!nc) continue;
        let hit = false;
        if (nc.includes(nq) || nq.includes(nc)) hit = true;
        else if (nq.length >= 8 && fz.similarity(nc, nq) > 0.74) hit = true;
        if (hit) {
          shownCount++;
          LOG().info('quiz', 'hit', q.question);
          buildCard(q.question.slice(0, 60), q.answer.slice(0, 200));
          break;
        }
      }
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(scanOnce, 6000);
    setTimeout(scanOnce, 2500);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  start();
  AS.quizScan = true;
})();
