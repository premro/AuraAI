# ✦ ChatGPT Web & Local AI Assistant

> **A high-performance, private, zero-sign-in AI conversational suite with direct high-resolution Image Generation, Multi-Turn Context Memory, Chat Pinning, Document & Spreadsheet Intelligence, and Apple Silicon WebGPU acceleration.**

*Created with ❤️ by **Prem***

---

## 🌟 Key Highlights

- **🎨 Direct Image Generation**: Generate stunning 1024×1024 images directly inside your conversation using natural language (e.g. *"generate image on nature with house near waterfall"*, *"draw a cyberpunk city"*).
- **🧠 True Multi-Turn Context Memory**: Remembers your previous questions, facts, and code across conversational turns within the same chat session.
- **📌 Chat Session Management & Pinning**: Pin your most important conversations to the top of your sidebar. Pinned chats preserve their full history and context.
- **🔄 Fresh Chat Isolation**: Clicking **New Chat** immediately opens an isolated session without leaking context from previous conversations. State is preserved across page refreshes.
- **📄 Document, Excel & Code Intelligence**: Drag & drop or attach PDFs, Excel files (`.xlsx`, `.xls`, `.csv`), code files, and plain text. Includes SheetJS table parsing and syntax highlighting.
- **🔍 Screenshot & OCR Diagnostic Engine**: Extracts text from screenshots with Tesseract.js and prioritizes error banners, prerequisites, and configuration diagnostics (e.g. Zoho Endpoint Central, Zia, AWS, Azure, Jenkins).
- **⚡ In-Browser Local GPU (WebGPU Metal)**: Run open-source models (Meta Llama 3.2 1B/3B, Qwen 2.5) 100% locally and offline on your Mac GPU.
- **🛡️ 100% Private & Secure**: Zero external telemetry, zero tracking, zero malware. Hardened with DOMPurify sanitization, path traversal immunity, and rate limiting.
- **💸 Zero Cost, Zero API Keys, Zero Sign-In**: Works straight out of the box with no account creation or billing required.

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- Any modern web browser (Chrome, Edge, Safari, Arc, Firefox)

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/chatgpt-clone-localai.git
cd chatgpt-clone-localai
```

### 2. Launch the Application
```bash
# Using npm
npm start

# Or using the launch script
chmod +x start.sh
./start.sh
```

### 3. Open in Browser
Visit **[http://localhost:3000](http://localhost:3000)** to start chatting!

---

## 🎨 Image Generation Guide

Simply instruct the AI in conversational natural language:

```markdown
- "generate image on nature along with house near the falls"
- "create an image of a red sports car on a mountain road"
- "draw a cozy coffee shop on a rainy evening in Tokyo"
- "paint an astronaut walking on Mars with Earth in the background"
```

The system immediately renders a **1024×1024 photorealistic diffusion image** right inside the chat window with a one-click **Download Full Resolution** button.

---

## 🔒 Security Audit & Privacy Guarantee

| Security Measure | Status | Implementation Details |
| :--- | :--- | :--- |
| **Path Traversal Protection** | ✅ Hardened | Static file server strictly verifies `path.resolve` containment within project root. |
| **XSS Prevention** | ✅ Hardened | Markdown output sanitized via `DOMPurify` before DOM insertion; user inputs rendered as plain text. |
| **DoS / Buffer Protection** | ✅ Hardened | 25 MB payload size limiter on JSON endpoints to prevent memory exhaustion. |
| **Security Headers** | ✅ Hardened | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection: 1; mode=block`. |
| **Data Privacy** | ✅ 100% Local | All chats, pinned items, and settings are stored locally in your browser's `localStorage`. |
| **Telemetry & Ads** | 🚫 Zero | No analytics scripts, no trackers, and no external tracking cookies. |

---

## 🌐 Deployment Options

### Deploy to Render / Railway / Heroku
This project is a standard Node.js HTTP application with zero heavy dependencies:
1. Connect your GitHub repository to [Render](https://render.com) or [Railway](https://railway.app).
2. Set Build Command: *(empty)*
3. Set Start Command: `node server.js`
4. Deploy!

### Deploy with Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```
```bash
docker build -t chatgpt-clone-localai .
docker run -p 3000:3000 chatgpt-clone-localai
```

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: Vanilla JavaScript (ES2022+), CSS Grid/Flexbox with dark/light themes.
- **Client Parsers**:
  - `Marked.js` & `DOMPurify` (Safe Markdown & Math)
  - `Highlight.js` (Multi-language syntax highlighting)
  - `PDF.js` (PDF extraction)
  - `SheetJS (XLSX)` (Spreadsheet intelligence)
  - `Tesseract.js` & `heic2any` (OCR & image vision)
  - `WebLLM` (Local WebGPU Metal inference)
- **Backend**: Native Node.js `http` and `https` modules (zero bulky npm dependencies).

---

## 👤 Author

**Created by Prem**  
- GitHub: https://github.com/premro

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
