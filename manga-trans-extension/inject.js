(function() {
    const originalAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
        // 强制将所有 Shadow DOM 设为 open 模式，以便内容脚本访问
        if (init && init.mode === 'closed') {
            init.mode = 'open';
        }
        return originalAttachShadow.apply(this, arguments);
    };
    console.log("[MangaTrans] Shadow DOM Proxy Active");
})();
