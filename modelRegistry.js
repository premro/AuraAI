/**
 * AuraAI Model Registry & Unified Capability Adapter
 * Manages model metadata, capability checking, and single abstraction for Cloud, WebLLM, and Ollama.
 */

const { log } = require('./logger');
const { buildSafeGroundedPrompt } = require('./promptSanitizer');
const { normalizeModelInput, normalizeText } = require('./textUtils');

const MODEL_CATALOG = {
    // Cloud / Frontier
    'gpt-4o-mini': {
        name: 'GPT-4o Mini',
        provider: 'openai',
        modelType: 'cloud',
        supportsText: true,
        supportsVision: true,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 128000,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    'gpt-4o': {
        name: 'GPT-4o',
        provider: 'openai',
        modelType: 'cloud',
        supportsText: true,
        supportsVision: true,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 128000,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    'claude-3-5-sonnet': {
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        modelType: 'cloud',
        supportsText: true,
        supportsVision: true,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 200000,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    'gemini-1.5-flash': {
        name: 'Gemini 1.5 Flash',
        provider: 'google',
        modelType: 'cloud',
        supportsText: true,
        supportsVision: true,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 1000000,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    'deepseek-chat': {
        name: 'DeepSeek V3',
        provider: 'deepseek',
        modelType: 'cloud',
        supportsText: true,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 64000,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    // Image Generation Engine
    'flux-diffusion': {
        name: 'Flux Diffusion Engine',
        provider: 'pollinations',
        modelType: 'image_generation',
        supportsText: false,
        supportsVision: false,
        supportsImageGeneration: true,
        supportsImages: true,
        contextWindow: 1024,
        supportsTools: false,
        supportsToolCalling: false,
        supportsStructuredOutput: false
    },
    // Local Ollama & WebLLM defaults
    'llama3.2': {
        name: 'Llama 3.2',
        provider: 'local',
        modelType: 'local',
        supportsText: true,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 8192,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    'qwen2.5': {
        name: 'Qwen 2.5',
        provider: 'local',
        modelType: 'local',
        supportsText: true,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 8192,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    'mistral': {
        name: 'Mistral',
        provider: 'local',
        modelType: 'local',
        supportsText: true,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 8192,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    'gemma2': {
        name: 'Gemma 2',
        provider: 'local',
        modelType: 'local',
        supportsText: true,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 8192,
        supportsTools: true,
        supportsToolCalling: true,
        supportsStructuredOutput: true
    },
    'llava': {
        name: 'LLaVA Vision',
        provider: 'local',
        modelType: 'local',
        supportsText: true,
        supportsVision: true,
        supportsImageGeneration: false,
        supportsImages: false,
        contextWindow: 4096,
        supportsTools: false,
        supportsToolCalling: false,
        supportsStructuredOutput: false
    }
};

function getModelMetadata(modelId) {
    if (!modelId) return MODEL_CATALOG['gpt-4o-mini'];
    const key = Object.keys(MODEL_CATALOG).find(k => modelId.toLowerCase().includes(k.toLowerCase()));
    return key ? MODEL_CATALOG[key] : MODEL_CATALOG['gpt-4o-mini'];
}

function checkCapability(modelId, capability) {
    const meta = getModelMetadata(modelId);
    if (capability === 'vision') return meta.supportsVision;
    if (capability === 'image_generation' || capability === 'images') return meta.supportsImageGeneration;
    if (capability === 'tools') return meta.supportsTools || meta.supportsToolCalling;
    if (capability === 'text') return meta.supportsText;
    return false;
}

// Unified Image Generation Adapter
function generateImage(prompt, context = '') {
    log('IMAGE GENERATION', `Generating image for prompt: "${prompt}"`, { context });
    let fullPrompt = normalizeText(prompt).trim();
    if (context && normalizeText(context).trim()) {
        fullPrompt = `${normalizeText(context).trim()}, ${fullPrompt}`;
    }
    const cleanPrompt = fullPrompt.replace(/[^\w\s,.-]/gi, ' ').trim();
    const encoded = encodeURIComponent(cleanPrompt);
    const imgUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true`;

    return {
        prompt: cleanPrompt,
        url: imgUrl,
        markdown: `### 🎨 Generated Image: *${cleanPrompt}*\n\n` +
                  `![${cleanPrompt}](${imgUrl})\n\n` +
                  `> **Prompt**: *"${cleanPrompt}"*\n` +
                  `> **Resolution**: 1024×1024 • Engine: Flux / Diffusion\n\n` +
                  `[📥 Download Full Resolution Image](${imgUrl})`
    };
}

module.exports = {
    MODEL_CATALOG,
    getModelMetadata,
    checkCapability,
    generateImage,
    normalizeModelInput
};
