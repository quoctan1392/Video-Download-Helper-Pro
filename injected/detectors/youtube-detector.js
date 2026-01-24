/**
 * YouTube Detector - Detects YouTube videos and extracts metadata
 * Extends DetectorBase
 */

class YouTubeDetector extends window.VDDetectorBase {
  constructor() {
    super('YouTube');
    
    this.lastExtractedVideoId = null;
    this.lastYouTubeUrl = null;
    this.lastPlaybackId = null;
    this.playerDetected = false;
  }

  /**
   * Check if should run on current page
   */
  shouldRun() {
    return super.shouldRun() && window.location.hostname.includes('youtube.com');
  }

  /**
   * Initialize YouTube detector
   */
  init() {
    if (!this.shouldRun()) {
      window.VDLogger?.log('Not on YouTube, skipping detector');
      return;
    }

    window.VDLogger?.log('🎬 YouTube Detector initializing...');

    // Install API interceptors
    this.installFetchInterceptor();
    this.installXHRInterceptor();
    this.monitorYtPlayerConfig();
    this.monitorYtInitialPlayerResponse();
    this.monitorVideoElement();
    this.trackNavigation();

    // Initial detection
    if (window.location.href.includes('/watch?v=')) {
      setTimeout(() => {
        window.VDLogger?.log('🎬 Video page detected on load, starting initial detection...');
        this.resetDetection();
      }, 1000);
    }

    window.VDLogger?.success('YouTube Detector initialized');
  }

  /**
   * Install Fetch API interceptor for YouTube API
   */
  installFetchInterceptor() {
    const self = this;
    const originalFetch = window.fetch;

    window.fetch = function(...args) {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;

      // Intercept YouTube player API
      if (url && url.includes('/youtubei/v1/player')) {
        window.VDLogger?.log('🎯 Intercepted fetch player API request');

        return originalFetch.apply(this, args).then(response => {
          const clone = response.clone();

          clone.json().then(data => {
            const videoId = data?.videoDetails?.videoId;

            if (videoId && videoId !== self.lastExtractedVideoId) {
              window.VDLogger?.log('✅ NEW VIDEO detected from API:', videoId);
              self.playerDetected = true;
              self.extractVideoInfo(data);
              self.lastExtractedVideoId = videoId;
            }
          }).catch(() => {});

          return response;
        });
      }

      return originalFetch.apply(this, args);
    };

    window.VDLogger?.success('Fetch interceptor installed');
  }

  /**
   * Install XMLHttpRequest interceptor for YouTube API
   */
  installXHRInterceptor() {
    const self = this;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      this._yt_url = url;
      return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(...args) {
      if (this._yt_url && this._yt_url.includes('/youtubei/v1/player')) {
        window.VDLogger?.log('🎯 Intercepted XHR player API request');

        this.addEventListener('load', function() {
          try {
            const data = JSON.parse(this.responseText);
            const videoId = data?.videoDetails?.videoId;

            if (videoId && videoId !== self.lastExtractedVideoId) {
              window.VDLogger?.log('✅ NEW VIDEO detected from XHR:', videoId);
              self.playerDetected = true;
              self.extractVideoInfo(data);
              self.lastExtractedVideoId = videoId;
            }
          } catch (err) {
            window.VDLogger?.error('Failed to parse XHR response:', err);
          }
        });
      }

      return originalSend.apply(this, args);
    };

    window.VDLogger?.success('XHR interceptor installed');
  }

  /**
   * Monitor ytplayer.config for player data
   */
  monitorYtPlayerConfig() {
    const self = this;
    let attempts = 0;

    const checkInterval = setInterval(() => {
      attempts++;

      if (window.ytplayer?.config?.args) {
        const playerData = window.ytplayer.config.args;
        const videoId = playerData.video_id;

        if (videoId && videoId !== self.lastExtractedVideoId) {
          clearInterval(checkInterval);
          window.VDLogger?.log('✅ NEW VIDEO from ytplayer.config:', videoId);

          if (playerData.player_response) {
            try {
              const playerResponse = typeof playerData.player_response === 'string'
                ? JSON.parse(playerData.player_response)
                : playerData.player_response;

              self.playerDetected = true;
              self.extractVideoInfo(playerResponse);
              self.lastExtractedVideoId = videoId;
            } catch (err) {
              window.VDLogger?.error('Failed to parse player_response:', err);
            }
          }
        }
      } else if (attempts >= 10) {
        clearInterval(checkInterval);
      }
    }, 500);
  }

