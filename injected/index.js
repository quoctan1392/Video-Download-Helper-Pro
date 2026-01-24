/**
 * Video Download Helper - Injected Script Entry Point
 * Coordinates all detectors and downloaders
 */

(function() {
  'use strict';

  console.log('[VideoDownloader] ========================================');
  console.log('[VideoDownloader] 🚀 Initializing Video Download Helper');
  console.log('[VideoDownloader] Version: 2.0 (Refactored)');
  console.log('[VideoDownloader] Page:', window.location.href);
  console.log('[VideoDownloader] ========================================');

  // Initialize Message Bus
  if (window.VDMessageBus) {
    window.VDMessageBus.init();
  }

  // Initialize Network Interceptors
  if (window.VDInterceptors) {
    window.VDInterceptors.init();
  }

  // Initialize Detectors
  const detectors = [];

  // YouTube Detector (only on YouTube)
  if (window.location.hostname.includes('youtube.com')) {
    if (window.VDYouTubeDetector) {
      const youtubeDetector = new window.VDYouTubeDetector();
      youtubeDetector.init();
      detectors.push(youtubeDetector);
      
      // Initialize MSE Downloader for YouTube
      if (window.VDMSEDownloader) {
        const mseDownloader = new window.VDMSEDownloader();
        mseDownloader.init();
        window.mseCapture = mseDownloader; // For backward compatibility
        
        // Auto-start capture when YouTube video is detected
        window.VDMessageBus.on('VIDEO_MANIFEST_DETECTED', (message) => {
          if (message.format === 'youtube' && message.videoInfo && !mseDownloader.isCapturing) {
            window.VDLogger?.log('🎬 Auto-starting MSE capture for YouTube video...');
            mseDownloader.startCapture(message.videoInfo);
          }
        });
      }
    }
  }

  // DASH Detector
  if (window.VDDASHDetector) {
    const dashDetector = new window.VDDASHDetector();
    dashDetector.init();
    detectors.push(dashDetector);
  }

  // HLS Detector
  if (window.VDHLSDetector) {
    const hlsDetector = new window.VDHLSDetector();
    hlsDetector.init();
    detectors.push(hlsDetector);
  }

  // MPD Detector
  if (window.VDMPDDetector) {
    const mpdDetector = new window.VDMPDDetector();
    mpdDetector.init();
    detectors.push(mpdDetector);
  }

  // ==========================================
  // Message Handlers from Content Script
  // ==========================================

  window.VDMessageBus.on('START_MSE_CAPTURE', (data) => {
    if (window.mseCapture) {
      window.VDLogger?.log('📥 Received START_MSE_CAPTURE command');
      window.mseCapture.startCapture(data.videoInfo);
    }
  });

  window.VDMessageBus.on('STOP_MSE_CAPTURE', () => {
    if (window.mseCapture) {
      window.VDLogger?.log('📥 Received STOP_MSE_CAPTURE command');
      const capturedData = window.mseCapture.stopCapture();

      window.VDMessageBus.sendToContentScript({
        type: 'MSE_CAPTURE_STOPPED',
        data: capturedData
      });
    }
  });

  window.VDMessageBus.on('DOWNLOAD_MSE_CHUNKS', async (data) => {
    if (!window.mseCapture) return;

    window.VDLogger?.log('📥 Received DOWNLOAD_MSE_CHUNKS command');
    const videoUrl = data.videoUrl || window.location.href;

    try {
      // Notify extension that we're loading full video
      window.VDMessageBus.sendToContentScript({
        type: 'MSE_LOADING_FULL_VIDEO',
        status: 'started',
        videoUrl: videoUrl
      });

      window.VDLogger?.log('🚀 Step 1: Force loading full video...');
      const loadSuccess = await window.mseCapture.forceLoadFullVideo(videoUrl);

      if (!loadSuccess) {
        throw new Error('Failed to load full video');
      }

      window.VDLogger?.log('✅ Step 2: Full video loaded, proceeding to merge...');

      window.VDMessageBus.sendToContentScript({
        type: 'MSE_LOADING_FULL_VIDEO',
        status: 'completed',
        videoUrl: videoUrl
      });

      // CRITICAL: Wait longer before stopping capture to ensure
      // all chunks (especially final ones) have been appended by YouTube's API
      window.VDLogger?.log('⏳ Step 3: Waiting for final chunks to be appended...');
      let totalExtraWait = 0;
      let lastChunkCount = window.mseCapture.videoChunks.length + window.mseCapture.audioChunks.length;
      
      // Wait in intervals and check if still receiving chunks
      for (let i = 0; i < 3; i++) {
        const waitTime = i === 0 ? 2000 : 1500; // 2s first, then 1.5s increments
        window.VDLogger?.log(`⏳ Waiting ${waitTime}ms (round ${i + 1}/3)...`);
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
        totalExtraWait += waitTime;
        
        const currentChunkCount = window.mseCapture.videoChunks.length + window.mseCapture.audioChunks.length;
        const newChunks = currentChunkCount - lastChunkCount;
        
        window.VDLogger?.log(`📊 Chunks: ${currentChunkCount} (+${newChunks} new)`);
        
        // If no new chunks in last 2 rounds, we're done
        if (i > 0 && newChunks === 0) {
          window.VDLogger?.success('✅ No new chunks, capture complete');
          break;
        }
        
        lastChunkCount = currentChunkCount;
      }
      
      window.VDLogger?.log(`📊 Total extra wait time: ${totalExtraWait}ms`);
      window.VDLogger?.log(`📊 Final chunk count: ${lastChunkCount} (video: ${window.mseCapture.videoChunks.length}, audio: ${window.mseCapture.audioChunks.length})`);

      const capturedData = window.mseCapture.stopCapture();

      // Merge and download
      await downloadCapturedChunks(capturedData, videoUrl);

    } catch (error) {
      window.VDLogger?.error('❌ Download error:', error);

      window.VDMessageBus.sendToContentScript({
        type: 'MSE_DOWNLOAD_ERROR',
        videoUrl: videoUrl,
        error: error.message
      });
    }
  });

  window.VDMessageBus.on('GET_MSE_STATUS', () => {
    if (window.mseCapture) {
      window.VDMessageBus.sendToContentScript({
        type: 'MSE_STATUS_RESPONSE',
        status: window.mseCapture.getProgress()
      });
    }
  });

  // ==========================================
  // Helper Functions
  // ==========================================

  /**
   * Download captured MSE chunks
   */
  async function downloadCapturedChunks(capturedData, videoUrl) {
    window.VDLogger?.log('📦 Merging chunks...');
    window.VDLogger?.log('Video chunks:', capturedData.videoChunks.length);
    window.VDLogger?.log('Audio chunks:', capturedData.audioChunks.length);

    // Merge video chunks
    let videoBlob = null;
    if (capturedData.videoChunks.length > 0) {
      const videoSize = capturedData.videoChunks.reduce((sum, c) => sum + c.byteLength, 0);
      const mergedVideo = new Uint8Array(videoSize);
      let offset = 0;

      for (const chunk of capturedData.videoChunks) {
        mergedVideo.set(chunk, offset);
        offset += chunk.byteLength;
      }

      videoBlob = new Blob([mergedVideo], { type: capturedData.videoMimeType || 'video/mp4' });
      window.VDLogger?.success('Video blob created:', videoBlob.size, 'bytes');
    }

    // Merge audio chunks
    let audioBlob = null;
    if (capturedData.audioChunks.length > 0) {
      const audioSize = capturedData.audioChunks.reduce((sum, c) => sum + c.byteLength, 0);
      const mergedAudio = new Uint8Array(audioSize);
      let offset = 0;

      for (const chunk of capturedData.audioChunks) {
        mergedAudio.set(chunk, offset);
        offset += chunk.byteLength;
      }

      audioBlob = new Blob([mergedAudio], { type: capturedData.audioMimeType || 'audio/mp4' });
      window.VDLogger?.success('Audio blob created:', audioBlob.size, 'bytes');
    }

    // Create safe filename
    const timestamp = Date.now();
    const safeTitle = (capturedData.videoInfo?.title || 'youtube_video')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s_-]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 50);

    // Download video
    if (videoBlob) {
      const videoUrl = URL.createObjectURL(videoBlob);
      const videoLink = document.createElement('a');
      videoLink.href = videoUrl;
      videoLink.download = `${safeTitle}_video_${timestamp}.mp4`;
      videoLink.style.display = 'none';
      document.body.appendChild(videoLink);
      videoLink.click();
      document.body.removeChild(videoLink);

      window.VDLogger?.success('📥 Video download triggered:', videoLink.download);
      setTimeout(() => URL.revokeObjectURL(videoUrl), 5000);
    }

    // Download audio
    if (audioBlob) {
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioLink = document.createElement('a');
      audioLink.href = audioUrl;
      audioLink.download = `${safeTitle}_audio_${timestamp}.m4a`;
      audioLink.style.display = 'none';
      document.body.appendChild(audioLink);

      setTimeout(() => {
        audioLink.click();
        document.body.removeChild(audioLink);
        window.VDLogger?.success('📥 Audio download triggered:', audioLink.download);
        setTimeout(() => URL.revokeObjectURL(audioUrl), 5000);
      }, 500);
    }

    // Notify success
    window.VDMessageBus.sendToContentScript({
      type: 'MSE_DOWNLOAD_SUCCESS',
      videoUrl: videoUrl,
      videoSize: videoBlob?.size || 0,
      audioSize: audioBlob?.size || 0,
      filename: safeTitle,
      videoChunks: capturedData.videoChunks.length,
      audioChunks: capturedData.audioChunks.length
    });

    window.VDLogger?.success('✅ Download completed!');
  }

  // ==========================================
  // Ready
  // ==========================================

  window.VDLogger?.log('========================================');
  window.VDLogger?.success('✅ Video Download Helper Ready');
  window.VDLogger?.log('Active Detectors:', detectors.map(d => d.name).join(', '));
  window.VDLogger?.log('========================================');

})();
