(function () {
  let audioContext = null;
  let warningAudio = null;
  let warningAudioSourceIndex = 0;
  let warningAudioUnavailable = false;
  let warningAudioPlaying = false;
  let lastWarningSecond = null;
  let warningStarted = false;
  const finalWarningSeconds = 10;
  const warningAudioStartSeconds = 0;
  const warningAudioSources = [
    "/assets/videoplayback.mp3",
    "/assets/videoplayback.m4a",
    "/assets/videoplayback.wav",
    "/assets/videoplayback.ogg",
    "/assets/videoplayback.webm",
    "/assets/videoplayback.mp4",
    "/assets/videoplayback",
    "/videoplayback.mp3",
    "/videoplayback.m4a",
    "/videoplayback.wav",
    "/videoplayback.ogg",
    "/videoplayback.webm",
    "/videoplayback.mp4",
    "/videoplayback",
  ];

  function getAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }

    return audioContext;
  }

  function getWarningAudio() {
    if (!warningAudio) {
      warningAudio = new Audio();
      warningAudio.preload = "auto";
      warningAudio.addEventListener("ended", () => {
        warningAudioPlaying = false;
      });
      warningAudio.addEventListener("pause", () => {
        warningAudioPlaying = false;
      });
    }

    return warningAudio;
  }

  function playWarningBeep() {
    const context = getAudioContext();
    if (!context || context.state !== "running") return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(920, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.2);
  }

  function loadWarningAudioSource(audio, sourceIndex) {
    warningAudioSourceIndex = sourceIndex;
    audio.src = warningAudioSources[sourceIndex];
    audio.load();
  }

  function seekWarningAudio(audio) {
    try {
      const safeStart =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? Math.min(warningAudioStartSeconds, Math.max(audio.duration - 0.1, 0))
          : warningAudioStartSeconds;

      audio.currentTime = safeStart;
    } catch (error) {
      audio.currentTime = 0;
    }
  }

  function playWarningAudioFromSource(sourceIndex) {
    return new Promise((resolve, reject) => {
      if (sourceIndex >= warningAudioSources.length) {
        warningAudioUnavailable = true;
        reject(new Error("No warning audio source could be loaded."));
        return;
      }

      const audio = getWarningAudio();
      const sourceUrl = new URL(warningAudioSources[sourceIndex], window.location.href).href;

      if (audio.src !== sourceUrl) {
        loadWarningAudioSource(audio, sourceIndex);
      }

      const cleanup = () => {
        audio.removeEventListener("loadedmetadata", onReady);
        audio.removeEventListener("canplay", onReady);
        audio.removeEventListener("error", onError);
      };

      const onReady = () => {
        cleanup();
        seekWarningAudio(audio);
        audio.muted = false;
        audio
          .play()
          .then(() => {
            warningAudioPlaying = true;
            resolve();
          })
          .catch(reject);
      };

      const onError = () => {
        cleanup();
        playWarningAudioFromSource(sourceIndex + 1).then(resolve).catch(reject);
      };

      audio.addEventListener("loadedmetadata", onReady, { once: true });
      audio.addEventListener("canplay", onReady, { once: true });
      audio.addEventListener("error", onError, { once: true });

      if (audio.readyState >= 1) {
        onReady();
      }
    });
  }

  function playWarningAudio() {
    if (warningAudioUnavailable || warningAudioPlaying) return false;

    playWarningAudioFromSource(warningAudioSourceIndex).catch(() => {
      warningAudioPlaying = false;
      playWarningBeep();
    });

    return true;
  }

  function unlockWarningAudio() {
    getAudioContext();
    getWarningAudio();
  }

  function applyFinalWarning(data) {
    const timeElement = document.getElementById("time");
    if (!timeElement) return;

    const remainingSeconds = Number(data.remainingSeconds);
    const shouldWarn =
      data.status === "RUNNING" &&
      Number.isFinite(remainingSeconds) &&
      remainingSeconds > 0 &&
      remainingSeconds <= finalWarningSeconds;

    timeElement.classList.toggle("final-warning", shouldWarn);

    if (!shouldWarn) {
      lastWarningSecond = null;
      warningStarted = false;
      return;
    }

    if (!warningStarted) {
      warningStarted = true;
      playWarningAudio();
      return;
    }

    if (remainingSeconds !== lastWarningSecond) {
      lastWarningSecond = remainingSeconds;
      if (warningAudioUnavailable) {
        playWarningBeep();
      }
    }
  }

  document.addEventListener("pointerdown", unlockWarningAudio, { once: true });
  document.addEventListener("keydown", unlockWarningAudio, { once: true });

  window.applyFinalWarning = applyFinalWarning;
  window.unlockWarningAudio = unlockWarningAudio;
})();
