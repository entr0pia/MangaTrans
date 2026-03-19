// 获取当前 URL 对应的 Key
async function getActiveTabUrlKey() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return null;
    try {
        const url = new URL(tab.url);
        return "trans_state_" + url.origin + url.pathname;
    } catch (e) {
        return null;
    }
}

// 保存配置
document.getElementById('saveBtn').addEventListener('click', () => {
    const baseUrl = document.getElementById('baseUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const modelName = document.getElementById('modelName').value;
    const writingMode = document.getElementById('writingMode').value;
    const targetLang = document.getElementById('targetLang').value;
    const reasoningEffort = document.getElementById('reasoningEffort').value;
    const status = document.getElementById('status');

    chrome.storage.sync.set({ 
        baseUrl: baseUrl,
        apiKey: apiKey,
        modelName: modelName,
        writingMode: writingMode,
        targetLang: targetLang,
        reasoningEffort: reasoningEffort
    }, () => {
        status.textContent = '设置已保存';
        setTimeout(() => { status.textContent = ''; }, 2000);
    });
});

// 处理自动翻译开关
const autoTransCheck = document.getElementById('autoTranslate');
autoTransCheck.addEventListener('change', async (e) => {
    const key = await getActiveTabUrlKey();
    if (key) {
        const state = {};
        state[key] = e.target.checked;
        chrome.storage.sync.set(state);
    }
});

// 加载初始状态
async function initPopup() {
    const key = await getActiveTabUrlKey();
    const fields = ['baseUrl', 'apiKey', 'modelName', 'writingMode', 'targetLang', 'reasoningEffort'];
    if (key) fields.push(key);

    chrome.storage.sync.get(fields, (result) => {
        if (result.baseUrl) document.getElementById('baseUrl').value = result.baseUrl;
        if (result.apiKey) document.getElementById('apiKey').value = result.apiKey;
        if (result.modelName) document.getElementById('modelName').value = result.modelName;
        if (result.writingMode) document.getElementById('writingMode').value = result.writingMode;
        if (result.targetLang) document.getElementById('targetLang').value = result.targetLang;
        if (result.reasoningEffort) document.getElementById('reasoningEffort').value = result.reasoningEffort;
        
        if (key && result[key] !== undefined) {
            autoTransCheck.checked = result[key];
        } else {
            autoTransCheck.checked = false;
        }
    });
}

initPopup();
