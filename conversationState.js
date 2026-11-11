/**
 * AuraAI Conversation State Manager
 * Maintains compact, structured conversation state across turns:
 * - activeTopic
 * - activeUrl
 * - activeDocument
 * - activeEntities
 * - previousIntent
 * - lastQueryRepresentation
 * - lastGeneratedImage
 * - turnHistory
 */

const { log } = require('./logger');

class ConversationStateManager {
    constructor() {
        // conversationId -> StateObject
        this.states = new Map();
    }

    getState(conversationId = 'default') {
        if (!this.states.has(conversationId)) {
            this.states.set(conversationId, {
                conversationId,
                activeTopic: null,
                activeUrl: null,
                activeDocument: null,
                activeEntities: [],
                lastQuery: null,
                lastIntent: null,
                lastGeneratedImage: null,
                turns: [],
                createdAt: Date.now(),
                updatedAt: Date.now()
            });
        }
        return this.states.get(conversationId);
    }

    recordTurn(conversationId = 'default', turnData) {
        const state = this.getState(conversationId);
        state.updatedAt = Date.now();

        const turn = {
            id: 'turn_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            timestamp: Date.now(),
            userMessage: turnData.userMessage || '',
            intent: turnData.intent || 'NORMAL_CHAT',
            activeTopic: turnData.activeTopic || state.activeTopic,
            activeUrl: turnData.activeUrl || state.activeUrl,
            activeDocument: turnData.activeDocument || state.activeDocument,
            modelUsed: turnData.modelUsed || 'aura-core',
            retrievedSourcesCount: turnData.retrievedSourcesCount || 0
        };

        if (turnData.activeTopic) state.activeTopic = turnData.activeTopic;
        if (turnData.activeUrl) state.activeUrl = turnData.activeUrl;
        if (turnData.activeDocument) state.activeDocument = turnData.activeDocument;
        if (turnData.activeEntities && turnData.activeEntities.length > 0) {
            state.activeEntities = Array.from(new Set([...state.activeEntities, ...turnData.activeEntities]));
        }
        if (turnData.lastGeneratedImage) state.lastGeneratedImage = turnData.lastGeneratedImage;
        if (turnData.userMessage) state.lastQuery = turnData.userMessage;
        if (turnData.intent) state.lastIntent = turnData.intent;

        state.turns.push(turn);
        if (state.turns.length > 20) {
            state.turns.shift(); // Keep last 20 turns
        }

        log('CONVERSATION STATE', `Updated state for conversation "${conversationId}"`, {
            activeTopic: state.activeTopic,
            activeUrl: state.activeUrl,
            turnsCount: state.turns.length
        });

        return turn;
    }

    getActiveTopic(conversationId = 'default') {
        const state = this.getState(conversationId);
        return state.activeTopic;
    }

    setActiveTopic(conversationId = 'default', topic) {
        const state = this.getState(conversationId);
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
        return state.activeDocument;
    }

    setActiveDocument(conversationId = 'default', doc) {
        const state = this.getState(conversationId);
        state.activeDocument = doc;
    }

    clear(conversationId = 'default') {
        this.states.delete(conversationId);
    }
}

const stateManager = new ConversationStateManager();
module.exports = stateManager;
