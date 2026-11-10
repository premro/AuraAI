/**
 * LocalAI - Open-Source Unlimited Local & Online Chat Application
 * Features:
 * 1. Online & Instant AI: Fast frontier AI models with real-time news search.
 * 2. WebGPU WebLLM: 100% in-browser WebGPU execution (Meta Llama 3.2, Qwen 2.5, Gemma 2, Phi 3.5).
 * 3. Local Ollama: Connects to local Ollama daemon (http://127.0.0.1:11434).
 * 4. Document & Excel Analysis: In-browser PDF (PDF.js) and Excel Spreadsheets (SheetJS).
 * 5. Screenshot OCR & Vision: Clipboard paste (Cmd+V) and OCR text extraction (Tesseract.js).
 * 6. Live Breaking News: Real-time global news feed fetching.
 */

const INSTANT_MODELS = [
    { id: "gpt-4o-mini", name: "ChatGPT (GPT-4o mini)" },
    { id: "gpt-4o", name: "ChatGPT (GPT-4o)" },
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
    { id: "deepseek-chat", name: "DeepSeek V3" }
];

const WEBLLM_MODELS = [
    { id: "Llama-3.2-1B-Instruct-q4f32_1-MLC", name: "Meta Llama 3.2 1B (Local GPU)" },
    { id: "Llama-3.2-3B-Instruct-q4f32_1-MLC", name: "Meta Llama 3.2 3B (Local GPU)" },
    { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 1.5B (Local GPU)" },
    { id: "Qwen2.5-7B-Instruct-q4f16_1-MLC", name: "Qwen 2.5 7B (Local GPU)" }
];

const OLLAMA_DEFAULT_MODELS = [
    { id: "llama3.2", name: "Llama 3.2 (Local Ollama)" },
    { id: "qwen2.5-coder", name: "Qwen 2.5 Coder (Local Ollama)" },
    { id: "mistral", name: "Mistral 7B (Local Ollama)" },
    { id: "gemma2", name: "Gemma 2 (Local Ollama)" }
];

// App State
const state = {
    engine: 'instant',
    webSearch: localStorage.getItem('localai_web_search') !== 'false', // 'instant', 'webllm', or 'ollama'
    selectedModel: INSTANT_MODELS[0].id,
    systemPrompt: "You are a helpful, smart, and direct AI assistant.",
    temperature: 0.7,
    apiKey: '',
    ollamaHost: '/api/ollama',
    chats: [],
    activeChatId: null,
    isGenerating: false,
    abortController: null,
    webllmEngine: null,
    webllmLoading: false,
    webgpuSupported: false,
    attachedFiles: [],
    viewingDoc: null,
    webSearch: true // Live Web & News search enabled by default
};

// DOM Elements
const elements = {
    // Engine tabs
    tabInstant: document.getElementById('tabInstant'),
    tabWebLLM: document.getElementById('tabWebLLM'),
    tabOllama: document.getElementById('tabOllama'),
    modelSelect: document.getElementById('modelSelect'),
    webSearchToggleBtn: document.getElementById('webSearchToggleBtn'),
    webSearchBtn: document.getElementById('webSearchBtn'),
    onlineVerifyBadge: document.getElementById('onlineVerifyBadge'),
    onlineVerifyLabel: document.getElementById('onlineVerifyLabel'),
    verifyKeyBtn: document.getElementById('verifyKeyBtn'),
    keyVerificationStatus: document.getElementById('keyVerificationStatus'),

    // Loading / Progress bar
    modelProgressContainer: document.getElementById('modelProgressContainer'),
    progressText: document.getElementById('progressText'),
    progressPercentage: document.getElementById('progressPercentage'),
    progressFill: document.getElementById('progressFill'),

    // Chat Area
    messagesContainer: document.getElementById('messagesContainer'),
    welcomeScreen: document.getElementById('welcomeScreen'),
    chatInput: document.getElementById('chatInput'),
    sendBtn: document.getElementById('sendBtn'),
    stopBtn: document.getElementById('stopBtn'),

    // Document / File / Image / Excel Upload Elements
    attachBtn: document.getElementById('attachBtn'),
    fileAttachmentInput: document.getElementById('fileAttachmentInput'),
    attachmentPreviewBar: document.getElementById('attachmentPreviewBar'),
    docActionChips: document.getElementById('docActionChips'),
    clearAllAttachmentsBtn: document.getElementById('clearAllAttachmentsBtn'),
    dragDropOverlay: document.getElementById('dragDropOverlay'),
    docViewerModal: document.getElementById('docViewerModal'),
    closeDocViewerBtn: document.getElementById('closeDocViewerBtn'),
    copyDocContentBtn: document.getElementById('copyDocContentBtn'),
    docModalTitle: document.getElementById('docModalTitle'),
    docModalMeta: document.getElementById('docModalMeta'),
    docModalIcon: document.getElementById('docModalIcon'),
    docModalCode: document.getElementById('docModalCode'),
    docModalImageWrap: document.getElementById('docModalImageWrap'),
    docModalImg: document.getElementById('docModalImg'),
    attachSuggestionCard: document.getElementById('attachSuggestionCard'),
    excelSuggestionCard: document.getElementById('excelSuggestionCard'),

    // Sidebar
    sidebar: document.getElementById('sidebar'),
    sidebarOpenBtn: document.getElementById('sidebarOpenBtn'),
    sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
    newChatBtn: document.getElementById('newChatBtn'),
    historyList: document.getElementById('historyList'),
    statusIndicator: document.getElementById('statusIndicator'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeIcon: document.getElementById('themeIcon'),
    themeText: document.getElementById('themeText'),

    // Settings Modal
    settingsBtn: document.getElementById('settingsBtn'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    saveSettingsBtn: document.getElementById('saveSettingsBtn'),
    systemPromptInput: document.getElementById('systemPromptInput'),
    apiKeyInput: document.getElementById('apiKeyInput'),
    temperatureSlider: document.getElementById('temperatureSlider'),
    tempValue: document.getElementById('tempValue'),
    ollamaHostInput: document.getElementById('ollamaHostInput'),
    clearChatBtn: document.getElementById('clearChatBtn'),
    exportChatBtn: document.getElementById('exportChatBtn')
};

// ==========================================
// Initialization
// ==========================================
async function initApp() {
    try {
        loadPreferences();
        setupEventListeners();
        populateModelDropdown();
        updateOnlineVerificationBadge();
        renderChatList();
        updateSendButtonState();

        const savedActiveId = localStorage.getItem('localai_active_chat_id');
        let targetChat = (state.chats || []).find(c => c.id === savedActiveId);

        if (!targetChat && state.chats && state.chats.length > 0) {
            targetChat = state.chats[0];
        }

        if (targetChat) {
            switchChat(targetChat.id);
        } else {
            createNewChat();
        }

        checkHardwareAndEngines().catch(console.warn);
    } catch (err) {
        console.error("Initialization error:", err);
    }
}

// ==========================================
// Hardware & WebGPU Check
// ==========================================
async function checkHardwareAndEngines() {
    if ('gpu' in navigator) {
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
                state.webgpuSupported = true;
                const info = await adapter.requestAdapterInfo?.() || {};
                const gpuDesc = info.description || info.vendor || "Apple Silicon GPU";
                console.log(`[LocalAI] WebGPU available: ${gpuDesc}`);
            }
        } catch (e) {
            console.warn("[LocalAI] WebGPU adapter check failed:", e);
        }
    }

    checkOllamaServer().catch(() => {});
}

async function checkOllamaServer() {
    try {
        const res = await fetch('/api/status');
        if (res.ok) {
            const data = await res.json();
            if (data.ollamaAvailable && data.ollamaModels?.length > 0) {
                OLLAMA_DEFAULT_MODELS.length = 0;
                data.ollamaModels.forEach(m => {
                    OLLAMA_DEFAULT_MODELS.push({ id: m.name, name: `${m.name} (${Math.round((m.size || 0) / 1e9 * 10) / 10}GB)` });
                });
                if (state.engine === 'ollama') {
                    populateModelDropdown();
        updateOnlineVerificationBadge();
                }
            }
        }
    } catch (e) {}
}

function updateOnlineVerificationBadge() {
    if (elements.onlineVerifyBadge) {
        if (state.apiKey) {
            elements.onlineVerifyBadge.classList.add('verified');
            if (elements.onlineVerifyLabel) elements.onlineVerifyLabel.textContent = 'API Key Active';
        } else {
            elements.onlineVerifyBadge.classList.remove('verified');
            if (elements.onlineVerifyLabel) elements.onlineVerifyLabel.textContent = 'Free Instant Mode';
        }
    }
}

function populateModelDropdown() {
    if (!elements.modelSelect) return;
    elements.modelSelect.innerHTML = '';

    const g1 = document.createElement('optgroup');
    g1.label = "Cloud / Frontier AI";
    INSTANT_MODELS.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.dataset.engine = 'instant';
        opt.textContent = m.name;
        if (m.id === state.selectedModel) opt.selected = true;
        g1.appendChild(opt);
    });
    elements.modelSelect.appendChild(g1);

    const g2 = document.createElement('optgroup');
    g2.label = "Local Metal GPU (WebLLM)";
    WEBLLM_MODELS.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.dataset.engine = 'webllm';
        opt.textContent = m.name;
        if (m.id === state.selectedModel) opt.selected = true;
        g2.appendChild(opt);
    });
    elements.modelSelect.appendChild(g2);

    if (OLLAMA_DEFAULT_MODELS.length > 0) {
        const g3 = document.createElement('optgroup');
        g3.label = "Local Ollama";
        OLLAMA_DEFAULT_MODELS.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.id;
            opt.dataset.engine = 'ollama';
            opt.textContent = m.name;
            if (m.id === state.selectedModel) opt.selected = true;
            g3.appendChild(opt);
        });
        elements.modelSelect.appendChild(g3);
    }
}

