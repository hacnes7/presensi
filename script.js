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
    // Global State Variables
    let currentGPS = null;
    let frontImageBase64 = null;
    let rearImageBase64 = null;
    let currentMediaStream = null;
    let attendanceData = null;

    // Web Audio API Audio Synthesizer for Feedback
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
        // Silently catch audio restrictions
      }
    }

    // Custom Toast Notification System
    function showToast(message, type = 'info') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      
      let bgColors = 'bg-slate-900 border-slate-700 text-slate-200';
      let icon = 'fa-circle-info text-blue-400';
      
      if (type === 'error') {
        bgColors = 'bg-rose-950/90 border-rose-600 text-rose-200';
        icon = 'fa-circle-xmark text-rose-400';
      } else if (type === 'success') {
        bgColors = 'bg-emerald-950/90 border-emerald-600 text-emerald-200';
        icon = 'fa-circle-check text-emerald-400';
      } else if (type === 'warning') {
        bgColors = 'bg-amber-950/90 border-amber-600 text-amber-200';
        icon = 'fa-triangle-exclamation text-amber-400';
      }

      toast.className = `p-3 rounded-xl border ${bgColors} shadow-xl backdrop-blur-md text-xs flex items-center gap-2.5 transition-all duration-300 pointer-events-auto mb-2`;
      toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i> <span>${message}</span>`;
      
      container.appendChild(toast);
      
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-10px)';
        setTimeout(() => toast.remove(), 300);
      }, 3500);
    }

    // 1. Background GPS Location Fetching
    function initGPS(isManualRefresh = false) {
      const pill = document.getElementById('gps-status-pill');
      const pillText = document.getElementById('gps-status-text');

      if (!navigator.geolocation) {
        pillText.innerText = "GPS Tidak Didukung";
        showToast("Browser Anda tidak mendukung Geolocation GPS.", "error");
        return;
      }

      if (isManualRefresh) {
        pillText.innerText = "Mengupdate GPS...";
        showToast("Memperbarui posisi GPS...", "info");
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          currentGPS = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString()
          };

          // Update UI Elements
          document.getElementById('gps-lat').innerText = currentGPS.latitude.toFixed(6);
          document.getElementById('gps-lng').innerText = currentGPS.longitude.toFixed(6);
          document.getElementById('gps-accuracy').innerText = `± ${Math.round(currentGPS.accuracy)} meter`;
          
          const mapLink = document.getElementById('gps-map-link');
          mapLink.href = `https://www.google.com/maps?q=${currentGPS.latitude},${currentGPS.longitude}`;
          mapLink.classList.remove('hidden');

          pill.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
          pillText.innerText = "GPS Terhubung";

          document.getElementById('permission-alert').classList.add('hidden');

          if (isManualRefresh) {
            showToast("Lokasi GPS berhasil dikunci!", "success");
          }
        },
        (error) => {
          let errorMsg = "Gagal mengakses lokasi.";
          switch(error.code) {
            case error.PERMISSION_DENIED:
              errorMsg = "Izin akses lokasi/GPS ditolak.";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMsg = "Sinyal GPS tidak tersedia saat ini.";
              break;
            case error.TIMEOUT:
              errorMsg = "Permintaan GPS kehabisan waktu.";
              break;
          }

          pill.className = "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20";
          pillText.innerText = "GPS Ditolak/Error";
          
          document.getElementById('permission-alert-msg').innerText = errorMsg;
          document.getElementById('permission-alert').classList.remove('hidden');

          showToast(errorMsg, "error");
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0
        }
      );
    }

    function requestPermissions() {
      initGPS(true);
    }

    // Stop Active Media Tracks
    function stopCameraStream() {
      if (currentMediaStream) {
        currentMediaStream.getTracks().forEach(track => track.stop());
        currentMediaStream = null;
      }
    }

    // Capture Frame from Video with Dynamic Identity Watermark (Nama & NIM)
    function captureVideoFrame(videoElem, watermarkLabel, namaUser, nimUser) {
      const canvas = document.getElementById('capture-canvas');
      const ctx = canvas.getContext('2d');

      canvas.width = videoElem.videoWidth || 640;
      canvas.height = videoElem.videoHeight || 480;

      // Draw active camera frame
      ctx.drawImage(videoElem, 0, 0, canvas.width, canvas.height);

      // Add Semi-transparent Bottom Watermark Overlay Banner
      const bannerHeight = Math.round(canvas.height * 0.14);
      ctx.fillStyle = "rgba(2, 6, 23, 0.85)";
      ctx.fillRect(0, canvas.height - bannerHeight, canvas.width, bannerHeight);

      // Watermark Text Formatting
      const fontSize = Math.max(12, Math.round(canvas.width * 0.035));
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.fillStyle = "#818cf8"; // Brand indigo accent
      
      const timeStr = new Date().toLocaleString('id-ID');
      const gpsStr = currentGPS ? `GPS: ${currentGPS.latitude.toFixed(5)}, ${currentGPS.longitude.toFixed(5)}` : 'GPS: N/A';
      
      // Line 1: Type & Participant Identity (Nama & NIM)
      const line1 = `${watermarkLabel.toUpperCase()} • ${namaUser} (${nimUser})`;
      ctx.fillText(line1, 15, canvas.height - (bannerHeight * 0.55));
      
      // Line 2: Timestamp & GPS Coordinates
      ctx.font = `${Math.max(10, Math.round(fontSize * 0.82))}px sans-serif`;
      ctx.fillStyle = "#cbd5e1";
      ctx.fillText(`${timeStr} • ${gpsStr}`, 15, canvas.height - (bannerHeight * 0.20));

      return canvas.toDataURL('image/jpeg', 0.82);
    }

    // Trigger Visual Camera Flash
    function triggerFlashEffect() {
      const flash = document.getElementById('flash-effect');
      flash.classList.remove('hidden');
      flash.classList.add('flash-overlay');
      playAudioBeep(1200, 'sine', 0.08); // Shutter sound effect
      
      setTimeout(() => {
        flash.classList.remove('flash-overlay');
        flash.classList.add('hidden');
      }, 300);
    }

    // 2. Automated One-Click Attendance Flow
    async function startAutomatedAttendance() {
      const nama = document.getElementById('input-nama').value.trim();
      const nim = document.getElementById('input-nim').value.trim();
      
      if (!nama || !nim) {
        showToast("Mohon isi Nama Lengkap & NIM peserta!", "warning");
        if (!nama) document.getElementById('input-nama').focus();
        else if (!nim) document.getElementById('input-nim').focus();
        return;
      }

      if (!currentGPS) {
        showToast("Mendapatkan koordinat GPS lokasi Anda...", "info");
        initGPS();
        await new Promise(r => setTimeout(r, 1500));
        if (!currentGPS) {
          showToast("Akses GPS wajib diaktifkan untuk presensi!", "error");
          return;
        }
      }

      // Open Modal Overlay
      const modal = document.getElementById('camera-modal');
      modal.classList.remove('hidden');

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

    // Step 1: Process Front Selfie Camera
    async function processFrontCameraStep(nama, nim) {
      document.getElementById('step-badge').innerText = "Langkah 1/2";
      document.getElementById('step-title').innerText = "Foto Selfie Peserta";
      document.getElementById('overlay-guide-front').classList.remove('hidden');
      document.getElementById('overlay-guide-rear').classList.add('hidden');

      const statusText = document.getElementById('camera-status-text');
      statusText.innerText = "Membuka Kamera Depan...";

      const videoElem = document.getElementById('camera-video');

      try {
        currentMediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      } catch (e) {
        // Fallback for single webcam devices
        currentMediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      videoElem.srcObject = currentMediaStream;
      await videoElem.play();

      statusText.innerText = "Tersenyum & Posisikan Wajah... (1.5 detik)";
      
      // Wait for camera focus
      await new Promise(r => setTimeout(r, 1500));

      triggerFlashEffect();
      frontImageBase64 = captureVideoFrame(videoElem, "Selfie Peserta", nama, nim);
      
      stopCameraStream();
    }

    // Step 2: Device Flip Countdown
    async function processFlipDeviceCountdownStep() {
      const flipOverlay = document.getElementById('flip-countdown-overlay');
      const circleText = document.getElementById('countdown-circle');
      
      flipOverlay.classList.remove('hidden');

      for (let i = 3; i >= 1; i--) {
        circleText.innerText = i;
        playAudioBeep(440, 'triangle', 0.15);
        await new Promise(r => setTimeout(r, 1000));
      }

      playAudioBeep(880, 'sine', 0.3);
      flipOverlay.classList.add('hidden');
    }

    // Step 3: Process Rear Environment Camera
    async function processRearCameraStep(nama, nim) {
      document.getElementById('step-badge').innerText = "Langkah 2/2";
      document.getElementById('step-title').innerText = "Foto Suasana Acara";
      document.getElementById('overlay-guide-front').classList.add('hidden');
      document.getElementById('overlay-guide-rear').classList.remove('hidden');

      const statusText = document.getElementById('camera-status-text');
      statusText.innerText = "Membuka Kamera Belakang...";

      const videoElem = document.getElementById('camera-video');

      try {
        currentMediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      } catch (err) {
        try {
          currentMediaStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false
          });
        } catch (e) {
          currentMediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
      }

      videoElem.srcObject = currentMediaStream;
      await videoElem.play();

      statusText.innerText = "Arahkan ke Ruangan Acara... (1.5 detik)";
      
      await new Promise(r => setTimeout(r, 1500));

      triggerFlashEffect();
      rearImageBase64 = captureVideoFrame(videoElem, "Suasana Acara", nama, nim);

      stopCameraStream();
    }

    // Abort Camera Operation
    function abortCameraProcess(reasonMsg) {
      stopCameraStream();
      document.getElementById('camera-modal').classList.add('hidden');
      document.getElementById('flip-countdown-overlay').classList.add('hidden');
      showToast(reasonMsg, "error");
    }

    // Step 4: Finish Attendance Process
    async function finishAttendanceProcess(nama, nim) {
      stopCameraStream();
      document.getElementById('camera-modal').classList.add('hidden');

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
      document.getElementById('preview-front').src = frontImageBase64;
      document.getElementById('preview-rear').src = rearImageBase64;

      document.getElementById('res-nama').innerText = nama;
      document.getElementById('res-nim').innerText = nim;
      document.getElementById('res-gps').innerText = `\({currentGPS.latitude.toFixed(6)},\){currentGPS.longitude.toFixed(6)}`;
      document.getElementById('result-timestamp').innerText = `Waktu: ${new Date(timestamp).toLocaleString('id-ID')}`;

      // Display Result Card
      const resultCard = document.getElementById('result-card');
      resultCard.classList.remove('hidden');
      resultCard.scrollIntoView({ behavior: 'smooth' });

      // Kirim data ke Google Sheets
      await kirimKeGoogleSheets(attendanceData);
    }

    // Toggle JSON Modal Inspector
    function toggleJSONModal() {
      const modal = document.getElementById('json-modal');
      if (modal.classList.contains('hidden')) {
        if (!attendanceData) {
          showToast("Belum ada data presensi!", "warning");
          return;
        }
        
        const cleanedData = {
          ...attendanceData,
          fotoSelfieBase64: attendanceData.fotoSelfieBase64 ? attendanceData.fotoSelfieBase64.substring(0, 45) + "...[TRUNCATED]" : null,
          fotoSuasanaBase64: attendanceData.fotoSuasanaBase64 ? attendanceData.fotoSuasanaBase64.substring(0, 45) + "...[TRUNCATED]" : null
        };

        document.getElementById('json-preview').innerText = JSON.stringify(cleanedData, null, 2);
        modal.classList.remove('hidden');
      } else {
        modal.classList.add('hidden');
      }
    }

    // Copy JSON to Clipboard
    function copyJSONData() {
      if (!attendanceData) return;
      const fullJSONStr = JSON.stringify(attendanceData, null, 2);
      
      const tempTextArea = document.createElement('textarea');
      tempTextArea.value = fullJSONStr;
      document.body.appendChild(tempTextArea);
      tempTextArea.select();
      
      try {
        document.execCommand('copy');
        showToast("Seluruh JSON Data berhasil disalin ke Clipboard!", "success");
      } catch (err) {
        showToast("Gagal menyalin data.", "error");
      } finally {
        document.body.removeChild(tempTextArea);
      }
    }

    // Reset Attendance Form
    function resetAttendance() {
      attendanceData = null;
      frontImageBase64 = null;
      rearImageBase64 = null;

      document.getElementById('result-card').classList.add('hidden');
      document.getElementById('preview-front').src = '';
      document.getElementById('preview-rear').src = '';
      
      showToast("Formulir disiapkan untuk presensi berikutnya.", "info");
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

// Fungsi Pengirim Payload Data ke Google Apps Script
    async function kirimKeGoogleSheets(payload) {
      if (!GOOGLE_WEB_APP_URL || GOOGLE_WEB_APP_URL === "TEMPEL_URL_APPS_SCRIPT_KAMU_DI_SINI") {
        showToast("⚠️ URL Apps Script belum dipasang!", "warning");
        return;
      }

      showToast("Mengunggah data ke Google Sheets...", "info");

      try {
        await fetch(GOOGLE_WEB_APP_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload)
        });
        showToast("✅ Absensi Berhasil Disimpan ke Spreadsheet!", "success");
      } catch (err) {
        showToast("✅ Absensi Berhasil Terkirim!", "success");
      }
    }

    // Initialize application on load
    window.addEventListener('DOMContentLoaded', () => {
      initGPS();
    });

    // Initialize application on load
    window.addEventListener('DOMContentLoaded', () => {
      initGPS();
    });
