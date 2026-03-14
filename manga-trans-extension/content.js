// --- 状态管理 ---
let isAutoTranslate = false;
let currentCid = null;
let translateTimeout = null;

// --- 注入 Shadow DOM 劫持脚本 ---

// --- 适配 ComicRead.js & Shadow DOM ---
function getMangaImages() {
    let allImgs = [];

    // 1. 扫描常规 DOM
    const defaultImg = document.getElementById('mangaFile');
    if (defaultImg) allImgs.push(defaultImg);

    // 2. 穿透所有 Shadow Roots
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
        if (el.shadowRoot) {
            const imgs = el.shadowRoot.querySelectorAll('img');
            imgs.forEach(img => {
                const rect = img.getBoundingClientRect();
                // 只有看起来像漫画（宽高足够）且已加载 src 的图片才记录
                if (img.src && rect.width > 200 && rect.height > 200) {
                    allImgs.push(img);
                }
            });
        }
    });
    
    const uniqueImgs = Array.from(new Set(allImgs));
    if (uniqueImgs.length > 0) {
        console.log(`[ManhuaGui Trans] 探测到 ${uniqueImgs.length} 张图片`);
    }
    return uniqueImgs;
}

// --- UI 注入 (强化版) ---
function injectUI() {
    if (document.getElementById('manga-trans-container')) return;

    const container = document.createElement('div');
    container.id = 'manga-trans-container';
    // 采用更显眼的样式和最高的 z-index
    container.style.cssText = `
        position: fixed !important;
        top: 100px !important;
        right: 20px !important;
        z-index: 2147483647 !important;
        display: block !important;
        pointer-events: auto !important;
    `;
    
    container.innerHTML = `
        <div class="trans-panel" style="background: #1a1a1a; border: 2px solid #ff4d4f; padding: 10px; border-radius: 12px; box-shadow: 0 0 15px rgba(255,77,79,0.5);">
            <span style="color: #fff; font-size: 14px; margin-right: 10px; font-weight: bold;">智能翻译</span>
            <input type="checkbox" id="manga-trans-check" style="width: 20px; height: 20px; cursor: pointer;">
        </div>
    `;
    
    document.documentElement.appendChild(container); // 挂载到 HTML 根节点更保险

    document.getElementById('manga-trans-check').addEventListener('change', (e) => {
        isAutoTranslate = e.target.checked;
        console.log("[ManhuaGui Trans] 自动翻译状态:", isAutoTranslate);
        if (isAutoTranslate) triggerAllTranslations();
        else removeAllOverlays();
    });
}

function checkChapterChange() {
    const path = window.location.pathname;
    const cidMatch = path.match(/\/comic\/\d+\/(\d+)\.html/);
    const newCid = cidMatch ? cidMatch[1] : null;

    if (currentCid && newCid !== currentCid) {
        console.log("[ManhuaGui Trans] 章节已切换，重置。");
        isAutoTranslate = false;
        const checkbox = document.getElementById('manga-trans-check');
        if (checkbox) checkbox.checked = false;
        removeAllOverlays();
    }
    currentCid = newCid;
}

function setupObservers() {
    window.addEventListener('hashchange', () => {
        console.log("[ManhuaGui Trans] Hash 变更:", location.hash);
        if (isAutoTranslate) handlePageChange();
    });

    const observer = new MutationObserver(helper_debounce(() => {
        if (isAutoTranslate) triggerAllTranslations();
        injectUI(); // 确保 UI 没被脚本删掉
    }, 1500));

    observer.observe(document.documentElement, { childList: true, subtree: true });
}

function handlePageChange() {
    removeAllOverlays();
    if (translateTimeout) clearTimeout(translateTimeout);
    translateTimeout = setTimeout(triggerAllTranslations, 800);
}

function helper_debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

async function triggerAllTranslations() {
    const imgs = getMangaImages();
    if (!imgs.length || !isAutoTranslate) return;

    for (const img of imgs) {
        if (img.hasAttribute('data-has-trans')) continue;
        
        img.setAttribute('data-has-trans', 'loading');
        console.log("[ManhuaGui Trans] 正在翻译图片:", img.src.substring(0, 100) + "...");
        
        chrome.storage.sync.get(['writingMode'], (prefs) => {
            chrome.runtime.sendMessage({
                type: "TRANSLATE_IMAGE",
                imgSrc: img.src
            }, (response) => {
                if (response && response.success) {
                    renderOverlay(img, response.data, prefs.writingMode || 'auto');
                    img.setAttribute('data-has-trans', 'done');
                } else {
                    console.error("[ManhuaGui Trans] API 失败:", response?.error);
                    img.removeAttribute('data-has-trans');
                }
            });
        });
    }
}

function renderOverlay(imgElement, results, userWritingMode) {
    if (!Array.isArray(results)) return;

    const parent = imgElement.parentElement;
    if (!parent) return;
    parent.style.position = 'relative';
    
    const container = document.createElement('div');
    container.className = 'manga-trans-overlay-container';
    container.style.cssText = `
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        pointer-events: none; z-index: 2147483640;
    `;

    results.forEach(item => {
        const box = item.box || item.box_2d;
        if (!box) return;
        const [ymin, xmin, ymax, xmax] = box;
        const text = item.text || item.translated_text || "";

        const textBox = document.createElement('div');
        textBox.className = 'manga-trans-overlay';
        
        let isVertical = false;
        if (userWritingMode === 'vertical') isVertical = true;
        else if (userWritingMode === 'horizontal') isVertical = false;
        else isVertical = (ymax - ymin) > (xmax - xmin) * 1.1;

        // 字体大小基于容器当前显示的高度
        const displayHeightPx = ((ymax - ymin) / 1000) * imgElement.clientHeight;
        const fontSize = Math.max(10, Math.min(22, displayHeightPx * 0.4));

        textBox.style.cssText = `
            position: absolute;
            top: ${ymin/10}%; left: ${xmin/10}%; width: ${(xmax-xmin)/10}%; height: ${(ymax-ymin)/10}%;
            display: flex; align-items: center; justify-content: center;
        `;
        
        const textSpan = document.createElement('span');
        textSpan.innerText = text;
        textSpan.style.cssText = `
            background: white; padding: 4px 8px; border-radius: 4px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3); font-weight: bold; color: black;
            font-family: sans-serif; font-size: ${fontSize}px;
            line-height: 1.2; text-align: center; word-break: break-all;
            border: 2px dashed #ff4d4f;
            ${isVertical ? 'writing-mode: vertical-rl; text-orientation: upright; height: 100%;' : 'width: auto;'}
        `;
        
        textBox.appendChild(textSpan);
        container.appendChild(textBox);
    });
    
    parent.appendChild(container);
}

function removeAllOverlays() {
    document.querySelectorAll('.manga-trans-overlay-container').forEach(el => el.remove());
    // 递归清理所有 Shadow Roots
    document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
            el.shadowRoot.querySelectorAll('.manga-trans-overlay-container').forEach(c => c.remove());
        }
    });
    document.querySelectorAll('img[data-has-trans]').forEach(img => img.removeAttribute('data-has-trans'));
}

function init() {
    injectUI();
    checkChapterChange();
    setupObservers();
    console.log("[ManhuaGui Trans] 插件初始化完成");
}

init();
