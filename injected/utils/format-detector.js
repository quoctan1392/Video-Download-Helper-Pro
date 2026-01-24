/**
 * Format detection utility
 * Detects video streaming formats from URLs and content
 */

const FormatDetector = {
  /**
   * Detect format from URL
   * @param {string} url - The URL to check
   * @returns {string|null} - Format name or null
   */
  detectFromUrl(url) {
    if (!url) return null;

    const urlLower = url.toLowerCase();

    // DASH
    if (urlLower.includes('.mpd') || urlLower.includes('dash')) {
      return 'DASH';
    }

    // HLS
    if (urlLower.includes('.m3u8') || urlLower.includes('hls')) {
      return 'HLS';
    }

    // MPD (same as DASH but explicit)
    if (urlLower.includes('manifest') && urlLower.includes('.mpd')) {
      return 'MPD';
    }

    // Direct video
    if (urlLower.match(/\.(mp4|webm|mkv|avi|mov)(\?|$)/)) {
      return 'MP4';
    }

    return null;
  },

  /**
   * Detect if URL is a manifest
   * @param {string} url
   * @returns {boolean}
   */
  isManifest(url) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    return urlLower.includes('.mpd') || 
           urlLower.includes('.m3u8') ||
           urlLower.includes('manifest');
  },

  /**
   * Detect if URL is a video segment
   * @param {string} url
   * @returns {boolean}
   */
  isVideoSegment(url) {
    if (!url) return false;
    const urlLower = url.toLowerCase();
    return urlLower.includes('segment') ||
           urlLower.includes('.ts') ||
           urlLower.includes('.m4s') ||
           urlLower.includes('sq/');
  }
};

// Make available globally
window.VDFormatDetector = FormatDetector;
