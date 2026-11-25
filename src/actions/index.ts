import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { joinGame, leaveGame } from './games'
import { ensureChatAccess, postGameMessage } from './chat'
import { cancelGame, updateGame } from './manage'

export const actions: Record<string, ActionHandler<Env>> = {
  joinGame,
  leaveGame,
  ensureChatAccess,
  postGameMessage,
  updateGame,
  cancelGame,
}
