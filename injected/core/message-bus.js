/**
 * Message Bus - Centralized message routing system
 * Handles communication between page context, content script, and background
 */

const MessageBus = {
  listeners: new Map(),

  /**
   * Register a message listener
   * @param {string} type - Message type
   * @param {Function} handler - Handler function
   */
  on(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(handler);
    window.VDLogger?.debug(`Registered listener for: ${type}`);
  },

  /**
   * Unregister a message listener
   * @param {string} type - Message type
   * @param {Function} handler - Handler function
   */
  off(type, handler) {
    if (this.listeners.has(type)) {
      const handlers = this.listeners.get(type);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  },

  /**
   * Emit a message to all listeners
   * @param {string} type - Message type
   * @param {*} data - Message data
   */
  emit(type, data) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).forEach(handler => {
        try {
          handler(data);
        } catch (e) {
          window.VDLogger?.error(`Error in listener for ${type}:`, e);
        }
      });
    }
  },

  /**
   * Send message to content script
   * @param {Object} message - Message object
   */
  sendToContentScript(message) {
    window.postMessage({
      source: 'videodownloader-injected',
      ...message
    }, '*');
  },

  /**
   * Initialize message bus and listen to content script messages
   */
  init() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      
      const message = event.data;
      
      // Handle messages from content script (with or without source field)
      if (message.source === 'videodownloader-content') {
        this.emit(message.type, message.data);
      } else if (message.type && !message.source) {
        // Handle legacy messages without source field (direct from content.js)
        this.emit(message.type, message);
      }
    });

    window.VDLogger?.success('Message Bus initialized');
  }
};

// Make available globally
window.VDMessageBus = MessageBus;
