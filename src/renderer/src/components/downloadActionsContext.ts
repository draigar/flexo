import { createContext, useContext } from 'react'
import type { ActionId, DownloadItem } from '../utils/downloadActions'

export interface Actions {
  perform: (id: ActionId, targets: DownloadItem[]) => Promise<boolean>
  askClearFinished: () => void
}

export interface ActionsState {
  busy: boolean
}

export const ActionsContext = createContext<Actions | null>(null)
export const StateContext = createContext<ActionsState>({ busy: false })

export function useDownloadActions(): Actions {
  const actions = useContext(ActionsContext)
  if (!actions) throw new Error('useDownloadActions needs a DownloadActionsProvider')
  return actions
}

export function useDownloadActionsState(): ActionsState {
  return useContext(StateContext)
}
