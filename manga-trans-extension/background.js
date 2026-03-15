// --- 全局会话状态 ---
let tabGlossaries = {}; // 按标签页隔离术语表

// --- 动态修改 Referer 以绕过防盗链 ---
const RULE_ID = 1;
const DOMAINS = [
    "*://*.manhuagui.com/*", "*://*.mhgui.com/*",
    "*://*.18comic.vip/*", "*://*.18comic.org/*",
    "*://*.jm-comic.me/*", "*://*.jm-comic.org/*"
];

async function setupRefererRule() {
    const rules = [
        {
            id: RULE_ID, priority: 1,
            action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: "https://www.manhuagui.com/" }] },
            condition: { urlFilter: "|https://*.hamreus.com/*", resourceTypes: ["xmlhttprequest"] }
        },
        {
            id: 2, priority: 1,
            action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: "https://18comic.vip/" }] },
            condition: { urlFilter: "|*://*.cdnbocc.com/*", resourceTypes: ["xmlhttprequest"] } // 18comic 常用 CDN
        }
    ];
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID, 2], addRules: rules });
}

// --- 注册 MAIN world 脚本以穿透 Shadow DOM ---
async function registerMainWorldScript() {
    try {
        const scripts = await chrome.scripting.getRegisteredContentScripts();
        if (scripts.some(s => s.id === 'shadow-proxy')) await chrome.scripting.unregisterContentScripts({ ids: ['shadow-proxy'] });
        await chrome.scripting.registerContentScripts([{
            id: 'shadow-proxy', world: 'MAIN',
            matches: [
                "*://*.manhuagui.com/*", "*://*.mhgui.com/*",
                "*://*.18comic.vip/*", "*://*.18comic.org/*",
                "*://*.jm-comic.me/*", "*://*.jm-comic.org/*"
            ],
            js: ['inject.js'], runAt: 'document_start'
        }]);
        console.log("[MangaTrans] Shadow proxy registered via scripting API");
    } catch (err) { console.error("[MangaTrans] Script registration failed:", err); }
}

chrome.runtime.onInstalled.addListener(() => { setupRefererRule(); registerMainWorldScript(); });
chrome.runtime.onStartup.addListener(() => { setupRefererRule(); registerMainWorldScript(); });

// 监听标签页重载：重置开关与术语表
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url) {
        const isMangaSite = tab.url.includes("manhuagui.com") || tab.url.includes("18comic") || tab.url.includes("jm-comic");
        if (isMangaSite && !tab.url.includes('#')) {
            console.log(`[MangaTrans] 标签页 ${tabId} 刷新，重置状态`);
            delete tabGlossaries[tabId];
            chrome.storage.sync.set({ isAutoTranslate: false });
        }
    }
});

// 使用 webNavigation 监听 SPA 路径变化
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    const isMangaSite = details.url.includes("manhuagui.com") || details.url.includes("18comic") || details.url.includes("jm-comic");
    if (isMangaSite) {
        chrome.tabs.sendMessage(details.tabId, { type: "URL_CHANGED", url: details.url }).catch(() => { });
    }
});

chrome.tabs.onRemoved.addListener((tabId) => delete tabGlossaries[tabId]);

// --- 翻译逻辑 ---
async function callOpenAITranslate(imgSrc, config, tabId, retryCount = 0) {
    const { baseUrl, apiKey, modelName, targetLang, writingMode } = config;
    const finalUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const finalLang = targetLang || "简体中文";

    // 处理排版方式变量
    let modeText = "自动判断（根据原文横排或竖排）";
    if (writingMode === 'vertical') modeText = "强制竖排";
    else if (writingMode === 'horizontal') modeText = "强制横排";

    if (!tabGlossaries[tabId]) tabGlossaries[tabId] = {};
    const glossaryContext = Object.entries(tabGlossaries[tabId]).map(([r, t]) => `${r} -> ${t}`).join('\n');

    const prompt = `你是一个专业的漫画汉化组助手。
任务：识别图中所有对话气泡和旁白文字，将其日语翻译成${finalLang}并标注位置。
坐标规则：使用 [ymin, xmin, ymax, xmax] 格式，范围为 0-1000。坐标(0,0)为图像最左上角。排版方式：${modeText}
要求：
1. 译文请提供平铺的文本，不要包含换行符。
2. 对于竖排文本，请确保 box 高度能够至少容纳 3.8 个全角字符。如果译文长度(含标点)<=3，排成一列即可，横排同理
3. 如果翻译成中文标点会占两个字符，则只返回一半，如：省略号返回“…”，破折号返回“—”
4. 引号始终使用繁体引号：单引号「 」，双引号『 』
5. direction字段 为vertical 或 horizontal
6. 遵循过滤规则和 new_terms 的提取规则。

过滤规则：请务必忽略以下内容，不要对它们进行翻译或标注：
1. 画面外的标题、作者名、卷标、章节号。
2. 页面边缘或角上的页码、日期、出版信息。
3. 网站水印、App 下载引导、广告文字。
4. 仅包含标点符号（如 ?、!、...、～ 等）而没有任何文字内容的气泡。

专有名词一致性：
${glossaryContext ? `请务必遵循以下已有的翻译对照：\n${glossaryContext}` : '请识别并统一人名、地名等专有名词的翻译。'}

你必须返回一个 JSON 对象，结构如下：
{
  "translations": [
    { 
      "box": [ymin, xmin, ymax, xmax], 
      "text": "译文",
      "direction": "vertical"
    }
  ],
  "new_terms": { "原文": "译文" } 
}
注意关于 new_terms 的提取规则：
1. 仅提取：人名、角色绰号、地名、以及本作品特有的专有名称。
2. 不需要提取：通用商品名，购物网站的检索词那种（如：公路车、反光带、头盔、水壶、咖啡等）。

不要输出 JSON 以外的文字。`;

    try {
        const imgBlob = await fetch(imgSrc).then(r => r.blob());
        const base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(imgBlob);
        });
        const response = await fetch(finalUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: modelName || "gpt-4o-mini",
                messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: base64Data } }] }],
                temperature: 0
            })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        const content = result.choices[0].message.content;
        const parsed = parseSafeJSON(content);
        if (parsed.new_terms) Object.assign(tabGlossaries[tabId], parsed.new_terms);
        return parsed.translations || [];
    } catch (error) {
        if (retryCount < 2) return callOpenAITranslate(imgSrc, config, tabId, retryCount + 1);
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
        chrome.storage.sync.get(['baseUrl', 'apiKey', 'modelName', 'targetLang', 'writingMode'], async (result) => {
            if (!result.apiKey) { sendResponse({ success: false, error: "未配置 API" }); return; }
            try {
                const data = await callOpenAITranslate(request.imgSrc, result, tabId);
                sendResponse({ success: true, data: data });
            } catch (err) { sendResponse({ success: false, error: err.message }); }
        });
        return true; 
    }
});
