tailwind.config = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        accent: {
          500: '#10b981',
          600: '#059669',
        }
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'radar': 'radar 2s linear infinite',
      },
      keyframes: {
        radar: {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(2.2)', opacity: '0' }
        }
      }
    }
  }
}

const GOOGLE_WEB_APP_URL = "https://script.google.com/macros/s/AKfycbw5rDKh7eQxCD2W3VnjNg_7UQw0sggoCbRVlVtegGCHMZYGzNo9aX_1spHomuEWTmtD/exec";

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================
const CONFIG = {
  GPS: {
    TIMEOUT_MS: 12000,
    WAIT_MS: 1500,
    MAX_RETRIES: 2,
  },
  CAMERA: {
    IDEAL_WIDTH: 1280,
    IDEAL_HEIGHT: 720,
    FALLBACK_WIDTH: 640,
    FALLBACK_HEIGHT: 480,
    DELAY_MS: 1500,
    QUALITY: 0.82,
  },
  AUDIO: {
    BEEP_FREQ: 600,
    BEEP_TYPE: 'sine',
    BEEP_DURATION: 0.12,
    SHUTTER_FREQ: 1200,
    SHUTTER_DURATION: 0.08,
    COUNTDOWN_FREQ: 440,
    COUNTDOWN_TYPE: 'triangle',
    COUNTDOWN_DURATION: 0.15,
    DONE_FREQ: 880,
    DONE_DURATION: 0.3,
  },
  UI: {
    TOAST_DURATION_MS: 3500,
    TOAST_FADE_DURATION_MS: 300,
    FLASH_DURATION_MS: 300,
    BANNER_HEIGHT_RATIO: 0.14,
    FONT_SIZE_RATIO: 0.035,
  },
};

const GPS_ERROR_MESSAGES = {
  1: "Izin akses lokasi/GPS ditolak.",
  2: "Sinyal GPS tidak tersedia saat ini.",
  3: "Permintaan GPS kehabisan waktu."
};

const UI_CLASSES = {
  GPS_SUCCESS: "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  GPS_ERROR: "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20",
};

// ============================================================================
// GLOBAL STATE VARIABLES
// ============================================================================
let currentGPS = null;
let frontImageBase64 = null;
let rearImageBase64 = null;
let currentMediaStream = null;
let attendanceData = null;
let gpsRetryCount = 0;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Delay execution for specified milliseconds
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Safely get DOM element with error handling
 * @param {string} id - Element ID
 * @returns {HTMLElement|null}
 */
function getElement(id) {
  const elem = document.getElementById(id);
  if (!elem) {
    console.warn(`Element with ID "${id}" not found`);
  }
  return elem;
}

/**
 * Update UI status text safely
 * @param {string} elementId - Element ID to update
 * @param {string} text - Text to display
 */
function updateStatus(elementId, text) {
  const elem = getElement(elementId);
  if (elem) {
    elem.innerText = text;
  }
}

/**
 * Web Audio API Audio Synthesizer for Feedback
 * @param {number} freq - Frequency in Hz
 * @param {string} type - Oscillator type (sine, square, triangle, sawtooth)
 * @param {number} duration - Duration in seconds
 */
function playAudioBeep(freq = 600, type = 'sine', duration = 0.12) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    console.debug('Audio feedback unavailable:', e.message);
  }
}

/**
 * Custom Toast Notification System with accessibility
 * @param {string} message - Toast message text
 * @param {string} type - Toast type (info, success, error, warning)
 */
