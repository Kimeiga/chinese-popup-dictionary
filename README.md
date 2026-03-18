# ZiTan Chinese Popup Dictionary (字探)

A fast, modern Chrome extension for reading Chinese. Hover over any Chinese text on the web to instantly see definitions, pinyin with tone colors, HSK levels, character etymology, and more.

Inspired by [10ten Japanese Reader](https://github.com/birchill/10ten-ja-reader). Uses [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cedict) and [Dong Chinese](https://www.dong-chinese.com/) data.

## Features

- **Instant popup** on hover over Chinese text (no click required)
- **CC-CEDICT** dictionary with 120K+ entries
- **Dong Chinese** enriched data: HSK levels, frequency ranks, character etymology, stroke counts, components, old pronunciations
- **Tabbed UI** — Word tab (definitions, readings, top words) and Character tab (etymology, components, stroke count, variants)
- **Tone-colored pinyin** with customizable colors per tone
- **Zhuyin (Bopomofo)** display option
- **Dark theme** by default, inspired by 10ten Japanese Reader. Light and auto (system) themes available
- **Keyboard shortcuts** for fast navigation and copying
- **Shadow DOM** isolation — popup styles never interfere with the host page
- **Sub-word matching** — shows all dictionary words starting from the cursor, not just the longest match
- **Text-to-speech** — press `s` to hear any word or character spoken aloud
- **Highlight length control** — use `[` / `]` to shrink or extend the matched text
- **Site block list** — disable on specific domains
- **Zero external requests** — all dictionary data is bundled locally

## Keyboard Shortcuts

When the popup is visible:

| Key | Action |
|-----|--------|
| `Shift` | Switch between Word / Character tab |
| `c` | Copy word (or character in Char tab) |
| `t` | Copy traditional characters |
| `r` | Copy pinyin reading |
| `g` | Copy gloss / definition |
| `e` | Copy full entry (word + pinyin + definitions) |
| `s` | Speak word / character aloud |
| `n` / `b` | Select next / previous entry |
| `1`-`9` | Select nth entry directly |
| `d` | Toggle definitions on/off |
| `[` / `]` | Shrink / extend highlighted match length |
| `Esc` | Close popup |

## Settings

Right-click the extension icon and select "Options", or go to `chrome://extensions` and click "Details" > "Extension options".

- **Theme** — Dark (default), Light, or Auto (follows system)
- **Font size** — Small, Normal, Large
- **Character display** — Simplified, Traditional, or Both
- **Tone colors** — Toggle and customize colors for each tone
- **Zhuyin** — Show/hide Bopomofo
- **Max entries** — Limit popup results (3, 5, 7, or 10)
- **Block list** — Disable on specific domains

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Build Dictionary Data

The CC-CEDICT dictionary must be built before the extension can be used:

```bash
npm run build:dict
```

To also build the Dong Chinese enriched data (requires JSONL source files):

```bash
npm run build:dong
```

### Build Extension

```bash
npm run build
```

The built extension will be in `dist/`.

### Development Mode

```bash
npm run dev
```

Watches for changes and rebuilds automatically.

### Load in Chrome

1. Go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `dist/` folder
4. Navigate to any page with Chinese text

### Testing

```bash
# Unit tests
npm run test

# E2E tests (launches Chrome with the extension)
npm run test:e2e

# All tests
npm run test:all
```

### Type Checking

```bash
npm run typecheck
```

## Architecture

```
src/
  background/       Service worker — dictionary loading, lookup handling
  common/           Shared types, settings, IndexedDB wrapper, pinyin utilities
  content/          Content script — mouse tracking, keyboard shortcuts, popup
    popup/          Shadow DOM popup component and styles
  options/          Settings page
  scripts/          Build scripts for dictionary data processing
```

- **Manifest V3** Chrome extension with service worker
- **IndexedDB** for dictionary storage (CC-CEDICT + Dong Chinese)
- **Shadow DOM** for popup CSS isolation
- **Vite** build with chunk inlining for MV3 content script compatibility

## Data Sources

- [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cedict) — community-maintained Chinese-English dictionary
- [Dong Chinese](https://www.dong-chinese.com/) — character etymology, HSK levels, frequency statistics, components

## License

MIT
