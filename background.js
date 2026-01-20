// Background Service Worker for Video Download Helper
console.log('[Background] === SERVICE WORKER INITIALIZING ===');

import { VideoDetector } from './modules/videoDetector.js';
import { DownloadManager } from './modules/downloadManager.js';
import { StreamProcessor } from './modules/streamProcessor.js';

console.log('[Background] Service worker starting...');
console.log('[Background] Imports completed');

const videoDetector = new VideoDetector();
console.log('[Background] VideoDetector initialized');

const downloadManager = new DownloadManager();
console.log('[Background] DownloadManager initialized');

const streamProcessor = new StreamProcessor();
console.log('[Background] StreamProcessor initialized');

console.log('[Background] Modules loaded successfully');
console.log('[Background] === SERVICE WORKER READY ===');

// Store detected videos
const detectedVideos = new Map();

// Log helper - sync logs to popup (safe version)
function logToPopup(level, source, message, data = null) {
  const logEntry = {
    timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    level,
    source,
    message,
    data
  };
  
  console.log(`[${source}] ${message}`, data || '');
  
  // Send to popup safely
  setTimeout(() => {
    chrome.runtime.sendMessage({
      action: 'log',
      log: logEntry
    }).catch(() => {});
  }, 0);
  
  // Save to storage
  setTimeout(() => {
    chrome.storage.local.get('extensionLogs').then((result) => {
      const logs = result.extensionLogs || [];
      logs.push(logEntry);
      if (logs.length > 500) logs.shift();
      chrome.storage.local.set({ extensionLogs: logs });
    }).catch(() => {});
  }, 0);
}

// Make available globally for service worker
globalThis.logToPopup = logToPopup;

// Global error handler
self.addEventListener('error', (event) => {
  console.error('[Background] Global error:', event.error);
  logToPopup('error', 'Background', `Global error: ${event.error?.message || event.message}`);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[Background] Unhandled rejection:', event.reason);
  logToPopup('error', 'Background', `Unhandled rejection: ${event.reason?.message || event.reason}`);
});

console.log('[Background] Error handlers installed');

// Clear videos when tab navigates or reloads
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) { // Main frame only
    console.log('[Background] Tab navigation detected, clearing videos for tab:', details.tabId);
    // Remove all videos for this tab
    for (const [key, video] of detectedVideos.entries()) {
      if (video.tabId === details.tabId) {
        detectedVideos.delete(key);
      }
    }
    // Update badge
    updateBadge(details.tabId);
  }
});

console.log('[Background] Navigation listener installed');

