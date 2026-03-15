(function() {
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
        if (init && init.mode === 'closed') init.mode = 'open';
        return originalAttachShadow.apply(this, arguments);
    };

    // 劫持 History API 捕获 SPA 路由变化
    const wrapHistory = function(type) {
        const orig = history[type];
        return function() {
            const rv = orig.apply(this, arguments);
            // 发送自定义事件，通知 content.js
            window.postMessage({ type: 'MANGA_TRANS_URL_CHANGED', path: location.pathname }, '*');
            return rv;
        };
    };
    history.pushState = wrapHistory('pushState');
    history.replaceState = wrapHistory('replaceState');

    console.log("[MangaTrans] Shadow DOM & History Proxy Active");
})();
