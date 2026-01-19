// Download Manager Module
export class DownloadManager {
  constructor() {
    this.activeDownloads = new Map();
  }
  
  async download(url, options = {}) {
    const {
      filename = this.generateFilename(url),
      saveAs = false,
      conflictAction = 'uniquify'
    } = options;
    
    try {
      const downloadId = await chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: saveAs,
        conflictAction: conflictAction
      });
      
      this.activeDownloads.set(downloadId, {
        url: url,
        filename: filename,
        startTime: Date.now(),
        status: 'in_progress'
      });
      
      // Monitor download progress
      this.monitorDownload(downloadId);
      
      return {
        downloadId: downloadId,
        filename: filename
      };
    } catch (error) {
      console.error('Download failed:', error);
      throw new Error(`Download failed: ${error.message}`);
    }
  }
  
  monitorDownload(downloadId) {
    chrome.downloads.onChanged.addListener((delta) => {
      if (delta.id === downloadId) {
        const download = this.activeDownloads.get(downloadId);
        
        if (delta.state) {
          if (delta.state.current === 'complete') {
            download.status = 'complete';
            download.endTime = Date.now();
            console.log(`Download ${downloadId} completed`);
          } else if (delta.state.current === 'interrupted') {
            download.status = 'failed';
            download.endTime = Date.now();
            console.log(`Download ${downloadId} interrupted`);
          }
        }
        
        if (delta.error) {
          download.error = delta.error.current;
          console.error(`Download ${downloadId} error:`, delta.error.current);
        }
      }
    });
  }
  
  generateFilename(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      let filename = pathname.substring(pathname.lastIndexOf('/') + 1);
      
      // If no filename in URL, generate one
      if (!filename || filename.length === 0) {
        const ext = this.getFileExtension(url);
        filename = `video_${Date.now()}.${ext}`;
      }
      
      // Clean filename
      filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      
      // Ensure it has an extension
      if (!filename.includes('.')) {
        const ext = this.getFileExtension(url);
        filename += `.${ext}`;
      }
      
      return filename;
    } catch {
      return `video_${Date.now()}.mp4`;
    }
  }
  
  getFileExtension(url) {
    const urlLower = url.toLowerCase();
    
    // Check for known extensions
    const extensions = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'flv', 'wmv', 'm4v'];
    for (const ext of extensions) {
      if (urlLower.includes(`.${ext}`)) {
        return ext;
      }
    }
    
    // Default to mp4
    return 'mp4';
  }
  
  async getDownloadStatus(downloadId) {
    try {
      const downloads = await chrome.downloads.search({ id: downloadId });
      if (downloads && downloads.length > 0) {
        return downloads[0];
      }
      return null;
    } catch (error) {
      console.error('Error getting download status:', error);
      return null;
    }
  }
  
  async cancelDownload(downloadId) {
    try {
      await chrome.downloads.cancel(downloadId);
      const download = this.activeDownloads.get(downloadId);
      if (download) {
        download.status = 'cancelled';
      }
      return true;
    } catch (error) {
      console.error('Error cancelling download:', error);
      return false;
    }
  }
  
  async pauseDownload(downloadId) {
    try {
      await chrome.downloads.pause(downloadId);
      return true;
    } catch (error) {
      console.error('Error pausing download:', error);
      return false;
    }
  }
  
  async resumeDownload(downloadId) {
    try {
      await chrome.downloads.resume(downloadId);
      return true;
    } catch (error) {
      console.error('Error resuming download:', error);
      return false;
    }
  }
  
  getActiveDownloads() {
    return Array.from(this.activeDownloads.values());
  }
  
  clearCompletedDownloads() {
    this.activeDownloads.forEach((download, id) => {
      if (download.status === 'complete' || download.status === 'failed') {
        this.activeDownloads.delete(id);
      }
    });
  }
}
