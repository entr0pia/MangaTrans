# Project Overview

`MangaTrans` (智能漫画翻译助手) is a sophisticated Chrome extension designed to provide real-time, LLM-powered translation for web manga. It leverages multimodal large language models (via OpenAI-compatible APIs) to perform OCR, translation, and seamless overlay rendering.

While highly generalizable, it currently features deep, specific adaptations for [ManhuaGui](https://www.manhuagui.com/).

## Key Features

- **🚀 Reading Mode Mastery**: Deeply integrates with the `ComicRead.js` (@local/ComicRead.js) serscript. It can pierce through closed Shadow DOMs to detect and translate manga images in enhanced reading or scroll modes.
- **🤖 Intelligent Translation Flow**:
  - **OpenAI Compatibility**: Supports any OpenAI-compatible endpoint (e.g., Gemini 1.5, GPT-4o, DeepSeek).
  - **Terminology Consistency**: Maintains a per-tab in-memory glossary to ensure character names and locations are translated consistently across pages.
  - **Smart Filtering**: Automatically ignores page numbers, titles, watermarks, and bubbles containing only punctuation.
- **📏 Adaptive Rendering Engine**:
  - **Normalized Coordinates**: Uses a 0-1000 coordinate system for precise bubble alignment regardless of screen resolution.
  - **Short-side Scaling**: Dynamically calculates font sizes based on bubble geometry to prevent "underfill" or text overflow.
  - **Vertical Text Support**: Automatically detects Japanese vertical bubbles and applies `writing-mode: vertical-rl`.
- **⏱️ Advanced Lifecycle Management**:
  - **Reload Reset**: Automatically toggles off translation on page hard-reloads (F5) to save tokens, while preserving state during internal mode transitions.
  - **Lazy Loading Support**: Uses `IntersectionObserver` to trigger translations as new images scroll into the viewport in long-strip mode.

## Technologies

- **Browser Extension**: Manifest V3
- **Script Injection**: Uses `MAIN` world injection via `userScripts` or `scripting` API to hijack `attachShadow`.
- **Backend Communication**: Index-backoff retry mechanism for resilient API calls.
- **Frontend**: Vanilla JavaScript with `IntersectionObserver` and `MutationObserver` for state-of-the-art DOM tracking.

## Project Structure

- `manga-trans-extension/`
  - `manifest.json`: Extension metadata, permissions, and script registration.
  - `content.js`: Core logic for image detection, UI synchronization, and overlay rendering.
  - `background.js`: Service worker handling API requests, glossary management, and network rules (Referer spoofing).
  - `inject.js`: Injected into the page's MAIN world to enable Shadow DOM access.
  - `popup.html/js`: Settings interface for API configuration and layout preferences.
  - `icon*.png`: Official extension icons.

## Development & Testing

### Installation
1. Enable **Developer Mode** in `chrome://extensions/`.
2. Load the `manga-trans-extension` folder as an unpacked extension.

### Verification
- Test on ManhuaGui with and without `ComicRead.js` enabled.
- Verify that translation bubbles persist across page flips but disappear on F5 refresh.
- Check the Service Worker console for glossary updates (`[MangaTrans] Glossary updated`).

## Engineering Standards

- **Shadow DOM Transparency**: Always use the `MAIN` world proxy to ensure visibility of reading mode elements.
- **Token Efficiency**: Filter out non-story elements early in the prompt. Implement aggressive debouncing on triggers.
- **Referer Integrity**: Use `declarativeNetRequest` rules to bypass CDN anti-hotlinking protections (403 errors).
- **Aesthetic Precision**: Maintain the red-dashed border style for translated areas to ensure clarity and user-friendly "scanlation" feel.
