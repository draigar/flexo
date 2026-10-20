import type { DownloadState, FinishedDownload } from '@shared/types'
import { linkExpired } from './format'

export type ActionId =
  | 'pause'
  | 'resume'
  | 'retry'
  | 'fix'
  | 'again'
  | 'open'
  | 'reveal'
  | 'copy'
  | 'cancel'
  | 'remove'
  | 'trash'

export type DownloadItem = DownloadState | FinishedDownload

export const isFinished = (item: DownloadItem): item is FinishedDownload => 'unitsWritten' in item
export const isDone = (item: DownloadItem): boolean =>
  isFinished(item) || item.status === 'completed'
export const isFailed = (item: DownloadItem): item is DownloadState =>
  !isFinished(item) && item.status === 'error'
export const isCancellable = (item: DownloadItem): item is DownloadState =>
  !isFinished(item) && ['downloading', 'queued', 'paused'].includes(item.status)
export const isMissing = (item: DownloadItem): boolean =>
  isFinished(item) && 'missing' in item && !!item.missing
export const isTrashable = (item: DownloadItem): boolean => isDone(item) && !isMissing(item)

export type FailureAction = 'fix' | 'retry' | 'again'

export function failureAction(download: DownloadState): FailureAction {
  if (linkExpired(download)) return 'fix'
  return download.bytesDownloaded > 0 ? 'retry' : 'again'
}

const appliesTo: Record<ActionId, (item: DownloadItem) => boolean> = {
  pause: (item) => !isFinished(item) && (item.status === 'downloading' || item.status === 'queued'),
  resume: (item) => !isFinished(item) && item.status === 'paused',
  retry: (item) => isFailed(item) && failureAction(item) === 'retry',
  fix: (item) => isFailed(item) && failureAction(item) === 'fix',
  again: (item) => isFailed(item) && failureAction(item) === 'again',
  open: (item) => isDone(item) && !isMissing(item),
  reveal: (item) => (isDone(item) && !isMissing(item)) || isCancellable(item),
  copy: (item) => /^(https?:|magnet:)/i.test(item.url),
  cancel: isCancellable,
  remove: (item) => isDone(item) || isFailed(item),
  trash: isTrashable
}

const SINGLE_ONLY: ReadonlySet<ActionId> = new Set(['fix', 'again', 'open', 'reveal'])

export const ACTION_GROUPS: readonly (readonly ActionId[])[] = [
  ['pause', 'resume', 'retry', 'fix', 'again', 'open', 'reveal'],
  ['copy'],
  ['cancel', 'remove', 'trash']
]

export interface AvailableAction {
  id: ActionId
  targets: DownloadItem[]
}

export function availableActions(items: DownloadItem[]): AvailableAction[][] {
  return ACTION_GROUPS.map((group) =>
    group.flatMap((id): AvailableAction[] => {
      if (SINGLE_ONLY.has(id) && items.length !== 1) return []
      const targets = items.filter(appliesTo[id])
      return targets.length > 0 ? [{ id, targets }] : []
    })
  ).filter((group) => group.length > 0)
}

export const TOOLBAR_PRIORITY: readonly ActionId[] = [
  'pause',
  'resume',
  'retry',
  'fix',
  'again',
  'open',
  'cancel',
  'reveal',
  'remove',
  'trash',
  'copy'
]

export const TOOLBAR_SLOTS = 2

export function splitToolbar(groups: AvailableAction[][]): {
  buttons: AvailableAction[]
  more: AvailableAction[][]
} {
  const buttons = groups
    .flat()
    .sort((a, b) => TOOLBAR_PRIORITY.indexOf(a.id) - TOOLBAR_PRIORITY.indexOf(b.id))
    .slice(0, TOOLBAR_SLOTS)
  const shown = new Set(buttons.map(({ id }) => id))
  return {
    buttons,
    more: groups
      .map((group) => group.filter(({ id }) => !shown.has(id)))
      .filter((group) => group.length > 0)
  }
}

export const ROW_ACTIONS: readonly ActionId[] = ['pause', 'resume', 'retry', 'fix', 'again']

export function rowAction(item: DownloadItem): ActionId | null {
  return ROW_ACTIONS.find((id) => appliesTo[id](item)) ?? null
}

export const MANAGE_ACTIONS: readonly ActionId[] = ['cancel', 'remove', 'trash']

export function manageActions(item: DownloadItem): ActionId[] {
  return MANAGE_ACTIONS.filter((id) => appliesTo[id](item))
}

export function manageAction(item: DownloadItem): ActionId | null {
  return (['cancel', 'remove'] as const).find((id) => appliesTo[id](item)) ?? null
}

export const HEADER_ACTIONS: readonly ActionId[] = [...ROW_ACTIONS, 'open', 'reveal']

export function headerActions(item: DownloadItem): ActionId[] {
  return HEADER_ACTIONS.filter((id) => appliesTo[id](item))
}
