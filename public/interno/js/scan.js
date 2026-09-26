/* Lector continuo de códigos de barras: cámara, línea roja, sonidos, reenfoque. */
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
  let videoTrack = null;
  let focusTimer = 0;
  let tapBoundEl = null;
  let lastFocusAt = 0;
  let focusing = false;
  let preferredDeviceId = null;
  let sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  function getActiveTrack() {
    if (videoTrack && videoTrack.readyState === "live") return videoTrack;
    if (stream) {
      const t = stream.getVideoTracks()[0];
      if (t) {
        videoTrack = t;
        return t;
      }
    }
    const video = document.querySelector("#lector video");
    if (video && video.srcObject) {
      const t = video.srcObject.getVideoTracks && video.srcObject.getVideoTracks()[0];
      if (t) {
        videoTrack = t;
        stream = video.srcObject;
        return t;
      }
    }
    return null;
  }

  function capsOf(track) {
    try {
      return typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
    } catch (_) {
      return {};
    }
  }

  function settingsOf(track) {
    try {
      return typeof track.getSettings === "function" ? track.getSettings() : {};
    } catch (_) {
      return {};
    }
  }

  async function tryApply(track, advanced) {
    if (!track || !advanced || !advanced.length) return false;
    try {
      await track.applyConstraints({ advanced });
      return true;
    } catch (_) {
      try {
        // Algunos WebView solo aceptan el primer constraint suelto.
        await track.applyConstraints(advanced[0]);
        return true;
      } catch (__) {
        return false;
      }
    }
  }

  async function enableContinuousFocus() {
    const track = getActiveTrack();
    if (!track) return;
    const caps = capsOf(track);
    const settings = settingsOf(track);
    if (settings.deviceId) preferredDeviceId = settings.deviceId;
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
      await tryApply(track, [{ focusMode: "continuous" }]);
    } else if (caps.focusMode && caps.focusMode.includes("single-shot")) {
      await tryApply(track, [{ focusMode: "single-shot" }]);
    }
  }

  /** Pulso de zoom: en la práctica es lo que más reenfoca en Android Chrome. */
  async function zoomPulse(track) {
    const caps = capsOf(track);
    if (!caps.zoom) return false;
    const settings = settingsOf(track);
    const min = Number(caps.zoom.min ?? 1);
    const max = Number(caps.zoom.max ?? min);
    const step = Number(caps.zoom.step || 0.1) || 0.1;
    const cur = Number(settings.zoom ?? min);
    if (!(max > min)) return false;
    const bump = Math.min(max, cur + Math.max(step, (max - min) * 0.08));
    const back = Math.max(min, cur);
    if (Math.abs(bump - back) < 0.001) return false;
    const ok1 = await tryApply(track, [{ zoom: bump }]);
    await sleep(160);
    const ok2 = await tryApply(track, [{ zoom: back }]);
    return ok1 || ok2;
  }

  /** Barrido de distancia de foco (lentes que exponen focusDistance). */
  async function focusDistanceSweep(track) {
    const caps = capsOf(track);
    if (!caps.focusDistance) return false;
    const min = Number(caps.focusDistance.min ?? 0);
    const max = Number(caps.focusDistance.max ?? min);
    if (!(max > min)) return false;
    const mid = min + (max - min) * 0.35;
    const near = min + (max - min) * 0.12;
    await tryApply(track, [{ focusMode: "manual" }, { focusDistance: max }]);
    await sleep(120);
    await tryApply(track, [{ focusMode: "manual" }, { focusDistance: near }]);
    await sleep(140);
    await tryApply(track, [{ focusMode: "manual" }, { focusDistance: mid }]);
    await sleep(120);
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
      await tryApply(track, [{ focusMode: "continuous" }]);
    } else if (caps.focusMode && caps.focusMode.includes("single-shot")) {
      await tryApply(track, [{ focusMode: "single-shot" }]);
    }
    return true;
  }

  /** Single-shot + punto de interés (si el fabricante lo implementa). */
  async function singleShotFocus(track, point) {
    const caps = capsOf(track);
    const advanced = [];
    if (caps.focusMode && caps.focusMode.includes("single-shot")) {
      advanced.push({ focusMode: "single-shot" });
    } else if (caps.focusMode && caps.focusMode.includes("continuous")) {
      // Forzar “manual” un instante a veces reinicia el AF continuo.
      if (caps.focusMode.includes("manual")) advanced.push({ focusMode: "manual" });
      else advanced.push({ focusMode: "continuous" });
    }
    if (point && caps.pointsOfInterest) {
      advanced.push({
        pointsOfInterest: [{
          x: Math.min(1, Math.max(0, point.x)),
          y: Math.min(1, Math.max(0, point.y)),
        }],
      });
    }
    if (!advanced.length) return false;
    const ok = await tryApply(track, advanced);
    await sleep(220);
    if (caps.focusMode && caps.focusMode.includes("continuous")) {
      await tryApply(track, [{ focusMode: "continuous" }]);
    }
    return ok;
  }

  /** Reinicia el track de video: lo más fiable para volver a enfocar. */
  async function restartCameraTrack() {
    const video = document.querySelector("#lector video");
    const old = getActiveTrack();
    const settings = old ? settingsOf(old) : {};
    const deviceId = preferredDeviceId || settings.deviceId || null;
    const constraints = {
      audio: false,
      video: deviceId
        ? {
            deviceId: { exact: deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          }
        : {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
    };
    let newStream;
    try {
      newStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (_) {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
    }
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    }
    stream = newStream;
    videoTrack = newStream.getVideoTracks()[0] || null;
    const st = settingsOf(videoTrack);
    if (st.deviceId) preferredDeviceId = st.deviceId;
    if (video) {
      video.srcObject = newStream;
      try { await video.play(); } catch (_) {}
    }
    await sleep(80);
    await enableContinuousFocus();
    // Un pulso de zoom al reiniciar ayuda a “cerrar” el AF.
    await zoomPulse(videoTrack);
    return true;
  }

  /**
   * Reenfoque real (no solo el anillo).
   * @param {object|boolean} [opts] point {x,y} o true = forzar reinicio de cámara
   */
  async function refocus(opts) {
    const hard = opts === true || (opts && opts.hard);
    const point = opts && typeof opts === "object" && !hard ? opts : (opts && opts.point) || null;
    if (focusing) return false;
    const now = Date.now();
    if (!hard && now - lastFocusAt < 500) return false;
    focusing = true;
    flashFocusHint(point);
    try {
      const track = getActiveTrack();
      if (!track) return false;

      // 1) Barrido de distancia / single-shot / zoom (sin reiniciar).
      let ok = await focusDistanceSweep(track);
      if (!ok) ok = await singleShotFocus(track, point);
      ok = (await zoomPulse(track)) || ok;

      // 2) Si el usuario pidió foco a propósito (toque / botón) o nada funcionó → reiniciar cámara.
      if (hard || !ok) {
        ok = (await restartCameraTrack()) || ok;
      }

      lastFocusAt = Date.now();
      return ok;
    } catch (_) {
      try {
        await restartCameraTrack();
        lastFocusAt = Date.now();
        return true;
      } catch (__) {
        return false;
      }
    } finally {
      focusing = false;
    }
  }

  function flashFocusHint(point) {
    const stage = document.querySelector(".scan-stage");
    if (!stage) return;
    let ring = stage.querySelector(".scan-focus-ring");
    if (!ring) {
      ring = document.createElement("div");
      ring.className = "scan-focus-ring";
      stage.appendChild(ring);
    }
    const x = point && Number.isFinite(point.x) ? point.x * 100 : 50;
    const y = point && Number.isFinite(point.y) ? point.y * 100 : 50;
    ring.style.left = x + "%";
    ring.style.top = y + "%";
    ring.classList.remove("show");
    void ring.offsetWidth;
    ring.classList.add("show");
  }

  function scheduleAutoRefocus() {
    if (focusTimer) clearInterval(focusTimer);
    // Cada tanto un pulso suave (zoom), sin reiniciar la cámara.
    focusTimer = window.setInterval(() => {
      if (!running || focusing) return;
      const track = getActiveTrack();
      if (!track) return;
      zoomPulse(track).catch(() => {});
    }, 5000);
  }

  function bindTapToFocus(rootEl) {
    unbindTapToFocus();
    const stage = (rootEl && rootEl.closest && rootEl.closest(".scan-stage")) || document.querySelector(".scan-stage") || rootEl;
    if (!stage) return;
    tapBoundEl = stage;
    const onTap = (ev) => {
      if (!running) return;
      // No robar el click de botones debajo/al lado.
      if (ev.target && ev.target.closest && ev.target.closest("button, a, input, select, textarea")) return;
      const t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      const rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = (t.clientX - rect.left) / rect.width;
      const y = (t.clientY - rect.top) / rect.height;
      // Toque = reenfoque fuerte (puede reiniciar el track).
      refocus({ hard: true, point: { x, y } }).catch(() => {});
    };
    stage.addEventListener("pointerdown", onTap);
    stage._gasonorFocusTap = onTap;
  }

  function unbindTapToFocus() {
    if (tapBoundEl && tapBoundEl._gasonorFocusTap) {
      tapBoundEl.removeEventListener("pointerdown", tapBoundEl._gasonorFocusTap);
      delete tapBoundEl._gasonorFocusTap;
    }
    tapBoundEl = null;
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
    // Tras cada lectura: reenfoque fuerte para el siguiente tubo.
    setTimeout(() => { refocus({ hard: true }).catch(() => {}); }, 450);
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
          video: {
            deviceId: { exact: rear.deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
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
    // Capturar track del video que crea html5-qrcode.
    setTimeout(() => {
      getActiveTrack();
      enableContinuousFocus().catch(() => {});
      bindTapToFocus(el);
      scheduleAutoRefocus();
    }, 300);
  }

  async function start(elementId, onCode) {
    await stop();
    unlockAudio();
    beep("read");
    lastCode = "";
    lastAt = 0;
    lastFocusAt = 0;
    const el = document.getElementById(elementId);
    if (!el) return;
    running = true;
    const insecure = !window.isSecureContext;
    if ("BarcodeDetector" in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        stream = await pickRearStream();
        videoTrack = stream.getVideoTracks()[0] || null;
        const st0 = settingsOf(videoTrack);
        if (st0.deviceId) preferredDeviceId = st0.deviceId;
        const video = await mountVideo(el, stream);
        await enableContinuousFocus();
        // Primer pulso real de AF al abrir.
        await zoomPulse(videoTrack);
        bindTapToFocus(el);
        scheduleAutoRefocus();
        await loopDetect(video, onCode);
        return;
      } catch (err) {
        running = false;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        videoTrack = null;
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
    if (focusTimer) {
      clearInterval(focusTimer);
      focusTimer = 0;
    }
    unbindTapToFocus();
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    videoTrack = null;
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

  global.GasonorScan = { start, stop, beep, unlockAudio, showLast, refocus };
})(window);
