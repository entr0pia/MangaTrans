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
                handlePageChange(mangaImg);
            }
        });
    }).observe(mangaImg, { attributes: true });
}

function handlePageChange(img) {
    removeAllOverlays();
    if (translateTimeout) clearTimeout(translateTimeout);
    if (img.complete) scheduleTranslation();
    else img.onload = () => { scheduleTranslation(); img.onload = null; };
}

let translateTimeout = null;
function scheduleTranslation() {
    translateTimeout = setTimeout(triggerTranslation, 500);
}

async function triggerTranslation() {
    const img = document.getElementById('mangaFile');
    if (!img || !img.src || !isAutoTranslate) return;

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

function hideLoading() { document.getElementById('manga-trans-loader')?.remove(); }

function showError(imgElement, error) {
    const loader = document.createElement('div');
    loader.id = 'manga-trans-loader';
    loader.innerText = `错误: ${error || '未知'}`;
    loader.style.cssText = `position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#ff4d4f; color:white; padding:8px 20px; border-radius:20px; z-index:1000000; font-size:14px;`;
    document.body.appendChild(loader);
    setTimeout(hideLoading, 3000);
}

function renderOverlay(imgElement, results, userWritingMode) {
    if (!Array.isArray(results)) return;

    const rect = imgElement.getBoundingClientRect();
    const container = document.createElement('div');
    container.className = 'manga-trans-overlay-container';
    container.style.cssText = `position:absolute; top:${window.scrollY + rect.top}px; left:${window.scrollX + rect.left}px; width:${rect.width}px; height:${rect.height}px; pointer-events:none; z-index:9999;`;

    results.forEach(item => {
        const box = item.box || item.box_2d;
        if (!box || box.length !== 4) return;
        
        const [ymin, xmin, ymax, xmax] = box;
        const rawText = item.text || item.translated_text || "";
        // 强制移除换行符，让 CSS 处理流式布局
        const text = rawText.replace(/[\r\n]+/g, "");

        // 归一化坐标(0-1000)转换为百分比
        const top = ymin / 10;
        const left = xmin / 10;
        const width = (xmax - xmin) / 10;
        const height = (ymax - ymin) / 10;

        const textBox = document.createElement('div');
        textBox.className = 'manga-trans-overlay';
        
        let isVertical = false;
        if (userWritingMode === 'vertical') isVertical = true;
        else if (userWritingMode === 'horizontal') isVertical = false;
        else isVertical = height > width * 1.1;

        // 计算显示像素尺寸用于字体缩放
        const displayWidthPx = (width / 100) * imgElement.clientWidth;
        const displayHeightPx = (height / 100) * imgElement.clientHeight;
        const baseDim = isVertical ? displayWidthPx : displayHeightPx;
        let fontSize = Math.max(11, Math.min(22, baseDim * 0.42));

        textBox.style.cssText = `
            position: absolute;
            top: ${top}%; left: ${left}%; width: ${width}%; height: ${height}%;
            display: flex; align-items: center; justify-content: center; overflow: hidden;
        `;
        
        const textSpan = document.createElement('span');
        textSpan.innerText = text;
        textSpan.style.cssText = `
            background: white; padding: 2px 4px; border-radius: 3px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.3); font-weight: bold; color: black;
            font-family: "Microsoft YaHei", sans-serif; font-size: ${fontSize}px;
            line-height: 1.2; text-align: center; 
            word-break: break-all; white-space: normal;
            max-width: 98%; max-height: 98%; display: flex; align-items: center; justify-content: center;
            border: 2px dashed #ff4d4f;
            ${isVertical ? 'writing-mode: vertical-rl; text-orientation: upright; height: 100%;' : 'width: auto;'}
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
    window.addEventListener('hashchange', () => {
        const mangaImg = document.getElementById('mangaFile');
        if (mangaImg && isAutoTranslate) handlePageChange(mangaImg);
    });
}

let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) {
        const oldBase = lastUrl.split('#')[0];
        const newBase = location.href.split('#')[0];
        lastUrl = location.href;
        if (oldBase !== newBase) checkChapterChange();
        else {
            const mangaImg = document.getElementById('mangaFile');
            if (mangaImg && isAutoTranslate) handlePageChange(mangaImg);
        }
    }
}).observe(document, { subtree: true, childList: true });

init();
