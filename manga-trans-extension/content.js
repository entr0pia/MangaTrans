// --- 基础注入 ---
(function() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('inject.js');
    s.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(s);
})();

// --- 状态管理 ---
let isAutoTranslate = false; // 内存变量，页面刷新即重置
let currentCid = null;
let lastPathname = location.pathname;

// 使用 IntersectionObserver 监听图片进入视口
const imageObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting && isAutoTranslate) {
            const img = entry.target;
            if (img.src && !img.hasAttribute('data-has-trans')) triggerSingleTranslation(img);
        }
    });
}, { threshold: 0.1 });

// --- 深度穿透重置辅助 ---
function resetMangaState(root = document) {
    root.querySelectorAll?.('img[data-has-trans]').forEach(img => img.removeAttribute('data-has-trans'));
    root.querySelectorAll?.('.manga-trans-overlay-container').forEach(c => c.remove());
    const all = root.querySelectorAll?.('*') || [];
    all.forEach(el => { if (el.shadowRoot) resetMangaState(el.shadowRoot); });
}

// --- 状态同步辅助 ---
function updateLocalState(enabled) {
    isAutoTranslate = enabled;
    const checkbox = document.getElementById('manga-trans-check');
    if (checkbox) checkbox.checked = enabled;
    if (enabled) {
        console.log("[MangaTrans] 翻译已启用");
        resetMangaState();
        deepScanAndObserve();
    } else {
        console.log("[MangaTrans] 翻译已关闭");
        resetMangaState();
    }
}

// 接收来自后台的指令
chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "URL_CHANGED") {
        const newPath = new URL(request.url).pathname;
        if (newPath !== lastPathname) {
            console.log(`[MangaTrans] 路径变更: ${lastPathname} -> ${newPath}`);
            lastPathname = newPath;
            isAutoTranslate = false;
            chrome.storage.sync.set({ isAutoTranslate: false });
            document.getElementById('manga-trans-container')?.remove();
            resetMangaState();
            injectUI();
        }
    }
});

// 监听 storage 变化
chrome.storage.onChanged.addListener((changes) => {
    if (changes.isAutoTranslate) {
        updateLocalState(changes.isAutoTranslate.newValue);
    } else if (isAutoTranslate) {
        // 检查是否有任何配置项发生了变化
        const hasConfigChanged = [
            'writingMode', 'targetLang', 'baseUrl', 
            'apiKey', 'modelName', 'reasoningEffort'
        ].some(key => changes[key]);

        if (hasConfigChanged) {
            console.log("[MangaTrans] 配置变更，正在重新翻译...");
            resetMangaState();
            deepScanAndObserve();
        }
    }
});

// --- 章节切换检测 ---
function checkChapterChange() {
    const path = window.location.pathname;
    const cidMatch = path.match(/\/comic\/\d+\/(\d+)\.html/) || path.match(/\/photo\/(\d+)/);
    const newCid = cidMatch ? cidMatch[1] : null;
    if (currentCid && newCid !== currentCid) {
        isAutoTranslate = false;
        document.getElementById('manga-trans-container')?.remove();
        chrome.storage.sync.set({ isAutoTranslate: false });
        updateLocalState(false);
    }
    currentCid = newCid;
}

