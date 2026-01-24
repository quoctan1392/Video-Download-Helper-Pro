/**
 * MSE Downloader - MediaSource Extension video chunk capture
 * Captures and downloads video using MSE API (primarily for YouTube)
 */

class MSEDownloader {
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

    window.VDLogger?.log('MSE Downloader initialized');
  }

  /**
   * Start capturing video chunks
   * @param {Object} videoInfo - Video metadata
   */
  startCapture(videoInfo) {
    this.videoChunks = [];
    this.audioChunks = [];
    this.currentVideoInfo = videoInfo;
    this.isCapturing = true;
    this.captureStartTime = Date.now();
    this.videoDuration = videoInfo?.duration || 0;

    window.VDLogger?.log('========================================');
    window.VDLogger?.success('🎬 STARTED CAPTURING');
    window.VDLogger?.log('Video:', videoInfo?.title || 'Unknown');
    window.VDLogger?.log('VideoId:', videoInfo?.id || 'Unknown');
    window.VDLogger?.log('Duration:', this.videoDuration, 'seconds');
    window.VDLogger?.log('========================================');

    // Notify extension
    window.VDMessageBus?.sendToContentScript({
      type: 'MSE_CAPTURE_STARTED',
      videoInfo: videoInfo
    });
  }

  /**
   * Force video to load completely by seeking through it
   * @param {string} videoUrl - Video URL for progress tracking
   * @returns {Promise<boolean>} Success status
   */
  async forceLoadFullVideo(videoUrl = null) {
    window.VDLogger?.log('========================================');
    window.VDLogger?.log('🚀 FORCING FULL VIDEO LOAD');
    window.VDLogger?.log('========================================');

    const video = document.querySelector('video');
    if (!video) {
      window.VDLogger?.error('❌ Video element not found!');
      return false;
    }

    this.videoElement = video;
    this.autoSeekInProgress = true;

    const duration = video.duration || this.videoDuration;
    if (!duration || duration === 0) {
      window.VDLogger?.error('❌ Video duration is 0 or unknown');
      return false;
    }

    window.VDLogger?.log('📏 Video duration:', duration, 'seconds');
    window.VDLogger?.log('🎯 Will seek through video to force chunk loading...');

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
    // STRATEGY: Denser intervals for better coverage
    let segmentDuration;
    if (duration <= 120) {
      segmentDuration = 5; // Short videos (≤2 min): 5s intervals for maximum coverage
    } else if (duration <= 600) {
      segmentDuration = 8; // Medium videos (2-10 min): 8s intervals
    } else if (duration <= 1800) {
      segmentDuration = 10; // Long videos (10-30 min): 10s intervals (was 15s - too sparse!)
    } else {
      segmentDuration = 15; // Very long videos (>30 min): 15s intervals (was 20s)
    }

    // Calculate number of segments and generate seek points
    const numSegments = Math.ceil(duration / segmentDuration);
    const seekPoints = [];

    // Always start from 0
    seekPoints.push(0);

    // Add intermediate points - evenly distributed
    for (let i = 1; i < numSegments; i++) {
      const seekTime = (duration / numSegments) * i;
      seekPoints.push(Math.floor(seekTime));
    }

    // CRITICAL: Always seek to the very end (duration - 0.1s)
    const finalSeekPoint = Math.max(duration - 0.1, 0);
    if (seekPoints[seekPoints.length - 1] < finalSeekPoint - 1) {
      seekPoints.push(finalSeekPoint);
    } else {
      seekPoints[seekPoints.length - 1] = finalSeekPoint;
    }

    window.VDLogger?.log('📍 Video length:', duration.toFixed(1), 's');
    window.VDLogger?.log('📍 Segment duration:', segmentDuration, 's');
    window.VDLogger?.log('📍 Number of segments:', numSegments);
    window.VDLogger?.log('📍 Total seek points:', seekPoints.length);
    window.VDLogger?.log('📍 First 10 points:', seekPoints.slice(0, 10).map(t => t.toFixed(1) + 's').join(', '));
    window.VDLogger?.log('📍 Last 10 points:', seekPoints.slice(-10).map(t => t.toFixed(1) + 's').join(', '));

    // Seek through all points
    for (let i = 0; i < seekPoints.length; i++) {
      const seekTime = seekPoints[i];

      window.VDLogger?.log('⏩ Seeking to', seekTime.toFixed(1), 's (', (i + 1), '/', seekPoints.length, ')');

      video.currentTime = seekTime;

      // Wait for seek to complete and buffer to load
      await new Promise(resolve => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);

          // More wait time for final and near-final seeks to ensure last chunks
          const isFinalSeek = (i === seekPoints.length - 1);
          const isNearFinal = (i >= seekPoints.length - 5); // Last 5 seeks
          
          let waitTime;
          if (isFinalSeek) {
            waitTime = 3000; // 3s for absolute final seek
          } else if (isNearFinal) {
            waitTime = 1500; // 1.5s for near-final seeks
          } else {
            waitTime = 800; // 800ms for regular seeks
          }

          window.VDLogger?.log('⏸️ Waiting', waitTime, 'ms for chunks to load', 
            isFinalSeek ? '(FINAL SEEK)' : isNearFinal ? '(NEAR FINAL)' : '');
          setTimeout(resolve, waitTime);
        };

        video.addEventListener('seeked', onSeeked);

        // Timeout after 8 seconds if seek doesn't complete
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          window.VDLogger?.warn('⚠️ Seek timeout at', seekTime);
          resolve();
        }, 8000);
      });

      // Progress update
      const progress = ((i + 1) / seekPoints.length) * 100;
      window.VDMessageBus?.sendToContentScript({
        type: 'MSE_LOAD_PROGRESS',
        videoUrl: videoUrl || window.location.href,
        progress: progress,
        currentSegment: i + 1,
        totalSegments: seekPoints.length,
        currentTime: seekTime
      });
    }

    // CRITICAL: Wait extra time after all seeks for final chunks
    // YouTube API continues to append chunks even after all seeks complete
    window.VDLogger?.log('========================================');
    window.VDLogger?.log('⏳ WAITING FOR FINAL CHUNKS FROM YOUTUBE API');
    window.VDLogger?.log('========================================');
    
    let lastChunkCount = this.videoChunks.length + this.audioChunks.length;
    window.VDLogger?.log('📊 Initial chunks:', lastChunkCount, '(video:', this.videoChunks.length, '+ audio:', this.audioChunks.length, ')');
    
    // Wait in intervals and monitor chunk count
    let totalWaitTime = 0;
    let noNewChunksCount = 0;
    
    for (let round = 0; round < 5; round++) {
      const waitTime = round === 0 ? 3000 : 2000; // 3s first, then 2s increments
      window.VDLogger?.log(`⏳ Round ${round + 1}/5: Waiting ${waitTime}ms for chunks...`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      totalWaitTime += waitTime;
      
      const currentChunkCount = this.videoChunks.length + this.audioChunks.length;
      const newChunks = currentChunkCount - lastChunkCount;
      
      window.VDLogger?.log(`📊 Round ${round + 1}: ${currentChunkCount} chunks (+${newChunks} new)`);
      
      if (newChunks === 0) {
        noNewChunksCount++;
        // If no new chunks for 2 consecutive rounds, we're done
        if (noNewChunksCount >= 2) {
          window.VDLogger?.success('✅ No new chunks for 2 rounds, capture complete');
          break;
        }
      } else {
        noNewChunksCount = 0; // Reset counter if we got new chunks
      }
      
      lastChunkCount = currentChunkCount;
    }
    
    window.VDLogger?.log('========================================');
    window.VDLogger?.log('📊 FINAL WAIT SUMMARY');
    window.VDLogger?.log('Total wait time:', totalWaitTime, 'ms');
    window.VDLogger?.log('Final chunk count:', lastChunkCount);
    window.VDLogger?.log('Video chunks:', this.videoChunks.length);
    window.VDLogger?.log('Audio chunks:', this.audioChunks.length);
    window.VDLogger?.log('========================================');

    // Restore original state
    video.volume = originalVolume;
    video.currentTime = originalTime;

    if (wasPlaying) {
      video.play().catch(e => window.VDLogger?.log('Could not resume playback:', e));
    }

    this.autoSeekInProgress = false;

    window.VDLogger?.log('========================================');
    window.VDLogger?.success('✅ FULL VIDEO LOAD COMPLETE');
    window.VDLogger?.log('Video chunks:', this.videoChunks.length);
    window.VDLogger?.log('Audio chunks:', this.audioChunks.length);
    window.VDLogger?.log('Total size:', this.formatBytes(this.getTotalSize()));
    window.VDLogger?.log('========================================');

    return true;
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
  }

  /**
   * Stop capturing and return captured data
   */
  stopCapture() {
    this.isCapturing = false;
    const duration = Date.now() - this.captureStartTime;

    window.VDLogger?.log('========================================');
    window.VDLogger?.log('🛑 STOPPED CAPTURING');
    window.VDLogger?.log('Duration:', (duration / 1000).toFixed(1), 'seconds');
    window.VDLogger?.log('Video chunks:', this.videoChunks.length);
    window.VDLogger?.log('Audio chunks:', this.audioChunks.length);
    window.VDLogger?.log('========================================');

    return {
      videoChunks: this.videoChunks,
      audioChunks: this.audioChunks,
      videoMimeType: this.videoMimeType,
      audioMimeType: this.audioMimeType,
      videoInfo: this.currentVideoInfo
    };
  }

  /**
   * Get total size of captured chunks
   */
  getTotalSize() {
    const videoSize = this.videoChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const audioSize = this.audioChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    return videoSize + audioSize;
  }

  /**
   * Get current capture progress
   */
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

  /**
   * Hook MediaSource API to intercept chunks
   */
  hookMediaSource() {
    const self = this;

    // Check if MediaSource is available
    if (typeof MediaSource === 'undefined') {
      window.VDLogger?.warn('MediaSource API not available');
      return false;
    }

    const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;

    MediaSource.prototype.addSourceBuffer = function(mimeType) {
      window.VDLogger?.log('🎯 addSourceBuffer called:', mimeType);

      // Determine if this is video or audio
      const isVideo = mimeType.includes('video');
      const isAudio = mimeType.includes('audio');

      if (isVideo) {
        self.videoMimeType = mimeType;
        const codecMatch = mimeType.match(/codecs="([^"]+)"/);
        self.videoCodec = codecMatch ? codecMatch[1] : null;
        window.VDLogger?.log('📹 Video track detected:', mimeType);
        window.VDLogger?.log('Video codec:', self.videoCodec);
      } else if (isAudio) {
        self.audioMimeType = mimeType;
        const codecMatch = mimeType.match(/codecs="([^"]+)"/);
        self.audioCodec = codecMatch ? codecMatch[1] : null;
        window.VDLogger?.log('🔊 Audio track detected:', mimeType);
        window.VDLogger?.log('Audio codec:', self.audioCodec);
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
            const chunkCopy = new Uint8Array(chunk).slice();

            if (isVideo) {
              self.videoChunks.push(chunkCopy);
              window.VDLogger?.log('📦 Video chunk', self.videoChunks.length, ':', chunkCopy.byteLength, 'bytes');
            } else if (isAudio) {
              self.audioChunks.push(chunkCopy);
              window.VDLogger?.log('🔊 Audio chunk', self.audioChunks.length, ':', chunkCopy.byteLength, 'bytes');
            }

            // Send progress update every 10 chunks
            if ((self.videoChunks.length + self.audioChunks.length) % 10 === 0) {
              window.VDMessageBus?.sendToContentScript({
                type: 'MSE_CAPTURE_PROGRESS',
                progress: self.getProgress()
              });
            }
          } catch (err) {
            window.VDLogger?.error('❌ Error capturing chunk:', err);
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
              window.VDLogger?.error('Error in appendBufferAsync:', err);
            }
          }
          return originalAppendBufferAsync.call(this, chunk);
        };
      }

      return sourceBuffer;
    };

    window.VDLogger?.success('✅ MediaSource API hooked successfully');
    return true;
  }

  /**
   * Initialize MSE downloader
   */
  init() {
    const hooked = this.hookMediaSource();

    if (hooked) {
      window.VDLogger?.success('🎉 Ready to capture video chunks');
      // Expose to window for external control
      window.mseCapture = this;
      window.VDMSEDownloader = this;
    } else {
      window.VDLogger?.warn('Failed to hook MediaSource API');
    }

    return hooked;
  }
}

// Make available globally
window.VDMSEDownloader = MSEDownloader;
