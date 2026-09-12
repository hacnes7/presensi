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
  COUNTDOWN: {
    START: 3,
    INTERVAL: 1000,
  }
};

const GPS_ERROR_MESSAGES = {
  1: "Izin akses lokasi/GPS ditolak.",
  2: "Sinyal GPS tidak tersedia saat ini.",
  3: "Permintaan GPS kehabisan waktu."
};

const UI_CLASSES = {
  GPS_SUCCESS: "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  GPS_ERROR: "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20",
  TOAST_BASE: "p-3 rounded-xl border shadow-xl backdrop-blur-md text-xs flex items-center gap-2.5 transition-all duration-300 pointer-events-auto mb-2",
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
 * Safely get multiple DOM elements by IDs
 * @param {...string} ids - Element IDs
 * @returns {Object} Object with id as key and element as value
 */
function getElements(...ids) {
  return ids.reduce((acc, id) => {
    acc[id] = getElement(id);
    return acc;
  }, {});
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
 * Schedule toast removal with fade animation
 * @param {HTMLElement} toast - Toast element
 * @param {number} duration - Display duration in ms
 */
function scheduleToastRemoval(toast, duration = CONFIG.UI.TOAST_DURATION_MS) {
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-10px)';
    setTimeout(() => toast.remove(), CONFIG.UI.TOAST_FADE_DURATION_MS);
  }, duration);
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

  toast.className = `${UI_CLASSES.TOAST_BASE} ${config.bg}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `<i class="fa-solid ${config.icon} text-sm" aria-hidden="true"></i> <span>${message}</span>`;
  
  container.appendChild(toast);
  scheduleToastRemoval(toast);
}

// ============================================================================
// GPS LOCATION SERVICES
// ============================================================================

/**
 * Initialize GPS location fetching with retry logic
 * @param {boolean} isManualRefresh - Whether this is a manual refresh request
 */
function initGPS(isManualRefresh = false) {
  const { 'gps-status-pill': pill, 'gps-status-text': pillText } = getElements('gps-status-pill', 'gps-status-text');

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
 * Get media stream with fallback options using constraint chain
 * @param {string} facingMode - Camera facing mode (user, environment)
 * @returns {Promise<MediaStream>}
 */
async function getMediaStream(facingMode) {
  const constraints = [
    {
      video: {
        facingMode,
        width: { ideal: CONFIG.CAMERA.IDEAL_WIDTH },
        height: { ideal: CONFIG.CAMERA.IDEAL_HEIGHT }
      },
      audio: false
    },
    {
      video: { facingMode },
      audio: false
    },
    {
      video: true,
      audio: false
    }
  ];

  for (const constraint of constraints) {
    try {
      console.debug(`Attempting getUserMedia with constraint:`, constraint);
      return await navigator.mediaDevices.getUserMedia(constraint);
    } catch (error) {
      console.debug(`Constraint failed, trying next:`, error.message);
      continue;
    }
  }

  throw new Error('No camera access available - all constraints failed');
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
 * Validate form inputs for attendance
 * @returns {boolean} true if valid
 */
function validateAttendanceInputs() {
  const nama = getElement('input-nama')?.value?.trim() ?? '';
  const nim = getElement('input-nim')?.value?.trim() ?? '';
  
  if (!nama || !nim) {
    showToast("Mohon isi Nama Lengkap & NIM peserta!", "warning");
    if (!nama) getElement('input-nama')?.focus();
    else if (!nim) getElement('input-nim')?.focus();
    return false;
  }
  
  return true;
}

/**
 * Get current form input values
 * @returns {Object} Object with nama and nim
 */
function getAttendanceInputs() {
  return {
    nama: getElement('input-nama')?.value?.trim() ?? '',
    nim: getElement('input-nim')?.value?.trim() ?? ''
  };
}

/**
 * Automated One-Click Attendance Flow
 */
async function startAutomatedAttendance() {
  if (!validateAttendanceInputs()) return;

  const { nama, nim } = getAttendanceInputs();

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
    await processCameraStep(1, 'user', "Foto Selfie Peserta", "Selfie Peserta", nama, nim);

    // TAHAP 2: Aba-aba & Countdown Putar HP
    await processFlipDeviceCountdownStep();

    // TAHAP 3: Kamera Belakang (Suasana Acara)
    await processCameraStep(2, 'environment', "Foto Suasana Acara", "Suasana Acara", nama, nim);

    // TAHAP 4: Selesai & Tampilkan Hasil
    finishAttendanceProcess(nama, nim);

  } catch (err) {
    console.error("Attendance Automation Error:", err);
    abortCameraProcess(err.message || "Gagal mengambil foto dari kamera.");
  }
}

/**
 * Process camera capture step (unified for front and rear)
 * @param {number} stepNumber - Step number (1 or 2)
 * @param {string} facingMode - Camera facing mode ('user' or 'environment')
 * @param {string} stepTitle - Title to display
 * @param {string} watermarkLabel - Label for watermark
 * @param {string} nama - User name
 * @param {string} nim - User NIM
 */
async function processCameraStep(stepNumber, facingMode, stepTitle, watermarkLabel, nama, nim) {
  updateStatus('step-badge', `Langkah ${stepNumber}/2`);
  updateStatus('step-title', stepTitle);
  
  const { 'overlay-guide-front': guideF, 'overlay-guide-rear': guideR } = getElements('overlay-guide-front', 'overlay-guide-rear');
  
  // Show appropriate guide
  const isFront = facingMode === 'user';
  if (guideF) guideF.classList.toggle('hidden', !isFront);
  if (guideR) guideR.classList.toggle('hidden', isFront);

  const cameraLabel = isFront ? "Depan" : "Belakang";
  updateStatus('camera-status-text', `Membuka Kamera ${cameraLabel}...`);

  const videoElem = getElement('camera-video');
  if (!videoElem) throw new Error('Camera video element not found');

  await initializeVideoStream(videoElem, facingMode);

  const instructionText = isFront 
    ? "Tersenyum & Posisikan Wajah... (1.5 detik)" 
    : "Arahkan ke Ruangan Acara... (1.5 detik)";
  
  updateStatus('camera-status-text', instructionText);
  await delay(CONFIG.CAMERA.DELAY_MS);

  triggerFlashEffect();
  
  const imageBase64 = captureVideoFrame(videoElem, watermarkLabel, nama, nim);
  
  if (isFront) {
    frontImageBase64 = imageBase64;
  } else {
    rearImageBase64 = imageBase64;
  }

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

  for (let i = CONFIG.COUNTDOWN.START; i >= 1; i--) {
    circleText.innerText = i;
    playAudioBeep(CONFIG.AUDIO.COUNTDOWN_FREQ, CONFIG.AUDIO.COUNTDOWN_TYPE, CONFIG.AUDIO.COUNTDOWN_DURATION);
    await delay(CONFIG.COUNTDOWN.INTERVAL);
  }

  playAudioBeep(CONFIG.AUDIO.DONE_FREQ, CONFIG.AUDIO.BEEP_TYPE, CONFIG.AUDIO.DONE_DURATION);
  flipOverlay.classList.add('hidden');
}

/**
 * Abort Camera Operation
 * @param {string} reasonMsg - Reason for aborting
 */
function abortCameraProcess(reasonMsg) {
  stopCameraStream();
  const { 'camera-modal': modal, 'flip-countdown-overlay': flip } = getElements('camera-modal', 'flip-countdown-overlay');
  if (modal) modal.classList.add('hidden');
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
      lat: currentGPS?.latitude ?? 0,
      lng: currentGPS?.longitude ?? 0
    },
    fotoSelfie: frontImageBase64,
    fotoSuasana: rearImageBase64
  };

  // Populate Summary Results
  const { 'preview-front': previewFront, 'preview-rear': previewRear, 'result-card': resultCard } = getElements('preview-front', 'preview-rear', 'result-card');
  
  if (previewFront) previewFront.src = frontImageBase64;
  if (previewRear) previewRear.src = rearImageBase64;

  updateStatus('res-nama', nama);
  updateStatus('res-nim', nim);
  
  if (currentGPS) {
    updateStatus('res-gps', `(${currentGPS.latitude.toFixed(6)}, ${currentGPS.longitude.toFixed(6)})`);
  }
  
  updateStatus('result-timestamp', `Waktu: ${new Date(timestamp).toLocaleString('id-ID')}`);

  // Display Result Card
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

  const { 'result-card': resultCard, 'preview-front': previewFront, 'preview-rear': previewRear } = getElements('result-card', 'preview-front', 'preview-rear');
  
  if (resultCard) resultCard.classList.add('hidden');
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

// Single initialization on DOM load
window.addEventListener('DOMContentLoaded', initializeApp);