// ==========================================
// WebLLM Engine Loading
// ==========================================
async function getWebLLMEngine() {
    if (state.webllmEngine && state.webllmEngine.currentModel === state.selectedModel) {
        return state.webllmEngine;
    }

    state.webllmLoading = true;
    updateSendButtonState();
    elements.modelProgressContainer.style.display = 'block';
    elements.progressText.textContent = `Preparing ${state.selectedModel} via WebGPU...`;
    elements.progressPercentage.textContent = '0%';
    elements.progressFill.style.width = '0%';

    try {
        const webllm = await import("https://esm.run/@mlc-ai/web-llm");

        const initProgressCallback = (report) => {
            const text = report.text || "Loading model...";
            const progress = Math.round((report.progress || 0) * 100);

            elements.progressText.textContent = text;
            elements.progressPercentage.textContent = `${progress}%`;
            elements.progressFill.style.width = `${progress}%`;
        };

        const engine = await webllm.CreateMLCEngine(state.selectedModel, {
            initProgressCallback
        });

        engine.currentModel = state.selectedModel;
        state.webllmEngine = engine;
        elements.modelProgressContainer.style.display = 'none';
        return engine;
    } catch (err) {
        elements.modelProgressContainer.style.display = 'none';
        throw new Error(`WebGPU Model initialization failed: ${err.message}. Tip: Switch to 'Frontier AI (Online)' tab.`);
    } finally {
        state.webllmLoading = false;
        updateSendButtonState();
    }
}

