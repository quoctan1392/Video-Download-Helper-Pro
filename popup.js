// Popup Script
let currentVideos = [];
let currentTabId = null;
let lastError = null; // Store last error details
let logEntries = []; // Store log entries
const MAX_LOG_ENTRIES = 500; // Maximum log entries to keep
let isLoadingQualities = false; // Flag to prevent reload during quality selection
let downloadStates = new Map(); // Track download state per video URL
let refreshTimeout = null; // Debounce timeout for video detection

// Initialize popup
document.addEventListener("DOMContentLoaded", async () => {
  // Setup message listener for background updates
  // Setup comprehensive message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("[Popup] Received message:", message);

    if (message && message.action === "videoDetected") {
      console.log("[Popup] Video detected, adding incrementally...");
      // Add new video incrementally instead of reloading entire list
      if (message.video) {
        addNewVideoToList(message.video);
      } else {
        // Fallback: if no video object provided, do a full reload with debounce
        if (refreshTimeout) clearTimeout(refreshTimeout);
        refreshTimeout = setTimeout(() => {
          console.log(
            "[Popup] New video detected (no video object), refreshing list...",
          );
          loadVideos();
        }, 1000);
      }
      sendResponse({ received: true });
    }

    if (message && message.action === "refreshPopup") {
      console.log("[Popup] Manual refresh requested");
      loadVideos();
      sendResponse({ refreshed: true });
    }

    if (message && message.action === "log") {
      // Handle log messages from background
      if (message.log) {
        logEntries.push(message.log);
        // Keep only recent entries
        if (logEntries.length > MAX_LOG_ENTRIES) {
          logEntries.shift();
        }
        // Update log display if modal is open
        const logModal = document.getElementById("logModal");
        if (logModal && logModal.style.display === "flex") {
          refreshLog();
        }
      } else {
        addLog(
          message.level || "info",
          message.source || "Unknown",
          message.message || "",
          message.data,
        );
      }
    }

    if (message && message.action === "downloadProgress") {
      updateVideoProgress(message.data);
    }
  });

  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  console.log("[Popup] Current tab ID:", currentTabId);
  console.log("[Popup] Current tab URL:", tab.url);
  console.log("[Popup] Tab object:", tab);

  // Load download states FIRST before displaying videos
  await loadDownloadStates();

  // Try to load persisted videos (this will call displayVideos which needs downloadStates)
  await loadPersistedVideos();

  // Ensure content script is injected (in case page loaded before extension)
  try {
    // Check if content script is already injected by sending a test message
    const testResponse = await chrome.tabs
      .sendMessage(currentTabId, { action: "ping" })
      .catch(() => null);

    if (!testResponse) {
      // Content script not injected yet, inject it
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ["content.js"],
      });
      console.log("[Popup] Content script injected");

      // Force scan for videos after injection
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(currentTabId, { action: "scanVideos" });
          console.log("[Popup] Sent scanVideos message to content script");
        } catch (e) {
          console.log("[Popup] Could not send scanVideos:", e.message);
        }
      }, 500);
    } else {
      console.log("[Popup] Content script already injected");
    }
  } catch (e) {
    // Content script may already be injected, ignore error
    console.log("[Popup] Content script check error:", e.message);
  }

  // Load videos from background
  loadVideos();

  // Setup periodic refresh every 10 seconds
  setInterval(() => {
    // Skip refresh if there are active downloads to prevent progress bar flickering
    const hasActiveDownloads = downloadStates.size > 0;
    if (hasActiveDownloads) {
      console.log(
        "[Popup] Skipping periodic refresh - active downloads in progress",
      );
      return;
    }
    console.log("[Popup] Periodic refresh...");
    loadVideos();
  }, 10000);

  // Setup event listeners
  document.getElementById("logBtn").addEventListener("click", openLogConsole);
  document
    .getElementById("refreshBtn")
    .addEventListener("click", refreshVideos);
  document.getElementById("clearBtn").addEventListener("click", clearVideos);
  document
    .getElementById("errorInfoBtn")
    .addEventListener("click", showErrorDetails);
  document
    .getElementById("closeErrorModal")
    .addEventListener("click", closeErrorModal);
  document
    .getElementById("closeErrorModalBtn")
    .addEventListener("click", closeErrorModal);
  document
    .getElementById("copyErrorBtn")
    .addEventListener("click", copyErrorToClipboard);
  document
    .getElementById("closeLogModal")
    .addEventListener("click", closeLogModal);
  document.getElementById("clearLogBtn").addEventListener("click", clearLog);
  document
    .getElementById("copyLogBtn")
    .addEventListener("click", copyLogToClipboard);
  document
    .getElementById("refreshLogBtn")
    .addEventListener("click", refreshLog);

  // Close modal when clicking outside
  document.getElementById("errorModal").addEventListener("click", (e) => {
    if (e.target.id === "errorModal") {
      closeErrorModal();
    }
  });

  document.getElementById("logModal").addEventListener("click", (e) => {
    if (e.target.id === "logModal") {
      closeLogModal();
    }
  });

  // Load logs from storage
  loadLogsFromStorage();
});

