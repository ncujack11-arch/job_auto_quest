(function () {
  "use strict";
  const AS = window.AS;
  const UI = () => AS.optionsUI;
  async function render(container) { container.innerHTML = ""; container.appendChild(UI().el("div", { class: "empty" }, [ UI().el("b", { text: "统计看板即将上线" }), UI().el("span", { text: "v1.2.0 将提供核心指标、渠道分布、时间趋势与败因复盘" }) ])); }
  AS.views = AS.views || {};
  AS.views.stats = render;
})();
