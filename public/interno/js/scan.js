/* Lector continuo de códigos de barras: cámara, línea roja, sonidos. */
(function (global) {
  let running = false;
  let stream = null;
  let html5 = null;
  let raf = 0;
  let lastCode = "";
  let lastAt = 0;
  let audioCtx = null;
  let detector = null;
  let canvas = null;
  let canvasCtx = null;

  function unlockAudio() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (_) {}
    return audioCtx;
  }

  ["pointerdown", "touchstart", "click"].forEach((ev) => {
    document.addEventListener(ev, unlockAudio, { capture: true });
  });

  function wavBeep(freq, ms, vol) {
    const sr = 16000;
    const n = Math.max(80, Math.floor((sr * ms) / 1000));
    const samples = new Int16Array(n);
    const amp = Math.floor(32767 * (vol || 0.7));
    for (let i = 0; i < n; i++) {
      const fade = i < 40 ? i / 40 : i > n - 80 ? (n - i) / 80 : 1;
      samples[i] = Math.round(amp * fade * Math.sin((2 * Math.PI * freq * i) / sr));
    }
    const bytes = new Uint8Array(44 + samples.byteLength);
    const v = new DataView(bytes.buffer);
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i);
    };
    str(0, "RIFF");
    v.setUint32(4, 36 + samples.byteLength, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, "data");
    v.setUint32(40, samples.byteLength, true);
    bytes.set(new Uint8Array(samples.buffer), 44);
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    const a = new Audio(url);
    a.volume = 1;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function beep(kind) {
    try {
      unlockAudio();
      if (navigator.vibrate) {
        navigator.vibrate(kind === "ok" ? 70 : kind === "dup" ? [50, 60, 50] : 140);
      }
      if (kind === "ok") {
        wavBeep(980, 90, 0.85);
        setTimeout(() => wavBeep(1480, 180, 0.85), 80);
      } else if (kind === "dup") {
        wavBeep(240, 220, 0.9);
        setTimeout(() => wavBeep(180, 280, 0.9), 200);
      } else if (kind === "read") {
        wavBeep(1200, 70, 0.75);
      } else {
        wavBeep(150, 200, 0.95);
        setTimeout(() => wavBeep(110, 320, 0.95), 170);
      }
    } catch (_) {}
  }

  function showLast(text, kind) {
    const el = document.getElementById("scan-last");
    if (el) {
      el.hidden = false;
      el.className = "scan-last " + (kind || "");
      el.textContent = text;
    }
    const win = document.querySelector(".scan-window");
    if (win) {
      win.classList.remove("hit-ok", "hit-bad");
      win.classList.add(kind === "ok" ? "hit-ok" : "hit-bad");
      setTimeout(() => win.classList.remove("hit-ok", "hit-bad"), 280);
    }
  }

  function normalize(raw) {
    if (raw && typeof raw === "object") {
      raw = raw.decodedText || raw.text || raw.rawValue || raw.code || "";
    }
    return String(raw || "").replace(/[\s\u0000]/g, "").trim();
  }

  function emit(code, onCode) {
    code = normalize(code);
    if (!code) return;
    const now = Date.now();
    if (code === lastCode && now - lastAt < 1200) return;
    lastCode = code;
    lastAt = now;
    beep("read");
    showLast("Leído: " + code, "read");
    onCode(code);
  }

  function videoConstraints() {
    return {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };
  }

  async function pickRearStream() {
    const streamTry = await navigator.mediaDevices.getUserMedia(videoConstraints());
    const track = streamTry.getVideoTracks()[0];
    const label = (track && track.label) || "";
    if (/back|rear|trasera|environment|wide/i.test(label) || !/front|user|face/i.test(label)) {
      return streamTry;
    }
    try {
      const cams = await navigator.mediaDevices.enumerateDevices();
      const videos = cams.filter((d) => d.kind === "videoinput");
      const rear = videos.find((d) => /back|rear|trasera|environment/i.test(d.label)) || videos[videos.length - 1];
      if (rear && rear.deviceId) {
        streamTry.getTracks().forEach((t) => t.stop());
        return navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: rear.deviceId } },
        });
      }
    } catch (_) {}
    return streamTry;
  }

  function mountVideo(el, mediaStream) {
    el.innerHTML = "";
    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.muted = true;
    video.autoplay = true;
    video.srcObject = mediaStream;
    el.appendChild(video);
    return video.play().then(() => video);
  }

  function valueOf(code) {
    if (!code) return "";
    if (typeof code === "string") return normalize(code);
    return normalize(code.rawValue || code.displayValue || "");
  }

  async function loopDetect(video, onCode) {
    const formats = [
      "code_128", "code_39", "code_93", "codabar", "ean_13", "ean_8",
      "upc_a", "upc_e", "itf", "qr_code", "data_matrix", "pdf417",
    ];
    try {
      detector = new BarcodeDetector({ formats });
    } catch (_) {
      detector = new BarcodeDetector();
    }
    canvas = document.createElement("canvas");
    canvasCtx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = async () => {
      if (!running) return;
      try {
        if (video.readyState >= 2 && video.videoWidth) {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const bw = Math.max(40, Math.floor(vw * 0.94));
          const bh = Math.max(40, Math.floor(vh * 0.34));
          const sx = Math.floor((vw - bw) / 2);
          const sy = Math.floor((vh - bh) / 2);
          canvas.width = bw;
          canvas.height = bh;
          canvasCtx.drawImage(video, sx, sy, bw, bh, 0, 0, bw, bh);
          let codes = [];
          try {
            codes = await detector.detect(canvas);
          } catch (_) {
            codes = await detector.detect(video);
          }
          if (codes && codes.length) emit(valueOf(codes[0]), onCode);
        }
      } catch (_) {}
      raf = window.setTimeout(tick, 70);
    };
    tick();
  }

  async function startHtml5(el, onCode) {
    if (!window.Html5Qrcode) throw new Error("No se cargó el lector de cámara");
    const F = window.Html5QrcodeSupportedFormats || {};
    const formats = [
      F.CODE_128, F.CODE_39, F.CODABAR, F.EAN_13, F.EAN_8,
      F.UPC_A, F.UPC_E, F.ITF, F.QR_CODE,
    ].filter((x) => x !== undefined);
    html5 = new Html5Qrcode(el.id, {
      verbose: false,
      formatsToSupport: formats.length ? formats : undefined,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    const box = (w, h) => ({
      width: Math.floor(w * 0.92),
      height: Math.floor(h * 0.3),
    });
    const cams = await Html5Qrcode.getCameras();
    const back = (cams || []).find((c) => /back|rear|trasera|environment/i.test(c.label));
    const camId = (back && back.id) || (cams[0] && cams[0].id);
    await html5.start(
      camId ? { deviceId: { exact: camId } } : { facingMode: "environment" },
      { fps: 18, qrbox: box, disableFlip: false },
      (decodedText, decodedResult) => emit(decodedText || decodedResult, onCode),
      () => {}
    );
  }

  async function start(elementId, onCode) {
    await stop();
    unlockAudio();
    beep("read");
    lastCode = "";
    lastAt = 0;
    const el = document.getElementById(elementId);
    if (!el) return;
    running = true;
    const insecure = !window.isSecureContext;
    if ("BarcodeDetector" in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        stream = await pickRearStream();
        const video = await mountVideo(el, stream);
        await loopDetect(video, onCode);
        return;
      } catch (err) {
        running = false;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        if (insecure) {
          throw new Error("El celular bloquea la cámara en HTTP. Usá https://192.168.x.x:5051 y aceptá el aviso.");
        }
        if (err && /NotAllowed|Permission|NotFound/i.test(String(err.name || err.message))) {
          throw new Error("Hay que permitir la cámara en el navegador.");
        }
      }
    }
    if (insecure) {
      throw new Error("El celular bloquea la cámara en HTTP. Usá https://192.168.x.x:5051 y aceptá el aviso.");
    }
    running = true;
    await startHtml5(el, onCode);
  }

  async function stop() {
    running = false;
    if (raf) {
      clearTimeout(raf);
      raf = 0;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    detector = null;
    canvas = null;
    canvasCtx = null;
    if (html5) {
      try {
        await html5.stop();
        html5.clear();
      } catch (_) {}
      html5 = null;
    }
  }

  global.GasonorScan = { start, stop, beep, unlockAudio, showLast };
})(window);