// Update per-video download progress
function updateVideoProgress(data) {
  // Get video URL from data (sent from background)
  const videoUrl = data.videoUrl || "";
  if (!videoUrl) {
    console.warn("[Popup] No videoUrl in progress data");
    return;
  }

  // DEBUG: Log received progress data
  console.log("[Popup] updateVideoProgress received:", {
    videoUrl: videoUrl.substring(0, 50),
    percent: data.percent,
    text: data.text,
    detail: data.detail,
    size: data.size,
    paused: data.paused,
    show: data.show,
  });

  const videoItem = document.querySelector(
    `.video-item[data-url="${CSS.escape(videoUrl)}"]`,
  );
  if (!videoItem) {
    console.warn("[Popup] Video item not found for:", videoUrl);
    return;
  }

  const separator = videoItem.querySelector(".video-separator");
  const progressContainer = videoItem.querySelector(".video-progress");
  const progressBar = videoItem.querySelector(".video-progress-bar");
  const progressFill = videoItem.querySelector(".video-progress-fill");
  const progressText = videoItem.querySelector(".video-progress-text");
  const progressPercent = videoItem.querySelector(".video-progress-percent");
  const progressDetail = videoItem.querySelector(".video-progress-detail");
  const progressSize = videoItem.querySelector(".video-progress-size");
  const progressSpeed = videoItem.querySelector(".video-progress-speed");
  const downloadBtn = videoItem.querySelector(".download-btn");
  const pauseBtn = videoItem.querySelector(".pause-download-btn");
  const cancelBtn = videoItem.querySelector(".cancel-download-btn");
  const deleteBtn = videoItem.querySelector(".delete-btn");
  const downloadIcon = downloadBtn?.querySelector(".download-icon");
  const loadingIcon = downloadBtn?.querySelector(".loading-icon");
  const btnText = downloadBtn?.querySelector(".btn-text");

  if (!progressContainer) return;

  if (data.show) {
    // Show progress and separator
    if (separator) separator.style.display = "block";
    progressContainer.style.display = "block";

    // Get current state to preserve progress when paused
    const currentState = downloadStates.get(videoUrl) || {};

    // Update progress bar - preserve current percent if paused and incoming percent is 0
    let displayPercent = data.percent || 0;
    if (
      data.paused === true &&
      displayPercent === 0 &&
      currentState.percent > 0
    ) {
      // When paused, keep the last known progress instead of resetting to 0
      displayPercent = currentState.percent;
      console.log("[Popup] Preserving progress on pause:", displayPercent);
    }

    progressFill.style.width = `${displayPercent}%`;
    progressPercent.textContent = `${Math.round(displayPercent)}%`;
    progressFill.style.width = `${displayPercent}%`;
    progressPercent.textContent = `${Math.round(displayPercent)}%`;

    // Update progress text - ALWAYS update when paused is explicitly set
    if (data.paused === true && progressText) {
      // When paused, show the pause message
      progressText.textContent = data.text || "⏸️ Paused";
    } else if (data.paused === false && progressText) {
      // When resumed, show the resume/download message
      progressText.textContent = data.text || "Downloading...";
    } else if (data.paused === undefined && progressText) {
      // Normal progress update (not pause/resume related)
      progressText.textContent = data.text || "Downloading...";
    }

    if (progressDetail) progressDetail.textContent = data.detail || "";
    if (progressSize) progressSize.textContent = data.size || "";
    if (progressSpeed) progressSpeed.textContent = data.speed || "";

    // Update download states - use displayPercent instead of data.percent
    downloadStates.set(videoUrl, {
      downloading: true,
      percent: displayPercent,
      paused:
        data.paused !== undefined
          ? data.paused === true
          : currentState.paused || false,
    });
    // Save to storage
    saveDownloadStates();

    // Update pause button icon based on pause state - ONLY if paused state is explicitly provided
    if (data.paused !== undefined) {
      const isPaused = data.paused === true;
      if (pauseBtn) {
        const pauseIcon = pauseBtn.querySelector(".pause-icon");
        const resumeIcon = pauseBtn.querySelector(".resume-icon");
        if (isPaused) {
          if (pauseIcon) pauseIcon.style.display = "none";
          if (resumeIcon) resumeIcon.style.display = "inline";
          pauseBtn.title = "Resume";
        } else {
          if (pauseIcon) pauseIcon.style.display = "inline";
          if (resumeIcon) resumeIcon.style.display = "none";
          pauseBtn.title = "Pause";
        }
      }

      // Update download button UI when paused
      if (downloadBtn && btnText && loadingIcon && downloadIcon) {
        if (isPaused) {
          // Paused state: hide loading icon, show download icon, change text
          loadingIcon.style.display = "none";
          downloadIcon.style.display = "inline";
          btnText.textContent = "Paused";
          downloadBtn.classList.add("paused");
        } else {
          // Resumed state: show loading icon, hide download icon, change text back
          loadingIcon.style.display = "inline";
          downloadIcon.style.display = "none";
          btnText.textContent = "Downloading...";
          downloadBtn.classList.remove("paused");
        }
      }
    }

    // Update button states - disable download and delete buttons, show pause/cancel
    // ONLY update if NOT explicitly paused (to avoid overriding paused state UI)
    if (downloadBtn && data.paused !== true) {
      downloadBtn.disabled = true;
      downloadBtn.classList.add("downloading");
      if (downloadIcon) downloadIcon.style.display = "none";
      if (loadingIcon) loadingIcon.style.display = "inline";
      if (btnText) btnText.textContent = "Downloading...";
    }
    if (deleteBtn) {
      deleteBtn.disabled = true;
      deleteBtn.style.opacity = "0.5";
      deleteBtn.style.cursor = "not-allowed";
    }
    if (pauseBtn && cancelBtn) {
      pauseBtn.style.display = "inline-flex";
      cancelBtn.style.display = "inline-flex";
    }

    // Hide on completion
    if (data.percent >= 100) {
      setTimeout(() => {
        if (separator) separator.style.display = "none";
        progressContainer.style.display = "none";
        downloadStates.delete(videoUrl);
        saveDownloadStates(); // Save after deletion

        // Re-enable and reset download button
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.classList.remove("downloading");
          if (downloadIcon) downloadIcon.style.display = "inline";
          if (loadingIcon) loadingIcon.style.display = "none";
          const video = currentVideos.find((v) => v.url === videoUrl);
          const isStreaming =
            video?.type === "dash" ||
            video?.type === "hls" ||
            video?.type === "mpd";
          if (btnText) btnText.textContent = "Download";
        }
        // Re-enable delete button
        if (deleteBtn) {
          deleteBtn.disabled = false;
          deleteBtn.style.opacity = "1";
          deleteBtn.style.cursor = "pointer";
        }
        if (pauseBtn) pauseBtn.style.display = "none";
        if (cancelBtn) cancelBtn.style.display = "none";

        // Update video downloaded status without full rebuild
        const video = currentVideos.find((v) => v.url === videoUrl);
        if (video && data.downloadId) {
          video.downloaded = true;
          video.downloadId = data.downloadId;
          saveVideosToStorage();

          // Add downloaded badge and folder button inline without rebuild
          const videoHeader = videoItem.querySelector(".video-item-header");
          if (videoHeader && !videoHeader.querySelector(".downloaded")) {
            const badge = document.createElement("span");
            badge.className = "video-badge downloaded";
            badge.textContent = "✓ Downloaded";
            videoHeader.insertBefore(
              badge,
              videoHeader.querySelector(".video-duration"),
            );
          }

          const videoActions = videoItem.querySelector(".video-actions");
          if (
            videoActions &&
            !videoActions.querySelector(".folder-btn") &&
            data.downloadId
          ) {
            const folderBtn = document.createElement("button");
            folderBtn.className = "folder-btn";
            folderBtn.setAttribute("data-download-id", data.downloadId);
            folderBtn.title = "Open folder";
            folderBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            `;
            folderBtn.addEventListener("click", () =>
              openDownloadFolder(data.downloadId),
            );
            videoActions.insertBefore(
              folderBtn,
              videoActions.querySelector(".delete-btn"),
            );
          }
        }
      }, 2000);
    }
  } else {
    // Hide progress and separator
    if (separator) separator.style.display = "none";
    progressContainer.style.display = "none";
    downloadStates.delete(videoUrl);
    saveDownloadStates(); // Save after deletion

    // Reset button states
    if (downloadBtn) {
      downloadBtn.disabled = false;
      downloadBtn.classList.remove("downloading");
      if (downloadIcon) downloadIcon.style.display = "inline";
      if (loadingIcon) loadingIcon.style.display = "none";
      const video = currentVideos.find((v) => v.url === videoUrl);
      const isStreaming =
        video?.type === "dash" ||
        video?.type === "hls" ||
        video?.type === "mpd";
      if (btnText) btnText.textContent = "Download";
    }
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.style.opacity = "1";
      deleteBtn.style.cursor = "pointer";
    }
    if (pauseBtn) pauseBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
  }
}

// Open log console modal
function openLogConsole() {
  addLog("info", "Popup", "Opening log console...");
  refreshLog(); // Refresh log display
  document.getElementById("logModal").style.display = "flex";
}

// Close log console modal
function closeLogModal() {
  document.getElementById("logModal").style.display = "none";
}

// Clear log entries
function clearLog() {
  logEntries = [];
  saveLogsToStorage();
  refreshLog();
  addLog("info", "Popup", "Log cleared");
}

// Copy log to clipboard
async function copyLogToClipboard() {
  const logText = logEntries
    .map(
      (entry) =>
        `[${entry.timestamp}] [${entry.source}] ${entry.level.toUpperCase()}: ${entry.message}`,
    )
    .join("\n");

  await navigator.clipboard.writeText(logText);
  updateStatus("Log copied!", "📋");
  setTimeout(() => {
    updateStatus(
      `Tìm thấy ${currentVideos.length} video`,
      currentVideos.length > 0 ? "✅" : "❌",
    );
  }, 2000);
}

// Update download button states based on download state map (no longer needed with per-video tracking)
function updateDownloadButtonStates() {
  // This function is now handled by updateVideoProgress for each video individually
  // Keep empty for backward compatibility
}

// Cancel current download
function cancelDownload() {
  console.log("[Popup] Canceling download...");

  // Send cancel message to background
  chrome.runtime
    .sendMessage({
      action: "cancelDownload",
    })
    .catch((error) => {
      console.error("[Popup] Error sending cancel message:", error);
    });

  // Reset UI state immediately
  isDownloading = false;
  currentDownloadIndex = null;
  updateDownloadButtonStates();

  // Hide progress bar
  updateProgress({ show: false });

  addLog("info", "Popup", "Download canceled by user");
}

// Refresh log display
function refreshLog() {
  const logConsole = document.getElementById("logConsole");

  if (logEntries.length === 0) {
    logConsole.innerHTML =
      '<div style="color: #858585; text-align: center; padding: 20px;">No logs</div>';
    return;
  }

  logConsole.innerHTML = logEntries
    .map((entry) => {
      const levelClass = `log-${entry.level}`;
      return `<div class="log-entry ${levelClass}">
      <span class="log-timestamp">${entry.timestamp}</span>
      <span class="log-source">[${entry.source}]</span>
      <span class="log-message">${escapeHtml(entry.message)}</span>
    </div>`;
    })
    .join("");

  // Scroll to bottom
  logConsole.scrollTop = logConsole.scrollHeight;
}

// Add log entry
function addLog(level, source, message) {
  const timestamp = new Date().toLocaleTimeString("vi-VN", { hour12: false });

  logEntries.push({
    timestamp,
    level, // 'info', 'warn', 'error', 'success'
    source, // 'Popup', 'Background', 'StreamProcessor', etc.
    message,
  });

  // Keep only recent entries
  if (logEntries.length > MAX_LOG_ENTRIES) {
    logEntries.shift();
  }

  // Save to storage
  saveLogsToStorage();

  // Also log to console
  console.log(`[${source}] ${message}`);
}

// Save logs to chrome.storage
async function saveLogsToStorage() {
  try {
    await chrome.storage.local.set({ extensionLogs: logEntries });
  } catch (error) {
    console.error("Failed to save logs:", error);
  }
}

// Save videos to chrome.storage by tabId
async function saveVideosToStorage() {
  if (!currentTabId) return;
  try {
    const key = `videos_tab_${currentTabId}`;
    await chrome.storage.local.set({ [key]: currentVideos });
    console.log(
      "[Popup] Saved",
      currentVideos.length,
      "videos to storage for tab",
      currentTabId,
    );
  } catch (error) {
    console.error("[Popup] Failed to save videos:", error);
  }
}

// Load persisted videos from chrome.storage
async function loadPersistedVideos() {
  if (!currentTabId) return;
  try {
    const key = `videos_tab_${currentTabId}`;
    const result = await chrome.storage.local.get(key);
    if (result[key] && Array.isArray(result[key])) {
      currentVideos = result[key];
      console.log(
        "[Popup] Loaded",
        currentVideos.length,
        "persisted videos from storage",
      );
      displayVideos();
      if (currentVideos.length > 0) {
        updateStatus(`${currentVideos.length} videos (saved)`, "💾");
      }
    }
  } catch (error) {
    console.error("[Popup] Failed to load persisted videos:", error);
  }
}

// Load persisted data without setting currentVideos (for merging)
async function loadPersistedData() {
  if (!currentTabId) return [];
  try {
    const key = `videos_tab_${currentTabId}`;
    const result = await chrome.storage.local.get(key);
    if (result[key] && Array.isArray(result[key])) {
      console.log(
        "[Popup] Loaded",
        result[key].length,
        "persisted videos for merging",
      );
      return result[key];
    }
  } catch (error) {
    console.error("[Popup] Failed to load persisted data:", error);
  }
  return [];
}

// Save downloadStates to chrome.storage
async function saveDownloadStates() {
  if (!currentTabId) return;
  try {
    const key = `downloadStates_tab_${currentTabId}`;
    // Convert Map to plain object for storage
    const statesObj = {};
    downloadStates.forEach((value, key) => {
      statesObj[key] = value;
    });
    await chrome.storage.local.set({ [key]: statesObj });
    console.log("[Popup] Saved download states:", statesObj);
  } catch (error) {
    console.error("[Popup] Failed to save download states:", error);
  }
}

// Load downloadStates from chrome.storage
async function loadDownloadStates() {
  if (!currentTabId) return;
  try {
    const key = `downloadStates_tab_${currentTabId}`;
    console.log("[Popup] Loading download states with key:", key);
    const result = await chrome.storage.local.get(key);
    console.log("[Popup] Storage result:", result);
    if (result[key]) {
      // Convert plain object back to Map
      downloadStates.clear();
      Object.entries(result[key]).forEach(([url, state]) => {
        downloadStates.set(url, state);
      });
      console.log("[Popup] Loaded download states:", result[key]);
      console.log("[Popup] downloadStates Map size:", downloadStates.size);
      // Note: UI restore will happen after displayVideos() is called
    } else {
      console.log("[Popup] No download states found in storage");
    }
  } catch (error) {
    console.error("[Popup] Failed to load download states:", error);
  }
}

// Restore download progress UI from saved state
function restoreDownloadProgress(videoUrl, state) {
  console.log("[Popup] Restoring download progress for:", videoUrl, state);

  const videoItem = document.querySelector(
    `.video-item[data-url="${CSS.escape(videoUrl)}"]`,
  );
  if (!videoItem) {
    console.warn("[Popup] Video item not found for restore:", videoUrl);
    return;
  }

  const separator = videoItem.querySelector(".video-separator");
  const progressContainer = videoItem.querySelector(".video-progress");
  const progressFill = videoItem.querySelector(".video-progress-fill");
  const progressText = videoItem.querySelector(".video-progress-text");
  const progressPercent = videoItem.querySelector(".video-progress-percent");
  const downloadBtn = videoItem.querySelector(".download-btn");
  const pauseBtn = videoItem.querySelector(".pause-download-btn");
  const cancelBtn = videoItem.querySelector(".cancel-download-btn");
  const deleteBtn = videoItem.querySelector(".delete-btn");
  const downloadIcon = downloadBtn?.querySelector(".download-icon");
  const loadingIcon = downloadBtn?.querySelector(".loading-icon");
  const btnText = downloadBtn?.querySelector(".btn-text");
  const pauseIcon = pauseBtn?.querySelector(".pause-icon");
  const resumeIcon = pauseBtn?.querySelector(".resume-icon");

  if (!progressContainer) return;

  // Show progress UI
  if (separator) separator.style.display = "block";
  progressContainer.style.display = "block";
  if (progressFill) progressFill.style.width = `${state.percent || 0}%`;
  if (progressPercent)
    progressPercent.textContent = `${Math.round(state.percent || 0)}%`;

  // Update pause button state
  if (state.paused) {
    if (progressText) progressText.textContent = "Paused";
    if (pauseIcon) pauseIcon.style.display = "none";
    if (resumeIcon) resumeIcon.style.display = "inline";
    if (pauseBtn) pauseBtn.title = "Resume";

    // Update download button for paused state
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.classList.add("downloading", "paused");
      if (loadingIcon) loadingIcon.style.display = "none";
      if (downloadIcon) downloadIcon.style.display = "inline";
      if (btnText) btnText.textContent = "Paused";
    }
  } else {
    if (progressText) progressText.textContent = "Downloading...";
    if (pauseIcon) pauseIcon.style.display = "inline";
    if (resumeIcon) resumeIcon.style.display = "none";
    if (pauseBtn) pauseBtn.title = "Pause";

    // Update download button for active download
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.classList.add("downloading");
      downloadBtn.classList.remove("paused");
      if (loadingIcon) loadingIcon.style.display = "inline";
      if (downloadIcon) downloadIcon.style.display = "none";
      if (btnText) btnText.textContent = "Downloading...";
    }
  }

  // Show pause/cancel buttons
  if (pauseBtn) pauseBtn.style.display = "inline-flex";
  if (cancelBtn) cancelBtn.style.display = "inline-flex";

  // Disable delete button
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = "0.5";
    deleteBtn.style.cursor = "not-allowed";
  }

  console.log("[Popup] Download progress restored for:", videoUrl);
}

// Restore all download progress bars from downloadStates
function restoreAllDownloadProgress() {
  console.log("[Popup] Restoring all download progress bars...");
  console.log("[Popup] downloadStates size:", downloadStates.size);

  if (downloadStates.size === 0) {
    console.log("[Popup] No download states to restore");
    return;
  }

  downloadStates.forEach((state, videoUrl) => {
    if (state.downloading) {
      console.log("[Popup] Restoring progress for:", videoUrl, state);
      restoreDownloadProgress(videoUrl, state);
    }
  });

  console.log("[Popup] Finished restoring all download progress bars");
}

// Load logs from chrome.storage
async function loadLogsFromStorage() {
  try {
    const result = await chrome.storage.local.get("extensionLogs");
    if (result.extensionLogs) {
      logEntries = result.extensionLogs;
    }
  } catch (error) {
    console.error("Failed to load logs:", error);
  }
}

// Refresh videos - clear cache and reload videos
async function refreshVideos() {
  updateStatus("Refreshing...", "🔄");
  addLog("info", "Popup", "Clearing cache and refreshing...");

  try {
    // Clear persisted videos from storage
    const key = `videos_tab_${currentTabId}`;
    await chrome.storage.local.remove(key);
    console.log("[Popup] Cleared persisted videos from storage");

    // Clear cached videos for this tab in background
    const response = await chrome.runtime.sendMessage({
      action: "clearVideos",
      tabId: currentTabId,
    });
    console.log("[Popup] Clear videos response:", response);

    // Clear current videos array
    currentVideos = [];
    displayVideos(); // Show empty state

    updateStatus("Cache cleared! Rescanning...", "✅");
    addLog("success", "Popup", "Cache cleared, re-scanning...");

    // Ensure content script is injected before scanning
    try {
      const testResponse = await chrome.tabs
        .sendMessage(currentTabId, { action: "ping" })
        .catch(() => null);

      if (!testResponse) {
        console.log("[Popup] Content script not detected, injecting...");

        // Inject both content and injected scripts
        await chrome.scripting.executeScript({
          target: { tabId: currentTabId },
          files: ["content.js"],
        });

        await chrome.scripting.executeScript({
          target: { tabId: currentTabId, allFrames: true },
          files: ["injected.js"],
          world: "MAIN",
        });

        addLog("info", "Popup", "Content and injected scripts injected");

        // Wait for scripts to initialize
        await new Promise((resolve) => setTimeout(resolve, 800));
      }

      // Now send scan command
      await chrome.tabs.sendMessage(currentTabId, { action: "scanVideos" });
      console.log("[Popup] Sent scanVideos to content script");
      addLog("success", "Popup", "Scan command sent");
    } catch (e) {
      console.log("[Popup] Could not send scanVideos:", e.message);
      addLog("warn", "Popup", `Scan failed: ${e.message}`);
    }

    // Wait a bit then reload videos from background
    setTimeout(() => {
      loadVideos();
    }, 1500);
  } catch (error) {
    console.error("[Popup] Error refreshing:", error);
    addLog("error", "Popup", `Refresh error: ${error.message}`);
    updateStatus("Lỗi khi làm mới", "❌");
    updateStatus(`Error refreshing: ${error?.message || ""}`, "❌");
  }
}

// Add test videos for debugging
async function addTestVideos() {
  console.log("[Popup] Adding test videos...");
  updateStatus("Adding test videos...", "🧪");

  try {
    const testVideos = [
      {
        url: "https://customer-yamew980vfq5r6ry.cloudflarestream.com/test1.mpd",
        type: "dash",
      },
      {
        url: "https://customer-yamew980vfq5r6ry.cloudflarestream.com/test2.mpd",
        type: "dash",
      },
      {
        url: "https://example.com/hls_stream.m3u8",
        type: "hls",
      },
    ];

    for (const testVideo of testVideos) {
      await chrome.runtime.sendMessage({
        action: "manifestDetected",
        url: testVideo.url,
        type: testVideo.type,
        tabId: currentTabId,
      });

      console.log("[Popup] Added test video:", testVideo.url);
    }

    addLog("success", "Popup", `Added ${testVideos.length} test videos`);
    updateStatus("Test videos added!", "✅");

    // Reload videos after delay
    setTimeout(() => {
      loadVideos();
    }, 1000);
  } catch (error) {
    console.error("[Popup] Error adding test videos:", error);
    addLog("error", "Popup", `Failed to add test videos: ${error.message}`);
    updateStatus("Lỗi khi thêm test videos", "⚠️");
  }
}

// Scan videos on page without clearing cache
async function scanVideos() {
  updateStatus("Scanning for videos...", "🔍");
  addLog("info", "Popup", "Scanning for videos...");

  try {
    // First try to send scan message to content script
    try {
      await chrome.tabs.sendMessage(currentTabId, { action: "scanVideos" });
      console.log("[Popup] Sent scanVideos to content script");
      addLog("success", "Popup", "Scan request sent");
    } catch (e) {
      console.log("[Popup] Content script not available, injecting...");

      // Inject content script if not present
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ["content.js"],
      });

      // Wait and try again
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(currentTabId, { action: "scanVideos" });
          console.log("[Popup] scanVideos sent after injection");
        } catch (err) {
          console.error("[Popup] Still failed after injection:", err);
        }
      }, 500);
    }

    // Add some test videos for debugging after delay
    setTimeout(async () => {
      console.log("[Popup] Adding test videos for debugging...");

      try {
        // Send test manifest to background
        await chrome.runtime.sendMessage({
          action: "manifestDetected",
          url: "https://example.com/test_video.mpd",
          type: "dash",
          tabId: currentTabId,
        });

        await chrome.runtime.sendMessage({
          action: "manifestDetected",
          url: "https://example.com/test_stream.m3u8",
          type: "hls",
          tabId: currentTabId,
        });

        await chrome.runtime.sendMessage({
          action: "manifestDetected",
          url: "https://cloudflarestream.com/abcd1234/manifest.mpd",
          type: "dash",
          tabId: currentTabId,
        });

        addLog("info", "Popup", "Test videos added for debugging");

        // Reload videos
        setTimeout(() => {
          loadVideos();
        }, 1000);
      } catch (err) {
        console.error("[Popup] Failed to add test videos:", err);
      }
    }, 2000);

    // Wait a bit then reload videos from background
    setTimeout(() => {
      loadVideos();
    }, 500);
  } catch (error) {
    console.error("[Popup] Error scanning:", error);
    addLog("error", "Popup", `Scan error: ${error.message}`);
    updateStatus("Unable to scan videos", "⚠️");
  }
}

// Load videos from background script
async function loadVideos() {
  console.log("[Popup] === LOADING VIDEOS START ===");
  console.log(
    "[Popup] currentTabId:",
    currentTabId,
    "typeof:",
    typeof currentTabId,
  );
  updateStatus("Searching for videos...", "🔍");

  try {
    // PRIORITY METHOD: Get ALL videos first (most reliable)
    console.log("[Popup] Priority Method: Requesting ALL videos");

    const allResponse = await chrome.runtime.sendMessage({
      action: "getAllVideos",
    });

    console.log("[Popup] ALL videos response received:", allResponse);
    console.log("[Popup] ALL videos count:", allResponse?.videos?.length);

    if (
      allResponse &&
      allResponse.videos &&
      Array.isArray(allResponse.videos) &&
      allResponse.videos.length > 0
    ) {
      console.log(
        "[Popup] SUCCESS: Found ALL videos:",
        allResponse.videos.length,
      );

      // Load persisted data to preserve downloaded status
      const persistedData = await loadPersistedData();

      // Merge: preserve downloaded status and downloadId from persisted data
      currentVideos = allResponse.videos.map((video) => {
        const persisted = persistedData.find((v) => v.url === video.url);
        if (persisted && persisted.downloaded) {
          return {
            ...video,
            downloaded: persisted.downloaded,
            downloadId: persisted.downloadId,
          };
        }
        return video;
      });

      console.log(
        "[Popup] currentVideos merged with persisted data:",
        currentVideos,
      );
      await saveVideosToStorage(); // Save merged data
      displayVideos();
      updateStatus(`Found ${currentVideos.length} videos`, "✅");
      return;
    } else {
      console.log("[Popup] ALL videos method FAILED or empty");
    }

    // BACKUP: Try debug method
    console.log("[Popup] Backup Method: Debug call to list videos");

    const debugResponse = await chrome.runtime.sendMessage({
      action: "debug",
      command: "listVideos",
    });

    console.log("[Popup] Debug response received:", debugResponse);
    console.log("[Popup] Debug videos count:", debugResponse?.videos?.length);

    if (
      debugResponse &&
      debugResponse.videos &&
      Array.isArray(debugResponse.videos) &&
      debugResponse.videos.length > 0
    ) {
      console.log(
        "[Popup] SUCCESS: Found debug videos:",
        debugResponse.videos.length,
      );

      // Load persisted data to preserve downloaded status
      const persistedData = await loadPersistedData();

      // Merge with persisted data
      currentVideos = debugResponse.videos.map((video) => {
        const persisted = persistedData.find((v) => v.url === video.url);
        if (persisted && persisted.downloaded) {
          return {
            ...video,
            downloaded: persisted.downloaded,
            downloadId: persisted.downloadId,
          };
        }
        return video;
      });

      console.log(
        "[Popup] currentVideos merged with persisted data:",
        currentVideos,
      );
      await saveVideosToStorage();
      displayVideos();
      updateStatus(`Found ${currentVideos.length} videos`, "🔧");
      return;
    } else {
      console.log("[Popup] Debug method FAILED or empty");
    }

    // FALLBACK: Try specific tab (last resort)
    console.log(
      "[Popup] Fallback Method: Requesting videos for current tab:",
      currentTabId,
    );

    const tabResponse = await chrome.runtime.sendMessage({
      action: "getVideos",
      tabId: currentTabId,
    });

    console.log("[Popup] Tab response received:", tabResponse);
    console.log("[Popup] Tab videos count:", tabResponse?.videos?.length);

    if (
      tabResponse &&
      tabResponse.videos &&
      Array.isArray(tabResponse.videos) &&
      tabResponse.videos.length > 0
    ) {
      console.log(
        "[Popup] SUCCESS: Found tab videos:",
        tabResponse.videos.length,
      );

      // Load persisted data to preserve downloaded status
      const persistedData = await loadPersistedData();

      // Merge with persisted data
      currentVideos = tabResponse.videos.map((video) => {
        const persisted = persistedData.find((v) => v.url === video.url);
        if (persisted && persisted.downloaded) {
          return {
            ...video,
            downloaded: persisted.downloaded,
            downloadId: persisted.downloadId,
          };
        }
        return video;
      });

      console.log(
        "[Popup] currentVideos merged with persisted data:",
        currentVideos,
      );
      await saveVideosToStorage();
      displayVideos();
      updateStatus(`Found ${currentVideos.length} videos (tab)`, "⚡");
      return;
    } else {
      console.log("[Popup] Tab method FAILED or empty");
    }

    // All methods failed
    console.log("[Popup] ALL METHODS FAILED: No videos found");
    console.log("[Popup] Setting currentVideos to empty array");
    currentVideos = [];
    displayVideos();
    updateStatus("No videos found", "❌");
  } catch (error) {
    console.error("[Popup] Load videos error:", error);
    console.error("[Popup] Error stack:", error.stack);
    updateStatus("Error loading videos", "⚠️");
    currentVideos = [];
    displayVideos();
  }

  console.log("[Popup] === LOADING VIDEOS END ===");
}

// Force load all videos regardless of tabId
async function forceLoadAllVideos() {
  console.log("[Popup] Force loading all videos...");
  updateStatus("Force loading videos...", "🔄");

  try {
    const response = await chrome.runtime.sendMessage({
      action: "getAllVideos",
    });

    console.log("[Popup] Force load response:", response);

    if (response && response.videos && response.videos.length > 0) {
      currentVideos = response.videos;
      displayVideos();
      updateStatus(`Force loaded ${currentVideos.length} videos`, "✅");
      addLog("success", "Popup", `Force loaded ${currentVideos.length} videos`);
    } else {
      updateStatus("No videos found in background storage", "⚠️");
      addLog("warning", "Popup", "No videos found in background storage");

      // Also try to get stored videos state for debugging
      try {
        const debugResponse = await chrome.runtime.sendMessage({
          action: "debug",
          command: "listVideos",
        });
        console.log("[Popup] Debug state:", debugResponse);
        addLog("info", "Popup", `Debug: ${JSON.stringify(debugResponse)}`);
      } catch (e) {
        console.log("[Popup] Debug request failed:", e);
      }
    }
  } catch (error) {
    console.error("[Popup] Force load error:", error);
    updateStatus("Force load failed", "❌");
    addLog("error", "Popup", `Force load error: ${error.message}`);
  }
}

// Display videos in list
async function displayVideos() {
  console.log("[Popup] === DISPLAYING VIDEOS ===");
  console.log("[Popup] currentVideos:", currentVideos);
  console.log("[Popup] currentVideos.length:", currentVideos.length);
  console.log("[Popup] typeof currentVideos:", typeof currentVideos);
  console.log(
    "[Popup] Array.isArray(currentVideos):",
    Array.isArray(currentVideos),
  );

  const videoList = document.getElementById("videoList");

  if (!currentVideos || currentVideos.length === 0) {
    console.log("[Popup] No videos to display - showing empty state");
    videoList.innerHTML = `
      <div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M23 7l-7 5 7 5V7z"/>
          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
        <p>No videos found</p>
        <small>Click refresh or reload the page</small>
      </div>
    `;
    return;
  }

  console.log("[Popup] Displaying", currentVideos.length, "videos");
  console.log("[Popup] Videos data:", currentVideos);

  // Group videos by URL to avoid duplicates
  const uniqueVideos = new Map();
  currentVideos.forEach((video, i) => {
    console.log(`[Popup] Processing video ${i}:`, video);
    if (!uniqueVideos.has(video.url)) {
      uniqueVideos.set(video.url, video);
    } else {
      console.log(`[Popup] Duplicate URL found for video ${i}:`, video.url);
    }
  });

  console.log("[Popup] Unique videos count:", uniqueVideos.size);
  console.log("[Popup] Unique videos:", Array.from(uniqueVideos.values()));

  videoList.innerHTML = Array.from(uniqueVideos.values())
    .map((video, index) => generateVideoItemHTML(video, index))
    .join("");

  // Attach event listeners to all video items
  attachVideoEventListeners();

  // Restore download progress bars if any downloads are active
  restoreAllDownloadProgress();

  // Save current state to storage to persist when popup closes
  await saveVideosToStorage();
}

// Generate HTML for a single video item
function generateVideoItemHTML(video, index) {
  const isStreaming =
    video.type === "dash" || video.type === "hls" || video.type === "mpd";
  const duration = video.duration ? formatDuration(video.duration) : null;
  const size = video.estimatedSize || video.contentLength;
  const isExact = video.isExactSize;

  return `
    <div class="video-item" data-index="${index}" data-url="${escapeHtml(video.url)}">
      <div class="video-item-header">
        <span class="video-type ${video.type}">${video.type || "video"}</span>
        ${video.downloaded ? '<span class="video-badge downloaded">✓ Downloaded</span>' : ""}
        ${duration ? `<span class="video-duration">⏱️ ${duration}</span>` : ""}
        <div style="margin-left: auto; display: flex; gap: 6px; align-items: center;">
          ${isStreaming ? '<span class="video-badge streaming">🔗 Streaming</span>' : ""}
          ${size ? `<span class="video-size" title="${isExact ? "Dung lượng chính xác" : "Dung lượng ước tính"}">${isExact ? "✅ " : ""}${formatFileSize(size)}</span>` : ""}
        </div>
      </div>
      <div class="video-url" title="${escapeHtml(video.url)}">
        ${escapeHtml(truncateUrl(video.url, 60))}
      </div>
      <div class="video-actions">
        ${
          isStreaming
            ? `
        <select class="quality-select" data-url="${escapeHtml(video.url)}" data-index="${index}">
          <option value='{"height":1080,"resolution":"1920x1080","label":"1080p"}'>1080p - Full HD</option>
          <option value='{"height":720,"resolution":"1280x720","label":"720p"}'>720p - HD</option>
          <option value='{"height":480,"resolution":"854x480","label":"480p"}'>480p - SD</option>
          <option value='{"height":360,"resolution":"640x360","label":"360p"}'>360p</option>
          <option value='{"height":240,"resolution":"426x240","label":"240p"}'>240p</option>
        </select>
        `
            : ""
        }
        <button class="btn btn-primary download-btn" data-url="${escapeHtml(video.url)}" data-type="${video.type}" data-index="${index}">
          <svg class="download-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <svg class="loading-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="display: none;">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 6v6l4 2"></path>
          </svg>
          <span class="btn-text">${isStreaming ? "Download" : "Download"}</span>
        </button>
        ${
          video.downloaded && video.downloadId
            ? `
        <button class="folder-btn" data-download-id="${video.downloadId}" title="Open folder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
        `
            : ""
        }
        <button class="delete-btn" data-url="${escapeHtml(video.url)}" title="Delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
          </svg>
        </button>
      </div>
      <div class="video-separator" style="display: none;"></div>
      <div class="video-progress" style="display: none;">
        <div class="video-progress-header">
          <span class="video-progress-text">Downloading...</span>
          <div class="video-progress-controls">
            <span class="video-progress-percent">0%</span>
            <button class="pause-download-btn" data-url="${escapeHtml(video.url)}" title="Pause">
              <svg class="pause-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
              <svg class="resume-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: none;">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </button>
            <button class="cancel-download-btn" data-url="${escapeHtml(video.url)}" title="Cancel">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="video-progress-bar">
          <div class="video-progress-fill"></div>
        </div>
        <div class="video-progress-details">
          <span class="video-progress-detail">0/0 segments</span>
          <div class="video-progress-stats">
            <span class="video-progress-size">0 B</span>
            <span class="video-progress-speed"></span>
          </div>
        </div>
      </div>
    </div>
    `;
}

// Add a new video to the list incrementally without reloading
async function addNewVideoToList(video) {
  console.log("[Popup] Adding new video incrementally:", video);

  // Check if video already exists
  const exists = currentVideos.some((v) => v.url === video.url);
  if (exists) {
    console.log("[Popup] Video already in list, skipping:", video.url);
    return;
  }

  // Add to currentVideos array
  currentVideos.push(video);

  // Save to storage immediately
  await saveVideosToStorage();

  // Get video list container
  const videoList = document.getElementById("videoList");

  // If list was empty, replace the empty state
  if (currentVideos.length === 1) {
    videoList.innerHTML = "";
  }

  // Create temporary div to hold the HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = generateVideoItemHTML(video, currentVideos.length - 1);

  // Get the video item element
  const videoItem = tempDiv.firstElementChild;

  // Append to video list
  videoList.appendChild(videoItem);

  // Attach event listeners to the new item
  attachVideoEventListenersForItem(videoItem);

  // Update status
  updateStatus(`Tìm thấy ${currentVideos.length} video`, "✅");

  console.log("[Popup] Video added successfully and saved to storage");
}

// Attach event listeners to all video items
function attachVideoEventListeners() {
  const videoItems = document.querySelectorAll(".video-item");
  videoItems.forEach((item) => attachVideoEventListenersForItem(item));
}

// Attach event listeners to a single video item
function attachVideoEventListenersForItem(videoItem) {
  // Prevent dropdown from closing when clicking
  const qualitySelects = videoItem.querySelectorAll(".quality-select");
  qualitySelects.forEach((select) => {
    select.addEventListener("mousedown", (e) => {
      e.stopPropagation();
    });
    select.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  });

  // Add click handlers for folder buttons
  const folderBtns = videoItem.querySelectorAll(".folder-btn");
  folderBtns.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const downloadId = parseInt(btn.getAttribute("data-download-id"));

      if (isNaN(downloadId) || downloadId <= 0) {
        addLog("warn", "Popup", `Invalid download ID: ${downloadId}`);
        return;
      }

      try {
        // Show downloaded file in file explorer
        await chrome.downloads.show(downloadId);
        addLog(
          "info",
          "Popup",
          `Opened file location for download ID: ${downloadId}`,
        );
      } catch (error) {
        console.error("[Popup] Error showing file:", error);
        addLog("error", "Popup", `Failed to show file: ${error.message}`);

        // Try alternative: open downloads folder
        try {
          await chrome.downloads
            .search({ id: downloadId })
            .then((downloads) => {
              if (downloads && downloads.length > 0) {
                const download = downloads[0];
                addLog("info", "Popup", `File location: ${download.filename}`);
              }
            });
        } catch (e) {
          console.error("[Popup] Failed to get download info:", e);
        }
      }
    });
  });

  // Add click handlers for download buttons
  const downloadBtns = videoItem.querySelectorAll(".download-btn");
  downloadBtns.forEach((btn, btnIndex) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();

      const url = btn.getAttribute("data-url");
      const index = parseInt(btn.getAttribute("data-index"));
      const video = currentVideos.find((v) => v.url === url);

      // Check if this specific video is already downloading
      if (downloadStates.has(url) && downloadStates.get(url).downloading) {
        console.log("[Popup] This video is already downloading");
        return;
      }

      // Get selected quality from dropdown if exists
      const qualitySelect = document.querySelector(
        `.quality-select[data-index="${index}"]`,
      );
      let quality = null;
      if (qualitySelect && qualitySelect.value) {
        try {
          quality = JSON.parse(qualitySelect.value);
        } catch (e) {
          quality = null;
        }
      }

      downloadVideoWithQuality(video, quality);
    });
  });

  // Add click handlers for pause/resume buttons - REMOVE OLD LISTENERS FIRST
  const pauseBtns = videoItem.querySelectorAll(".pause-download-btn");
  pauseBtns.forEach((btn) => {
    // Clone button to remove all old event listeners
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    // Add single event listener to new button
    newBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const url = newBtn.getAttribute("data-url");

      // Get current state from downloadStates
      const state = downloadStates.get(url);
      if (!state || !state.downloading) {
        console.log("[Popup] No active download for this video");
        return;
      }

      // Prevent rapid clicks - disable button temporarily
      if (newBtn.disabled) {
        console.log("[Popup] Button disabled, ignoring click");
        return;
      }
      newBtn.disabled = true;

      // Determine if we're currently paused by checking the state
      const isCurrentlyPaused = state.paused === true;

      console.log("[Popup] Pause button clicked, current state:", {
        url,
        isCurrentlyPaused,
        state,
      });

      try {
        if (isCurrentlyPaused) {
          // Currently paused, so resume
          console.log("[Popup] Sending resumeDownload...");
          addLog("info", "Popup", `Resuming download: ${url}`);

          await chrome.runtime.sendMessage({
            action: "resumeDownload",
            videoUrl: url,
          });
        } else {
          // Currently running, so pause
          console.log("[Popup] Sending pauseDownload...");
          addLog("info", "Popup", `Pausing download: ${url}`);

          await chrome.runtime.sendMessage({
            action: "pauseDownload",
            videoUrl: url,
          });
        }
      } catch (err) {
        console.error("[Popup] Error toggling pause/resume:", err);
      } finally {
        // Re-enable button after 500ms
        setTimeout(() => {
          newBtn.disabled = false;
        }, 500);
      }
    });
  });

  // Add click handlers for cancel buttons
  const cancelBtns = videoItem.querySelectorAll(".cancel-download-btn");
  cancelBtns.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const url = btn.getAttribute("data-url");
      addLog("info", "Popup", `Cancel download: ${url}`);

      try {
        await chrome.runtime.sendMessage({
          action: "cancelDownload",
          videoUrl: url,
        });

        // Clear download state
        downloadStates.delete(url);
        saveDownloadStates(); // Save after deletion

        // Hide progress for this video
        updateVideoProgress({ videoUrl: url, show: false });
      } catch (err) {
        console.error("[Popup] Error canceling download:", err);
      }
    });
  });

  // Add click handlers for delete buttons
  const deleteBtns = videoItem.querySelectorAll(".delete-btn");
  deleteBtns.forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const url = btn.getAttribute("data-url");
      addLog("info", "Popup", `Remove clicked: ${url}`);

      // Remove from currentVideos and re-render list
      currentVideos = currentVideos.filter((v) => v.url !== url);
      await saveVideosToStorage();
      displayVideos();

      // Inform background to remove cached entry
      try {
        await chrome.runtime.sendMessage({
          action: "removeVideo",
          tabId: currentTabId,
          url,
        });
        addLog(
          "success",
          "Popup",
          `Requested background to remove video: ${url}`,
        );
      } catch (err) {
        console.error("[Popup] Error sending removeVideo:", err);
      }
    });
  });
}

// Download video with selected quality
async function downloadVideoWithQuality(video, quality) {
  addLog(
    "info",
    "Popup",
    `downloadVideoWithQuality: quality=${quality ? quality.label : "default"}`,
  );

  try {
    const isStreaming =
      video.type === "dash" || video.type === "hls" || video.type === "mpd";
    addLog(
      "info",
      "Popup",
      `Is streaming: ${isStreaming}, type: ${video.type}`,
    );

    if (isStreaming) {
      updateStatus("Analyzing stream...", "🔄");
    } else {
      updateStatus("Downloading...", "⬇️");
    }

    addLog("info", "Popup", "Sending downloadVideo message to background...");

    const response = await chrome.runtime.sendMessage({
      action: "downloadVideo",
      video: video,
      tabId: currentTabId, // Add tabId for background context
      options: {
        convertToMP4: isStreaming,
        quality: quality, // Pass selected quality
      },
    });

    addLog("info", "Popup", `Background response: ${JSON.stringify(response)}`);

    if (response.success) {
      const result = response.result;
      addLog(
        "success",
        "Popup",
        `Download success! Segments: ${result.segmentCount || "N/A"}`,
      );

      // Mark video as downloaded
      const videoIndex = currentVideos.findIndex((v) => v.url === video.url);
      if (videoIndex !== -1) {
        currentVideos[videoIndex].downloaded = true;
        if (result.downloadId) {
          currentVideos[videoIndex].downloadId = result.downloadId;
        }
        await saveVideosToStorage();
        // Display will be refreshed by updateVideoProgress after completion
      }

      if (result.segmentCount) {
        updateStatus(`Merged ${result.segmentCount} segments! 🎉`, "✅");
        lastError = null;
        hideErrorInfo();
      } else if (result.requiresConversion && result.ffmpegCommand) {
        // Show FFmpeg command for conversion
        if (result.skipDownload) {
          // Cloudflare Stream - no file downloaded
          updateStatus("Use FFmpeg to download this video", "💻");
          addLog(
            "warn",
            "Popup",
            `FFmpeg required (no download): ${result.ffmpegCommand}`,
          );
        } else {
          // Other streams - manifest downloaded
          updateStatus("FFmpeg required to convert the downloaded file", "⚠️");
          addLog(
            "warn",
            "Popup",
            `Manifest downloaded, FFmpeg required: ${result.ffmpegCommand}`,
          );
        }

        // Store as error with FFmpeg instructions
        lastError = {
          message: result.skipDownload
            ? "This video requires FFmpeg to download"
            : "Manifest downloaded. Use FFmpeg to convert to MP4",
          video: video,
          timestamp: new Date().toLocaleString("vi-VN"),
          type: "ffmpeg_required",
          ffmpegCommand: result.ffmpegCommand,
          skipDownload: result.skipDownload,
        };
        showErrorInfo();
      } else {
        updateStatus("Download complete! 🎉", "✅");
        lastError = null;
        hideErrorInfo();
      }

      setTimeout(() => {
        updateStatus(`Found ${currentVideos.length} videos`, "✅");
      }, 3000);
    } else if (response.requiresYtDlp) {
      // Show yt-dlp modal
      addLog("warn", "Popup", `Requires yt-dlp: ${response.ytDlpCommand}`);
      updateStatus("yt-dlp required to download this video", "🎬");
      showYtDlpModal(response.ytDlpCommand, response.manifestUrl);
    } else {
      addLog("error", "Popup", `Download failed: ${response.error}`);

      // Store error details
      lastError = {
        message: response.error || "Unknown error",
        video: video,
        timestamp: new Date().toLocaleString("vi-VN"),
        type: "download_failed",
      };

      updateStatus("Error downloading", "⚠️");
      showErrorInfo();
    }
  } catch (error) {
    addLog("error", "Popup", `Exception during download: ${error.message}`);

    // Reset download state on error
    isDownloading = false;
    currentDownloadIndex = null;
    updateDownloadButtonStates();
    updateProgress({ show: false });

    // Store error details
    lastError = {
      message: error.message || error.toString(),
      stack: error.stack,
      video: video,
      timestamp: new Date().toLocaleString("vi-VN"),
      type: "exception",
    };

    console.error("Download error:", error);
    updateStatus("Error downloading", "⚠️");
    showErrorInfo();
  }
}

// Clear videos
async function clearVideos() {
  try {
    await chrome.runtime.sendMessage({
      action: "clearVideos",
      tabId: currentTabId,
    });

    currentVideos = [];
    displayVideos();
    updateStatus("List cleared", "✅");

    setTimeout(() => {
      updateStatus("Không tìm thấy video nào", "❌");
    }, 1500);
  } catch (error) {
    console.error("Error clearing videos:", error);
  }
}

// Update status message
function updateStatus(message, icon = "🔍") {
  document.getElementById("statusText").textContent = message;
  document.querySelector(".status-icon").textContent = icon;
}

// Utility functions
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i === 0) return bytes + " " + units[i];

  return (bytes / Math.pow(k, i)).toFixed(2) + " " + units[i];
}

function formatDuration(seconds) {
  if (!seconds) return null;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }
}

function truncateUrl(url, maxLength) {
  if (url.length <= maxLength) return url;

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const path = urlObj.pathname;

    if (domain.length + path.length <= maxLength) {
      return domain + path;
    }

    const truncated =
      domain + path.substring(0, maxLength - domain.length - 3) + "...";
    return truncated;
  } catch {
    return url.substring(0, maxLength) + "...";
  }
}

// Show error info button
function showErrorInfo() {
  document.getElementById("errorInfoBtn").style.display = "flex";
}

// Hide error info button
function hideErrorInfo() {
  document.getElementById("errorInfoBtn").style.display = "none";
}

// Show error details modal
function showErrorDetails() {
  if (!lastError) return;

  const modal = document.getElementById("errorModal");
  const errorDetails = document.getElementById("errorDetails");
  const suggestionsList = document.getElementById("errorSuggestionsList");

  // Build error details HTML
  let detailsHtml = `
    <div class="error-item">
      <strong>⏰ Time:</strong> ${lastError.timestamp}
    </div>
    <div class="error-item">
      <strong>📝 Error:</strong> ${escapeHtml(lastError.message)}
    </div>
  `;

  if (lastError.video) {
    detailsHtml += `
      <div class="error-item">
        <strong>🎬 Video:</strong> ${escapeHtml(lastError.video.type || "unknown")}
      </div>
      <div class="error-item">
        <strong>🔗 URL:</strong> 
        <div class="error-url">${escapeHtml(lastError.video.url)}</div>
      </div>
    `;
  }

  if (lastError.stack) {
    detailsHtml += `
      <div class="error-item">
        <strong>🐛 Stack trace:</strong>
        <pre class="error-stack">${escapeHtml(lastError.stack)}</pre>
      </div>
    `;
  }

  if (lastError.ffmpegCommand) {
    detailsHtml += `
      <div class="error-item">
        <strong>💻 FFmpeg Command:</strong>
        <pre class="error-stack" style="background: #1e1e1e; color: #4fc3f7; padding: 12px; border-radius: 4px; font-size: 12px; overflow-x: auto;">${escapeHtml(lastError.ffmpegCommand)}</pre>        <button id="copyFfmpegBtn" class="btn btn-primary" style="margin-top: 8px;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          Copy FFmpeg command
        </button>      </div>
    `;
  }

  errorDetails.innerHTML = detailsHtml;

  // Generate suggestions based on error
  const suggestions = getErrorSuggestions(lastError);
  suggestionsList.innerHTML = suggestions.map((s) => `<li>${s}</li>`).join("");

  modal.classList.add("active");

  // Add event listener for copy FFmpeg button if it exists
  setTimeout(() => {
    const copyFfmpegBtn = document.getElementById("copyFfmpegBtn");
    if (copyFfmpegBtn) {
      copyFfmpegBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(lastError.ffmpegCommand);
        copyFfmpegBtn.innerHTML = "✅ Copied!";
        setTimeout(() => {
          copyFfmpegBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy FFmpeg command
          `;
        }, 2000);
      });
    }
  }, 100);
}