function showToast(message, type = 'info') {
  const container = getElement('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  
  const toastConfig = {
    info: {
      bg: 'bg-slate-900 border-slate-700 text-slate-200',
      icon: 'fa-circle-info text-blue-400'
    },
    error: {
      bg: 'bg-rose-950/90 border-rose-600 text-rose-200',
      icon: 'fa-circle-xmark text-rose-400'
    },
    success: {
      bg: 'bg-emerald-950/90 border-emerald-600 text-emerald-200',
      icon: 'fa-circle-check text-emerald-400'
    },
    warning: {
      bg: 'bg-amber-950/90 border-amber-600 text-amber-200',
      icon: 'fa-triangle-exclamation text-amber-400'
    }
  };

  const config = toastConfig[type] || toastConfig.info;

  toast.className = `p-3 rounded-xl border ${config.bg} shadow-xl backdrop-blur-md text-xs flex items-center gap-2.5 transition-all duration-300 pointer-events-auto mb-2`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `<i class="fa-solid ${config.icon} text-sm" aria-hidden="true"></i> <span>${message}</span>`;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), CONFIG.UI.TOAST_FADE_DURATION_MS);
  }, CONFIG.UI.TOAST_DURATION_MS);
}

// ============================================================================
// GPS LOCATION SERVICES
// ============================================================================

/**
 * Initialize GPS location fetching with retry logic
 * @param {boolean} isManualRefresh - Whether this is a manual refresh request
 */
function initGPS(isManualRefresh = false) {
  const pill = getElement('gps-status-pill');
  const pillText = getElement('gps-status-text');

  if (!navigator.geolocation) {
    if (pillText) pillText.innerText = "GPS Tidak Didukung";
    showToast("Browser Anda tidak mendukung Geolocation GPS.", "error");
    return;
  }

  if (isManualRefresh) {
    updateStatus('gps-status-text', "Mengupdate GPS...");
    showToast("Memperbarui posisi GPS...", "info");
  }

  navigator.geolocation.getCurrentPosition(
    handleGPSSuccess,
    (error) => handleGPSError(error, pill, pillText),
    {
      enableHighAccuracy: true,
      timeout: CONFIG.GPS.TIMEOUT_MS,
      maximumAge: 0
    }
  );
}

/**
 * Handle successful GPS location retrieval
 * @param {GeolocationPosition} position - Position object
 */
function handleGPSSuccess(position) {
  currentGPS = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    timestamp: new Date().toISOString()
  };

  // Update UI Elements
  updateStatus('gps-lat', currentGPS.latitude.toFixed(6));
  updateStatus('gps-lng', currentGPS.longitude.toFixed(6));
  updateStatus('gps-accuracy', `± ${Math.round(currentGPS.accuracy)} meter`);
  
  const mapLink = getElement('gps-map-link');
  if (mapLink) {
    mapLink.href = `https://www.google.com/maps?q=${currentGPS.latitude},${currentGPS.longitude}`;
    mapLink.classList.remove('hidden');
  }

  const pill = getElement('gps-status-pill');
  if (pill) {
    pill.className = UI_CLASSES.GPS_SUCCESS;
  }
  
  updateStatus('gps-status-text', "GPS Terhubung");
  
  const alert = getElement('permission-alert');
  if (alert) alert.classList.add('hidden');

  gpsRetryCount = 0;
  showToast("Lokasi GPS berhasil dikunci!", "success");
}

/**
 * Handle GPS location errors with retry logic
 * @param {GeolocationPositionError} error - Error object
 * @param {HTMLElement} pill - Status pill element
 * @param {HTMLElement} pillText - Status text element
 */
function handleGPSError(error, pill, pillText) {
  const errorMsg = GPS_ERROR_MESSAGES[error.code] || "Gagal mengakses lokasi.";

  if (pill) pill.className = UI_CLASSES.GPS_ERROR;
  if (pillText) pillText.innerText = "GPS Ditolak/Error";
  
  const alertMsg = getElement('permission-alert-msg');
  if (alertMsg) alertMsg.innerText = errorMsg;
  
  const alert = getElement('permission-alert');
  if (alert) alert.classList.remove('hidden');

  showToast(errorMsg, "error");
}

/**
 * Request GPS permissions from user
 */
