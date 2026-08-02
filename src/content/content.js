/**
 * content.js — 内容脚本入口
 * 负责: 表单扫描 + 匹配 + 填充编排、页面信息抓取、投递检测联动、加密解锁协调
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.contentMain) return;

  const LOG = () => AS.logger;

  const frameLabel = () => (window.top === window ? 'top' : 'iframe');

  // 递归查找方案中是否含加密值
  function hasEncryptedValue(profile) {
    if (!profile || !profile.data) return false;
    try {
      return JSON.stringify(profile.data).includes('"enc:v1:');
    } catch (e) { return false; }
  }

  async function ensureUnlocked() {
    const settings = await AS.storage.getSettings();
    if (!settings.encryption || !settings.encryption.enabled) return true;
    const r = await chrome.runtime.sendMessage({ type: 'AF_IS_UNLOCKED' });
    return !!(r && r.unlocked);
  }

  async function unlockFlow() {
    return new Promise((resolve) => {
      AS.overlay.showUnlockPrompt(() => resolve(true), () => resolve(false));
    });
  }

  // ---------- 核心填充流程 ----------
  async function doFill() {
    LOG().info('content', 'fill requested in', frameLabel(), frame());
    const t0 = Date.now();

    const [settings, profile, rule, reuse] = await Promise.all([
      AS.storage.getSettings(),
      AS.storage.getActiveProfile(),
      AS.storage.getSiteRuleForHost(location.hostname),
      AS.storage.getReusePayload(),
    ]);

    // 复用载荷: 仅当目标站点匹配时生效
    let reuseActive = null;
    if (reuse && reuse.url && reuse.url.indexOf(location.hostname) >= 0) {
      reuseActive = reuse;
      LOG().info('content', 'reuse payload active', reuse.company, reuse.position);
    }

    const report = { filled: 0, skipped: 0, unmatched: 0, errors: 0, total: 0, unmatchedItems: [], infos: [] };

    if (!profile) {
      AS.overlay.toast('信息库为空, 请先在配置页录入信息');
      chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: Object.assign(report, { noProfile: true }) }).catch(() => {});
      return;
    }

    // 加密检查
    if (hasEncryptedValue(profile)) {
      const unlocked = await ensureUnlocked();
      if (!unlocked) {
        const ok = await unlockFlow();
        if (!ok) {
          AS.overlay.toast('已取消: 敏感字段尚未解锁');
          chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: Object.assign(report, { cancelled: true }) }).catch(() => {});
          return;
        }
      }
    }

    const fields = AS.scanner.scan();
    const valueQueues = new Map(); // fieldKey -> [values...]
    const getValues = (fieldKey) => {
      if (!valueQueues.has(fieldKey)) valueQueues.set(fieldKey, AS.matcher.resolveValues(profile, fieldKey));
      return valueQueues.get(fieldKey);
    };

    const opts = {
      typing: !!settings.typingMode,
      typingMin: settings.typingMin || 30,
      typingMax: settings.typingMax || 120,
      conflictMode: settings.conflictMode || 'skip',
    };

    for (const field of fields) {
      report.total++;
      const ctx = AS.matcher.buildContext(field.el);
      if (!ctx.visible) continue;

      let fieldKey = null;
      let value = null;

      // 1) 复用投递: 公司/岗位强制使用历史投递信息
      if (reuseActive) {
        if (AS.fuzzy.containsAny(ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name + ' ' + ctx.id, ['公司名称', '公司', '单位名称', 'employer', 'company', 'organization'])) {
          fieldKey = 'reuse.company';
          value = reuseActive.company;
        } else if (AS.fuzzy.containsAny(ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name + ' ' + ctx.id, ['岗位', '职位', '应聘', 'position', 'job title', 'post'])) {
          fieldKey = 'reuse.position';
          value = reuseActive.position;
        }
      }
      // 2) 开放性问题
      if (!fieldKey && AS.matcher.isOpenQuestionField(ctx)) {
        const answer = AS.matcher.resolveOpenQuestion(profile, ctx.labelText + ' ' + ctx.placeholder + ' ' + ctx.name);
        if (answer !== null) { fieldKey = 'openQuestions'; value = answer; }
      }
      // 3) 站点映射 / 关键词匹配
      if (!fieldKey) {
        const m = AS.matcher.matchField(ctx, rule);
        if (m) {
          fieldKey = m.fieldKey;
          const vals = getValues(m.fieldKey);
          // 开放题类型字段回退: 匹配失败时尝试题库
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

      const label = ctx.labelText || ctx.placeholder || ctx.name || ctx.id || '未知字段';

      if (!fieldKey || value === null || value === undefined) {
        report.unmatched++;
        report.unmatchedItems.push({ signature: ctx.name || ctx.id || label, label, reason: '未匹配到信息库字段' });
        continue;
      }

      const r = await AS.filler.fillField(field, value, opts);
      if (r.ok && r.action === 'filled') { report.filled++; }
      else if (r.ok && r.action === 'skipped') { report.skipped++; }
      else if (r.action === 'info') { report.infos.push({ label, detail: r.detail }); }
      else if (r.action === 'error') {
        report.errors++;
        report.unmatchedItems.push({ signature: ctx.name || ctx.id || label, label, reason: r.detail || '填充失败' });
      } else {
        report.unmatched++;
        report.unmatchedItems.push({ signature: ctx.name || ctx.id || label, label, reason: r.detail || '未匹配' });
      }
    }

    const dur = Date.now() - t0;
    LOG().info('content', `fill done in ${frameLabel()}`, { filled: report.filled, unmatched: report.unmatched, took: dur + 'ms' });

    try {
      await chrome.runtime.sendMessage({ type: 'AF_FILL_DONE', payload: report });
    } catch (e) { LOG().warn('content', 'send fill done failed', e); }

    // 联动: 开启投递完成检测
    if (report.filled > 0 || report.skipped > 0) {
      setTimeout(() => AS.detect.arm(), 800);
    }
    // 复用载荷使用完毕即清除
    if (reuseActive) {
      AS.storage.clearReusePayload();
    }
  }

  // ---------- 页面信息抓取 ----------
  function grabPageInfo() {
    const doc = document;
    const title = doc.title || '';
    const hostname = location.hostname.replace(/^www\./, '');
    const meta = (name) => {
      const el = doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
      return el ? (el.content || '').trim() : '';
    };

    let company = meta('og:site_name') || meta('application-name') || '';
    let position = '';
    let city = '';
    let pending = false;

    // 公司: 标题模式 "公司-岗位" 或 "岗位-公司"
    const titleParts = title.split(/[-_|｜·]/).map((s) => s.trim()).filter(Boolean);
    if (!company && titleParts.length) {
      // 招聘标题常见: 岗位-公司
      const jobLike = /(工程师|开发|算法|数据|产品|运营|设计|销售|测试|实习|管培生|研究员|顾问|专员|经理|分析师|研发|技术|架构|实施|招聘|校招|秋招)/;
      const nonJob = titleParts.filter((p) => !jobLike.test(p) && p.length >= 2 && p.length <= 20);
      company = nonJob[0] || '';
    }
    if (!company) {
      const h1 = doc.querySelector('h1');
      if (h1 && h1.textContent.trim().length <= 30) company = h1.textContent.trim();
    }
    if (!company) {
      company = hostname.replace(/\.(com|cn|net|org|co|xyz|top|info|io|edu|site)$/i, '').replace(/\./g, ' ');
      pending = true;
    }

    // 岗位
    const jobLike = /(工程师|开发|算法|数据|产品|运营|设计|销售|测试|实习|管培生|研究员|顾问|专员|经理|分析师|研发|技术|架构|实施|招聘|开发工程师|后端|前端|客户端|算法工程师|运维)/;
    if (titleParts.length) {
      position = titleParts.find((p) => jobLike.test(p)) || '';
    }
    if (!position) {
      const h1 = doc.querySelector('h1');
      if (h1 && jobLike.test(h1.textContent)) position = h1.textContent.trim();
    }
    if (!position) {
      const h2s = Array.from(doc.querySelectorAll('h1,h2,h3'));
      position = (h2s.find((h) => jobLike.test(h.textContent) && h.textContent.trim().length <= 40) || {}).textContent || '';
    }
    if (!position) { pending = true; }

    // 城市
    const bodyText = (doc.body && doc.body.innerText) || '';
    const cityMatch = bodyText.match(/(?:工作地点|工作城市|城市|base|地点)\s*[:：]\s*([^\n\r,，。；;]{2,20})/);
    if (cityMatch) city = cityMatch[1].trim();
    if (!city) pending = true;

    // JD 快照
    let jd = '';
    const jdSelectors = ['#job-desc', '#jobDescription', '.job-desc', '.job-description', '.job-detail', '.job_detail', '.position-desc', '.position_detail', '.describtion', '.description', '[class*="job-desc"]', '[class*="job_detail"]', '[class*="position-desc"]'];
    for (const sel of jdSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent && el.textContent.trim().length > 30) { jd = el.textContent.trim(); break; }
    }
    if (!jd) {
      const marker = bodyText.indexOf('职位描述');
      if (marker >= 0) jd = bodyText.slice(marker, marker + 2500).trim();
      else if (bodyText.indexOf('岗位职责') >= 0) {
        const m2 = bodyText.indexOf('岗位职责');
        jd = bodyText.slice(m2, m2 + 2500).trim();
      }
    }
    if (jd.length > 4000) jd = jd.slice(0, 4000);

    // 渠道
    const ruleHost = hostname;
    const channel = title.includes('智联') ? '智联招聘' : title.includes('牛客') ? '牛客网' : title.includes('前程无忧') ? '前程无忧' : ruleHost;

    return {
      company: company.slice(0, 60),
      position: position.slice(0, 80),
      city: city.slice(0, 40),
      channel,
      url: location.href,
      title,
      jdSnapshot: jd,
      pending,
      siteName: ruleHost,
    };
  }

  // ---------- 消息路由 ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    LOG().debug('content', 'msg received', msg.type);
    switch (msg.type) {
      case 'AF_FILL':
        doFill();
        break;
      case 'AF_GRAB_INFO':
        sendResponse(grabPageInfo());
        break;
      case 'AF_SHOW_RECORD':
        if (window.top === window) {
          setTimeout(() => AS.overlay.showRecordPanel(msg.info || {}), 200);
        }
        break;
      case 'AF_SCAN_COUNT': {
        const fields = AS.scanner.scan();
        sendResponse({ total: fields.length, hostname: location.hostname });
        break;
      }
      case 'AF_FILL_SUMMARY':
        if (window.top === window && msg.summary) {
          AS.overlay.showSummary(msg.summary);
        }
        break;
      default:
        break;
    }
    return true;
  });

  AS.contentMain = { doFill, grabPageInfo };
})();
