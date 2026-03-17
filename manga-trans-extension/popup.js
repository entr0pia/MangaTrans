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
autoTransCheck.addEventListener('change', (e) => {
    chrome.storage.sync.set({ isAutoTranslate: e.target.checked });
});

// 加载初始状态
chrome.storage.sync.get(['baseUrl', 'apiKey', 'modelName', 'writingMode', 'targetLang', 'reasoningEffort', 'isAutoTranslate'], (result) => {
    if (result.baseUrl) document.getElementById('baseUrl').value = result.baseUrl;
    if (result.apiKey) document.getElementById('apiKey').value = result.apiKey;
    if (result.modelName) document.getElementById('modelName').value = result.modelName;
    if (result.writingMode) document.getElementById('writingMode').value = result.writingMode;
    if (result.targetLang) document.getElementById('targetLang').value = result.targetLang;
    if (result.reasoningEffort) document.getElementById('reasoningEffort').value = result.reasoningEffort;
    if (result.isAutoTranslate !== undefined) autoTransCheck.checked = result.isAutoTranslate;
});
