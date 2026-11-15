let sharedAudioCtx = null

/**
 * Plays a short, unobtrusive two-tone alert chime using the Web Audio API.
 * Silently no-ops if Web Audio is unavailable or blocked before user gesture.
 */
export function playAlertBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx()
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {})
    }

    const now = sharedAudioCtx.currentTime
    const playTone = (freq, startOffset, duration) => {
      const osc = sharedAudioCtx.createOscillator()
      const gain = sharedAudioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + startOffset)
      gain.gain.setValueAtTime(0.001, now + startOffset)
      gain.gain.exponentialRampToValueAtTime(0.09, now + startOffset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration)
      osc.connect(gain)
      gain.connect(sharedAudioCtx.destination)
      osc.start(now + startOffset)
      osc.stop(now + startOffset + duration + 0.01)
    }

    playTone(880, 0, 0.14)
    playTone(1046.5, 0.16, 0.18)
  } catch {
    // Ignore Web Audio errors in restricted browser environments
  }
}
