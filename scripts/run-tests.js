// 一键全量测试: 依次运行全部测试套件, 任一失败则退出码 1
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  { file: 'smoke-test.js', name: '逻辑冒烟(匹配/解析/加密/记忆/学习链路)' },
  { file: 'learn-test.js', name: '学习链路专项(收集/去重/保存/锁定)' },
  { file: 'ui-test.js', name: 'UI 行为(信息库: 创建/复制/重命名/添加经历/防叠加)' },
  { file: 'views-test.js', name: '视图行为(台账/题库/规则/设置)' },
];

let allOk = true;
console.log('===== 秋招网申自动填充 · 全量测试 =====\n');
for (const s of suites) {
  const file = path.join(__dirname, 'tests', s.file);
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8', timeout: 120000 });
  const tail = String(r.stdout || '').trim().split('\n').slice(-2).join(' | ');
  const ok = r.status === 0;
  if (!ok) allOk = false;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${s.name}  (${s.file})`);
  console.log(`        ${tail}`);
  if (r.stderr) console.log(String(r.stderr).trim().split('\n').slice(0, 3).join('\n        '));
  console.log('');
}
console.log(allOk ? '===== 全部测试通过 ✔ =====' : '===== 存在失败项 ✘ =====');
process.exit(allOk ? 0 : 1);
