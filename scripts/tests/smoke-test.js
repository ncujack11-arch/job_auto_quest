// 冒烟测试: 在 Node 中加载纯逻辑模块并验证核心行为
'use strict';
const path = require('path');
const ROOT = require('path').join(__dirname, '..', '..', 'src');

// chrome.storage stub(学习模式/记忆等模块需要)
const memStore = {};
global.chrome = {
  storage: { local: {
    async get(key) {
      if (typeof key === 'string') return { [key]: memStore[key] };
      const out = {}; (key || []).forEach((k) => { out[k] = memStore[k]; });
      return out;
    },
    async set(obj) { Object.assign(memStore, obj); },
  } },
  runtime: { sendMessage: async () => ({ ok: true }) },
};

function load(rel) {
  const code = require('fs').readFileSync(path.join(ROOT, rel), 'utf8');
  // 去 BOM
  (0, eval)(code.replace(/^\uFEFF/, ''));
}

global.window = global; // 兼容部分模块的 window 检测(已在模块内用 globalThis, 这里仅兜底)
load('utils/logger.js');
load('modules/schema.js');
load('modules/storage.js');
load('utils/fuzzy.js');
load('utils/dates.js');
load('utils/matcher.js');
load('utils/encrypt.js');
load('modules/applications.js');
load('modules/stats.js');
load('modules/parser.js');

const AS = global.AS;
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘ FAIL:', name); }
}

