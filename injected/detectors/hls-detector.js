/**
 * HLS Detector - Detects HLS manifests (.m3u8)
 * Extends DetectorBase
 */

class HLSDetector extends window.VDDetectorBase {
  constructor() {
    super('HLS');
  }

  /**
   * Initialize HLS detector
   */
  init() {
    if (!this.enabled) return;

    window.VDLogger?.log('HLS Detector initializing...');

    // Register callback with interceptors
    window.VDInterceptors?.onManifestDetected((data) => {
      if (data.format === 'hls') {
        this.handleDetection(data);
      }
    });

    window.VDLogger?.success('HLS Detector initialized');
  }

  /**
   * Handle detected HLS manifest
   */
  handleDetection(data) {
    const { url, manifest } = data;

    // Parse manifest if available
    let parsedData = null;
    if (manifest) {
      parsedData = window.VDManifestParser?.parseHls(manifest);
    }

    const videoData = {
      format: 'hls',
      url: url,
      manifest: manifest,
      qualities: parsedData?.qualities || [],
      detectedAt: Date.now()
    };

    this.emitDetection(videoData);
  }

  /**
   * Detect HLS manifests (manual trigger)
   */
  detect() {
    // Detection happens via interceptors
    return Array.from(this.detectedVideos.values());
  }
}

// Make available globally
window.VDHLSDetector = HLSDetector;