// --- 深度探测逻辑 ---
function deepScanAndObserve() {
    if (!isAutoTranslate) return;
    
    function scan(node) {
        if (!node) return;

        // 处理图片元素
        if (node.tagName === 'IMG') {
            const rect = node.getBoundingClientRect();
            // 如果图片还未加载（宽高为0），但有 src，也应当观察
            // 漫画图片通常宽度都很大
            const isPotentialManga = node.src && (
                rect.width > 100 || 
                node.naturalWidth > 100 || 
                (rect.width === 0 && node.getAttribute('src')) 
            );

            if (isPotentialManga) {
                imageObserver.observe(node);
                // 已经在视口内的立即触发
                if (rect.top < window.innerHeight && rect.bottom > 0 && rect.height > 0) {
                    triggerSingleTranslation(node);
                }
            }
        }

        // 递归探测 Shadow DOM
        if (node.shadowRoot) {
            scanChildren(node.shadowRoot);
        }
        
        // 递归探测普通子节点
        scanChildren(node);
    }

    function scanChildren(parent) {
        if (!parent || !parent.children) return;
        for (let i = 0; i < parent.children.length; i++) {
            scan(parent.children[i]);
        }
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
    const hasManga = document.getElementById('mangaFile') || document.querySelector('.read-container') || document.querySelector('.comic-view');
    if (hasManga && !document.getElementById('manga-trans-container')) {
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
        const cb = document.getElementById('manga-trans-check');
        cb.addEventListener('change', (e) => chrome.storage.sync.set({ isAutoTranslate: e.target.checked }));
    }
}

async function triggerSingleTranslation(img) {
    if (!isAutoTranslate || img.hasAttribute('data-has-trans')) return;
    
    // 基础环境检查
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
        console.warn("[MangaTrans] 扩展环境已失效");
        return;
    }

    // 辅助函数：尝试本地抓取图片数据
    const captureImage = async (imageEl) => {
        try {
            if (!imageEl.complete || imageEl.naturalWidth === 0) {
                console.log("[MangaTrans] 图片未加载完成，跳过 Canvas 捕获:", imageEl.src);
                return null;
            }
            
            // 尝试 1: Canvas 直接绘制 (最快，但受 CORS 限制)
            try {
                const canvas = document.createElement('canvas');
                canvas.width = imageEl.naturalWidth;
                canvas.height = imageEl.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(imageEl, 0, 0);
                const data = canvas.toDataURL('image/jpeg', 0.85);
                console.log("[MangaTrans] Canvas 捕获成功:", imageEl.src.substring(0, 50) + "...");
                return data;
            } catch (canvasErr) {
                // 尝试 2: 如果 Canvas 失败（通常是跨域），在 content 侧进行 fetch
                // 在 content 侧 fetch 能利用浏览器已经下载好的缓存，且能处理 Blob URL
                console.log("[MangaTrans] Canvas 捕获受限，尝试本地 Fetch:", imageEl.src);
                const response = await fetch(imageEl.src);
                const blob = await response.blob();
                return await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            }
        } catch (e) {
            console.warn("[MangaTrans] 本地捕获彻底失败，回退到后台获取:", e.message);
            return null;
        }
    };

    const localBase64 = await captureImage(img);
    img.setAttribute('data-has-trans', 'loading');
    showLoading();
    
    try {
        chrome.storage.sync.get(['writingMode', 'targetLang'], (prefs) => {
            if (!chrome.runtime?.id) {
                hideLoading();
                img.removeAttribute('data-has-trans');
                return;
            }

            try {
                chrome.runtime.sendMessage({ 
                    type: "TRANSLATE_IMAGE", 
                    imgSrc: img.src,
                    imgData: localBase64 // 优先传递本地捕获的数据
                }, (response) => {
                    hideLoading();
                    if (chrome.runtime.lastError) {
                        img.removeAttribute('data-has-trans');
                        return;
                    }
                    if (response && response.success) {
                        renderOverlay(img, response.data, prefs.writingMode || 'auto');
                        img.setAttribute('data-has-trans', 'done');
                    } else {
                        img.removeAttribute('data-has-trans');
                    }
                });
            } catch (innerErr) {
                img.removeAttribute('data-has-trans');
                hideLoading();
            }
        });
    } catch (e) {
        img.removeAttribute('data-has-trans');
        hideLoading();
    }
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
    
    // 确保父容器有定位属性
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    
    // 使用唯一的 ID 标识每张图片的翻译层，防止卷轴模式下误删其他页面的翻译
    const overlayId = `manga-trans-overlay-${Math.random().toString(36).substr(2, 9)}`;
    const oldOverlayId = imgElement.getAttribute('data-overlay-id');
    if (oldOverlayId) {
        parent.querySelector(`#${oldOverlayId}`)?.remove();
    }
    imgElement.setAttribute('data-overlay-id', overlayId);

    const container = document.createElement('div');
    container.id = overlayId;
    container.className = 'manga-trans-overlay-container';
    
    // 关键修复：翻译容器应与图片在父容器中的位置完全一致
    const rect = {
        top: imgElement.offsetTop,
        left: imgElement.offsetLeft,
        width: imgElement.clientWidth,
        height: imgElement.clientHeight
    };
    
    container.style.cssText = `position:absolute; top:${rect.top}px; left:${rect.left}px; width:${rect.width}px; height:${rect.height}px; pointer-events:none; z-index:2147483647;`;
    
    results.forEach(item => {
        const box = item.box || item.box_2d;
        if (!box) return;
        const [ymin, xmin, ymax, xmax] = box;
        const widthPct = (xmax - xmin) / 10;
        const heightPct = (ymax - ymin) / 10;
        
        // 字符预处理：将双宽省略号和破折号缩减为单宽，节省垂直空间
        let text = (item.text || item.translated_text || "")
            .replace(/……/g, '…')
            .replace(/——/g, '—');

        let isVertical = (userWritingMode === 'vertical') || (userWritingMode === 'auto' && (item.direction ? item.direction === 'vertical' : heightPct > widthPct * 1.1));
        
        // 基于图片当前显示宽高的动态字号
        const physWidth = (widthPct / 100) * rect.width;
        const physHeight = (heightPct / 100) * rect.height;
        const shortSide = Math.min(physWidth, physHeight);
        let fontSize = Math.max(10, Math.min(22, shortSide * 0.45));
        if (text.length > 15) fontSize *= 0.85;

        let extraStyles = '';
        if (isVertical) {
            const absoluteMinH = Math.min(text.length, 3) * fontSize * 1.2;
            const effectiveMaxH = Math.max(physHeight * 1.2, absoluteMinH);
            extraStyles = `writing-mode:vertical-rl; display:block; height:fit-content; max-height:${effectiveMaxH}px; width:fit-content; max-width:${Math.max(physWidth * 1.5, 200)}px; letter-spacing:1px; line-break:anywhere; direction:ltr !important; unicode-bidi:isolate !important; padding: 4px 6px;`;
        } else {
            extraStyles = `writing-mode:horizontal-tb; direction:ltr !important; unicode-bidi:isolate !important; display:inline-block; text-align:center; width:fit-content; height:fit-content; max-width:${Math.max(physWidth * 1.5, 200)}px; padding: 6px 10px;`;
        }

        const textBox = document.createElement('div');
        const centerX = xmin / 10 + widthPct / 2;
        const centerY = ymin / 10 + heightPct / 2;
        textBox.style.cssText = `position:absolute; top:${centerY}%; left:${centerX}%; width:${widthPct}%; height:${heightPct}%; display:flex; align-items:center; justify-content:center; overflow:visible; transform: translate(-50%, -50%);`;
        
        const textSpan = document.createElement('span');
        textSpan.innerText = text;
        textSpan.style.cssText = `background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.3); font-weight: bold; color: black; font-size: ${fontSize}px; line-height: 1.3; word-break: break-all; border: 2px dashed #ff4d4f; box-sizing: border-box; white-space: normal; ${extraStyles}`;
        
        textBox.appendChild(textSpan);
        container.appendChild(textBox);
    });
    parent.appendChild(container);
}

function helper_debounce(fn, delay) {
    let timer = null;
    return (...args) => { if (timer) clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function setupObservers() {
    window.addEventListener('hashchange', () => { if (isAutoTranslate) { resetMangaState(); setTimeout(deepScanAndObserve, 500); } });
    const domObserver = new MutationObserver(helper_debounce(() => {
        checkChapterChange();
        injectUI();
        if (isAutoTranslate) deepScanAndObserve();
    }, 200));
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
}

async function handleInitialState() {
    const navs = performance.getEntriesByType("navigation");
    const isReload = navs.length > 0 && navs[0].type === "reload";
    if (isReload) { await chrome.storage.sync.set({ isAutoTranslate: false }); updateLocalState(false); }
    else { const result = await chrome.storage.sync.get(['isAutoTranslate']); updateLocalState(!!result.isAutoTranslate); }
}

handleInitialState();
setupObservers();
setInterval(() => { if (isAutoTranslate) deepScanAndObserve(); injectUI(); checkChapterChange(); }, 500);
