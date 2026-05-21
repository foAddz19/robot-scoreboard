(function () {
  let audioContext = null;
  let lastWarningSecond = null;
  const finalWarningSeconds = 9;

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

  function unlockWarningAudio() {
    getAudioContext();
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
      return;
    }

    if (remainingSeconds !== lastWarningSecond) {
      lastWarningSecond = remainingSeconds;
      playWarningBeep();
    }
  }

  document.addEventListener("pointerdown", unlockWarningAudio, { once: true });
  document.addEventListener("keydown", unlockWarningAudio, { once: true });

  window.applyFinalWarning = applyFinalWarning;
  window.unlockWarningAudio = unlockWarningAudio;
})();
