/**
 * options.js — 配置页入口与路由
 */
(function () {
  'use strict';
  const AS = window.AS;

  const VIEWS = ['profile', 'resume', 'applications', 'questions', 'rules', 'stats', 'settings'];

  const TITLES = {
    profile: ['信息库', '提前录入全量网申个人信息, 支持多方案切换与 JSON 备份'],
    resume: ['简历导入', '上传 PDF / DOCX 简历, 本地解析提取结构化信息, 预览校正后入库'],
    applications: ['投递台账', '记录每一次网申投递, 全流程进度追踪与复盘'],
    questions: ['开放题库', '存储网申常见开放性问题答案, 支持按公司沉淀面经'],
    rules: ['站点规则', '站点表单字段映射, 针对小众网申系统手动适配'],
    stats: ['统计看板', '投递数据复盘: 核心指标、渠道分布、时间趋势、败因分析'],
    settings: ['设置', '填充策略、敏感数据加密、数据备份与恢复'],
  };

  function parseHash() {
    const h = (location.hash || '#/profile').slice(1);
    const [path, queryStr] = h.split('?');
    const name = (path || 'profile').replace(/^\//, '');
    const query = {};
    if (queryStr) {
      queryStr.split('&').forEach((kv) => {
        const [k, v] = kv.split('=');
        if (k) query[k] = decodeURIComponent(v || '');
      });
    }
    return { name: VIEWS.includes(name) ? name : 'profile', query };
  }

  async function route() {
    const { name, query } = parseHash();
    const view = document.getElementById('view');
    view.innerHTML = '';
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === name));

    const title = document.createElement('div');
    title.className = 'view-title';
    title.textContent = TITLES[name][0];
    const sub = document.createElement('div');
    sub.className = 'view-sub';
    sub.textContent = TITLES[name][1];
    view.appendChild(title);
    view.appendChild(sub);

    const fn = AS.views[name];
    if (fn) {
      try {
        await fn(view, query);
      } catch (e) {
        AS.logger.error('options', 'view render failed', name, e);
        const d = document.createElement('div');
        d.className = 'empty';
        d.innerHTML = `<b>视图渲染失败</b>${e.message}<br><button class="btn" onclick="location.reload()">重新加载</button>`;
        view.appendChild(d);
      }
    }
  }

  AS.optionsUI = {
    route,
    toast(msg, type, ms) {
      const t = document.createElement('div');
      t.className = 'toast-msg ' + (type || '');
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), ms || 2600);
    },
    el(tag, attrs, children) {
      const el = document.createElement(tag);
      Object.entries(attrs || {}).forEach(([k, v]) => {
        if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v);
      });
      (children || []).forEach((c) => { if (c !== null && c !== undefined) el.appendChild(c); });
      return el;
    },
  };

  window.addEventListener('hashchange', route);
  document.getElementById('verLabel').textContent = 'v' + chrome.runtime.getManifest().version;

  // 后台广播(填充结果等)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'AF_FILL_SUMMARY') {
      // 配置页打开时提示填充结果
    }
  });

  route();
})();