// ==========================================
// Document, Excel, Screenshot & OCR Helpers
// ==========================================
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(name = '', type = '') {
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'pdf' || (type && type.includes('pdf'))) return '📄';
    if (['xlsx', 'xls'].includes(ext) || (type && type.includes('spreadsheet'))) return '📊';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif', 'tiff', 'tif', 'avif', 'svg', 'ico'].includes(ext) || (type && type.includes('image'))) return '📷';
    if (['js', 'jsx', 'ts', 'tsx', 'py', 'swift', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql'].includes(ext)) return '💻';
    if (['json', 'yaml', 'yml', 'xml'].includes(ext)) return '📋';
    if (['csv', 'tsv'].includes(ext)) return '📈';
    if (['html', 'css', 'scss', 'svg'].includes(ext)) return '🌐';
    if (['md', 'markdown', 'txt', 'rtf', 'log'].includes(ext)) return '📝';
    return '📁';
}

async function extractPdfText(file) {
    if (!window.pdfjsLib) {
        throw new Error('PDF parsing library is still initializing. Please wait a moment and try again.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map(item => item.str).join(' ');
        fullText += `--- Page ${i} ---\n${pageText}\n\n`;
    }
    return fullText.trim() || '[Empty PDF or scanned image with no text layer]';
}

async function extractExcelText(file) {
    if (!window.XLSX) {
        throw new Error('Excel parsing library (SheetJS) is still loading. Please wait a moment.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let fullText = `[EXCEL WORKBOOK: ${file.name}]\nTotal Sheets: ${workbook.SheetNames.length} (${workbook.SheetNames.join(', ')})\n\n`;

    workbook.SheetNames.forEach((sheetName, index) => {
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (!jsonData || jsonData.length === 0) {
            fullText += `--- Sheet ${index + 1}: "${sheetName}" (Empty) ---\n\n`;
            return;
        }

        const headers = jsonData[0] || [];
        const rows = jsonData.slice(1);
        fullText += `--- Sheet ${index + 1}: "${sheetName}" (${rows.length} rows, ${headers.length} columns) ---\n`;
        fullText += `Columns: ${headers.filter(Boolean).join(', ')}\n\n`;

        if (headers.length > 0) {
            fullText += `| ${headers.map(h => String(h || '').trim()).join(' | ')} |\n`;
            fullText += `| ${headers.map(() => '---').join(' | ')} |\n`;
            const sampleRows = rows.slice(0, 40);
            sampleRows.forEach(row => {
                const cells = headers.map((_, colIdx) => String(row[colIdx] !== undefined ? row[colIdx] : '').trim());
                fullText += `| ${cells.join(' | ')} |\n`;
            });
            if (rows.length > 40) {
                fullText += `\n*...and ${rows.length - 40} more rows*\n`;
            }
            fullText += '\n';
        }
    });

    return fullText;
}

async function processImageFile(file) {
    let processedFile = file;

    // Handle Apple iPhone / Mac HEIC and HEIF formats
    const isHeic = file.name.toLowerCase().endsWith('.heic') || 
                   file.name.toLowerCase().endsWith('.heif') || 
                   (file.type && (file.type.includes('heic') || file.type.includes('heif')));

    if (isHeic && window.heic2any) {
        try {
            console.log('[LocalAI] Converting HEIC/HEIF to JPEG...');
            const converted = await window.heic2any({
                blob: file,
                toType: 'image/jpeg',
                quality: 0.92
            });
            const blobResult = Array.isArray(converted) ? converted[0] : converted;
            processedFile = new File([blobResult], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
        } catch (heicErr) {
            console.warn('[LocalAI] heic2any conversion fallback:', heicErr);
        }
    }

    // Handle SVG files
    let svgCode = '';
    const isSvg = file.name.toLowerCase().endsWith('.svg') || (file.type && file.type.includes('svg'));
    if (isSvg) {
        try {
            svgCode = await file.text();
        } catch (e) {}
    }

    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(processedFile);
    });

    let ocrText = '';
    if (isSvg && svgCode) {
        // Extract text nodes from SVG directly
        const textMatches = svgCode.match(/<text[^>]*>([\s\S]*?)<\/text>/gi) || [];
        ocrText = textMatches.map(t => t.replace(/<[^>]*>/g, '').trim()).filter(Boolean).join('\n');
    }

    if (!ocrText && window.Tesseract) {
        try {
            console.log('[LocalAI] Running OCR on image/screenshot...');
            const result = await Tesseract.recognize(dataUrl, 'eng');
            ocrText = (result?.data?.text || '').trim();
            console.log(`[LocalAI] OCR extracted ${ocrText.length} characters`);
        } catch (ocrErr) {
            console.warn('[LocalAI] OCR extraction failed:', ocrErr);
        }
    }

    let description = `[IMAGE / SCREENSHOT ATTACHMENT: ${file.name}]\n`;
    description += `MIME Type: ${processedFile.type || file.type || 'image/png'}\n`;
    description += `File Size: ${formatFileSize(file.size)}\n`;

    if (ocrText && ocrText.length > 0) {
        description += `\n[EXTRACTED TEXT FROM IMAGE / SCREENSHOT (OCR)]:\n"""\n${ocrText}\n"""\n`;
    } else {
        description += `\n(No textual layer or prominent text recognized. Image available for visual analysis.)\n`;
    }

    return {
        content: description,
        dataUrl: dataUrl,
        ocrText: ocrText
    };
}

async function processFiles(fileList) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    for (const file of files) {
        try {
            const ext = file.name.split('.').pop().toLowerCase();
            let content = '';
            let dataUrl = null;
            let ocrText = null;

            if (ext === 'pdf') {
                content = await extractPdfText(file);
            } else if (['xlsx', 'xls'].includes(ext)) {
                content = await extractExcelText(file);
            } else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif', 'tiff', 'tif', 'avif', 'svg', 'ico'].includes(ext) || file.type.startsWith('image/')) {
                const imgResult = await processImageFile(file);
                content = imgResult.content;
                dataUrl = imgResult.dataUrl;
                ocrText = imgResult.ocrText;
            } else {
                content = await file.text();
            }

            const fileId = 'file_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
            state.attachedFiles.push({
                id: fileId,
                name: file.name,
                size: file.size,
                sizeFormatted: formatFileSize(file.size),
                type: file.type || ext,
                content: content,
                dataUrl: dataUrl,
                ocrText: ocrText,
                icon: getFileIcon(file.name, file.type)
            });
        } catch (err) {
            console.error('Failed to parse file:', file.name, err);
            alert(`Could not process "${file.name}": ${err.message}`);
        }
    }

    renderAttachmentPreviews();
    updateSendButtonState();
    elements.chatInput.focus();
}

function renderAttachmentPreviews() {
    if (!elements.attachmentPreviewBar) return;

    if (state.attachedFiles.length === 0) {
        elements.attachmentPreviewBar.style.display = 'none';
        elements.attachmentPreviewBar.innerHTML = '';
        if (elements.docActionChips) elements.docActionChips.style.display = 'none';
        elements.attachBtn?.classList.remove('has-files');
        return;
    }

    elements.attachmentPreviewBar.style.display = 'flex';
    elements.attachmentPreviewBar.innerHTML = '';
    if (elements.docActionChips) elements.docActionChips.style.display = 'flex';
    elements.attachBtn?.classList.add('has-files');

    state.attachedFiles.forEach(file => {
        const chip = document.createElement('div');
        chip.className = 'attachment-chip';
        chip.title = `Click to preview ${file.name}`;

        let iconMarkup = `<span class="attachment-chip-icon">${file.icon}</span>`;
        if (file.dataUrl) {
            iconMarkup = `<img src="${file.dataUrl}" class="attachment-chip-thumb" alt="thumbnail">`;
        }

        chip.innerHTML = `
            ${iconMarkup}
            <div class="attachment-chip-info">
                <span class="attachment-chip-name">${escapeHtml(file.name)}</span>
                <span class="attachment-chip-size">${file.sizeFormatted}${file.ocrText ? ' • OCR Text Ready' : ''}</span>
            </div>
            <button class="attachment-chip-remove" title="Remove attachment">✕</button>
        `;

        chip.addEventListener('click', (e) => {
            if (e.target.closest('.attachment-chip-remove')) {
                e.stopPropagation();
                removeAttachment(file.id);
            } else {
                openDocModal(file);
            }
        });

        elements.attachmentPreviewBar.appendChild(chip);
    });
}

function removeAttachment(fileId) {
    state.attachedFiles = state.attachedFiles.filter(f => f.id !== fileId);
    if (elements.fileAttachmentInput) elements.fileAttachmentInput.value = '';
    renderAttachmentPreviews();
    updateSendButtonState();
}

function clearAllAttachments() {
    state.attachedFiles = [];
    if (elements.fileAttachmentInput) elements.fileAttachmentInput.value = '';
    renderAttachmentPreviews();
    updateSendButtonState();
}

function openDocModal(doc) {
    if (!doc || !elements.docViewerModal) return;
    state.viewingDoc = doc;
    elements.docModalTitle.textContent = doc.name;
    elements.docModalIcon.textContent = doc.icon || getFileIcon(doc.name, doc.type);
    elements.docModalMeta.textContent = `${doc.type || 'Document'} • ${doc.sizeFormatted || formatFileSize(doc.size)} • ${(doc.content || '').split('\n').length} lines`;
    elements.docModalCode.textContent = doc.content || '(Empty document)';

    if (doc.dataUrl && elements.docModalImageWrap && elements.docModalImg) {
        elements.docModalImg.src = doc.dataUrl;
        elements.docModalImageWrap.style.display = 'block';
    } else if (elements.docModalImageWrap) {
        elements.docModalImageWrap.style.display = 'none';
    }

    elements.docViewerModal.style.display = 'flex';
}

function closeDocModal() {
    if (elements.docViewerModal) {
        elements.docViewerModal.style.display = 'none';
        state.viewingDoc = null;
    }
}

// ==========================================
// Sending & Streaming Messages
// ==========================================
function isImageGenerationPrompt(text) {
    const p = (text || '').trim();
    if (!p) return null;
    
    const pLower = p.toLowerCase();
    if (pLower.startsWith('how to') || pLower.includes('can you generate image') || pLower.includes('how do i')) {
        return null;
    }
    
    // Match: "generate image on nature along with house...", "create an image of...", "draw...", "paint..."
    const match = p.match(/^(?:generate|create|make|draw|paint|sketch|show me|produce)\s+(?:an?\s+)?(?:image|picture|photo|drawing|illustration|render|art|graphic)?\s*(?:of|on|about|depicting|with|for)?\s*(.+)/i)
               || p.match(/^(?:draw|sketch|paint)\s+(?:an?\s+)?(.+)/i)
               || p.match(/^(?:image|picture|photo)\s+(?:of|on|about)\s*(.+)/i);
    
    if (match) {
        let subject = match[1].trim().replace(/[.?!]+$/, '');
        if (subject.length > 2) return subject;
    }
    return null;
}

async function sendMessage() {
    const text = elements.chatInput.value.trim();
    const hasAttachments = state.attachedFiles && state.attachedFiles.length > 0;
    if ((!text && !hasAttachments) || state.isGenerating || state.webllmLoading) return;

    const currentChat = getCurrentChat();

    // Hide welcome banner on first prompt
    elements.welcomeScreen.style.display = 'none';

    // Clear textarea
    elements.chatInput.value = '';
    elements.chatInput.style.height = 'auto';

    // Snapshot attached files & reset state
    const currentAttachments = [...state.attachedFiles];
    state.attachedFiles = [];
    renderAttachmentPreviews();
    updateSendButtonState();

    // Formulate prompt for display vs LLM inference
    const displayText = text || (currentAttachments.length > 0 ? (currentAttachments[0].type.startsWith('image/') ? "Please analyze this image/screenshot and read the text." : "Please analyze this attached document/data.") : "");

    let llmPrompt = "";
    if (currentAttachments.length > 0) {
        currentAttachments.forEach((att) => {
            llmPrompt += `${att.content}\n\n`;
        });
    }
    llmPrompt += text ? `User Request: ${text}` : `User Request: Please analyze the attached file(s) and provide key insights.`;

    // Auto title if first message
    if (currentChat.messages.length === 0) {
        const titleSource = text || (currentAttachments[0] ? `File: ${currentAttachments[0].name}` : 'New Analysis');
        currentChat.title = titleSource.length > 28 ? titleSource.substring(0, 28) + '...' : titleSource;
        renderChatList();
    }

    // Append user message
    currentChat.messages.push({
        role: 'user',
        content: llmPrompt,
        displayText: displayText,
        attachments: currentAttachments.map(a => ({
            id: a.id,
            name: a.name,
            size: a.size,
            sizeFormatted: a.sizeFormatted,
            type: a.type,
            icon: a.icon,
            dataUrl: a.dataUrl,
            ocrText: a.ocrText,
            content: a.content
        }))
    });
    renderMessage('user', displayText, false, currentAttachments);
    saveChats();

    // Prepare assistant response bubble
    const assistantBubble = renderMessage('assistant', '', true);
    state.isGenerating = true;
    state.abortController = new AbortController();
    elements.stopBtn.style.display = 'flex';
    updateSendButtonState();

    let fullResponse = '';

    // Immediate Check: Free High-Resolution Image Generation
    const imgSubject = isImageGenerationPrompt(text);
    if (imgSubject && currentAttachments.length === 0) {
        const cleanSubject = imgSubject.trim().replace(/[.?!]+$/, '');
        const encoded = encodeURIComponent(cleanSubject);
        const imageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true`;

        const imageMarkdown = `### 🎨 Generated Image: *${cleanSubject}*\n\n` +
                              `![${cleanSubject}](${imageUrl})\n\n` +
                              `> **Prompt**: *"${cleanSubject}"*\n` +
                              `> **Resolution**: 1024×1024 • Model: Flux / Diffusion Engine\n\n` +
                              `[📥 Download Full Resolution Image](${imageUrl})`;

        updateMessageContent(assistantBubble, imageMarkdown, false);
        currentChat.messages.push({
            role: 'assistant',
            content: imageMarkdown
        });
        saveChats();
        state.isGenerating = false;
        elements.stopBtn.style.display = 'none';
        updateSendButtonState();
        return;
    }

    try {
        if (state.engine === 'instant') {
            let receivedTokens = false;

            // Real-Time Internet Search & Documentation Grounding
            const pLower = (text || '').toLowerCase();
            const isNewsRequest = pLower.includes('news') || pLower.includes('headline') || pLower.includes('breaking') || pLower.includes('today') || pLower.includes('latest update');
            const isEndpointCentralAgent = (pLower.includes('endpoint central') || pLower.includes('desktop central')) && (pLower.includes('agent') || pLower.includes('install') || pLower.includes('setup') || pLower.includes('deploy') || pLower.includes('dcagent'));

            let liveWebSources = [];
            let liveWebContext = '';

            // Search the live web if webSearch is enabled
            if (state.webSearch && text.trim().length > 3) {
                try {
                    const searchRes = await fetch(`/api/search?q=${encodeURIComponent(text.trim())}`);
                    if (searchRes.ok) {
                        const searchData = await searchRes.json();
                        liveWebSources = searchData.sources || [];
                        liveWebContext = searchData.webContext || '';
                    }
                } catch (e) {
                    console.warn('[AuraAI] Live web search query error:', e);
                }
            }

            // 1. Puter.ai: Use ONLY for gpt-4o-mini without sign-up/credit links
            const isPuterSignedIn = typeof window.puter?.auth?.isSignedIn === 'function' ? window.puter.auth.isSignedIn() : false;
            const isPuterEligible = state.selectedModel === 'gpt-4o-mini';

            // Route Endpoint Central queries or News directly to server for verified documentation & citations
            const routeToServerFirst = isNewsRequest || isEndpointCentralAgent;

            if (!routeToServerFirst && isPuterSignedIn && isPuterEligible && window.puter?.ai?.chat) {
                try {
                    let puterSystem = state.systemPrompt;
                    if (liveWebSources.length > 0) {
                        const s0 = liveWebSources[0];
                        const countStr = liveWebSources.length > 1 ? ` +${liveWebSources.length - 1}` : '';
                        puterSystem += `\n\n[REAL-TIME LIVE WEB SEARCH RESULTS]\n${liveWebContext}\n\nINSTRUCTIONS: You have live internet search capability. Use the live web results above to provide exact official steps, commands, and links. Include the citation badge [${s0.domain}${countStr}](${s0.url}) in your response.`;
                    }

                    const puterMessages = [
                        { role: 'system', content: puterSystem },
                        ...currentChat.messages.map(m => ({ role: m.role, content: m.content }))
                    ];

                    const responseStream = await window.puter.ai.chat(puterMessages, {
                        model: 'gpt-4o-mini',
                        stream: true
                    });

                    let streamedTokens = '';
                    for await (const chunk of responseStream) {
                        if (state.abortController?.signal?.aborted) break;
                        const token = chunk?.text || (typeof chunk === 'string' ? chunk : '');
                        if (token) {
                            streamedTokens += token;
                            updateMessageContent(assistantBubble, streamedTokens, true);
                        }
                    }

                    // If Puter outputs an external upgrade / pricing link, reject it and fallback to server
                    if (/puter\.com|upgrade|purchase credits|pricing|sign up|sign-in/i.test(streamedTokens)) {
                        console.warn('[LocalAI] Puter output contained promotional links. Falling back to server engine.');
                        fullResponse = '';
                        receivedTokens = false;
                    } else if (streamedTokens.trim().length > 0) {
                        fullResponse = streamedTokens;
                        receivedTokens = true;
                    }
                } catch (puterErr) {
                    console.warn('[LocalAI] Puter.ai streaming failed, using server fallback:', puterErr);
                }
            }

            // 2. Fallback or News to local server /api/instant-chat
            if (!receivedTokens && !state.abortController?.signal?.aborted) {
                const response = await fetch('/api/instant-chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: state.abortController.signal,
                    body: JSON.stringify({
                        messages: currentChat.messages,
                        model: state.selectedModel,
                        temperature: state.temperature,
                        webSearch: state.webSearch,
                        apiKey: state.apiKey || localStorage.getItem('localai_api_key') || ''
                    })
                });

                if (!response.ok) {
                    throw new Error(`Instant chat error: ${response.statusText}`);
                }

                const data = await response.json();
                const targetText = data.response || "No response received.";

                const words = targetText.split(' ');
                for (let i = 0; i < words.length; i++) {
                    if (state.abortController.signal.aborted) break;
                    fullResponse += (i === 0 ? '' : ' ') + words[i];
                    updateMessageContent(assistantBubble, fullResponse, true);
                    await new Promise(r => setTimeout(r, 12));
                }
            }
        } else if (state.engine === 'webllm') {
            const engine = await getWebLLMEngine();

            const messagesPayload = [
                { role: 'system', content: state.systemPrompt },
                ...currentChat.messages
            ];

            const chunks = await engine.chat.completions.create({
                messages: messagesPayload,
                temperature: state.temperature,
                stream: true
            });

            for await (const chunk of chunks) {
                if (state.abortController.signal.aborted) break;
                const token = chunk.choices[0]?.delta?.content || "";
                fullResponse += token;
                updateMessageContent(assistantBubble, fullResponse, true);
            }
        } else if (state.engine === 'ollama') {
            const messagesPayload = [
                { role: 'system', content: state.systemPrompt },
                ...currentChat.messages
            ];

            const response = await fetch(`${state.ollamaHost}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: state.abortController.signal,
                body: JSON.stringify({
                    model: state.selectedModel,
                    messages: messagesPayload,
                    stream: true,
                    options: {
                        temperature: state.temperature
                    }
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Ollama request failed with HTTP ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message?.content) {
                            fullResponse += parsed.message.content;
                            updateMessageContent(assistantBubble, fullResponse, true);
                        }
                    } catch (e) {}
                }
            }
        }

        updateMessageContent(assistantBubble, fullResponse, false);
        currentChat.messages.push({ role: 'assistant', content: fullResponse });
        saveChats();
    } catch (err) {
        if (err.name === 'AbortError' || state.abortController?.signal?.aborted) {
            updateMessageContent(assistantBubble, fullResponse + "\n\n*(Generation stopped)*", false);
            if (fullResponse) {
                currentChat.messages.push({ role: 'assistant', content: fullResponse });
                saveChats();
            }
        } else {
            const errorMsg = `⚠️ **Error**: ${err.message}\n\n*Tip: Switch to the **Frontier AI (Online)** tab for immediate responses.*`;
            updateMessageContent(assistantBubble, errorMsg, false);
        }
    } finally {
        state.isGenerating = false;
        elements.stopBtn.style.display = 'none';
        updateSendButtonState();
    }
}

// ==========================================
// Rendering Messages & Markdown
// ==========================================
function renderMessage(role, content, isStreaming = false, attachments = []) {
    const row = document.createElement('div');
    row.className = `message-row ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : '✦';

    const contentDiv = document.createElement('div');
    contentDiv.className = `message-content ${isStreaming ? 'typing-cursor' : ''}`;

    if (role === 'user') {
        if (attachments && attachments.length > 0) {
            const attContainer = document.createElement('div');
            attContainer.className = 'message-attachments';
            attachments.forEach(att => {
                if (att.dataUrl) {
                    const thumb = document.createElement('div');
                    thumb.className = 'user-msg-image-thumb';
                    thumb.title = `Click to view ${att.name}`;
                    thumb.innerHTML = `<img src="${att.dataUrl}" alt="${escapeHtml(att.name)}">`;
                    thumb.addEventListener('click', () => openDocModal(att));
                    attContainer.appendChild(thumb);
                } else {
                    const badge = document.createElement('div');
                    badge.className = 'doc-badge';
                    badge.title = `Click to preview ${att.name}`;
                    badge.innerHTML = `
                        <span class="doc-badge-icon">${att.icon || getFileIcon(att.name, att.type)}</span>
                        <span class="doc-badge-name">${escapeHtml(att.name)}</span>
                        <span class="doc-badge-size">(${att.sizeFormatted || formatFileSize(att.size)})</span>
                        <span class="doc-badge-view">View ↗</span>
                    `;
                    badge.addEventListener('click', () => openDocModal(att));
                    attContainer.appendChild(badge);
                }
            });
            contentDiv.appendChild(attContainer);
        }

        const textDiv = document.createElement('div');
        textDiv.className = 'user-message-text';
        textDiv.textContent = content;
        contentDiv.appendChild(textDiv);
    } else {
        contentDiv.innerHTML = formatMarkdown(content);
    }

    row.appendChild(avatar);
    row.appendChild(contentDiv);
    elements.messagesContainer.appendChild(row);
    scrollToBottom();

    return contentDiv;
}

function updateMessageContent(contentElement, rawText, isStreaming, meta = {}) {
    if (isStreaming) {
        contentElement.classList.add('typing-cursor');
    } else {
        contentElement.classList.remove('typing-cursor');
    }

    let html = formatMarkdown(rawText);

    if (!isStreaming && rawText) {
        html += `
            <div class="msg-action-bar">
                <button class="btn-msg-action btn-copy-msg" title="Copy response">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span>Copy</span>
                </button>
            </div>
        `;
    }

    contentElement.innerHTML = html;

    const copyBtn = contentElement.querySelector('.btn-copy-msg');
    if (copyBtn) {
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(rawText).then(() => {
                copyBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <span>Copied!</span>
                `;
                setTimeout(() => {
                    copyBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Copy</span>
                    `;
                }, 2000);
            });
        };
    }

    contentElement.querySelectorAll('pre code').forEach((block) => {
        if (window.hljs && !block.dataset.highlighted) {
            hljs.highlightElement(block);
            block.dataset.highlighted = "true";
        }
    });

    addCopyButtonsToCode(contentElement);
    scrollToBottom();
}

