const KEY = 'crashout.clientId'

let cached: string | null = null

/**
 * A per-browser-tab network identity.
 *
 * It deliberately does *not* come from the player profile. Two tabs on the same
 * machine share localStorage, so they share a save — which is what you want for
 * the garage, and exactly wrong for multiplayer: both tabs would announce the
 * same player id, each would filter the other's packets out as its own echo,
 * and same-device play would silently do nothing.
 *
 * sessionStorage is scoped to the tab, so each tab gets its own id that still
 * survives a reload.
 */
export function getClientId(): string {
  if (cached) return cached
  try {
    const existing = sessionStorage.getItem(KEY)
    if (existing) {
      cached = existing
      return existing
    }
    const fresh = crypto.randomUUID()
    sessionStorage.setItem(KEY, fresh)
    cached = fresh
    return fresh
  } catch {
    // Private mode or blocked storage: an in-memory id still works for this tab.
    cached ??= crypto.randomUUID()
    return cached
  }
}