function requestPermissions() {
  initGPS(true);
}

// ============================================================================
// CAMERA OPERATIONS
// ============================================================================

/**
 * Stop all active media tracks
 */
function stopCameraStream() {
  if (currentMediaStream) {
    currentMediaStream.getTracks().forEach(track => track.stop());
    currentMediaStream = null;
  }
}

/**
 * Get media stream with fallback options
 * @param {string} facingMode - Camera facing mode (user, environment)
 * @returns {Promise<MediaStream>}
 */
async function getMediaStream(facingMode) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { 
        facingMode,
        width: { ideal: CONFIG.CAMERA.IDEAL_WIDTH },
        height: { ideal: CONFIG.CAMERA.IDEAL_HEIGHT }
      },
      audio: false
    });
  } catch (primaryError) {
    console.debug(`Camera with facingMode ${facingMode} failed, trying fallback:`, primaryError);
    
    try {
      // Fallback: Try without exact facing mode
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false
      });
    } catch (secondaryError) {
      console.debug('Secondary camera attempt failed, using generic access:', secondaryError);
      
      // Final fallback: Generic video access
      return await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
    }
  }
}

/**
 * Capture Frame from Video with Dynamic Identity Watermark (Nama & NIM)
 * @param {HTMLVideoElement} videoElem - Video element to capture from
 * @param {string} watermarkLabel - Label for watermark
 * @param {string} namaUser - User name
 * @param {string} nimUser - User NIM
 * @returns {string} Base64 encoded image
 */
function captureVideoFrame(videoElem, watermarkLabel, namaUser, nimUser) {
  const canvas = getElement('capture-canvas');
  if (!canvas) {
    throw new Error('Capture canvas not found');
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas context not available');
  }

  canvas.width = videoElem.videoWidth || CONFIG.CAMERA.FALLBACK_WIDTH;
  canvas.height = videoElem.videoHeight || CONFIG.CAMERA.FALLBACK_HEIGHT;

  // Draw active camera frame
  ctx.drawImage(videoElem, 0, 0, canvas.width, canvas.height);

  // Add Semi-transparent Bottom Watermark Overlay Banner
  const bannerHeight = Math.round(canvas.height * CONFIG.UI.BANNER_HEIGHT_RATIO);
  ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
  ctx.fillRect(0, canvas.height - bannerHeight, canvas.width, bannerHeight);

  // Watermark Text Formatting
  const fontSize = Math.max(12, Math.round(canvas.width * CONFIG.UI.FONT_SIZE_RATIO));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = "#818cf8"; // Brand indigo accent
  
  const timeStr = new Date().toLocaleString('id-ID');
  const gpsStr = currentGPS 
    ? `GPS: ${currentGPS.latitude.toFixed(5)}, ${currentGPS.longitude.toFixed(5)}` 
    : 'GPS: N/A';
  
  // Line 1: Type & Participant Identity (Nama & NIM)
  const line1 = `${watermarkLabel.toUpperCase()} • ${namaUser} (${nimUser})`;
  ctx.fillText(line1, 15, canvas.height - (bannerHeight * 0.55));
  
  // Line 2: Timestamp & GPS Coordinates
  ctx.font = `${Math.max(10, Math.round(fontSize * 0.82))}px sans-serif`;
  ctx.fillStyle = "#cbd5e1";
  ctx.fillText(`${timeStr} • ${gpsStr}`, 15, canvas.height - (bannerHeight * 0.20));

  return canvas.toDataURL('image/jpeg', CONFIG.CAMERA.QUALITY);
}

/**
 * Trigger Visual Camera Flash Effect
 */
function triggerFlashEffect() {
  const flash = getElement('flash-effect');
  if (!flash) return;

  flash.classList.remove('hidden');
  flash.classList.add('flash-overlay');
  playAudioBeep(CONFIG.AUDIO.SHUTTER_FREQ, CONFIG.AUDIO.BEEP_TYPE, CONFIG.AUDIO.SHUTTER_DURATION);
  
  setTimeout(() => {
    flash.classList.remove('flash-overlay');
    flash.classList.add('hidden');
  }, CONFIG.UI.FLASH_DURATION_MS);
}

