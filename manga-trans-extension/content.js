// --- 状态管理 ---
let isAutoTranslate = false; // 内存变量，页面刷新即重置
let currentCid = null;

// 使用 IntersectionObserver 监听图片进入视口
const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && isAutoTranslate) {
            const img = entry.target;
            if (img.src && !img.hasAttribute('data-has-trans')) triggerSingleTranslation(img);
        }
    });
}, { threshold: 0.1 });

// --- 状态同步辅助 ---
function updateLocalState(enabled) {
    isAutoTranslate = enabled;
    const checkbox = document.getElementById('manga-trans-check');
    if (checkbox) checkbox.checked = enabled;
    if (enabled) {
        console.log("[MangaTrans] 翻译已启用，执行扫描...");
        document.querySelectorAll('img[data-has-trans]').forEach(img => img.removeAttribute('data-has-trans'));
        deepScanAndObserve();
    } else {
        console.log("[MangaTrans] 翻译已关闭，移除图层");
        removeAllOverlays();
    }
}

// 监听 storage 变化
chrome.storage.onChanged.addListener((changes) => {
    if (changes.isAutoTranslate) updateLocalState(changes.isAutoTranslate.newValue);
    const isConfigChanged = changes.writingMode || changes.targetLang;
    if (isConfigChanged && isAutoTranslate) {
        console.log("[MangaTrans] 配置项变更，重新翻译...");
        removeAllOverlays();
        document.querySelectorAll('img[data-has-trans]').forEach(img => img.removeAttribute('data-has-trans'));
        deepScanAndObserve();
    }
});

// --- 深度探测逻辑 ---
function deepScanAndObserve() {
    if (!isAutoTranslate) return;
    function scan(node) {
        if (node.tagName === 'IMG') {
            const rect = node.getBoundingClientRect();
            if (node.src && (rect.width > 100 || node.naturalWidth > 100)) {
                imageObserver.observe(node);
                if (rect.top < window.innerHeight && rect.bottom > 0) triggerSingleTranslation(node);
            }
        }
        if (node.shadowRoot) scanChildren(node.shadowRoot);
        scanChildren(node);
    }
    function scanChildren(parent) {
        for (let i = 0; i < parent.children.length; i++) scan(parent.children[i]);
    }
    scan(document.documentElement);
}

function injectUI() {
    const comicRead = document.getElementById('comicRead');
    const isReadModeActive = comicRead && comicRead.shadowRoot && comicRead.hasAttribute('show');
    if (isReadModeActive) {
        document.getElementById('manga-trans-container')?.remove();
        return;
    }
    if (document.getElementById('mangaFile') && !document.getElementById('manga-trans-container')) {
        const container = document.createElement('div');
        container.id = 'manga-trans-container';
        container.style.cssText = `position:fixed; top:80px; right:20px; z-index:2147483647;`;
        container.innerHTML = `
            <div class="trans-panel" style="background:#1a1a1a; border:1px solid #333; padding:10px 15px; border-radius:12px; display:flex; align-items:center; gap:12px; color:#eee; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                <span style="font-size:14px; font-weight:bold;">智能翻译</span>
                <input type="checkbox" id="manga-trans-check" ${isAutoTranslate ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer; accent-color:#ff4d4f;">
            </div>
        `;
        document.body.appendChild(container);
        document.getElementById('manga-trans-check').addEventListener('change', (e) => chrome.storage.sync.set({ isAutoTranslate: e.target.checked }));
    }
}

async function triggerSingleTranslation(img) {
    if (!isAutoTranslate || img.hasAttribute('data-has-trans')) return;
    img.setAttribute('data-has-trans', 'loading');
    showLoading();
    chrome.storage.sync.get(['writingMode', 'targetLang'], (prefs) => {
        chrome.runtime.sendMessage({ type: "TRANSLATE_IMAGE", imgSrc: img.src }, (response) => {
            hideLoading();
            if (response && response.success) {
                renderOverlay(img, response.data, prefs.writingMode || 'auto');
                img.setAttribute('data-has-trans', 'done');
            } else {
                img.removeAttribute('data-has-trans');
            }
        });
    });
}

