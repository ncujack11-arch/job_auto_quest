/**
 * serve.js — E2E 本地表单服务(每次请求随机生成测试表单)
 * 每次: 字段组合随机 / 控件类型随机 / label 表述随机 / 预填内容随机(约 1:1 预填/空白)
 * 预填值每次不同(姓名/手机/邮箱等随机), 核心断言字段固定存在
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const PORT = process.env.E2E_PORT || 8899;
const __mockRequests = [];  // AI mock 请求记录(隐私脱敏验证用)

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const rand = (n) => String(rnd(n));

// 值池
const NAME_POOL = ['张伟', '李娜', '王芳', '刘洋', '陈静', '杨帆', '赵磊', '黄敏'];
const SCHOOL_POOL = ['哈尔滨工程大学', '浙江大学', '武汉大学', '电子科技大学', '西安电子科技大学', '华中科技大学', '北京邮电大学', '天津大学'];
const MAJOR_POOL = ['信息与通信工程', '软件工程', '计算机科学与技术', '电子信息工程', '自动化', '网络工程', '数据科学与大数据技术', '微电子科学与工程'];
const CITY_POOL = ['杭州', '上海', '北京', '深圳', '南京', '成都', '武汉', '广州'];
const NATIVE_POOL = [['江西', '上饶市', '余干县'], ['浙江', '杭州市', '西湖区'], ['广东', '深圳市', '南山区'], ['四川', '成都市', '武侯区'], ['江苏', '南京市', '鼓楼区']];
const BIRTH_POOL = [['1999', '3'], ['2000', '6'], ['2001', '9'], ['2002', '1'], ['1998', '12']];
const Y_N = ['是', '否'];

// 字段定义: key → { labels: [随机label], types: [可选控件类型], pool: 预填值池 }
const FIELDS = {
  'basic.name': { labels: ['姓名', '名字', '真实姓名'], types: ['text'], pool: NAME_POOL, fixed: true },
  'basic.phone': { labels: ['手机号', '手机号码', '联系电话', '手机'], types: ['text'], pool: () => ['1' + pick(['3', '5', '7', '8', '9']) + rand(9)], fixed: true },
  'basic.email': { labels: ['邮箱', '电子邮件', 'Email'], types: ['text'], pool: () => ['e2e' + rand(6) + '@' + pick(['qq.com', '163.com', 'gmail.com'])], fixed: true },
  'basic.gender': { labels: ['性别'], types: ['radio'], pool: ['男', '女'], fixed: true },
  'basic.politicalStatus': { labels: ['政治面貌', '政治身份'], types: ['select'], pool: ['中共党员', '共青团员', '群众'] },
  'basic.ethnicity': { labels: ['民族', '民族成分'], types: ['text'], pool: ['汉族', '回族', '满族', '壮族'] },
  'basic.overseas': { labels: ['是否有海外留学经历', '海外留学经历'], types: ['select'], pool: Y_N },
  'basic.currentLocation': { labels: ['目前城市所在地', '现居地', '居住城市'], types: ['select'], pool: CITY_POOL },
  'basic.nativePlace': { labels: ['籍贯', '户籍所在地'], types: ['cascade'], pool: NATIVE_POOL },
  'basic.birthday': { labels: ['出生日期', '出生年月'], types: ['ym'], pool: BIRTH_POOL },
  'intent.targetCity': { labels: ['期望工作地点', '期望城市'], types: ['select'], pool: CITY_POOL },
  'intent.expectedSalary': { labels: ['期望薪资', '期望月薪', '期望薪酬'], types: ['hybrid'], selectOpts: ['8K', '10K', '15K', '20K', '25K'] },
  'intent.complyAssignment': { labels: ['是否愿意服从公司分配', '服从分配'], types: ['checkbox'], pool: Y_N },
  'skills.englishLevel': { labels: ['英语等级', '英语水平'], types: ['select'], pool: ['CET-4', 'CET-6', '雅思', '托福'] },
  'skills.certificates': { labels: ['专业技能证书', '证书'], types: ['text'], pool: ['软件设计师', '网络工程师', 'CISP'] },
  'education.school': { labels: ['学校名称', '毕业院校', '学校'], types: ['text'], pool: SCHOOL_POOL, entry: 'education', fixed: true },
  'education.major': { labels: ['专业名称', '专业'], types: ['text'], pool: MAJOR_POOL, entry: 'education' },
  'education.degree': { labels: ['学历', '最高学历'], types: ['select'], pool: ['博士', '硕士', '本科', '大专'], entry: 'education' },
  'openQuestions.intro': { labels: ['自我介绍', '请做一下自我介绍', '个人简介'], types: ['textarea'], pool: ['热爱技术, 学习能力强, 团队协作好。', '责任心强, 追求极致, 持续学习。'] },
  'agreement.protocol': { labels: ['我已阅读并同意用户协议与隐私政策'], types: ['agree'], pool: [] },
  // 小众/未知字段(不在信息库 schema, 用于格式捕获验证)
  'uncommon.referee': { labels: ['推荐人'], types: ['text'], pool: [] },
  'uncommon.source': { labels: ['招聘信息来源'], types: ['text'], pool: [] },
  'uncommon.currentSalary': { labels: ['当前薪资'], types: ['text'], pool: [] },
  'uncommon.plan': { labels: ['职业规划'], types: ['textarea'], pool: [] },
};

// 每次固定取这些字段: 必含 6 个(fixed) + 随机池选 7-9 个
const FIXED = ['basic.name', 'basic.phone', 'basic.email', 'basic.gender', 'education.school', 'openQuestions.intro', 'intent.expectedSalary', 'agreement.protocol', 'uncommon.referee', 'uncommon.currentSalary', 'basic.ethnicity', 'basic.politicalStatus'];
const RANDOM_POOL = Object.keys(FIELDS).filter((k) => !FIXED.includes(k));

function esc(s) { return String(s).replace(/"/g, '&quot;'); }

function renderField(key, def, fillValue, orderIdx) {
  const label = pick(def.labels);
  const labelHtml = `<label>${label}</label>`;
  const testAttr = `data-test="${key}"`;
  switch (def.types[0]) {
    case 'text': {
      const v = fillValue !== undefined ? `value="${esc(fillValue)}"` : '';
      return `<div class="row">${labelHtml}<input type="text" ${testAttr} ${v} placeholder="请输入${label}"></div>`;
    }
    case 'select': {
      const opts = (def.pool || []).map((o) => `<option${fillValue === o ? ' selected' : ''}>${o}</option>`).join('');
      return `<div class="row">${labelHtml}<select ${testAttr}><option value="">请选择</option>${opts}</select></div>`;
    }
    case 'radio': {
      const opts = (def.pool || []).map((o, i) => `<label style="width:auto"><input type="radio" name="g${orderIdx}" value="${o}"${fillValue === o ? ' checked' : ''}> ${o}</label>`).join('');
      return `<div class="row">${labelHtml}<span>${opts}</span></div>`;
    }
    case 'checkbox': {
      return `<div class="row">${labelHtml}<span><label style="width:auto"><input type="checkbox" ${testAttr}${fillValue === '是' ? ' checked' : ''}> 是</label></span></div>`;
    }
    case 'textarea': {
      return `<div class="row">${labelHtml}<textarea ${testAttr} style="min-height:60px" placeholder="请填写${label}">${fillValue !== undefined ? esc(fillValue) : ''}</textarea></div>`;
    }
    case 'cascade': {
      const nv = fillValue || [];
      const prov = nv[0] || '', city = nv[1] || '', county = nv[2] || '';
      return `<div class="row" data-test="native">${labelHtml}
        <select data-test="basic.nativePlace.province"><option value="">请选择省</option><option>江西</option><option>浙江</option><option>广东</option><option>四川</option><option>江苏</option></select>
        <select data-test="basic.nativePlace.city"><option value="">请选择市</option><option>上饶市</option><option>杭州市</option><option>深圳市</option><option>成都市</option><option>南京市</option></select>
        <select data-test="basic.nativePlace.county"><option value="">请选择县</option><option>余干县</option><option>西湖区</option><option>南山区</option><option>武侯区</option><option>鼓楼区</option></select></div>`;
    }
    case 'ym': {
      const bd = fillValue || [];
      const y = bd[0] || '', m = bd[1] || '';
      const years = ['1998', '1999', '2000', '2001', '2002'].map((o) => `<option${y === o ? ' selected' : ''}>${o}</option>`).join('');
      const months = Array.from({ length: 12 }, (_, i) => String(i + 1)).map((o) => `<option${m === o ? ' selected' : ''}>${o}</option>`).join('');
      return `<div class="row">${labelHtml}
        <select data-test="basic.birthday.year"><option value="">年</option>${years}</select>
        <select data-test="basic.birthday.month"><option value="">月</option>${months}</select></div>`;
    }
    case 'hybrid': {
      const opts = (def.selectOpts || []).map((o) => `<option>${o}</option>`).join('');
      return `<div class="row">${labelHtml}<select ${testAttr}><option value="">请选择</option>${opts}</select>
        <input type="text" data-test="${key}.input" placeholder="或直接输入" style="flex:1"></div>`;
    }
    case 'agree': {
      return `<div class="row">${labelHtml}<span><label style="width:auto"><input type="checkbox" data-test="agreement.protocol"> 我已阅读并同意《用户协议》与《隐私政策》</label></span></div>`;
    }
    default: return '';
  }
}

function genForm() {
  // 字段组合: 必含 + 随机 7-9 个
  const keys = FIXED.slice();
  const randoms = RANDOM_POOL.slice().sort(() => Math.random() - 0.5).slice(0, 7 + rnd(3));
  keys.push(...randoms);
  // 预填计划: 约一半(必含的 name/phone/email/gender 必填, 其余随机 50%)
  const fillPlan = {};
  FIXED.slice(0, 4).forEach((k) => { fillPlan[k] = typeof FIELDS[k].pool === 'function' ? FIELDS[k].pool()[0] : pick(FIELDS[k].pool); });
  keys.forEach((k) => {
    if (!fillPlan[k] && FIELDS[k].pool && Math.random() < 0.5) {
      fillPlan[k] = typeof FIELDS[k].pool === 'function' ? FIELDS[k].pool()[0] : pick(FIELDS[k].pool);
    }
  });
  // 打乱顺序
  const order = keys.slice().sort(() => Math.random() - 0.5);
  const rows = order.map((k, i) => renderField(k, FIELDS[k], fillPlan[k], i)).join('\n');
  const filledCount = Object.keys(fillPlan).length;
  const total = keys.length;
  return {
    html: `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>E2E 随机测试表单</title>
<style>
body{font-family:"Microsoft YaHei",sans-serif;max-width:760px;margin:20px auto;padding:0 16px;color:#333}
h1{border-bottom:2px solid #2563eb;padding-bottom:6px;font-size:18px}
.sec{border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:14px}
.row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.row label{width:140px;text-align:right;font-size:13px;color:#475569}
.row input[type="text"],.row select,.row textarea{flex:1;padding:6px 8px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px}
</style></head><body><h1>投递申请表(E2E 随机生成 #${Date.now().toString(36)})</h1>
<div class="sec">${rows}</div></body></html>`,
    meta: { total, filledCount, fillPlan, keys },
  };
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  // Mock OpenAI 兼容端点(模拟 DeepSeek, 供 AI 自动作答 E2E)
  if (url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // 记录请求(验证隐私脱敏用)
      __mockRequests.push(body);
      let question = '';
      try {
        const j = JSON.parse(body);
        const msgs = (j.messages || []);
        const lastUser = msgs.filter((m) => m.role === 'user').pop();
        question = lastUser ? lastUser.content : '';
      } catch (e) { /* ignore */ }
      const qMark = question.match(/开放题:\s*([^\n]+)/);
      const fMark = question.match(/字段:\s*([^\n]+)/);
      const planMark = question.match(/表单字段\(每行一个\):\s*([\s\S]*?)\n\n输出格式/);
      const reviewMark = question.match(/表单字段:\s*([\s\S]*?)\n\n输出格式/);
      let content = '';
      if (reviewMark) {
        // AI 核对改写: 返回修正项(测试: 若字段值=籍贯但标签是所在地则修正)
        try {
          const lines = reviewMark[1].split('\n').map((l) => l.trim()).filter(Boolean);
          const out = [];
          lines.forEach((line) => {
            const m = line.match(/^(.+?):\s*(.+)$/);
            if (!m) return;
            const label = m[1], val = m[2];
            if ((label.includes('所在地') || label.includes('现居地')) && val.includes('江西')) {
              out.push(label + '|杭州|信息库现居地为杭州');
            }
          });
          content = out.join('\n') || 'OK';
        } catch (e) { content = 'OK'; }
      } else if (planMark) {
        // AI 托管批量规划(行格式): 返回 "序号|值" 每行
        try {
          const lines = planMark[1].split('\n').map((l) => l.trim()).filter(Boolean);
          const rules = [['民族', '汉族'], ['籍贯', '江西 上饶市 余干县'], ['政治面貌', '共青团员'], ['所在地', '杭州'], ['现居地', '杭州'], ['期望城市', '杭州'], ['期望工作地点', '杭州']];
          const out = [];
          lines.forEach((line) => {
            const m = line.match(/^(\d+)\.\s*(.+?)(?:\s*\(选项:.*\))?$/);
            if (!m) return;
            const idx = parseInt(m[1], 10);
            const label = m[2];
            let value = '空';
            for (const [kw, v] of rules) {
              if (label.includes(kw)) { value = v; break; }
            }
            out.push(idx + '|' + value);
          });
          content = out.join('\n');
        } catch (e) { content = ''; }
      } else if (qMark) {
        content = '这是AI根据我的信息生成的回答(针对: ' + qMark[1].trim() + '): 我热爱技术, 学习能力强, 具备扎实的专业基础与团队协作能力, 期待加入贵司共同成长。';
      } else if (fMark) {
        // 信息库智能匹配: 从 prompt 的「我的信息」里找对应值
        const info = question.match(/我的信息: ([^\n]+)/);
        const field = fMark[1].trim();
        const infoText = info ? info[1] : '';
        let matched = '';
        const rules = [
          [/民族/, () => (infoText.match(/民族:([^;]+)/) || [])[1]],
          [/籍贯/, () => (infoText.match(/籍贯:([^;]+)/) || [])[1]],
          [/政治面貌/, () => (infoText.match(/政治面貌:([^;]+)/) || [])[1]],
          [/期望城市|期望工作地点/, () => (infoText.match(/现居地:([^;]+)/) || [])[1]],
          [/所在地|目前所在地|现居地|居住城市/, () => (infoText.match(/现居地:([^;]+)/) || [])[1]],
          [/语言|英语/, () => (infoText.match(/英语:([^;]+)/) || [])[1]],
        ];
        for (const [re, fn] of rules) {
          if (re.test(field)) { matched = (fn() || '').trim(); if (matched) break; }
        }
        content = matched ? matched : '__SKIP__';
      } else {
        content = 'ok';
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
    return;
  }
  if (url === '/form.html' || url === '/') {
    const g = genForm();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Filled-Count': String(g.meta.filledCount), 'X-Total-Count': String(g.meta.total) });
    res.end(g.html);
  } else {
    const f = path.join(__dirname, 'fixtures', url.replace(/^\//, ''));
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(data);
    });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log('E2E 随机表单服务:', 'http://127.0.0.1:' + PORT + '/form.html'));
}
module.exports = { server, PORT, __mockRequests };