// Close error modal
function closeErrorModal() {
  document.getElementById("errorModal").classList.remove("active");
}

// Get error suggestions
function getErrorSuggestions(error) {
  const suggestions = [];
  const message = error.message.toLowerCase();

  if (error.type === "ffmpeg_required" && error.ffmpegCommand) {
    suggestions.push(
      '🎬 Download and install FFmpeg from <a href="https://ffmpeg.org/download.html" target="_blank">ffmpeg.org</a>',
    );
    suggestions.push(
      "💻 Open Terminal/Command Prompt and run the FFmpeg command above",
    );
    suggestions.push(
      "📁 The resulting MP4 will be created in the current folder",
    );
    return suggestions;
  }

  if (message.includes("cors") || message.includes("cross-origin")) {
    suggestions.push(
      "Video blocked by CORS policy. Try downloading the manifest and use FFmpeg.",
    );
    suggestions.push(
      "Example: <code>ffmpeg -i manifest.m3u8 -c copy output.mp4</code>",
    );
  }

  if (message.includes("manifest") || message.includes("fetch")) {
    suggestions.push("Check your internet connection.");
    suggestions.push(
      "The video may require authentication. Try downloading directly from the site.",
    );
  }

  if (message.includes("segments")) {
    suggestions.push(
      "Video may be too large or segments are failing. Try using FFmpeg.",
    );
    suggestions.push("Open Developer Console (F12) for more details.");
  }

  if (error.video?.type === "dash" || error.video?.type === "mpd") {
    suggestions.push(
      "DASH stream: use FFmpeg: <code>ffmpeg -i video.mpd -c copy output.mp4</code>",
    );
  }

  if (error.video?.type === "hls") {
    suggestions.push(
      "HLS stream: use FFmpeg: <code>ffmpeg -i video.m3u8 -c copy output.mp4</code>",
    );
  }

  if (suggestions.length === 0) {
    suggestions.push("Try reloading the page and the extension.");
    suggestions.push("Check console logs for more details.");
    suggestions.push("Some videos cannot be downloaded due to DRM protection.");
  }

  return suggestions;
}

