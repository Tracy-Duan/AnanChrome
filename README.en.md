# AnanChrome

[简体中文](README.md) | [English](README.en.md)

A local AI browser assistant from the Anan series. It drives a local llama.cpp server together with a local model of your own — you configure it yourself, and direct download links are provided in this project — from the Edge / Chrome side panel. The dark, minimal UI is modelled on the llama.cpp web UI; a single input box auto-detects whether you want to chat, search the web, or summarise the current page.

Regular chat and page summarisation run entirely on your machine. When web search is used, the search query is sent to Tavily.

## Windows All-in-One ZIP (1.5.0)

Distribute `dist/AnanChrome-Windows.zip`: a single archive containing `extension/`, the complete llama.cpp b10630 CPU/CUDA DLL set, a self-contained Windows runtime, the first-run installer entry point, and licence texts. It is **not** a plain browser extension ZIP — `AnanChrome-extension.zip` remains the extension-only package for browser loading or store submission.

After extracting the full archive, the recipient double-clicks `Install-AnanChrome.cmd` to register the runtime once, loads `extension/` from the extensions page, then clicks **Download model** in Settings. Chrome/Edge security boundaries mean that merely opening the ZIP or loading the extension cannot execute an EXE, so the one-time registration and loading steps cannot be skipped. Subsequent launches connect to or start the service automatically.

The download button in Settings uses the stable Hugging Face resolve URL for the model file rather than a temporary CDN link with Expires/Signature parameters:

- `HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf`
- SHA-256: `2ca636d9e81d3d23ca9b60c234fe185d30ec082eeba69ce770fdb0c76559a4f5`

Background downloads support HTTP Range resume, continue after the page is closed, and verify before configuring; errors can be retried. An already-running model is never interrupted. Files land in `%LOCALAPPDATA%\AnanChrome\Models`.