function formatMarkdown(text) {
    if (!text) return '';
    try {
        if (window.marked && typeof marked.parse === 'function') {
            let rawHtml = marked.parse(text, { breaks: true, gfm: true });
            
            // Format citation pills like [ManageEngine +1](https://...) or [Source +N](...) into rich badges
            rawHtml = rawHtml.replace(/<a\s+href="([^"]+)">([^<]*\+\d+[^<]*)<\/a>/gi, '<a class="source-pill-badge" href="$1" target="_blank" rel="noopener">🌐 $2</a>');
            rawHtml = rawHtml.replace(/<a\s+href="([^"]+)">🌐\s*([^<]+)<\/a>/gi, '<a class="source-pill-badge" href="$1" target="_blank" rel="noopener">🌐 $2</a>');

            if (window.DOMPurify && typeof DOMPurify.sanitize === 'function') {
                return DOMPurify.sanitize(rawHtml, {
                    ADD_ATTR: ['target', 'rel', 'class'],
                    ADD_TAGS: ['svg', 'path', 'rect', 'line', 'polyline', 'span']
                });
            }
            return rawHtml;
        }
    } catch (e) {}
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function addCopyButtonsToCode(container) {
    const pres = container.querySelectorAll('pre');
    pres.forEach(pre => {
        if (pre.parentElement.classList.contains('code-block-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'code-block-wrapper';

        const header = document.createElement('div');
        header.className = 'code-block-header';

        const codeEl = pre.querySelector('code');
        const langClass = Array.from(codeEl?.classList || []).find(c => c.startsWith('language-'));
        const lang = langClass ? langClass.replace('language-', '') : 'code';

        header.innerHTML = `
            <span class="code-lang">${lang}</span>
            <button class="btn-copy-code" title="Copy code">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span>Copy</span>
            </button>
        `;

        const copyBtn = header.querySelector('.btn-copy-code');
        copyBtn.addEventListener('click', () => {
            const codeText = codeEl?.textContent || pre.textContent;
            navigator.clipboard.writeText(codeText).then(() => {
                copyBtn.innerHTML = `<span>Copied!</span>`;
                setTimeout(() => {
                    copyBtn.innerHTML = `
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>Copy</span>
                    `;
                }, 2000);
            });
        });

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(header);
        wrapper.appendChild(pre);
    });
}

function scrollToBottom() {
    elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
}

// ==========================================
// Chat Session Management
// ==========================================
function createNewChat() {
    clearAllAttachments();

    // If active chat is already a brand new empty chat, just stay on it!
    const activeChat = (state.chats || []).find(c => c.id === state.activeChatId);
    if (activeChat && (!activeChat.messages || activeChat.messages.length === 0)) {
        switchChat(activeChat.id);
        return;
    }

    // Reuse any existing unpinned empty chat to keep sidebar clean
    const existingEmpty = (state.chats || []).find(c => (!c.messages || c.messages.length === 0) && !c.pinned);
    if (existingEmpty) {
        switchChat(existingEmpty.id);
        return;
    }

    const newChat = {
        id: 'chat_' + Date.now(),
        title: 'New Chat',
        timestamp: Date.now(),
        messages: [],
        pinned: false
    };
    state.chats.unshift(newChat);
    saveChats();
    switchChat(newChat.id);
}

function switchChat(chatId) {
    state.activeChatId = chatId;
    try {
        localStorage.setItem('localai_active_chat_id', chatId);
    } catch (e) {}
    clearAllAttachments();
    renderChatList();

    const currentChat = getCurrentChat();
    elements.messagesContainer.innerHTML = '';

    if (!currentChat || currentChat.messages.length === 0) {
        elements.messagesContainer.appendChild(elements.welcomeScreen);
        elements.welcomeScreen.style.display = 'block';
    } else {
        elements.welcomeScreen.style.display = 'none';
        currentChat.messages.forEach(msg => {
            renderMessage(msg.role, msg.displayText || msg.content, false, msg.attachments || []);
        });
        elements.messagesContainer.querySelectorAll('pre code').forEach((block) => {
            if (window.hljs) hljs.highlightElement(block);
        });
        addCopyButtonsToCode(elements.messagesContainer);
    }

    elements.chatInput.focus();
}

function deleteChat(chatId, e) {
    if (e) e.stopPropagation();
    state.chats = state.chats.filter(c => c.id !== chatId);
    saveChats();
    if (state.chats.length === 0) {
        createNewChat();
    } else if (state.activeChatId === chatId) {
        switchChat(state.chats[0].id);
    } else {
        renderChatList();
    }
}

function getCurrentChat() {
    let chat = state.chats.find(c => c.id === state.activeChatId);
    if (!chat) chat = state.chats[0];
    if (!chat) {
        chat = {
            id: 'chat_' + Date.now(),
            title: 'New Chat',
            timestamp: Date.now(),
            messages: []
        };
        state.chats.unshift(chat);
        state.activeChatId = chat.id;
    }
    return chat;
}

function renderChatList() {
    if (!elements.historyList) return;
    elements.historyList.innerHTML = '';

    const allChats = state.chats || [];
    if (allChats.length === 0) return;

    const pinnedChats = allChats.filter(c => c.pinned);
    const unpinnedChats = allChats.filter(c => !c.pinned);

    if (pinnedChats.length > 0) {
        const pinHeader = document.createElement('div');
        pinHeader.className = 'history-sublabel';
        pinHeader.innerHTML = '<span class="sublabel-title">📌 Pinned</span>';
        elements.historyList.appendChild(pinHeader);

        pinnedChats.forEach(chat => {
            elements.historyList.appendChild(createChatItemElement(chat));
        });
    }

    // Chronological grouping
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const todayChats = [];
    const yesterdayChats = [];
    const past7DaysChats = [];
    const olderChats = [];

    unpinnedChats.forEach(chat => {
        const chatTime = chat.timestamp || now;
        const age = now - chatTime;
        if (age < oneDay) {
            todayChats.push(chat);
        } else if (age < 2 * oneDay) {
            yesterdayChats.push(chat);
        } else if (age < 7 * oneDay) {
            past7DaysChats.push(chat);
        } else {
            olderChats.push(chat);
        }
    });

    const groups = [
        { label: 'Today', list: todayChats },
        { label: 'Yesterday', list: yesterdayChats },
        { label: 'Previous 7 Days', list: past7DaysChats },
        { label: 'Older', list: olderChats }
    ];

    let hasAnyGroup = false;
    groups.forEach(g => {
        if (g.list.length > 0) {
            hasAnyGroup = true;
            const hdr = document.createElement('div');
            hdr.className = 'history-sublabel';
            hdr.innerHTML = `<span class="sublabel-title">${g.label}</span>`;
            elements.historyList.appendChild(hdr);

            g.list.forEach(chat => {
                elements.historyList.appendChild(createChatItemElement(chat));
            });
        }
    });

    if (!hasAnyGroup && unpinnedChats.length > 0) {
        const hdr = document.createElement('div');
        hdr.className = 'history-sublabel';
        hdr.innerHTML = '<span class="sublabel-title">Recent</span>';
        elements.historyList.appendChild(hdr);
        unpinnedChats.forEach(chat => {
            elements.historyList.appendChild(createChatItemElement(chat));
        });
    }
}

function createChatItemElement(chat) {
    const item = document.createElement('div');
    item.className = `chat-item ${chat.id === state.activeChatId ? 'active' : ''} ${chat.pinned ? 'is-pinned' : ''}`;
    
    const titleText = escapeHtml(chat.title || 'New Chat');
    item.innerHTML = `
        <div class="chat-item-main">
            <svg class="chat-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span class="chat-item-title">${titleText}</span>
        </div>
        <div class="chat-item-actions">
            <button class="chat-item-action-btn btn-pin-chat ${chat.pinned ? 'active' : ''}" title="${chat.pinned ? 'Unpin chat' : 'Pin chat'}">
                ${chat.pinned ? '📌' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.89A2 2 0 0 1 15 10.77V6a3 3 0 0 0-6 0v4.77a2 2 0 0 1-1.11 1.79l-1.78.89A2 2 0 0 0 5 15.24Z"></path></svg>'}
            </button>
            <button class="chat-item-action-btn chat-item-delete" title="Delete conversation">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    `;

    item.addEventListener('click', () => switchChat(chat.id));
    
    const pinBtn = item.querySelector('.btn-pin-chat');
    pinBtn?.addEventListener('click', (e) => togglePinChat(chat.id, e));
    
    const delBtn = item.querySelector('.chat-item-delete');
    delBtn?.addEventListener('click', (e) => deleteChat(chat.id, e));

    return item;
}

function togglePinChat(chatId, e) {
    if (e) e.stopPropagation();
    const chat = (state.chats || []).find(c => c.id === chatId);
    if (chat) {
        chat.pinned = !chat.pinned;
        saveChats();
        renderChatList();
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
}

function exportChat() {
    const currentChat = getCurrentChat();
    if (!currentChat || currentChat.messages.length === 0) {
        alert("No messages to export yet!");
        return;
    }

    let markdown = `# ${currentChat.title}\n*Exported from LocalAI on ${new Date().toLocaleString()}*\n\n---\n\n`;
    currentChat.messages.forEach(m => {
        markdown += `### ${m.role === 'user' ? 'User' : 'Assistant'}:\n${m.content}\n\n`;
    });

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentChat.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==========================================
// Event Listeners & Settings
// ==========================================
function setupEventListeners() {
    // Input resizing & Keydown
    elements.chatInput.addEventListener('input', () => {
        elements.chatInput.style.height = 'auto';
        elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 200)}px`;
        updateSendButtonState();
    });

    elements.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    elements.sendBtn.addEventListener('click', (e) => {
        e.preventDefault();
        sendMessage();
    });

    elements.stopBtn.addEventListener('click', () => {
        if (state.abortController) {
            state.abortController.abort();
        }
    });

    // Web Search & Real-Time Grounding Toggle Buttons
    const syncWebSearchUI = () => {
        if (elements.webSearchBtn) {
            elements.webSearchBtn.classList.toggle('active', !!state.webSearch);
            elements.webSearchBtn.title = state.webSearch ? "Live Web Search: ON (AI searches internet in real time)" : "Live Web Search: OFF (Click to enable)";
        }
        if (elements.webSearchToggleBtn) {
            elements.webSearchToggleBtn.classList.toggle('active', !!state.webSearch);
            const lbl = elements.webSearchToggleBtn.querySelector('.web-label');
            if (lbl) lbl.textContent = state.webSearch ? '🌐 Live Search: ON' : '🌐 Live Search: OFF';
        }
    };
    syncWebSearchUI();

    elements.webSearchBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        state.webSearch = !state.webSearch;
        localStorage.setItem('localai_web_search', state.webSearch ? 'true' : 'false');
        syncWebSearchUI();
    });

    elements.webSearchToggleBtn?.addEventListener('click', () => {
        state.webSearch = !state.webSearch;
        localStorage.setItem('localai_web_search', state.webSearch ? 'true' : 'false');
        syncWebSearchUI();
    });

    // File Attachment Button & Hidden Input
    elements.attachBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        elements.fileAttachmentInput?.click();
    });

    elements.fileAttachmentInput?.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            processFiles(e.target.files);
        }
    });

    // Clipboard Paste Listener for Screenshots (Cmd+V / Ctrl+V)
    window.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
        if (!items) return;
        const imgFiles = [];
        for (const item of items) {
            if (item.type && item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    const named = new File([file], `screenshot_${new Date().toISOString().replace(/[:.]/g, '-')}.png`, { type: file.type });
                    imgFiles.push(named);
                }
            }
        }
        if (imgFiles.length > 0) {
            e.preventDefault();
            await processFiles(imgFiles);
        }
    });

    elements.clearAllAttachmentsBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        clearAllAttachments();
    });

    // Document & Image Modal Listeners
    elements.closeDocViewerBtn?.addEventListener('click', closeDocModal);
    elements.docViewerModal?.addEventListener('click', (e) => {
        if (e.target === elements.docViewerModal) closeDocModal();
    });

    elements.copyDocContentBtn?.addEventListener('click', () => {
        if (state.viewingDoc && state.viewingDoc.content) {
            navigator.clipboard.writeText(state.viewingDoc.content).then(() => {
                elements.copyDocContentBtn.textContent = '✅ Copied!';
                setTimeout(() => {
                    elements.copyDocContentBtn.textContent = '📋 Copy Text';
                }, 2000);
            });
        }
    });

    // Document Action Quick Chips
    elements.docActionChips?.addEventListener('click', (e) => {
        const btn = e.target.closest('.doc-chip');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'summarize') {
            elements.chatInput.value = "Please provide an executive summary and highlight the core themes.";
            sendMessage();
        } else if (action === 'keypoints') {
            elements.chatInput.value = "Extract the key takeaways, metrics, and actionable items.";
            sendMessage();
        } else if (action === 'excel') {
            elements.chatInput.value = "Analyze this spreadsheet: summarize key statistics, highlight top trends, and calculate totals or notable outliers across the data.";
            sendMessage();
        } else if (action === 'ocr') {
            elements.chatInput.value = "Transcribe and analyze all the text in this screenshot. Explain what is happening and list any error messages or action items.";
            sendMessage();
        } else if (action === 'image_analyze') {
            elements.chatInput.value = "Analyze this image in detail: identify all visible UI elements, text, layout, colors, and key visual information.";
            sendMessage();
        } else if (action === 'codereview') {
            elements.chatInput.value = "Perform a thorough code review. Identify potential bugs, security considerations, and architectural improvements.";
            sendMessage();
        }
    });

    // Drag & Drop
    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        if (elements.dragDropOverlay) elements.dragDropOverlay.style.display = 'flex';
    });

    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    window.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            if (elements.dragDropOverlay) elements.dragDropOverlay.style.display = 'none';
        }
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        if (elements.dragDropOverlay) elements.dragDropOverlay.style.display = 'none';
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFiles(e.dataTransfer.files);
        }
    });

    // Engine Switching
    elements.tabInstant?.addEventListener('click', () => {
        setActiveEngineTab(elements.tabInstant);
        state.engine = 'instant';
        state.selectedModel = INSTANT_MODELS[0].id;
        populateModelDropdown();
        updateOnlineVerificationBadge();
    });

    elements.tabWebLLM?.addEventListener('click', () => {
        setActiveEngineTab(elements.tabWebLLM);
        state.engine = 'webllm';
        state.selectedModel = WEBLLM_MODELS[0].id;
        populateModelDropdown();
        updateOnlineVerificationBadge();
    });

    elements.tabOllama?.addEventListener('click', () => {
        setActiveEngineTab(elements.tabOllama);
        state.engine = 'ollama';
        state.selectedModel = OLLAMA_DEFAULT_MODELS[0].id;
        populateModelDropdown();
        updateOnlineVerificationBadge();
        checkOllamaServer().catch(() => {});
    });

    function setActiveEngineTab(activeBtn) {
        [elements.tabInstant, elements.tabWebLLM, elements.tabOllama].forEach(tab => {
            if (tab) tab.classList.remove('active');
        });
        if (activeBtn) activeBtn.classList.add('active');
    }

    elements.modelSelect?.addEventListener('change', (e) => {
        state.selectedModel = e.target.value;
        const opt = e.target.options[e.target.selectedIndex];
        if (opt && opt.dataset.engine) {
            state.engine = opt.dataset.engine;
        }
        if (state.engine === 'webllm' && state.webllmEngine) {
            state.webllmEngine = null;
        }
    });

    // Suggestion Cards click
    elements.welcomeScreen?.addEventListener('click', (e) => {
        if (e.target.closest('#attachSuggestionCard')) {
            elements.fileAttachmentInput?.click();
            return;
        }
        if (e.target.closest('#excelSuggestionCard')) {
            elements.fileAttachmentInput?.click();
            return;
        }
        const card = e.target.closest('.suggestion-card');
        if (card && card.dataset.prompt) {
            const prompt = card.dataset.prompt;
            elements.chatInput.value = prompt;
            elements.chatInput.style.height = 'auto';
            sendMessage();
        }
    });

    // Chat management
    elements.newChatBtn.addEventListener('click', createNewChat);
    document.getElementById('topbarNewChatBtn')?.addEventListener('click', createNewChat);

    elements.clearChatBtn.addEventListener('click', () => {
        if (confirm("Are you sure you want to clear this conversation?")) {
            const current = getCurrentChat();
            if (current) {
                current.messages = [];
                current.title = "New Chat";
                saveChats();
                switchChat(current.id);
            }
        }
    });

    elements.exportChatBtn.addEventListener('click', exportChat);

    function toggleSidebar(collapsed) {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        if (collapsed === true) {
            elements.sidebar?.classList.remove('open');
        } else if (collapsed === false) {
            elements.sidebar?.classList.add('open');
        } else {
            elements.sidebar?.classList.toggle('open');
        }
    } else {
        const shouldCollapse = collapsed !== undefined ? collapsed : !elements.sidebar?.classList.contains('collapsed');
        if (shouldCollapse) {
            elements.sidebar?.classList.add('collapsed');
            document.body.classList.add('sidebar-is-collapsed');
            try { localStorage.setItem('localai_sidebar_collapsed', 'true'); } catch (e) {}
        } else {
            elements.sidebar?.classList.remove('collapsed');
            document.body.classList.remove('sidebar-is-collapsed');
            try { localStorage.setItem('localai_sidebar_collapsed', 'false'); } catch (e) {}
        }
    }
}

    // Sidebar Slide / Collapse Toggles
    elements.sidebarOpenBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar(false);
    });
    elements.sidebarToggleBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
    });

    // Dark/Light Theme Toggle
    elements.themeToggleBtn.addEventListener('click', () => {
        const isDark = document.body.classList.contains('dark-theme');
        if (isDark) {
            document.body.classList.remove('dark-theme');
            document.body.classList.add('light-theme');
            elements.themeIcon.textContent = '🌙';
            elements.themeText.textContent = 'Dark Mode';
            localStorage.setItem('localai_theme', 'light');
        } else {
            document.body.classList.remove('light-theme');
            document.body.classList.add('dark-theme');
            elements.themeIcon.textContent = '☀️';
            elements.themeText.textContent = 'Light Mode';
            localStorage.setItem('localai_theme', 'dark');
        }
    });

    // Settings Modal
    elements.settingsBtn.addEventListener('click', () => {
        elements.systemPromptInput.value = state.systemPrompt;
        if (elements.apiKeyInput) elements.apiKeyInput.value = state.apiKey;
        elements.temperatureSlider.value = state.temperature;
        elements.tempValue.textContent = state.temperature;
        elements.ollamaHostInput.value = state.ollamaHost;
        elements.settingsModal.style.display = 'flex';
    });

    elements.closeSettingsBtn.addEventListener('click', () => {
        elements.settingsModal.style.display = 'none';
    });

    elements.temperatureSlider.addEventListener('input', (e) => {
        elements.tempValue.textContent = e.target.value;
    });

    // Preset chips
    document.querySelectorAll('.preset-chips .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.preset-chips .chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const preset = chip.dataset.preset;
            if (preset === 'default') {
                elements.systemPromptInput.value = "You are a helpful, smart, and direct AI assistant.";
            } else if (preset === 'news') {
                elements.systemPromptInput.value = "You are an objective, real-time news and intelligence analyst. Summarize breaking events factually with citations, sources, and context.";
            } else if (preset === 'coder') {
                elements.systemPromptInput.value = "You are an elite principal software engineer. Provide clean, secure, idiomatic, well-commented, and production-ready code with concise explanations.";
            } else if (preset === 'data') {
                elements.systemPromptInput.value = "You are a senior data analyst and financial modeling expert. Analyze spreadsheets, datasets, outliers, statistical summaries, and trends.";
            }
        });
    });

    // Topbar Online Verification Badge click -> open Settings
    elements.onlineVerifyBadge?.addEventListener('click', () => {
        elements.settingsModal.style.display = 'flex';
        elements.systemPromptInput.value = state.systemPrompt;
        if (elements.apiKeyInput) {
            elements.apiKeyInput.value = state.apiKey;
            elements.apiKeyInput.focus();
        }
    });

    // Test & Verify Key Button inside Settings
    elements.verifyKeyBtn?.addEventListener('click', async () => {
        const key = elements.apiKeyInput ? elements.apiKeyInput.value.trim() : '';
        if (!key) {
            if (elements.keyVerificationStatus) {
                elements.keyVerificationStatus.style.display = 'block';
                elements.keyVerificationStatus.style.color = '#ef4444';
                elements.keyVerificationStatus.textContent = '⚠️ Please enter an API key first.';
            }
            return;
        }

        elements.verifyKeyBtn.disabled = true;
        elements.verifyKeyBtn.textContent = '⏳ Testing...';
        if (elements.keyVerificationStatus) {
            elements.keyVerificationStatus.style.display = 'block';
            elements.keyVerificationStatus.style.color = 'var(--text-muted)';
            elements.keyVerificationStatus.textContent = 'Connecting to official provider...';
        }

        const res = await verifyApiKey(key);
        elements.verifyKeyBtn.disabled = false;
        elements.verifyKeyBtn.textContent = '⚡ Test & Verify Key';

        if (res.valid) {
            state.apiKey = key;
            localStorage.setItem('localai_api_key', key);
            updateOnlineVerificationBadge();
            if (elements.keyVerificationStatus) {
                elements.keyVerificationStatus.style.color = '#10b981';
                elements.keyVerificationStatus.textContent = `✅ Verified Online! Connected to ${res.provider} (${res.model}). Key saved.`;
            }
        } else {
            if (elements.keyVerificationStatus) {
                elements.keyVerificationStatus.style.color = '#ef4444';
                elements.keyVerificationStatus.textContent = `❌ Verification failed: ${res.error}`;
            }
        }
    });

    elements.saveSettingsBtn.addEventListener('click', () => {
        state.systemPrompt = elements.systemPromptInput.value.trim();
        state.apiKey = elements.apiKeyInput ? elements.apiKeyInput.value.trim() : '';
        state.temperature = parseFloat(elements.temperatureSlider.value);
        state.ollamaHost = elements.ollamaHostInput.value.trim() || '/api/ollama';

        localStorage.setItem('localai_system_prompt', state.systemPrompt);
        localStorage.setItem('localai_api_key', state.apiKey);
        updateOnlineVerificationBadge();
        localStorage.setItem('localai_temperature', state.temperature.toString());
        localStorage.setItem('localai_ollama_host', state.ollamaHost);
        elements.settingsModal.style.display = 'none';
    });
}

function updateSendButtonState() {
    const hasText = elements.chatInput.value.trim().length > 0;
    const hasAttachments = state.attachedFiles && state.attachedFiles.length > 0;
    elements.sendBtn.disabled = (!hasText && !hasAttachments) || state.isGenerating || state.webllmLoading;
}

// ==========================================
// Local Storage Persistence
// ==========================================
function loadPreferences() {
    const savedTheme = localStorage.getItem('localai_theme') || 'dark';
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        elements.themeIcon.textContent = '🌙';
        elements.themeText.textContent = 'Dark Mode';
    }

    const savedPrompt = localStorage.getItem('localai_system_prompt');
    if (savedPrompt) state.systemPrompt = savedPrompt;

    const savedKey = localStorage.getItem('localai_api_key');
    if (savedKey) state.apiKey = savedKey;

    const savedTemp = localStorage.getItem('localai_temperature');
    if (savedTemp) state.temperature = parseFloat(savedTemp);

    const savedHost = localStorage.getItem('localai_ollama_host');
    if (savedHost) state.ollamaHost = savedHost;

    const savedWeb = localStorage.getItem('localai_web_search');
    if (savedWeb !== null) {
        state.webSearch = savedWeb === 'true';
        if (!state.webSearch && elements.webSearchToggleBtn) {
            elements.webSearchToggleBtn.classList.remove('active');
            elements.webSearchToggleBtn.querySelector('.web-label').textContent = '🌐 Live News: OFF';
        }
    }

    try {
        const savedChats = localStorage.getItem('localai_chats');
        if (savedChats) {
            state.chats = JSON.parse(savedChats);
        }
    } catch (e) {
        state.chats = [];
    }
}

function saveChats() {
    try {
        localStorage.setItem('localai_chats', JSON.stringify(state.chats));
    } catch (e) {
        console.warn("Storage full or unavailable", e);
    }
}

// Start Application
initApp();
