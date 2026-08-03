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

  // 信息库摘要: 供 AI 生成回答时参考(基本信息/教育/实习/项目/技能/开放题已有答案)
  function profileToSummary(profile) {
    if (!profile || !profile.data) return '未填写';
    const d = profile.data;
    const parts = [];
    const b = d.basic || {};
    const bItems = [['姓名', b.name], ['手机', b.phone], ['邮箱', b.email], ['学校', b.school], ['学历', b.degree], ['专业', b.major], ['籍贯', b.nativePlace], ['现居地', b.currentLocation], ['政治面貌', b.politicalStatus], ['民族', b.ethnicity], ['出生日期', b.birthday]];
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
    const sum = parts.join('; ').slice(0, 1200);
    return sum || '未填写';
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

  AS.ai = { chat, test, rewriteExperience, simulateInterview, generateOpenAnswer, profileToSummary, getConfig };
})();
