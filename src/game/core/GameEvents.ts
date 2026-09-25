import { EventBus } from './EventBus'
import type { GameEvents } from './events'

/** Single process-wide bus. The engine is a singleton per page, so this is safe. */
export const gameEvents = new EventBus<GameEvents>()
