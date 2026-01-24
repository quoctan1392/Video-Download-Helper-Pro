/**
 * DASH Detector - Detects DASH manifests (.mpd)
 * Extends DetectorBase
 */

class DASHDetector extends window.VDDetectorBase {
  constructor() {
    super('DASH');
  }

  /**
   * Initialize DASH detector
   */
  init() {
    if (!this.enabled) return;

    window.VDLogger?.log('DASH Detector initializing...');

    // Register callback with interceptors
    window.VDInterceptors?.onManifestDetected((data) => {
      if (data.format === 'dash') {
        this.handleDetection(data);
      }
    });

    window.VDLogger?.success('DASH Detector initialized');
  }

  /**
   * Handle detected DASH manifest
   */
  handleDetection(data) {
    const { url, manifest } = data;

    // Parse manifest if available
    let parsedData = null;
    if (manifest) {
      parsedData = window.VDManifestParser?.parseDash(manifest);
    }

    const videoData = {
      format: 'dash',
      url: url,
      manifest: manifest,
      qualities: parsedData?.qualities || [],
      detectedAt: Date.now()
    };

    this.emitDetection(videoData);
  }

  /**
   * Detect DASH manifests (manual trigger)
   */
  detect() {
    // Detection happens via interceptors
    return Array.from(this.detectedVideos.values());
  }
}

// Make available globally
window.VDDASHDetector = DASHDetector;
