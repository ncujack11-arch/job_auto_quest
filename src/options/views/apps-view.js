(function () {
  "use strict";
  const AS = window.AS;
  const UI = () => AS.optionsUI;
  const PLACEHOLDER = { title: "投递台账", name: "applications" };
  async function render(container) { container.innerHTML = ""; container.appendChild(UI().el("div", { class: "empty" }, [ UI().el("b", { text: "投递台账功能即将上线" }), UI().el("span", { text: "v1.2.0 将支持投递记录自动抓取、进度追踪与统计复盘" }) ])); }
  AS.views = AS.views || {};
  AS.views.applications = render;
})();
