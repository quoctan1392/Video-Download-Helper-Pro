// Simple Stream Processor for Service Worker
// Uses simpler APIs compatible with service workers

export class SimpleStreamProcessor {
  constructor() {
    console.log('[SimpleStreamProcessor] Initialized');
  }

  async processStream(video, options = {}) {
    const { type, url, manifest } = video;
    
    console.log('[SimpleStreamProcessor] Processing stream:', { 
      type, 
      url: url.substring(0, 100) + '...',
      hasManifest: !!manifest 
    });
    
    try {
      // For streaming protocols, parse manifest and download segments
      if (type === 'dash' || type === 'hls' || type === 'mpd') {
        return await this.handleStreamingProtocol(video, options);
      } else {
        // Direct video file download
        return await this.directDownload(url, options);
      }
    } catch (error) {
      console.error('[SimpleStreamProcessor] Processing error:', error);
      // Fallback to manifest download
      return await this.downloadManifestFallback(video, options);
    }
  }

  async handleStreamingProtocol(video, options) {
    const { type, url, manifest } = video;
    
    console.log('[SimpleStreamProcessor] Handling streaming protocol:', type);
    
    try {
      // Fetch manifest if not provided
      let manifestContent = manifest;
      if (!manifestContent) {
        console.log('[SimpleStreamProcessor] Fetching manifest...');
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch manifest: ${response.statusText}`);
        }
        manifestContent = await response.text();
      }
      
      console.log(`[SimpleStreamProcessor] Manifest fetched: ${manifestContent.length} characters`);
      
      // Parse manifest to get segments
      const segments = await this.extractSegments(manifestContent, url, type);
      
      console.log(`[SimpleStreamProcessor] Extracted ${segments.length} segments`);
      
      if (!segments || segments.length === 0) {
        console.warn('[SimpleStreamProcessor] No segments found, using fallback');
        return await this.downloadManifestFallback(video, options);
      }
      
      // For service worker, we'll merge segments into blob URL and download
      return await this.downloadAndMergeSegments(segments, type, url);
      
    } catch (error) {
      console.error('[SimpleStreamProcessor] Streaming protocol error:', error);
      return await this.downloadManifestFallback(video, options);
    }
  }

  async extractSegments(manifest, baseUrl, type) {
    console.log(`[SimpleStreamProcessor] Extracting ${type} segments...`);
    
    const segments = [];
    
    if (type === 'hls') {
      // Parse HLS manifest
      const lines = manifest.split('\\n').filter(line => line.trim());
      
      // Check for master playlist
      let isMasterPlaylist = false;
      let bestVariantUrl = null;
      let bestBandwidth = 0;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
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
        console.log(`[SimpleStreamProcessor] Fetching best variant: ${bestVariantUrl}`);
        const variantResponse = await fetch(bestVariantUrl);
        const variantManifest = await variantResponse.text();
        return this.extractSegments(variantManifest, bestVariantUrl, type);
      }
      
      // Parse media playlist
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('#') && trimmed.length > 0) {
          const segmentUrl = this.resolveUrl(baseUrl, trimmed);
          segments.push(segmentUrl);
        }
      }
      
    } else if (type === 'dash' || type === 'mpd') {
      // Parse DASH manifest
      console.log('[SimpleStreamProcessor] Parsing DASH manifest...');
      
      // Check for Cloudflare Stream
      const isCloudflareStream = baseUrl.includes('cloudflarestream.com') || baseUrl.includes('videodelivery.net');
      
      if (isCloudflareStream) {
        console.log('[SimpleStreamProcessor] Detected Cloudflare Stream');
        
        // Extract duration
        const durationMatch = manifest.match(/mediaPresentationDuration="PT(?:(\\d+)H)?(?:(\\d+)M)?(?:([0-9.]+)S)?"/);
        let duration = 0;
        if (durationMatch) {
          const hours = parseInt(durationMatch[1] || 0);
          const minutes = parseInt(durationMatch[2] || 0);
          const seconds = parseFloat(durationMatch[3] || 0);
          duration = hours * 3600 + minutes * 60 + seconds;
        }
        
        console.log(`[SimpleStreamProcessor] Video duration: ${duration}s`);
        
        // Find video AdaptationSet
        const videoAdaptationSet = manifest.match(/<AdaptationSet[^>]*mimeType="video[^"]*"[^>]*>[\s\S]*?<\/AdaptationSet>/i);
        
        if (videoAdaptationSet) {
          // Find best video representation
          const representations = videoAdaptationSet[0].match(/<Representation[^>]*>/gi) || [];
          let bestHeight = 0;
          let selectedHeight = null;
          
          for (const rep of representations) {
            const heightMatch = rep.match(/height="([0-9]+)"/);
            if (heightMatch) {
              const height = parseInt(heightMatch[1]);
              if (height > bestHeight) {
                bestHeight = height;
                selectedHeight = height;
              }
            }
          }
          
          console.log(`[SimpleStreamProcessor] Selected quality: ${selectedHeight}p`);
          
          // Find SegmentTemplate
          const templateMatch = videoAdaptationSet[0].match(/<SegmentTemplate[^>]*>/);
          if (templateMatch) {
            const template = templateMatch[0];
            const mediaMatch = template.match(/media="([^"]+)"/);
            const initMatch = template.match(/initialization="([^"]+)"/);
            const timescaleMatch = template.match(/timescale="([^"]+)"/);
            const durationMatch = template.match(/duration="([^"]+)"/);
            
            if (mediaMatch && timescaleMatch && durationMatch) {
              let mediaTemplate = mediaMatch[1].replace(/&amp;/g, '&');
              let initTemplate = initMatch ? initMatch[1].replace(/&amp;/g, '&') : null;
              
              // Replace quality in URLs
              if (selectedHeight) {
                mediaTemplate = mediaTemplate.replace(/\/video\/\d+\//, `/video/${selectedHeight}/`);
                if (initTemplate) {
                  initTemplate = initTemplate.replace(/\/video\/\d+\//, `/video/${selectedHeight}/`);
                }
              }
              
              const timescale = parseFloat(timescaleMatch[1]);
              const segmentDuration = parseFloat(durationMatch[1]);
              const segmentCount = Math.ceil((duration * timescale) / segmentDuration);
              
              console.log(`[SimpleStreamProcessor] Will generate ${segmentCount} segments`);
              
              // Add init segment
              if (initTemplate) {
                const initUrl = this.resolveUrl(baseUrl, initTemplate);
                segments.push(initUrl);
              }
              
              // Add media segments
              for (let i = 1; i <= segmentCount; i++) {
                const segmentUrl = mediaTemplate.replace('$Number$', i.toString());
                const fullUrl = this.resolveUrl(baseUrl, segmentUrl);
                segments.push(fullUrl);
              }
            }
          }
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
    
    console.log(`[SimpleStreamProcessor] Extracted ${segments.length} segments`);
    return segments;
  }

  async downloadAndMergeSegments(segments, type, baseUrl) {
    console.log(`[SimpleStreamProcessor] Downloading ${segments.length} segments...`);
    
    try {
      const chunks = [];
      const maxConcurrent = 3;
      
      // Download segments in batches
      for (let i = 0; i < segments.length; i += maxConcurrent) {
        const batch = segments.slice(i, i + maxConcurrent);
        const batchPromises = batch.map(async (url, index) => {
          try {
            console.log(`[SimpleStreamProcessor] Downloading segment ${i + index + 1}/${segments.length}`);
            const response = await fetch(url);
            if (response.ok) {
              return await response.blob();
            }
            return null;
          } catch (error) {
            console.error(`[SimpleStreamProcessor] Failed to download segment ${i + index + 1}:`, error);
            return null;
          }
        });
        
        const batchChunks = await Promise.all(batchPromises);
        chunks.push(...batchChunks.filter(chunk => chunk !== null));
        
        console.log(`[SimpleStreamProcessor] Downloaded ${chunks.length}/${segments.length} segments`);
      }
      
      if (chunks.length === 0) {
        throw new Error('Failed to download any segments');
      }
      
      console.log(`[SimpleStreamProcessor] Merging ${chunks.length} chunks...`);
      
      // Merge chunks into single blob
      const mergedBlob = new Blob(chunks, { type: 'video/mp4' });
      
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
      
      console.log(`[SimpleStreamProcessor] Triggering download: ${filename}`);
      
      // Download merged video
      const downloadId = await chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: true
      });
      
      return {
        downloadId: downloadId,
        filename: filename,
        segmentCount: segments.length,
        totalSize: mergedBlob.size,
        requiresConversion: false
      };
      
    } catch (error) {
      console.error('[SimpleStreamProcessor] Download and merge failed:', error);
      throw error;
    }
  }

  async directDownload(url, options) {
    const filename = options.filename || this.generateFilename(url);
    
    const downloadId = await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: options.saveAs || false
    });
    
    return {
      downloadId: downloadId,
      filename: filename,
      requiresConversion: false
    };
  }

  async downloadManifestFallback(video, options) {
    console.log('[SimpleStreamProcessor] Using manifest fallback');
    
    const filename = `manifest_${Date.now()}.${video.type === 'hls' ? 'm3u8' : 'mpd'}`;
    
    const downloadId = await chrome.downloads.download({
      url: video.url,
      filename: filename,
      saveAs: true
    });
    
    return {
      downloadId: downloadId,
      filename: filename,
      requiresConversion: true,
      ffmpegCommand: `ffmpeg -i "${filename}" -c copy output.mp4`
    };
  }

  resolveUrl(baseUrl, relativeUrl) {
    if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
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
      const pathParts = urlObj.pathname.split('/').filter(p => p.length > 0);
      
      // For Cloudflare Stream, extract video ID
      if (url.includes('cloudflarestream.com') || url.includes('videodelivery.net')) {
        const videoId = pathParts.find(part => part.length > 20 && !part.includes('.'));
        if (videoId) {
          return 'cloudflare_video_' + videoId.substring(0, 12);
        }
      }
      
      const lastPart = pathParts[pathParts.length - 2] || pathParts[pathParts.length - 1] || 'video';
      return lastPart.replace(/[^a-zA-Z0-9_-]/g, '_');
    } catch {
      return 'video';
    }
  }

  generateFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      
      if (!filename || filename.length === 0) {
        filename = `video_${Date.now()}.mp4`;
      }
      
      return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    } catch {
      return `video_${Date.now()}.mp4`;
    }
  }
}