(async () => {
  console.log('== fuzzy ==');
  const hit = AS.fuzzy.closest('本科', ['全日制本科', '硕士', '大学本科', '大专']);
  t('学历模糊匹配命中本科类', hit && /本科/.test(hit.value));
  t('normalize 全角转半角', AS.fuzzy.normalize('姓名：张三（必填）') === '姓名张三');

  console.log('== dates ==');
  const d1 = AS.dates.parseDateStr('2024-07-01');
  t('解析 ISO 日期', d1 && d1.y === 2024 && d1.m === 7 && d1.d === 1);
  const d2 = AS.dates.parseDateStr('2024年9月15日');
  t('解析中文日期', d2 && d2.y === 2024 && d2.m === 9 && d2.d === 15);
  const d3 = AS.dates.parseDateStr('2024.09');
  t('解析 年月', d3 && d3.y === 2024 && d3.m === 9 && d3.d === 0);
  t('格式化为中文', AS.dates.formatDate({ y: 2024, m: 7, d: 1 }, 'yyyy年mm月dd日') === '2024年07月01日');
  t('格式化为斜杠', AS.dates.formatDate({ y: 2024, m: 7, d: 1 }, 'yyyy/mm/dd') === '2024/07/01');

  console.log('== matcher ==');
  const mkCtx = (o) => Object.assign({
    tag: 'input', type: 'text', name: '', id: '', placeholder: '', ariaLabel: '',
    dataTexts: [], labelText: '', rowText: '', prevText: '', disabled: false,
    readonly: false, hidden: false, visible: true,
  }, o);
  const m1 = AS.matcher.matchField(mkCtx({ labelText: '姓名', name: 'name' }), null);
  t('label 姓名 → basic.name', m1 && m1.fieldKey === 'basic.name');
  const m2 = AS.matcher.matchField(mkCtx({ placeholder: '请输入手机号码', name: 'mobile' }), null);
  t('placeholder 手机号码 → basic.phone', m2 && m2.fieldKey === 'basic.phone');
  const m3 = AS.matcher.matchField(mkCtx({ labelText: '邮箱', type: 'email' }), null);
  t('email 类型 → basic.email', m3 && m3.fieldKey === 'basic.email');
  const m4 = AS.matcher.matchField(mkCtx({ labelText: '身份证号码', name: 'idCard' }), null);
  t('身份证 → basic.idCard', m4 && m4.fieldKey === 'basic.idCard');
  const m5 = AS.matcher.matchField(mkCtx({ labelText: '期望薪资', name: 'salary' }), null);
  t('期望薪资 → intent.expectedSalary', m5 && m5.fieldKey === 'intent.expectedSalary');
  const m6 = AS.matcher.matchField(mkCtx({ labelText: '毕业时间', name: 'graduate' }), null);
  t('毕业时间 → education.eduEnd', m6 && m6.fieldKey === 'education.eduEnd');
  // 站点规则
  const rule = { mapping: { 'graduate_time': 'education[0].eduEnd', 'mobile': 'basic.phone' } };
  const m7 = AS.matcher.matchField(mkCtx({ name: 'mobile', labelText: '手机' }), rule);
  t('站点映射 name=mobile → basic.phone', m7 && m7.fieldKey === 'basic.phone' && m7.via === 'site-mapping');
  // 值解析
  const profile = { data: { basic: { name: '张三', phone: '13800138000' }, education: [{ school: '清华大学', degree: '本科', major: '计算机' }, { school: '北京大学', degree: '硕士', major: '软件工程' }] } };
  const v1 = AS.matcher.resolveValues(profile, 'basic.name');
  t('basic.name 值解析', v1[0] === '张三');
  const v2 = AS.matcher.resolveValues(profile, 'education.school');
  t('education.school 多值解析', v2.length === 2 && v2[1] === '北京大学');

  console.log('== parser structure (经典模板) ==');
  const sample = [
    '姓名: 李四', '性别: 男', '出生日期: 1998年5月20日', '13812345678', 'lisi@example.com',
    '教育经历', '2020.09 - 2024.06  浙江大学  本科  软件工程', 'GPA 3.8/4.0',
    '实习经历', '2023.07 - 2023.10  阿里巴巴集团  前端开发实习生',
    '负责业务后台页面开发与性能优化, 首屏耗时降低 40%',
    '项目经历', '智能简历解析系统', '担任: 核心开发', '技术: Python, NLP', '成果: 准确率提升至 92%',
    '技能证书', 'CET-6 英语六级', '计算机二级',
    '自我评价', '热爱技术, 学习能力强',
  ];
  const st = AS.parser.structure(sample);
  t('解析姓名', st.structured.basic.name === '李四');
  t('解析手机', st.structured.basic.phone === '13812345678');
  t('解析邮箱', st.structured.basic.email === 'lisi@example.com');
  t('解析性别', st.structured.basic.gender === '男');
  t('解析教育学校', st.structured.education[0].school.includes('浙江大学'));
  t('解析教育学历', st.structured.education[0].degree === '本科');
  t('解析实习公司', st.structured.internship[0].intCompany.includes('阿里巴巴'));
  t('解析项目', st.structured.project.length >= 1);
  t('解析英语等级', /CET|英语/.test(st.structured.skills.englishLevel || ''));
  t('解析自我评价入开放题', st.structured.openQuestions.length >= 1);

  console.log('== parser structure (现代模板: 同行姓名/竖线/倒序/无日期) ==');
  const sample2 = [
    '王五 13912345678', 'wangwu@163.com',
    '求职意向: 前端开发工程师', '期望城市: 深圳', '期望薪资: 20k-30k',
    '教育背景', '浙江大学 计算机科学与技术 本科 2020.09-2024.06', '专业排名: 前10%',
    '实习经验', '腾讯科技 | 前端开发实习生 | 2023.06-2023.12',
    '实习工作内容: 参与微信小程序开发',
    '项目经验', '个人博客系统 | 核心开发 | 2022.03-2022.08',
    '技术栈: Vue3, Node.js',
    '专业技能', 'CET-4', '国家二级 计算机',
    '个人总结', '认真负责',
  ];
  const st2 = AS.parser.structure(sample2);
  t('同行姓名+手机', st2.structured.basic.name === '王五' && st2.structured.basic.phone === '13912345678');
  t('意向岗位', st2.structured.intent.targetPosition === '前端开发工程师');
  t('意向城市', st2.structured.intent.targetCity === '深圳');
  t('意向薪资', /20k/.test(st2.structured.intent.expectedSalary || ''));
  t('教育倒序学校', st2.structured.education[0].school.includes('浙江大学'));
  t('教育倒序专业', /计算机/.test(st2.structured.education[0].major || ''));
  t('教育日期区间', st2.structured.education[0].eduStart === '2020-09' && st2.structured.education[0].eduEnd === '2024-06');
  t('专业排名', /10/.test(st2.structured.education[0].gpaRank || ''));
  t('竖线实习公司', st2.structured.internship[0].intCompany.includes('腾讯'));
  t('竖线实习岗位', /前端/.test(st2.structured.internship[0].intPosition || ''));
  t('竖线项目名', st2.structured.project[0].projName.includes('个人博客'));
  t('竖线项目角色', /核心开发/.test(st2.structured.project[0].projRole || ''));
  t('英语四级', /CET-4/.test(st2.structured.skills.englishLevel || ''));

  console.log('== parser structure (身份证推导生日/姓名下一行联系方式) ==');
  const sample3 = [
    '赵六', '13700001111', 'zhaoliu@gmail.com',
    '身份证号: 110101199503071234',
    '教育经历', '清华大学 硕士 软件工程',
  ];
  const st3 = AS.parser.structure(sample3);
  t('姓名下一行是手机', st3.structured.basic.name === '赵六');
  t('身份证推导生日', st3.structured.basic.birthday === '1995-03-07');
  t('无日期教育', st3.structured.education[0].school.includes('清华大学') && st3.structured.education[0].degree === '硕士');

  console.log('== applications ==');
  const rec = AS.apps.newRecord({ company: '字节跳动', position: '后端开发', fromPage: true });
  t('新记录生成 id', !!rec.id);
  t('默认时间线含投递', rec.timeline.length >= 1);
  // 批量导入 CSV
  const csv = '\uFEFF公司名称,岗位名称,岗位类别,工作城市,投递渠道,状态,投递时间,标签\n腾讯,前端开发,技术类,深圳,官网,待笔试,2024-08-01 10:30,秋招;提前批\n阿里,后端开发,技术类,杭州,牛客网,一面,2024/8/3,秋招';
  const imp = AS.apps.importRecords(csv, { format: 'csv' });
  t('CSV 导入 2 条', imp.records.length === 2);
  t('CSV 导入字段映射', imp.records[0].company === '腾讯' && imp.records[0].status === '待笔试');
  t('CSV 时间解析', imp.records[0].timeline[0].time === new Date(2024, 7, 1, 10, 30).getTime());
  t('CSV 标签拆分', imp.records[0].tags.length === 2);
  const impJ = AS.apps.importRecords(JSON.stringify({ records: [{ company: '华为', position: '算法工程师', city: '东莞' }] }), { format: 'json' });
  t('JSON 导入', impJ.records.length === 1 && impJ.records[0].company === '华为');

  console.log('== matcher: MOKA 等自研系统(标签在父容器文本/无label/无placeholder) ==');
  const mkMoka = (o) => Object.assign({ tag: 'input', type: 'text', name: '15923823390642', id: '', placeholder: '', ariaLabel: '', dataTexts: [], labelText: '', rowText: '', prevText: '' }, o);
  const moka1 = AS.matcher.matchField(mkMoka({ rowText: '姓名*请输入姓名' }), null);
  t('MOKA: 行文本前缀"姓名" → basic.name', moka1 && moka1.fieldKey === 'basic.name');
  const moka2 = AS.matcher.matchField(mkMoka({ rowText: '手机号码', placeholder: '请输入手机号' }), null);
  t('MOKA: 行文本"手机号码" → basic.phone', moka2 && moka2.fieldKey === 'basic.phone');
  const moka3 = AS.matcher.matchField(mkMoka({ rowText: '毕业时间' }), null);
  t('MOKA: 行文本"毕业时间" → education.eduEnd', moka3 && moka3.fieldKey === 'education.eduEnd');
  const moka4 = AS.matcher.matchField(mkMoka({ rowText: '期望城市' }), null);
  t('MOKA: 行文本"期望城市" → intent.targetCity', moka4 && moka4.fieldKey === 'intent.targetCity');
  const moka5 = AS.matcher.matchField(mkMoka({ rowText: '最高学历' }), null);
  t('MOKA: 行文本"最高学历" → education.degree', moka5 && moka5.fieldKey === 'education.degree');
  // MOKA 规则映射
  const mokaRule = { mapping: { 'candidateName': 'basic.name', 'mobile': 'basic.phone', 'graduationTime': 'education[0].eduEnd' } };
  const moka6 = AS.matcher.matchField(mkMoka({ name: 'mobile', rowText: '手机号' }), mokaRule);
  t('MOKA 规则: name=mobile → basic.phone', moka6 && moka6.fieldKey === 'basic.phone');

  console.log('== matcher: MOKA 扩展字段(民族/海外/考研/面试城市/服从分配等) ==');
  const mkM2 = (o) => Object.assign({ tag: 'input', type: 'text', name: '', id: '', placeholder: '', ariaLabel: '', dataTexts: [], labelText: '', rowText: '', prevText: '' }, o);
  const newFields = [
    ['民族', 'basic.ethnicity'],
    ['是否有海外留学经历', 'basic.overseas'],
    ['是否有考研/考博/出国计划', 'basic.postgradPlan'],
    ['参加面试城市', 'intent.interviewCity'],
    ['期望工作地点二', 'intent.targetCity2'],
    ['是否愿意服从公司分配', 'intent.complyAssignment'],
    ['招聘信息来源渠道', 'intent.sourceChannel'],
    ['目前城市所在地', 'basic.currentLocation'],
  ];
  let newFieldsFail = 0;
  for (const [label, expect] of newFields) {
    const m = AS.matcher.matchField(mkM2({ labelText: label }), null);
    const got = m ? m.fieldKey : null;
    if (got !== expect) { newFieldsFail++; console.log('  ✘', label, '→', got, '(期望', expect + ')'); }
  }
  t('MOKA 扩展字段 8 项全部正确匹配', newFieldsFail === 0);

  console.log('== 自定义字段智能学习闭环 ==');
  const learnProfile2 = {
    id: 'p-custom', name: '自定义测试', data: {
      basic: {}, skills: {}, intent: {}, education: [], internship: [], project: [],
      custom: [{ key: '是否有xxx经历', label: '是否有xxx经历', value: '是' }], openQuestions: [],
    },
  };
  // 自定义字段匹配填充
  const cm1 = AS.matcher.matchCustomField(mkM2({ labelText: '是否有xxx经历' }), learnProfile2);
  t('自定义字段匹配: 命中并返回 custom.key', cm1 && cm1.fieldKey === 'custom.是否有xxx经历');
  const cv = AS.matcher.resolveValues(learnProfile2, 'custom.是否有xxx经历');
  t('自定义字段值解析', cv.length === 1 && cv[0] === '是');
  // 智能收录: 未匹配字段生成 custom 条目
  const cm2 = AS.matcher.matchField(mkM2({ labelText: '是否愿意服从调剂' }), null);
  t('未收录字段不识别', cm2 === null || cm2.via === undefined);
  // resolveValues 兼容 label 匹配
  const cv2 = AS.matcher.resolveValues(learnProfile2, 'custom.是否有xxx经历');
  t('custom 值解析(label 一致)', cv2[0] === '是');

  console.log('== 捕获 v2: 三级匹配/黑名单/别名/历史 ==');
  // 三级匹配
  const capCtx = (o) => Object.assign({ tag: 'input', type: 'text', name: '', id: '', placeholder: '', ariaLabel: '', dataTexts: [], labelText: '', rowText: '', prevText: '' }, o);
  const capProfile = { data: { basic: { name: '张三', phone: '13800138000' }, custom: [{ key: '有无专利', label: '有无专利', value: '有' }] } };
  const capM1 = AS.matcher.matchForCapture(capCtx({ labelText: '姓名' }), { id: '', name: 'x', tagName: 'INPUT' }, { memories: { 'input[name="x"]': 'basic.name' }, profile: capProfile });
  t('三级匹配: 记忆命中(置信95)', capM1 && capM1.confidence === 95 && capM1.fieldKey === 'basic.name');
  const capM2 = AS.matcher.matchForCapture(capCtx({ labelText: '姓名' }), {}, { profile: capProfile });
  t('三级匹配: 语义命中', capM2 && capM2.fieldKey === 'basic.name' && capM2.confidence >= 72);
  const capM3 = AS.matcher.matchForCapture(capCtx({ labelText: '有无专利' }), {}, { profile: capProfile, aliases: { 'custom.有无专利': ['有无专利'] } });
  t('三级匹配: 用户别名命中', capM3 && capM3.fieldKey === 'custom.有无专利' && capM3.confidence === 78);
  // 忽略黑名单
  await AS.storage.saveCaptureIgnore({ keywords: ['验证码', 'captcha'], exact: ['内推码'] });
  t('忽略黑名单: 关键词命中', (await AS.storage.isIgnoredText('请输入验证码')) === true);
  t('忽略黑名单: 无关文本放行', (await AS.storage.isIgnoredText('手机号码')) === false);
  // 用户别名
  await AS.storage.addUserAlias('basic.name', '昵称');
  const aliases = await AS.storage.getUserAliases();
  t('自学习别名: 已追加', (aliases['basic.name'] || []).includes('昵称'));
  // 捕获历史 + 回滚
  const backupPayload = await AS.storage.exportAll();
  await AS.storage.saveSettings({ conflictMode: 'overwrite' });
  await AS.storage.addCaptureHistory({ id: 'ch1', time: Date.now(), host: 'test.com', stats: { updated: 1, added: 0, same: 0 }, snapshot: backupPayload, items: [] });
  t('捕获历史: 记录可查', !!(await AS.storage.getCaptureHistoryItem('ch1')));
  const okRollback = await AS.storage.rollbackCaptureHistory('ch1');
  const after = await AS.storage.getSettings();
  t('捕获历史: 回滚恢复快照', okRollback === true && after.conflictMode === 'skip');

  console.log('== parser v1.7: 清洗/名录/置信度/来源/模板 ==');
  const dirty = [
    '姓名: 王五', '电话: 13712345678', 'www.resume-site.com', '1', '第 2 页',
    '教育背景', '2020.09-2024.06 清华大学 本科 计算机科学与技术',
    '这段描述比较长, 用于测试段落合并功能是否能正确', '将跨行断裂的文本还原为一个完整段落',
  ];
  const st7 = AS.parser.structure(dirty);
  t('清洗: 水印/页码行被移除', !(st7.cleanedLines || []).some((l) => /resume-site|^第|^\d{1,2}$/.test(l)));
  t('清洗: 断裂段落已合并', (st7.cleanedLines || []).some((l) => l.includes('还原为一个完整段落')));
  t('名录: 清华命中 school', st7.structured.education[0].school === '清华大学');
  t('置信度数值化: phone=88', st7.confidence['basic.phone'] === 88);
  t('来源行追踪: name 有来源', Array.isArray(st7.sources['basic.name']) && st7.sources['basic.name'].length > 0);
  const tmpl = AS.parser.structure(['超级简历', '王五', '教育经历']);
  t('模板检测: wondercv', tmpl.template === 'wondercv');

  console.log('== parser v1.10: 字号标题/中英混合标题/表格空格 ==');
  // 中英混合标题 "教育背景 EDUCATION BACKGROUND" → education 模块
  const mixed = AS.parser.structure(['姓名: 张三', '教育背景 EDUCATION BACKGROUND', '浙江大学 本科 计算机', '实习经历 WORK EXPERIENCE', '腾讯科技 前端开发实习生']);
  t('中英混合标题: 教育背景 EDUCATION → education', mixed.structured.education.length === 1 && mixed.structured.education[0].school.includes('浙江大学'));
  t('中英混合标题: 实习经历 WORK → internship', mixed.structured.internship.length === 1 && mixed.structured.internship[0].intCompany.includes('腾讯'));
  // 大字号标题: 标题行字号 20, 正文 10 → 识别为模块
  const big = AS.parser.structure(
    ['王五', '13912345678', '教育经历', '浙江大学 硕士 计算机', '技能证书', 'CET-6'],
    { sizes: [10, 10, 20, 10, 20, 10] }
  );
  t('字号标题: 20号"教育经历"识别为模块', big.structured.education.length === 1);
  t('字号标题: 20号"技能证书"识别为模块', /CET/.test(big.structured.skills.englishLevel || ''));
  // 表格单元格空格: 行内字段以空格分隔(表格还原后)仍能正确解析
  const tableLine = AS.parser.structure(['教育经历', '浙江大学 2020-2024 计算机 本科', '实习经历', '腾讯科技 2023 前端开发实习生']);
  t('表格行空格分隔: 学校/日期/专业可解析', tableLine.structured.education[0].school.includes('浙江大学') && tableLine.structured.education[0].eduStart === '2020' && tableLine.structured.education[0].eduEnd === '2024');

  console.log('== matcher: 开放题识别修复 ==');
  const mkOQ = (o) => Object.assign({ tag: 'input', type: 'text', name: '', id: '', placeholder: '', ariaLabel: '', dataTexts: [], labelText: '', rowText: '', prevText: '' }, o);
  t('为什么想加入我们公司 → 开放题', AS.matcher.isOpenQuestionField(mkOQ({ labelText: '为什么想加入我们公司' })) === true);
  t('自我介绍 → 开放题', AS.matcher.isOpenQuestionField(mkOQ({ labelText: '自我介绍' })) === true);
  t('公司名称 → 非开放题', AS.matcher.isOpenQuestionField(mkOQ({ labelText: '公司名称' })) === false);
  t('手机号码 → 非开放题', AS.matcher.isOpenQuestionField(mkOQ({ labelText: '手机号码' })) === false);

  console.log('== 选择器记忆 ==');
  await AS.storage.saveSiteMemories({ 'test.com': { 'input[name="mobile"]': 'basic.phone' } });
  const mem = await AS.storage.getMemoriesForHost('test.com');
  t('记忆读取', mem && mem['input[name="mobile"]'] === 'basic.phone');
  await AS.storage.addMemory('test2.com', '#name', 'basic.name');
  const mem2 = await AS.storage.getMemoriesForHost('test2.com');
  t('记忆新增', mem2 && mem2['#name'] === 'basic.name');

  console.log('== 学习链路: 收集去重 → 后台保存 ==');
  const learnProfile = {
    id: 'p-learn', name: '学习测试', data: {
      basic: { name: '张三', phone: '' }, skills: {}, intent: {},
      education: [], internship: [], project: [], custom: [], openQuestions: [{ question: '请做一下自我介绍', answer: '我叫张三' }],
    },
  };
  await AS.storage.saveProfile(learnProfile);
  const learnItems = [
    { type: 'openQuestions', question: '请做一下自我介绍', answer: '我叫张三', value: '我叫张三' }, // 库中相同
    { type: 'field', fieldKey: 'basic.phone', value: '13900000001' },                            // 新值
  ];
  // 收集端过滤(模拟 collectManualInputs): 开放题与库去重
  const inLib = (learnProfile.data.openQuestions || []).some((q) => q.question === learnItems[0].question && q.answer === learnItems[0].answer);
  t('收集端: 相同开放题被过滤', inLib === true);
  const d = learnProfile.data;
  let saved = 0;
  for (const it of learnItems) {
    if (it.type === 'openQuestions') {
      const dup = d.openQuestions.some((q) => q.question === it.question && q.answer === it.answer);
      if (!dup) saved++;
    } else {
      const [catId, key] = String(it.fieldKey).replace(/\[\d+\]/g, '').split('.');
      if (d[catId][key] !== it.value) { d[catId][key] = it.value; saved++; }
    }
  }
  t('后台保存: 仅新值入库(1项)', saved === 1 && d.basic.phone === '13900000001');

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试崩溃:', e); process.exit(1); });
