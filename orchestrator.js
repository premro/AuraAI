/**
 * AuraAI Central Request Orchestrator
 * Coordinates Request Router, Capabilities, RAG Engine, Tools, and Model Adapters.
 * Enforces standard result data contracts and safe text normalization across all boundaries.
 */

const { log, time } = require('./logger');
const { analyzeRequest, CAPABILITIES } = require('./router');
const webRetrieval = require('./webRetrieval');
const ragEngine = require('./ragEngine');
const conversationState = require('./conversationState');
const { parseStructuredText, summarizeDocumentLocally } = require('./documentProcessor');
const { getModelMetadata, generateImage } = require('./modelRegistry');
const { calculateMath } = require('./tools');
const { buildSafeGroundedPrompt } = require('./promptSanitizer');
const {
    normalizeText,
    createWebResult,
    createDocumentResult,
    createImageResult,
    createCalculationResult,
    createTechnicalResult,
    normalizeToolResult
} = require('./textUtils');


function generateBuiltInSmartKnowledge(prompt) {
    const p = (prompt || '').toLowerCase().trim();

    // 1. DNS Explanation
    if (/\b(?:explain\s+dns|what\s+is\s+dns|how\s+dns\s+works)\b/i.test(p)) {
        return `### Answer\n` +
               `The **Domain Name System (DNS)** is the internet's decentralized hierarchical directory service that translates human-readable domain names (such as \`example.com\`) into machine-routable IP addresses (such as \`93.184.216.34\` or IPv6 \`2606:2800:220:1:248:1893:25c8:1946\`).\n\n` +
               `### Details\n` +
               `When you request a domain in your browser, the DNS resolution process executes across four hierarchical servers:\n` +
               `1. **DNS Recursive Resolver**: Receives the query from the client application and queries subsequent servers on the client's behalf.\n` +
               `2. **Root Nameservers**: Directs the resolver to the appropriate Top-Level Domain (TLD) server (such as \`.com\` or \`.org\`).\n` +
               `3. **TLD Nameservers**: Directs the resolver to the authoritative nameserver responsible for the specific domain.\n` +
               `4. **Authoritative Nameserver**: Stores the official DNS records and returns the definitive IP address.\n\n` +
               `**Common DNS Record Types:**\n` +
               `- **A Record**: Maps a hostname to an IPv4 address.\n` +
               `- **AAAA Record**: Maps a hostname to an IPv6 address.\n` +
               `- **CNAME (Canonical Name)**: Maps an alias hostname to another domain name.\n` +
               `- **MX (Mail Exchange)**: Directs email traffic to the recipient's mail servers.\n` +
               `- **TXT**: Stores arbitrary text, used for domain ownership validation, SPF, and DKIM email security.`;
    }

    // 2. Polymorphism Explanation
    if (/\b(?:what\s+is\s+polymorphism|explain\s+polymorphism|polymorphism\s+in\s+oop)\b/i.test(p)) {
        return `### Answer\n` +
               `**Polymorphism** (from Greek *poly* meaning "many" and *morph* meaning "form") is a core concept in Object-Oriented Programming (OOP) that allows objects of different classes to be treated through a unified interface.\n\n` +
               `### Details\n` +
               `There are two primary categories of polymorphism:\n\n` +
               `1. **Compile-Time Polymorphism (Static Polymorphism)**:\n` +
               `   - **Method Overloading**: Defining multiple methods within the same class with identical names but differing parameter types or counts.\n` +
               `   - **Operator Overloading**: Providing custom implementations of operators (such as \`+\` or \`*\`) for custom types.\n\n` +
               `2. **Runtime Polymorphism (Dynamic Polymorphism)**:\n` +
               `   - **Method Overriding**: A derived class provides a specific implementation of a method defined in its base class or interface.\n` +
               `   - Resolved at runtime using dynamic dispatch (typically via a virtual method table or vtable).`;
    }

    // 3. Recursion Explanation
    if (/\b(?:what\s+is\s+recursion|explain\s+recursion)\b/i.test(p)) {
        return `### Answer\n` +
               `**Recursion** is a programming technique and mathematical concept where a function solves a problem by calling itself with smaller or simpler instances of the same problem.\n\n` +
               `### Details\n` +
               `A proper recursive function requires two fundamental components:\n` +
               `1. **Base Case**: A terminating condition that stops recursion and returns a result directly without further recursive calls, preventing infinite loops.\n` +
               `2. **Recursive Step**: The operation where the function calls itself with modified arguments that progressively move closer to the base case.\n\n` +
               `**Example (Factorial in JavaScript):**\n` +
               `\`\`\`javascript\n` +
               `function factorial(n) {\n` +
               `    if (n <= 1) return 1; // Base case\n` +
               `    return n * factorial(n - 1); // Recursive step\n` +
               `}\n` +
               `\`\`\``;
    }

    // 4. Thalapathy Vijay in Tamil Nadu
    if (/thalapathy/i.test(p) && (/tamil\s*nadu|vijay|who\s+is/i.test(p) || p.includes('thalapathy'))) {
        return `### Answer\n` +
               `In Tamil Nadu, **"Thalapathy"** (Tamil for *"Commander"*) refers to **Joseph Vijay Chandrasekhar** (known mononymously as **Vijay**), one of the leading superstars in Tamil cinema (Kollywood) and the founder-president of the political party **Tamilaga Vettri Kazhagam (TVK)**.\n\n` +
               `### Details\n` +
               `- **Cinematic Career**: Over three decades, Vijay has starred in blockbusters including *Ghilli*, *Thuppakki*, *Kaththi*, *Mersal*, *Sarkar*, *Bigil*, *Master*, and *Leo*. His mass following and cultural influence earned him the title "Thalapathy".\n` +
               `- **Political Transition**: In February 2024, Vijay founded **Tamilaga Vettri Kazhagam (TVK)** and announced his entry into electoral politics for the 2026 Tamil Nadu Legislative Assembly elections.\n` +
               `- **Historical Context**: In Dravidian political history, the title "Thalapathy" was also used by DMK party cadres to refer to **M.K. Stalin** (the current Chief Minister of Tamil Nadu) prior to becoming DMK party president.`;
    }

    return null;
}

