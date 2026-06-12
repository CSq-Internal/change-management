import '@testing-library/jest-dom'

// jsdom in this setup doesn't expose localStorage; provide a minimal in-memory
// shim so client modules that read it at import time (e.g. the Zustand UI store)
// work under the test environment.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>()
  const shim: Storage = {
    get length() { return store.size },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => { store.delete(k) },
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
  }
  globalThis.localStorage = shim
}
