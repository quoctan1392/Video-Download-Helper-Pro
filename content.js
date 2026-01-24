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
  
  console.log('[Content] ===================================');
  console.log('[Content] Video Download Helper content script loaded');
  console.log('[Content] Current URL:', window.location.href);
  console.log('[Content] Hostname:', window.location.hostname);
  console.log('[Content] ===================================');
  
  // Inject script to access page context
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    console.log('[Content] ✅ Injected script loaded and executed successfully');
    this.remove();
  };
  script.onerror = function(err) {
    console.error('[Content] ❌ Failed to load injected script:', err);
    console.error('[Content] Script URL:', script.src);
  };
  
  console.log('[Content] 📝 Attempting to inject script:', script.src);
  const target = document.head || document.documentElement;
  if (target) {
    target.appendChild(script);
    console.log('[Content] ✅ Script element appended to:', target.tagName);
  } else {
    console.error('[Content] ❌ No valid injection target found!');
  }
  
  // Listen for messages from injected script
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    
    if (event.data.type === 'VIDEO_MANIFEST_DETECTED') {
      const isYouTube = event.data.format?.startsWith('youtube');
      console.log('[Content] ================================================');
      console.log('[Content] 📥 RECEIVED MESSAGE FROM INJECTED SCRIPT');
      console.log('[Content] Format:', event.data.format);
      console.log('[Content] URL:', event.data.url?.substring(0, 100));
      console.log('[Content] Is YouTube:', isYouTube);
      
      if (isYouTube && event.data.videoInfo) {
        console.log('[Content] 📺 YouTube Video Info:', {
          id: event.data.videoInfo.id,
          title: event.data.videoInfo.title,
          duration: event.data.videoInfo.duration
        });
      }
      console.log('[Content] ================================================');
      
      // Forward to background script
      console.log('[Content] 📤 FORWARDING TO BACKGROUND SCRIPT...');
      
      const messageData = {
        action: 'manifestDetected',
        url: event.data.url,
        type: event.data.format,
        manifest: event.data.manifest
      };
      
      // Include YouTube-specific data
      if (isYouTube && event.data.videoInfo) {
        messageData.videoInfo = event.data.videoInfo;
        console.log('[Content] ✅ Included videoInfo in message');
      }
      
      Promise.race([
        chrome.runtime.sendMessage(messageData),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 3s')), 3000))
      ]).then(response => {
        console.log('[Content] ================================================');
        console.log('[Content] ✅ BACKGROUND RESPONSE RECEIVED');
        console.log('[Content] Response:', response);
        console.log('[Content] ================================================');
      }).catch(err => {
        console.log('[Content] ================================================');
        console.error('[Content] ❌ ERROR FORWARDING TO BACKGROUND');
        console.error('[Content] Error:', err.message);
        console.error('[Content] This means background service worker may be inactive!');
        console.log('[Content] ================================================');
      });
    }
    
    // Handle MSE capture messages
    if (event.data.type === 'MSE_CAPTURE_STARTED') {
      console.log('[Content] 🎬 MSE Capture started');
      chrome.runtime.sendMessage({
        action: 'mseCaptureStarted',
        videoInfo: event.data.videoInfo
      }).catch(() => {});
    }
    
    if (event.data.type === 'MSE_CAPTURE_PROGRESS') {
      console.log('[Content] 📊 MSE Progress:', event.data.progress);
      chrome.runtime.sendMessage({
        action: 'mseCaptureProgress',
        progress: event.data.progress
      }).catch(() => {});
    }
    
    if (event.data.type === 'MSE_DOWNLOAD_SUCCESS') {
      console.log('[Content] ✅ MSE Download success!');
      chrome.runtime.sendMessage({
        action: 'mseDownloadSuccess',
        videoUrl: event.data.videoUrl,
        data: event.data
      }).catch(() => {});
    }
    
    if (event.data.type === 'MSE_LOADING_FULL_VIDEO') {
      console.log('[Content] 🚀 MSE Loading full video:', event.data.status);
      chrome.runtime.sendMessage({
        action: 'mseLoadingFullVideo',
        status: event.data.status,
        videoUrl: event.data.videoUrl
      }).catch(() => {});
    }
    
    if (event.data.type === 'MSE_LOAD_PROGRESS') {
      console.log('[Content] 📊 MSE Load progress:', event.data.progress.toFixed(1), '%');
      chrome.runtime.sendMessage({
        action: 'mseLoadProgress',
        videoUrl: event.data.videoUrl,
        progress: event.data.progress,
        currentSegment: event.data.currentSegment,
        totalSegments: event.data.totalSegments,
        currentTime: event.data.currentTime
      }).catch(() => {});
    }
    
    if (event.data.type === 'MSE_DOWNLOAD_ERROR') {
      console.error('[Content] ❌ MSE Download error:', event.data.error);
      chrome.runtime.sendMessage({
        action: 'mseDownloadError',
        videoUrl: event.data.videoUrl,
        error: event.data.error
      }).catch(() => {});
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
  
  // Listen for messages from extension (popup/background) - UNIFIED LISTENER
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Content] Received message from extension:', message.action);
    
    // Handle ping
    if (message.action === 'ping') {
      sendResponse({ success: true, loaded: true });
      return true;
    }
    
    // Handle manual scan request
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
    
    // Download captured MSE chunks
    if (message.action === 'downloadMseChunks') {
      console.log('[Content] Forwarding DOWNLOAD_MSE_CHUNKS to page...');
      window.postMessage({ 
        type: 'DOWNLOAD_MSE_CHUNKS',
        videoUrl: message.videoUrl 
      }, '*');
      sendResponse({ success: true });
      return true;
    }
    
    // Get MSE capture status
    if (message.action === 'getMseStatus') {
      console.log('[Content] Requesting MSE status from page...');
      window.postMessage({ type: 'GET_MSE_STATUS' }, '*');
      
      // Wait for response
      const listener = (event) => {
        if (event.source === window && event.data.type === 'MSE_STATUS_RESPONSE') {
          window.removeEventListener('message', listener);
          sendResponse({ success: true, status: event.data.status });
        }
      };
      window.addEventListener('message', listener);
      
      // Timeout after 2 seconds
      setTimeout(() => {
        window.removeEventListener('message', listener);
        sendResponse({ success: false, error: 'Timeout' });
      }, 2000);
      
      return true; // async response
    }
    
    return false;
  });
})();