// Listen for network requests to detect video streams
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const url = details.url;
    const tabId = details.tabId;
    
    // Skip invalid tabIds
    if (!tabId || tabId < 0) {
      return;
    }
    
    // Skip segment files for DASH/HLS streams - only keep manifest files
    const isSegment = url.match(/\/(init|seg_\d+|chunk[_-]\d+|fragment[_-]\d+)\.(mp4|m4s|ts|webm)/i);
    if (isSegment) {
      // Don't store individual segments, they're not useful for users
      return;
    }
    
    // Detect video formats
    if (videoDetector.isVideoUrl(url)) {
      console.log('[Background] Video detected:', url, 'type:', videoDetector.getVideoType(url));
      const videoInfo = {
        url: url,
        tabId: tabId,
        type: videoDetector.getVideoType(url),
        timestamp: Date.now(),
        method: details.method,
        initiator: details.initiator
      };
      
      // Store or update video info
      const key = `${tabId}_${url}`;
      const alreadyExists = detectedVideos.has(key);
      
      if (!alreadyExists) {
        detectedVideos.set(key, videoInfo);
        console.log('[Background] New video added, total:', detectedVideos.size);
        
        // Notify popup of new video (only if it's new)
        chrome.runtime.sendMessage({
          action: 'videoDetected',
          video: videoInfo
        }).catch(() => {
          // Popup might not be open
        });
      } else {
        console.log('[Background] Video already exists, skipping duplicate:', url.substring(0, 100));
      }
      
      // Update badge
      updateBadge(tabId);
    }
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// Listen for response headers to get more video info
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const tabId = details.tabId;
    
    // Skip invalid tabIds
    if (!tabId || tabId < 0) {
      return;
    }
    const contentType = details.responseHeaders?.find(
      h => h.name.toLowerCase() === 'content-type'
    )?.value || '';
    
    const contentLength = details.responseHeaders?.find(
      h => h.name.toLowerCase() === 'content-length'
    )?.value || null;
    
    if (contentType.includes('video/') || 
        contentType.includes('application/vnd.apple.mpegurl') ||
        contentType.includes('application/dash+xml')) {
      
      const key = `${details.tabId}_${details.url}`;
      const existing = detectedVideos.get(key);
      
      if (existing) {
        existing.contentType = contentType;
        existing.contentLength = contentLength ? parseInt(contentLength) : null;
        existing.responseHeaders = details.responseHeaders;
        detectedVideos.set(key, existing);
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Update extension badge with video count
function updateBadge(tabId) {
  // Skip if invalid tabId
  if (!tabId || tabId < 0) {
    return;
  }
  
  let count = 0;
  detectedVideos.forEach((video) => {
    if (video.tabId === tabId) count++;
  });
  
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString(), tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId: tabId });
  } else {
    chrome.action.setBadgeText({ text: '', tabId: tabId });
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Message received:', message?.action, 'from:', sender?.tab?.id || 'popup');
  
  // Handle async messages
  (async () => {
    try {
      if (message.action === 'ping') {
        sendResponse({ success: true, status: 'alive' });
        return;
      }
      
      if (message.action === 'clearVideos') {
        const tabId = message.tabId;
        console.log('[Background] Clearing videos for tab:', tabId);
        
        // Clear videos for this tab
        const keysToDelete = [];
        detectedVideos.forEach((video, key) => {
          if (video.tabId === tabId) {
            keysToDelete.push(key);
          }
        });
        
        keysToDelete.forEach(key => detectedVideos.delete(key));
        console.log('[Background] Cleared', keysToDelete.length, 'videos');
        
        // Update badge
        updateBadge(tabId);
        
        sendResponse({ success: true, cleared: keysToDelete.length });
        logToPopup('info', 'Background', `Cleared ${keysToDelete.length} videos from cache`);
        return;
      }
      
      if (message.action === 'removeVideo') {
        const tabId = message.tabId;
        const url = message.url;
        console.log('[Background] removeVideo request for tab:', tabId, 'url:', url);

        let removed = 0;
        const keysToDelete = [];
        detectedVideos.forEach((video, key) => {
          if (video.tabId === tabId && video.url === url) {
            keysToDelete.push(key);
          }
        });
        keysToDelete.forEach(key => {
          detectedVideos.delete(key);
          removed++;
        });

        console.log('[Background] removeVideo removed:', removed);
        sendResponse({ success: true, removed });
        logToPopup('info', 'Background', `Removed ${removed} video(s) for ${url}`);
        return;
      }
      
      if (message.action === 'getVideos') {
        const tabId = message.tabId;
        console.log('[Background] getVideos request for tab:', tabId);
        console.log('[Background] Total videos in storage:', detectedVideos.size);
        
        // Debug: Log all videos with their tabIds
        console.log('[Background] All stored videos:');
        detectedVideos.forEach((video, key) => {
          console.log(`  - TabID ${video.tabId}: ${video.type} - ${video.url.substring(0, 100)}`);
        });
        
        // Filter videos for the requested tab
        const tabVideos = [];
        detectedVideos.forEach((video, key) => {
          if (video.tabId === tabId) {
            tabVideos.push(video);
          }
        });
        
        console.log('[Background] Returning', tabVideos.length, 'videos for tab', tabId);
        sendResponse({ videos: tabVideos });
        logToPopup('info', 'Background', `Returned ${tabVideos.length} videos for tab ${tabId}`);
        return;
      }
      
      if (message.action === 'downloadVideo') {
        logToPopup('info', 'Background', 'Starting video download...');
        console.log('[Background] Download options:', message.options);
        console.log('[Background] Selected quality:', message.options?.quality);
        const result = await handleVideoDownload(message.video, message.options);
        sendResponse({ success: true, result });
        logToPopup('success', 'Background', 'Download completed');
        return;
      }
      
      if (message.action === 'getQualities') {
        logToPopup('info', 'Background', 'Getting available qualities...');
        try {
          const qualities = await getAvailableQualities(message.video);
          sendResponse({ success: true, qualities });
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        return;
      }
      
      if (message.action === 'manifestDetected') {
        // Handle DASH/HLS manifest detection from content script
        console.log('[Background] manifestDetected received:', message.type, message.url.substring(0, 100));
        console.log('[Background] Sender tab:', sender?.tab?.id);
        
        if (!sender || !sender.tab || !sender.tab.id) {
          console.error('[Background] No sender tab ID available');
          sendResponse({ success: false, error: 'No tab ID' });
          return;
        }
        
        const videoInfo = {
          url: message.url,
          tabId: sender.tab.id,
          type: message.type,
          timestamp: Date.now(),
          manifest: message.manifest,
          duration: message.duration || null,
          estimatedSize: message.estimatedSize || null,
          isExactSize: message.isExactSize || false
        };
        
        const key = `${sender.tab.id}_${message.url}`;
        detectedVideos.set(key, videoInfo);
        console.log('[Background] Video stored. Total videos:', detectedVideos.size);
        updateBadge(sender.tab.id);
        
        sendResponse({ success: true });
        return;
      }
    } catch (error) {
      console.error('[Background] Message handler error:', error);
      logToPopup('error', 'Background', `Error: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep message channel open for async response
});
// Get available video qualities
async function getAvailableQualities(video) {
  try {
    // Fetch manifest
    const response = await fetch(video.url);
    const manifestText = await response.text();
    
    // Parse manifest to extract qualities
    const qualities = [];
    
    if (video.type === 'dash' || video.type === 'mpd') {
      // Parse DASH manifest for quality options
      const adaptationSets = manifestText.match(/<AdaptationSet[^>]*mimeType="[^"]*video[^"]*"[^>]*>[\s\S]*?<\/AdaptationSet>/gi) || [];
      
      for (const adaptationSet of adaptationSets) {
        const representations = adaptationSet.match(/<Representation[^>]*>/gi) || [];
        
        for (const rep of representations) {
          const bandwidthMatch = rep.match(/bandwidth="([0-9]+)"/);
          const heightMatch = rep.match(/height="([0-9]+)"/);
          const widthMatch = rep.match(/width="([0-9]+)"/);
          const idMatch = rep.match(/id="([^"]+)"/);
          
          if (heightMatch && bandwidthMatch) {
            const height = parseInt(heightMatch[1]);
            const width = widthMatch ? parseInt(widthMatch[1]) : 0;
            const bandwidth = parseInt(bandwidthMatch[1]);
            
            qualities.push({
              id: idMatch ? idMatch[1] : `${height}p`,
              label: `${height}p`,
              resolution: `${width}x${height}`,
              bandwidth: `${(bandwidth / 1000000).toFixed(1)} Mbps`,
              height: height,
              width: width,
              bandwidthValue: bandwidth
            });
          }
        }
      }
    }
    
    // Sort by height descending
    qualities.sort((a, b) => b.height - a.height);
    
    // Remove duplicates by height
    const uniqueQualities = [];
    const seenHeights = new Set();
    for (const q of qualities) {
      if (!seenHeights.has(q.height)) {
        seenHeights.add(q.height);
        uniqueQualities.push(q);
      }
    }
    
    return uniqueQualities;
  } catch (error) {
    console.error('[Background] Error getting qualities:', error);
    return [];
  }
}
// Handle video download
async function handleVideoDownload(video, options = {}) {
  try {
    if (video.type === 'dash' || video.type === 'hls' || video.type === 'mpd') {
      // Handle streaming protocols
      return await streamProcessor.processStream(video, options);
    } else {
      // Direct download
      return await downloadManager.download(video.url, options);
    }
  } catch (error) {
    // Check if this is a yt-dlp requirement error
    if (error.requiresYtDlp) {
      logToPopup('warn', 'Background', 'Video requires yt-dlp for audio/video merge');
      return {
        success: false,
        requiresYtDlp: true,
        ytDlpCommand: error.ytDlpCommand,
        message: error.message,
        manifestUrl: error.manifestUrl
      };
    }
    
    console.error('Download failed:', error);
    throw error;
  }
}

// Clean up old videos when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  detectedVideos.forEach((video, key) => {
    if (video.tabId === tabId) {
      detectedVideos.delete(key);
    }
  });
});

// Clean up old videos (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  detectedVideos.forEach((video, key) => {
    if (video.timestamp < oneHourAgo) {
      detectedVideos.delete(key);
    }
  });
}, 5 * 60 * 1000); // Run every 5 minutes

console.log('Video Download Helper background service worker initialized');