// Copy error to clipboard
function copyErrorToClipboard() {
  if (!lastError) return;

  let errorText = `Video Download Helper - Error Report\n`;
  errorText += `Time: ${lastError.timestamp}\n`;
  errorText += `Error: ${lastError.message}\n`;

  if (lastError.video) {
    errorText += `Video Type: ${lastError.video.type}\n`;
    errorText += `URL: ${lastError.video.url}\n`;
  }

  if (lastError.stack) {
    errorText += `\nStack Trace:\n${lastError.stack}\n`;
  }

  navigator.clipboard
    .writeText(errorText)
    .then(() => {
      const btn = document.getElementById("copyErrorBtn");
      const originalText = btn.innerHTML;
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => {
        btn.innerHTML = originalText;
      }, 2000);
    })
    .catch((err) => {
      console.error("Failed to copy:", err);
    });
}

// Show YT-DLP modal
function showYtDlpModal(command, manifestUrl) {
  const modal = document.getElementById("ytDlpModal");
  const commandText = document.getElementById("ytDlpCommandText");

  commandText.textContent = command;
  modal.style.display = "flex";

  // Setup copy buttons
  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.onclick = () => {
      const text = btn.dataset.copy || commandText.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.textContent;
        btn.textContent = "✅";
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    };
  });

  document.getElementById("copyYtDlpBtn").onclick = () => {
    navigator.clipboard.writeText(commandText.textContent).then(() => {
      const btn = document.getElementById("copyYtDlpBtn");
      btn.textContent = "✅";
      setTimeout(() => {
        btn.textContent = "📋";
      }, 2000);
    });
  };

  document.getElementById("closeYtDlpModal").onclick = () => {
    modal.style.display = "none";
  };

  document.getElementById("closeYtDlpModalBtn").onclick = () => {
    modal.style.display = "none";
  };

  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  };
}
