/**
 * ai-view.js — AI 工具视图 (本地大模型对接, 文档预留扩展位)
 * 经历定向改写 / 面试问题模拟, 仅连接用户自建本地服务(如 Ollama)
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  async function render(container) {
    container.innerHTML = '';
    const settings = await AS.storage.getSettings();
    const ai = settings.ai || {};

    // ---------- 配置 ----------
    const cfgCard = UI().el('div', { class: 'card' });
    cfgCard.appendChild(UI().el('h3', { text: '🤖 本地大模型配置', children: [UI().el('span', { class: 'badge', text: '预留接口' })] }));
    cfgCard.appendChild(UI().el('p', { class: 'view-sub', text: '连接本机运行的 OpenAI 兼容服务(Ollama / LM Studio 等), 数据不出本机。未配置时, 下方工具不可用。' }));
    const form = UI().el('div', { class: 'form-grid', style: 'max-width:720px' });
    const enItem = UI().el('div', { class: 'form-item' });
    enItem.appendChild(UI().el('label', { text: '启用本地大模型' }));
    const enCheck = UI().el('input', {
      type: 'checkbox', checked: !!ai.enabled,
      onchange: async (e) => {
        settings.ai = settings.ai || {};
        settings.ai.enabled = e.target.checked;
        await AS.storage.saveSettings(settings);
      },
    });
    enItem.appendChild(enCheck);
    form.appendChild(enItem);

    const epItem = UI().el('div', { class: 'form-item' });
    epItem.appendChild(UI().el('label', { text: '服务地址(OpenAI 兼容)' }));
    const epInput = UI().el('input', {
      type: 'text', value: ai.endpoint || 'https://api.deepseek.com', placeholder: 'https://api.deepseek.com',
      onchange: async (e) => {
        settings.ai = settings.ai || {};
        settings.ai.endpoint = e.target.value.trim() || 'https://api.deepseek.com';
        await AS.storage.saveSettings(settings);
      },
    });
    epItem.appendChild(epInput);
    epItem.appendChild(UI().el('div', { class: 'view-sub', style: 'margin:4px 0 0 0', text: '预设: DeepSeek https://api.deepseek.com · OpenAI https://api.openai.com · 本地 Ollama http://127.0.0.1:11434' }));
    form.appendChild(epItem);

    const keyItem = UI().el('div', { class: 'form-item' });
    keyItem.appendChild(UI().el('label', { text: 'API Key(仅存本地浏览器)' }));
    const keyInput = UI().el('input', {
      type: 'password', value: ai.apiKey || '', placeholder: 'sk-...(在线 API 必填, 本地 Ollama 可留空)',
      onchange: async (e) => {
        settings.ai = settings.ai || {};
        settings.ai.apiKey = e.target.value.trim();
        await AS.storage.saveSettings(settings);
      },
    });
    keyItem.appendChild(keyInput);
    form.appendChild(keyItem);

    const mdItem = UI().el('div', { class: 'form-item' });
    mdItem.appendChild(UI().el('label', { text: '模型名' }));
    const mdInput = UI().el('input', {
      type: 'text', value: ai.model || 'deepseek-chat', placeholder: '如 deepseek-chat / gpt-4o-mini / qwen2.5:7b',
      onchange: async (e) => {
        settings.ai = settings.ai || {};
        settings.ai.model = e.target.value.trim() || 'deepseek-chat';
        await AS.storage.saveSettings(settings);
      },
    });
    mdItem.appendChild(mdInput);
    form.appendChild(mdItem);

    // 开放题自动作答开关
    const oqItem = UI().el('div', { class: 'form-item' });
    oqItem.appendChild(UI().el('label', { text: '填充时开放题自动作答' }));
    const oqWrap = UI().el('div', { style: 'display:flex;gap:8px;align-items:center' });
    const oqCheck = UI().el('input', {
      type: 'checkbox', checked: ai.openQuestionAuto !== false,
      onchange: async (e) => {
        settings.ai = settings.ai || {};
        settings.ai.openQuestionAuto = e.target.checked;
        await AS.storage.saveSettings(settings);
      },
    });
    oqWrap.appendChild(oqCheck);
    oqWrap.appendChild(UI().el('span', { style: 'font-size:12px;color:#6b7280', text: '填充时若开放题信息库无答案, 自动调用大模型结合你的信息与公司/岗位生成回答并填入' }));
    oqItem.appendChild(oqWrap);
    form.appendChild(oqItem);

    cfgCard.appendChild(form);
    // DeepSeek 官方一键配置(用户要求: 默认启用官方平台 API)
    const dsBtn = UI().el('button', {
      class: 'btn sm', text: '⚡ 一键配置 DeepSeek 官方', onclick: async () => {
        settings.ai = Object.assign({}, settings.ai || {}, {
          enabled: true, endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', openQuestionAuto: settings.ai && settings.ai.openQuestionAuto !== undefined ? settings.ai.openQuestionAuto : true,
        });
        await AS.storage.saveSettings(settings);
        epInput.value = 'https://api.deepseek.com';
        mdInput.value = 'deepseek-chat';
        enCheck.checked = true;
        UI().toast('已指向 DeepSeek 官方, 请在上方填写你的 API Key 后测试连接', 'success');
      },
    });
    cfgCard.appendChild(UI().el('div', { class: 'view-sub', style: 'margin-top:8px' }, [
      UI().el('span', { text: 'DeepSeek 官方: 去 platform.deepseek.com 创建 API Key(sk-开头), 填入上方「API Key」框即可, 密钥仅存本地浏览器。' }),
      dsBtn,
    ]));
    const testBtn = UI().el('button', {
      class: 'btn', text: '🔌 测试连接', onclick: async (e) => {
        testBtn.disabled = true;
        testBtn.textContent = '测试中...';
        try {
          const ok = await AS.ai.test();
          UI().toast(ok ? '连接成功 ✔' : '连接异常', ok ? 'success' : 'error');
        } catch (err) {
          UI().toast(err.message, 'error');
        }
        testBtn.disabled = false;
        testBtn.textContent = '🔌 测试连接';
      },
    });
    cfgCard.appendChild(UI().el('div', { class: 'toolbar', style: 'margin-top:10px' }, [testBtn]));
    container.appendChild(cfgCard);

    if (!ai.enabled) {
      container.appendChild(UI().el('div', { class: 'empty' }, [
        UI().el('b', { text: '大模型未启用' }),
        UI().el('span', { text: '开启上方开关并配置服务地址/API Key 后, 填充时开放题自动作答、经历改写与面试模拟可用。' }),
      ]));
      return;
    }

    // ---------- 经历定向改写 ----------
    const profile = await AS.storage.getActiveProfile();
    const rwCard = UI().el('div', { class: 'card' });
    rwCard.appendChild(UI().el('h3', { text: '✍️ 经历定向改写', children: [UI().el('span', { class: 'badge', text: '基于岗位 JD 本地生成' })] }));
    const rwForm = UI().el('div', { class: 'form-grid' });

    const selItem = UI().el('div', { class: 'form-item' });
    selItem.appendChild(UI().el('label', { text: '选择经历' }));
    const expSel = UI().el('select');
    const entries = [];
    ['education', 'internship', 'project'].forEach((cat) => {
      const list = (profile && profile.data && profile.data[cat]) || [];
      list.forEach((entry, i) => {
        const title = entry.school || entry.intCompany || entry.projName || (cat + ' ' + (i + 1));
        const detail = entry.workContent || entry.projDuty || entry.major || entry.techStack || '';
        const label = `${title}${detail ? ' — ' + String(detail).slice(0, 30) : ''}`;
        entries.push({ cat, idx: i, label });
        expSel.appendChild(UI().el('option', { value: String(entries.length - 1), text: label.slice(0, 40) }));
      });
    });
    if (!entries.length) {
      selItem.appendChild(UI().el('span', { style: 'font-size:12px;color:#9ca3af', text: '信息库暂无教育/实习/项目经历, 可在信息库或简历导入中添加' }));
    } else {
      selItem.appendChild(expSel);
    }
    rwForm.appendChild(selItem);

    const tgtItem = UI().el('div', { class: 'form-item' });
    tgtItem.appendChild(UI().el('label', { text: '目标岗位方向' }));
    const tgtInput = UI().el('input', { type: 'text', placeholder: '如: 硬件工程师(SSD 固件方向)' });
    tgtItem.appendChild(tgtInput);
    rwForm.appendChild(tgtItem);

    const jdItem = UI().el('div', { class: 'form-item full' });
    jdItem.appendChild(UI().el('label', { text: 'JD 要点(选填)' }));
    const jdInput = UI().el('textarea', { style: 'min-height:60px', placeholder: '粘贴该岗位 JD 的关键词/要求' });
    jdItem.appendChild(jdInput);
    rwForm.appendChild(jdItem);
    rwCard.appendChild(rwForm);

    const rwResult = UI().el('div', { style: 'margin-top:10px' });
    rwCard.appendChild(UI().el('div', { class: 'toolbar', style: 'margin-top:10px' }, [
      UI().el('button', {
        class: 'btn primary', text: '✨ 生成改写', onclick: async (e) => {
          if (!entries.length) return UI().toast('请先添加经历', 'error');
          const exp = entries[+expSel.value];
          const src = (profile.data[exp.cat][exp.idx]);
          const raw = Object.values(src).filter((v) => v && typeof v === 'string').join('; ').slice(0, 600);
          const btn = e.target;
          btn.disabled = true; btn.textContent = '生成中(本地推理可能需要一些时间)...';
          rwResult.innerHTML = '';
          try {
            const out = await AS.ai.rewriteExperience(raw, tgtInput.value.trim(), jdInput.value.trim());
            rwResult.innerHTML = '';
            const ta = UI().el('textarea', { style: 'width:100%;min-height:120px;border:1px solid #e2e8f0;border-radius:8px;padding:10px', text: out });
            rwResult.appendChild(UI().el('div', { class: 'toolbar' }, [
              UI().el('button', {
                class: 'btn sm primary', text: '💾 存回该经历', onclick: async () => {
                  const src2 = profile.data[exp.cat][exp.idx];
                  if (exp.cat === 'internship') src2.workContent = ta.value;
                  else if (exp.cat === 'project') src2.projOutcome = ta.value;
                  else src2.honors = ta.value;
                  profile.updatedAt = Date.now();
                  await AS.storage.saveProfile(profile);
                  UI().toast('已存回信息库', 'success');
                },
              }),
              UI().el('button', { class: 'btn sm', text: '复制', onclick: async () => {
                await navigator.clipboard.writeText(ta.value);
                UI().toast('已复制', 'success');
              } }),
            ]));
            rwResult.appendChild(ta);
          } catch (err) {
            rwResult.innerHTML = '';
            rwResult.appendChild(UI().el('div', { class: 'empty', text: err.message }));
          }
          btn.disabled = false; btn.textContent = '✨ 生成改写';
        },
      }),
    ]));
    rwCard.appendChild(rwResult);
    container.appendChild(rwCard);

    // ---------- 面试模拟 ----------
    const simCard = UI().el('div', { class: 'card' });
    simCard.appendChild(UI().el('h3', { text: '🎤 面试问题模拟', children: [UI().el('span', { class: 'badge', text: '结果可一键存入题库' })] }));
    const simForm = UI().el('div', { class: 'form-grid' });
    const simCo = UI().el('div', { class: 'form-item' });
    simCo.appendChild(UI().el('label', { text: '公司' }));
    const simCoI = UI().el('input', { type: 'text', placeholder: '如: 华为' });
    simCo.appendChild(simCoI);
    simForm.appendChild(simCo);
    const simPo = UI().el('div', { class: 'form-item' });
    simPo.appendChild(UI().el('label', { text: '岗位' }));
    const simPoI = UI().el('input', { type: 'text', placeholder: '如: SSD 固件工程师' });
    simPo.appendChild(simPoI);
    simForm.appendChild(simPo);
    simCard.appendChild(simForm);
    const simResult = UI().el('div', { style: 'margin-top:10px' });
    simCard.appendChild(UI().el('div', { class: 'toolbar', style: 'margin-top:10px' }, [
      UI().el('button', {
        class: 'btn primary', text: '🎤 生成模拟问题', onclick: async (e) => {
          const btn = e.target;
          btn.disabled = true; btn.textContent = '生成中...';
          simResult.innerHTML = '';
          try {
            const out = await AS.ai.simulateInterview(simCoI.value.trim(), simPoI.value.trim(), '');
            simResult.innerHTML = '';
            const ta = UI().el('textarea', { style: 'width:100%;min-height:160px;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:12.5px', text: out });
            simResult.appendChild(UI().el('div', { class: 'toolbar' }, [
              UI().el('button', {
                class: 'btn sm primary', text: '📥 全部存入题库', onclick: async () => {
                  const lines = ta.value.split(/\n/).filter((l) => l.trim());
                  const questions = lines.filter((l) => /^\s*\d+[.、]/.test(l)).map((l) => l.replace(/^\s*\d+[.、]\s*/, '').trim());
                  let n = 0;
                  for (const q of questions) {
                    const added = await AS.storage.addQuizItem({
                      id: 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                      question: `【${simCoI.value.trim() || '模拟'}】${q}`,
                      answer: '模拟面试题(待补充)',
                      category: simPoI.value.trim() || '模拟面试',
                    });
                    if (added) n++;
                  }
                  UI().toast(n ? `已存入 ${n} 题到笔试题库` : '未识别到题目, 请检查格式', n ? 'success' : 'error');
                },
              }),
              UI().el('button', { class: 'btn sm', text: '复制', onclick: async () => {
                await navigator.clipboard.writeText(ta.value);
                UI().toast('已复制', 'success');
              } }),
            ]));
            simResult.appendChild(ta);
          } catch (err) {
            simResult.innerHTML = '';
            simResult.appendChild(UI().el('div', { class: 'empty', text: err.message }));
          }
          btn.disabled = false; btn.textContent = '🎤 生成模拟问题';
        },
      }),
    ]));
    simCard.appendChild(simResult);
    container.appendChild(simCard);
  }

  AS.views = AS.views || {};
  AS.views.ai = render;
})();
