import { describe, it, expect, vi } from 'vitest'

const { captured } = vi.hoisted(() => ({ captured: { config: undefined as unknown } }))
vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>()
  return {
    ...actual,
    default: (config: unknown) => {
      captured.config = config
      return actual.default(config as Parameters<typeof actual.default>[0])
    },
  }
})

describe('auth module exports', () => {
  it('exports handlers, auth, signIn, signOut', async () => {
    const mod = await import('@/auth')
    expect(mod.handlers).toBeDefined()
    expect(mod.auth).toBeDefined()
    expect(mod.signIn).toBeDefined()
    expect(mod.signOut).toBeDefined()
  })

  it('keeps the edge config signIn callback, so the domain lock is live', async () => {
    await import('@/auth')
    const authConfig = (await import('@/auth.config')).default
    const config = captured.config as { callbacks: Record<string, unknown> }
    expect(typeof config.callbacks.signIn).toBe('function')
    expect(config.callbacks.signIn).toBe(authConfig.callbacks!.signIn)
  })
})
