(function () {
  "use strict";
  const AS = window.AS;
  const UI = () => AS.optionsUI;
  async function render(container) { container.innerHTML = ""; container.appendChild(UI().el("div", { class: "empty" }, [ UI().el("b", { text: "开放题库功能即将上线" }), UI().el("span", { text: "v1.2.0 将支持开放题答案管理与公司面经沉淀" }) ])); }
  AS.views = AS.views || {};
  AS.views.questions = render;
})();
