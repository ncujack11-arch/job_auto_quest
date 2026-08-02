/**
 * rules-view.js — 站点规则管理视图
 * 内置规则展示、自定义规则增删改、字段映射编辑、规则库导入导出
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  let rules = [];
  let currentRule = null;
  let containerRef = null;

  function fieldOptionsHtml() {
    let html = '<option value="">— 不映射 —</option>';
    AS.schema.CATEGORIES.forEach((cat) => {
      if (cat.id === 'openQuestions') return;
      html += `<optgroup label="${cat.name}">`;
      cat.fields.forEach((f) => {
        if (cat.id === 'custom') return;
        html += `<option value="${cat.id}.${f.key}">${f.label} (${cat.id}.${f.key})</option>`;
      });
      html += '</optgroup>';
    });
    return html;
  }

  function renderRuleList() {
    const listEl = document.getElementById('ruleList');
    listEl.innerHTML = '';
    if (!rules.length) {
      listEl.appendChild(UI().el('div', { class: 'empty', text: '暂无规则, 点击右上角新增' }));
      return;
    }
    rules.forEach((rule) => {
      const row = UI().el('div', { class: 'entry-card', style: 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;cursor:pointer' });
      row.addEventListener('click', () => {
        currentRule = rule;
        renderMapping();
        renderRuleList();
      });
      const info = UI().el('div', {}, [
        UI().el('b', { text: rule.siteName + (rule.builtin ? ' (内置)' : '') }),
        UI().el('span', { style: 'margin-left:10px;color:#6b7280;font-size:12px', text: rule.host }),
        UI().el('span', { style: 'margin-left:10px;font-size:12px;color:#6b7280', text: `映射 ${Object.keys(rule.mapping || {}).length} 条` }),
      ]);
      const actions = UI().el('div', { class: 'row-actions' });
      const toggle = UI().el('button', {
        class: 'btn sm' + (rule.enabled !== false ? ' primary' : ''),
        text: rule.enabled !== false ? '已启用' : '已停用',
        onclick: (e) => {
          e.stopPropagation();
          rule.enabled = rule.enabled !== false ? false : true;
          saveRules();
          renderRuleList();
        },
      });
      actions.appendChild(toggle);
      if (!rule.builtin) {
        actions.appendChild(UI().el('button', {
          class: 'btn sm danger', text: '删除', onclick: (e) => {
            e.stopPropagation();
            if (!confirm('删除该站点规则?')) return;
            rules = rules.filter((r) => r.id !== rule.id);
            if (currentRule === rule) { currentRule = null; renderMapping(); }
            saveRules();
            renderRuleList();
          },
        }));
      }
      row.appendChild(info);
      row.appendChild(actions);
      listEl.appendChild(row);
    });
  }

  function renderMapping() {
    const wrap = document.getElementById('mappingWrap');
    wrap.innerHTML = '';
    if (!currentRule) {
      wrap.appendChild(UI().el('div', { class: 'empty', text: '← 选择左侧规则编辑字段映射' }));
      return;
    }
    wrap.appendChild(UI().el('h3', { text: `字段映射 — ${currentRule.siteName} (${currentRule.host})` }));
    wrap.appendChild(UI().el('p', { class: 'view-sub', style: 'margin-bottom:10px', text: '「表单签名」为页面元素的 name / id / label 文本, 支持模糊包含匹配。保存后下次访问该站点自动生效。' }));

    const list = UI().el('div', { class: 'table-wrap', style: 'margin-bottom:12px' });
    const table = UI().el('table', { class: 'list' });
    table.appendChild(UI().el('thead', {}, [
      UI().el('tr', {}, [
        UI().el('th', { text: '表单签名' }),
        UI().el('th', { text: '信息库字段' }),
        UI().el('th', { style: 'width:60px', text: '' }),
      ]),
    ]));
    const tbody = UI().el('tbody');
    const entries = Object.entries(currentRule.mapping || {});
    if (!entries.length) tbody.appendChild(UI().el('tr', {}, [UI().el('td', { colspan: 3, text: '暂无映射, 点击下方添加' })]));
    entries.forEach(([k, v], i) => {
      const tr = UI().el('tr');
      const kInput = UI().el('input', {
        type: 'text', value: k, style: 'width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px',
        oninput: (e) => { currentRule.mapping[e.target.value] = v; delete currentRule.mapping[k]; saveRules(); },
      });
      const vSel = UI().el('select', {
        html: fieldOptionsHtml(), style: 'width:100%;padding:6px 8px;border:1px solid #e2e8f0;border-radius:6px',
        onchange: (e) => { currentRule.mapping[k] = e.target.value; saveRules(); },
      });
      vSel.value = v.replace(/\[\d+\]/, '');
      tr.appendChild(UI().el('td', {}, [kInput]));
      tr.appendChild(UI().el('td', {}, [vSel]));
      tr.appendChild(UI().el('td', {}, [
        UI().el('button', {
          class: 'btn sm danger', text: '删', onclick: () => {
            delete currentRule.mapping[k];
            saveRules();
            renderMapping();
          },
        }),
      ]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    list.appendChild(table);
    wrap.appendChild(list);

    wrap.appendChild(UI().el('div', { class: 'toolbar' }, [
      UI().el('button', {
        class: 'btn', text: '＋ 添加映射行', onclick: () => {
          currentRule.mapping = currentRule.mapping || {};
          currentRule.mapping['新签名' + Object.keys(currentRule.mapping).length] = '';
          saveRules();
          renderMapping();
        },
      }),
      UI().el('button', {
        class: 'btn', text: '复制常用映射模板', onclick: () => {
          const tpl = {
            'name': 'basic.name', 'realName': 'basic.name', 'mobile': 'basic.phone', 'phone': 'basic.phone',
            'email': 'basic.email', 'gender': 'basic.gender', 'sex': 'basic.gender', 'birthday': 'basic.birthday',
            'idcard': 'basic.idCard', 'school': 'education.school', 'degree': 'education.degree',
            'major': 'education.major', 'graduateTime': 'education.eduEnd', 'graduate': 'education.eduEnd',
            'job': 'intent.targetPosition', 'position': 'intent.targetPosition', 'city': 'intent.targetCity',
            'salary': 'intent.expectedSalary', 'entryTime': 'intent.availableDate',
          };
          currentRule.mapping = Object.assign({}, currentRule.mapping, tpl);
          saveRules();
          renderMapping();
          UI().toast('已复制常用映射模板', 'success');
        },
      }),
    ]));
  }

  async function saveRules() {
    await AS.storage.saveSiteRules(rules);
  }

  async function render(container, query) {
    containerRef = container;
    container.innerHTML = '';
    rules = await AS.storage.getSiteRules();

    // ---------- 使用说明 ----------
    const helpCard = UI().el('div', { class: 'card', style: 'background:#f8fafc' });
    const helpHead = UI().el('div', { style: 'display:flex;align-items:center;justify-content:space-between;cursor:pointer' });
    helpHead.appendChild(UI().el('h3', { style: 'margin:0', text: '❓ 站点规则是什么? 怎么用?' }));
    const toggleBtn = UI().el('span', { text: '展开 ▾', style: 'color:#2563eb;font-size:13px' });
    helpHead.appendChild(toggleBtn);
    const helpBody = UI().el('div', { style: 'display:none;margin-top:12px;line-height:2;font-size:13px;color:#334155' });
    helpBody.appendChild(UI().el('div', { html: `
      <b>一、这是什么?</b><br>
      每个网申网站的表单字段命名各不相同(比如有的网站用 <code>mobile</code>、有的用 <code>telephone</code>、有的写「联系电话」)。
      插件自动识别字段时靠"猜"(关键词匹配), 个别小众网站会猜不准。站点规则就是把某个网站的字段和你的信息库字段<u>绑定死</u>,
      绑定后该网站 100% 填对, 不再靠猜。<br><br>
      <b>二、什么情况下需要手动添加?</b><br>
      ① 填充结果显示"未匹配"的字段较多; ② 某些字段每次都被填错位置; ③ 小众/自研网申系统。<br><br>
      <b>三、三步使用流程</b><br>
      1. 在网申页面点击「一键填充」→ 页面右下角弹出结果统计;<br>
      2. 看到未匹配字段 → 点击「手动映射未匹配字段」(会自动带出当前站点域名);<br>
      3. 在该站点规则下点击「＋ 添加映射行」: 左侧填页面元素的 name / id / 或 label 文字(比如 <code>mobile</code> 或 <code>手机号码</code>),
      右侧下拉选择对应的信息库字段(如「手机号」)。保存后再次访问该站点自动生效。<br><br>
      <b>四、快速找字段签名的小技巧</b><br>
      在网申页面按 F12 打开开发者工具 → Elements 面板 → 点击左上角选择箭头 → 点选页面上的输入框,
      看高亮元素的名字属性(<code>&lt;input name="xxx"&gt;</code>), 那个 <code>xxx</code> 就是签名(支持模糊匹配, 填一部分也行)。<br><br>
      <b>五、内置规则</b><br>
      已内置 北森 / 肯耐珂萨 / 智联招聘 / 前程无忧 / 牛客网 / 实习僧 / 校招盒子 的常用字段映射, 可直接启用;
      不同公司的网申系统可能部署在自己的域名下, 若该域名的系统是北森开发的, 可在北森规则中添加该域名为别名(或新建规则复制映射)。<br><br>
      <b>六、规则库迁移</b><br>
      右上角「导出规则库」可保存为 JSON 文件, 换设备后在「导入规则库」恢复;「恢复内置规则」可重置内置规则为默认。
    ` }));
    helpHead.addEventListener('click', () => {
      const show = helpBody.style.display === 'none';
      helpBody.style.display = show ? 'block' : 'none';
      toggleBtn.textContent = show ? '收起 ▴' : '展开 ▾';
    });
    helpCard.appendChild(helpHead);
    helpCard.appendChild(helpBody);
    container.appendChild(helpCard);

    const toolbar = UI().el('div', { class: 'toolbar' });
    toolbar.appendChild(UI().el('span', { style: 'font-size:13px;color:#6b7280', text: `共 ${rules.length} 条规则` }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn primary', text: '＋ 新增站点规则', onclick: () => {
        const host = prompt('站点域名(如 company.com, 支持子域名自动匹配):');
        if (!host) return;
        const name = prompt('站点名称:') || host;
        const rule = { id: 'rule_' + Date.now().toString(36), siteName: name, host: host.replace(/^\*\./, ''), builtin: false, enabled: true, mapping: {} };
        rules.push(rule);
        saveRules().then(() => {
          currentRule = rule;
          renderRuleList();
          renderMapping();
        });
      },
    }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '导出规则库', onclick: async () => {
        const blob = new Blob([JSON.stringify(rules, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `站点规则库_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
    }));
    const fileInput = UI().el('input', { type: 'file', accept: '.json', style: 'display:none' });
    fileInput.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!Array.isArray(data)) throw new Error('格式错误');
        if (!confirm(`导入 ${data.length} 条规则? 将覆盖现有规则库`)) return;
        rules = data;
        await saveRules();
        render(container);
        UI().toast('规则库导入成功', 'success');
      } catch (err) {
        UI().toast('导入失败: ' + err.message, 'error');
      }
    });
    toolbar.appendChild(UI().el('button', { class: 'btn', text: '导入规则库', onclick: () => fileInput.click() }));
    toolbar.appendChild(UI().el('button', {
      class: 'btn', text: '恢复内置规则', onclick: async () => {
        if (!confirm('将内置规则与当前规则合并(内置规则重置为默认)?')) return;
        const builtin = AS.storage.BUILTIN_RULES;
        const custom = rules.filter((r) => !r.builtin);
        rules = builtin.concat(custom);
        await saveRules();
        render(container);
        UI().toast('已恢复内置规则', 'success');
      },
    }));
    container.appendChild(toolbar);

    const layout = UI().el('div', { style: 'display:grid;grid-template-columns:320px 1fr;gap:16px;align-items:start' });
    const listCard = UI().el('div', { class: 'card' });
    listCard.appendChild(UI().el('h3', { text: '站点规则库' }));
    listCard.appendChild(UI().el('div', { id: 'ruleList' }));
    const mapCard = UI().el('div', { class: 'card', id: 'mappingWrap' });
    layout.appendChild(listCard);
    layout.appendChild(mapCard);
    container.appendChild(layout);

    // 处理 focus=mapping 引导
    if (query && query.focus === 'mapping') {
      UI().toast('为当前站点添加字段映射: 新增规则或选择站点后添加映射行', '');
      currentRule = rules.find((r) => r.host === (query.host || '')) || null;
    }

    renderRuleList();
    renderMapping();
  }

  AS.views = AS.views || {};
  AS.views.rules = render;
})();
