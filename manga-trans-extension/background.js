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
        
        // 与 manifest.json 同步的域名列表
        const matches = [
            "*://*.manhuagui.com/*", "*://*.mhgui.com/*",
            "*://*.18comic.vip/*", "*://*.18comic.org/*",
            "*://*.jm-comic.me/*", "*://*.jm-comic.org/*",
            "*://*.copymanga.org/*", "*://*.copymanga.tv/*",
            "*://*.mangacopy.com/*", "*://*.dm5.com/*",
            "*://*.mangabz.com/*", "*://*.komiic.com/*",
            "*://*.wnacg.com/*", "*://*.wnacg.org/*",
            "*://*.hanime1.me/*", "*://*.hitomi.la/*",
            "*://*.mangadex.org/*", "*://*.pixiv.net/*",
            "*://*.e-hentai.org/*", "*://*.exhentai.org/*",
            "*://*.nhentai.net/*", "*://*.yamibo.com/*"
        ];

        await chrome.scripting.registerContentScripts([{
            id: 'shadow-proxy', world: 'MAIN',
            matches: matches,
            js: ['inject.js'], runAt: 'document_start'
        }]);
        console.log("[MangaTrans] Shadow proxy registered for extended whitelist");
    } catch (err) { console.error("[MangaTrans] Script registration failed:", err); }
}

chrome.runtime.onInstalled.addListener(() => { setupRefererRule(); registerMainWorldScript(); });
chrome.runtime.onStartup.addListener(() => { setupRefererRule(); registerMainWorldScript(); });

// 监听标签页重载：重置术语表
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'loading' && tab.url) {
        if (!tab.url.startsWith('chrome://') && !tab.url.includes('#')) {
            console.log(`[MangaTrans] 标签页 ${tabId} 刷新，重置术语表`);
            delete tabGlossaries[tabId];
        }
    }
});

// 使用 webNavigation 监听 SPA 路径变化
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (!details.url.startsWith('chrome://')) {
        chrome.tabs.sendMessage(details.tabId, { type: "URL_CHANGED", url: details.url }).catch(() => { });
    }
});

chrome.tabs.onRemoved.addListener((tabId) => delete tabGlossaries[tabId]);

// --- 翻译逻辑 ---
async function callOpenAITranslate(imgSrc, config, tabId, retryCount = 0, providedBase64 = null) {
    const { baseUrl, apiKey, modelName, targetLang, writingMode, reasoningEffort } = config;
    const finalUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const finalLang = targetLang || "简体中文";

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    // 处理排版方式变量
    let modeText = "自动判断（根据原文横排或竖排）";
    if (writingMode === 'vertical') modeText = "强制竖排";
    else if (writingMode === 'horizontal') modeText = "强制横排";

    if (!tabGlossaries[tabId]) tabGlossaries[tabId] = {};
    const glossaryContext = Object.entries(tabGlossaries[tabId]).map(([r, t]) => `${r} -> ${t}`).join('\n');

    const prompt = `你是一个专业的漫画汉化组助手。
任务：识别图中所有对话气泡和旁白文字，结合画面内容，其翻译成${finalLang}并标注位置。
坐标规则：使用 [ymin, xmin, ymax, xmax] 格式，范围为 0-1000。坐标(0,0)为图像最左上角，使用完整的图像文件，坐标不能忽视四周的留白。适当避让人脸。
排版方式：${modeText}
要求：
1. 译文请提供平铺的文本，不要包含换行符。
2. 对于竖排文本，请确保 box 高度能够至少容纳 3.9 个全角字符。如果字符数量(不是token数量, 含标点) <=3，排成一列即可，横排同理
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
        let base64Data = providedBase64;

        if (!base64Data) {
            console.log(`[MangaTrans] 正在通过网络获取图片: ${imgSrc} (重试: ${retryCount})`);
            const imgBlob = await fetch(imgSrc, {
                headers: { 'Referer': new URL(imgSrc).origin }
            }).then(r => {
                if (!r.ok) throw new Error(`图片获取失败: ${r.status}`);
                return r.blob();
            });

            base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(imgBlob);
            });
        } else {
            console.log(`[MangaTrans] 使用本地捕获图片数据 (无网络请求)`);
        }

        const requestBody = {
            model: modelName || "gemini-3.1-flash-lite-preview",
            messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: base64Data } }] }]
        };

        // 如果设置了推理等级（包括 'none'），则发送该参数并移除 temperature
        if (reasoningEffort) {
            requestBody.reasoning_effort = reasoningEffort;
        } else {
            requestBody.temperature = 0;
        }

        const response = await fetch(finalUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`API 响应错误: ${response.status} - ${errorBody}`);
        }

        const result = await response.json();
        const content = result.choices[0].message.content;
        console.log(`[MangaTrans] API 响应成功 (Usage):`, result.usage);
        console.log(`[MangaTrans] 翻译结果 (Content):`, content);
        const parsed = parseSafeJSON(content);
        if (parsed.new_terms) Object.assign(tabGlossaries[tabId], parsed.new_terms);
        return parsed.translations || [];
    } catch (error) {
        const is403 = error.message.includes("403");
        
        if (error.name === 'AbortError') {
            console.error(`[MangaTrans] 请求超时 (30s)`);
        } else {
            console.error(`[MangaTrans] 翻译失败: ${error.message}`);
        }

        // 如果是 403 错误，通常是防盗链，重试无用，直接放弃
        if (is403) {
            console.warn(`[MangaTrans] 检测到 403 错误，停止重试`);
            throw error;
        }

        if (retryCount < 2) {
            console.log(`[MangaTrans] 1秒后进行重试...`);
            await new Promise(r => setTimeout(r, 1000));
            return callOpenAITranslate(imgSrc, config, tabId, retryCount + 1, providedBase64);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
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
        chrome.storage.sync.get(['baseUrl', 'apiKey', 'modelName', 'targetLang', 'writingMode', 'reasoningEffort'], (result) => {
            if (!result.apiKey) { sendResponse({ success: false, error: "未配置 API" }); return; }
            (async () => {
                try {
                    const data = await callOpenAITranslate(request.imgSrc, result, tabId, 0, request.imgData);
                    sendResponse({ success: true, data: data });
                } catch (err) { sendResponse({ success: false, error: err.message }); }
            })();
        });
        return true; 
    }
});

