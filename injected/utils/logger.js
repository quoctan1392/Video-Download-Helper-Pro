/**
 * Centralized logging utility for the extension
 * Provides consistent logging across all modules
 */

const Logger = {
  enabled: true,
  prefix: '[VideoDownloader]',

  log(...args) {
    if (this.enabled) {
      console.log(this.prefix, ...args);
    }
  },

  info(...args) {
    if (this.enabled) {
      console.info(this.prefix, '🔵', ...args);
    }
  },

  warn(...args) {
    if (this.enabled) {
      console.warn(this.prefix, '⚠️', ...args);
    }
  },

  error(...args) {
    if (this.enabled) {
      console.error(this.prefix, '❌', ...args);
    }
  },

  success(...args) {
    if (this.enabled) {
      console.log(this.prefix, '✅', ...args);
    }
  },

  debug(...args) {
    if (this.enabled) {
      console.debug(this.prefix, '🔍', ...args);
    }
  }
};

// Make available globally
window.VDLogger = Logger;