  /**
   * Monitor ytInitialPlayerResponse global variable
   */
  monitorYtInitialPlayerResponse() {
    const self = this;
    let lastVideoId = null;

    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      set: function(value) {
        this._ytInitialPlayerResponse = value;

        const newVideoId = value?.videoDetails?.videoId;
        if (value && newVideoId && newVideoId !== lastVideoId) {
          window.VDLogger?.log('New video detected via setter:', newVideoId);
          lastVideoId = newVideoId;

          if (self.playerDetected) {
            self.resetDetection();
          }

          self.playerDetected = true;
          self.extractVideoInfo(value);
        }
      },
      get: function() {
        return this._ytInitialPlayerResponse;
      },
      configurable: true
    });

    window.VDLogger?.success('ytInitialPlayerResponse monitor installed');
  }

  /**
   * Monitor video element changes
   */
  monitorVideoElement() {
    const self = this;

    // Monitor setAttribute
    const originalSetAttribute = HTMLVideoElement.prototype.setAttribute;
    HTMLVideoElement.prototype.setAttribute = function(name, value) {
      if (name === 'src' && value && window.location.hostname.includes('youtube.com')) {
        if (!self.playerDetected) {
          setTimeout(() => {
            if (window.ytInitialPlayerResponse) {
              self.extractVideoInfo(window.ytInitialPlayerResponse);
            }
          }, 500);
        }
      }
      return originalSetAttribute.call(this, name, value);
    };

    // Monitor src property
    const videoSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (videoSrcDescriptor?.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        set: function(value) {
          if (value && window.location.hostname.includes('youtube.com')) {
            if (!self.playerDetected) {
              setTimeout(() => {
                if (window.ytInitialPlayerResponse) {
                  self.extractVideoInfo(window.ytInitialPlayerResponse);
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

    window.VDLogger?.success('Video element monitors installed');
  }

  /**
   * Track navigation changes
   */
  trackNavigation() {
    const self = this;
    self.lastYouTubeUrl = location.href;

    // Method 1: yt-navigate-finish event
    window.addEventListener('yt-navigate-finish', () => {
      const currentUrl = location.href;
      if (currentUrl !== self.lastYouTubeUrl) {
        window.VDLogger?.log('🔄 Video changed via event');
        self.lastYouTubeUrl = currentUrl;
        self.resetDetection();
      }
    });

    // Method 2: URL polling
    setInterval(() => {
      const currentUrl = location.href;
      if (currentUrl !== self.lastYouTubeUrl && currentUrl.includes('/watch?v=')) {
        window.VDLogger?.log('🔄 Video changed via URL polling');
        self.lastYouTubeUrl = currentUrl;
        self.resetDetection();
      }
    }, 500);

    // Method 3: Title MutationObserver
    const titleElement = document.querySelector('title');
    if (titleElement) {
      const observer = new MutationObserver(() => {
        const currentUrl = location.href;
        if (currentUrl !== self.lastYouTubeUrl && currentUrl.includes('/watch?v=')) {
          window.VDLogger?.log('🔄 Video changed via MutationObserver');
          self.lastYouTubeUrl = currentUrl;
          self.resetDetection();
        }
      });

      observer.observe(titleElement, {
        childList: true,
        subtree: true
      });
    }

    window.VDLogger?.success('Navigation tracking installed');
  }

  /**
   * Reset detection for new video
   */
  resetDetection() {
    window.VDLogger?.log('🔄 Resetting YouTube detection');
    this.playerDetected = false;
    this.lastPlaybackId = null;
    this.lastExtractedVideoId = null;
    this.detectedVideos.clear();

    // Start polling for new video
    let attempts = 0;
    const pollInterval = setInterval(() => {
      attempts++;

      if (window.ytInitialPlayerResponse) {
        const videoId = window.ytInitialPlayerResponse?.videoDetails?.videoId;

        if (videoId && videoId !== this.lastExtractedVideoId) {
          clearInterval(pollInterval);
          window.VDLogger?.success('✅ NEW VIDEO from polling:', videoId);
          this.playerDetected = true;
          this.extractVideoInfo(window.ytInitialPlayerResponse);
          this.lastExtractedVideoId = videoId;
        }
      }

      if (attempts >= 20) {
        clearInterval(pollInterval);
      }
    }, 500);
  }

  /**
   * Extract video information from player response
   */
  extractVideoInfo(playerResponse) {
    try {
      const streamingData = playerResponse?.streamingData;
      if (!streamingData) {
        window.VDLogger?.warn('No streaming data in response');
        return;
      }

      const videoDetails = playerResponse?.videoDetails || {};
      const videoId = videoDetails.videoId || '';
      const title = videoDetails.title || 'YouTube Video';

      window.VDLogger?.log('📺 Extracting:', title);

      // Build video info object
      const videoInfo = {
        format: 'youtube',
        id: videoId,
        title: title,
        duration: videoDetails.lengthSeconds,
        isLive: videoDetails.isLiveContent || false,
        url: window.location.href,
        dashManifestUrl: streamingData.dashManifestUrl || null,
        hlsManifestUrl: streamingData.hlsManifestUrl || null
      };

      // Extract formats if available
      const formats = streamingData.adaptiveFormats || streamingData.formats || [];
      const availableFormats = formats.filter(f => f.url);

      if (availableFormats.length > 0) {
        videoInfo.formats = availableFormats.map(f => ({
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
        }));
      }

      // Emit detection
      this.emitDetection(videoInfo);

    } catch (error) {
      window.VDLogger?.error('Error extracting YouTube video info:', error);
    }
  }

  /**
   * Detect method (called externally if needed)
   */
  detect() {
    if (!this.shouldRun()) return [];

    // Trigger extraction if player response exists
    if (window.ytInitialPlayerResponse) {
      this.extractVideoInfo(window.ytInitialPlayerResponse);
    }

    return Array.from(this.detectedVideos.values());
  }
}

// Make available globally
window.VDYouTubeDetector = YouTubeDetector;