/**
 * Initialize and start video stream for camera
 * @param {HTMLVideoElement} videoElem - Video element
 * @param {string} facingMode - Camera facing mode
 * @returns {Promise<void>}
 */
async function initializeVideoStream(videoElem, facingMode) {
  currentMediaStream = await getMediaStream(facingMode);
  videoElem.srcObject = currentMediaStream;
  await videoElem.play();
}

// ============================================================================
// ATTENDANCE PROCESS STEPS
// ============================================================================

/**
 * 2. Automated One-Click Attendance Flow
 */
async function startAutomatedAttendance() {
  const nama = getElement('input-nama')?.value.trim() || '';
  const nim = getElement('input-nim')?.value.trim() || '';
  
  if (!nama || !nim) {
    showToast("Mohon isi Nama Lengkap & NIM peserta!", "warning");
    if (!nama) getElement('input-nama')?.focus();
    else if (!nim) getElement('input-nim')?.focus();
    return;
  }

  if (!currentGPS) {
    showToast("Mendapatkan koordinat GPS lokasi Anda...", "info");
    initGPS();
    await delay(CONFIG.GPS.WAIT_MS);
    if (!currentGPS) {
      showToast("Akses GPS wajib diaktifkan untuk presensi!", "error");
      return;
    }
  }

  // Open Modal Overlay
  const modal = getElement('camera-modal');
  if (modal) modal.classList.remove('hidden');

  try {
    // TAHAP 1: Kamera Depan (Selfie Peserta)
    await processFrontCameraStep(nama, nim);

    // TAHAP 2: Aba-aba & Countdown Putar HP
    await processFlipDeviceCountdownStep();

    // TAHAP 3: Kamera Belakang (Suasana Acara)
    await processRearCameraStep(nama, nim);

    // TAHAP 4: Selesai & Tampilkan Hasil
    finishAttendanceProcess(nama, nim);

  } catch (err) {
    console.error("Attendance Automation Error:", err);
    abortCameraProcess(err.message || "Gagal mengambil foto dari kamera.");
  }
}

/**
 * Step 1: Process Front Selfie Camera
 * @param {string} nama - User name
 * @param {string} nim - User NIM
 */
async function processFrontCameraStep(nama, nim) {
  updateStatus('step-badge', "Langkah 1/2");
  updateStatus('step-title', "Foto Selfie Peserta");
  
  const guideF = getElement('overlay-guide-front');
  const guideR = getElement('overlay-guide-rear');
  if (guideF) guideF.classList.remove('hidden');
  if (guideR) guideR.classList.add('hidden');

  updateStatus('camera-status-text', "Membuka Kamera Depan...");

  const videoElem = getElement('camera-video');
  if (!videoElem) throw new Error('Camera video element not found');

  await initializeVideoStream(videoElem, 'user');

  updateStatus('camera-status-text', "Tersenyum & Posisikan Wajah... (1.5 detik)");
  await delay(CONFIG.CAMERA.DELAY_MS);

  triggerFlashEffect();
  frontImageBase64 = captureVideoFrame(videoElem, "Selfie Peserta", nama, nim);
  
  stopCameraStream();
}

/**
 * Step 2: Device Flip Countdown
 */
