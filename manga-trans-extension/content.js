// --- 状态管理 ---
let isAutoTranslate = false;
let currentCid = null;

function injectUI() {
    if (document.getElementById('manga-trans-container')) return;
    const container = document.createElement('div');
    container.id = 'manga-trans-container';
    container.innerHTML = `
        <div class="trans-panel">
            <span class="panel-title">智能翻译</span>
            <label class="switch-label">
                <input type="checkbox" id="manga-trans-check">
                <span class="slider"></span>
            </label>
        </div>
    `;
    document.body.appendChild(container);
    document.getElementById('manga-trans-check').addEventListener('change', (e) => {
        isAutoTranslate = e.target.checked;
        if (isAutoTranslate) triggerTranslation();
        else removeAllOverlays();
    });
}

function checkChapterChange() {
    const urlMatch = window.location.pathname.match(/\/comic\/\d+\/(\d+)\.html/);
    const newCid = urlMatch ? urlMatch[1] : null;
    if (currentCid && newCid !== currentCid) {
        isAutoTranslate = false;
        const checkbox = document.getElementById('manga-trans-check');
        if (checkbox) checkbox.checked = false;
        removeAllOverlays();
    }
    currentCid = newCid;
}

function observeMangaReader() {
    const mangaImg = document.getElementById('mangaFile');
    if (!mangaImg) { setTimeout(observeMangaReader, 1000); return; }
    new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.attributeName === 'src' && isAutoTranslate) {
                removeAllOverlays();
                triggerTranslation();
            }
        });
    }).observe(mangaImg, { attributes: true });
}

async function triggerTranslation() {
    const img = document.getElementById('mangaFile');
    if (!img || !img.src || !isAutoTranslate) return;

    console.log("[ManhuaGui Trans] 请求翻译...");
    showLoading(img);
    
    chrome.storage.sync.get(['writingMode'], (prefs) => {
        chrome.runtime.sendMessage({
            type: "TRANSLATE_IMAGE",
            imgSrc: img.src
        }, (response) => {
            hideLoading();
            if (response && response.success) {
                renderOverlay(img, response.data, prefs.writingMode || 'auto');
            } else {
                console.error("[ManhuaGui Trans] 失败:", response?.error);
                showError(img, response?.error);
            }
        });
    });
}

function showLoading(imgElement) {
    hideLoading();
    const loader = document.createElement('div');
    loader.id = 'manga-trans-loader';
    loader.innerText = '正在翻译中...';
    loader.style.cssText = `position:fixed; top:20px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.7); color:white; padding:8px 20px; border-radius:20px; z-index:1000000; font-size:14px;`;
    document.body.appendChild(loader);
}

function hideLoading() {
    document.getElementById('manga-trans-loader')?.remove();
}

function showError(imgElement, error) {
    const loader = document.createElement('div');
    loader.id = 'manga-trans-loader';
    loader.innerText = `翻译出错: ${error || '未知错误'}`;
    loader.style.cssText = `position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#ff4d4f; color:white; padding:8px 20px; border-radius:20px; z-index:1000000; font-size:14px;`;
    document.body.appendChild(loader);
    setTimeout(hideLoading, 3000);
}

function renderOverlay(imgElement, data, userWritingMode) {
    const { canvas_width, canvas_height, results } = data;
    if (!results || !results.length) return;

    const rect = imgElement.getBoundingClientRect();
    const container = document.createElement('div');
    container.className = 'manga-trans-overlay-container';
    container.style.cssText = `position:absolute; top:${window.scrollY + rect.top}px; left:${window.scrollX + rect.left}px; width:${rect.width}px; height:${rect.height}px; pointer-events:none; z-index:9999;`;

    results.forEach(item => {
        const [ymin, xmin, ymax, xmax] = item.box_2d;
        
        // 计算缩放比：实际显示宽度 / 模型感知的画布宽度
        const scaleX = 100 / canvas_width;
        const scaleY = 100 / canvas_height;

        const textBox = document.createElement('div');
        textBox.className = 'manga-trans-overlay';
        
        // 判定排版方式
        let isVertical = false;
        if (userWritingMode === 'vertical') isVertical = true;
        else if (userWritingMode === 'horizontal') isVertical = false;
        else isVertical = (ymax - ymin) > (xmax - xmin) * 1.1;

        // 估算字号
        const boxWidthPx = ((xmax - xmin) / canvas_width) * imgElement.clientWidth;
        const boxHeightPx = ((ymax - ymin) / canvas_height) * imgElement.clientHeight;
        const baseDim = isVertical ? boxWidthPx : boxHeightPx;
        let fontSize = Math.max(11, Math.min(22, baseDim * 0.45));

        textBox.style.cssText = `
            position: absolute;
            top: ${ymin * scaleY}%;
            left: ${xmin * scaleX}%;
            width: ${(xmax - xmin) * scaleX}%;
            height: ${(ymax - ymin) * scaleY}%;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        `;
        
        const textSpan = document.createElement('span');
        textSpan.innerText = item.translated_text || "";
        textSpan.style.cssText = `
            background: white; padding: 2px 4px; border-radius: 3px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3); font-weight: bold; color: black;
            font-family: "Microsoft YaHei", sans-serif; font-size: ${fontSize}px;
            line-height: 1.2; text-align: center; word-break: break-all;
            max-width: 98%; max-height: 98%; display: flex; align-items: center; justify-content: center;
            ${isVertical ? 'writing-mode: vertical-rl; text-orientation: upright; height: 100%;' : 'width: 100%;'}
        `;
        
        textBox.appendChild(textSpan);
        container.appendChild(textBox);
    });
    
    document.body.appendChild(container);
}

function removeAllOverlays() {
    document.querySelectorAll('.manga-trans-overlay-container').forEach(el => el.remove());
}

function init() {
    injectUI();
    checkChapterChange();
    observeMangaReader();
}

let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        checkChapterChange();
    }
}).observe(document, { subtree: true, childList: true });

init();
