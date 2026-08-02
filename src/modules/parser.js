/**
 * parser.js — 简历本地解析模块 (仅选项页使用)
 * PDF(pdf.js) / DOCX(mammoth) 全部本地解析, 不调用任何外部 API
 * 支持单栏/双栏排版容错 + 结构化提取 + 置信度标注
 */
(function () {
  'use strict';
  const G = (typeof window !== 'undefined') ? window : globalThis;
  const AS = (G.AS = G.AS || {});
  if (AS.parser) return;

  const LOG = () => AS.logger;

  let libsLoading = null;

  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new Error('加载本地解析库失败: ' + url));
      document.head.appendChild(s);
    });
  }

  // 懒加载本地 vendor 库(仅首次解析时)
  async function ensureLibs() {
    if (libsLoading) return libsLoading;
    libsLoading = (async () => {
      if (!window.pdfjsLib) {
        await loadScript(chrome.runtime.getURL('src/assets/vendor/pdfjs/pdf.js'));
      }
      if (!window.mammoth) {
        await loadScript(chrome.runtime.getURL('src/assets/vendor/mammoth/mammoth.browser.js'));
      }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('src/assets/vendor/pdfjs/pdf.worker.js');
      return { pdfjsLib: window.pdfjsLib, mammoth: window.mammoth };
    })();
    return libsLoading;
  }

  // ---------- 文本抽取 ----------
  async function extractPDF(file) {
    const { pdfjsLib } = await ensureLibs();
    const buf = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    const lines = [];
    const width = (await doc.getPage(1)).getViewport({ scale: 1 }).width;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // 文本项带坐标, 用于双栏检测
      const items = content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => {
          const t = it.transform;
          return { str: it.str, x: t[4], y: t[5], w: (it.width || 0) };
        });
      const pageLines = groupLines(items);
      const ordered = orderColumns(pageLines, width);
      ordered.forEach((ln) => lines.push(ln));
    }
    await doc.destroy();
    return { text: lines.join('\n'), lines, pdfWidth: width };
  }

  // 按 y 聚类成行(容错字体基线差)
  function groupLines(items) {
    const sorted = items.slice().sort((a, b) => b.y - a.y); // PDF y 向下
    const lines = [];
    for (const it of sorted) {
      let found = null;
      for (const ln of lines) {
        if (Math.abs(ln.y - it.y) <= (ln.size || 4)) { found = ln; break; }
      }
      if (!found) {
        lines.push({ y: it.y, size: 4, items: [it] });
      } else {
        found.y = (found.y * found.items.length + it.y) / (found.items.length + 1);
        found.items.push(it);
      }
    }
    return lines
      .map((ln) => {
        ln.items.sort((a, b) => a.x - b.x);
        ln.text = ln.items.map((i) => i.str).join('').replace(/\s+/g, ' ').trim();
        ln.minX = Math.min(...ln.items.map((i) => i.x));
        ln.maxX = Math.max(...ln.items.map((i) => i.x + i.w));
        return ln;
      })
      .filter((ln) => ln.text)
      .sort((a, b) => a.y - b.y);
  }

  // 双栏排版容错: 检测两列并逐列读取
  function orderColumns(lines, pageWidth) {
    if (lines.length < 6) return lines.map((l) => l.text);
    const starts = lines.filter((l) => l.maxX - l.minX < pageWidth * 0.75).map((l) => l.minX);
    if (!starts.length) return lines.map((l) => l.text);
    const sortedStarts = starts.slice().sort((a, b) => a - b);
    const p30 = sortedStarts[Math.floor(sortedStarts.length * 0.3)];
    const p70 = sortedStarts[Math.floor(sortedStarts.length * 0.7)];
    const gap = p70 - p30;
    if (gap > pageWidth * 0.18) {
      const mid = (p30 + p70) / 2;
      const left = lines.filter((l) => l.minX < mid);
      const right = lines.filter((l) => l.minX >= mid);
      if (left.length >= 3 && right.length >= 3) {
        return left.map((l) => l.text).concat(right.map((l) => l.text));
      }
    }
    return lines.map((l) => l.text);
  }

  async function extractDOCX(file) {
    const { mammoth } = await ensureLibs();
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return { text: result.value || '', lines: (result.value || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0) };
  }

  async function parseFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.pdf')) {
      const r = await extractPDF(file);
      return { format: 'pdf', text: r.text, lines: r.lines };
    }
    if (name.endsWith('.docx')) {
      const r = await extractDOCX(file);
      return { format: 'docx', text: r.text, lines: r.lines };
    }
    if (name.endsWith('.doc')) {
      throw new Error('暂不支持旧版 .doc 格式, 请另存为 .docx 后重试');
    }
    throw new Error('仅支持 PDF / DOCX 格式简历');
  }

  // ---------- 结构化提取 ----------
  const SECTION_RE = /^(基本信息|个人信息|教育经历|教育背景|实习经历|实习经验|工作经历|工作经验|项目经历|项目经验|专业技能|技能证书|技能|证书|获奖经历|所获荣誉|荣誉奖项|自我评价|个人评价|求职意向|校园经历|培训经历|语言能力)$/;

  function cleanLine(s) {
    return String(s || '').replace(/[\u3000\s·•●◆→▪]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function matchDateRange(s) {
    const m = String(s).match(/((?:19|20)\d{2})\s*[年.\/]?\s*(\d{1,2})?\s*月?\s*[-—~至到]\s*((?:19|20)\d{2})\s*[年.\/]?\s*(\d{1,2})?\s*月?/);
    if (m) return { startY: m[1], startM: m[2] || '', endY: m[3], endM: m[4] || '' };
    const m2 = String(s).match(/((?:19|20)\d{2})\s*[年.\/]?\s*(\d{1,2})?\s*月?\s*[-—~至到]\s*(?:至今|现在|目前|now|present|今)/i);
    if (m2) return { startY: m2[1], startM: m2[2] || '', endY: '至今', endM: '' };
    return null;
  }

  function guessDegree(s) {
    const t = String(s);
    if (/博士/.test(t)) return '博士';
    if (/硕士/.test(t)) return '硕士';
    if (/本科|学士/.test(t)) return '本科';
    if (/大专|专科|高职/.test(t)) return '大专';
    if (/高中|中专/.test(t)) return '高中';
    return '';
  }

  function structure(lines) {
    const conf = {};   // fieldKey -> 'high'|'medium'|'low'
    const warnings = [];
    const out = {
      basic: {}, education: [], internship: [], project: [], skills: {},
      intent: {}, openQuestions: [],
    };
    const set = (cat, key, value, confidence) => {
      if (value === undefined || value === null || value === '') return;
      out[cat][key] = String(value).trim();
      conf[cat + '.' + key] = confidence || 'medium';
    };
    const setBasic = (key, v, c) => set('basic', key, v, c);

    let section = 'basic';
    let pendingEdu = null;
    let pendingInt = null;
    let pendingProj = null;
    let intro = '';

    for (const raw of lines) {
      const line = cleanLine(raw);
      if (!line) continue;
      // 章节检测(去冒号)
      const bare = line.replace(/[:：]\s*$/, '');
      if (SECTION_RE.test(bare)) {
        section = bare.includes('教育') ? 'education' :
          bare.includes('实习') || bare.includes('工作') ? 'internship' :
            bare.includes('项目') ? 'project' :
              bare.includes('自我评价') || bare.includes('个人评价') ? 'intro' :
                bare.includes('技能') || bare.includes('证书') ? 'skills' :
                  bare.includes('获奖') || bare.includes('荣誉') ? 'skills' :
                    bare.includes('求职意向') ? 'intent' : 'basic';
        continue;
      }
      // 标签剥离: "姓名: 张三"
      const labeled = line.match(/^(姓名|真实姓名)\s*[:：]\s*(\S{2,20})$/);
      if (labeled && section === 'basic') {
        setBasic('name', labeled[2], 'high');
        continue;
      }

      if (section === 'basic') {
        // 手机
        const phoneM = line.match(/(?<!\d)1[3-9]\d{9}(?!\d)/);
        if (phoneM) { setBasic('phone', phoneM[0], 'high'); continue; }
        const emailM = line.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
        if (emailM) { setBasic('email', emailM[0], 'high'); continue; }
        const idM = line.match(/\b\d{17}[\dXx]\b/);
        if (idM) { setBasic('idCard', idM[0], 'high'); continue; }
        const gM = line.match(/(?:性别|sex|gender)\s*[:：]\s*(男|女)/i);
        if (gM) { setBasic('gender', gM[1] === '男' ? '男' : '女', 'high'); continue; }
        const bM = line.match(/(?:出生(?:日期|年月|时间)?|birthday|date\s*of\s*birth)\s*[:：]?\s*(((?:19|20)\d{2})\s*[年.\/]\s*\d{1,2}\s*月?(?:\s*\d{1,2}\s*日?)?)/i);
        if (bM) { setBasic('birthday', bM[1].replace(/\s+/g, ''), 'high'); continue; }
        const npM = line.match(/(?:籍贯|出生地|户籍|hometown|native\s*place)\s*[:：]\s*(\S{2,20})/i);
        if (npM) { setBasic('nativePlace', npM[1], 'medium'); continue; }
        const locM = line.match(/(?:现居地|现居住地|居住地|所在地|城市|location)\s*[:：]\s*(\S{2,20})/i);
        if (locM) { setBasic('currentLocation', locM[1], 'medium'); continue; }
        const polM = line.match(/(?:政治面貌)\s*[:：]\s*(中共党员|中共预备党员|共青团员|党员|团员|群众)/);
        if (polM) { setBasic('politicalStatus', polM[1] === '党员' ? '中共党员' : polM[1] === '团员' ? '共青团员' : polM[1], 'medium'); continue; }
        // 姓名兜底: 首行且 2-4 字, 非数字非邮箱
        if (!out.basic.name && /^[\u4e00-\u9fa5·]{2,4}$/.test(line)) {
          setBasic('name', line, 'low');
          warnings.push('姓名由首行推断, 请核对');
        }
        continue;
      }

      if (section === 'education') {
        const range = matchDateRange(line);
        if (range) {
          if (pendingEdu) {
            out.education.push(pendingEdu);
            Object.keys(pendingEdu).forEach((k) => { if (pendingEdu[k]) conf['education.school'] = conf['education.school'] || 'medium'; });
          }
          pendingEdu = { school: '', degree: '', major: '', eduStart: `${range.startY}${range.startM ? '-' + range.startM : ''}`, eduEnd: range.endY === '至今' ? '' : `${range.endY}${range.endM ? '-' + range.endM : ''}` };
          const rest = line.replace(/^\s*((?:19|20)\d{2}).*?[-—~至到].*?((?:19|20)\d{2})\S*\s*/, ' ');
          if (rest) {
            const schoolM = rest.match(/([\u4e00-\u9fa5A-Za-z0-9·]+?(?:大学|学院|学校|研究院|科学院|学院校|大学院校))/);
            if (schoolM) pendingEdu.school = schoolM[1];
            const deg = guessDegree(rest);
            if (deg) pendingEdu.degree = deg;
            const rest2 = rest.replace(schoolM ? schoolM[0] : '', '').replace(/(博士|硕士|本科|学士|大专|专科|高职|研究生)/g, '').replace(/[\u4e00-\u9fa5]*(大学|学院)/, '');
            pendingEdu.major = rest2.replace(/^[·|｜\s]*/, '').slice(0, 40);
          }
          continue;
        }
        if (pendingEdu) {
          const schoolM = line.match(/([\u4e00-\u9fa5A-Za-z0-9·]+?(?:大学|学院|学校|研究院))/);
          if (schoolM && !pendingEdu.school) { pendingEdu.school = schoolM[1]; line.replace(schoolM[0], ''); }
          const deg = guessDegree(line);
          if (deg && !pendingEdu.degree) pendingEdu.degree = deg;
          if (!pendingEdu.major && !schoolM && line.length <= 40 && !/[，。;；]/.test(line) && !/^[0-9]/.test(line)) {
            pendingEdu.major = line;
          } else if (/GPA|绩点|排名/.test(line)) {
            const g = line.match(/(?:GPA|绩点)\s*[:：]?\s*([\d.]+)/i);
            if (g && !pendingEdu.gpa) pendingEdu.gpa = g[1];
          }
        }
        continue;
      }

      if (section === 'internship') {
        const range = matchDateRange(line);
        if (range || (line.length >= 4 && /公司|集团|科技|有限|网络|银行|证券|保险|事务所/.test(line))) {
          if (pendingInt) out.internship.push(pendingInt);
          pendingInt = {
            intCompany: '', intDepartment: '', intPosition: '', intStart: '', intEnd: '',
            workContent: '', achievements: '',
          };
          if (range) { pendingInt.intStart = `${range.startY}${range.startM ? '-' + range.startM : ''}`; pendingInt.intEnd = range.endY === '至今' ? '' : `${range.endY}${range.endM ? '-' + range.endM : ''}`; }
          const rest = line.replace(/^\s*((?:19|20)\d{2}).*?[-—~至到].*?((?:19|20)\d{2})\S*\s*/, ' ');
          const companyM = rest.match(/([\u4e00-\u9fa5A-Za-z0-9·（）()]+?(?:公司|集团|科技|网络|银行|证券|保险|事务所|研究院|中心|部|局))/) || rest.match(/^([\u4e00-\u9fa5A-Za-z0-9·（）()]{2,30})$/);
          if (companyM) pendingInt.intCompany = companyM[1];
          const posM = rest.match(/(?:担任|任职|岗位|职位|实习)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9/（）()]{2,20})/);
          if (posM) pendingInt.intPosition = posM[1];
          continue;
        }
        if (pendingInt) {
          const posM = line.match(/^([\u4e00-\u9fa5A-Za-z0-9/（）()·]{2,16})(?:实习生|工程师|专员|助理|分析师|顾问|实习)?$/);
          if (posM && !pendingInt.intPosition && line.length <= 20 && !/[，。；;：:]/.test(line)) {
            pendingInt.intPosition = line;
            continue;
          }
          const dutyM = line.match(/(?:职责|工作内容|负责)\s*[:：]/);
          if (dutyM || (line.length > 10 && !/^[0-9]/.test(line))) {
            pendingInt.workContent = (pendingInt.workContent ? pendingInt.workContent + '; ' : '') + line.slice(0, 100);
          }
        }
        continue;
      }

      if (section === 'project') {
        const looksNew = /^[A-Za-z0-9\u4e00-\u9fa5·（）()]{2,40}$/.test(line) && line.length <= 40 && !/[，。；;：:\.]/.test(line) && !/职责|成果|技术|背景|负责|实现|基于/.test(line);
        if (looksNew && !pendingProj) {
          pendingProj = { projName: line, projRole: '', projDuration: '', projTech: '', projDuty: '', projOutcome: '' };
          continue;
        }
        if (looksNew && pendingProj && pendingProj.projName && pendingProj.projName !== line) {
          out.project.push(pendingProj);
          pendingProj = { projName: line, projRole: '', projDuration: '', projTech: '', projDuty: '', projOutcome: '' };
          continue;
        }
        if (pendingProj) {
          if (/(?:技术|工具|技术栈|stack)\s*[:：]/.test(line)) pendingProj.projTech = line.replace(/.*[:：]/, '').slice(0, 60);
          else if (/(?:职责|负责|工作)\s*[:：]/.test(line)) pendingProj.projDuty = line.replace(/.*[:：]/, '').slice(0, 120);
          else if (/(?:成果|效果|结果|成效)\s*[:：]/.test(line)) pendingProj.projOutcome = line.replace(/.*[:：]/, '').slice(0, 120);
          else if (/(?:角色|担任)\s*[:：]/.test(line)) pendingProj.projRole = line.replace(/.*[:：]/, '').slice(0, 30);
          else if (/(?:周期|时间|起止)\s*[:：]/.test(line)) pendingProj.projDuration = line.replace(/.*[:：]/, '').slice(0, 30);
          else if (line.length > 10 && !pendingProj.projDuty) pendingProj.projDuty = line.slice(0, 120);
        }
        continue;
      }

      if (section === 'skills') {
        const englishM = line.match(/(?:CET[- ]?4|CET[- ]?6|英语四级|英语六级|专业四级|专业八级|雅思|托福|TEM[- ]?4|TEM[- ]?8)/i);
        if (englishM) { set('skills', 'englishLevel', englishM[0].toUpperCase().replace('CET-', 'CET-').replace(/^CET[- ]?4$/, 'CET-4').replace(/^CET[- ]?6$/, 'CET-6'), 'medium'); continue; }
        if (/计算机|国家二级|二级|三级|软考|软件设计师/.test(line)) { set('skills', 'computerLevel', /二级/.test(line) ? '国家二级' : /三级/.test(line) ? '国家三级' : '其他', 'medium'); continue; }
        if (/证书|资格|认证|license|certificate/i.test(line)) { out.skills.certificates = (out.skills.certificates ? out.skills.certificates + '; ' : '') + line.slice(0, 80); continue; }
        if (/奖|荣誉|奖学金/.test(line)) { out.skills.awards = (out.skills.awards ? out.skills.awards + '; ' : '') + line.slice(0, 80); continue; }
        if (line.length > 2 && !/^[\d.]+$/.test(line)) {
          out.skills.certificates = (out.skills.certificates ? out.skills.certificates + '; ' : '') + line.slice(0, 80);
        }
        continue;
      }

      if (section === 'intro') {
        intro += line + '\n';
        continue;
      }

      if (section === 'intent') {
        const posM = line.match(/(?:岗位|职位|求职意向|应聘)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9/（）()·]{2,30})/);
        if (posM) set('intent', 'targetPosition', posM[1], 'medium');
        const cityM = line.match(/(?:城市|地点|地区)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9·、（）()]{2,30})/);
        if (cityM) set('intent', 'targetCity', cityM[1], 'medium');
        continue;
      }
    }

    // 收尾挂载
    if (pendingEdu) { out.education.push(pendingEdu); }
    if (pendingInt) { out.internship.push(pendingInt); }
    if (pendingProj) { out.project.push(pendingProj); }
    if (intro.trim()) {
      out.openQuestions.push({ question: '自我介绍', answer: intro.trim().slice(0, 500) });
      conf['openQuestions.自我介绍'] = 'medium';
    }
    // 去空条目
    ['education', 'internship', 'project'].forEach((k) => {
      out[k] = out[k].filter((e) => Object.values(e).some((v) => v));
    });

    // 姓名置信度兜底
    if (out.basic.name && !conf['basic.name']) conf['basic.name'] = 'low';
    if (!out.basic.phone && !out.basic.email) warnings.push('未识别到联系方式, 请手动补充');

    return { structured: out, confidence: conf, warnings };
  }

  // 解析入口: 返回 { format, text, structured, confidence, warnings }
  async function parseResume(file) {
    LOG().info('parser', 'parse resume', file.name);
    const r = await parseFile(file);
    const s = structure(r.lines);
    return Object.assign(r, s);
  }

  AS.parser = { parseResume, extractPDF, extractDOCX, structure };
})();
