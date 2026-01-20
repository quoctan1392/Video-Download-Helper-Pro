// Content Script - Detects videos on the page
(function() {
  'use strict';
  
  // Prevent multiple executions
  if (window.__videoDownloadHelperLoaded) {
    console.log('[Content] Script already loaded, skipping initialization...');
    // But still setup message listener for ping/scan
    if (!window.__videoDownloadHelperListenerAdded) {
      window.__videoDownloadHelperListenerAdded = true;
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'ping') {
          console.log('[Content] Ping received');
          sendResponse({ success: true, loaded: true });
          return true;
        }
        
        if (message.action === 'scanVideos') {
          console.log('[Content] Manual scan requested (from existing listener) - forcing re-scan');
          if (window.__detectVideoElements) {
            // Clear detected URLs cache
            if (window.__detectedUrls) {
              window.__detectedUrls.clear();
              console.log('[Content] Cleared detectedUrls cache');
            }
            window.__detectVideoElements(true); // Force scan
          }
          sendResponse({ success: true });
          return true;
        }
      });
    }
    return;
  }
  window.__videoDownloadHelperLoaded = true;
  
  console.log('[Content] Video Download Helper content script loaded');
  
  // Inject script to access page context
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    console.log('[Content] Injected script loaded and executed');
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  
  // Listen for messages from injected script
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    
    if (event.data.type === 'VIDEO_MANIFEST_DETECTED') {
      console.log('[Content] Received manifest from injected script:', event.data.format, event.data.url.substring(0, 100));
      // Forward to background script
      console.log('[Content] Sending to background...');
      
      Promise.race([
        chrome.runtime.sendMessage({
          action: 'manifestDetected',
          url: event.data.url,
          type: event.data.format,
          manifest: event.data.manifest
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 3s')), 3000))
      ]).then(response => {
        console.log('[Content] Background response for manifest:', response);
      }).catch(err => {
        console.error('[Content] Error forwarding manifest:', err);
        console.error('[Content] This means background service worker may be inactive!');
      });
    }
  });
  
  // Detect video elements on the page
  let detectTimeout = null;
  let lastDetectTime = 0;
  const DETECT_COOLDOWN = 2000; // Don't detect more than once per 2 seconds
  const detectedUrls = new Set(); // Track already detected URLs
  
  // Make detectedUrls available globally for clearing on refresh
  window.__detectedUrls = detectedUrls;
  
  function detectVideoElements(force = false) {
    const now = Date.now();
    if (!force && now - lastDetectTime < DETECT_COOLDOWN) {
      console.log('[Content] Skipping scan (cooldown)');
      return;
    }
    lastDetectTime = now;
    
    const videos = document.querySelectorAll('video');
    console.log('[Content] Scanning for video elements, found:', videos.length);
    videos.forEach(video => {
      const src = video.src || video.currentSrc;
      if (src && !src.startsWith('blob:')) {
        // If force, clear the detected flag for this URL so it can be re-detected
        if (force && detectedUrls.has(src)) {
          console.log('[Content] Force re-detecting:', src.substring(0, 100));
        }
        
        // Skip if already detected (unless forced)
        if (!force && detectedUrls.has(src)) {
          return;
        }
        detectedUrls.add(src);
        
        console.log('[Content] Detected video element:', src.substring(0, 100));
        chrome.runtime.sendMessage({
          action: 'manifestDetected',
          url: src,
          type: 'video',
          manifest: null
        }).catch(err => console.error('[Content] Error sending message:', err));
      }
      
      // Check for source elements
      const sources = video.querySelectorAll('source');
      sources.forEach(source => {
        if (source.src) {
          // If force, clear the detected flag for this URL so it can be re-detected
          if (force && detectedUrls.has(source.src)) {
            console.log('[Content] Force re-detecting source:', source.src.substring(0, 100));
          }
          
          // Skip if already detected (unless forced)
          if (!force && detectedUrls.has(source.src)) {
            return;
          }
          detectedUrls.add(source.src);
          
          console.log('[Content] Detected source element:', source.src.substring(0, 100));
          chrome.runtime.sendMessage({
            action: 'manifestDetected',
            url: source.src,
            type: 'video',
            manifest: null
          }).catch(err => console.error('[Content] Error sending message:', err));
        }
      });
    });
  }
  
  // Make function available globally for re-injection case
  window.__detectVideoElements = detectVideoElements;
  
  // Monitor DOM for new video elements
  let mutationTimeout = null;
  const observer = new MutationObserver((mutations) => {
    // Debounce: only scan after mutations stop for 500ms
    if (mutationTimeout) clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(() => {
      let hasVideoChange = false;
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeName === 'VIDEO') {
            hasVideoChange = true;
          }
        });
      });
      
      if (hasVideoChange) {
        console.log('[Content] Video element added to DOM, scanning...');
        detectVideoElements();
      }
    }, 500);
  });
  
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  
  // Initial detection
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detectVideoElements);
  } else {
    detectVideoElements();
  }
  
  // Clear any existing interval before setting new one
  if (window.__videoDetectInterval) {
    clearInterval(window.__videoDetectInterval);
  }
  
  // Detect videos periodically (reduced frequency to avoid overhead)
  window.__videoDetectInterval = setInterval(detectVideoElements, 10000); // Every 10 seconds
  console.log('[Content] Periodic scan enabled (every 10s)');
  
  // Listen for manual scan request from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ success: true, loaded: true });
      return true;
    }
    
    if (message.action === 'scanVideos') {
      console.log('[Content] Manual scan requested - forcing re-scan');
      // Clear the detected URLs set to allow re-detection
      detectedUrls.clear();
      console.log('[Content] Cleared detectedUrls cache');
      // Force scan bypassing cooldown
      detectVideoElements(true);
      sendResponse({ success: true });
      return true;
    }
  });
})();
