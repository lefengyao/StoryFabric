/** 智能体回答完成提示音：WebAudio 合成，不打包音频资源。 */

export interface AudioContextLike {
  currentTime: number
  destination: unknown
  createOscillator(): {
    type: string
    frequency: { setValueAtTime(value: number, time: number): void }
    connect(target: unknown): void
    start(time: number): void
    stop(time: number): void
  }
  createGain(): {
    gain: {
      setValueAtTime(value: number, time: number): void
      exponentialRampToValueAtTime(value: number, time: number): void
    }
    connect(target: unknown): void
  }
  close?(): Promise<void>
}

const PEAK = 0.15
const FLOOR = 0.0001
const NOTES = [
  { frequency: 880, offset: 0, duration: 0.18 },
  { frequency: 1174.66, offset: 0.14, duration: 0.32 }
]

export function shouldPlayCompletionSound(input: { enabled: boolean; error: boolean }): boolean {
  return input.enabled && !input.error
}

function defaultContext(): AudioContextLike | null {
  try {
    const Ctor = (globalThis as { AudioContext?: new () => AudioContextLike }).AudioContext
    return Ctor ? new Ctor() : null
  } catch {
    return null
  }
}

export function createCompletionSound(
  createContext: () => AudioContextLike | null = defaultContext
): { play: () => void; dispose: () => void } {
  let ctx: AudioContextLike | null = null

  const ensure = (): AudioContextLike | null => {
    if (!ctx) ctx = createContext()
    return ctx
  }

  return {
    play: (): void => {
      try {
        const audio = ensure()
        if (!audio) return
        const start = audio.currentTime
        for (const note of NOTES) {
          const at = start + note.offset
          const gain = audio.createGain()
          gain.gain.setValueAtTime(FLOOR, at)
          gain.gain.exponentialRampToValueAtTime(PEAK, at + 0.02)
          gain.gain.exponentialRampToValueAtTime(FLOOR, at + note.duration)
          gain.connect(audio.destination)
          const oscillator = audio.createOscillator()
          oscillator.type = 'sine'
          oscillator.frequency.setValueAtTime(note.frequency, at)
          oscillator.connect(gain)
          oscillator.start(at)
          oscillator.stop(at + note.duration + 0.02)
        }
      } catch {
        /* 自动播放策略或音频不可用时静默 */
      }
    },
    dispose: (): void => {
      const audio = ctx
      ctx = null
      void audio?.close?.().catch(() => {})
    }
  }
}

const shared = createCompletionSound()

export function playCompletionSound(): void {
  shared.play()
}
