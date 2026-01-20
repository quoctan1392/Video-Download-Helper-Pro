// Simple Background Service Worker for debugging
console.log("[Background-Simple] === SERVICE WORKER STARTING ===");

// Note: Browser-side MP4 muxing libraries (mp4box.js, etc.) don't support 
// merging separate video/audio files reliably. VWA mode uses FFmpeg instead.

// Store detected videos
const detectedVideos = new Map();

// Clear videos when tab navigates or reloads
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) { // Main frame only
    console.log('[Background-Simple] Tab navigation detected, clearing videos for tab:', details.tabId);
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

console.log('[Background-Simple] Navigation listener installed');

// Update extension badge with video count for a tab
function updateBadge(tabId) {
  try {
    if (!tabId && tabId !== 0) return;

    let count = 0;
    detectedVideos.forEach((video) => {
      if (video.tabId === tabId) count++;
    });

    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count), tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#FF0000", tabId: tabId });
    } else {
      chrome.action.setBadgeText({ text: "", tabId: tabId });
    }
  } catch (e) {
    // Ignore if chrome.action isn't available in some contexts
    console.warn("[Background-Simple] updateBadge error:", e?.message || e);
  }
}

// Basic video detector
function isVideoUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  return (
    url.includes(".mpd") ||
    url.includes(".m3u8") ||
    url.includes("video") ||
    url.includes(".mp4")
  );
}

// Simple stream processor integrated into background script
class IntegratedStreamProcessor {
  constructor() {
    console.log("[IntegratedStreamProcessor] Initialized");
    this.isDownloadCanceled = false;
    this.isPaused = false;
    this.currentVideoUrl = null; // Track current video URL for progress updates
    this.downloadStates = new Map(); // Track download progress per video URL
  }

  // Pause download for specific video URL
  pauseDownload(videoUrl) {
    console.log(
      "[IntegratedStreamProcessor] pauseDownload() called for:",
      videoUrl,
    );
    const state = this.downloadStates.get(videoUrl);
    if (state) {
      console.log("[IntegratedStreamProcessor] Current state before pause:", {
        currentSegment: state.currentSegment,
        chunksLength: state.chunks?.length,
        totalSegments: state.totalSegments,
        currentSize: state.currentSize,
        isPaused: state.isPaused,
        isCanceled: state.isCanceled,
      });
      state.isPaused = true;
      state.lastPauseTime = Date.now(); // Record pause time

      // ABORT current fetch request immediately
      if (state.abortController) {
        console.log(
          "[IntegratedStreamProcessor] 🛑 ABORTING current segment download",
        );
        state.abortController.abort();
        state.abortController = null;
      }

      this.downloadStates.set(videoUrl, state);

      // Send progress update with paused state to update UI
      // Use chunks.length (completed segments) instead of currentSegment (current index)
      const completedSegments = state.chunks?.length || 0;
      const totalSegments = state.totalSegments || 1; // Avoid division by zero
      const percent =
        completedSegments > 0 ? (completedSegments / totalSegments) * 100 : 0;

      console.log("[IntegratedStreamProcessor] 🔍 Pause calculation details:", {
        chunks: state.chunks,
        chunksIsArray: Array.isArray(state.chunks),
        chunksLength: state.chunks?.length,
        completedSegments,
        totalSegments,
        currentSize: state.currentSize,
        percent: percent.toFixed(1),
      });

      this.sendProgressUpdate(
        percent,
        "⏸️ Paused",
        `${completedSegments}/${totalSegments} segments`,
        this.formatBytes(state.currentSize),
        videoUrl,
        null,
        true, // paused = true
      );
    } else {
      console.warn(
        "[IntegratedStreamProcessor] No download state found for:",
        videoUrl,
      );
    }
  }

  // Resume download for specific video URL
  resumeDownload(videoUrl) {
    console.log("[IntegratedStreamProcessor] Resuming download:", videoUrl);
    const state = this.downloadStates.get(videoUrl);
    if (state) {
      // Calculate paused duration
      if (state.lastPauseTime) {
        state.pausedTime += Date.now() - state.lastPauseTime;
        state.lastPauseTime = null;
      }

      state.isPaused = false;

      // Create new AbortController for resumed download
      state.abortController = new AbortController();

      this.downloadStates.set(videoUrl, state);
      console.log(
        "[IntegratedStreamProcessor] Download resumed from segment",
        state.currentSegment,
      );

      // Use chunks.length (completed segments) for accurate progress
      const completedSegments = state.chunks?.length || 0;
      const percent =
        completedSegments > 0
          ? (completedSegments / state.totalSegments) * 100
          : 0;

      // Send progress update to show resumed state with paused: false
      this.sendProgressUpdate(
        percent,
        "▶️ Resuming download...",
        `${completedSegments}/${state.totalSegments} segments`,
        this.formatBytes(state.currentSize),
        videoUrl,
        null, // downloadId
        false, // paused = false (explicitly set)
      );

      // Continue download from where it was paused
      if (state.resumeCallback) {
        state.resumeCallback();
      }
    }
  }

  // Cancel current download
  cancelDownload(videoUrl) {
    console.log("[IntegratedStreamProcessor] Download canceled:", videoUrl);
    const state = this.downloadStates.get(videoUrl);
    if (state) {
      state.isCanceled = true;
      this.downloadStates.set(videoUrl, state);

      // Cancel any pending Chrome downloads
      if (state.downloadId) {
        chrome.downloads.cancel(state.downloadId).catch((err) => {
          console.log(
            "[IntegratedStreamProcessor] Could not cancel download:",
            err,
          );
        });
      }
      if (state.audioDownloadId) {
        chrome.downloads.cancel(state.audioDownloadId).catch((err) => {
          console.log(
            "[IntegratedStreamProcessor] Could not cancel audio download:",
            err,
          );
        });
      }

      // If waiting for resume (paused), reject the promise
      if (state.cancelCallback) {
        state.cancelCallback();
      }
    }

    // Send cancel progress update
    this.sendProgressUpdate(
      0,
      "❌ Download canceled",
      "Canceled",
      "",
      videoUrl,
    );
    setTimeout(() => {
      this.hideProgress(videoUrl);
      this.downloadStates.delete(videoUrl);
    }, 2000);
  }

  // Reset cancel state for new download
  resetCancelState(videoUrl) {
    const state = this.downloadStates.get(videoUrl);
    if (state) {
      state.isCanceled = false;
      state.isPaused = false;
      this.downloadStates.set(videoUrl, state);
    }
  }

  async processStream(video, options = {}) {
    const { type, url, manifest } = video;

    // Track current video URL for progress updates
    this.currentVideoUrl = url;

    console.log("[IntegratedStreamProcessor] Processing stream:", {
      type,
      url: url.substring(0, 100) + "...",
      hasManifest: !!manifest,
    });

    try {
      // For streaming protocols, parse manifest and download segments
      if (type === "dash" || type === "hls" || type === "mpd") {
        return await this.handleStreamingProtocol(video, options);
      } else {
        // Direct video file download
        return await this.directDownload(url, options);
      }
    } catch (error) {
      console.error("[IntegratedStreamProcessor] Processing error:", error);
      // Fallback to manifest download
      return await this.downloadManifestFallback(video, options);
    }
  }

