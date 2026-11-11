/**
 * AuraAI Conversation State & Memory Context Manager
 * Maintains short-term conversation context per conversationId:
 * - currentTopic (alias: activeTopic)
 * - previousIntent (alias: lastIntent)
 * - previousEntities (alias: activeEntities)
 * - previousSources (array of sources retrieved in earlier turns)
 * - previousTool (alias: lastTool)
 * - previousImage (alias: lastGeneratedImage)
 * - previousDocument (alias: activeDocument)
 * - turns history
 */

const { log } = require('./logger');
const { normalizeText } = require('./textUtils');

class ConversationStateManager {
    constructor() {
        this.states = new Map();
    }

    getState(conversationId = 'default') {
        if (!this.states.has(conversationId)) {
            this.states.set(conversationId, {
                conversationId,
                currentTopic: null,
                activeTopic: null,
                previousIntent: null,
                lastIntent: null,
                previousEntities: [],
                activeEntities: [],
                previousSources: [],
                previousTool: null,
                previousImage: null,
                lastGeneratedImage: null,
                previousDocument: null,
                activeDocument: null,
                activeUrl: null,
                lastQuery: null,
                turns: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }
        return this.states.get(conversationId);
    }

    getContextObject(conversationId = 'default') {
        const state = this.getState(conversationId);
        return {
            currentTopic: state.currentTopic || state.activeTopic,
            previousIntent: state.previousIntent || state.lastIntent,
            previousEntities: state.previousEntities || state.activeEntities || [],
            previousSources: state.previousSources || [],
            previousTool: state.previousTool,
            previousImage: state.previousImage || state.lastGeneratedImage,
            previousDocument: state.previousDocument || state.activeDocument,
            activeUrl: state.activeUrl
        };
    }

    recordTurn(conversationId = 'default', turnData) {
        const state = this.getState(conversationId);
        state.updatedAt = Date.now();

        const turn = {
            id: 'turn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            timestamp: Date.now(),
            userMessage: normalizeText(turnData.userMessage || ''),
            intent: turnData.intent || state.previousIntent || 'NORMAL_CHAT',
            activeTopic: turnData.activeTopic || state.currentTopic || state.activeTopic,
            activeUrl: turnData.activeUrl || state.activeUrl,
            activeDocument: turnData.activeDocument || state.previousDocument,
            modelUsed: turnData.modelUsed || 'aura-core',
            retrievedSourcesCount: turnData.retrievedSourcesCount || 0
        };

        if (turnData.activeTopic) {
            state.currentTopic = turnData.activeTopic;
            state.activeTopic = turnData.activeTopic;
        }
        if (turnData.activeUrl) {
            state.activeUrl = turnData.activeUrl;
        }
        if (turnData.activeDocument) {
            state.previousDocument = turnData.activeDocument;
            state.activeDocument = turnData.activeDocument;
        }
        if (turnData.activeEntities && turnData.activeEntities.length > 0) {
            state.previousEntities = Array.from(new Set([...state.previousEntities, ...turnData.activeEntities]));
            state.activeEntities = state.previousEntities;
        }
        if (turnData.lastGeneratedImage) {
            state.previousImage = turnData.lastGeneratedImage;
            state.lastGeneratedImage = turnData.lastGeneratedImage;
        }
        if (turnData.lastTool) {
            state.previousTool = turnData.lastTool;
        }
        if (turnData.sources && Array.isArray(turnData.sources)) {
            state.previousSources = turnData.sources;
        }
        if (turnData.userMessage) {
            state.lastQuery = normalizeText(turnData.userMessage);
        }
        if (turnData.intent) {
            state.previousIntent = turnData.intent;
            state.lastIntent = turnData.intent;
        }

        state.turns.push(turn);
        if (state.turns.length > 25) {
            state.turns.shift();
        }

        log('CONVERSATION STATE', `Updated state for conversation "${conversationId}"`, {
            currentTopic: state.currentTopic,
            activeUrl: state.activeUrl,
            previousIntent: state.previousIntent,
            turnsCount: state.turns.length
        });

        return turn;
    }

    getActiveTopic(conversationId = 'default') {
        const state = this.getState(conversationId);
        return state.currentTopic || state.activeTopic;
    }

    setActiveTopic(conversationId = 'default', topic) {
        const state = this.getState(conversationId);
        state.currentTopic = topic;
        state.activeTopic = topic;
    }

    getActiveUrl(conversationId = 'default') {
        const state = this.getState(conversationId);
        return state.activeUrl;
    }

    setActiveUrl(conversationId = 'default', url) {
        const state = this.getState(conversationId);
        state.activeUrl = url;
    }

    getActiveDocument(conversationId = 'default') {
        const state = this.getState(conversationId);
        return state.previousDocument || state.activeDocument;
    }

    setActiveDocument(conversationId = 'default', doc) {
        const state = this.getState(conversationId);
        state.previousDocument = doc;
        state.activeDocument = doc;
    }

    clear(conversationId = 'default') {
        this.states.delete(conversationId);
    }
}

const stateManager = new ConversationStateManager();
module.exports = stateManager;
