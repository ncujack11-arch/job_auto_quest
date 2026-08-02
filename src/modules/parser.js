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
    const lineSizes = [];
    const width = (await doc.getPage(1)).getViewport({ scale: 1 }).width;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // 文本项带坐标与字号(height), 用于双栏检测 / 表格还原 / 标题识别
      const items = content.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => {
          const t = it.transform;
          return { str: it.str, x: t[4], y: t[5], w: (it.width || 0), h: (it.height || 10) };
        });
      const pageLines = groupLines(items);
      const ordered = orderColumns(pageLines, width);
      ordered.forEach((ln) => {
        lines.push(ln.text);
        lineSizes.push(ln.size || 10);
      });
    }
    await doc.destroy();
    return { text: lines.join('\n'), lines, lineSizes, pdfWidth: width };
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
        // 表格/分栏单元格边界还原: 同行文本块间有明显横向间隙时插入空格, 避免单元格内容粘连
        let text = '';
        let prevEnd = null;
        for (const it of ln.items) {
          if (prevEnd !== null && it.x - prevEnd > 6) text += ' ';
          text += it.str;
          prevEnd = it.x + it.w;
        }
        ln.text = text.replace(/\s+/g, ' ').trim();
        ln.minX = Math.min(...ln.items.map((i) => i.x));
        ln.maxX = Math.max(...ln.items.map((i) => i.x + i.w));
        // 行字号: 取该行最大字号(标题行通常更大)
        ln.size = Math.max(...ln.items.map((i) => i.h || 10));
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
  const SECTION_RE = /^(基本信息|个人信息|基本资料|个人资料|教育经历|教育背景|教育情况|学习经历|学习情况|教育及培训|实习经历|实习经验|工作经历|工作经验|实习及工作经历|工作实习经历|社会实践|项目经历|项目经验|科研经历|科研项目|参与项目|专业技能|技能证书|技能特长|个人技能|专业技能|技能|证书|获奖经历|所获荣誉|所获奖励|荣誉奖项|荣誉|奖项|自我评价|个人评价|个人总结|个人简介|自我介绍|求职意向|校园经历|培训经历|语言能力|教育培训)$/;

  // 国内高校名录(985/211 及常见院校, 命中即高置信)
  const UNIVERSITIES = [
    '北京大学', '清华大学', '复旦大学', '上海交通大学', '浙江大学', '南京大学', '中国科学技术大学', '哈尔滨工业大学',
    '西安交通大学', '中国人民大学', '北京航空航天大学', '北京理工大学', '北京师范大学', '南开大学', '天津大学',
    '大连理工大学', '吉林大学', '同济大学', '华东师范大学', '东南大学', '厦门大学', '山东大学', '中国海洋大学',
    '武汉大学', '华中科技大学', '湖南大学', '中南大学', '中山大学', '华南理工大学', '四川大学', '电子科技大学',
    '重庆大学', '西北工业大学', '兰州大学', '东北大学', '国防科技大学', '中央民族大学', '中国农业大学', '西北农林科技大学',
    '北京交通大学', '北京工业大学', '北京科技大学', '北京化工大学', '北京邮电大学', '北京林业大学', '北京中医药大学',
    '首都师范大学', '北京外国语大学', '中国传媒大学', '中央财经大学', '对外经济贸易大学', '中国政法大学', '华北电力大学',
    '天津医科大学', '河北工业大学', '太原理工大学', '内蒙古大学', '辽宁大学', '大连海事大学', '延边大学', '东北师范大学',
    '哈尔滨工程大学', '东北农业大学', '东北林业大学', '华东理工大学', '东华大学', '上海外国语大学', '上海财经大学',
    '上海大学', '南京航空航天大学', '南京理工大学', '中国矿业大学', '河海大学', '江南大学', '南京农业大学',
    '中国药科大学', '南京师范大学', '安徽大学', '合肥工业大学', '福州大学', '南昌大学', '郑州大学', '中国地质大学',
    '武汉理工大学', '华中农业大学', '华中师范大学', '中南财经政法大学', '湘潭大学', '湖南师范大学', '暨南大学',
    '华南师范大学', '海南大学', '广西大学', '西南交通大学', '西南财经大学', '四川农业大学', '西南大学', '贵州大学',
    '云南大学', '西北大学', '西安电子科技大学', '长安大学', '陕西师范大学', '青海大学', '宁夏大学', '新疆大学', '石河子大学',
    '中国科学院大学', '南方科技大学', '上海科技大学', '深圳大学', '杭州电子科技大学', '南京邮电大学', '重庆邮电大学',
    '广州大学', '浙江工业大学', '浙江理工大学', '宁波大学', '江苏大学', '扬州大学', '青岛大学', '济南大学',
    '西南政法大学', '华东政法大学', '上海理工大学', '上海海事大学', '上海师范大学', '首都经济贸易大学',
    '北京工商大学', '天津财经大学', '南京财经大学', '浙江财经大学', '江西财经大学', '东北财经大学', '广东外语外贸大学',
    '西安外国语大学', '四川外国语大学', '重庆理工大学', '武汉科技大学', '湖北大学', '长沙理工大学', '昆明理工大学',
    '桂林电子科技大学', '西安邮电大学', '四川师范大学', '重庆师范大学', '河北大学', '山西大学', '河南大学',
    '华南农业大学', '福建师范大学', '安徽师范大学', '哈尔滨师范大学', '曲阜师范大学', '山东师范大学', '江苏师范大学',
    '温州大学', '安徽工业大学', '南京工业大学', '上海工程技术大学', '武汉工程大学', '西安理工大学', '沈阳工业大学',
    '燕山大学', '浙江工商大学', '重庆工商大学', '山西财经大学', '北京信息科技大学', '北方工业大学', '北京建筑大学',
    '天津理工大学', '南京信息工程大学', '成都信息工程大学', '沈阳航空航天大学', '南昌航空大学', '中国民航大学',
    '北京语言大学', '上海对外经贸大学', '外交学院', '国际关系学院', '北京第二外国语学院', '大连外国语大学',
  ];

  // 常见企业后缀词(公司名判定辅助)
  const COMPANY_SUFFIX = /公司|集团|科技|网络|银行|证券|保险|基金|事务所|研究院|设计院|事务所|传媒|通信|电子|汽车|航空|能源|制药|生物|医疗|软件|信息|数据|智造|控股|有限|股份/;

  // 简历模板特征检测
  function detectTemplate(text) {
    const t = String(text || '');
    if (/超级简历|wondercv|简历小助手/i.test(t)) return 'wondercv';
    if (/实习僧简历|shixiseng/i.test(t)) return 'shixiseng';
    if (/猎聘|liepin/i.test(t)) return 'liepin';
    if (/极简简历|jianli|minimal resume/i.test(t)) return 'minimal';
    return '';
  }

  function cleanLine(s) {
    return String(s || '').replace(/[\u3000\s·•●◆→▪]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  // 清洗: 去除页码/纯数字行/水印/页眉页脚
  function isNoiseLine(line, freq) {
    if (!line) return true;
    if (/^(\d{1,3}|第\s*\d+\s*页|page\s*\d+|-\s*\d+\s*-)$/i.test(line)) return true; // 页码
    if (/^[a-zA-Z0-9.\/_-]{8,}$/.test(line) && /\.(com|cn|net|org|cc|io|me|info|top|xyz|co|edu)$/i.test(line)) return true; // 水印网址
    if (freq && freq[line] >= 3) return true; // 重复出现的页眉页脚/水印
    return false;
  }

  // 段落合并: 上一行长句未终止且当前行是延续文本时拼接(排除标题/标签/日期/联系方式/学校公司行)
  function mergeBrokenLines(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i];
      if (!out.length) { out.push(cur); continue; }
      const prev = out[out.length - 1];
      const canMerge = prev.length >= 15 && !/[。！？!?;；]$/.test(prev) &&
        !/(?<!\d)1[3-9]\d{9}(?!\d)|[\w.+-]+@[\w-]+\.[\w-]+/.test(prev) && // 上一行非纯联系方式
        /^[\u4e00-\u9fa5a-zA-Z0-9（(]/.test(cur) && cur.length < 200 &&
        !/:/.test(cur) && // 排除"标签: 值"行
        !SECTION_RE.test(cur.replace(/[:：]\s*$/, '')) &&
        !/^[\u4e00-\u9fa5]{2,8}\s+[A-Za-z]/.test(cur) && // 排除中英混合标题行
        !/(?:19|20)\d{2}/.test(cur) &&
        !/(?<!\d)1[3-9]\d{9}(?!\d)|[\w.+-]+@[\w-]+\.[\w-]+/.test(cur) &&
        !/大学|学院|公司|集团|科技|银行|证券/.test(cur); // 排除学校/公司经历行
      if (canMerge) {
        out[out.length - 1] = prev + cur;
      } else {
        out.push(cur);
      }
    }
    return out;
  }

  function matchDateRange(s) {
    const m = String(s).match(/((?:19|20)\d{2})\s*[年.\/]?\s*(\d{1,2})?\s*月?\s*[-—~至到]\s*((?:19|20)\d{2})\s*[年.\/]?\s*(\d{1,2})?\s*月?/);
    if (m) return { startY: m[1], startM: m[2] || '', endY: m[3], endM: m[4] || '' };
    const m2 = String(s).match(/((?:19|20)\d{2})\s*[年.\/]?\s*(\d{1,2})?\s*月?\s*[-—~至到]\s*(?:至今|现在|目前|now|present|今)/i);
    if (m2) return { startY: m2[1], startM: m2[2] || '', endY: '至今', endM: '' };
    return null;
  }

  // 无连字符日期对: "2020.09 2024.06" / "2020 2024"
  function matchDatePair(s) {
    const m = String(s).match(/((?:19|20)\d{2})[.\/年]?\s*(\d{1,2})?\s*月?\s+(?:至|到|—|~|--)?\s*((?:19|20)\d{2})[.\/年]?\s*(\d{1,2})?\s*月?/);
    if (m && m[1] !== m[3]) return { startY: m[1], startM: m[2] || '', endY: m[3], endM: m[4] || '' };
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

  const SCHOOL_RE = /([\u4e00-\u9fa5A-Za-z0-9·（）()]+?(?:大学|学院|学校|研究院|科学院|党校))/;

  // 从教育行提取字段(兼容: 日期前缀/后缀、学校-学历-专业顺序或倒序、竖线分隔)
  // 高校名录命中 → school 高置信
  function lookupUniversity(s) {
    for (const u of UNIVERSITIES) {
      if (s.includes(u)) return u;
    }
    return null;
  }

  function parseSchoolLine(text, edu) {
    let s = cleanLine(text);
    const range = matchDateRange(s) || matchDatePair(s);
    if (range) {
      if (!edu.eduStart) edu.eduStart = `${range.startY}${range.startM ? '-' + range.startM : ''}`;
      if (!edu.eduEnd) edu.eduEnd = range.endY === '至今' ? '' : `${range.endY}${range.endM ? '-' + range.endM : ''}`;
      s = s.replace(/(?:19|20)\d{2}[^\s]*?(?:[-—~至到][^\s]*?(?:19|20)\d{2}[^\s]*?)?\s*/, ' ');
    }
    const parts = s.split(/[|｜]/).map((p) => p.trim()).filter(Boolean);
    s = parts[0] || s;
    if (!edu.school) {
      // 名录优先(高置信)
      const uni = lookupUniversity(s);
      if (uni) edu.school = uni;
      else {
        const schoolM = s.match(SCHOOL_RE);
        if (schoolM) edu.school = schoolM[1];
      }
    }
    if (!edu.degree) {
      const deg = guessDegree(s);
      if (deg) edu.degree = deg;
    }
    if (!edu.major && parts.length > 1 && parts[1] && parts[1].length <= 40) {
      edu.major = parts[1].replace(/(博士|硕士|本科|学士|大专|专科|高职|研究生|在读)/g, '').replace(/^[·|｜\s\-—]+/, '').slice(0, 40);
    }
    if (!edu.major) {
      let rest2 = s;
      if (edu.school) rest2 = rest2.replace(edu.school, '');
      rest2 = rest2.replace(/(博士|硕士|本科|学士|大专|专科|高职|研究生|在读|学历|学位)/g, '');
      if (edu.school) rest2 = rest2.replace(SCHOOL_RE, '');
      edu.major = rest2.replace(/^[·|｜\s\-—]+/, '').replace(/[|｜].*$/, '').slice(0, 40);
    }
  }

  // 从实习行提取字段(兼容: 竖线分隔 公司|岗位|时间、纯公司行、行尾岗位)
  function parseInternLine(text, item) {
    let s = cleanLine(text);
    const range = matchDateRange(s);
    if (range) {
      item.intStart = `${range.startY}${range.startM ? '-' + range.startM : ''}`;
      item.intEnd = range.endY === '至今' ? '' : `${range.endY}${range.endM ? '-' + range.endM : ''}`;
      s = s.replace(/(?:19|20)\d{2}[^\s]*?(?:[-—~至到][^\s]*?(?:19|20)\d{2}[^\s]*?)?\s*/, ' ');
    }
    const parts = s.split(/[|｜]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      parts.forEach((p) => {
        if (/^[\d]/.test(p) || matchDateRange(p)) return;
        if (/公司|集团|科技|有限|银行|证券|保险|事务所|研究院/.test(p) && !item.intCompany) item.intCompany = p.slice(0, 40);
        else if (/(实习|工程师|专员|助理|分析师|顾问|开发|运营|产品|设计|测试|管培|校招)/.test(p) && !item.intPosition) item.intPosition = p.slice(0, 30);
        else if (!item.intCompany) item.intCompany = p.slice(0, 40);
        else if (!item.intPosition && p.length <= 20) item.intPosition = p.slice(0, 30);
      });
      return;
    }
    const companyM = s.match(/([\u4e00-\u9fa5A-Za-z0-9·（）()]+?(?:公司|集团|科技|网络|银行|证券|保险|事务所|研究院|中心|部|局))/);
    if (companyM) item.intCompany = companyM[1];
    else {
      const m = s.match(/^([\u4e00-\u9fa5A-Za-z0-9·（）()]{2,30})$/);
      if (m) item.intCompany = m[1];
    }
    const posM = s.match(/(?:担任|任职|岗位|职位|实习)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9/（）()]{2,20})/);
    if (posM) item.intPosition = posM[1];
    const posTail = s.match(/([\u4e00-\u9fa5A-Za-z0-9/（）()]{2,16}(?:实习生|工程师|专员|助理|分析师|顾问|经理))$/);
    if (posTail && !item.intPosition) item.intPosition = posTail[1];
  }

  function structure(lines, opts) {
    const conf = {};   // fieldKey -> 0-100 置信度
    const sources = {}; // fieldKey -> [原文行索引] (校对页高亮用)
    const warnings = [];
    const out = {
      basic: {}, education: [], internship: [], project: [], skills: {},
      intent: {}, openQuestions: [],
    };
    // 置信度数值化: high=88, medium=70, low=50
    const CONF = { high: 88, medium: 70, low: 50 };
    const recordSource = (key, idx) => {
      if (idx === undefined) return;
      if (!sources[key]) sources[key] = [];
      if (!sources[key].includes(idx)) sources[key].push(idx);
    };
    const set = (cat, key, value, confidence, srcIdx) => {
      if (value === undefined || value === null || value === '') return;
      out[cat][key] = String(value).trim();
      conf[cat + '.' + key] = typeof confidence === 'number' ? confidence : (CONF[confidence] || 70);
      recordSource(cat + '.' + key, srcIdx);
    };
    const setBasic = (key, v, c, idx) => set('basic', key, v, c, idx);

    // 预扫描行特征(姓名推断: 姓名行通常紧邻联系方式)
    let rawLines = (lines || []).map((raw) => cleanLine(raw)).filter((l) => l);

    // 清洗: 频率统计 → 去页眉页脚/水印/页码 → 段落合并
    const freq = {};
    rawLines.forEach((l) => { freq[l] = (freq[l] || 0) + 1; });
    rawLines = rawLines.filter((l) => !isNoiseLine(l, freq));
    rawLines = mergeBrokenLines(rawLines);

    const cleanedLines = rawLines.slice();
    const enriched = rawLines.map((line) => ({
      line,
      phone: (line.match(/(?<!\d)1[3-9]\d{9}(?!\d)/) || [null])[0],
      email: (line.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [null])[0],
      idCard: (line.match(/\b\d{17}[\dXx]\b/) || [null])[0],
    }));

    // 模板检测
    const template = detectTemplate(enriched.map((e) => e.line).join('\n'));
    if (template) warnings.push(`检测到简历模板: ${template}, 已启用对应解析策略`);

    // 字号特征(PDF 提取): 标题行通常显著大于正文
    const sizes = (opts && opts.sizes) ? opts.sizes.slice() : null;
    let fontMedian = 10;
    if (sizes && sizes.length) {
      const sorted = sizes.slice().sort((a, b) => a - b);
      fontMedian = sorted[Math.floor(sorted.length / 2)] || 10;
    }

    let section = 'basic';
    let pendingEdu = null;
    let pendingInt = null;
    let pendingProj = null;
    let intro = '';

    // 章节标题判定: 精确词表 / 中英混合标题 / 大字号行近似
    const isSectionTitle = (bare, idx) => {
      if (SECTION_RE.test(bare)) return true;
      // 中英混合标题: "教育经历 EDUCATION BACKGROUND" / "教育背景 Education"
      const zhPart = bare.match(/^([\u4e00-\u9fa5／\/、·\s]+?)\s*[A-Za-z]/);
      if (zhPart && SECTION_RE.test(zhPart[1].trim())) return true;
      // 大字号短文本行近似标题(模板差异兜底)
      if (sizes && sizes[idx] !== undefined && fontMedian > 0) {
        if (sizes[idx] > fontMedian * 1.35) {
          const t = bare.replace(/[\s·•●◆→▪]+/g, '');
          if (t.length >= 2 && t.length <= 8 && /(教育|实习|工作|项目|技能|证书|自我评价|荣誉|求职意向|获奖|经历|背景|科研)/.test(t)) return true;
        }
      }
      return false;
    };
    const sectionOf = (bare) => bare.includes('教育') ? 'education' :
      bare.includes('实习') || bare.includes('工作') || bare.includes('实践') ? 'internship' :
        bare.includes('项目') || bare.includes('科研') ? 'project' :
          bare.includes('自我评价') || bare.includes('个人评价') || bare.includes('个人总结') || bare.includes('个人简介') || bare.includes('自我介绍') ? 'intro' :
            bare.includes('技能') || bare.includes('证书') || bare.includes('语言') ? 'skills' :
              bare.includes('获奖') || bare.includes('荣誉') || bare.includes('奖项') ? 'skills' :
                bare.includes('求职意向') ? 'intent' : 'basic';

    enriched.forEach((e, idx) => {
      const line = e.line;
      if (!line) return;
      // 章节检测(允许冒号结尾)
      const bare = line.replace(/[:：]\s*$/, '');
      if (isSectionTitle(bare, idx)) {
        section = sectionOf(bare);
        return;
      }
      // 行首章节+冒号形式: "求职意向: 前端开发工程师" / "教育经历: xxx"
      const secM = line.match(/^(求职意向|教育经历|教育背景|实习经历|工作经历|项目经历|专业技能|技能证书|自我评价|个人评价|获奖经历|所获荣誉)\s*[:：]/);
      if (secM) {
        const head = secM[1];
        section = head.includes('教育') ? 'education' :
          head.includes('实习') || head.includes('工作') ? 'internship' :
            head.includes('项目') ? 'project' :
              head.includes('自我评价') || head.includes('个人评价') ? 'intro' :
                head.includes('技能') || head.includes('证书') ? 'skills' :
                  head.includes('获奖') || head.includes('荣誉') ? 'skills' : 'intent';
        // 不 return, 继续用当前行内容解析(如 "求职意向: 前端开发工程师")
      }
      // 标签剥离: "姓名: 张三"
      const labeled = line.match(/^(姓名|真实姓名)\s*[:：]\s*(\S{2,20})$/);
      if (labeled && section === 'basic') {
        setBasic('name', labeled[2], 'high', idx);
        return;
      }

      if (section === 'basic') {
        // 姓名推断: 与手机/邮箱同行; 或 2-4 字中文行且下一行含联系方式
        if (!out.basic.name) {
          const inline = line.match(/^([\u4e00-\u9fa5·]{2,4})\s+(?:1[3-9]\d{9}|[\w.+-]+@[\w-]+\.[\w-]+)/);
          if (inline) { setBasic('name', inline[1], 'high', idx); }
          else if (/^[\u4e00-\u9fa5·]{2,4}$/.test(line)) {
            const next = enriched[idx + 1];
            if (next && (next.phone || next.email)) {
              setBasic('name', line, 'high', idx);
            }
          }
        }
        if (e.phone) { setBasic('phone', e.phone, 'high', idx); return; }
        if (e.email) { setBasic('email', e.email, 'high', idx); return; }
        if (e.idCard) { setBasic('idCard', e.idCard, 'high', idx); return; }
        const gM = line.match(/(?:性别|sex|gender)\s*[:：]\s*(男|女)/i);
        if (gM) { setBasic('gender', gM[1] === '男' ? '男' : '女', 'high', idx); return; }
        const bM = line.match(/(?:出生(?:日期|年月|时间)?|birthday|date\s*of\s*birth)\s*[:：]?\s*(((?:19|20)\d{2})\s*[年.\/]\s*\d{1,2}\s*月?(?:\s*\d{1,2}\s*日?)?)/i);
        if (bM) { setBasic('birthday', bM[1].replace(/\s+/g, ''), 'high', idx); return; }
        const npM = line.match(/(?:籍贯|出生地|户籍|hometown|native\s*place)\s*[:：]\s*(\S{2,20})/i);
        if (npM) { setBasic('nativePlace', npM[1], 'medium', idx); return; }
        const locM = line.match(/(?:现居地|现居住地|居住地|所在地|城市|location)\s*[:：]\s*(\S{2,20})/i);
        if (locM) { setBasic('currentLocation', locM[1], 'medium', idx); return; }
        const polM = line.match(/(?:政治面貌)\s*[:：]\s*(中共党员|中共预备党员|共青团员|党员|团员|群众)/);
        if (polM) { setBasic('politicalStatus', polM[1] === '党员' ? '中共党员' : polM[1] === '团员' ? '共青团员' : polM[1], 'medium', idx); return; }
        // 基本信息尾部兜底: 无标签的 2-4 字中文行(通常是姓名)
        if (!out.basic.name && /^[\u4e00-\u9fa5·]{2,4}$/.test(line)) {
          setBasic('name', line, 'low', idx);
          warnings.push('姓名由首行推断, 请核对');
        }
        return;
      }

      if (section === 'education') {
        const range = matchDateRange(line) || matchDatePair(line);
        const schoolHit = SCHOOL_RE.test(line);
        if (range || (schoolHit && !pendingEdu)) {
          if (pendingEdu) { out.education.push(pendingEdu); pendingEdu = null; }
          pendingEdu = { school: '', degree: '', major: '', eduStart: '', eduEnd: '', gpa: '', gpaRank: '', majorCourses: '', srcLine: idx };
          parseSchoolLine(line, pendingEdu);
          return;
        }
        if (pendingEdu) {
          const schoolM = line.match(SCHOOL_RE);
          if (schoolM && !pendingEdu.school) pendingEdu.school = schoolM[1];
          const deg = guessDegree(line);
          if (deg && !pendingEdu.degree) pendingEdu.degree = deg;
          if (/GPA|绩点|平均成绩/.test(line)) {
            const g = line.match(/(?:GPA|绩点|平均成绩)\s*[:：]?\s*([\d.]+)/i);
            if (g && !pendingEdu.gpa) pendingEdu.gpa = g[1];
          }
          if (/排名/.test(line)) {
            const rk = line.match(/(?:排名|rank)\s*[:：]?\s*([^\s]{1,24})/i);
            if (rk && !pendingEdu.gpaRank) pendingEdu.gpaRank = rk[1];
          }
          if (/课程/.test(line) && !pendingEdu.majorCourses) {
            pendingEdu.majorCourses = line.replace(/.*[:：]/, '').slice(0, 150);
          }
          if (!pendingEdu.major && !schoolM && line.length <= 40 && !/[，。;；]/.test(line) && !/^[0-9]/.test(line) && !/GPA|排名|课程/.test(line)) {
            pendingEdu.major = line.replace(/(博士|硕士|本科|学士|大专|专科|高职|研究生|在读)/g, '').trim();
          }
        }
        return;
      }

      if (section === 'internship') {
        const range = matchDateRange(line);
        const companyHit = /公司|集团|科技|有限|网络|银行|证券|保险|事务所|研究院|工作室/.test(line);
        if (range || (companyHit && !pendingInt)) {
          if (pendingInt) { out.internship.push(pendingInt); pendingInt = null; }
          pendingInt = { intCompany: '', intDepartment: '', intPosition: '', intStart: '', intEnd: '', workContent: '', achievements: '', srcLine: idx };
          parseInternLine(line, pendingInt);
          return;
        }
        if (pendingInt) {
          if (!pendingInt.intPosition && line.length <= 24 && !/[，。；;：:]/.test(line) && !/^[\d]/.test(line) && !/(职责|工作内容|负责|参与|独立|协助)/.test(line)) {
            pendingInt.intPosition = line;
            return;
          }
          if (/(职责|工作内容|负责|参与|独立完成|协助)/.test(line)) {
            pendingInt.workContent = (pendingInt.workContent ? pendingInt.workContent + '; ' : '') + line.slice(0, 120);
          }
        }
        return;
      }

      if (section === 'project') {
        const parts = line.split(/[|｜]/).map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          // 竖线: 项目名 | 角色 | 时间
          if (pendingProj && pendingProj.projName) { out.project.push(pendingProj); pendingProj = null; }
          pendingProj = { projName: parts[0].slice(0, 40), projRole: '', projDuration: '', projTech: '', projDuty: '', projOutcome: '', srcLine: idx };
          const durIdx = parts.findIndex((p) => matchDateRange(p) || matchDatePair(p));
          if (durIdx > 0) pendingProj.projDuration = parts[durIdx].trim();
          const rolePart = parts[durIdx === 1 ? 2 : 1] || '';
          if (rolePart && rolePart.length <= 24) {
            const roleM = rolePart.match(/(?:担任|角色|负责|组长|成员|主持|参与|开发)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9/（）()·]{2,20})/);
            pendingProj.projRole = roleM ? roleM[1] : rolePart;
          }
          return;
        }
        const looksNew = /^[A-Za-z0-9\u4e00-\u9fa5·（）()\[\]【】]{2,40}$/.test(line) && line.length <= 40 && !/[，。；;：:\.]/.test(line) && !/职责|成果|技术|背景|负责|实现|基于/.test(line);
        if (looksNew && !pendingProj) {
          pendingProj = { projName: line, projRole: '', projDuration: '', projTech: '', projDuty: '', projOutcome: '', srcLine: idx };
          return;
        }
        if (looksNew && pendingProj && pendingProj.projName && pendingProj.projName !== line) {
          out.project.push(pendingProj);
          pendingProj = { projName: line, projRole: '', projDuration: '', projTech: '', projDuty: '', projOutcome: '', srcLine: idx };
          return;
        }
        if (pendingProj) {
          if (/(?:技术|工具|技术栈|stack|语言)\s*[:：]/.test(line)) pendingProj.projTech = line.replace(/.*[:：]/, '').slice(0, 60);
          else if (/(?:职责|负责|工作)\s*[:：]/.test(line)) pendingProj.projDuty = line.replace(/.*[:：]/, '').slice(0, 120);
          else if (/(?:成果|效果|结果|成效)\s*[:：]/.test(line)) pendingProj.projOutcome = line.replace(/.*[:：]/, '').slice(0, 120);
          else if (/(?:角色|担任)\s*[:：]/.test(line)) pendingProj.projRole = line.replace(/.*[:：]/, '').slice(0, 30);
          else if (/(?:周期|时间|起止)\s*[:：]/.test(line)) pendingProj.projDuration = line.replace(/.*[:：]/, '').slice(0, 30);
          else if (line.length > 10 && !pendingProj.projDuty) pendingProj.projDuty = line.slice(0, 120);
        }
        return;
      }

      if (section === 'skills') {
        const englishM = line.match(/(?:CET[- ]?4|CET[- ]?6|TEM[- ]?4|TEM[- ]?8|英语四级|英语六级|专业四级|专业八级|雅思|托福)/i);
        if (englishM) {
          let v = englishM[0].toUpperCase().replace(/^CET[- ]?4$/, 'CET-4').replace(/^CET[- ]?6$/, 'CET-6').replace(/^TEM[- ]?4$/, '专业四级').replace(/^TEM[- ]?8$/, '专业八级');
          if (!out.skills.englishLevel) set('skills', 'englishLevel', v, 'medium', idx);
          return;
        }
        if (/计算机|软考|软件设计师|二级|三级/.test(line)) {
          if (!out.skills.computerLevel) set('skills', 'computerLevel', /二级/.test(line) ? '国家二级' : /三级/.test(line) ? '国家三级' : '其他', 'medium', idx);
          return;
        }
        if (/证书|资格|认证|license|certificate/i.test(line)) {
          out.skills.certificates = (out.skills.certificates ? out.skills.certificates + '; ' : '') + line.slice(0, 80);
          return;
        }
        if (/奖|荣誉|奖学金/.test(line)) {
          out.skills.awards = (out.skills.awards ? out.skills.awards + '; ' : '') + line.slice(0, 80);
          return;
        }
        if (line.length > 2 && !/^[\d.]+$/.test(line) && !/^(证书|技能)/.test(line)) {
          out.skills.certificates = (out.skills.certificates ? out.skills.certificates + '; ' : '') + line.slice(0, 80);
        }
        return;
      }

      if (section === 'intro') {
        intro += line + '\n';
        return;
      }

      if (section === 'intent') {
        const posM = line.match(/(?:岗位|职位|求职意向|应聘)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9/（）()·]{2,30})/);
        if (posM) set('intent', 'targetPosition', posM[1], 'medium', idx);
        const cityM = line.match(/(?:城市|地点|地区)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9·、（）()]{2,30})/);
        if (cityM) set('intent', 'targetCity', cityM[1], 'medium', idx);
        const salM = line.match(/(?:薪资|薪酬|待遇|工资|期望月薪)\s*[:：]?\s*([\dKk万Ww.-]{2,30})/);
        if (salM) set('intent', 'expectedSalary', salM[1], 'medium', idx);
        const avM = line.match(/(?:可入职|到岗|入职时间)\s*[:：]?\s*(\S{2,20})/);
        if (avM) set('intent', 'availableDate', avM[1], 'medium', idx);
        return;
      }
    });

    // 收尾挂载
    if (pendingEdu) { out.education.push(pendingEdu); pendingEdu = null; }
    if (pendingInt) { out.internship.push(pendingInt); pendingInt = null; }
    if (pendingProj) { out.project.push(pendingProj); pendingProj = null; }
    if (intro.trim()) {
      out.openQuestions.push({ question: '自我介绍', answer: intro.trim().slice(0, 500) });
      conf['openQuestions.自我介绍'] = 'medium';
    }
    // 去空条目
    ['education', 'internship', 'project'].forEach((k) => {
      out[k] = out[k].filter((e) => { const copy = Object.assign({}, e); delete copy.srcLine; return Object.values(copy).some((v) => v); });
    });

    // 身份证推导出生日期
    if (out.basic.idCard && !out.basic.birthday) {
      const id = out.basic.idCard;
      if (/^\d{17}[\dXx]$/.test(id)) {
        setBasic('birthday', `${id.slice(6, 10)}-${id.slice(10, 12)}-${id.slice(12, 14)}`, 'medium');
      }
    }
    // 姓名置信度兜底
    if (out.basic.name && !conf['basic.name']) conf['basic.name'] = 'low';
    if (!out.basic.phone && !out.basic.email) warnings.push('未识别到联系方式, 请手动补充');

    return { structured: out, confidence: conf, sources, warnings, template, cleanedLines };
  }

  // 解析入口: 返回 { format, text, structured, confidence, warnings }
  async function parseResume(file) {
    LOG().info('parser', 'parse resume', file.name);
    const r = await parseFile(file);
    const s = structure(r.lines, { sizes: r.lineSizes });
    return Object.assign(r, s);
  }

  AS.parser = { parseResume, extractPDF, extractDOCX, structure };
})();
