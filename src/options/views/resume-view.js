/**
 * resume-view.js — 简历导入视图 (v1.1.0 实现)
 */
(function () {
  'use strict';
  const AS = window.AS;
  const UI = () => AS.optionsUI;

  async function render(container) {
    container.innerHTML = '';
    container.appendChild(UI().el('div', { class: 'empty' }, [
      UI().el('b', { text: '简历解析功能即将上线' }),
      UI().el('span', { text: 'v1.1.0 将支持 PDF / DOCX 简历本地解析入库' }),
    ]));
  }

  AS.views = AS.views || {};
  AS.views.resume = render;
})();
