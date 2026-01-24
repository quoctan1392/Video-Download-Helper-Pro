/**
 * Base Detector Class
 * Abstract class for all video detectors
 */

class DetectorBase {
  constructor(name) {
    this.name = name;
    this.enabled = true;
    this.detectedVideos = new Map();
  }

  /**
   * Initialize the detector
   * Must be implemented by subclasses
   */
  init() {
    throw new Error('init() must be implemented by subclass');
  }

  /**
   * Detect videos on the current page
   * Must be implemented by subclasses
   * @returns {Array} Array of detected video objects
   */
  detect() {
    throw new Error('detect() must be implemented by subclass');
  }

  /**
   * Check if detector should run on current page
   * @returns {boolean}
   */
  shouldRun() {
    return this.enabled;
  }

  /**
   * Emit detected video to content script
   * @param {Object} videoData - Video information
   */
  emitDetection(videoData) {
    const videoId = videoData.url || videoData.videoId || videoData.id || Date.now().toString();
    
    // Skip if already detected
    if (this.detectedVideos.has(videoId)) {
      return;
    }

    this.detectedVideos.set(videoId, videoData);

    window.VDLogger?.info(`${this.name} detected video:`, videoData.title || videoId);

    // Build message
    const message = {
      type: 'VIDEO_MANIFEST_DETECTED',
      format: videoData.format || 'youtube',
      url: videoData.url || window.location.href,
      manifest: videoData.manifest || null,
      videoInfo: videoData
    };

    // Send to content script via message bus
    window.VDMessageBus?.sendToContentScript(message);

    // Also emit internally for other components to listen
    window.VDMessageBus?.emit('VIDEO_MANIFEST_DETECTED', message);
  }

  /**
   * Clear detected videos
   */
  reset() {
    this.detectedVideos.clear();
    window.VDLogger?.debug(`${this.name} reset`);
  }

  /**
   * Enable the detector
   */
  enable() {
    this.enabled = true;
    window.VDLogger?.info(`${this.name} enabled`);
  }

  /**
   * Disable the detector
   */
  disable() {
    this.enabled = false;
    window.VDLogger?.info(`${this.name} disabled`);
  }
}

// Make available globally
window.VDDetectorBase = DetectorBase;
