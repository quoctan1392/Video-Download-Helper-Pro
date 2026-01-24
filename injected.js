// Injected Script - Runs in page context to intercept player APIs
(function() {
  'use strict';
  
  console.log('[Injected] Video detection script loaded');
  
  // Track detected manifests to avoid duplicates
  const detectedManifests = new Set();
  
  // Track YouTube video playback IDs to detect video changes
  let lastYouTubePlaybackId = null;
  
  // ==========================================
  // MSE (Media Source Extensions) Chunk Capture
  // ==========================================
  
  class MediaSourceChunkCapture {
    constructor() {
      this.videoChunks = [];
      this.audioChunks = [];
      this.videoMimeType = null;
      this.audioMimeType = null;
      this.isCapturing = false;
      this.currentVideoInfo = null;
      this.captureStartTime = null;
      this.videoCodec = null;
      this.audioCodec = null;
      this.autoSeekInProgress = false;
      this.videoDuration = 0;
      this.videoElement = null;
      
      console.log('[MSE Capture] Initialized');
    }
    
    startCapture(videoInfo) {
      this.videoChunks = [];
      this.audioChunks = [];
      this.currentVideoInfo = videoInfo;
      this.isCapturing = true;
      this.captureStartTime = Date.now();
      this.videoDuration = videoInfo?.duration || 0;
      
      console.log('[MSE Capture] ========================================');
      console.log('[MSE Capture] 🎬 STARTED CAPTURING');
      console.log('[MSE Capture] Video:', videoInfo?.title || 'Unknown');
      console.log('[MSE Capture] VideoId:', videoInfo?.id || 'Unknown');
      console.log('[MSE Capture] Duration:', this.videoDuration, 'seconds');
      console.log('[MSE Capture] ========================================');
      
      // Notify extension
      window.postMessage({
        type: 'MSE_CAPTURE_STARTED',
        videoInfo: videoInfo
      }, '*');
    }
    
    // Force YouTube to load full video by seeking through it
    async forceLoadFullVideo(videoUrl = null) {
      console.log('[MSE Capture] ========================================');
      console.log('[MSE Capture] 🚀 FORCING FULL VIDEO LOAD');
      console.log('[MSE Capture] ========================================');
      
      const video = document.querySelector('video');
      if (!video) {
        console.error('[MSE Capture] ❌ Video element not found!');
        return false;
      }
      
      this.videoElement = video;
      this.autoSeekInProgress = true;
      
      const duration = video.duration || this.videoDuration;
      if (!duration || duration === 0) {
        console.error('[MSE Capture] ❌ Video duration is 0 or unknown');
        return false;
      }
      
      console.log('[MSE Capture] 📏 Video duration:', duration, 'seconds');
      console.log('[MSE Capture] 🎯 Will seek through video to force chunk loading...');
      
      // Store original state
      const wasPlaying = !video.paused;
      const originalTime = video.currentTime;
      const originalVolume = video.volume;
      
      // Mute and pause
      video.volume = 0;
      if (wasPlaying) {
        video.pause();
      }
      
      // Calculate optimal segment duration based on video length
      let segmentDuration;
      if (duration <= 120) {
        // Short videos (≤2 min): 8s intervals for maximum coverage
        segmentDuration = 8;
      } else if (duration <= 600) {
        // Medium videos (2-10 min): 10s intervals
        segmentDuration = 10;
      } else if (duration <= 1800) {
        // Long videos (10-30 min): 15s intervals
        segmentDuration = 15;
      } else {
        // Very long videos (>30 min): 20s intervals
        segmentDuration = 20;
      }
      
      // Calculate exact number of segments needed to cover entire video
      const numSegments = Math.ceil(duration / segmentDuration);
      
      // Generate evenly spaced seek points to ensure full coverage
      const seekPoints = [];
      
      // Always start from 0
      seekPoints.push(0);
      
      // Add intermediate points - evenly distributed
      for (let i = 1; i < numSegments; i++) {
        const seekTime = (duration / numSegments) * i;
        seekPoints.push(Math.floor(seekTime));
      }
      
      // CRITICAL: Always seek to the very end (duration - 0.1s to avoid edge case errors)
      // Use 0.1s instead of 0.5s to get closer to the actual end
      const finalSeekPoint = Math.max(duration - 0.1, 0);
      if (seekPoints[seekPoints.length - 1] < finalSeekPoint - 1) {
        seekPoints.push(finalSeekPoint);
      } else {
        // Replace last point with exact end if it's close but not at the end
        seekPoints[seekPoints.length - 1] = finalSeekPoint;
      }
      
      console.log('[MSE Capture] 📍 Video length:', duration.toFixed(1), 's');
      console.log('[MSE Capture] 📍 Segment duration:', segmentDuration, 's');
      console.log('[MSE Capture] 📍 Number of segments:', numSegments);
      console.log('[MSE Capture] 📍 Seek points:', seekPoints.length, '- Points:', seekPoints.map(t => t.toFixed(1) + 's').join(', '));
      
      // Seek through all points
      for (let i = 0; i < seekPoints.length; i++) {
        const seekTime = seekPoints[i];
        
        console.log('[MSE Capture] ⏩ Seeking to', seekTime.toFixed(1), 's (', (i + 1), '/', seekPoints.length, ')');
        
        video.currentTime = seekTime;
        
        // Wait for seek to complete and buffer to load
        await new Promise(resolve => {
          const onSeeked = () => {
            video.removeEventListener('seeked', onSeeked);
            
            // Wait longer for YouTube to buffer chunks at this position
            // Extra long wait for the final seek point to ensure last chunks are captured
            const isFinalSeek = (i === seekPoints.length - 1);
            const waitTime = isFinalSeek ? 2000 : 800; // 2s for final, 800ms for others
            
            console.log('[MSE Capture] ⏸️ Waiting', waitTime, 'ms for chunks to load', isFinalSeek ? '(FINAL SEEK)' : '');
            setTimeout(resolve, waitTime);
          };
          
          video.addEventListener('seeked', onSeeked);
          
          // Timeout after 8 seconds if seek doesn't complete
          setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            console.warn('[MSE Capture] ⚠️ Seek timeout at', seekTime);
            resolve();
          }, 8000);
        });
        
        // Progress update
        const progress = ((i + 1) / seekPoints.length) * 100;
        window.postMessage({
          type: 'MSE_LOAD_PROGRESS',
          videoUrl: videoUrl || window.location.href,
          progress: progress,
          currentSegment: i + 1,
          totalSegments: seekPoints.length,
          currentTime: seekTime
        }, '*');
      }
      
      // CRITICAL: Wait extra time after all seeks to ensure final chunks are appended
      const chunksBeforeWait = this.videoChunks.length + this.audioChunks.length;
      console.log('[MSE Capture] 📊 Chunks before final wait:', chunksBeforeWait, '(video:', this.videoChunks.length, '+ audio:', this.audioChunks.length, ')');
      console.log('[MSE Capture] ⏳ Waiting additional 2s for final chunks to be appended...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const chunksAfterWait = this.videoChunks.length + this.audioChunks.length;
      const newChunks = chunksAfterWait - chunksBeforeWait;
      console.log('[MSE Capture] 📊 Chunks after final wait:', chunksAfterWait, '(+', newChunks, 'new chunks)');
      
      // Restore original state
      video.volume = originalVolume;
      video.currentTime = originalTime;
      
      if (wasPlaying) {
        video.play().catch(e => console.log('[MSE Capture] Could not resume playback:', e));
      }
      
      this.autoSeekInProgress = false;
      
      console.log('[MSE Capture] ========================================');
      console.log('[MSE Capture] ✅ FULL VIDEO LOAD COMPLETE');
      console.log('[MSE Capture] Video chunks:', this.videoChunks.length);
      console.log('[MSE Capture] Audio chunks:', this.audioChunks.length);
      console.log('[MSE Capture] Total size:', this.formatBytes(this.getTotalSize()));
      console.log('[MSE Capture] ========================================');
      
      return true;
    }
    
    formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
    }
    
    stopCapture() {
      this.isCapturing = false;
      const duration = Date.now() - this.captureStartTime;
      
      console.log('[MSE Capture] ========================================');
      console.log('[MSE Capture] 🛑 STOPPED CAPTURING');
      console.log('[MSE Capture] Duration:', (duration / 1000).toFixed(1), 'seconds');
      console.log('[MSE Capture] Video chunks:', this.videoChunks.length);
      console.log('[MSE Capture] Audio chunks:', this.audioChunks.length);
      console.log('[MSE Capture] ========================================');
      
      return {
        videoChunks: this.videoChunks,
        audioChunks: this.audioChunks,
        videoMimeType: this.videoMimeType,
        audioMimeType: this.audioMimeType,
        videoInfo: this.currentVideoInfo
      };
    }
    
    getTotalSize() {
      const videoSize = this.videoChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const audioSize = this.audioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      return videoSize + audioSize;
    }
    
    getProgress() {
      return {
        videoChunks: this.videoChunks.length,
        audioChunks: this.audioChunks.length,
        totalSize: this.getTotalSize(),
        isCapturing: this.isCapturing,
        videoMimeType: this.videoMimeType,
        audioMimeType: this.audioMimeType
      };
    }
    
    hookMediaSource() {
      const self = this;
      
      // Check if MediaSource is available
      if (typeof MediaSource === 'undefined') {
        console.warn('[MSE Capture] MediaSource API not available');
        return false;
      }
      
      const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
      
      MediaSource.prototype.addSourceBuffer = function(mimeType) {
        console.log('[MSE Capture] 🎯 addSourceBuffer called:', mimeType);
        
        // Determine if this is video or audio
        const isVideo = mimeType.includes('video');
        const isAudio = mimeType.includes('audio');
        
        if (isVideo) {
          self.videoMimeType = mimeType;
          // Extract codec
          const codecMatch = mimeType.match(/codecs="([^"]+)"/);
          self.videoCodec = codecMatch ? codecMatch[1] : null;
          console.log('[MSE Capture] 📹 Video track detected:', mimeType);
          console.log('[MSE Capture] Video codec:', self.videoCodec);
        } else if (isAudio) {
          self.audioMimeType = mimeType;
          const codecMatch = mimeType.match(/codecs="([^"]+)"/);
          self.audioCodec = codecMatch ? codecMatch[1] : null;
          console.log('[MSE Capture] 🔊 Audio track detected:', mimeType);
          console.log('[MSE Capture] Audio codec:', self.audioCodec);
        }
        
        // Call original to get actual SourceBuffer
        const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
        
        // Hook appendBuffer method
        const originalAppendBuffer = sourceBuffer.appendBuffer;
        const originalAppendBufferAsync = sourceBuffer.appendBufferAsync;
        
        sourceBuffer.appendBuffer = function(chunk) {
          // Capture chunk if we're actively capturing
          if (self.isCapturing) {
            try {
              // Clone the chunk data (ArrayBuffer)
              const chunkCopy = new Uint8Array(chunk).slice();
              
              if (isVideo) {
                self.videoChunks.push(chunkCopy);
                console.log('[MSE Capture] 📦 Video chunk', self.videoChunks.length, ':', chunkCopy.byteLength, 'bytes');
              } else if (isAudio) {
                self.audioChunks.push(chunkCopy);
                console.log('[MSE Capture] 🔊 Audio chunk', self.audioChunks.length, ':', chunkCopy.byteLength, 'bytes');
              }
              
              // Send progress update every 10 chunks
              if ((self.videoChunks.length + self.audioChunks.length) % 10 === 0) {
                window.postMessage({
                  type: 'MSE_CAPTURE_PROGRESS',
                  progress: self.getProgress()
                }, '*');
              }
            } catch (err) {
              console.error('[MSE Capture] ❌ Error capturing chunk:', err);
            }
          }
          
          // Call original appendBuffer to let video play normally
          return originalAppendBuffer.call(this, chunk);
        };
        
        // Also hook appendBufferAsync if it exists
        if (originalAppendBufferAsync) {
          sourceBuffer.appendBufferAsync = function(chunk) {
            if (self.isCapturing) {
              try {
                const chunkCopy = new Uint8Array(chunk).slice();
                if (isVideo) {
                  self.videoChunks.push(chunkCopy);
                } else if (isAudio) {
                  self.audioChunks.push(chunkCopy);
                }
              } catch (err) {
                console.error('[MSE Capture] Error in appendBufferAsync:', err);
              }
            }
            return originalAppendBufferAsync.call(this, chunk);
          };
        }
        
        return sourceBuffer;
      };
      
      console.log('[MSE Capture] ✅ MediaSource API hooked successfully');
      return true;
    }
  }
  
  // Initialize MSE capture for YouTube
  let mseCapture = null;
  if (window.location.hostname.includes('youtube.com')) {
    mseCapture = new MediaSourceChunkCapture();
    const hooked = mseCapture.hookMediaSource();
    
    if (hooked) {
      console.log('[MSE Capture] 🎉 Ready to capture YouTube video chunks');
      
      // Expose to window for external control
      window.mseCapture = mseCapture;
    } else {
      console.warn('[MSE Capture] Failed to hook MediaSource API');
    }
  }
  
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
      
      // Detect YouTube videoplayback segments and use ID to detect video changes
      if (url.includes('googlevideo.com') && url.includes('/videoplayback')) {
        // Extract the 'id' parameter which is unique per video
        const idMatch = url.match(/[?&]id=([^&]+)/);
        const playbackId = idMatch ? idMatch[1] : null;
        
        if (playbackId && playbackId !== lastYouTubePlaybackId) {
          console.log('[Injected] New YouTube playback ID detected:', playbackId.substring(0, 30) + '...');
          console.log('[Injected] Previous ID:', lastYouTubePlaybackId ? lastYouTubePlaybackId.substring(0, 30) + '...' : 'none');
          lastYouTubePlaybackId = playbackId;
          
          // This means a new video is playing - trigger detection
          if (!detectedManifests.has('youtube-segments-detected')) {
            detectedManifests.add('youtube-segments-detected');
            setTimeout(() => {
              if (window.ytInitialPlayerResponse) {
                extractYouTubeVideoInfo(window.ytInitialPlayerResponse);
              }
            }, 500);
          }
        } else if (playbackId) {
          console.log('[Injected] Same YouTube playback ID, video unchanged');
        }
      }
      
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
    
    // Detect YouTube videoplayback segments via fetch
    if (url.includes('googlevideo.com') && url.includes('/videoplayback')) {
      // Extract the 'id' parameter which is unique per video
      const idMatch = url.match(/[?&]id=([^&]+)/);
      const playbackId = idMatch ? idMatch[1] : null;
      
      if (playbackId && playbackId !== lastYouTubePlaybackId) {
        console.log('[Injected] New YouTube playback ID detected (fetch):', playbackId.substring(0, 30) + '...');
        lastYouTubePlaybackId = playbackId;
        
        if (!detectedManifests.has('youtube-segments-detected')) {
          detectedManifests.add('youtube-segments-detected');
          setTimeout(() => {
            if (window.ytInitialPlayerResponse) {
              extractYouTubeVideoInfo(window.ytInitialPlayerResponse);
            }
          }, 500);
        }
      }
    }
    
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
  
  // YouTube Player API Interception
  let youtubePlayerDetected = false;
  let lastExtractedVideoId = null; // Track last extracted video ID
  
  // Intercept YouTube Player API requests for fresh data
  if (window.location.hostname.includes('youtube.com')) {
    console.log('[Injected] 🎬 Installing YouTube API interceptors...');
    
    // Method 1: Intercept Fetch API
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      
      // Log ALL fetch requests to debug
      if (url && url.includes('youtubei')) {
        console.log('[Injected] 🌐 Fetch request to:', url.substring(0, 100));
      }
      
      // Intercept player API requests
      if (url && url.includes('/youtubei/v1/player')) {
        console.log('[Injected] 🎯 Intercepted fetch player API request');
        
        return originalFetch.apply(this, args).then(response => {
          // Clone response to read without consuming original
          const clone = response.clone();
          
          clone.json().then(data => {
            const videoId = data?.videoDetails?.videoId;
            const title = data?.videoDetails?.title;
            
            console.log('[Injected] 📦 Player API response - videoId:', videoId, 'title:', title?.substring(0, 50));
            
            if (videoId && videoId !== lastExtractedVideoId) {
              console.log('[Injected] ✅ NEW VIDEO detected from API, extracting...');
              youtubePlayerDetected = true;
              extractYouTubeVideoInfo(data);
              lastExtractedVideoId = videoId;
            } else if (videoId === lastExtractedVideoId) {
              console.log('[Injected] ⏭️ Same videoId from API, skipping:', videoId);
            }
          }).catch(err => {
            console.log('[Injected] ❌ Failed to parse player API response:', err);
          });
          
          return response;
        });
      }
      
      return originalFetch.apply(this, args);
    };
    
    // Method 2: Intercept XHR (fallback if YouTube uses XMLHttpRequest)
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._url = url;
      return originalXHROpen.apply(this, [method, url, ...rest]);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
      // Log ALL XHR requests to debug
      if (this._url && this._url.includes('youtubei')) {
        console.log('[Injected] 🌐 XHR request to:', this._url.substring(0, 100));
      }
      
      if (this._url && this._url.includes('/youtubei/v1/player')) {
        console.log('[Injected] 🎯 Intercepted XHR player API request');
        
        this.addEventListener('load', function() {
          try {
            const data = JSON.parse(this.responseText);
            const videoId = data?.videoDetails?.videoId;
            const title = data?.videoDetails?.title;
            
            console.log('[Injected] 📦 XHR Player API response - videoId:', videoId, 'title:', title?.substring(0, 50));
            
            if (videoId && videoId !== lastExtractedVideoId) {
              console.log('[Injected] ✅ NEW VIDEO detected from XHR, extracting...');
              youtubePlayerDetected = true;
              extractYouTubeVideoInfo(data);
              lastExtractedVideoId = videoId;
            } else if (videoId === lastExtractedVideoId) {
              console.log('[Injected] ⏭️ Same videoId from XHR, skipping:', videoId);
            }
          } catch (err) {
            console.log('[Injected] ❌ Failed to parse XHR response:', err);
          }
        });
      }
      
      return originalXHRSend.apply(this, args);
    };
    
    console.log('[Injected] ✅ YouTube API interceptors installed (Fetch + XHR)');
    
    // Method 3: Monitor ytplayer.config (direct player data access)
    let ytplayerCheckAttempts = 0;
    const checkYtPlayer = setInterval(() => {
      ytplayerCheckAttempts++;
      
      if (window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
        const playerData = window.ytplayer.config.args;
        const videoId = playerData.video_id;
        const title = playerData.title;
        
        console.log('[Injected] 🎮 ytplayer.config found - videoId:', videoId, 'title:', title?.substring(0, 50));
        
        if (videoId && videoId !== lastExtractedVideoId) {
          clearInterval(checkYtPlayer);
          console.log('[Injected] ✅ NEW VIDEO from ytplayer.config!');
          
          // Try to get full player response
          if (playerData.player_response) {
            try {
              const playerResponse = typeof playerData.player_response === 'string' 
                ? JSON.parse(playerData.player_response) 
                : playerData.player_response;
              
              console.log('[Injected] 📦 Using player_response from ytplayer.config');
              youtubePlayerDetected = true;
              extractYouTubeVideoInfo(playerResponse);
              lastExtractedVideoId = videoId;
            } catch (err) {
              console.log('[Injected] ❌ Failed to parse player_response:', err);
            }
          }
        }
      } else if (ytplayerCheckAttempts >= 10) {
        clearInterval(checkYtPlayer);
        console.log('[Injected] ⏹️ Stopped ytplayer.config check after 10 attempts');
      }
    }, 500);
  }
  
  // Function to reset YouTube detection state
  function resetYouTubeDetection() {
    console.log('[Injected] 🔄 Resetting YouTube detection state');
    console.log('[Injected] Previous videoId:', lastExtractedVideoId);
    youtubePlayerDetected = false;
    lastYouTubePlaybackId = null; // Reset playback ID tracking
    lastExtractedVideoId = null; // IMPORTANT: Reset to allow new video detection
    console.log('[Injected] ✅ Reset complete - ready for new video');
    
    // Clear YouTube-specific manifest cache
    detectedManifests.delete('youtube-segments-detected');
    
    // Clear any manifest that contains youtube in the URL
    const keysToDelete = [];
    for (const key of detectedManifests) {
      if (typeof key === 'string' && (key.includes('youtube.com') || key.includes('googlevideo.com'))) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => detectedManifests.delete(key));
    
    console.log('[Injected] Cleared', keysToDelete.length, 'YouTube manifest entries');
    
    // FALLBACK: Poll window.ytInitialPlayerResponse as backup
    // Sometimes YouTube doesn't call API on navigation, just updates the global object
    console.log('[Injected] 🔍 Starting fallback polling for ytInitialPlayerResponse...');
    let pollAttempts = 0;
    const pollInterval = setInterval(() => {
      pollAttempts++;
      
      if (window.ytInitialPlayerResponse) {
        const currentVideoId = window.ytInitialPlayerResponse?.videoDetails?.videoId;
        const title = window.ytInitialPlayerResponse?.videoDetails?.title;
        
        console.log('[Injected] 🔎 Poll attempt', pollAttempts, '- Found videoId:', currentVideoId, 'Last:', lastExtractedVideoId);
        
        if (currentVideoId && currentVideoId !== lastExtractedVideoId) {
          clearInterval(pollInterval);
          console.log('[Injected] ✅ NEW VIDEO from ytInitialPlayerResponse polling!');
          console.log('[Injected] Title:', title);
          youtubePlayerDetected = true;
          extractYouTubeVideoInfo(window.ytInitialPlayerResponse);
          lastExtractedVideoId = currentVideoId;
        } else if (currentVideoId === lastExtractedVideoId) {
          console.log('[Injected] ⏭️ Same videoId in ytInitialPlayerResponse, continuing poll...');
        } else {
          console.log('[Injected] ⚠️ ytInitialPlayerResponse exists but no videoId found');
        }
      } else {
        console.log('[Injected] ⏳ Poll attempt', pollAttempts, '- ytInitialPlayerResponse not ready');
        console.log('[Injected] 🔍 window.ytInitialPlayerResponse:', typeof window.ytInitialPlayerResponse);
        console.log('[Injected] 🔍 window keys:', Object.keys(window).filter(k => k.toLowerCase().includes('yt')).slice(0, 10));
      }
      
      if (pollAttempts >= 20) {
        clearInterval(pollInterval);
        console.log('[Injected] ⚠️ Polling timeout after 20 attempts (10 seconds)');
      }
    }, 500);
  }
  
  // Extract YouTube video info from player response
  function extractYouTubeVideoInfo(playerResponse) {
    try {
      console.log('[Injected] ================================================');
      console.log('[Injected] 📹 EXTRACTING YOUTUBE VIDEO INFO');
      console.log('[Injected] ================================================');
      
      const streamingData = playerResponse?.streamingData;
      if (!streamingData) {
        console.log('[Injected] ❌ No streaming data in response');
        return;
      }
      
      const videoDetails = playerResponse?.videoDetails || {};
      console.log('[Injected] 📺 Video Details:', {
        videoId: videoDetails.videoId,
        title: videoDetails.title,
        duration: videoDetails.lengthSeconds,
        isLive: videoDetails.isLiveContent
      });
      const videoId = videoDetails.videoId || '';
      const title = videoDetails.title || 'YouTube Video';
      
      // ==========================================
      // AUTO-START MSE CAPTURE for YouTube videos
      // ==========================================
      if (mseCapture && !mseCapture.isCapturing) {
        const videoInfo = {
          id: videoId,
          title: title,
          duration: videoDetails.lengthSeconds,
          isLive: videoDetails.isLiveContent || false
        };
        
        console.log('[Injected] 🎬 Auto-starting MSE chunk capture...');
        mseCapture.startCapture(videoInfo);
      }
      
      // Adaptive formats (direct video URLs) - PRIORITIZE THIS!
      const formats = streamingData.adaptiveFormats || streamingData.formats || [];
      if (formats.length > 0) {
        console.log('[Injected] Found', formats.length, 'YouTube adaptive formats');
        
        // Filter formats that have direct URLs (no signatureCipher)
        const availableFormats = formats.filter(f => f.url);
        
        if (availableFormats.length === 0) {
          console.warn('[Injected] No formats with direct URLs found. Formats may require signature decoding.');
          console.log('[Injected] Sample format:', formats[0]);
          console.log('[Injected] ================================================');
          console.log('[Injected] 🔍 Checking for manifest URLs...');
          console.log('[Injected] DASH manifest URL:', streamingData.dashManifestUrl || 'NOT FOUND');
          console.log('[Injected] HLS manifest URL:', streamingData.hlsManifestUrl || 'NOT FOUND');
          console.log('[Injected] ================================================');
          
          // Only use manifest URLs as fallback if no direct URLs available
          if (streamingData.dashManifestUrl) {
            const manifestUrl = streamingData.dashManifestUrl;
            console.log('[Injected] ================================================');
            console.log('[Injected] 🔄 FALLBACK TO DASH MANIFEST');
            console.log('[Injected] URL:', manifestUrl);
            console.log('[Injected] VideoId:', videoId);
            console.log('[Injected] Title:', title);
            console.log('[Injected] ================================================');
            
            const messageData = {
              type: 'VIDEO_MANIFEST_DETECTED',
              format: 'youtube-dash',
              url: manifestUrl,
              manifest: null,
              videoInfo: {
                id: videoId,
                title: title,
                duration: videoDetails.lengthSeconds,
                isLive: videoDetails.isLiveContent || false
              }
            };
            
            console.log('[Injected] 📤 POSTING MESSAGE TO CONTENT SCRIPT:', messageData);
            window.postMessage(messageData, '*');
            console.log('[Injected] ✅ Message posted successfully');
          }
          
          if (streamingData.hlsManifestUrl) {
            const manifestUrl = streamingData.hlsManifestUrl;
            console.log('[Injected] ================================================');
            console.log('[Injected] 🔄 FALLBACK TO HLS MANIFEST');
            console.log('[Injected] URL:', manifestUrl);
            console.log('[Injected] VideoId:', videoId);
            console.log('[Injected] Title:', title);
            console.log('[Injected] ================================================');
            
            const messageData = {
              type: 'VIDEO_MANIFEST_DETECTED',
              format: 'youtube-hls',
              url: manifestUrl,
              manifest: null,
              videoInfo: {
                id: videoId,
                title: title,
                duration: videoDetails.lengthSeconds,
                isLive: videoDetails.isLiveContent || false
              }
            };
            
            console.log('[Injected] 📤 POSTING MESSAGE:', messageData);
            window.postMessage(messageData, '*');
            console.log('[Injected] ✅ Message posted successfully');
          }
          
          // If no manifests found, send the page URL as fallback
          if (!streamingData.dashManifestUrl && !streamingData.hlsManifestUrl) {
            console.log('[Injected] ================================================');
            console.log('[Injected] ⚠️ NO MANIFEST URLs FOUND!');
            console.log('[Injected] Sending YouTube page URL as fallback');
            console.log('[Injected] URL:', window.location.href);
            console.log('[Injected] VideoId:', videoId);
            console.log('[Injected] Title:', title);
            console.log('[Injected] ================================================');
            
            const messageData = {
              type: 'VIDEO_MANIFEST_DETECTED',
              format: 'youtube',
              url: window.location.href,
              manifest: null,
              videoInfo: {
                id: videoId,
                title: title,
                duration: videoDetails.lengthSeconds,
                isLive: videoDetails.isLiveContent || false,
                note: 'Formats require signature decoding - download via yt-dlp or similar tool'
              }
            };
            
            console.log('[Injected] 📤 POSTING MESSAGE:', messageData);
            window.postMessage(messageData, '*');
            console.log('[Injected] ✅ Message posted successfully');
          }
          
          return; // Exit early if no direct URLs
        }
        
        // Send formats info with direct URLs
        console.log('[Injected] Sending', availableFormats.length, 'YouTube formats with direct URLs');
        
        const messageData = {
          type: 'VIDEO_MANIFEST_DETECTED',
          format: 'youtube',
          url: window.location.href,
          manifest: null,
          videoInfo: {
            id: videoId,
            title: title,
            duration: videoDetails.lengthSeconds,
            isLive: videoDetails.isLiveContent || false,
            dashManifestUrl: streamingData.dashManifestUrl || null,
            hlsManifestUrl: streamingData.hlsManifestUrl || null,
            formats: availableFormats.map(f => ({
              itag: f.itag,
              url: f.url,
              quality: f.quality,
              qualityLabel: f.qualityLabel,
              mimeType: f.mimeType,
              bitrate: f.bitrate,
              width: f.width,
              height: f.height,
              fps: f.fps,
              hasVideo: f.mimeType?.includes('video'),
              hasAudio: f.mimeType?.includes('audio')
            }))
          }
        };
        
        console.log('[Injected] ================================================');
        console.log('[Injected] 📤 POSTING YOUTUBE VIDEO MESSAGE');
        console.log('[Injected] Format: youtube');
        console.log('[Injected] VideoId:', videoId);
        console.log('[Injected] Title:', title);
        console.log('[Injected] Formats:', availableFormats.length);
        console.log('[Injected] ================================================');
        
        window.postMessage(messageData, '*');
        console.log('[Injected] ✅ Message posted to content script');
      } else {
        console.warn('[Injected] No YouTube formats found in streamingData');
        
        // Try manifest URLs as last resort
        if (streamingData.dashManifestUrl) {
          const manifestUrl = streamingData.dashManifestUrl;
          console.log('[Injected] No formats, using YouTube DASH manifest:', manifestUrl);
          
          window.postMessage({
            type: 'VIDEO_MANIFEST_DETECTED',
            format: 'youtube-dash',
            url: manifestUrl,
            manifest: null,
            videoInfo: {
              id: videoId,
              title: title,
              duration: videoDetails.lengthSeconds,
              isLive: videoDetails.isLiveContent || false
            }
          }, '*');
        }
      }
    } catch (error) {
      console.error('[Injected] Error extracting YouTube video info:', error);
    }
  }
  
  // Method 3: Monitor for ytInitialPlayerResponse changes
  let lastVideoId = null;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    set: function(value) {
      console.log('[Injected] ytInitialPlayerResponse setter called');
      this._ytInitialPlayerResponse = value;
      
      // Check if this is a new video by comparing videoId
      const newVideoId = value?.videoDetails?.videoId;
      if (value && newVideoId) {
        if (newVideoId !== lastVideoId) {
          console.log('[Injected] New video detected:', newVideoId, 'Previous:', lastVideoId);
          lastVideoId = newVideoId;
          
          // Reset detection for new video
          if (youtubePlayerDetected) {
            resetYouTubeDetection();
          }
          
          youtubePlayerDetected = true;
          console.log('[Injected] Extracting from setter (new video)');
          extractYouTubeVideoInfo(value);
        } else {
          console.log('[Injected] Same video, skipping:', newVideoId);
        }
      }
    },
    get: function() {
      return this._ytInitialPlayerResponse;
    },
    configurable: true
  });
  
  // Method 4: Monitor video element src changes
  const originalSetAttribute = HTMLVideoElement.prototype.setAttribute;
  HTMLVideoElement.prototype.setAttribute = function(name, value) {
    if (name === 'src' && value && window.location.hostname.includes('youtube.com')) {
      console.log('[Injected] Video element src set:', value.substring(0, 100));
      if (!youtubePlayerDetected) {
        setTimeout(() => {
          if (window.ytInitialPlayerResponse) {
            extractYouTubeVideoInfo(window.ytInitialPlayerResponse);
          }
        }, 500);
      }
    }
    return originalSetAttribute.call(this, name, value);
  };
  
  // Method 5: Override video.src property
  const videoSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (videoSrcDescriptor && videoSrcDescriptor.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      set: function(value) {
        if (value && window.location.hostname.includes('youtube.com')) {
          console.log('[Injected] Video src property set:', value.substring(0, 100));
          if (!youtubePlayerDetected) {
            setTimeout(() => {
              if (window.ytInitialPlayerResponse) {
                extractYouTubeVideoInfo(window.ytInitialPlayerResponse);
              }
            }, 500);
          }
        }
        return videoSrcDescriptor.set.call(this, value);
      },
      get: videoSrcDescriptor.get,
      configurable: true
    });
  }
  
  // Start YouTube detection if on YouTube
  if (window.location.hostname.includes('youtube.com')) {
    console.log('[Injected] 🎬 YouTube detected - API interceptor mode');
    console.log('[Injected] 🔍 Checking if ytInitialPlayerResponse exists:', !!window.ytInitialPlayerResponse);
    
    if (window.ytInitialPlayerResponse) {
      const videoId = window.ytInitialPlayerResponse?.videoDetails?.videoId;
      console.log('[Injected] 📺 Found ytInitialPlayerResponse on page load, videoId:', videoId);
    }
    
    // Track URL changes to detect video navigation
    let lastYouTubeUrl = location.href;
    
    // Method 1: Listen to yt-navigate-finish event (primary)
    window.addEventListener('yt-navigate-finish', () => {
      const currentUrl = location.href;
      console.log('[Injected] 🔄 yt-navigate-finish event - URL:', currentUrl);
      
      if (currentUrl !== lastYouTubeUrl) {
        console.log('[Injected] 🎥 Video changed via event');
        lastYouTubeUrl = currentUrl;
        resetYouTubeDetection();
      }
    });
    
    // Method 2: Monitor URL changes (fallback)
    const urlCheckInterval = setInterval(() => {
      const currentUrl = location.href;
      if (currentUrl !== lastYouTubeUrl && currentUrl.includes('/watch?v=')) {
        console.log('[Injected] 🎥 Video changed via URL polling');
        console.log('[Injected] Old URL:', lastYouTubeUrl);
        console.log('[Injected] New URL:', currentUrl);
        lastYouTubeUrl = currentUrl;
        resetYouTubeDetection();
      }
    }, 500);
    
    // Method 3: MutationObserver on title/page (additional fallback)
    const titleElement = document.querySelector('title');
    if (titleElement) {
      const observer = new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== lastYouTubeUrl && currentUrl.includes('/watch?v=')) {
          console.log('[Injected] 🎥 Video changed via MutationObserver');
          lastYouTubeUrl = currentUrl;
          resetYouTubeDetection();
        }
      });
      
      observer.observe(titleElement, { 
        childList: true, 
        subtree: true 
      });
      console.log('[Injected] ✅ MutationObserver installed on <title>');
    } else {
      console.log('[Injected] ⚠️ Title element not found, skipping MutationObserver');
    }
    
    console.log('[Injected] ⏳ Waiting for YouTube player API calls...');
    console.log('[Injected] 📍 Current URL:', lastYouTubeUrl);
    
    // Initial detection on page load
    if (lastYouTubeUrl.includes('/watch?v=')) {
      console.log('[Injected] 🎬 Video page detected on load, starting initial detection in 1 second');
      setTimeout(() => {
        console.log('[Injected] ⚡ Triggering initial video detection...');
        resetYouTubeDetection();
      }, 1000);
    } else {
      console.log('[Injected] ℹ️ Not on video page, waiting for navigation...');
    }
  } else {
    console.log('[Injected] ℹ️ Not on YouTube, skipping YouTube detection');
  }
  
  // ==========================================
  // MSE Chunk Capture - Message Handlers
  // ==========================================
  
  window.addEventListener('message', (event) => {
    // Only accept messages from same window
    if (event.source !== window) return;
    
    const message = event.data;
    
    // Start capturing when video is detected
    if (message.type === 'START_MSE_CAPTURE' && mseCapture) {
      console.log('[MSE Capture] 📥 Received START_MSE_CAPTURE command');
      mseCapture.startCapture(message.videoInfo);
    }
    
    // Stop capturing
    if (message.type === 'STOP_MSE_CAPTURE' && mseCapture) {
      console.log('[MSE Capture] 📥 Received STOP_MSE_CAPTURE command');
      const capturedData = mseCapture.stopCapture();
      
      window.postMessage({
        type: 'MSE_CAPTURE_STOPPED',
        data: capturedData
      }, '*');
    }
    
    // Download captured chunks
    if (message.type === 'DOWNLOAD_MSE_CHUNKS' && mseCapture) {
      console.log('[MSE Capture] 📥 Received DOWNLOAD_MSE_CHUNKS command');
      const videoUrl = message.videoUrl || window.location.href;
      
      // Force load full video first
      (async () => {
        try {
          // Notify extension that we're loading full video
          window.postMessage({
            type: 'MSE_LOADING_FULL_VIDEO',
            status: 'started',
            videoUrl: videoUrl
          }, '*');
          
          console.log('[MSE Capture] 🚀 Step 1: Force loading full video...');
          const loadSuccess = await mseCapture.forceLoadFullVideo(videoUrl);
          
          if (!loadSuccess) {
            throw new Error('Failed to load full video');
          }
          
          console.log('[MSE Capture] ✅ Step 2: Full video loaded, proceeding to merge...');
          
          window.postMessage({
            type: 'MSE_LOADING_FULL_VIDEO',
            status: 'completed',
            videoUrl: videoUrl
          }, '*');
          
          // CRITICAL: Wait a bit longer before stopping capture to ensure
          // all chunks (especially final ones) have been appended
          console.log('[MSE Capture] ⏳ Waiting 2s before stopping capture to ensure all chunks appended...');
          const chunksBeforeStop = mseCapture.videoChunks.length + mseCapture.audioChunks.length;
          await new Promise(resolve => setTimeout(resolve, 2000));
          const chunksAfterStop = mseCapture.videoChunks.length + mseCapture.audioChunks.length;
          console.log('[MSE Capture] 📊 Final chunk count:', chunksAfterStop, '(+', (chunksAfterStop - chunksBeforeStop), 'chunks during wait)');
          
          const capturedData = mseCapture.stopCapture();
          
          console.log('[MSE Capture] 📦 Merging chunks...');
          console.log('[MSE Capture] Video chunks:', capturedData.videoChunks.length);
          console.log('[MSE Capture] Audio chunks:', capturedData.audioChunks.length);
          
          // Merge video chunks
          let videoBlob = null;
          if (capturedData.videoChunks.length > 0) {
            const videoSize = capturedData.videoChunks.reduce((sum, c) => sum + c.byteLength, 0);
            console.log('[MSE Capture] Total video size:', videoSize, 'bytes');
            
            const mergedVideo = new Uint8Array(videoSize);
            let offset = 0;
            for (const chunk of capturedData.videoChunks) {
              mergedVideo.set(chunk, offset);
            offset += chunk.byteLength;
          }
          
          videoBlob = new Blob([mergedVideo], { type: capturedData.videoMimeType || 'video/mp4' });
          console.log('[MSE Capture] ✅ Video blob created:', videoBlob.size, 'bytes');
        }
        
        // Merge audio chunks
        let audioBlob = null;
        if (capturedData.audioChunks.length > 0) {
          const audioSize = capturedData.audioChunks.reduce((sum, c) => sum + c.byteLength, 0);
          console.log('[MSE Capture] Total audio size:', audioSize, 'bytes');
          
          const mergedAudio = new Uint8Array(audioSize);
          let offset = 0;
          for (const chunk of capturedData.audioChunks) {
            mergedAudio.set(chunk, offset);
            offset += chunk.byteLength;
          }
          
          audioBlob = new Blob([mergedAudio], { type: capturedData.audioMimeType || 'audio/mp4' });
          console.log('[MSE Capture] ✅ Audio blob created:', audioBlob.size, 'bytes');
        }
        
        // Create download links
        const timestamp = Date.now();
        // Fix filename encoding - properly handle Vietnamese and special characters
        const safeTitle = (capturedData.videoInfo?.title || 'youtube_video')
          .normalize('NFD') // Decompose characters
          .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
          .replace(/[^a-zA-Z0-9\s_-]/g, '_') // Replace non-alphanumeric with underscore
          .replace(/\s+/g, '_') // Replace spaces with underscore
          .replace(/_+/g, '_') // Replace multiple underscores with single
          .substring(0, 50);
        
        if (videoBlob) {
          const videoUrl = URL.createObjectURL(videoBlob);
          const videoLink = document.createElement('a');
          videoLink.href = videoUrl;
          videoLink.download = `${safeTitle}_video_${timestamp}.mp4`;
          videoLink.style.display = 'none';
          document.body.appendChild(videoLink);
          videoLink.click();
          document.body.removeChild(videoLink);
          
          console.log('[MSE Capture] 📥 Video download triggered:', videoLink.download);
          
          // Clean up blob URL after delay
          setTimeout(() => URL.revokeObjectURL(videoUrl), 5000);
        }
        
        if (audioBlob) {
          const audioUrl = URL.createObjectURL(audioBlob);
          const audioLink = document.createElement('a');
          audioLink.href = audioUrl;
          audioLink.download = `${safeTitle}_audio_${timestamp}.m4a`;
          audioLink.style.display = 'none';
          document.body.appendChild(audioLink);
          
          // Delay audio download slightly to avoid browser blocking
          setTimeout(() => {
            audioLink.click();
            document.body.removeChild(audioLink);
            console.log('[MSE Capture] 📥 Audio download triggered:', audioLink.download);
            
            // Clean up
            setTimeout(() => URL.revokeObjectURL(audioUrl), 5000);
          }, 500);
        }
        
        window.postMessage({
          type: 'MSE_DOWNLOAD_SUCCESS',
          videoUrl: videoUrl,
          videoSize: videoBlob?.size || 0,
          audioSize: audioBlob?.size || 0,
          filename: safeTitle,
          videoChunks: capturedData.videoChunks.length,
          audioChunks: capturedData.audioChunks.length
        }, '*');
        
        console.log('[MSE Capture] ✅ Download completed successfully!');
        
        } catch (error) {
          console.error('[MSE Capture] ❌ Download error:', error);
          
          window.postMessage({
            type: 'MSE_DOWNLOAD_ERROR',
            videoUrl: videoUrl,
            error: error.message
          }, '*');
        }
      })();
    }
    
    // Get capture status
    if (message.type === 'GET_MSE_STATUS' && mseCapture) {
      window.postMessage({
        type: 'MSE_STATUS_RESPONSE',
        status: mseCapture.getProgress()
      }, '*');
    }
  });
  
  console.log('[Injected] ✅ Video Download Helper injected script fully loaded');
})();

