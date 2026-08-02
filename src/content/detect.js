/**
 * detect.js — 投递完成检测
 * 填充后绝不自动提交; 仅当检测到用户手动提交成功/页面跳转投递完成页时,
 * 通知后台弹出「记录本次投递」悬浮窗
 */
(function () {
  'use strict';
  const AS = (window.AS = window.AS || {});
  if (AS.detect) return;

  const LOG = () => AS.logger;

  const URL_MARKERS = [
    /(apply|applied|submit|submitted|complete|completed|success|successful|done|finish|finished|thanks|thankyou|end|result)([\/_\-]|$)/i,
    /投递(成功|完成|结果)|已投递|提交成功|申请已(提交|完成)|投递记录|投递结果|我的投递|简历投递成功/i,
  ];
  const TEXT_MARKERS = [
    '投递成功', '提交成功', '申请已提交', '申请已成功提交', '简历已投递', '已成功投递', '投递完成',
    '感谢您的投递', '感谢投递', '您的申请已提交', '我们已收到您的申请', '申请提交成功',
    'application has been submitted', 'your application has been received', 'thank you for your application',
    'submit successfully', 'submitted successfully',
  ];

  const state = {
    armed: false,
    startUrl: '',
    lastUrl: '',
    timer: null,
    fillTime: 0,
    reported: false,
  };

  function successPhraseCount() {
    const text = (document.body && document.body.innerText) || '';
    if (!text) return 0;
    let count = 0;
    for (const m of TEXT_MARKERS) {
      if (text.includes(m)) {
        count += m.length >= 8 ? 2 : 1;
        if (count >= 2) return count;
      }
    }
    return count;
  }

  function urlHit() {
    return URL_MARKERS.some((re) => re.test(location.href));
  }

  function check() {
    if (!state.armed || state.reported) return;
    // 触发条件: 页面已导航(URL 变化或加载了新文档) 且 出现成功信号
    const urlChanged = location.href !== state.lastUrl;
    const phraseScore = successPhraseCount();
    const hit = urlChanged && (urlHit() || phraseScore >= 2) || (!urlChanged && phraseScore >= 3);
    if (hit) {
      LOG().info('detect', 'submission detected', location.href, phraseScore);
      state.reported = true;
      disarm();
      chrome.runtime.sendMessage({ type: 'AF_SUBMISSION', url: location.href, title: document.title })
        .catch((e) => LOG().warn('detect', 'send submission msg failed', e));
    }
  }

  function hookHistory() {
    try {
      const patch = (type) => {
        const orig = history[type];
        history[type] = function (...args) {
          const r = orig.apply(this, args);
          setTimeout(check, 400);
          return r;
        };
      };
      patch('pushState');
      patch('replaceState');
    } catch (e) { /* ignore */ }
    window.addEventListener('popstate', () => setTimeout(check, 400));
    window.addEventListener('hashchange', () => setTimeout(check, 400));
  }

  function arm() {
    if (state.armed || window.top !== window) return; // 仅顶层框架检测
    state.armed = true;
    state.startUrl = location.href;
    state.lastUrl = location.href;
    state.fillTime = Date.now();
    state.reported = false;
    hookHistory();
    state.timer = setInterval(check, 2500);
    // 8 分钟后自动停止监控
    setTimeout(disarm, 8 * 60 * 1000);
    LOG().debug('detect', 'submission watcher armed');
  }

  function disarm() {
    state.armed = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  AS.detect = { arm, disarm, isArmed: () => state.armed };
})();
