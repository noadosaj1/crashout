export type Listener<T> = (payload: T) => void

/**
 * Minimal typed pub/sub. Used to keep gameplay systems decoupled from each other
 * and from React — systems emit, the HUD bridge samples.
 */
export class EventBus<Events> {
  private listeners = new Map<keyof Events, Set<Listener<never>>>()

  on<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener as Listener<never>)
    return () => {
      set!.delete(listener as Listener<never>)
    }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const listener of set) (listener as Listener<Events[K]>)(payload)
  }

  clear(): void {
    this.listeners.clear()
  }
}