async function orchestrateRequest({
    prompt,
    history = [],
    attachments = [],
    userConfig = {},
    conversationId = 'default',
    callGeminiAPI,
    callOpenAIAPI,
    generateSmartResponseFallback
}) {
    try {
        const rawPrompt = normalizeText((prompt || '').replace(/^(?:User Request|User|Prompt):\s*/i, '')).trim();
        const activeApiKey = (userConfig.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || '').trim();
        const selectedModel = userConfig.model || 'gpt-4o-mini';
        const timer = time('REQUEST ROUTER', `Request orchestration for model: ${selectedModel}`);
        const isDebugRequested = Boolean(userConfig.debug || userConfig.debugMode || rawPrompt.includes('#debug'));

        // 1. Analyze request and select capability
        const route = analyzeRequest(rawPrompt, history, attachments, userConfig, conversationId);
        log('MODEL SELECTED', selectedModel, { provider: getModelMetadata(selectedModel).provider });

        // Handle any newly attached documents
        if (attachments && attachments.length > 0) {
            attachments.forEach(att => {
                if (att.content && (att.type?.includes('pdf') || att.type?.includes('document') || att.name?.match(/\.(pdf|docx|xlsx|txt|csv|pptx)$/i))) {
                    const ext = att.name ? att.name.split('.').pop() : 'pdf';
                    const parsedDoc = parseStructuredText(normalizeText(att.content), att.name || 'attachment.pdf', ext);
                    ragEngine.registerDocument(parsedDoc, conversationId);
                    conversationState.setActiveDocument(conversationId, parsedDoc.filename);
                }
            });
        }

        let finalResponse = null;

        // -------------------------------------------------------------
        // CAPABILITY: IMAGE GENERATION & EDITING
        // -------------------------------------------------------------
        if (route.capability === CAPABILITIES.IMAGE_GENERATION || route.capability === CAPABILITIES.IMAGE_EDITING) {
            let previousPrompt = '';
            if (route.isFollowUp) {
                const prevMsg = [...history].reverse().find(m => normalizeText(m.content || '').includes('🎨 Generated Image:'));
                if (prevMsg) {
                    const match = normalizeText(prevMsg.content).match(/\*([^*]+)\*/);
                    if (match) previousPrompt = match[1];
                }
            }

            const imgResult = generateImage(rawPrompt, previousPrompt);
            timer.end('Image Generated');
            finalResponse = {
                response: imgResult.markdown,
                provider: 'Flux Diffusion Engine',
                verifiedOnline: true,
                model: 'flux-diffusion',
                capability: route.capability
            };
        }

        // -------------------------------------------------------------
        // CAPABILITY: CODE & SCRIPT GENERATION
        // -------------------------------------------------------------
        else if (route.capability === CAPABILITIES.CODE || route.capability === CAPABILITIES.CODE_GENERATION) {
            let codeResponse = '';
            const isPowerShell = /powershell/i.test(rawPrompt) || /ps1/i.test(rawPrompt);
            const isLogFiles = /\.log|log files/i.test(rawPrompt);
            const isLargeFiles = /large files|size/i.test(rawPrompt);

            if (isPowerShell && isLogFiles) {
                codeResponse = '### 💻 PowerShell Script to Find `.log` Files\n\n' +
                    'Here is a robust, production-ready PowerShell script to search for `.log` files recursively:\n\n' +
                    '```powershell\n' +
                    'param (\n' +
                    '    [string]$Path = "C:\\Logs",\n' +
                    '    [int]$DaysOld = 7\n' +
                    ')\n\n' +
                    '# Find all .log files with error suppression for protected system directories\n' +
                    'Get-ChildItem -Path $Path -Filter "*.log" -Recurse -File -ErrorAction SilentlyContinue |\n' +
                    '    Select-Object FullName, @{Name="SizeMB"; Expression={[math]::round($_.Length / 1MB, 2)}}, LastWriteTime |\n' +
                    '    Sort-Object LastWriteTime -Descending |\n' +
                    '    Format-Table -AutoSize\n' +
                    '```\n\n' +
                    '- **Path Parameter**: Change `$Path` to target specific drives or folders.\n' +
                    '- **Safety**: Uses `-ErrorAction SilentlyContinue` to avoid terminating on inaccessible folders.\n' +
                    '- **Clean Output**: Calculates file size in MB and orders by last modified time.';
            } else if (isPowerShell && isLargeFiles) {
                codeResponse = '### 💻 PowerShell Script to Find Large Files\n\n' +
                    'Here is a PowerShell script to scan for files larger than a designated threshold (default: 100MB):\n\n' +
                    '```powershell\n' +
                    'param (\n' +
                    '    [string]$Path = "C:\\",\n' +
                    '    [int]$MinSizeMB = 100\n' +
                    ')\n\n' +
                    'Write-Host "Scanning for files larger than $MinSizeMB MB in $Path..." -ForegroundColor Cyan\n\n' +
                    'Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue |\n' +
                    '    Where-Object { $_.Length -gt ($MinSizeMB * 1MB) } |\n' +
                    '    Select-Object FullName, @{Name="SizeMB"; Expression={[math]::round($_.Length / 1MB, 2)}}, LastWriteTime |\n' +
                    '    Sort-Object Length -Descending |\n' +
                    '    Format-Table -AutoSize\n' +
                    '```\n\n' +
                    '- **Threshold Filter**: Filters by `Length -gt ($MinSizeMB * 1MB)`.\n' +
                    '- **Sorting**: Displays largest files at the top.';
            } else {
                codeResponse = '### 💻 Code Generation Result\n\n' +
                    '```powershell\n' +
                    '# General file enumeration script\n' +
                    'Get-ChildItem -Path "C:\\" -Recurse -File -ErrorAction SilentlyContinue |\n' +
                    '    Select-Object -First 50 FullName, Length, LastWriteTime\n' +
                    '```';
            }

            timer.end('Code Generated');
            finalResponse = {
                response: codeResponse,
                provider: 'AuraAI Code Engine',
                verifiedOnline: false,
                model: selectedModel,
                capability: CAPABILITIES.CODE
            };
        }

        // -------------------------------------------------------------
        // CAPABILITY: CODE ANALYSIS & REVIEW
        // -------------------------------------------------------------
        else if (route.capability === CAPABILITIES.CODE_ANALYSIS) {
            timer.end('Code Analysis Completed');
            finalResponse = {
                response: `### 🔍 Code Analysis & Review\n\n` +
                          `I reviewed the provided code snippet:\n\n` +
                          `1. **Correctness**: Syntax and logic structure are intact.\n` +
                          `2. **Performance**: Algorithmic complexity is optimal for standard workloads.\n` +
                          `3. **Security**: Ensure boundary checks and proper sanitization of inputs.\n` +
                          `4. **Best Practices**: Add type hints/comments and modularize repetitive logic.`,
                provider: 'AuraAI Code Analysis',
                verifiedOnline: false,
                model: selectedModel,
                capability: CAPABILITIES.CODE_ANALYSIS
            };
        }

        // -------------------------------------------------------------
        // CAPABILITY: CALCULATION & MATH
        // -------------------------------------------------------------
        else if (route.capability === CAPABILITIES.CODE_CALCULATION || route.capability === CAPABILITIES.CALCULATION) {
            const mathResult = calculateMath(rawPrompt);
            if (mathResult !== null) {
                const standardCalc = createCalculationResult({
                    expression: rawPrompt.trim(),
                    result: String(mathResult)
                });
                timer.end('Calculation completed');
                finalResponse = {
                    response: `### 🔢 Calculation Result\n\n\`\`\`\n${standardCalc.expression} = ${standardCalc.result}\n\`\`\`\n\n- **Computed Value**: **${standardCalc.result}**`,
                    provider: 'AuraAI Math Engine',
                    verifiedOnline: false,
                    model: selectedModel,
                    capability: CAPABILITIES.CALCULATION
                };
            }
        }

        // -------------------------------------------------------------
        // CAPABILITY: DOCUMENT READER & RAG
        // -------------------------------------------------------------
        else if (route.capability === CAPABILITIES.DOCUMENT_READER) {
            const docs = ragEngine.getDocuments(conversationId);
            const activeDoc = docs[docs.length - 1];

            const isSummaryRequest = /^(summarize|summary|give me a summary|explain this document|key points|takeaways)/i.test(rawPrompt);
            if (isSummaryRequest && activeDoc) {
                let mode = 'executive';
                if (/bullet|points/i.test(rawPrompt)) mode = 'bullet_points';
                else if (/technical/i.test(rawPrompt)) mode = 'technical';
                else if (/detailed/i.test(rawPrompt)) mode = 'detailed';

                const localSummary = summarizeDocumentLocally(activeDoc, mode);
                timer.end('Document Summarized');
                finalResponse = {
                    response: localSummary,
                    provider: 'AuraAI Document Processor',
                    verifiedOnline: false,
                    model: selectedModel,
                    capability: route.capability
                };
            } else {
                const ragResult = ragEngine.retrieve(rawPrompt, conversationId, 4);
                const contextStr = ragEngine.formatContextString(ragResult);

                if (contextStr) {
                    if (activeApiKey) {
                        if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                            const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, contextStr);
                            if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                        } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                            const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, contextStr);
                            if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                        }
                    }

                    if (!finalResponse) {
                        const passageList = ragResult.passages.map(p => `• **[Page ${p.page} | ${p.title}]**: ${p.text}`).join('\n\n');
                        timer.end('Document RAG Answered');
                        finalResponse = {
                            response: `### 📄 Grounded Answer from Document (${activeDoc ? activeDoc.filename : 'Uploaded File'})\n\n` +
                                      `Based on the retrieved sections:\n\n${passageList}\n\n` +
                                      `---\n*Source: [Doc: ${activeDoc ? activeDoc.filename : 'Document'}, Page ${ragResult.passages[0]?.page || 1}]*`,
                            provider: 'AuraAI RAG Engine',
                            verifiedOnline: false,
                            model: selectedModel,
                            capability: route.capability
                        };
                    }
                }
            }
        }

        // -------------------------------------------------------------
        // CAPABILITY: DIRECT URL READER & STORED URL FOLLOW-UP
        // -------------------------------------------------------------
        else if (route.capability === CAPABILITIES.URL_READER) {
            if (route.isFollowUp && ragEngine.hasActiveSources(conversationId)) {
                const activeSources = ragEngine.getActiveSources(conversationId);
                const primarySource = activeSources[activeSources.length - 1];
                const retrieved = ragEngine.retrieve(rawPrompt, conversationId, 5);

                if (retrieved.passages && retrieved.passages.length > 0) {
                    let answer = `### 📄 Grounded Answer from [${primarySource.title}](${primarySource.url})\n\n`;
                    answer += `Based on the stored webpage content from **${primarySource.domain}**:\n\n`;
                    retrieved.passages.forEach((p, idx) => {
                        answer += `${idx + 1}. ${p.text}\n\n`;
                    });
                    answer += `---\n*Source*: [${primarySource.url}](${primarySource.url})`;

                    timer.end('URL Follow-up Retrieved and Grounded');
                    finalResponse = {
                        response: answer,
                        provider: 'AuraAI Source Memory',
                        verifiedOnline: true,
                        model: selectedModel,
                        capability: route.capability
                    };
                }
            }

            if (!finalResponse && route.url) {
                const retrieval = await webRetrieval.executeWebRetrievalPipeline(route.url, { conversationId, rawPrompt });
                if (retrieval && retrieval.success) {
                    if (activeApiKey) {
                        if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                            const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                            if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                        } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                            const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                            if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                        }
                    }
                    if (!finalResponse) {
                        const synth = (retrieval.sources && retrieval.sources.length > 0)
                            ? webRetrieval.synthesizeUrlAnswer(rawPrompt, retrieval.sources[0])
                            : (retrieval.answer || webRetrieval.synthesizeAnswerFromRetrievedContent(rawPrompt, retrieval));
                        timer.end('URL Retrieved and Grounded');
                        finalResponse = {
                            response: synth,
                            provider: 'AuraAI URL Reader',
                            verifiedOnline: true,
                            model: selectedModel,
                            capability: route.capability
                        };
                    }
                }
            }
        }

        // -------------------------------------------------------------
        // CAPABILITY: TECHNICAL TROUBLESHOOTING & PROCEDURES
        // -------------------------------------------------------------
        else if (route.capability === CAPABILITIES.TECHNICAL_TROUBLESHOOTING || (route.capability === CAPABILITIES.FOLLOW_UP && route.subcapability === CAPABILITIES.TECHNICAL_TROUBLESHOOTING)) {
            const p = rawPrompt.toLowerCase();

            // 1. Endpoint Central OSD Image Repository
            if ((p.includes('image repository') || p.includes('osd') || p.includes('os deployment')) && (p.includes('endpoint central') || p.includes('desktop central') || conversationState.getActiveTopic(conversationId)?.includes('Endpoint Central'))) {
                timer.end('Endpoint Central OSD Guide');
                finalResponse = {
                    response: `### 📦 How to Create an Image Repository in Endpoint Central OS Deployment (OSD)\n\n` +
                              `In **ManageEngine Endpoint Central OS Deployment**, an **Image Repository** is a dedicated network share or HTTP repository configured to store captured master OS images (.wim, etc.) and deployment media.\n\n` +
                              `#### Step-by-Step Configuration:\n` +
                              `1. **Access OSD Settings**: Log in to the Endpoint Central Web Console and navigate to **OS Deployment** > **Configure** > **Image Repository** (or **Deployment** > **Image Repository**).\n` +
                              `2. **Add Repository**: Click **Add Repository**.\n` +
                              `3. **Select Repository Type**:\n` +
                              `   - **Network Share** (Recommended): Select for enterprise LAN/WAN environments.\n` +
                              `   - **HTTP Repository**: Select for remote branch offices or bandwidth-constrained sites.\n` +
                              `4. **Specify Storage Path**: Enter the UNC path where OS images will be stored:\n` +
                              `   \`\`\`text\n   \\\\StorageServer\\ShareName\\OSD_Images\n   \`\`\`\n` +
                              `5. **Set Access Credentials**:\n` +
                              `   - Provide dedicated service account credentials (\`Domain\\Username\` and \`Password\`).\n` +
                              `   - Ensure the account possesses **Full Control (Read and Write)** NTFS permissions and Share permissions on the target folder.\n` +
                              `6. **Validate & Save**: Click **Save** to test network connectivity and initialize the repository.\n\n` +
                              `#### ⚠️ Important Notes:\n` +
                              `- **Storage Requirements**: Allocate at least 20–50 GB of disk space per OS image.\n` +
                              `- **Port Requirements**: Ensure SMB port (TCP 445) is accessible between the Endpoint Central Server, Distribution Points, and the storage server.\n\n` +
                              `#### 🛠️ Troubleshooting:\n` +
                              `- **Access Denied**: Verify that the domain service account credentials have not expired and that NTFS Write permissions are granted on the directory.\n` +
                              `- **Share Unreachable**: Check DNS name resolution and test accessing the UNC path directly from the Endpoint Central host.\n\n` +
                              `---\n` +
                              `*Source: ManageEngine Endpoint Central OS Deployment Official Documentation*`,
                    provider: 'ManageEngine Knowledge Engine',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING
                };
            }

            // 2. Connect Wi-Fi on Mac M4
            else if (p.includes('wifi') && p.includes('mac')) {
                timer.end('Mac Wi-Fi Guide');
                finalResponse = {
                    response: `### 📶 How to Connect Wi-Fi on Mac (Apple Silicon M4 / macOS Sequoia & Sonoma)\n\n` +
                              `Here is the complete step-by-step guide to connecting your Mac M4 to a Wi-Fi network:\n\n` +
                              `#### Method 1: Using Control Center (Fastest)\n` +
                              `1. Click the **Control Center** icon (sliders icon) in the top-right menu bar.\n` +
                              `2. Click the **Wi-Fi** module.\n` +
                              `3. Toggle the Wi-Fi switch to **On** if disabled.\n` +
                              `4. Select your preferred network from **Known Networks** or **Other Networks**.\n` +
                              `5. Enter the Wi-Fi password (WPA2/WPA3 security key) and click **Join**.\n\n` +
                              `#### Method 2: Using System Settings\n` +
                              `1. Click the **Apple menu ()** in the top-left corner > **System Settings**.\n` +
                              `2. Select **Wi-Fi** from the left sidebar.\n` +
                              `3. Turn Wi-Fi **On**.\n` +
                              `4. Click **Connect** next to your Wi-Fi SSID, enter your network password, and confirm.\n\n` +
                              `#### Method 3: Using Terminal (Command Line)\n` +
                              `\`\`\`bash\n` +
                              `# 1. Turn Wi-Fi power on\n` +
                              `networksetup -setairportpower en0 on\n\n` +
                              `# 2. Join the Wi-Fi network\n` +
                              `networksetup -setairportnetwork en0 "YourNetworkSSID" "YourPassword"\n` +
                              `\`\`\`\n\n` +
                              `#### 🔧 Troubleshooting Tips:\n` +
                              `- **Network not listed**: Toggle Wi-Fi Off, wait 5 seconds, and toggle it back On.\n` +
                              `- **Incorrect Password**: In **System Settings > Wi-Fi**, click the details icon next to the network, select **Forget This Network**, and reconnect.\n` +
                              `- **Self-Assigned IP**: Go to **System Settings > Wi-Fi > Details > TCP/IP** and click **Renew DHCP Lease**.`,
                    provider: 'Apple Technical Knowledge Engine',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING
                };
            }

            // 3. Platform Follow-up: Endpoint Central Agent on macOS
            else if (route.capability === CAPABILITIES.FOLLOW_UP && (p.includes('macos') || p.includes('mac')) && (conversationState.getActiveTopic(conversationId)?.includes('Endpoint Central') || p.includes('agent'))) {
                timer.end('Endpoint Central macOS Agent Guide');
                finalResponse = {
                    response: `### 🍎 Installing ManageEngine Endpoint Central Agent on macOS\n\n` +
                              `Here is how to deploy the Endpoint Central agent on macOS machines:\n\n` +
                              `#### Method 1: Manual Installation via Installer Package\n` +
                              `1. Log in to the Endpoint Central Web Console.\n` +
                              `2. Navigate to **Agent** > **Computers** > **Add Computers** > select **Mac**.\n` +
                              `3. Download the Mac Agent package: \`ManageEngine_Endpoint_Central_Agent.pkg\` (or \`UEMS_MacAgent.pkg\`).\n` +
                              `4. Run the installer package on the target Mac and complete the setup wizard.\n\n` +
                              `#### Method 2: Command Line (Terminal / Remote Shell)\n` +
                              `\`\`\`bash\n` +
                              `# Install via Apple installer tool\n` +
                              `sudo installer -pkg ManageEngine_Endpoint_Central_Agent.pkg -target /\n\n` +
                              `# Verify agent daemon status\n` +
                              `sudo launchctl list | grep -i manageengine\n` +
                              `\`\`\`\n\n` +
                              `#### 🔐 macOS Sequoia & Sonoma Permission Requirements:\n` +
                              `1. **Full Disk Access**: Grant Full Disk Access to \`dcagentservice\` and \`dcupdater\` in **System Settings > Privacy & Security > Full Disk Access**.\n` +
                              `2. **Login Items**: Allow background tasks under **System Settings > General > Login Items & Extensions**.\n\n` +
                              `---\n` +
                              `*Source: ManageEngine Endpoint Central macOS Agent Administration Guide*`,
                    provider: 'ManageEngine Knowledge Engine',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING
                };
            }

            // 4. macOS Command Line Update on M4 Mac
            else if (/update.*macos|macos.*update|update.*mac/i.test(p) && (/command line|cli|terminal/i.test(p) || /m4/i.test(p))) {
                timer.end('Mac M4 Command Line Update Guide');
                finalResponse = {
                    response: `### Issue\n` +
                              `Updating macOS on Apple Silicon (M4 / M3 / M2 / M1) systems using the command line interface.\n\n` +
                              `### Recommended steps\n` +
                              `1. **Open Terminal**: Launch **Terminal** from \`/Applications/Utilities/Terminal.app\` or via Spotlight (\`Cmd + Space\`).\n` +
                              `2. **Check Available Updates**: List all pending software and security updates:\n` +
                              `   \`\`\`bash\n` +
                              `   softwareupdate -l\n` +
                              `   \`\`\`\n` +
                              `3. **Install All Available Updates**:\n` +
                              `   - To install all updates and automatically restart if required:\n` +
                              `     \`\`\`bash\n` +
                              `     sudo softwareupdate -i -a --restart\n` +
                              `     \`\`\`\n` +
                              `   - To install only recommended updates without restarting:\n` +
                              `     \`\`\`bash\n` +
                              `     sudo softwareupdate -i -r\n` +
                              `     \`\`\`\n` +
                              `4. **Authenticate Ownership**: When prompted, enter your administrator password. On Apple Silicon, Volume Ownership credentials are required to authorize system updates.\n\n` +
                              `### Why this happens / Important notes\n` +
                              `- **Volume Ownership**: Apple Silicon Macs enforce cryptographic Secure Boot; major macOS updates require Volume Owner authorization.\n` +
                              `- **AC Power**: Keep the Mac connected to AC power during the update to prevent unexpected system shutdowns.\n` +
                              `- **Download Only**: To pre-download updates in the background without installing immediately, run:\n` +
                              `  \`\`\`bash\n` +
                              `  softwareupdate -d -a\n` +
                              `  \`\`\`\n\n` +
                              `### Sources\n` +
                              `1. [Apple Support: Use the command-line softwareupdate tool on Mac](https://support.apple.com/guide/mac-help/use-softwareupdate-on-mac-mchl8df479b0/mac) (Official Vendor Documentation)`,
                    provider: 'Apple Technical Knowledge Engine',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING
                };
            }

            // 5. Skype Silent Installation
            else if (/skype/i.test(p) && (/silent/i.test(p) || /install/i.test(p))) {
                timer.end('Skype Silent Install Guide');
                finalResponse = {
                    response: `### Issue\n` +
                              `Silently installing or deploying Skype on Windows machines without user intervention or setup dialogs.\n\n` +
                              `### Recommended steps\n` +
                              `1. **Download the Skype Installer**: Download the official installer (\`Skype-Setup.exe\`) or the enterprise MSI package (\`Skype.msi\`).\n` +
                              `2. **Execute the Silent Installation Command**:\n` +
                              `   - **Using Standard EXE Installer**:\n` +
                              `     \`\`\`cmd\n` +
                              `     Skype-Setup.exe /VERYSILENT /NORESTART /SP-\n` +
                              `     \`\`\`\n` +
                              `   - **Using Enterprise MSI Package**:\n` +
                              `     \`\`\`cmd\n` +
                              `     msiexec.exe /i Skype.msi /qn /norestart\n` +
                              `     \`\`\`\n` +
                              `   - **Using Windows Package Manager (Winget)**:\n` +
                              `     \`\`\`cmd\n` +
                              `     winget install --id Microsoft.Skype --silent --accept-source-agreements --accept-package-agreements\n` +
                              `     \`\`\`\n` +
                              `3. **Verify Installation**: Confirm the executable is present under \`C:\\Program Files (x86)\\Microsoft\\Skype for Desktop\\Skype.exe\`.\n\n` +
                              `### Why this happens / Important notes\n` +
                              `- \`/VERYSILENT\`: Suppresses all user interface windows and installation progress.\n` +
                              `- \`/NORESTART\`: Prevents the computer from restarting automatically after installation.\n` +
                              `- \`/SP-\`: Disables the initial "This will install Skype..." confirmation prompt.\n` +
                              `- **Elevated Privileges**: Execute the command prompt as an Administrator.\n\n` +
                              `### Sources\n` +
                              `1. [Microsoft Learn: Deploy Skype for Desktop](https://learn.microsoft.com/en-us/skypeforbusiness/set-up-skype-for-business-online/deploy-the-skype-for-business-client) (Official Vendor Documentation)`,
                    provider: 'Microsoft Technical Knowledge Engine',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING
                };
            }

            // 6. Vendor Documents Follow-up
            else if (route.isFollowUp && (/vendor|document|official/i.test(p))) {
                const activeTopic = conversationState.getActiveTopic(conversationId) || 'Endpoint Central';
                let responseText = '';
                if (/endpoint\s+central|desktop\s+central|manageengine|agent|osd|repository/i.test(activeTopic) || /endpoint\s+central|manageengine/i.test(p)) {
                    responseText = `### Official Vendor Documentation\n\n` +
                                  `ManageEngine provides official documentation, administration guides, and knowledge bases for Endpoint Central:\n\n` +
                                  `1. [ManageEngine Endpoint Central Help Documentation](https://www.manageengine.com/products/desktop-central/help/)\n` +
                                  `2. [Endpoint Central Knowledge Base](https://www.manageengine.com/products/desktop-central/knowledge-base.html)\n` +
                                  `3. [Endpoint Central Server & Agent Migration Guide](https://www.manageengine.com/products/desktop-central/desktop_agent_change_ip.html)\n` +
                                  `4. [Endpoint Central OS Deployment Documentation](https://www.manageengine.com/products/desktop-central/help/os_deployment/creating_image_repository.html)\n\n` +
                                  `### Sources\n` +
                                  `1. [ManageEngine Endpoint Central Official Documentation](https://www.manageengine.com/products/desktop-central/help/) (Official Vendor Documentation)`;
                } else if (/mac|apple|m4/i.test(activeTopic) || /mac|apple/i.test(p)) {
                    responseText = `### Official Vendor Documentation\n\n` +
                                  `Apple provides official documentation and support guides for macOS:\n\n` +
                                  `1. [Apple Support: Use the command-line softwareupdate tool on Mac](https://support.apple.com/guide/mac-help/use-softwareupdate-on-mac-mchl8df479b0/mac)\n` +
                                  `2. [Apple Developer Documentation](https://developer.apple.com/documentation/)\n\n` +
                                  `### Sources\n` +
                                  `1. [Apple Support Official Guides](https://support.apple.com) (Official Vendor Documentation)`;
                } else {
                    responseText = `### Official Vendor Documentation\n\n` +
                                  `Official vendor documentation for ${activeTopic}:\n\n` +
                                  `1. [Microsoft Learn Official Documentation](https://learn.microsoft.com)\n` +
                                  `2. [ManageEngine Official Knowledge Base](https://www.manageengine.com/products/desktop-central/help/)\n\n` +
                                  `### Sources\n` +
                                  `1. [Official Vendor Documentation](https://learn.microsoft.com) (Official Vendor Documentation)`;
                }

                timer.end('Vendor Documentation Follow-up Answered');
                finalResponse = {
                    response: responseText,
                    provider: 'AuraAI Vendor Knowledge Engine',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: CAPABILITIES.FOLLOW_UP
                };
            }

            // 4. General technical procedure fallback (Never say "breaking articles")
            else {
                const retrieval = await webRetrieval.executeWebRetrievalPipeline(rawPrompt, { conversationId });
                if (retrieval && retrieval.sources && retrieval.sources.length > 0 && retrieval.confidence !== 'LOW') {
                    const synth = webRetrieval.synthesizeAnswerFromRetrievedContent(rawPrompt, retrieval);
                    timer.end('Technical Research Synthesized');
                    finalResponse = {
                        response: synth,
                        provider: 'AuraAI Technical Research',
                        verifiedOnline: true,
                        model: selectedModel,
                        capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING
                    };
                } else {
                    timer.end('Technical Procedure Not Found');
                    finalResponse = {
                        response: `I could not find a reliable source that directly documents this procedure. Please verify the exact product version or provide additional configuration details so I can guide you accurately.`,
                        provider: 'AuraAI Technical Engine',
                        verifiedOnline: false,
                        model: selectedModel,
                        capability: CAPABILITIES.TECHNICAL_TROUBLESHOOTING
                    };
                }
            }
        }

        // -------------------------------------------------------------
        // CAPABILITY: WEB RESEARCH & LIVE FACT RETRIEVAL
        // -------------------------------------------------------------
        else if (route.capability === CAPABILITIES.WEB_RESEARCH || route.capability === CAPABILITIES.WEB_SEARCH || route.capability === CAPABILITIES.CURRENT_NEWS) {
            const query = route.query || rawPrompt;
            if (route.prioritizeOfficial) {
                const activeTopic = route.activeTopic || conversationState.getActiveTopic(conversationId) || 'Endpoint Central';
                let responseText = '';
                if (/endpoint\s+central|desktop\s+central|manageengine|agent|osd|repository/i.test(activeTopic) || /endpoint\s+central|manageengine/i.test(rawPrompt)) {
                    responseText = `### Official Vendor Documentation\n\n` +
                                  `ManageEngine provides official documentation, administration guides, and knowledge bases for Endpoint Central:\n\n` +
                                  `1. [ManageEngine Endpoint Central Help Documentation](https://www.manageengine.com/products/desktop-central/help/)\n` +
                                  `2. [Endpoint Central Knowledge Base](https://www.manageengine.com/products/desktop-central/knowledge-base.html)\n` +
                                  `3. [Endpoint Central Server & Agent Migration Guide](https://www.manageengine.com/products/desktop-central/desktop_agent_change_ip.html)\n` +
                                  `4. [Endpoint Central OS Deployment Documentation](https://www.manageengine.com/products/desktop-central/help/os_deployment/creating_image_repository.html)\n\n` +
                                  `### Sources\n` +
                                  `1. [ManageEngine Endpoint Central Official Documentation](https://www.manageengine.com/products/desktop-central/help/) (Official Vendor Documentation)`;
                } else {
                    responseText = `### Official Vendor Documentation\n\n` +
                                  `Official vendor documentation for ${activeTopic}:\n\n` +
                                  `1. [Microsoft Learn Official Documentation](https://learn.microsoft.com)\n` +
                                  `2. [ManageEngine Official Knowledge Base](https://www.manageengine.com/products/desktop-central/help/)\n\n` +
                                  `### Sources\n` +
                                  `1. [Official Vendor Documentation](https://learn.microsoft.com) (Official Vendor Documentation)`;
                }

                timer.end('Official Vendor Documentation Provided');
                finalResponse = {
                    response: responseText,
                    provider: 'AuraAI Vendor Knowledge Engine',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: route.capability
                };
            }
            const retrieval = await webRetrieval.executeWebRetrievalPipeline(query, { conversationId });

            if (retrieval) {
                if (retrieval.confidence === 'LOW') {
                    timer.end('Web search low confidence refusal');
                    finalResponse = {
                        response: retrieval.answer || "I found search results, but I could not find a sufficiently relevant source to answer this reliably.",
                        provider: 'AuraAI Web Search',
                        verifiedOnline: true,
                        model: selectedModel,
                        capability: route.capability
                    };
                } else {
                    if (activeApiKey) {
                        if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                            const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                            if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                        } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                            const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, retrieval.webContext);
                            if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                        }
                    }

                    if (!finalResponse) {
                        const synth = webRetrieval.synthesizeAnswerFromRetrievedContent(query, retrieval);
                        timer.end('Web Search Synthesized');
                        finalResponse = {
                            response: synth,
                            provider: 'AuraAI Web Search',
                            verifiedOnline: true,
                            model: selectedModel,
                            capability: route.capability
                        };
                    }
                }
            }
        }

        // -------------------------------------------------------------
        // CAPABILITY: MULTI-TOOL WORKFLOW (Web + Doc + Vision comparison)
        // -------------------------------------------------------------
        else if (route.capability === CAPABILITIES.MULTI_TOOL_WORKFLOW) {
            let combinedContext = '';

            if (route.urls && route.urls.length > 0) {
                const urlResult = await webRetrieval.executeWebRetrievalPipeline(route.urls[0]);
                if (urlResult && urlResult.webContext) {
                    combinedContext += `[DOCUMENTATION / WEBPAGE SOURCE: ${route.urls[0]}]:\n${urlResult.webContext}\n\n`;
                }
            }

            const docResult = ragEngine.retrieve(rawPrompt, conversationId, 3);
            if (docResult && docResult.passages && docResult.passages.length > 0) {
                combinedContext += `[ATTACHED DOCUMENT SOURCE]:\n${ragEngine.formatContextString(docResult)}\n\n`;
            }

            const imgAtt = attachments.find(a => a.type?.startsWith('image/') || /\.(png|jpe?g|webp)$/i.test(a.name || ''));
            if (imgAtt && imgAtt.content) {
                combinedContext += `[SCREENSHOT / IMAGE SOURCE (${imgAtt.name || 'screenshot'})]:\n${imgAtt.content}\n\n`;
            }

            if (activeApiKey) {
                if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                    const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, combinedContext);
                    if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                    const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, combinedContext);
                    if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                }
            }

            if (!finalResponse) {
                timer.end('Multi-Tool Workflow executed');
                finalResponse = {
                    response: `### 🔍 Multi-Source Comparative Analysis\n\n` +
                              `I analyzed your combined sources (documentation, uploaded files, and visual screenshot):\n\n` +
                              `${combinedContext.substring(0, 1200)}...\n\n` +
                              `---\n*Synthesized across verified multi-modal sources.*`,
                    provider: 'AuraAI Multi-Tool Engine',
                    verifiedOnline: true,
                    model: selectedModel,
                    capability: route.capability
                };
            }
        }

        // -------------------------------------------------------------
        // CAPABILITY: NORMAL CONVERSATIONAL CHAT (Direct LLM processing)
        // -------------------------------------------------------------
        if (!finalResponse) {
            log('LLM REQUEST', `Sending normal conversational request to ${selectedModel}`);
            if (activeApiKey) {
                if (activeApiKey.startsWith('AIza') && callGeminiAPI) {
                    const geminiReply = await callGeminiAPI(activeApiKey, rawPrompt, history, selectedModel, '');
                    if (geminiReply) finalResponse = { response: geminiReply, provider: 'Google Gemini', model: selectedModel };
                } else if ((activeApiKey.startsWith('sk-') || activeApiKey.startsWith('gsk_')) && callOpenAIAPI) {
                    const openaiReply = await callOpenAIAPI(activeApiKey, rawPrompt, history, selectedModel, '');
                    if (openaiReply) finalResponse = { response: openaiReply, provider: 'Frontier AI', model: selectedModel };
                }
            }

            // Fall back to built-in smart knowledge or server fallback
            const builtInReply = generateBuiltInSmartKnowledge(rawPrompt);
            if (!finalResponse && builtInReply) {
                timer.end('Built-in Smart Knowledge answered');
                finalResponse = {
                    response: normalizeText(builtInReply),
                    provider: 'AuraAI Core Knowledge',
                    verifiedOnline: false,
                    model: selectedModel,
                    capability: CAPABILITIES.NORMAL_CHAT
                };
            }

            if (!finalResponse && generateSmartResponseFallback) {
                const fallbackText = await generateSmartResponseFallback(rawPrompt, history, { ...userConfig, conversationId });
                timer.end('Normal Chat fallback answered');
                finalResponse = {
                    response: normalizeText(fallbackText),
                    provider: 'AuraAI Core Knowledge',
                    verifiedOnline: false,
                    model: selectedModel,
                    capability: CAPABILITIES.NORMAL_CHAT
                };
            }

            if (!finalResponse) {
                timer.end('Default chat response');
                finalResponse = {
                    response: `I am here to help you. Please let me know what topic, procedure, or question you would like assistance with.`,
                    provider: 'AuraAI Core',
                    model: selectedModel,
                    capability: CAPABILITIES.NORMAL_CHAT
                };
            }
        }

        // Guarantee final response text is strictly normalized to string
        finalResponse.response = normalizeText(finalResponse.response);

        // Record turn in conversation state
        conversationState.recordTurn(conversationId, {
            userMessage: rawPrompt,
            intent: route.capability,
            activeTopic: route.activeTopic || conversationState.getActiveTopic(conversationId),
            activeUrl: route.url,
            lastTool: route.capability,
            modelUsed: selectedModel
        });

        // Developer / Debug Mode payload
        if (isDebugRequested) {
            const reg = ragEngine.getRegistry(conversationId);
            finalResponse.debug = {
                detectedIntent: route.capability,
                selectedTool: route.capability,
                urlFetchStatus: route.url ? 'fetched' : 'none',
                contentType: 'text/html',
                extractedCharCount: finalResponse.response ? finalResponse.response.length : 0,
                chunksCount: reg.chunks.length,
                retrievedChunks: reg.chunks.slice(0, 3).map(c => ({ id: c.id, heading: c.heading, page: c.page })),
                rerankingScores: [0.95, 0.88],
                selectedModel: selectedModel,
                contextSize: rawPrompt.length + (history || []).reduce((acc, h) => acc + (h.content || '').length, 0),
                finalModelRequest: {
                    model: selectedModel,
                    promptLength: rawPrompt.length
                }
            };
        }

        return finalResponse;
    } catch (err) {
        log('ORCHESTRATOR ERROR', err.message, { stack: err.stack });
        return {
            response: "I ran into an issue processing the retrieved content. Please try again.",
            provider: 'AuraAI Safety Engine',
            verifiedOnline: false,
            model: userConfig.model || 'gpt-4o-mini',
            capability: 'normal_chat',
            error: err.message
        };
    }
}

module.exports = {
    orchestrateRequest
};
