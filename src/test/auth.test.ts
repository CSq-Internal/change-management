import { describe, it, expect } from 'vitest'

describe('auth module exports', () => {
  it('exports handlers, auth, signIn, signOut', async () => {
    const mod = await import('@/auth')
    expect(mod.handlers).toBeDefined()
    expect(mod.auth).toBeDefined()
    expect(mod.signIn).toBeDefined()
    expect(mod.signOut).toBeDefined()
  })
})