Build with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build-release.ps1 -LlamaDirectory 'full path to the llama.cpp runtime directory'
```

The b10630 Windows x64 DLLs and CUDA dependencies must be provided in full; absolute paths from the developer machine are never written into user configuration. The package excludes chat history, API keys, model weights, test fixtures, and local configuration.

Resumable and deletable conversation history now lives in the top-left menu, with Settings pinned to the bottom of that menu. Starting a new chat preserves previous records; the two shortcut cards on the start page have been removed. In normal windows, history is stored in browser-local storage; in incognito windows it is kept for the session only. History includes page snapshots, still capped at three per session. When storage is exhausted the error is reported explicitly rather than silently discarding older conversations.

## Features

| Capability | How it triggers |
| --- | --- |
| Chat | Ask directly; responses stream in |
| Web search | Triggered when the model judges that the request needs fresh or external information |
| Page reading | Triggered when the model decides the current tab must be read; or click **Summarise current page** |
| Page follow-up | Cited pages and summaries stay in the conversation; up to 3 page citations |
| Thinking | Two-state toggle above the input box; when on, allocates 256 / 768 thinking tokens for simple / complex questions |

**AI pre-routing**: after you send a message, the local model performs one very short classification pass with the thinking chain disabled, deciding simultaneously between direct chat, web search, or reading the current tab, and whether the question is simple or complex. With thinking enabled, simple questions use up to 256 thinking tokens and complex ones up to 768. The classification stage never reads page content.

### Web Sessions and Memory (1.4.2)

- Page summaries, regular chat, and search answers share a single conversation history. You can ask "expand on the second point" or "what is the basis for that" without pasting the original text again.
- Pages currently remembered appear as a long pill directly above the input box, collapsed by default; it expands on hover or keyboard focus and collapses on leave. Ask it to "read this page" to read and remember it, or click **Read current page**. Each entry has re-read and forget buttons. The persistent memory description and the empty-input hint at the bottom have been removed; the truncation indicator shows the memory count on hover, and connection errors still surface a notice.
- Up to 3 pages are remembered. Successfully reading a 4th distinct page automatically forgets the earliest one (FIFO). Re-reading the same URL only refreshes its content — it consumes no new slot and does not change insertion order. A failed read never clears existing memory.
- After forgetting a page, its original text and any history turns that carried that page's material are no longer sent to the generation model or the pre-classifier, so stale summaries cannot smuggle forgotten content back in. Old chat records remain visible in the UI. **New chat** starts an empty session while the old one stays in the history list.
- Switching tabs does not auto-read the new page or replace citations. To discuss a new page, explicitly ask it to read the current one. The side panel calls the browser tabs and scripting APIs directly rather than relying on background message responses, supporting both callback and Promise return styles. The target tab is locked at send time and its URL is checked before and after reading, preventing a tab switch during model inference from reading the wrong page. Exceptions preserve the real cause instead of swallowing the error and uniformly reporting "no active page found at send time".
- The current-session pointer is isolated per browser window and cached in `chrome.storage.session`; archives for normal windows are kept separately in `chrome.storage.local` and can be restored from the menu after the browser exits. Incognito sessions are never written to persistent storage. Incomplete streaming replies are not guaranteed to resume.
- The local 9B model supports up to 3 cited pages at once, with at most roughly 12,000 characters cached per page. Every send checks the context window against the real model template and tokenisation, carrying at most the 12 most recent messages; long material is truncated first and older turns dropped if necessary, with a notice shown. Truncation never alters the cached snapshot. Details absent from the cached material cannot be answered for — this is not unlimited memory or full-text search.
- Pre-classification uses recent conversation, citation titles/URLs, and the active tab's title/URL, without reading page body text. Body text is fetched only when a page is added, refreshed, or a request is judged to need reading. Page content is always treated as untrusted reference material, never as a system command.

This release follows the "continuous conversation with managed page citations" experience of the Gemini side panel. It does not include Google account integration, automated browsing actions, or background reading of all tabs.

Verify with `node --test tests/*.test.cjs`. With the local service already running, `node tests/local-context-smoke.cjs` checks cross-tab follow-up, topic switching, and context length. `node tests/preview-server.cjs` provides a UI test environment with synthetic pages (port 8094, loopback only, browser APIs mocked, generation uses the local model). Test files are never packaged into the extension.

## Project Layout

### Separating Thinking Language From Final Text

Thinking mode steers the model to analyse in Simplified Chinese by default, with final answers in Chinese by default; English translation, code, and verbatim quotations are not filtered out. Beyond the system language constraint, the llama.cpp `continue_final_message: "reasoning_content"` interface is used to begin thinking with a short Chinese prefix; a Chinese termination hint is injected when the budget runs out, reducing the chance that the model keeps dumping analysis drafts into the final answer. The 256 / 768 budgets are unchanged.

Requests explicitly set `reasoning_format: "deepseek"` to separate thinking from final text; the front end also handles raw `think` tags and tag boundaries split across stream chunks. Legacy default prompts are upgraded automatically, custom prompts are never overwritten in storage, and language rules are attached only at generation-request time. Language is still produced by the model, so no model or sampling run is guaranteed to comply perfectly — Chinese output is never faked by deleting English text.

Regression tests: `node --test tests/*.test.cjs`. With the local service running, `node tests/local-thinking-smoke.cjs` additionally verifies the thinking toggle, budget termination, and English translation.

### Directory

```
local-ai-sidebar/
├── manifest.json          Extension manifest (Manifest V3)
├── service-worker.js      Background service (on-demand body extraction / message routing / context menu)
├── sidepanel.html         AnanChrome side panel page
├── sidepanel.js           Core logic (semantic routing / chat / search / summarise / streaming / Markdown)
├── chat-policy.js         Shared prompts, Chinese thinking prefix and budget-termination policy
├── chat-stream.js         Thinking/answer separation and SSE stream parsing
├── conversation.js        Page snapshots, session restore, routing context, model window trimming
├── page-access.js         Direct browser read API shared by panel and background (with body extraction)
├── options.html / .js     Settings page
├── runtime/               Windows local runtime, installer and build scripts
├── models/                Local GGUF weights (not packed into the extension ZIP)
├── Setup-AnanChrome.cmd   One-time setup entry point for project users
├── build-extension.ps1    Builds the store extension ZIP (auto-excludes EXEs and models)
├── start-server.bat       Manual launcher for development debugging only
├── icons/                 Extension icons
└── styles/sidepanel.css   Styles (dark minimal + bottom pill input)
```

## Installation

### Already Have a Model? Drop It In

1. Put a complete `.gguf` file into this project's `models` folder; the filename does not matter.
2. Double-click `Setup-AnanChrome.cmd` in the project root to configure once (llama.cpp must already be installed; an existing runtime configuration can be reused).
3. Reload the extension in the browser once — from then on, opening the side panel starts the model automatically.

While the models directory is empty, the previous external model continues to be used; after a GGUF is placed there, that file takes priority on the next launch. If multiple primary models are present you get an explicit prompt rather than an arbitrary pick. To pin a specific file, run `setup-project.ps1 -ModelPath 'full path'`. A running model is never interrupted by file changes — weight switching takes effect on the next service start. Moving the project requires re-running setup.

If you see "extension not authorised", check the current ID on the extensions page and run `setup-project.ps1 -ExtensionIds 'actual extension ID'`. No need to uninstall the extension or re-download weights. Simply placing a model file does not replace registering the browser-to-runtime connection.

### 1. Install the Windows Local Runtime (first time only)

Regular users double-click:

```text
runtime\Install-AnanChrome.cmd
```

The installer downloads and verifies the llama.cpp CUDA 12.4 runtime and the Qwen3.5-9B Q4_K_M model, then registers Chrome/Edge Native Messaging. The model is about 5.24 GiB and downloads only once. After installation, opening the extension starts the model in the background automatically — no BAT file to run, no console window popping up.

`start-server.bat` is kept only for developers troubleshooting issues and is not part of the normal user flow.

### 2. Install the Extension

- **Edge**: go to `edge://extensions/` → enable **Developer mode** at the bottom left → click **Load unpacked** → select this folder.
- **Chrome**: go to `chrome://extensions/` → enable **Developer mode** at the top right → click **Load unpacked** → select this folder.

### 3. Open the Side Panel

- Click the extension icon in the browser toolbar, or
- Right-click anywhere on a page → **Open AI side panel**.

The panel automatically runs "detect runtime → start model in background → wait for readiness": **green = connected, yellow = loading, red = runtime missing or model failed to start**.

### 4. Web Search (optional)

Open the top-left menu, then **Settings** at its bottom left, and fill in your Tavily API Key (register at <https://tavily.com>; quotas are set by the provider). Chat and summarisation work without it.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Server URL | `http://127.0.0.1:8080` | llama-server listen address |
| Temperature | `0.7` | Higher values produce more varied output |
| Top P | `0.9` | Nucleus sampling |
| Max output tokens | `2048` | Upper bound for a single answer |
| Thinking | Off | When on, automatically picks between 256 / 768 token budgets |
| System prompt | Chinese assistant | Defines the AI persona |
| Tavily API Key | Empty | Used for web search |

Settings take effect **immediately** — reloading the extension is not required.

## FAQ

**Clicking the icon does nothing / the panel shows a red dot**
→ Install the Windows local runtime once. If it is already installed, check the logs in `%LOCALAPPDATA%\AnanChrome\Logs`; there is no need to run `start-server.bat` manually.

**Page summarisation returns nothing / errors**
→ Special pages such as `chrome://`, `edge://`, the extension store, and the PDF viewer cannot have their body text extracted — this is a normal limitation. Ordinary `http/https` pages summarise fine, and **no page refresh is needed** (extraction is on-demand, so pages opened before installation are supported too).

**Answers are slow**
→ The 9B model uses more VRAM and generates more slowly than a 4B model, but answers better. With **Thinking** enabled, question complexity is judged first, then 256 or 768 thinking tokens are used.

**Search returns 401 / 429**
→ Check that the Tavily API Key is correct and that the free quota is not exhausted.

**Code changes do not take effect**
→ Go to `edge://extensions/` and click **Reload** (the refresh icon) on the extension card.
