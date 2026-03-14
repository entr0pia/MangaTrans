# 漫画柜智能翻译助手 (ManhuaGui Trans)

一个专为 [漫画柜 (ManhuaGui)](https://www.manhuagui.com/) 设计的 Chrome 浏览器扩展，利用的多模态大模型（OpenAI兼容接口）实现网页漫画的即时识别、翻译与嵌入式渲染。

![演示图 1](imgs/PixPin_26-03-14_23-56-49.jpg)

![演示图 2](imgs/PixPin_26-03-14_23-56-22.jpg)

## 核心特性

- **🚀 深度适配 ComicRead 脚本**：兼容的 [ComicRead](https://greasyfork.org/zh-CN/scripts/374903-comicread) 油猴脚本，支持在增强阅读模式、卷轴模式下自动进行翻译。
- **🤖 智能 OCR 与翻译**：调用 OpenAI 兼容接口，不仅能精准翻译日文，还能通过 0-1000 归一化坐标实现译文气泡的精准对齐。
- **📏 自适应渲染**：
  - **动态字号**：根据气泡大小自动计算最佳字体尺寸，解决文本填充不足（underfill）或溢出问题。
  - **竖排支持**：智能检测日系漫画的竖排气泡，并应用 `vertical-rl` 排版。
  - **视觉增强**：采用半透明白底黑字配合红色虚线边框，既能遮盖原句，又能清晰辨识翻译区域。
- **⏱️ 智能生命周期管理**：
  - **刷新自动重置**：利用 Navigation Timing API 识别页面重载，刷新页面时自动关闭翻译，避免误扣 Token。
  - **模式切换保持**：在原始页面开启翻译后，进入全屏阅读模式将自动继承状态，无需重新勾选。
- **🔍 过滤与精简**：
  - 自动忽略页码、标题、作者名及网站水印。
  - 自动滤除仅包含标点符号（如 `?` `!` `...`）的无效气泡。



## 安装与配置

### 1. 手动加载扩展
1. 下载本项目代码到本地。
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`。
3. 开启右上角的 **“开发者模式”**。
4. 点击 **“加载已解压的扩展程序”**，选择 `manga-trans-extension` 目录。

### 2. 配置 API
点击扩展图标打开弹出面板进行配置：
- **Base URL**: 填入 OpenAI 兼容的 API 地址（如 `https://api.openai.com/v1` 或各类中转地址）。
- **API Key**: 您的模型密钥。
- **Model Name**: 推荐使用带 Vision 功能的模型，如 `gemini-1.5-flash` 或 `gpt-4o-mini`。
- **排版偏好**: 可选自动、强制横排或强制竖排。

## 开发规范

- **Shadow DOM 穿透**：通过 `MAIN` world 脚本劫持 `attachShadow` 确保图片可探测。
- **网络优化**：内置 3 次指数退避重试机制，有效应对网络波动导致的 `Failed to fetch` 错误。
- **性能平衡**：使用 `IntersectionObserver` 监听图片入场，实现长卷轴模式下的按需翻译。

## 免责声明

本插件仅供学习与技术交流使用，严禁用于任何商业用途。请支持正版漫画。

---
Created by [entr0pia](https://github.com/entr0pia)