async function processFlipDeviceCountdownStep() {
  const flipOverlay = getElement('flip-countdown-overlay');
  if (!flipOverlay) throw new Error('Flip countdown overlay not found');

  const circleText = getElement('countdown-circle');
  if (!circleText) throw new Error('Countdown circle element not found');
  
  flipOverlay.classList.remove('hidden');

  for (let i = 3; i >= 1; i--) {
    circleText.innerText = i;
    playAudioBeep(CONFIG.AUDIO.COUNTDOWN_FREQ, CONFIG.AUDIO.COUNTDOWN_TYPE, CONFIG.AUDIO.COUNTDOWN_DURATION);
    await delay(1000);
  }

  playAudioBeep(CONFIG.AUDIO.DONE_FREQ, CONFIG.AUDIO.BEEP_TYPE, CONFIG.AUDIO.DONE_DURATION);
  flipOverlay.classList.add('hidden');
}

/**
 * Step 3: Process Rear Environment Camera
 * @param {string} nama - User name
 * @param {string} nim - User NIM
 */
async function processRearCameraStep(nama, nim) {
  updateStatus('step-badge', "Langkah 2/2");
  updateStatus('step-title', "Foto Suasana Acara");
  
  const guideF = getElement('overlay-guide-front');
  const guideR = getElement('overlay-guide-rear');
  if (guideF) guideF.classList.add('hidden');
  if (guideR) guideR.classList.remove('hidden');

  updateStatus('camera-status-text', "Membuka Kamera Belakang...");

  const videoElem = getElement('camera-video');
  if (!videoElem) throw new Error('Camera video element not found');

  await initializeVideoStream(videoElem, 'environment');

  updateStatus('camera-status-text', "Arahkan ke Ruangan Acara... (1.5 detik)");
  await delay(CONFIG.CAMERA.DELAY_MS);

  triggerFlashEffect();
  rearImageBase64 = captureVideoFrame(videoElem, "Suasana Acara", nama, nim);

  stopCameraStream();
}

/**
 * Abort Camera Operation
 * @param {string} reasonMsg - Reason for aborting
 */
function abortCameraProcess(reasonMsg) {
  stopCameraStream();
  const modal = getElement('camera-modal');
  if (modal) modal.classList.add('hidden');
  const flip = getElement('flip-countdown-overlay');
  if (flip) flip.classList.add('hidden');
  showToast(reasonMsg, "error");
}

/**
 * Step 4: Finish Attendance Process
 * @param {string} nama - User name
 * @param {string} nim - User NIM
 */
async function finishAttendanceProcess(nama, nim) {
  stopCameraStream();
  const modal = getElement('camera-modal');
  if (modal) modal.classList.add('hidden');

  const timestamp = new Date().toISOString();

  // Format data untuk Google Sheets
  attendanceData = {
    nama: nama,
    nim: nim,
    waktu: new Date(timestamp).toLocaleString('id-ID'),
    lokasi: {
      lat: currentGPS ? currentGPS.latitude : 0,
      lng: currentGPS ? currentGPS.longitude : 0
    },
    fotoSelfie: frontImageBase64,
    fotoSuasana: rearImageBase64
  };

  // Populate Summary Results
  const previewFront = getElement('preview-front');
  const previewRear = getElement('preview-rear');
  if (previewFront) previewFront.src = frontImageBase64;
  if (previewRear) previewRear.src = rearImageBase64;

  updateStatus('res-nama', nama);
  updateStatus('res-nim', nim);
  
  if (currentGPS) {
    updateStatus('res-gps', `(${currentGPS.latitude.toFixed(6)}, ${currentGPS.longitude.toFixed(6)})`);
  }
  
  updateStatus('result-timestamp', `Waktu: ${new Date(timestamp).toLocaleString('id-ID')}`);

  // Display Result Card
  const resultCard = getElement('result-card');
  if (resultCard) {
    resultCard.classList.remove('hidden');
    resultCard.scrollIntoView({ behavior: 'smooth' });
  }

  // Kirim data ke Google Sheets
  await kirimKeGoogleSheets(attendanceData);
}

// ============================================================================
// DATA MANAGEMENT
// ============================================================================

/**
 * Toggle JSON Modal Inspector
 */