  async handleStreamingProtocol(video, options) {
    const { type, url, manifest } = video;

    console.log(
      "[IntegratedStreamProcessor] Handling streaming protocol:",
      type,
    );

    try {
      // Fetch manifest if not provided
      let manifestContent = manifest;
      if (!manifestContent) {
        console.log("[IntegratedStreamProcessor] Fetching manifest...");
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch manifest: ${response.statusText}`);
        }
        manifestContent = await response.text();
      }

      console.log(
        `[IntegratedStreamProcessor] Manifest fetched: ${manifestContent.length} characters`,
      );

      // Parse manifest to get segments
      const segments = await this.extractSegments(manifestContent, url, type);

      console.log(
        `[IntegratedStreamProcessor] Extracted ${segments.length} segments`,
      );

      if (!segments || (segments.length === 0 && !segments.separateStreams)) {
        console.warn(
          "[IntegratedStreamProcessor] No segments found, using fallback",
        );
        return await this.downloadManifestFallback(video, options);
      }

      // Handle separate audio/video streams
      if (segments.separateStreams) {
        return await this.downloadSeparateStreams(segments, type, url, options);
      }

      // For service worker, we'll merge segments into blob URL and download
      return await this.downloadAndMergeSegments(segments, type, url);
    } catch (error) {
      console.error(
        "[IntegratedStreamProcessor] Streaming protocol error:",
        error,
      );
      return await this.downloadManifestFallback(video, options);
    }
  }

  async extractSegments(manifest, baseUrl, type) {
    console.log(`[IntegratedStreamProcessor] Extracting ${type} segments...`);

    const segments = [];

    if (type === "hls") {
      // Parse HLS manifest
      const lines = manifest.split("\n").filter((line) => line.trim());

      // Check for master playlist
      let isMasterPlaylist = false;
      let bestVariantUrl = null;
      let bestBandwidth = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          isMasterPlaylist = true;
          const bandwidthMatch = line.match(/BANDWIDTH=([0-9]+)/);
          const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0;

          if (i + 1 < lines.length && bandwidth > bestBandwidth) {
            bestVariantUrl = this.resolveUrl(baseUrl, lines[i + 1].trim());
            bestBandwidth = bandwidth;
          }
        }
      }

      // If master playlist, fetch best variant
      if (isMasterPlaylist && bestVariantUrl) {
        console.log(
          `[IntegratedStreamProcessor] Fetching best variant: ${bestVariantUrl}`,
        );
        const variantResponse = await fetch(bestVariantUrl);
        const variantManifest = await variantResponse.text();
        return this.extractSegments(variantManifest, bestVariantUrl, type);
      }

      // Parse media playlist
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("#") && trimmed.length > 0) {
          const segmentUrl = this.resolveUrl(baseUrl, trimmed);
          segments.push(segmentUrl);
        }
      }
    } else if (type === "dash" || type === "mpd") {
      // Parse DASH manifest
      console.log("[IntegratedStreamProcessor] Parsing DASH manifest...");

      // Check for Cloudflare Stream
      const isCloudflareStream =
        baseUrl.includes("cloudflarestream.com") ||
        baseUrl.includes("videodelivery.net");

      if (isCloudflareStream) {
        console.log("[IntegratedStreamProcessor] Detected Cloudflare Stream");

        // Extract duration
        const durationMatch = manifest.match(
          /mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?(?:([0-9.]+)S)?"/,
        );
        let duration = 0;
        if (durationMatch) {
          const hours = parseInt(durationMatch[1] || 0);
          const minutes = parseInt(durationMatch[2] || 0);
          const seconds = parseFloat(durationMatch[3] || 0);
          duration = hours * 3600 + minutes * 60 + seconds;
        }

        console.log(`[IntegratedStreamProcessor] Video duration: ${duration}s`);

        // Find BOTH video and audio AdaptationSets
        const videoAdaptationSet = manifest.match(
          /<AdaptationSet[^>]*mimeType="video[^"]*"[^>]*>[\s\S]*?<\/AdaptationSet>/i,
        );
        const audioAdaptationSet = manifest.match(
          /<AdaptationSet[^>]*mimeType="audio[^"]*"[^>]*>[\s\S]*?<\/AdaptationSet>/i,
        );

        console.log(
          `[IntegratedStreamProcessor] Found video: ${!!videoAdaptationSet}, audio: ${!!audioAdaptationSet}`,
        );

        const videoSegments = [];
        const audioSegments = [];

        // Process VIDEO AdaptationSet
        if (videoAdaptationSet) {
          const videoResult = this.parseAdaptationSet(
            videoAdaptationSet[0],
            baseUrl,
            duration,
            "video",
          );
          if (videoResult.segments.length > 0) {
            videoSegments.push(...videoResult.segments);
            console.log(
              `[IntegratedStreamProcessor] Video: ${videoSegments.length} segments, quality: ${videoResult.quality}`,
            );
          }
        }

        // Process AUDIO AdaptationSet
        if (audioAdaptationSet) {
          const audioResult = this.parseAdaptationSet(
            audioAdaptationSet[0],
            baseUrl,
            duration,
            "audio",
          );
          if (audioResult.segments.length > 0) {
            audioSegments.push(...audioResult.segments);
            console.log(
              `[IntegratedStreamProcessor] Audio: ${audioSegments.length} segments, quality: ${audioResult.quality}`,
            );
          }
        }

        // Return combined segments or separate streams
        if (videoSegments.length > 0 && audioSegments.length > 0) {
          console.log(
            "[IntegratedStreamProcessor] Found both video and audio - will download separately",
          );
          return {
            video: videoSegments,
            audio: audioSegments,
            separateStreams: true,
          };
        } else if (videoSegments.length > 0) {
          console.log("[IntegratedStreamProcessor] Found video only");
          segments.push(...videoSegments);
        } else if (audioSegments.length > 0) {
          console.log("[IntegratedStreamProcessor] Found audio only");
          segments.push(...audioSegments);
        }
      } else {
        // Generic DASH parsing
        const segmentUrls = manifest.match(/<SegmentURL[^>]*media="([^"]+)"/gi);
        if (segmentUrls) {
          for (const match of segmentUrls) {
            const urlMatch = match.match(/media="([^"]+)"/);
            if (urlMatch) {
              segments.push(this.resolveUrl(baseUrl, urlMatch[1]));
            }
          }
        }
      }
    }

    console.log(
      `[IntegratedStreamProcessor] Extracted ${segments.length} segments`,
    );
    return segments;
  }

  parseAdaptationSet(adaptationSetContent, baseUrl, duration, type) {
    const segments = [];
    const isVideo = type === "video";

    // Find best representation
    const representations =
      adaptationSetContent.match(/<Representation[^>]*>/gi) || [];
    let bestScore = 0;
    let selectedQuality = null;

    for (const rep of representations) {
      const bandwidthMatch = rep.match(/bandwidth="([0-9]+)"/);
      const heightMatch = rep.match(/height="([0-9]+)"/);
      const widthMatch = rep.match(/width="([0-9]+)"/);

      if (bandwidthMatch) {
        const bandwidth = parseInt(bandwidthMatch[1]);
        const height = heightMatch ? parseInt(heightMatch[1]) : 0;
        const width = widthMatch ? parseInt(widthMatch[1]) : 0;

        // For video: prioritize by height, for audio: by bandwidth
        const score = isVideo ? height : bandwidth;

        if (score > bestScore) {
          bestScore = score;
          selectedQuality = { bandwidth, height, width };
        }
      }
    }

    console.log(
      `[IntegratedStreamProcessor] Best ${type} quality:`,
      selectedQuality,
    );

    // Find SegmentTemplate
    const templateMatch = adaptationSetContent.match(/<SegmentTemplate[^>]*>/);
    if (templateMatch) {
      const template = templateMatch[0];
      const mediaMatch = template.match(/media="([^"]+)"/);
      const initMatch = template.match(/initialization="([^"]+)"/);
      const timescaleMatch = template.match(/timescale="([^"]+)"/);
      const durationSegMatch = template.match(/duration="([^"]+)"/);

      if (mediaMatch && timescaleMatch && durationSegMatch) {
        let mediaTemplate = mediaMatch[1].replace(/&amp;/g, "&");
        let initTemplate = initMatch
          ? initMatch[1].replace(/&amp;/g, "&")
          : null;

        // Replace quality in URLs for video
        if (isVideo && selectedQuality && selectedQuality.height) {
          mediaTemplate = mediaTemplate.replace(
            /\/video\/\d+\//,
            `/video/${selectedQuality.height}/`,
          );
          if (initTemplate) {
            initTemplate = initTemplate.replace(
              /\/video\/\d+\//,
              `/video/${selectedQuality.height}/`,
            );
          }
        }

        const timescale = parseFloat(timescaleMatch[1]);
        const segmentDuration = parseFloat(durationSegMatch[1]);
        const segmentCount = Math.ceil(
          (duration * timescale) / segmentDuration,
        );

        console.log(
          `[IntegratedStreamProcessor] ${type}: ${segmentCount} segments, timescale: ${timescale}`,
        );

        // Add init segment
        if (initTemplate) {
          const initUrl = this.resolveUrl(baseUrl, initTemplate);
          segments.push(initUrl);
        }

        // Add media segments
        for (let i = 1; i <= segmentCount; i++) {
          const segmentUrl = mediaTemplate.replace("$Number$", i.toString());
          const fullUrl = this.resolveUrl(baseUrl, segmentUrl);
          segments.push(fullUrl);
        }
      }
    }

    return {
      segments: segments,
      quality: selectedQuality,
    };
  }

  async downloadSeparateStreams(streams, type, baseUrl, options = {}) {
    console.log(
      "[IntegratedStreamProcessor] Downloading separate video and audio streams...",
    );
    console.log("[IntegratedStreamProcessor] Download mode:", options.downloadMode || 'vna');

    try {
      const { video: videoSegments, audio: audioSegments } = streams;
      const videoUrl = this.currentVideoUrl; // Capture URL at start
      const downloadMode = options.downloadMode || 'vna'; // Default to VNA (separate files)

      // Initialize download state for pause/resume support
      if (!this.downloadStates.has(videoUrl)) {
        this.downloadStates.set(videoUrl, {
          chunks: [],
          currentSize: 0,
          currentSegment: 0,
          totalSegments: videoSegments.length + audioSegments.length,
          isPaused: false,
          isCanceled: false,
          completed: false,
          resumeCallback: null,
          cancelCallback: null,
          abortController: new AbortController(), // Add AbortController
          startTime: Date.now(), // Track start time
          pausedTime: 0, // Track total paused time
          lastPauseTime: null, // Track when pause started
        });
      }

      // Send progress update
      this.sendProgressUpdate(
        0,
        "Starting video and audio download...",
        `${videoSegments.length + audioSegments.length} segments`,
        "0 B",
        videoUrl,
      );

      // Download video with progress tracking
      console.log(
        `[IntegratedStreamProcessor] Downloading video (${videoSegments.length} segments)...`,
      );
      const videoBlob = await this.downloadSegments(
        videoSegments,
        "video",
        videoUrl,
        (progress, downloadedBytes) => {
          const overallProgress = Math.floor(progress / 2); // Video is first half
          const state = this.downloadStates.get(videoUrl);
          const elapsedTime = state
            ? (Date.now() - state.startTime - state.pausedTime) / 1000
            : 1;
          const speed = elapsedTime > 0 ? downloadedBytes / elapsedTime : 0;
          this.sendProgressUpdate(
            overallProgress,
            `🎥 Downloading video... (${progress.toFixed(1)}%)`,
            `${Math.floor((progress * videoSegments.length) / 100)}/${videoSegments.length} segments`,
            this.formatBytes(downloadedBytes),
            videoUrl,
            null,
            false,
            this.formatBytes(speed) + "/s",
          );
        },
      );

      // Download audio with progress tracking
      console.log(
        `[IntegratedStreamProcessor] Downloading audio (${audioSegments.length} segments)...`,
      );
      const audioBlob = await this.downloadSegments(
        audioSegments,
        "audio",
        videoUrl,
        (progress, downloadedBytes) => {
          const overallProgress = 50 + Math.floor(progress / 2); // Audio is second half
          const state = this.downloadStates.get(videoUrl);
          const elapsedTime = state
            ? (Date.now() - state.startTime - state.pausedTime) / 1000
            : 1;
          const totalBytes = videoBlob.size + downloadedBytes;
          const speed = elapsedTime > 0 ? totalBytes / elapsedTime : 0;
          this.sendProgressUpdate(
            overallProgress,
            `🎵 Downloading audio... (${progress.toFixed(1)}%)`,
            `${Math.floor((progress * audioSegments.length) / 100)}/${audioSegments.length} segments`,
            this.formatBytes(totalBytes),
            videoUrl,
            null,
            false,
            this.formatBytes(speed) + "/s",
          );
        },
      );

      const totalSize = videoBlob.size + audioBlob.size;
      this.sendProgressUpdate(
        95,
        "💾 Saving to Downloads folder...",
        "Video + Audio",
        this.formatBytes(totalSize),
        videoUrl,
      );

      // Generate safe filenames with same timestamp
      const timestamp = Date.now();
      const videoName = this.extractVideoName(baseUrl);
      const safeVideoName = this.sanitizeFilename(videoName);
      
      // Check download mode - VWA (merge) or VNA (separate files)
      if (downloadMode === 'vwa') {
        console.log("[IntegratedStreamProcessor] VWA mode: Preparing video and audio merge with FFmpeg...");
        
        this.sendProgressUpdate(
          96,
          "📦 Preparing files for merge...",
          "Creating FFmpeg script",
          this.formatBytes(totalSize),
          videoUrl,
        );
        
        // Use the new merge function - tries MP4Box first, falls back to FFmpeg
        const mergeResult = await this.mergeVideoAudioBlobs(videoBlob, audioBlob, safeVideoName);
        
        // Check if merge was successful (MP4Box) or needs FFmpeg
        if (mergeResult.merged) {
          // MP4Box merge successful - single merged file
          this.sendProgressUpdate(
            100,
            "✅ Merge hoàn thành!",
            "Video và audio đã được merge thành công!",
            this.formatBytes(mergeResult.totalSize),
            videoUrl,
          );
          
          // Save download ID to state
          const currentState = this.downloadStates.get(videoUrl);
          if (currentState) {
            currentState.downloadId = mergeResult.downloadId;
            this.downloadStates.set(videoUrl, currentState);
          }
          
          // Hide progress after 3 seconds
          setTimeout(() => {
            this.hideProgress(videoUrl);
          }, 3000);
          
          console.log(`[IntegratedStreamProcessor] VWA merge successful:`, mergeResult);
          
          return {
            downloadId: mergeResult.downloadId,
            filename: mergeResult.filename,
            segmentCount: videoSegments.length + audioSegments.length,
            totalSize: mergeResult.totalSize,
            requiresConversion: false,
            merged: true,
            mode: 'VWA',
            message: "Video và audio đã được merge thành công!",
          };
        } else {
          // FFmpeg fallback - separate files
          this.sendProgressUpdate(
            100,
            "✅ Downloaded! Cần merge với FFmpeg",
            mergeResult.message,
            this.formatBytes(mergeResult.totalSize),
            videoUrl,
          );
          
          // Save download ID to state
          const currentState = this.downloadStates.get(videoUrl);
          if (currentState) {
            currentState.downloadId = mergeResult.videoDownloadId;
            currentState.audioDownloadId = mergeResult.audioDownloadId;
            this.downloadStates.set(videoUrl, currentState);
          }
          
          // Hide progress after 5 seconds
          setTimeout(() => {
            this.hideProgress(videoUrl);
          }, 5000);
          
          console.log(`[IntegratedStreamProcessor] VWA download (FFmpeg required):`, mergeResult);
          
          return {
            downloadId: mergeResult.videoDownloadId,
            audioDownloadId: mergeResult.audioDownloadId,
            videoFilename: mergeResult.videoFilename,
            audioFilename: mergeResult.audioFilename,
            scriptFilename: mergeResult.scriptFilename,
            segmentCount: videoSegments.length + audioSegments.length,
            totalSize: mergeResult.totalSize,
            requiresConversion: true,
            ffmpegCommand: mergeResult.ffmpegCommand,
            separateFiles: true,
            merged: false,
            mode: 'VWA',
            message: mergeResult.message,
          };
        }
      }
      
      // VNA mode: Download separate video and audio files
      console.log("[IntegratedStreamProcessor] VNA mode: Downloading separate video and audio files...");
      
      const videoFilename = `${safeVideoName}_video_${timestamp}.mp4`;
      const audioFilename = `${safeVideoName}_audio_${timestamp}.m4a`;

      console.log(`[IntegratedStreamProcessor] Generated filenames:`, {
        videoFilename,
        audioFilename,
      });
      
      // Convert blobs to data URLs for separate downloads
      const videoReader = new FileReader();
      const videoDataUrl = await new Promise((resolve, reject) => {
        videoReader.onloadend = () => resolve(videoReader.result);
        videoReader.onerror = reject;
        videoReader.readAsDataURL(videoBlob);
      });

      const audioReader = new FileReader();
      const audioDataUrl = await new Promise((resolve, reject) => {
        audioReader.onloadend = () => resolve(audioReader.result);
        audioReader.onerror = reject;
        audioReader.readAsDataURL(audioBlob);
      });

      // Use suggested filename approach - both files will have suggested filenames
      // Chrome will put them in same default download folder
      const videoDownloadId = await chrome.downloads.download({
        url: videoDataUrl,
        filename: videoFilename,
        saveAs: false, // Don't ask user, use default download folder
      });

      // Save download ID to state so it can be canceled if needed
      const currentState = this.downloadStates.get(videoUrl);
      if (currentState) {
        currentState.downloadId = videoDownloadId;
        this.downloadStates.set(videoUrl, currentState);
      }

      // Download audio to same default folder
      const audioDownloadId = await chrome.downloads.download({
        url: audioDataUrl,
        filename: audioFilename,
        saveAs: false, // Both files go to default download folder
      });

      // Save audio download ID to state
      if (currentState) {
        currentState.audioDownloadId = audioDownloadId;
        this.downloadStates.set(videoUrl, currentState);
      }

      const totalDownloaded = videoBlob.size + audioBlob.size;
      this.sendProgressUpdate(
        100,
        "✅ Hoàn thành!",
        "Video + Audio lưu Downloads folder",
        this.formatBytes(totalDownloaded),
        videoUrl,
      );

      // Hide progress after 3 seconds to let user see final info
      setTimeout(() => {
        this.hideProgress(videoUrl);
      }, 3000);

      console.log(
        `[IntegratedStreamProcessor] Downloaded separate files to default download folder:`,
        {
          video: videoFilename,
          audio: audioFilename,
          approach: "default_download_folder",
        },
      );

      return {
        downloadId: videoDownloadId, // Primary download ID
        filename: videoFilename,
        audioDownloadId: audioDownloadId,
        audioFilename: audioFilename,
        segmentCount: videoSegments.length + audioSegments.length,
        totalSize: videoBlob.size + audioBlob.size,
        requiresConversion: true,
        separateFiles: true,
        sameDirectory: true,
        approach: "default_download_folder",
        ffmpegCommand: `ffmpeg -i "${videoFilename}" -i "${audioFilename}" -c copy "${safeVideoName}_merged.mp4"`,
      };
    } catch (error) {
      console.error(
        "[IntegratedStreamProcessor] Separate streams download failed:",
        error,
      );
      throw error;
    }
  }

  async mergeVideoAudioBlobs(videoBlob, audioBlob, baseFilename) {
    console.log("[IntegratedStreamProcessor] Preparing video and audio for merging...");
    console.log(`[IntegratedStreamProcessor] Video size: ${videoBlob.size}, Audio size: ${audioBlob.size}`);
    
    const timestamp = Date.now();
    
    // Note: Browser-side MP4 merging is complex and unreliable.
    // For best results, we download separate files with an FFmpeg merge script.
    // This ensures the highest quality output with no re-encoding.
    
    return this.downloadSeparateWithFFmpegScript(videoBlob, audioBlob, baseFilename, timestamp);
  }
  
  /**
   * Merge video and audio using MP4Box.js
   * Uses fragmented MP4 output approach
   */
  /**
   * Convert Blob to ArrayBuffer
   */
  blobToArrayBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }
  
  /**
   * Download separate video/audio files with FFmpeg merge script
   * This is the most reliable approach as browser-side MP4 muxing is complex
   */
  async downloadSeparateWithFFmpegScript(videoBlob, audioBlob, baseFilename, timestamp) {
    try {
      const videoFilename = `${baseFilename}_${timestamp}_video.mp4`;
      const audioFilename = `${baseFilename}_${timestamp}_audio.m4a`;
      const mergedFilename = `${baseFilename}_${timestamp}_merged.mp4`;
      const scriptFilename = `${baseFilename}_${timestamp}_merge.bat`;
      
      // Download video file
      const videoReader = new FileReader();
      const videoDataUrl = await new Promise((resolve, reject) => {
        videoReader.onloadend = () => resolve(videoReader.result);
        videoReader.onerror = reject;
        videoReader.readAsDataURL(videoBlob);
      });
      
      const videoDownloadId = await chrome.downloads.download({
        url: videoDataUrl,
        filename: videoFilename,
        saveAs: false,
      });
      console.log(`[IntegratedStreamProcessor] Downloaded video: ${videoFilename}, ID: ${videoDownloadId}`);
      
      // Download audio file
      const audioReader = new FileReader();
      const audioDataUrl = await new Promise((resolve, reject) => {
        audioReader.onloadend = () => resolve(audioReader.result);
        audioReader.onerror = reject;
        audioReader.readAsDataURL(audioBlob);
      });
      
      const audioDownloadId = await chrome.downloads.download({
        url: audioDataUrl,
        filename: audioFilename,
        saveAs: false,
      });
      console.log(`[IntegratedStreamProcessor] Downloaded audio: ${audioFilename}, ID: ${audioDownloadId}`);
      
      // Create FFmpeg merge script
      const ffmpegScript = `@echo off
REM ========================================
REM Video Download Helper - Merge Script
REM ========================================
REM This script merges the video and audio files into a single MP4
REM Requires FFmpeg to be installed and in PATH
REM Download FFmpeg: https://ffmpeg.org/download.html
REM ========================================

echo Merging video and audio...
ffmpeg -i "${videoFilename}" -i "${audioFilename}" -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 "${mergedFilename}"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Merge complete! Output: ${mergedFilename}
    echo ========================================
    echo.
    echo You can now delete the separate video and audio files:
    echo   - ${videoFilename}
    echo   - ${audioFilename}
) else (
    echo.
    echo ========================================
    echo Merge failed! Make sure FFmpeg is installed.
    echo Download: https://ffmpeg.org/download.html
    echo ========================================
)

pause
`;
      
      const scriptBlob = new Blob([ffmpegScript], { type: 'text/plain' });
      const scriptReader = new FileReader();
      const scriptDataUrl = await new Promise((resolve, reject) => {
        scriptReader.onloadend = () => resolve(scriptReader.result);
        scriptReader.onerror = reject;
        scriptReader.readAsDataURL(scriptBlob);
      });
      
      await chrome.downloads.download({
        url: scriptDataUrl,
        filename: scriptFilename,
        saveAs: false,
      });
      console.log(`[IntegratedStreamProcessor] Downloaded merge script: ${scriptFilename}`);
      
      return {
        success: true,
        merged: false,
        videoDownloadId,
        audioDownloadId,
        videoFilename,
        audioFilename,
        mergedFilename,
        scriptFilename,
        totalSize: videoBlob.size + audioBlob.size,
        ffmpegCommand: `ffmpeg -i "${videoFilename}" -i "${audioFilename}" -c:v copy -c:a aac "${mergedFilename}"`,
        message: "Video and audio downloaded separately. Run the .bat script with FFmpeg to merge them."
      };
    } catch (error) {
      console.error("[IntegratedStreamProcessor] FFmpeg fallback error:", error);
      throw error;
    }
  }

  async downloadSegments(
    segments,
    streamType,
    videoUrl = null,
    progressCallback = null,
  ) {
    console.log(
      `[IntegratedStreamProcessor] Downloading ${segments.length} ${streamType} segments...`,
    );

    const chunks = [];
    let totalSize = 0;

    for (let i = 0; i < segments.length; i++) {
      // Check pause BEFORE downloading segment
      if (videoUrl) {
        let state = this.downloadStates.get(videoUrl);
        console.log(
          `[IntegratedStreamProcessor] ${streamType} segment ${i + 1}/${segments.length}, isPaused=${state?.isPaused}`,
        );

        if (state && state.isPaused) {
          console.log(
            `🛑 PAUSE DETECTED in ${streamType} download - waiting...`,
          );

          // Wait for resume or cancel
          await new Promise((resolve, reject) => {
            state.resumeCallback = () => {
              console.log(`▶️ ${streamType} download RESUMED`);
              resolve();
            };
            state.cancelCallback = () => {
              console.log(`❌ ${streamType} download CANCELED during pause`);
              reject(new Error("Download canceled by user"));
            };
            this.downloadStates.set(videoUrl, state);
          });

          // After resume, re-fetch state
          state = this.downloadStates.get(videoUrl);
        }

        // Check for cancellation
        if (state && state.isCanceled) {
          console.log(
            `[IntegratedStreamProcessor] ${streamType} download canceled at segment ${i + 1}`,
          );
          throw new Error("Download canceled by user");
        }
      }

      // Legacy cancellation check
      if (this.isDownloadCanceled) {
        console.log(
          `[IntegratedStreamProcessor] Download canceled at ${streamType} segment ${i + 1}`,
        );
        throw new Error("Download canceled by user");
      }

      try {
        const segmentUrl = segments[i];
        console.log(
          `[IntegratedStreamProcessor] Downloading ${streamType} segment ${i + 1}/${segments.length}: ${segmentUrl}`,
        );

        // Get AbortController from state for this download
        let abortSignal = null;
        if (videoUrl) {
          const state = this.downloadStates.get(videoUrl);
          if (state && state.abortController) {
            abortSignal = state.abortController.signal;
          }
        }

        const response = await fetch(segmentUrl, { signal: abortSignal });
        if (!response.ok) {
          console.warn(
            `[IntegratedStreamProcessor] Segment ${i + 1} failed: ${response.status}`,
          );
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        chunks.push(new Uint8Array(arrayBuffer));
        totalSize += arrayBuffer.byteLength;

        // Report progress if callback provided
        if (progressCallback) {
          const progress = ((i + 1) / segments.length) * 100;
          progressCallback(progress, totalSize);
        }

        console.log(
          `[IntegratedStreamProcessor] Downloaded ${streamType} segment ${i + 1}, size: ${arrayBuffer.byteLength}, total: ${totalSize}`,
        );
      } catch (error) {
        // Check if error is abort error
        if (error.name === "AbortError") {
          console.log(
            `[IntegratedStreamProcessor] 🛑 Segment ${i + 1} download aborted (paused)`,
          );
          // Decrement i to retry this segment when resumed
          i--;

          // Wait for resume
          if (videoUrl) {
            let state = this.downloadStates.get(videoUrl);
            await new Promise((resolve, reject) => {
              state.resumeCallback = () => {
                console.log(`▶️ ${streamType} download RESUMED after abort`);
                resolve();
              };
              state.cancelCallback = () => {
                console.log(`❌ ${streamType} download CANCELED after abort`);
                reject(new Error("Download canceled by user"));
              };
              this.downloadStates.set(videoUrl, state);
            });
          }
          continue;
        }
        console.warn(
          `[IntegratedStreamProcessor] Error downloading ${streamType} segment ${i + 1}:`,
          error,
        );
      }
    }

    if (chunks.length === 0) {
      throw new Error(`Failed to download any ${streamType} segments`);
    }

    // Merge chunks into single blob
    const mergedBlob = new Blob(chunks, {
      type: streamType === "video" ? "video/mp4" : "audio/mp4",
    });
    console.log(
      `[IntegratedStreamProcessor] ${streamType} merged: ${mergedBlob.size} bytes`,
    );

    return mergedBlob;
  }

  async downloadAndMergeSegments(segments, type, baseUrl) {
    console.log(
      `[IntegratedStreamProcessor] Starting download and merge of ${segments.length} segments`,
    );

    try {
      const videoUrl = this.currentVideoUrl; // Capture URL at start

      // Initialize or retrieve download state
      let state = this.downloadStates.get(videoUrl);
      if (!state || state.completed) {
        // New download or completed previous download
        state = {
          chunks: [],
          currentSize: 0,
          currentSegment: 0,
          totalSegments: segments.length,
          isPaused: false,
          isCanceled: false,
          completed: false,
          resumeCallback: null,
          cancelCallback: null,
          abortController: new AbortController(), // Add AbortController for immediate pause
          startTime: Date.now(), // Track start time for speed calculation
          pausedTime: 0, // Track total paused time
          lastPauseTime: null, // Track when pause started
        };
        this.downloadStates.set(videoUrl, state);

        // Send initial progress
        this.sendProgressUpdate(
          0,
          "🎬 Bắt đầu tải video...",
          `${segments.length} segments`,
          "0 B",
          videoUrl,
        );
      } else {
        // Resuming existing download
        console.log(
          `[IntegratedStreamProcessor] Resuming from segment ${state.currentSegment + 1}/${segments.length}`,
        );
      }

      // Download all segments with detailed progress and pause support
      for (let i = state.currentSegment; i < segments.length; i++) {
        // CRITICAL: Check pause/cancel BEFORE starting segment download
        state = this.downloadStates.get(videoUrl);
        if (!state) {
          throw new Error("Download state lost");
        }

        console.log(
          `[IntegratedStreamProcessor] Loop iteration ${i + 1}/${segments.length}, isPaused=${state.isPaused}, isCanceled=${state.isCanceled}`,
        );

        // Update current segment index
        state.currentSegment = i;
        this.downloadStates.set(videoUrl, state);

        // Check for cancellation FIRST
        if (state.isCanceled) {
          console.log(
            `[IntegratedStreamProcessor] Download canceled at segment ${i + 1}`,
          );
          throw new Error("Download canceled by user");
        }

        // Check for pause BEFORE downloading segment
        if (state.isPaused) {
          console.log(
            `[IntegratedStreamProcessor] ✋ PAUSE DETECTED at segment ${i + 1}, entering pause wait...`,
          );

          // Use chunks.length (completed segments) for accurate progress
          const completedSegments = state.chunks?.length || 0;
          const percent =
            completedSegments > 0
              ? (completedSegments / segments.length) * 100
              : 0;

          // Send pause notification
          this.sendProgressUpdate(
            percent,
            "⏸️ Đã tạm dừng",
            `${completedSegments}/${segments.length} segments`,
            this.formatBytes(state.currentSize),
            videoUrl,
            null,
            true, // paused = true
          );

          // Create Promise and wait for resume
          console.log(
            `[IntegratedStreamProcessor] Creating pause Promise for ${videoUrl}...`,
          );
          await new Promise((resolve, reject) => {
            // Store callbacks in state
            state.resumeCallback = resolve;
            state.cancelCallback = reject;
            this.downloadStates.set(videoUrl, state);
            console.log(
              `[IntegratedStreamProcessor] Pause Promise created, waiting for resume or cancel...`,
            );
          }).catch((err) => {
            console.log(
              `[IntegratedStreamProcessor] Pause Promise rejected:`,
              err,
            );
            throw new Error("Download canceled during pause");
          });

          console.log(
            `[IntegratedStreamProcessor] Pause Promise resolved! Resuming...`,
          );

          // Clear callbacks after resume
          state.resumeCallback = null;
          state.cancelCallback = null;
          this.downloadStates.set(videoUrl, state);

          // Re-fetch fresh state after resume
          state = this.downloadStates.get(videoUrl);
          if (!state) {
            throw new Error("Download state lost after resume");
          }

          // Double-check cancellation after resume
          if (state.isCanceled) {
            console.log(`[IntegratedStreamProcessor] Canceled during pause`);
            throw new Error("Download canceled by user");
          }

          // Verify pause is cleared (should be false after resume)
          if (state.isPaused) {
            console.log(
              `[IntegratedStreamProcessor] WARNING: isPaused still true after resume! Retrying iteration...`,
            );
            i--; // Retry this segment
            continue;
          }

          console.log(
            `[IntegratedStreamProcessor] Successfully resumed from segment ${i + 1}`,
          );
        }

        // Download the segment
        try {
          const segmentUrl = segments[i];
          console.log(
            `[IntegratedStreamProcessor] Downloading segment ${i + 1}/${segments.length}: ${segmentUrl}`,
          );

          const response = await fetch(segmentUrl, {
            signal: state.abortController?.signal,
          });
          if (!response.ok) {
            console.warn(
              `[IntegratedStreamProcessor] Segment ${i + 1} failed: ${response.status}, continuing...`,
            );
            continue;
          }

          const arrayBuffer = await response.arrayBuffer();

          // Re-check state after download completes (in case paused during download)
          state = this.downloadStates.get(videoUrl);
          if (!state) {
            throw new Error("Download state lost");
          }

          if (state.isCanceled) {
            console.log(
              `[IntegratedStreamProcessor] Canceled during segment download`,
            );
            throw new Error("Download canceled by user");
          }

          // Save segment data
          state.chunks.push(new Uint8Array(arrayBuffer));
          state.currentSize += arrayBuffer.byteLength;
          this.downloadStates.set(videoUrl, state);

          // Update progress - but ONLY if not paused (to avoid overriding pause UI)
          if (!state.isPaused) {
            const progress = Math.floor(((i + 1) / segments.length) * 90);
            const segmentProgress = (((i + 1) / segments.length) * 100).toFixed(
              1,
            );
            // Calculate download speed
            const elapsedTime =
              (Date.now() - state.startTime - state.pausedTime) / 1000; // in seconds
            const speed = elapsedTime > 0 ? state.currentSize / elapsedTime : 0;
            this.sendProgressUpdate(
              progress,
              `📥 Đang tải video... (${segmentProgress}%)`,
              `${i + 1}/${segments.length} segments`,
              this.formatBytes(state.currentSize),
              videoUrl,
              null,
              false,
              this.formatBytes(speed) + "/s",
            );
          }
        } catch (error) {
          // Check if aborted (paused)
          if (error.name === "AbortError") {
            console.log(
              `[IntegratedStreamProcessor] 🛑 Segment ${i + 1} aborted (paused)`,
            );
            // Don't increment i - retry this segment when resumed
            i--;

            // Wait for resume or cancel
            await new Promise((resolve, reject) => {
              state.resumeCallback = () => {
                console.log(
                  `▶️ Download RESUMED after abort at segment ${i + 2}`,
                );
                resolve();
              };
              state.cancelCallback = () => {
                console.log(`❌ Download CANCELED after abort`);
                reject(new Error("Download canceled by user"));
              };
              this.downloadStates.set(videoUrl, state);
            });

            // Refresh state after resume
            state = this.downloadStates.get(videoUrl);
            continue;
          }

          console.warn(
            `[IntegratedStreamProcessor] Error downloading segment ${i + 1}:`,
            error,
          );
        }
      }

      console.log(
        `[IntegratedStreamProcessor] Downloaded ${state.chunks.length}/${segments.length} segments, total size: ${state.currentSize}`,
      );
      this.sendProgressUpdate(
        95,
        "🔧 Đang ghép video...",
        `${state.chunks.length} segments`,
        this.formatBytes(state.currentSize),
        videoUrl,
      );

      if (state.chunks.length === 0) {
        throw new Error("No segments downloaded successfully");
      }

      // Merge chunks into single blob
      const mergedBlob = new Blob(state.chunks, { type: "video/mp4" });

      // Convert to data URL for download
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(mergedBlob);
      });

      // Generate filename
      const timestamp = Date.now();
      const videoName = this.extractVideoName(baseUrl);
      const filename = `${videoName}_${timestamp}.mp4`;

      this.sendProgressUpdate(
        98,
        "💾 Tạo file tải xuống...",
        filename,
        this.formatBytes(mergedBlob.size),
        videoUrl,
      );
      console.log(
        `[IntegratedStreamProcessor] Triggering download: ${filename}`,
      );

      // Download merged video
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: true,
      });

      // Save download ID to state so it can be canceled if needed
      const currentState = this.downloadStates.get(videoUrl);
      if (currentState) {
        currentState.downloadId = downloadId;
        this.downloadStates.set(videoUrl, currentState);
      }

      this.sendProgressUpdate(
        100,
        "✅ Video đã tải xong!",
        filename,
        this.formatBytes(mergedBlob.size),
        videoUrl,
        downloadId,
      );

      // Mark as completed
      state.completed = true;
      this.downloadStates.set(videoUrl, state);

      // Hide progress after 3 seconds and cleanup
      setTimeout(() => {
        this.hideProgress(videoUrl);
        this.downloadStates.delete(videoUrl);
      }, 3000);

      return {
        downloadId: downloadId,
        filename: filename,
        segmentCount: segments.length,
        totalSize: mergedBlob.size,
        requiresConversion: false,
      };
    } catch (error) {
      console.error(
        "[IntegratedStreamProcessor] Download and merge failed:",
        error,
      );
      throw error;
    }
  }

  async directDownload(url, options) {
    const filename = options.filename || this.generateFilename(url);

    const downloadId = await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: options.saveAs || false,
    });

    // Save download ID to state so it can be canceled if needed
    const currentState = this.downloadStates.get(url);
    if (currentState) {
      currentState.downloadId = downloadId;
      this.downloadStates.set(url, currentState);
    }

    return {
      downloadId: downloadId,
      filename: filename,
      requiresConversion: false,
    };
  }

  async downloadManifestFallback(video, options) {
    console.log("[IntegratedStreamProcessor] Using manifest fallback");

    const filename = `manifest_${Date.now()}.${video.type === "hls" ? "m3u8" : "mpd"}`;

    const downloadId = await chrome.downloads.download({
      url: video.url,
      filename: filename,
      saveAs: true,
    });

    return {
      downloadId: downloadId,
      filename: filename,
      requiresConversion: true,
      ffmpegCommand: `ffmpeg -i "${filename}" -c copy output.mp4`,
    };
  }

  resolveUrl(baseUrl, relativeUrl) {
    if (
      relativeUrl.startsWith("http://") ||
      relativeUrl.startsWith("https://")
    ) {
      return relativeUrl;
    }

    try {
      const base = new URL(baseUrl);
      return new URL(relativeUrl, base).href;
    } catch {
      return relativeUrl;
    }
  }

  extractVideoName(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/").filter((p) => p.length > 0);

      // For Cloudflare Stream, extract video ID
      if (
        url.includes("cloudflarestream.com") ||
        url.includes("videodelivery.net")
      ) {
        const videoId = pathParts.find(
          (part) => part.length > 20 && !part.includes("."),
        );
        if (videoId) {
          return "cloudflare_video_" + videoId.substring(0, 12);
        }
      }

      const lastPart =
        pathParts[pathParts.length - 2] ||
        pathParts[pathParts.length - 1] ||
        "video";
      return lastPart.replace(/[^a-zA-Z0-9_-]/g, "_");
    } catch {
      return "video";
    }
  }

  // Sanitize filename to ensure it's valid for downloads
  sanitizeFilename(filename) {
    return (
      filename
        .replace(/[<>:"/\\|?*]/g, "_") // Replace invalid chars
        .replace(/\s+/g, "_") // Replace spaces
        .replace(/_{2,}/g, "_") // Merge multiple underscores
        .replace(/^_|_$/g, "") // Remove leading/trailing underscores
        .substring(0, 100) || "video"
    ); // Limit length and fallback
  }

  generateFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let filename = pathname.substring(pathname.lastIndexOf("/") + 1);

      if (!filename || filename.length === 0) {
        filename = `video_${Date.now()}.mp4`;
      }

      return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    } catch {
      return `video_${Date.now()}.mp4`;
    }
  }

  // Send progress updates to popup
  sendProgressUpdate(
    percent,
    text,
    detail,
    size,
    videoUrl,
    downloadId = null,
    paused = false,
    speed = null,
  ) {
    try {
      chrome.runtime
        .sendMessage({
          action: "downloadProgress",
          data: {
            show: true,
            percent: percent,
            text: text,
            detail: detail,
            size: size || "",
            speed: speed || "", // Add speed to progress data
            videoUrl: videoUrl || this.currentVideoUrl, // Use provided or current
            downloadId: downloadId,
            paused: paused,
          },
        })
        .catch(() => {}); // Ignore errors if popup is closed
    } catch (error) {
      // Ignore errors
    }
  }

  // Hide progress bar
  hideProgress(videoUrl) {
    try {
      chrome.runtime
        .sendMessage({
          action: "downloadProgress",
          data: {
            show: false,
            videoUrl: videoUrl || this.currentVideoUrl,
          },
        })
        .catch(() => {});
    } catch (error) {
      // Ignore errors
    }
  }

  // Wait for download to get its path information
  async waitForDownloadPath(downloadId, maxWaitMs = 5000) {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkDownload = async () => {
        try {
          const items = await chrome.downloads.search({ id: downloadId });
          if (items && items.length > 0 && items[0].filename) {
            resolve(items[0]);
            return;
          }
        } catch (error) {
          console.warn(
            "[IntegratedStreamProcessor] Error checking download:",
            error,
          );
        }

        // Timeout check
        if (Date.now() - startTime > maxWaitMs) {
          console.warn(
            "[IntegratedStreamProcessor] Timeout waiting for download path",
          );
          resolve(null);
          return;
        }

        // Try again after short delay
        setTimeout(checkDownload, 100);
      };

      checkDownload();
    });
  }

  formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + " " + sizes[i];
  }
}

// Create global instance
const streamProcessor = new IntegratedStreamProcessor();

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(
    "[Background-Simple] Message received:",
    message?.action,
    "from tab:",
    sender?.tab?.id,
  );

  // Handle async actions
  (async () => {
    try {
      if (message.action === "ping") {
        console.log("[Background-Simple] Ping received");
        sendResponse({ success: true, status: "alive" });
        return;
      }

      if (message.action === "cancelDownload") {
        console.log("[Background-Simple] Cancel download requested");
        streamProcessor.cancelDownload(message.videoUrl);
        sendResponse({ success: true, status: "canceled" });
        return;
      }

      if (message.action === "pauseDownload") {
        console.log(
          "[Background-Simple] pauseDownload requested for:",
          message.videoUrl,
        );
        streamProcessor.pauseDownload(message.videoUrl);
        sendResponse({ success: true });
        return;
      }

      if (message.action === "resumeDownload") {
        console.log(
          "[Background-Simple] resumeDownload requested for:",
          message.videoUrl,
        );
        streamProcessor.resumeDownload(message.videoUrl);
        sendResponse({ success: true });
        return;
      }

      if (message.action === "debug") {
        console.log("[Background-Simple] Debug request:", message.command);

        if (message.command === "listVideos") {
          const allVideos = [];
          detectedVideos.forEach((video, key) => {
            allVideos.push({ key, ...video });
          });

          console.log(
            "[Background-Simple] Debug: detectedVideos Map size:",
            detectedVideos.size,
          );
          console.log("[Background-Simple] Debug: All videos:", allVideos);

          sendResponse({
            videos: allVideos, // Use same format as other handlers
          });
          return;
        }
      }

      if (message.action === "manifestDetected") {
        console.log(
          "[Background-Simple] manifestDetected:",
          message.type,
          message.url?.substring(0, 100),
        );
        console.log("[Background-Simple] Sender:", sender);

        // Get tab ID - either from sender (content script) or message (popup)
        let tabId = sender?.tab?.id || message.tabId;

        if (!tabId) {
          console.error("[Background-Simple] No tab ID available");
          sendResponse({ success: false, error: "No tab ID" });
          return;
        }

        // Store video with duration detection
        const videoInfo = {
          url: message.url,
          tabId: tabId,
          type: message.type || "unknown",
          timestamp: Date.now(),
          source: sender?.tab?.id ? "content-script" : "popup-debug",
          duration: null, // Will be fetched async
        };

        const key = `${tabId}_${message.url}`;
        const alreadyExists = detectedVideos.has(key);
        
        if (!alreadyExists) {
          detectedVideos.set(key, videoInfo);
          console.log("[Background-Simple] New video stored with key:", key);
          console.log(
            "[Background-Simple] Video tabId:",
            tabId,
            "type:",
            typeof tabId,
          );
          console.log(
            "[Background-Simple] Total videos now:",
            detectedVideos.size,
          );
          // Update per-tab badge
          try {
            updateBadge(tabId);
          } catch (e) {
            console.warn("[Background-Simple] updateBadge call failed");
          }
        } else {
          console.log("[Background-Simple] Video already exists, skipping duplicate:", message.url.substring(0, 100));
        }

        // Fetch duration asynchronously (don't block response)
        if (message.type === "dash" || message.type === "mpd") {
          fetch(message.url)
            .then((res) => res.text())
            .then((manifest) => {
              const durationMatch = manifest.match(
                /mediaPresentationDuration="PT(?:(\d+)H)?(?:(\d+)M)?(?:([0-9.]+)S)?"/,
              );
              if (durationMatch) {
                const hours = parseInt(durationMatch[1] || 0);
                const minutes = parseInt(durationMatch[2] || 0);
                const seconds = parseFloat(durationMatch[3] || 0);
                const duration = hours * 3600 + minutes * 60 + seconds;

                // Update stored video with duration
                const storedVideo = detectedVideos.get(key);
                if (storedVideo) {
                  storedVideo.duration = duration;
                  detectedVideos.set(key, storedVideo);
                  console.log(
                    `[Background-Simple] Updated video duration: ${duration}s`,
                  );
                }
              }
            })
            .catch((err) => {
              console.log(
                "[Background-Simple] Could not fetch duration:",
                err.message,
              );
            });
        } else if (message.type === "hls") {
          fetch(message.url)
            .then((res) => res.text())
            .then((manifest) => {
              // Parse HLS duration from #EXT-X-TARGETDURATION or segments
              const durationMatch = manifest.match(
                /#EXT-X-TARGETDURATION:(\d+)/,
              );
              const segments = manifest.match(/#EXTINF:([\d.]+)/g);

              let duration = 0;
              if (segments) {
                // Sum all segment durations
                duration = segments.reduce((total, seg) => {
                  const match = seg.match(/#EXTINF:([\d.]+)/);
                  return total + (match ? parseFloat(match[1]) : 0);
                }, 0);
              } else if (durationMatch) {
                // Rough estimate
                duration = parseInt(durationMatch[1]) * 10;
              }

              if (duration > 0) {
                const storedVideo = detectedVideos.get(key);
                if (storedVideo) {
                  storedVideo.duration = duration;
                  detectedVideos.set(key, storedVideo);
                  console.log(
                    `[Background-Simple] Updated HLS duration: ${duration}s`,
                  );
                }
              }
            })
            .catch((err) => {
              console.log(
                "[Background-Simple] Could not fetch HLS duration:",
                err.message,
              );
            });
        }

        // Notify popup if it's open about new video
        try {
          // Get the full video object to send to popup
          const videoForPopup = detectedVideos
            .get(tabId)
            .find((v) => v.url === message.url);

          chrome.runtime
            .sendMessage({
              action: "videoDetected",
              tabId: tabId,
              video: videoForPopup || { url: message.url, type: message.type },
            })
            .catch(() => {
              // Popup might not be open, ignore error
              console.log(
                "[Background-Simple] Could not notify popup (popup closed)",
              );
            });
        } catch (e) {
          // Ignore if popup is not open
        }

        sendResponse({ success: true });
        return;
      }

      if (message.action === "getVideos") {
        const requestedTabId = message.tabId;
        console.log(
          "[Background-Simple] getVideos for tab:",
          requestedTabId,
          "type:",
          typeof requestedTabId,
        );
        console.log(
          "[Background-Simple] detectedVideos Map size:",
          detectedVideos.size,
        );

        // Get videos for this tab
        const tabVideos = [];
        const allTabIds = new Set();

        detectedVideos.forEach((video, key) => {
          allTabIds.add(video.tabId);
          console.log("[Background-Simple] Checking video key:", key);
          console.log(
            "[Background-Simple] Video tabId:",
            video.tabId,
            "type:",
            typeof video.tabId,
          );
          console.log(
            "[Background-Simple] Requested tabId:",
            requestedTabId,
            "type:",
            typeof requestedTabId,
          );
          console.log(
            "[Background-Simple] Exact match?",
            video.tabId === requestedTabId,
          );

          // Match exact tabId or if tabIds are close (Chrome can have slightly different IDs)
          if (video.tabId === requestedTabId) {
            tabVideos.push(video);
            console.log(
              "[Background-Simple] Added video to results:",
              video.url.substring(0, 50),
            );
          }
        });

        console.log(
          "[Background-Simple] All stored tabIds:",
          Array.from(allTabIds),
        );
        console.log("[Background-Simple] Requested tabId:", requestedTabId);
        console.log(
          "[Background-Simple] Returning",
          tabVideos.length,
          "videos for tab",
          requestedTabId,
        );

        // If no exact match found but we have videos, try to return recent videos
        if (tabVideos.length === 0 && detectedVideos.size > 0) {
          console.log(
            "[Background-Simple] No exact tabId match, returning all recent videos",
          );
          const recentVideos = [];
          const now = Date.now();
          detectedVideos.forEach((video, key) => {
            // Return videos from last 5 minutes
            if (now - video.timestamp < 300000) {
              recentVideos.push(video);
            }
          });

          console.log(
            "[Background-Simple] Returning",
            recentVideos.length,
            "recent videos instead",
          );
          sendResponse({ videos: recentVideos });
          return;
        }

        console.log("[Background-Simple] Final response videos:", tabVideos);
        sendResponse({ videos: tabVideos });
        return;
      }

      if (message.action === "getAllVideos") {
        console.log("[Background-Simple] getAllVideos - emergency fallback");
        console.log(
          "[Background-Simple] detectedVideos Map size:",
          detectedVideos.size,
        );

        const allVideos = [];
        detectedVideos.forEach((video, key) => {
          allVideos.push(video);
        });

        console.log(
          "[Background-Simple] Returning ALL videos:",
          allVideos.length,
        );
        sendResponse({ videos: allVideos });
        return;
      }

      if (message.action === "clearVideos") {
        const tabId = message.tabId;
        console.log("[Background-Simple] Clearing videos for tab:", tabId);

        const keysToDelete = [];
        detectedVideos.forEach((video, key) => {
          if (video.tabId === tabId) {
            keysToDelete.push(key);
          }
        });

        keysToDelete.forEach((key) => detectedVideos.delete(key));
        console.log(
          "[Background-Simple] Cleared",
          keysToDelete.length,
          "videos",
        );
        // Update badge after clearing
        try {
          updateBadge(tabId);
        } catch (e) {
          console.warn("[Background-Simple] updateBadge call failed");
        }

        sendResponse({ success: true, cleared: keysToDelete.length });
        return;
      }

      if (message.action === "rescanTab") {
        const tabId = message.tabId;
        console.log("[Background-Simple] Rescanning tab:", tabId);

        // Try to trigger content script scan
        try {
          chrome.tabs.sendMessage(tabId, { action: "scanVideos" }, (response) => {
            console.log("[Background-Simple] Sent scanVideos to tab:", tabId);
          });
        } catch (e) {
          console.log("[Background-Simple] Could not send scanVideos to tab:", e.message);
        }

        sendResponse({ success: true });
        return;
      }

      if (message.action === "removeVideo") {
        const tabId = message.tabId;
        const url = message.url;
        console.log("[Background-Simple] removeVideo requested for tab:", tabId, "url:", url);

        if (!url) {
          sendResponse({ success: false, error: "No URL provided" });
          return;
        }

        // Remove matching entries from detectedVideos
        const keysToDelete = [];
        detectedVideos.forEach((video, key) => {
          if (video.tabId === tabId && video.url === url) {
            keysToDelete.push(key);
          }
        });

        keysToDelete.forEach((key) => detectedVideos.delete(key));
        console.log(
          "[Background-Simple] removeVideo cleared",
          keysToDelete.length,
          "videos for",
          url,
        );

        // Update badge after removal
        try {
          updateBadge(tabId);
        } catch (e) {
          console.warn("[Background-Simple] updateBadge call failed");
        }

        sendResponse({ success: true, removed: keysToDelete.length });
        return;
      }

      if (message.action === "pauseDownload") {
        console.log(
          "[Background-Simple] pauseDownload requested for:",
          message.videoUrl,
        );
        streamProcessor.pauseDownload(message.videoUrl);
        sendResponse({ success: true });
        return;
      }

      if (message.action === "resumeDownload") {
        console.log(
          "[Background-Simple] resumeDownload requested for:",
          message.videoUrl,

        );
        streamProcessor.resumeDownload(message.videoUrl);
        sendResponse({ success: true });
        return;
      }

      if (message.action === "cancelDownload") {
        console.log(
          "[Background-Simple] cancelDownload requested for:",
          message.videoUrl,
        );
        streamProcessor.cancelDownload(message.videoUrl);
        sendResponse({ success: true });
        return;
      }

      if (message.action === "downloadVideo") {
        console.log(
          "[Background-Simple] downloadVideo requested for:",
          message.video?.url?.substring(0, 100),
        );
        console.log("[Background-Simple] Download options:", message.options);
        console.log("[Background-Simple] Tab ID from message:", message.tabId);

        try {
          const video = message.video;

          // Reset cancel state for new download
          streamProcessor.resetCancelState(video.url);

          // Use IntegratedStreamProcessor for all video types
          if (
            video.type === "dash" ||
            video.type === "mpd" ||
            video.type === "hls"
          ) {
            console.log(
              "[Background-Simple] Using IntegratedStreamProcessor for streaming content...",
            );

            // Process the stream
            const result = await streamProcessor.processStream(
              video,
              message.options || {},
            );

            console.log(
              "[Background-Simple] IntegratedStreamProcessor result:",
              result,
            );
            sendResponse({
              success: true,
              result: result,
            });
          } else {
            // For regular videos, download directly
            console.log(
              "[Background-Simple] Direct download for regular video...",
            );
            const filename = `video_${Date.now()}.mp4`;
            const downloadId = await chrome.downloads.download({
              url: video.url,
              filename: filename,
              saveAs: false,
            });

            // Save download ID to state so it can be canceled if needed
            const currentState = streamProcessor.downloadStates.get(video.url);
            if (currentState) {
              currentState.downloadId = downloadId;
              streamProcessor.downloadStates.set(video.url, currentState);
            }

            console.log("[Background-Simple] Started download:", downloadId);
            sendResponse({
              success: true,
              result: {
                downloadId: downloadId,
                filename: filename,
                segmentCount: 1,
                totalSize: 1024000,
                requiresConversion: false,
              },
            });
          }
        } catch (error) {
          console.error("[Background-Simple] Download error:", error);
          sendResponse({
            success: false,
            error: error.message,
            result: null,
          });
        }
        return;
      }
    } catch (error) {
      console.error("[Background-Simple] Error:", error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep message channel open for async response
});

console.log("[Background-Simple] === SERVICE WORKER READY ===");
