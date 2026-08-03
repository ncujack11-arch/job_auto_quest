/**
 * ai.js — 大模型对接接口
 * 兼容 DeepSeek / OpenAI / Ollama 等 OpenAI 兼容端点
 * 用于: 开放题自动作答(网申填写)、经历定向改写、面试模拟
 * API Key 仅存本地浏览器, 请求仅发往用户配置的端点
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.ai) return;

  async function getConfig() {
    const settings = await AS.storage.getSettings();
    const ai = settings.ai || {};
    return {
      enabled: !!ai.enabled,
      endpoint: (ai.endpoint || 'https://api.deepseek.com').replace(/\/+$/, ''),
      apiKey: ai.apiKey || '',
      model: ai.model || 'deepseek-chat',
    };
  }

  // 调用 OpenAI 兼容 /v1/chat/completions
  async function chat(messages, opts) {
    const cfg = await getConfig();
    if (!cfg.enabled) throw new Error('大模型未启用(设置页可开启)');
    const url = cfg.endpoint + '/v1/chat/completions';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (opts && opts.timeout) || 120000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages) }],
          temperature: (opts && opts.temperature) || 0.7,
          max_tokens: (opts && opts.maxTokens) || 1500,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeout);
      throw new Error('无法连接大模型(' + cfg.endpoint + '): ' + (e && e.name === 'AbortError' ? '超时' : (e.message || e)) + ' — 请确认端点与网络');
    }
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('模型返回错误 ' + res.status + (body ? ': ' + body.slice(0, 160) : ''));
    }
    const data = await res.json();
    const content = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    return typeof content === 'string' ? content.trim() : '';
  }

  // 连接测试
  async function test() {
    const r = await chat('回复"ok"即可', { maxTokens: 10, timeout: 20000 });
    return !!r;
  }

  // 信息库摘要: 供 AI 生成回答时参考(学业/经历/技能等)
  // 隐私脱敏: 姓名/手机号/邮箱/身份证等身份与联系方式绝不发送给 AI(仅本地规则填充使用)
  function profileToSummary(profile) {
    if (!profile || !profile.data) return '未填写';
    const d = profile.data;
    const parts = [];
    const b = d.basic || {};
    const bItems = [['学校', b.school], ['学历', b.degree], ['专业', b.major], ['籍贯', b.nativePlace], ['现居地', b.currentLocation], ['政治面貌', b.politicalStatus], ['民族', b.ethnicity], ['出生日期', b.birthday]];
    bItems.forEach(([k, v]) => { if (v) parts.push(k + ':' + v); });
    (d.education || []).forEach((e, i) => {
      if (e && (e.school || e.major)) parts.push('教育' + (i + 1) + ':' + [e.school, e.major, e.degree, e.eduStart && e.eduEnd ? e.eduStart + '~' + e.eduEnd : ''].filter(Boolean).join(' '));
    });
    (d.internship || []).forEach((e, i) => {
      if (e && (e.intCompany || e.intPosition)) parts.push('实习' + (i + 1) + ':' + [e.intCompany, e.intPosition, e.intStart && e.intEnd ? e.intStart + '~' + e.intEnd : '', e.workContent].filter(Boolean).join(' '));
    });
    (d.project || []).forEach((e, i) => {
      if (e && e.projName) parts.push('项目' + (i + 1) + ':' + [e.projName, e.projRole, e.projTech, e.projDuty, e.projOutcome].filter(Boolean).join(' '));
    });
    const sk = d.skills || {};
    if (sk.englishLevel) parts.push('英语:' + sk.englishLevel);
    if (sk.certificates) parts.push('证书:' + sk.certificates);
    if (sk.awards) parts.push('获奖:' + sk.awards);
    const intro = (d.openQuestions || []).find((q) => /自我|介绍/.test(q.question || ''));
    if (intro && intro.answer) parts.push('自我介绍:' + String(intro.answer).slice(0, 300));
    let sum = parts.join('; ').slice(0, 1200);
    // 兜底脱敏: 11 位手机号 / 邮箱 一律遮蔽(防经历文本或开放题答案中夹带)
    sum = sum.replace(/1[3-9]\d{9}/g, '***').replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***');
    return sum || '未填写';
  }

  // 清洗 AI 返回的值: 去引号/换行取首行/去常见前缀(真实模型常带解释文字)
  function cleanAIValue(raw) {
    let v = String(raw || '').trim();
    v = v.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '');
    const firstLine = v.split(/\r?\n/)[0].trim();
    if (firstLine) v = firstLine;
    v = v.replace(/^(答案|答|填写内容|内容|值|匹配结果|匹配值|推荐值|根据(我的|您的)?信息|对应值|字段值)[:：\s]*/, '');
    v = v.replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim();
    // 明显未匹配/跳过表述
    if (/__SKIP__|无法|无对应|没有找到|未找到|不能确定|无法推断|跳过|暂无/i.test(v) && v.length < 20) return '';
    return v;
  }

  // 信息库智能匹配: 页面未填好的字段 → 从信息库中提取最匹配的真实值填入(绝不编造)
  // 返回 '' 表示信息库无对应值(跳过, 留空)
  async function matchFromLibrary(label, options, profile, context) {
    const summary = profileToSummary(profile);
    const prompt = [
      '你是网申表单填写助手。下面的表单字段没有自动填上, 请从「我的信息」中找到与该字段最匹配的值。',
      '要求: 只能从「我的信息」中原样提取真实值, 绝不编造、绝不修改、不要解释;',
      '若「我的信息」中有明确对应 → 直接输出该值(一行, 不加任何前缀符号);',
      '若没有明确对应 → 只输出 __SKIP__。',
      '',
      '我的信息: ' + summary,
      '公司/岗位: ' + (context || '未提供'),
      '字段: ' + label,
      (options && options.length ? '可选值(若字段有选项, 优先从选项中匹配): ' + options.join(' / ') : ''),
      '',
      '输出: ',
    ].join('\n');
    try {
      const r = await chat([{ role: 'user', content: prompt }], { maxTokens: 120, timeout: 60000, temperature: 0.1 });
      const clean = cleanAIValue(r);
      if (!clean || clean.length > 60) return '';
      // 校验: 若字段有选项, 返回值尽量贴近选项(防止模型输出解释)
      if (options && options.length) {
        const hit = options.find((o) => o && clean.includes(o));
        if (hit) return hit;
        const fuzzyHit = FUZZY() ? FUZZY().closest(clean, options, { minScore: 0.7 }) : null;
        if (fuzzyHit && fuzzyHit.score >= 0.7) return options[fuzzyHit.index];
      }
      return clean;
    } catch (e) {
      return '';
    }
  }

  // 开放题自动作答: 结合信息库与公司/岗位上下文生成回答
  async function generateOpenAnswer(question, profile, context) {
    const summary = profileToSummary(profile);
    const prompt = [
      '你是网申表单填写助手。请根据「我的信息」和「公司/岗位」为下面的开放题生成一段得体的中文回答。',
      '要求: 必须结合我的真实信息(不虚构经历), 语气积极专业, 150-300 字, 分点清晰。',
      '',
      '我的信息: ' + summary,
      '公司/岗位: ' + (context || '未提供'),
      '',
      '开放题: ' + question,
      '',
      '直接输出回答内容, 不要任何解释或前缀。',
    ].join('\n');
    return chat([{ role: 'user', content: prompt }], { maxTokens: 800, timeout: 60000, temperature: 0.7 });
  }

  // 未填好字段的 AI 补充填写: 描述/主观类字段生成合适内容(硬信息绝不生成)
  // 返回 '' 表示无法合理推断(跳过)
  async function generateFieldValue(label, options, profile, context) {
    const summary = profileToSummary(profile);
    const prompt = [
      '你是网申表单填写助手。下面的表单字段在信息库中暂无对应值, 请根据「我的信息」推断/生成一个合适的填写内容(描述/主观类)。',
      '要求: 结合我的真实信息(绝不虚构姓名/手机/邮箱/证件号/日期等硬性信息), 80-200 字。',
      '',
      '我的信息: ' + summary,
      '公司/岗位: ' + (context || '未提供'),
      '字段: ' + label,
      (options && options.length ? '可选值(尽量从中选择): ' + options.join(' / ') : ''),
      '',
      '直接输出填写内容, 不要解释; 若无法合理推断, 只输出 __SKIP__。',
    ].join('\n');
    try {
      const r = await chat([{ role: 'user', content: prompt }], { maxTokens: 600, timeout: 60000, temperature: 0.7 });
      return r === '__SKIP__' ? '' : (r || '');
    } catch (e) {
      return '';
    }
  }

  // AI 托管填充规划: 完整信息库 + 页面全部字段 → AI 一次性给出每字段填充值
  // 返回: [{ label, value }]  (value 为空表示不填)
  async function planFill(fieldsInfo, profile, context) {
    const full = JSON.stringify(profile ? profile.data : {});
    const fieldsJson = JSON.stringify(fieldsInfo || []);
    const prompt = [
      '你是网申表单填写助手(自动化代理)。请为下面的表单字段逐一给出填充值, 依据「我的完整信息」。',
      '规则: ',
      '1) 信息库有对应真实值(姓名/手机/邮箱/学校/专业/民族/籍贯/城市/时间/经历等) → 必须用信息库原值;',
      '2) 描述/主观类字段(自我介绍/职业规划/自我评价/补充说明等) → 基于信息库合理撰写;',
      '3) 信息库无对应且无法合理推断 → value 留空字符串;',
      '4) 所有值必须真实/合理, 绝不编造虚假信息。',
      '',
      '我的完整信息: ' + full.slice(0, 5000),
      '公司/岗位: ' + (context || '未提供'),
      '',
      '表单字段: ' + fieldsJson.slice(0, 4000),
      '',
      '输出: 严格 JSON 数组, 每个元素 {"label":"表单字段标签原文","value":"填充值"}, 无填充值则 value 为 ""。不要输出 JSON 以外的任何文字。',
    ].join('\n');
    try {
      const r = await chat([{ role: 'user', content: prompt }], { maxTokens: 2500, timeout: 120000, temperature: 0.2 });
      // 提取 JSON 数组(容忍前后文字)
      const m = String(r || '').match(/\[[\s\S]*\]/);
      if (!m) return [];
      const list = JSON.parse(m[0]);
      if (!Array.isArray(list)) return [];
      return list
        .map((it) => ({ label: String(it.label || '').trim(), value: String(it.value || '').trim() }))
        .filter((it) => it.label && it.value);
    } catch (e) {
      return [];
    }
  }

  // AI 核对改写: 填充完成后, 对照信息库核对已填字段(错填/漏填/格式), 返回修正项列表
  // 返回: [{ field: 字段标签, correct: 信息库正确值, reason: 原因 }]
  async function reviewFilled(fieldsInfo, profile, context) {
    const summary = profileToSummary(profile);
    const fieldLines = (fieldsInfo || []).map((f) => (f.label || '?') + ': ' + (f.value || '(空)')).join('\n');
    const prompt = [
      '你是网申表单填写助手。以下是网申表单当前已填写的字段, 以及「我的信息」(信息库, 真实可信)。',
      '请逐项核对: 表单值与「我的信息」不一致 → 给出信息库中的正确值; 表单为空但信息库有对应 → 给出该值。',
      '要求: 正确值必须来自「我的信息」, 绝不编造; 字段无法对应到信息库任何值则不改。',
      '',
      '我的信息: ' + summary,
      '公司/岗位: ' + (context || '未提供'),
      '',
      '表单字段: ',
      fieldLines.slice(0, 3000),
      '',
      '输出格式(严格, 每行一条, 用 | 分隔): ',
      '字段标签|正确值|原因',
      '如某字段无需修改则不输出; 全部正确只输出 OK。',
    ].join('\n');
    try {
      const r = await chat([{ role: 'user', content: prompt }], { maxTokens: 500, timeout: 60000, temperature: 0.1 });
      const lines = String(r || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== 'OK' && l !== 'ok');
      const items = [];
      for (const line of lines) {
        const parts = line.split('|').map((p) => cleanAIValue(p));
        if (parts.length >= 2 && parts[0] && parts[1] && !/^(OK|ok|无|没有|无需)$/.test(parts[1])) {
          items.push({ field: parts[0], correct: parts[1], reason: parts[2] || '' });
        }
      }
      return items;
    } catch (e) {
      return [];
    }
  }

  // 经历定向改写: 基于岗位方向/JD 要点改写经历描述
  async function rewriteExperience(experience, target, extra) {
    const prompt = [
      '你是校招简历优化助手。请根据「目标岗位」和「JD 要点」, 将以下经历改写得更有针对性与量化表达(保留事实, 不虚构), 输出 80-150 字的中文描述。',
      '',
      '目标岗位: ' + (target || '未指定'),
      'JD 要点: ' + (extra || '未提供'),
      '',
      '原始经历: ' + experience,
      '',
      '请直接输出改写后的描述, 不要解释。',
    ].join('\n');
    return chat([{ role: 'user', content: prompt }], { maxTokens: 600 });
  }

  // 面试模拟: 生成针对性问题
  async function simulateInterview(company, position, extra) {
    const prompt = [
      '你是校招面试官。请基于以下公司和岗位, 生成 5 个该岗位校招常见的面试问题(含 1 个行为面问题), 每个问题后附 1 句回答方向提示。',
      '',
      '公司: ' + (company || '未知'),
      '岗位: ' + (position || '未知'),
      (extra ? '补充: ' + extra : ''),
      '',
      '输出格式(严格): ',
      '1. 问题文本',
      '   方向: 回答方向提示',
      '2. ...',
    ].join('\n');
    return chat([{ role: 'user', content: prompt }], { maxTokens: 900 });
  }

  AS.ai = { chat, test, rewriteExperience, simulateInterview, generateOpenAnswer, generateFieldValue, matchFromLibrary, reviewFilled, planFill, cleanAIValue, profileToSummary, getConfig };
})();
