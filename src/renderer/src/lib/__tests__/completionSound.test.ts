import { describe, expect, it } from 'vitest'
import { createCompletionSound, shouldPlayCompletionSound, type AudioContextLike } from '../completionSound'

interface ToneRecord {
  type: string
  freq: number
  started: number
  stopped: number
}

function fakeContext(): { ctx: AudioContextLike; tones: ToneRecord[]; gains: number[][]; isClosed: () => boolean } {
  const tones: ToneRecord[] = []
  const gains: number[][] = []
  let closed = false
  const ctx: AudioContextLike = {
    currentTime: 0,
    destination: {},
    createOscillator: () => {
      const tone: ToneRecord = { type: '', freq: 0, started: 0, stopped: 0 }
      tones.push(tone)
      return {
        get type() {
          return tone.type
        },
        set type(value: string) {
          tone.type = value
        },
        frequency: { setValueAtTime: (value: number) => { tone.freq = value } },
        connect: () => {},
        start: (time: number) => { tone.started = time },
        stop: (time: number) => { tone.stopped = time }
      }
    },
    createGain: () => {
      const envelope: number[] = []
      gains.push(envelope)
      return {
        gain: {
          setValueAtTime: (value: number) => { envelope.push(value) },
          exponentialRampToValueAtTime: (value: number) => { envelope.push(value) }
        },
        connect: () => {}
      }
    },
    close: async () => {
      closed = true
    }
  }
  return { ctx, tones, gains, isClosed: () => closed }
}

describe('shouldPlayCompletionSound', () => {
  it('只在开关打开且本次没有出错时播放', () => {
    expect(shouldPlayCompletionSound({ enabled: true, error: false })).toBe(true)
    expect(shouldPlayCompletionSound({ enabled: true, error: true })).toBe(false)
    expect(shouldPlayCompletionSound({ enabled: false, error: false })).toBe(false)
    expect(shouldPlayCompletionSound({ enabled: false, error: true })).toBe(false)
  })
})

describe('createCompletionSound', () => {
  it('播放两个正弦音并带渐入渐出包络', () => {
    const { ctx, tones, gains } = fakeContext()
    const sound = createCompletionSound(() => ctx)

    sound.play()

    expect(tones).toHaveLength(2)
    expect(tones[0].freq).toBeCloseTo(880, 1)
    expect(tones[1].freq).toBeCloseTo(1174.66, 1)
    expect(tones.every((tone) => tone.type === 'sine')).toBe(true)
    expect(tones.every((tone) => tone.stopped > tone.started)).toBe(true)
    expect(tones[1].started).toBeGreaterThan(tones[0].started)

    expect(gains).toHaveLength(2)
    for (const envelope of gains) {
      expect(envelope).toHaveLength(3)
      expect(envelope[0]).toBeLessThan(envelope[1])
      expect(envelope[2]).toBeLessThan(envelope[1])
    }
  })

  it('上下文不可用时静默', () => {
    const sound = createCompletionSound(() => null)
    expect(() => sound.play()).not.toThrow()
  })

  it('dispose 关闭上下文', async () => {
    const { ctx, isClosed } = fakeContext()
    const sound = createCompletionSound(() => ctx)

    sound.play()
    sound.dispose()
    await Promise.resolve()

    expect(isClosed()).toBe(true)
  })
})