function showLoading() {
    if (document.getElementById('manga-trans-loader')) return;
    const loader = document.createElement('div');
    loader.id = 'manga-trans-loader';
    loader.innerText = '正在翻译中...';
    loader.style.cssText = `position:fixed; top:20px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:white; padding:10px 25px; border-radius:20px; z-index:2147483647; font-size:14px; font-weight:bold; box-shadow: 0 4px 15px rgba(0,0,0,0.5);`;
    document.body.appendChild(loader);
}

function hideLoading() {
    setTimeout(() => {
        if (!document.querySelector('img[data-has-trans="loading"]')) document.getElementById('manga-trans-loader')?.remove();
    }, 500);
}

function renderOverlay(imgElement, results, userWritingMode) {
    if (!Array.isArray(results) || !imgElement.isConnected) return;
    const parent = imgElement.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.querySelectorAll('.manga-trans-overlay-container').forEach(c => c.remove());
    const container = document.createElement('div');
    container.className = 'manga-trans-overlay-container';
    container.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:100;`;
    results.forEach(item => {
        const box = item.box || item.box_2d;
        if (!box) return;
        const [ymin, xmin, ymax, xmax] = box;
        const widthPct = (xmax - xmin) / 10;
        const heightPct = (ymax - ymin) / 10;
        let isVertical = (userWritingMode === 'vertical') || (userWritingMode === 'auto' && heightPct > widthPct * 1.1);
        const physWidth = (widthPct / 100) * imgElement.clientWidth;
        const physHeight = (heightPct / 100) * imgElement.clientHeight;
        const shortSide = Math.min(physWidth, physHeight);
        let fontSize = Math.max(10, Math.min(22, shortSide * 0.45));
        const text = item.text || item.translated_text || "";
        if (text.length > 15) fontSize *= 0.85;

        const textBox = document.createElement('div');
        const centerX = xmin / 10 + widthPct / 2;
        const centerY = ymin / 10 + heightPct / 2;
        textBox.style.cssText = `position:absolute; top:${centerY}%; left:${centerX}%; width:${widthPct}%; height:${heightPct}%; display:flex; align-items:center; justify-content:center; overflow:visible; transform: translate(-50%, -50%);`;
        
        const textSpan = document.createElement('span');
        textSpan.innerText = text;
        textSpan.style.cssText = `background:white; padding:4px 8px; border-radius:6px; box-shadow:0 2px 8px rgba(0,0,0,0.3); font-weight:bold; color:black; font-size:${fontSize}px; line-height:1.2; text-align:center; word-break:break-all; border:2px dashed #ff4d4f; box-sizing:border-box; width:fit-content; height:fit-content; max-width:${Math.max(physWidth * 1.5, 200)}px; display:flex; align-items:center; justify-content:center; white-space:normal; ${isVertical ? 'writing-mode:vertical-rl; text-orientation:upright; height:fit-content;' : ''}`;
        
        textBox.appendChild(textSpan);
        container.appendChild(textBox);
    });
    parent.appendChild(container);
}

function removeAllOverlays() {
    document.querySelectorAll('.manga-trans-overlay-container').forEach(el => el.remove());
    function clearShadow(root) {
        root.querySelectorAll?.('*').forEach(el => {
            if (el.shadowRoot) {
                el.shadowRoot.querySelectorAll('.manga-trans-overlay-container').forEach(c => c.remove());
                clearShadow(el.shadowRoot);
            }
        });
    }
    clearShadow(document);
    document.querySelectorAll('img[data-has-trans]').forEach(img => img.removeAttribute('data-has-trans'));
}

async function handleInitialState() {
    const navs = performance.getEntriesByType("navigation");
    const isReload = navs.length > 0 && navs[0].type === "reload";
    if (isReload) {
        await chrome.storage.sync.set({ isAutoTranslate: false });
        updateLocalState(false);
    } else {
        const result = await chrome.storage.sync.get(['isAutoTranslate']);
        updateLocalState(!!result.isAutoTranslate);
    }
}

function helper_debounce(fn, delay) {
    let timer = null;
    return (...args) => { if (timer) clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function setupObservers() {
    window.addEventListener('hashchange', () => { if (isAutoTranslate) { removeAllOverlays(); setTimeout(deepScanAndObserve, 500); } });
    const domObserver = new MutationObserver(helper_debounce(() => { injectUI(); if (isAutoTranslate) deepScanAndObserve(); }, 200));
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
}

handleInitialState();
setupObservers();
setInterval(() => { injectUI(); if (isAutoTranslate) deepScanAndObserve(); }, 500);
