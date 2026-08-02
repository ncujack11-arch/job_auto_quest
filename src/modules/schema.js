/**
 * schema.js — 全量网申字段结构定义
 * 驱动: 信息库 UI 自动生成、表单字段匹配、填充值解析
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.schema) return;

  const F = {
    text: 'text', select: 'select', date: 'date', file: 'file',
  };

  // 字段关键词(用于 label/name/placeholder/id 匹配, 已包含常见中英文变体)
  const K = {
    name: ['姓名', '名字', '真实姓名', '您的姓名', 'full name', 'name'],
    gender: ['性别', 'gender', 'sex'],
    birthday: ['出生日期', '生日', '出生年月', '出生时间', 'birthday', 'birth date', 'date of birth'],
    phone: ['手机号', '手机号码', '手机', '联系电话', '联系方式', '电话号码', '电话', 'mobile', 'phone', 'tel', 'cellphone', 'contact'],
    email: ['邮箱', '电子邮件', '电子邮箱', '邮件', 'email', 'e-mail', 'mail'],
    idCard: ['身份证号', '身份证号码', '证件号码', '证件号', '身份证', 'id card', 'idcard', 'identity'],
    nativePlace: ['籍贯', '出生地', '家乡', '户籍所在地', '户籍', 'native place', 'hometown', 'birthplace'],
    currentLocation: ['现居地', '现居住地', '居住地', '所在地', '目前所在地', '当前城市', '居住城市', 'location', 'current city', 'residence'],
    politicalStatus: ['政治面貌', '党员', 'political status', 'party'],
    photo: ['证件照', '照片', '头像', '一寸照片', 'photo', 'avatar', 'picture', 'image'],
    emergencyContact: ['紧急联系人', '紧急联系人姓名', '紧急联系', 'emergency contact'],
    emergencyPhone: ['紧急联系人电话', '紧急联系电话', '应急电话', 'emergency phone'],
    // 教育
    school: ['学校', '毕业院校', '院校', '大学', '学院', '就读学校', 'school', 'university', 'college', 'institution', 'campus'],
    degree: ['学历', '最高学历', '学位', 'degree', 'education level', 'qualification'],
    major: ['专业', '主修专业', '所学专业', 'major', 'specialty', 'specialization', 'discipline'],
    eduStart: ['入学时间', '入学年月', '开始时间', '起始时间', 'enroll', 'start date', 'admission'],
    eduEnd: ['毕业时间', '毕业年月', '结束时间', '预计毕业', 'graduation', 'graduate', 'end date'],
    gpa: ['gpa', '绩点', '平均成绩', '成绩排名', '平均分'],
    gpaRank: ['专业排名', '排名', 'rank', 'ranking', '前百分之', '百分比'],
    majorCourses: ['主修课程', '主要课程', '相关课程', '课程', 'course', 'courses'],
    honors: ['在校荣誉', '荣誉', '奖项', '获奖经历', '获得奖学金', '奖学金', 'honor', 'award'],
    // 实习
    intCompany: ['实习公司', '实习单位', '公司名称', '单位名称', '所在公司', 'company', 'employer', 'organization', 'corporation'],
    intDepartment: ['部门', '实习部门', 'department', 'division'],
    intPosition: ['实习岗位', '职位', '岗位名称', '任职岗位', '担任职位', 'position', 'job title', 'post'],
    intStart: ['实习开始', '开始时间', '起始时间', '入职时间', 'start', 'from'],
    intEnd: ['实习结束', '结束时间', '离职时间', 'end', 'to', 'until'],
    workContent: ['工作内容', '工作描述', '主要职责', '岗位职责', '工作职责', '职责描述', 'duty', 'responsibility', 'job description', 'work'],
    achievements: ['量化成果', '工作成果', '实习成果', '业绩', '成果', '成就', 'achiev', 'result', 'performance'],
    refContact: ['证明人', '证明人联系方式', '联系人', 'reference'],
    // 项目
    projName: ['项目名称', '项目名', 'project', 'project name', '课题'],
    projRole: ['个人角色', '项目角色', '担任角色', '角色', 'role', 'position in project'],
    projDuration: ['项目周期', '项目时间', '起止时间', 'duration', 'period', 'time span'],
    projBackground: ['项目背景', '项目简介', '背景', 'background', 'intro', 'description'],
    projTech: ['技术栈', '使用技术', '开发工具', '技术', 'tools', 'technolog', 'stack', 'skills'],
    projDuty: ['个人职责', '项目职责', '负责内容', '职责', 'responsibility', 'duty'],
    projOutcome: ['项目成果', '项目效果', '成果', '结果', 'outcome', 'result', 'effect'],
    // 技能证书
    englishLevel: ['英语等级', '英语水平', '英语', 'cet', '英语六级', '英语四级', 'english'],
    computerLevel: ['计算机等级', '计算机水平', '计算机', '二级', '三级', 'computer'],
    certificates: ['证书', '专业证书', '资格证书', '资质证书', 'certificate', 'license', 'qualification'],
    awards: ['获奖经历', '所获奖励', '获得奖项', '奖励', 'award', 'prize', 'honor'],
    awardDate: ['获得时间', '获奖时间', '取得时间', '获证时间', 'date'],
    // 求职意向
    targetPosition: ['期望岗位', '意向岗位', '求职岗位', '应聘岗位', '期望职位', '意向职位', '目标岗位', '岗位', 'position', 'job', 'career'],
    targetCity: ['期望城市', '意向城市', '工作城市', '工作地点', '意向地', '期望地点', 'city', 'location'],
    expectedSalary: ['期望薪资', '期望薪酬', '期望待遇', '期望工资', '薪资要求', 'salary', 'pay', 'compensation'],
    availableDate: ['可入职时间', '入职时间', '到岗时间', '报到时间', 'available', 'onboard', 'join date'],
    jobStatus: ['求职状态', '当前状态', '工作状态', '在职状态', 'job status'],
    // 开放题
    selfIntro: ['自我介绍', '自我评价', '个人介绍', 'about me', 'introduction', 'self-intro', '个人简介'],
    whyCompany: ['为什么加入', '为什么选择我们', '加入我们的原因', '选择本公司的理由', 'why', '加入原因', '贵公司'],
    careerPlan: ['职业规划', '职业发展', '未来规划', '发展规划', 'plan', 'career plan'],
    strengthWeakness: ['优缺点', '优势与劣势', '最大的优点', '最大的缺点', 'strength', 'weakness', '优势', '劣势'],
  };

  const CATEGORIES = [
    {
      id: 'basic', name: '基本信息', repeatable: false, icon: '👤',
      fields: [
        { key: 'name', label: '姓名', type: F.text, kw: K.name },
        { key: 'gender', label: '性别', type: F.select, options: ['男', '女'], kw: K.gender },
        { key: 'birthday', label: '出生日期', type: F.date, kw: K.birthday },
        { key: 'phone', label: '手机号', type: F.text, kw: K.phone },
        { key: 'email', label: '邮箱', type: F.text, kw: K.email },
        { key: 'idCard', label: '身份证号', type: F.text, sensitive: true, kw: K.idCard },
        { key: 'nativePlace', label: '籍贯', type: F.text, kw: K.nativePlace },
        { key: 'currentLocation', label: '现居地', type: F.text, kw: K.currentLocation },
        { key: 'politicalStatus', label: '政治面貌', type: F.select, options: ['中共党员', '中共预备党员', '共青团员', '群众', '其他'], kw: K.politicalStatus },
        { key: 'photo', label: '证件照', type: F.file, kw: K.photo },
        { key: 'emergencyContact', label: '紧急联系人', type: F.text, kw: K.emergencyContact },
        { key: 'emergencyPhone', label: '紧急联系人电话', type: F.text, kw: K.emergencyPhone },
      ],
    },
    {
      id: 'education', name: '教育经历', repeatable: true, icon: '🎓',
      fields: [
        { key: 'school', label: '学校', type: F.text, kw: K.school },
        { key: 'degree', label: '学历', type: F.select, options: ['博士', '硕士', '本科', '大专', '高中'], kw: K.degree },
        { key: 'major', label: '专业', type: F.text, kw: K.major },
        { key: 'eduStart', label: '入学时间', type: F.date, kw: K.eduStart },
        { key: 'eduEnd', label: '毕业时间', type: F.date, kw: K.eduEnd },
        { key: 'gpa', label: 'GPA / 绩点', type: F.text, kw: K.gpa },
        { key: 'gpaRank', label: '专业排名', type: F.text, kw: K.gpaRank },
        { key: 'majorCourses', label: '主修课程', type: F.text, kw: K.majorCourses },
        { key: 'honors', label: '在校荣誉', type: F.text, kw: K.honors },
      ],
    },
    {
      id: 'internship', name: '实习经历', repeatable: true, icon: '💼',
      fields: [
        { key: 'intCompany', label: '公司名称', type: F.text, kw: K.intCompany },
        { key: 'intDepartment', label: '部门', type: F.text, kw: K.intDepartment },
        { key: 'intPosition', label: '岗位', type: F.text, kw: K.intPosition },
        { key: 'intStart', label: '开始时间', type: F.date, kw: K.intStart },
        { key: 'intEnd', label: '结束时间', type: F.date, kw: K.intEnd },
        { key: 'workContent', label: '工作内容', type: F.text, kw: K.workContent },
        { key: 'achievements', label: '量化成果', type: F.text, kw: K.achievements },
        { key: 'refContact', label: '证明人及联系方式', type: F.text, kw: K.refContact },
      ],
    },
    {
      id: 'project', name: '项目经历', repeatable: true, icon: '🚀',
      fields: [
        { key: 'projName', label: '项目名称', type: F.text, kw: K.projName },
        { key: 'projRole', label: '个人角色', type: F.text, kw: K.projRole },
        { key: 'projDuration', label: '项目周期', type: F.text, kw: K.projDuration },
        { key: 'projBackground', label: '项目背景', type: F.text, kw: K.projBackground },
        { key: 'projTech', label: '技术栈', type: F.text, kw: K.projTech },
        { key: 'projDuty', label: '个人职责', type: F.text, kw: K.projDuty },
        { key: 'projOutcome', label: '项目成果', type: F.text, kw: K.projOutcome },
      ],
    },
    {
      id: 'skills', name: '技能证书', repeatable: false, icon: '🏅',
      fields: [
        { key: 'englishLevel', label: '英语等级', type: F.select, options: ['CET-4', 'CET-6', '专业四级', '专业八级', '雅思', '托福', '其他'], kw: K.englishLevel },
        { key: 'computerLevel', label: '计算机等级', type: F.select, options: ['国家二级', '国家三级', '其他', '无'], kw: K.computerLevel },
        { key: 'certificates', label: '专业证书', type: F.text, kw: K.certificates },
        { key: 'awards', label: '获奖经历', type: F.text, kw: K.awards },
        { key: 'awardDate', label: '获得时间', type: F.date, kw: K.awardDate },
      ],
    },
    {
      id: 'intent', name: '求职意向', repeatable: false, icon: '🎯',
      fields: [
        { key: 'targetPosition', label: '期望岗位', type: F.text, kw: K.targetPosition },
        { key: 'targetCity', label: '期望城市', type: F.text, kw: K.targetCity },
        { key: 'expectedSalary', label: '期望薪资', type: F.text, sensitive: true, kw: K.expectedSalary },
        { key: 'availableDate', label: '可入职时间', type: F.date, kw: K.availableDate },
        { key: 'jobStatus', label: '求职状态', type: F.select, options: ['应届毕业生', '在校学生', '已毕业', '在职', '其他'], kw: K.jobStatus },
      ],
    },
    {
      id: 'openQuestions', name: '开放题库', repeatable: true, icon: '📝',
      fields: [
        { key: 'question', label: '问题', type: F.text, kw: [] },
        { key: 'answer', label: '答案', type: F.text, kw: [] },
      ],
    },
    {
      id: 'custom', name: '自定义字段', repeatable: true, icon: '✨',
      fields: [
        { key: 'key', label: '字段标识', type: F.text, kw: [] },
        { key: 'label', label: '字段名称', type: F.text, kw: [] },
        { key: 'value', label: '字段值', type: F.text, kw: [] },
      ],
    },
  ];

  // 扁平索引: fieldKey(不含索引) -> 字段定义
  const FLAT = {};
  CATEGORIES.forEach((cat) => {
    cat.fields.forEach((f) => {
      FLAT[`${cat.id}.${f.key}`] = { ...f, categoryId: cat.id };
    });
  });

  function getFieldDef(fieldKey) {
    // 支持 education[0].school / education.school / basic.name 形式
    const clean = fieldKey.replace(/\[\d+\]/g, '');
    return FLAT[clean] || null;
  }

  function findCategory(catId) {
    return CATEGORIES.find((c) => c.id === catId) || null;
  }

  AS.schema = {
    F,
    CATEGORIES,
    FLAT,
    getFieldDef,
    findCategory,
    // 开放题类型关键词 → 通用问题模板
    OPEN_TEMPLATES: [
      { kw: K.selfIntro, label: '自我介绍', answer: '' },
      { kw: K.whyCompany, label: '为什么加入本公司', answer: '' },
      { kw: K.careerPlan, label: '职业规划', answer: '' },
      { kw: K.strengthWeakness, label: '优缺点', answer: '' },
    ],
  };
})();
