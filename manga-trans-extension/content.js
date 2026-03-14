// --- 状态管理 ---
let isAutoTranslate = false;
let currentCid = null;

// 使用 IntersectionObserver 监听图片进入视口
const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && isAutoTranslate) {
            const img = entry.target;
            // 确保图片有 src 且未被翻译
            if (img.src && !img.hasAttribute('data-has-trans')) {
                triggerSingleTranslation(img);
            }
        }
    });
}, { threshold: 0.1 });

// --- 状态同步 ---
function updateLocalState(enabled) {
    isAutoTranslate = enabled;
    const checkbox = document.getElementById('manga-trans-check');
    if (checkbox) checkbox.checked = enabled;
    if (enabled) deepScanAndObserve();
    else removeAllOverlays();
}

chrome.storage.sync.get(['isAutoTranslate'], (r) => updateLocalState(!!result.isAutoTranslate));
chrome.storage.onChanged.addListener((c) => { if (c.isAutoTranslate) updateLocalState(c.isAutoTranslate.newValue); });

// --- 深度穿透探测逻辑 (针对 Shadow DOM & ComicRead) ---
function deepScanAndObserve() {
    if (!isAutoTranslate) return;

    function scan(node) {
        // 探测图片
        if (node.tagName === 'IMG') {
            const rect = node.getBoundingClientRect();
            if (node.src && (rect.width > 200 || node.naturalWidth > 200)) {
                imageObserver.observe(node);
                // 如果已经在视口内，立即尝试翻译
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    triggerSingleTranslation(node);
                }
            }
        }
        
        // 穿透 Shadow Root
        if (node.shadowRoot) {
            scanChildren(node.shadowRoot);
        }
        scanChildren(node);
    }

    function scanChildren(parent) {
        for (let i = 0; i < parent.children.length; i++) {
            scan(parent.children[i]);
        }
    }

    scan(document.documentElement);
}

function injectUI() {
    const comicRead = document.getElementById('comicRead');
    const isReadModeActive = comicRead && (comicRead.hasAttribute('show') || comicRead.style.display !== 'none');

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
                <input type="checkbox" id="manga-trans-check" ${isAutoTranslate ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
            </div>
        `;
        document.body.appendChild(container);
        document.getElementById('manga-trans-check').addEventListener('change', (e) => {
            chrome.storage.sync.set({ isAutoTranslate: e.target.checked });
        });
    }
}

async function triggerSingleTranslation(img) {
    if (!isAutoTranslate || img.hasAttribute('data-has-trans')) return;
    
    // 标记正在处理，防止重复
    img.setAttribute('data-has-trans', 'loading');
    
    chrome.storage.sync.get(['writingMode'], (prefs) => {
        chrome.runtime.sendMessage({ type: "TRANSLATE_IMAGE", imgSrc: img.src }, (response) => {
            if (response && response.success) {
                renderOverlay(img, response.data, prefs.writingMode || 'auto');
                img.setAttribute('data-has-trans', 'done');
            } else {
                img.removeAttribute('data-has-trans');
            }
        });
    });
}

function renderOverlay(imgElement, results, userWritingMode) {
    if (!Array.isArray(results) || !imgElement.isConnected) return;

    // 确保父级相对定位
    const parent = imgElement.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    
    // 如果已经有容器了，先删除旧的
    parent.querySelectorAll('.manga-trans-overlay-container').forEach(c => c.remove());

    const container = document.createElement('div');
    container.className = 'manga-trans-overlay-container';
    container.style.cssText = `position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none; z-index:100;`;

    results.forEach(item => {
        const box = item.box || item.box_2d;
        if (!box) return;
        const [ymin, xmin, ymax, xmax] = box;
        let isVertical = (userWritingMode === 'vertical') || (userWritingMode === 'auto' && (ymax - ymin) > (xmax - xmin) * 1.1);
        const fontSize = Math.max(10, Math.min(22, ((ymax - ymin) / 1000) * imgElement.clientHeight * 0.42));

        const textBox = document.createElement('div');
        textBox.style.cssText = `position:absolute; top:${ymin/10}%; left:${xmin/10}%; width:${(xmax-xmin)/10}%; height:${(ymax-ymin)/10}%; display:flex; align-items:center; justify-content:center;`;
        
        const textSpan = document.createElement('span');
        textSpan.innerText = item.text || item.translated_text || "";
        textSpan.style.cssText = `
            background:white; padding:4px 8px; border-radius:4px;
            box-shadow:0 1px 4px rgba(0,0,0,0.3); font-weight:bold; color:black;
            font-size:${fontSize}px; line-height:1.3; text-align:center; word-break:break-all;
            border:2px dashed #ff4d4f; box-sizing:border-box;
            ${isVertical ? 'writing-mode:vertical-rl; text-orientation:upright; height:auto; min-height:100%;' : 'width:auto; min-width:100%;'}
        `;
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

// 核心初始化与持续探测
function init() {
    injectUI();
    // 监听 Hash 变化
    window.addEventListener('hashchange', () => {
        if (isAutoTranslate) {
            removeAllOverlays();
            setTimeout(deepScanAndObserve, 500);
        }
    });

    // 采用更强力的定时探测，应对 ComicRead 的动态 DOM 刷新
    setInterval(() => {
        injectUI();
        if (isAutoTranslate) deepScanAndObserve();
    }, 2000);
}

init();
