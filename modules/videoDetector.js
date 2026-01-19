// Video Detector Module
export class VideoDetector {
  constructor() {
    this.videoExtensions = [
      'mp4', 'webm', 'ogg', 'ogv', 'mov', 'avi', 'wmv', 'flv', 'mkv', '3gp', 'm4v'
    ];
    
    this.streamingPatterns = [
      { pattern: /\.m3u8/i, type: 'hls' },
      { pattern: /\.mpd/i, type: 'mpd' },
      { pattern: /manifest\.mpd/i, type: 'dash' },
      { pattern: /playlist\.m3u8/i, type: 'hls' },
      { pattern: /master\.m3u8/i, type: 'hls' },
      { pattern: /\/dash\//i, type: 'dash' },
      { pattern: /\/hls\//i, type: 'hls' },
      // Cloudflare Stream patterns
      { pattern: /cloudflarestream\.com.*\/manifest\/video\.m3u8/i, type: 'hls' },
      { pattern: /videodelivery\.net.*\/manifest\/video\.m3u8/i, type: 'hls' },
      { pattern: /cloudflarestream\.com.*\.m3u8/i, type: 'hls' },
      { pattern: /videodelivery\.net.*\.m3u8/i, type: 'hls' }
    ];
    
    this.cloudflareStreamDomains = [
      'cloudflarestream.com',
      'videodelivery.net',
      'customer-', // Cloudflare custom domains
    ];
  }
  
  isVideoUrl(url) {
    try {
      const urlLower = url.toLowerCase();
      
      // Check for Cloudflare Stream first
      if (this.isCloudflareStream(url)) {
        return true;
      }
      
      // Check for video file extensions
      for (const ext of this.videoExtensions) {
        if (urlLower.includes(`.${ext}`)) {
          return true;
        }
      }
      
      // Check for streaming patterns
      for (const pattern of this.streamingPatterns) {
        if (pattern.pattern.test(url)) {
          return true;
        }
      }
      
      // Check for common video CDN patterns
      if (urlLower.includes('video') || 
          urlLower.includes('stream') ||
          urlLower.includes('media')) {
        // Additional validation for CDN URLs
        if (urlLower.match(/\.(mp4|webm|m3u8|mpd)/)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }
  
  isCloudflareStream(url) {
    const urlLower = url.toLowerCase();
    return this.cloudflareStreamDomains.some(domain => urlLower.includes(domain));
  }
  
  getVideoType(url) {
    const urlLower = url.toLowerCase();
    
    // Check if Cloudflare Stream
    if (this.isCloudflareStream(url)) {
      if (urlLower.includes('.m3u8')) {
        return 'hls';
      }
      if (urlLower.includes('.mpd')) {
        return 'dash';
      }
    }
    
    // Check streaming formats first
    for (const pattern of this.streamingPatterns) {
      if (pattern.pattern.test(url)) {
        return pattern.type;
      }
    }
    
    // Check video file extensions
    for (const ext of this.videoExtensions) {
      if (urlLower.includes(`.${ext}`)) {
        return ext;
      }
    }
    
    return 'video';
  }
  
  getVideoQuality(url, responseHeaders = []) {
    const urlLower = url.toLowerCase();
    
    // Check for quality indicators in URL
    const qualityPatterns = [
      { pattern: /4320p|8k/i, quality: '8K' },
      { pattern: /2160p|4k|uhd/i, quality: '4K' },
      { pattern: /1440p|2k|qhd/i, quality: '2K' },
      { pattern: /1080p|fhd/i, quality: '1080p' },
      { pattern: /720p|hd/i, quality: '720p' },
      { pattern: /480p|sd/i, quality: '480p' },
      { pattern: /360p/i, quality: '360p' },
      { pattern: /240p/i, quality: '240p' }
    ];
    
    for (const qp of qualityPatterns) {
      if (qp.pattern.test(urlLower)) {
        return qp.quality;
      }
    }
    
    return 'Unknown';
  }
  
  isLiveStream(url, manifest = null) {
    const urlLower = url.toLowerCase();
    
    // Check URL patterns
    if (urlLower.includes('live') || 
        urlLower.includes('livestream') ||
        urlLower.includes('stream/live')) {
      return true;
    }
    
    // Check manifest for live indicators
    if (manifest) {
      const manifestLower = manifest.toLowerCase();
      if (manifestLower.includes('type="dynamic"') ||
          manifestLower.includes('type=\'dynamic\'') ||
          manifestLower.includes('#ext-x-playlist-type:event') ||
          manifestLower.includes('islive="true"')) {
        return true;
      }
    }
    
    return false;
  }
  
  extractVideoInfo(url, responseHeaders = [], manifest = null) {
    return {
      url: url,
      type: this.getVideoType(url),
      quality: this.getVideoQuality(url, responseHeaders),
      isLive: this.isLiveStream(url, manifest),
      contentType: this.getContentType(responseHeaders),
      timestamp: Date.now()
    };
  }
  
  getContentType(responseHeaders = []) {
    const contentTypeHeader = responseHeaders.find(
      h => h.name.toLowerCase() === 'content-type'
    );
    return contentTypeHeader ? contentTypeHeader.value : 'unknown';
  }
}
