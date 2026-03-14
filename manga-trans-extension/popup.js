document.getElementById('saveBtn').addEventListener('click', () => {
    const baseUrl = document.getElementById('baseUrl').value;
    const apiKey = document.getElementById('apiKey').value;
    const modelName = document.getElementById('modelName').value;
    const writingMode = document.getElementById('writingMode').value;
    const status = document.getElementById('status');

    chrome.storage.sync.set({ 
        baseUrl: baseUrl,
        apiKey: apiKey,
        modelName: modelName,
        writingMode: writingMode
    }, () => {
        status.textContent = '保存成功！';
        setTimeout(() => {
            status.textContent = '';
        }, 2000);
    });
});

// 加载已保存的配置
chrome.storage.sync.get(['baseUrl', 'apiKey', 'modelName', 'writingMode'], (result) => {
    if (result.baseUrl) document.getElementById('baseUrl').value = result.baseUrl;
    if (result.apiKey) document.getElementById('apiKey').value = result.apiKey;
    if (result.modelName) document.getElementById('modelName').value = result.modelName;
    if (result.writingMode) document.getElementById('writingMode').value = result.writingMode;
});
