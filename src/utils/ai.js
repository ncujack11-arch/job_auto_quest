/**
 * ai.js — 本地大模型对接接口(文档预留扩展位)
 * 兼容 Ollama / LM Studio / vLLM 等 OpenAI 兼容端点(默认 http://127.0.0.1:11434)
 * 仅连接用户自建本地服务, 数据不出本机
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
      endpoint: (ai.endpoint || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
      model: ai.model || 'default',
    };
  }

  // 调用 OpenAI 兼容 /v1/chat/completions
  async function chat(messages, opts) {
    const cfg = await getConfig();
    if (!cfg.enabled) throw new Error('本地大模型未启用(设置页可开启)');
    const url = cfg.endpoint + '/v1/chat/completions';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (opts && opts.timeout) || 120000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      throw new Error('无法连接本地大模型(' + cfg.endpoint + '): ' + (e && e.name === 'AbortError' ? '超时' : (e.message || e)) + ' — 请确认已启动本地服务');
    }
    clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('本地模型返回错误 ' + res.status + (body ? ': ' + body.slice(0, 120) : ''));
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

  AS.ai = { chat, test, rewriteExperience, simulateInterview, getConfig };
})();
