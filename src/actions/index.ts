import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { joinGame, leaveGame } from './games'

export const actions: Record<string, ActionHandler<Env>> = {
  joinGame,
  leaveGame,
}
