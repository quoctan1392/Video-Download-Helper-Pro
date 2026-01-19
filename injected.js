// Injected Script - Runs in page context to intercept player APIs
(function() {
  'use strict';
  
  console.log('[Injected] Video detection script loaded');
  
  // Track detected manifests to avoid duplicates
  const detectedManifests = new Set();
  
  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url) {
    this._url = url;
    return originalOpen.apply(this, arguments);
  };
  
  XMLHttpRequest.prototype.send = function() {
    this.addEventListener('load', function() {
      const url = this._url;
      if (!url) return;
      
      // Detect DASH manifests (.mpd)
      if (url.includes('.mpd') || this.responseType === 'document') {
        const contentType = this.getResponseHeader('content-type') || '';
        if (contentType.includes('application/dash+xml') || url.endsWith('.mpd')) {
          // Skip if already detected
          if (detectedManifests.has(url)) {
            return;
          }
          detectedManifests.add(url);
          
          console.log('[Injected] Detected DASH manifest:', url);
          window.postMessage({
            type: 'VIDEO_MANIFEST_DETECTED',
            format: 'dash',
            url: url,
            manifest: this.responseText
          }, '*');
        }
      }
      
      // Detect HLS playlists (.m3u8)
      if (url.includes('.m3u8')) {
        // Skip if already detected
        if (detectedManifests.has(url)) {
          return;
        }
        detectedManifests.add(url);
        
        console.log('[Injected] Detected HLS playlist:', url);
        window.postMessage({
          type: 'VIDEO_MANIFEST_DETECTED',
          format: 'hls',
          url: url,
          manifest: this.responseText
        }, '*');
      }
    });
    
    return originalSend.apply(this, arguments);
  };
  
  // Intercept Fetch API
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0].url;
    
    return originalFetch.apply(this, args).then(response => {
      // Clone response to read it
      const clone = response.clone();
      
      if (url.includes('.mpd') || url.includes('.m3u8')) {
        // Skip if already detected
        if (!detectedManifests.has(url)) {
          detectedManifests.add(url);
          
          clone.text().then(text => {
            const format = url.includes('.mpd') ? 'dash' : 'hls';
            console.log('[Injected] Detected manifest via fetch:', format, url);
            window.postMessage({
              type: 'VIDEO_MANIFEST_DETECTED',
              format: format,
              url: url,
              manifest: text
            }, '*');
          }).catch(() => {});
        }
      }
      
      return response;
    });
  };
  
  // Intercept common video player APIs
  
  // Shaka Player
  if (window.shaka) {
    const originalLoad = window.shaka.Player.prototype.load;
    window.shaka.Player.prototype.load = function(manifestUri) {
      window.postMessage({
        type: 'VIDEO_MANIFEST_DETECTED',
        format: 'dash',
        url: manifestUri,
        manifest: null
      }, '*');
      return originalLoad.apply(this, arguments);
    };
  }
  
  // HLS.js
  if (window.Hls) {
    const originalLoadSource = window.Hls.prototype.loadSource;
    window.Hls.prototype.loadSource = function(url) {
      window.postMessage({
        type: 'VIDEO_MANIFEST_DETECTED',
        format: 'hls',
        url: url,
        manifest: null
      }, '*');
      return originalLoadSource.apply(this, arguments);
    };
  }
  
  // DASH.js
  if (window.dashjs) {
    const originalInitialize = window.dashjs.MediaPlayer.prototype.initialize;
    window.dashjs.MediaPlayer.prototype.initialize = function() {
      const result = originalInitialize.apply(this, arguments);
      const attachSource = this.attachSource;
      this.attachSource = function(url) {
        window.postMessage({
          type: 'VIDEO_MANIFEST_DETECTED',
          format: 'dash',
          url: url,
          manifest: null
        }, '*');
        return attachSource.apply(this, arguments);
      };
      return result;
    };
  }
  
  // Cloudflare Stream Player
  if (window.Stream) {
    const originalStream = window.Stream;
    window.Stream = function(element) {
      const player = new originalStream(element);
      
      // Intercept src setter
      const originalSrcSetter = Object.getOwnPropertyDescriptor(originalStream.prototype, 'src')?.set;
      if (originalSrcSetter) {
        Object.defineProperty(player, 'src', {
          set: function(value) {
            // Detect Cloudflare Stream URL
            if (value && (value.includes('cloudflarestream.com') || value.includes('videodelivery.net'))) {
              // Try to get manifest URL
              const manifestUrl = value.includes('.m3u8') ? value : value + '/manifest/video.m3u8';
              
              window.postMessage({
                type: 'VIDEO_MANIFEST_DETECTED',
                format: 'hls',
                url: manifestUrl,
                manifest: null,
                source: 'cloudflare-stream'
              }, '*');
            }
            return originalSrcSetter.call(this, value);
          },
          get: function() {
            return Object.getOwnPropertyDescriptor(originalStream.prototype, 'src')?.get?.call(this);
          }
        });
      }
      
      return player;
    };
    window.Stream.prototype = originalStream.prototype;
  }
  
  // Also intercept iframe with Cloudflare Stream
  const originalCreateElement = document.createElement;
  document.createElement = function(tagName) {
    const element = originalCreateElement.call(document, tagName);
    
    if (tagName.toLowerCase() === 'iframe') {
      const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
      Object.defineProperty(element, 'src', {
        set: function(value) {
          if (value && (value.includes('cloudflarestream.com') || value.includes('videodelivery.net'))) {
            // Extract video ID from iframe URL
            const match = value.match(/\/([a-f0-9]+)(\/|$|\?)/i);
            if (match && match[1]) {
              const videoId = match[1];
              const baseUrl = value.match(/(https?:\/\/[^\/]+)/)?.[1];
              if (baseUrl) {
                const manifestUrl = `${baseUrl}/${videoId}/manifest/video.m3u8`;
                
                window.postMessage({
                  type: 'VIDEO_MANIFEST_DETECTED',
                  format: 'hls',
                  url: manifestUrl,
                  manifest: null,
                  source: 'cloudflare-stream-iframe'
                }, '*');
              }
            }
          }
          return srcDescriptor.set.call(this, value);
        },
        get: function() {
          return srcDescriptor.get.call(this);
        }
      });
    }
    
    return element;
  };
  
  console.log('Video Download Helper injected script loaded');
})();
