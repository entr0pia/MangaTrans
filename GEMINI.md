# Project Overview

`ManhuaGui Trans` is a Chrome extension project specifically designed to enhance the reading experience on [ManhuaGui](https://www.manhuagui.com/). It integrates large language models (LLM) to provide automated translation of manga pages directly within the browser.

## Key Features

- **Specific Domain Adaptation**: Tailored for the ManhuaGui website's DOM structure and reading logic.
- **Smart Translation Overlay**: Uses LLM-powered OCR and translation to identify text bubbles and overlay translations on a new layer.
- **Automatic State Management**: Includes an "Auto-Translate" toggle that maintains its state within a single chapter but automatically resets when navigating to a new chapter.
- **Dynamic Page Tracking**: Uses `MutationObserver` to detect page flips (image source changes) in the reader and trigger translation.

## Technologies

- **Browser Extension**: Manifest V3
- **Frontend**: Vanilla JavaScript, CSS
- **Core Logic**:
  - `content.js`: Handles UI injection, DOM observation, and overlay rendering.
  - `background.js`: Manages API communication with LLM providers.
  - `popup.html`: Extension settings and configuration.

## Project Structure

- `manga-trans-extension/`
  - `manifest.json`: Extension metadata and permissions.
  - `content.js`: Main logic for page manipulation and translation triggers.
  - `background.js`: Background service worker for API calls.
  - `style.css`: UI styles for the translation toggle and overlays.
  - `popup.html`: Settings interface.

## Development and Installation

### Installation
1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable "Developer mode" in the top right corner.
3. Click "Load unpacked" and select the `manga-trans-extension` folder.

### Testing
- Open any manga on ManhuaGui (e.g., `https://www.manhuagui.com/comic/...`).
- Locate the "Auto-Translate" toggle near the reader controls.
- Verify that translations persist across page flips but reset on chapter changes.

## Development Conventions

- **Surgical DOM Access**: Use specific IDs like `#mangaFile` to target the reader image.
- **Performance**: Minimize LLM calls by caching OCR results or using local OCR for positioning where possible.
- **Clean UI**: Translation overlays must match the original manga's layout and background to provide a seamless experience.