function toggleJSONModal() {
  const modal = getElement('json-modal');
  if (!modal) return;

  if (modal.classList.contains('hidden')) {
    if (!attendanceData) {
      showToast("Belum ada data presensi!", "warning");
      return;
    }
    
    const cleanedData = {
      ...attendanceData,
      fotoSelfie: attendanceData.fotoSelfie ? attendanceData.fotoSelfie.substring(0, 45) + "...[TRUNCATED]" : null,
      fotoSuasana: attendanceData.fotoSuasana ? attendanceData.fotoSuasana.substring(0, 45) + "...[TRUNCATED]" : null
    };

    const preview = getElement('json-preview');
    if (preview) {
      preview.innerText = JSON.stringify(cleanedData, null, 2);
    }
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

/**
 * Copy JSON to Clipboard using modern Clipboard API with fallback
 */
async function copyJSONData() {
  if (!attendanceData) return;
  
  const fullJSONStr = JSON.stringify(attendanceData, null, 2);
  
  try {
    // Try modern Clipboard API first
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(fullJSONStr);
      showToast("Seluruh JSON Data berhasil disalin ke Clipboard!", "success");
    } else {
      // Fallback for non-secure contexts
      fallbackCopyToClipboard(fullJSONStr);
    }
  } catch (err) {
    console.error('Clipboard error:', err);
    fallbackCopyToClipboard(fullJSONStr);
  }
}

/**
 * Fallback method to copy to clipboard
 * @param {string} text - Text to copy
 */
function fallbackCopyToClipboard(text) {
  const tempTextArea = document.createElement('textarea');
  tempTextArea.value = text;
  tempTextArea.style.position = 'fixed';
  tempTextArea.style.opacity = '0';
  document.body.appendChild(tempTextArea);
  tempTextArea.select();
  
  try {
    document.execCommand('copy');
    showToast("Seluruh JSON Data berhasil disalin ke Clipboard!", "success");
  } catch (err) {
    console.error('Fallback copy failed:', err);
    showToast("Gagal menyalin data.", "error");
  } finally {
    document.body.removeChild(tempTextArea);
  }
}

/**
 * Reset Attendance Form
 */
function resetAttendance() {
  attendanceData = null;
  frontImageBase64 = null;
  rearImageBase64 = null;

  const resultCard = getElement('result-card');
  if (resultCard) resultCard.classList.add('hidden');
  
  const previewFront = getElement('preview-front');
  const previewRear = getElement('preview-rear');
  if (previewFront) previewFront.src = '';
  if (previewRear) previewRear.src = '';
  
  showToast("Formulir disiapkan untuk presensi berikutnya.", "info");
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Fungsi Pengirim Payload Data ke Google Apps Script
 * @param {Object} payload - Data to send
 */
async function kirimKeGoogleSheets(payload) {
  if (!GOOGLE_WEB_APP_URL || GOOGLE_WEB_APP_URL === "TEMPEL_URL_APPS_SCRIPT_KAMU_DI_SINI") {
    showToast("⚠️ URL Apps Script belum dipasang!", "warning");
    return;
  }

  showToast("Mengunggah data ke Google Sheets...", "info");

  try {
    const response = await fetch(GOOGLE_WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    showToast("✅ Absensi Berhasil Disimpan ke Spreadsheet!", "success");
  } catch (err) {
    console.error("Upload error:", err);
    showToast("❌ Gagal mengunggah ke Spreadsheet. Data disimpan lokal.", "warning");
  }
}

// ============================================================================
// APPLICATION INITIALIZATION
// ============================================================================

/**
 * Initialize application on DOM load
 */
function initializeApp() {
  console.log('Initializing Presensi App...');
  initGPS();
}

// Prevent duplicate event listeners
document.removeEventListener('DOMContentLoaded', initializeApp);
window.removeEventListener('DOMContentLoaded', initializeApp);

// Single initialization
window.addEventListener('DOMContentLoaded', initializeApp);
