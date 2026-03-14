// --- 动态修改 Referer 以绕过防盗链 ---
const RULE_ID = 1;

async function setupRefererRule() {
    const rules = [
        {
            id: RULE_ID,
            priority: 1,
            action: {
                type: "modifyHeaders",
                requestHeaders: [
                    { header: "referer", operation: "set", value: "https://www.manhuagui.com/" }
                ]
            },
            condition: {
                urlFilter: "|https://*.hamreus.com/*",
                resourceTypes: ["xmlhttprequest"]
            }
        }
    ];

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE_ID],
        addRules: rules
    });
}

// 插件安装或启动时初始化规则
chrome.runtime.onInstalled.addListener(setupRefererRule);
chrome.runtime.onStartup.addListener(setupRefererRule);

// --- 翻译逻辑 ---
async function callOpenAITranslate(imgSrc, config, imageSize) {
    const { baseUrl, apiKey, modelName } = config;
    const finalUrl = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

    const prompt = `你是一个专业的漫画翻译助手。
请识别图中所有的对话气泡，并将日文翻译成简体中文。
你必须返回一个 JSON 对象，结构如下：
{
  "canvas_width": 1000, // 你识别到的图像总宽度（包含所有白边/黑边）
  "canvas_height": 1000, // 你识别到的图像总高度（包含所有白边/黑边）
  "results": [
    {
      "box_2d": [ymin, xmin, ymax, xmax], // 基于上述 canvas 尺寸的绝对像素坐标
      "translated_text": "译文",
      "original_text": "原文"
    }
  ]
}
注意：坐标原点(0,0)必须是图像最边缘的左上角。不要输出任何解释文字。`;

    try {
        console.log("[ManhuaGui Trans] Fetching image...");
        const imgBlob = await fetch(imgSrc).then(r => r.blob());
        const base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(imgBlob);
        });

        const response = await fetch(finalUrl, {
            method: "POST",
            headers: { 
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName || "gpt-4o-mini",
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: prompt },
                            { type: "image_url", image_url: { url: base64Data } }
                        ]
                    }
                ],
                max_tokens: 4096,
                temperature: 0
            })
        });

        const result = await response.json();
        const responseContent = result.choices[0].message.content;
        return parseSafeJSON(responseContent);
    } catch (error) {
        console.error("翻译链路出错:", error);
        throw error;
    }
}

function parseSafeJSON(str) {
    let cleaned = str.replace(/```json|```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : cleaned);
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
                const data = await callOpenAITranslate(request.imgSrc, result, request.imageSize);
                sendResponse({ success: true, data: data });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        });
        return true; 
    }
});
