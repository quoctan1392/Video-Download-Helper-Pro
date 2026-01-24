/**
 * Manifest parsing utility
 * Parses DASH/HLS/MPD manifests to extract video information
 */

const ManifestParser = {
  /**
   * Parse DASH manifest
   * @param {string} content - Manifest XML content
   * @returns {Object} - Parsed manifest data
   */
  parseDash(content) {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(content, 'text/xml');
      
      const representations = xmlDoc.querySelectorAll('Representation');
      const qualities = [];
      
      representations.forEach(rep => {
        const width = rep.getAttribute('width');
        const height = rep.getAttribute('height');
        const bandwidth = rep.getAttribute('bandwidth');
        
        if (width && height) {
          qualities.push({
            width: parseInt(width),
            height: parseInt(height),
            bandwidth: parseInt(bandwidth || 0),
            quality: `${width}x${height}`
          });
        }
      });
      
      return {
        type: 'DASH',
        qualities: qualities.sort((a, b) => b.bandwidth - a.bandwidth)
      };
    } catch (e) {
      window.VDLogger?.error('Failed to parse DASH manifest:', e);
      return { type: 'DASH', qualities: [] };
    }
  },

  /**
   * Parse HLS manifest
   * @param {string} content - Manifest m3u8 content
   * @returns {Object} - Parsed manifest data
   */
  parseHls(content) {
    try {
      const lines = content.split('\n');
      const qualities = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          const resMatch = line.match(/RESOLUTION=(\d+)x(\d+)/);
          const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
          
          if (resMatch) {
            qualities.push({
              width: parseInt(resMatch[1]),
              height: parseInt(resMatch[2]),
              bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0,
              quality: `${resMatch[1]}x${resMatch[2]}`
            });
          }
        }
      }
      
      return {
        type: 'HLS',
        qualities: qualities.sort((a, b) => b.bandwidth - a.bandwidth)
      };
    } catch (e) {
      window.VDLogger?.error('Failed to parse HLS manifest:', e);
      return { type: 'HLS', qualities: [] };
    }
  },

  /**
   * Auto-detect and parse manifest
   * @param {string} content - Manifest content
   * @param {string} url - Manifest URL
   * @returns {Object} - Parsed manifest data
   */
  parse(content, url) {
    if (!content) return null;

    if (url.includes('.m3u8') || content.includes('#EXTM3U')) {
      return this.parseHls(content);
    } else if (url.includes('.mpd') || content.includes('MPD')) {
      return this.parseDash(content);
    }

    return null;
  }
};

// Make available globally
window.VDManifestParser = ManifestParser;
