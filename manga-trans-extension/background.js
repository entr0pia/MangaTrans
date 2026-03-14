// --- 全局会话状态 ---
let tabGlossaries = {}; // 按标签页隔离术语表: { tabId: { "原文": "译文" } }

// --- 动态修改 Referer ---
const RULE_ID = 1;
async function setupRefererRule() {
    const rules = [{
        id: RULE_ID, priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: "https://www.manhuagui.com/" }] },
        condition: { urlFilter: "|https://*.hamreus.com/*", resourceTypes: ["xmlhttprequest"] }
    }];
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules: rules });
}

async function registerMainWorldScript() {
    try {
        if (chrome.userScripts) {
            const scripts = await chrome.userScripts.getScripts();
            if (scripts.some(s => s.id === 'shadow-proxy')) await chrome.userScripts.unregister({ ids: ['shadow-proxy'] });
            await chrome.userScripts.register([{
                id: 'shadow-proxy', world: 'MAIN', matches: ["*://*.manhuagui.com/*", "*://*.mhgui.com/*"],
                js: [{ file: 'inject.js' }], runAt: 'document_start'
            }]);
        }
    } catch (err) { console.error("[ManhuaGui Trans] Script registration failed:", err); }
}

chrome.runtime.onInstalled.addListener(() => { setupRefererRule(); registerMainWorldScript(); });
chrome.runtime.onStartup.addListener(() => { setupRefererRule(); registerMainWorldScript(); });

// 监听标签页重载：仅在“硬重载”时清空该标签页的术语表
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url && tab.url.includes("manhuagui.com")) {
        // 排除掉仅仅是 Hash 变化（SPA翻页）的情况
        if (!tab.url.includes('#')) {
            console.log(`[ManhuaGui Trans] 标签页 ${tabId} 刷新，清空术语表`);
            delete tabGlossaries[tabId];
        }
    }
});

// 标签页关闭时清理内存
chrome.tabs.onRemoved.addListener((tabId) => {
    delete tabGlossaries[tabId];
});

// --- 翻译逻辑 ---
async function callOpenAITranslate(imgSrc, config, tabId, retryCount = 0) {
    const { baseUrl, apiKey, modelName, targetLang } = config;
    const finalUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const finalLang = targetLang || "简体中文";

    // 初始化并获取该标签页的术语表
    if (!tabGlossaries[tabId]) tabGlossaries[tabId] = {};
    const glossary = tabGlossaries[tabId];

    const glossaryContext = Object.entries(glossary)
        .map(([raw, trans]) => `${raw} -> ${trans}`)
        .join('\n');

    const prompt = `你是一个专业的漫画汉化组助手。
    任务：识别图中所有对话气泡和旁白文字，将其日语翻译成${finalLang}并标注位置。
    坐标规则：使用 [ymin, xmin, ymax, xmax] 格式，范围为 0-1000。
    注意：(0,0) 必须是图像文件的绝对左上角顶点。不要自行裁剪。
    要求：译文请提供平铺的文本，不要包含换行符。

    过滤规则：请务必忽略以下内容：
    1. 画面外的标题、作者名、卷标、章节号。
    2. 页面边缘或角上的页码、日期、出版信息。
    3. 网站水印、App 下载引导、广告文字。
    4. 仅包含标点符号（如 ?、!、...、～ 等）而没有任何文字内容的气泡。

    专有名词一致性：
    ${glossaryContext ? `请务必遵循以下已有的翻译对照：\n${glossaryContext}` : '请识别并统一人名、地名等专有名词的翻译。'}

    你必须返回一个 JSON 对象，结构如下：
    {
      "translations": [
        { "box": [ymin, xmin, ymax, xmax], "text": "译文" }
      ],
      "new_terms": { "原文": "译文" }
    }
    注意关于 new_terms 的提取规则：
    1. 仅提取：人名、角色绰号、地名、以及本作品特有的专有名称。
    2. 没必要的：普通的通用物品名称（如：公路车、头盔、水壶、咖啡等，就是可以通过这个词在购物网站搜索的那种）。
    3. 仅输出 JSON，不要任何解释文字。`;

    try {
        console.log(`[ManhuaGui Trans] [Tab:${tabId}] 请求翻译 (尝试 ${retryCount + 1})...`);
        const imgBlob = await fetch(imgSrc).then(r => r.blob());
        const base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(imgBlob);
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 35000);

        const response = await fetch(finalUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: modelName || "gpt-4o-mini",
                messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: base64Data } }] }],
                temperature: 0
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            if ((response.status === 429 || response.status >= 500) && retryCount < 2) {
                await new Promise(r => setTimeout(r, 2000));
                return callOpenAITranslate(imgSrc, config, tabId, retryCount + 1);
            }
            throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        const content = result.choices[0].message.content;
        const parsed = parseSafeJSON(content);

        if (parsed.new_terms) {
            Object.assign(glossary, parsed.new_terms);
            console.log(`[ManhuaGui Trans] [Tab:${tabId}] 术语表更新:`, glossary);
        }

        return parsed.translations || [];
    } catch (error) {
        if ((error.name === 'TypeError' || error.name === 'AbortError') && retryCount < 2) {
            await new Promise(r => setTimeout(r, 1500));
            return callOpenAITranslate(imgSrc, config, tabId, retryCount + 1);
        }
        throw error;
    }
}

function parseSafeJSON(str) {
    let cleaned = str.replace(/```json|```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : cleaned);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "TRANSLATE_IMAGE") {
        const tabId = sender.tab.id;
        chrome.storage.sync.get(['baseUrl', 'apiKey', 'modelName', 'targetLang'], async (result) => {
            if (!result.apiKey) { sendResponse({ success: false, error: "未配置 API" }); return; }
            try {
                const data = await callOpenAITranslate(request.imgSrc, result, tabId);
                sendResponse({ success: true, data: data });
            } catch (err) { sendResponse({ success: false, error: err.message }); }
        });
        return true;
    }
});
