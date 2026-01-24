/**
 * Network Interceptors - Shared fetch/XHR hooks
 * Provides unified interception of network requests for manifest detection
 */

const Interceptors = {
  detectedManifests: new Set(),
  detectionCallbacks: [],

  /**
   * Register a callback for manifest detection
   * @param {Function} callback - Called when manifest is detected
   */
  onManifestDetected(callback) {
    this.detectionCallbacks.push(callback);
  },

  /**
   * Notify all callbacks about detected manifest
   * @param {Object} data - Manifest data
   */
  notifyDetection(data) {
    this.detectionCallbacks.forEach(callback => {
      try {
        callback(data);
      } catch (e) {
        window.VDLogger?.error('Error in detection callback:', e);
      }
    });

    // Also send to content script
    window.VDMessageBus?.sendToContentScript({
      type: 'VIDEO_MANIFEST_DETECTED',
      ...data
    });
  },

  /**
   * Install XMLHttpRequest interceptors
   */
  installXHRInterceptor() {
    const self = this;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this._vd_url = url;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('load', function() {
        const url = this._vd_url;
        if (!url) return;

        // Skip if already detected
        if (self.detectedManifests.has(url)) return;

        // Detect DASH manifests (.mpd)
        if (url.includes('.mpd')) {
          const contentType = this.getResponseHeader('content-type') || '';
          if (contentType.includes('application/dash+xml') || url.endsWith('.mpd')) {
            self.detectedManifests.add(url);
            window.VDLogger?.log('Detected DASH manifest (XHR):', url);
            
            self.notifyDetection({
              format: 'dash',
              url: url,
              manifest: this.responseText
            });
          }
        }

        // Detect HLS playlists (.m3u8)
        if (url.includes('.m3u8')) {
          self.detectedManifests.add(url);
          window.VDLogger?.log('Detected HLS playlist (XHR):', url);
          
          self.notifyDetection({
            format: 'hls',
            url: url,
            manifest: this.responseText
          });
        }
      });

      return originalSend.apply(this, arguments);
    };

    window.VDLogger?.success('XHR interceptor installed');
  },

  /**
   * Install Fetch API interceptors
   */
  installFetchInterceptor() {
    const self = this;
    const originalFetch = window.fetch;

    window.fetch = function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0].url;

      return originalFetch.apply(this, args).then(response => {
        // Clone response to read it
        const clone = response.clone();

        if ((url.includes('.mpd') || url.includes('.m3u8')) && !self.detectedManifests.has(url)) {
          self.detectedManifests.add(url);

          clone.text().then(text => {
            const format = url.includes('.mpd') ? 'dash' : 'hls';
            window.VDLogger?.log(`Detected manifest via fetch: ${format}`, url);
            
            self.notifyDetection({
              format: format,
              url: url,
              manifest: text
            });
          }).catch(() => {});
        }

        return response;
      });
    };

    window.VDLogger?.success('Fetch interceptor installed');
  },

  /**
   * Install player library hooks
   */
  installPlayerHooks() {
    const self = this;

    // Shaka Player
    if (window.shaka) {
      const originalLoad = window.shaka.Player.prototype.load;
      window.shaka.Player.prototype.load = function(manifestUri) {
        self.notifyDetection({
          format: 'dash',
          url: manifestUri,
          manifest: null
        });
        return originalLoad.apply(this, arguments);
      };
      window.VDLogger?.success('Shaka Player hook installed');
    }

    // HLS.js
    if (window.Hls) {
      const originalLoadSource = window.Hls.prototype.loadSource;
      window.Hls.prototype.loadSource = function(url) {
        self.notifyDetection({
          format: 'hls',
          url: url,
          manifest: null
        });
        return originalLoadSource.apply(this, arguments);
      };
      window.VDLogger?.success('HLS.js hook installed');
    }

    // DASH.js
    if (window.dashjs) {
      const originalInitialize = window.dashjs.MediaPlayer.prototype.initialize;
      window.dashjs.MediaPlayer.prototype.initialize = function() {
        const result = originalInitialize.apply(this, arguments);
        const attachSource = this.attachSource;
        this.attachSource = function(url) {
          self.notifyDetection({
            format: 'dash',
            url: url,
            manifest: null
          });
          return attachSource.apply(this, arguments);
        };
        return result;
      };
      window.VDLogger?.success('DASH.js hook installed');
    }
  },

  /**
   * Initialize all interceptors
   */
  init() {
    this.installXHRInterceptor();
    this.installFetchInterceptor();
    
    // Install player hooks after a delay (wait for libraries to load)
    setTimeout(() => {
      this.installPlayerHooks();
    }, 1000);

    window.VDLogger?.success('All interceptors initialized');
  }
};

// Make available globally
window.VDInterceptors = Interceptors;
