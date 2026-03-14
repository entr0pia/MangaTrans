// --- 动态修改 Referer 以绕过防盗链 ---
const RULE_ID = 1;

async function setupRefererRule() {
    const rules = [
        {
            id: RULE_ID, priority: 1,
            action: {
                type: "modifyHeaders",
                requestHeaders: [{ header: "referer", operation: "set", value: "https://www.manhuagui.com/" }]
            },
            condition: { urlFilter: "|https://*.hamreus.com/*", resourceTypes: ["xmlhttprequest"] }
        }
    ];
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules: rules });
}

chrome.runtime.onInstalled.addListener(setupRefererRule);
chrome.runtime.onStartup.addListener(setupRefererRule);

// --- 翻译逻辑 ---
async function callOpenAITranslate(imgSrc, config) {
    const { baseUrl, apiKey, modelName } = config;
    const finalUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    
    // 使用 0-1000 归一化坐标，这是视觉大模型最精准的模式
    const prompt = `你是一个专业的漫画汉化组助手。
任务：识别图中所有对话气泡和旁白文字，将其日语翻译成简体中文并标注位置。
坐标规则：使用 [ymin, xmin, ymax, xmax] 格式，范围为 0-1000。
注意：(0,0) 必须是图像文件的绝对左上角顶点，(1000,1000) 是绝对右下角顶点。请务必包含图像边缘的任何白边或黑边，不要自行裁剪。

返回格式 (严格 JSON 数组)：
[
  {
    "box": [ymin, xmin, ymax, xmax],
    "text": "简体中文译文"
  }
]`;

    try {
        console.log("[ManhuaGui Trans] 获取图片中...", imgSrc);
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
                messages: [{
                    role: "user",
                    content: [
                        { type: "text", text: prompt },
                        { type: "image_url", image_url: { url: base64Data } }
                    ]
                }],
                temperature: 0
            })
        });

        const result = await response.json();
        const responseContent = result.choices[0].message.content;
        console.log("[ManhuaGui Trans] 模型原始输出:", responseContent);
        
        return parseSafeJSON(responseContent);
    } catch (error) {
        console.error("翻译链路出错:", error);
        throw error;
    }
}

function parseSafeJSON(str) {
    let cleaned = str.replace(/```json|```/g, '').trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
        const obj = JSON.parse(objMatch[0]);
        return obj.results || obj.data || (Array.isArray(obj) ? obj : []);
    }
    return JSON.parse(cleaned);
}

// --- 消息处理中心 ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "TRANSLATE_IMAGE") {
        chrome.storage.sync.get(['baseUrl', 'apiKey', 'modelName'], async (result) => {
            if (!result.apiKey) {
                sendResponse({ success: false, error: "请配置 API Key" });
                return;
            }
            try {
                const data = await callOpenAITranslate(request.imgSrc, result);
                sendResponse({ success: true, data: data });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        });
        return true; 
    }
});
