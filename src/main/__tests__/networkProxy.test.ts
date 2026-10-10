import { describe, expect, it, vi } from 'vitest'

const setProxy = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('electron', () => ({
  session: { defaultSession: { setProxy } }
}))

import { configureSystemProxy } from '../networkFetch'

describe('desktop proxy configuration', () => {
  it('makes the default Electron session use the operating system proxy', async () => {
    await configureSystemProxy()

    expect(setProxy).toHaveBeenCalledWith({ mode: 'system' })
  })
})
