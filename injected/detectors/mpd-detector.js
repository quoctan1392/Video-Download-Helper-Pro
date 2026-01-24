/**
 * MPD Detector - Detects MPD manifests (MPEG-DASH)
 * Extends DetectorBase
 */

class MPDDetector extends window.VDDetectorBase {
  constructor() {
    super('MPD');
  }

  /**
   * Initialize MPD detector
   */
  init() {
    if (!this.enabled) return;

    window.VDLogger?.log('MPD Detector initializing...');

    // Register callback with interceptors
    window.VDInterceptors?.onManifestDetected((data) => {
      // MPD is essentially DASH
      if (data.format === 'dash' || data.url.includes('.mpd')) {
        this.handleDetection(data);
      }
    });

    window.VDLogger?.success('MPD Detector initialized');
  }

  /**
   * Handle detected MPD manifest
   */
  handleDetection(data) {
    const { url, manifest } = data;

    // Parse manifest if available (use DASH parser)
    let parsedData = null;
    if (manifest) {
      parsedData = window.VDManifestParser?.parseDash(manifest);
    }

    const videoData = {
      format: 'mpd',
      url: url,
      manifest: manifest,
      qualities: parsedData?.qualities || [],
      detectedAt: Date.now()
    };

    this.emitDetection(videoData);
  }

  /**
   * Detect MPD manifests (manual trigger)
   */
  detect() {
    // Detection happens via interceptors
    return Array.from(this.detectedVideos.values());
  }
}

// Make available globally
window.VDMPDDetector = MPDDetector;
