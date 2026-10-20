import type { DownloadState } from '@shared/types'
import { useCallback, useMemo, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { describeError } from '../utils/format'
import type { ActionId, DownloadItem } from '../utils/downloadActions'
import { ActionErrorDialog } from './ActionErrorDialog'
import { ACTION_META } from './downloadActionMeta'
import { ActionsContext, StateContext } from './downloadActionsContext'
import { FixLinkDialog } from './FixLinkDialog'
import { RemoveDialog, type RemoveMode } from './RemoveDialog'

export function DownloadActionsProvider({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const setView = useAppStore((store) => store.setView)
  const openNewDownload = useAppStore((store) => store.openNewDownload)
  const [confirmation, setConfirmation] = useState<{
    mode: RemoveMode
    items: DownloadItem[]
    clearAll: boolean
  } | null>(null)
  const [fixing, setFixing] = useState<DownloadState | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)

  const perform = useCallback(
    async (id: ActionId, targets: DownloadItem[]): Promise<boolean> => {
      const fail = (cause: unknown): false => {
        setFailure({ title: ACTION_META[id].failure, message: describeError(cause) })
        return false
      }
      switch (id) {
        case 'pause':
        case 'resume':
        case 'retry': {
          const results = await Promise.allSettled(
            targets.map((item) =>
              id === 'pause'
                ? window.flexo.pauseDownload(item.id)
                : window.flexo.resumeDownload(item.id)
            )
          )
          const failed = results.find((result) => result.status === 'rejected')
          return failed ? fail((failed as PromiseRejectedResult).reason) : true
        }
        case 'fix':
          setFixing(targets[0] as DownloadState)
          return true
        case 'again': {
          const [item] = targets
          try {
            await window.flexo.removeDownload(item.id)
          } catch (cause) {
            return fail(cause)
          }
          useAppStore.getState().forgetDownload(item.id)
          setView({ name: 'list' })
          openNewDownload(item.url)
          return true
        }
        case 'open':
        case 'reveal': {
          try {
            const [item] = targets
            const filePath =
              'filePath' in item && typeof item.filePath === 'string'
                ? item.filePath
                : 'destinationPath' in item && typeof item.destinationPath === 'string'
                  ? item.destinationPath
                  : ''
            if (filePath) {
              if (id === 'open') {
                await window.flexo.openPath(filePath)
              } else {
                await window.flexo.revealInFolder(filePath)
              }
            }
            return true
          } catch (cause) {
            return fail(cause)
          }
        }
        case 'copy': {
          const text = targets.map((item) => item.url).join('\n')
          try {
            await navigator.clipboard.writeText(text)
            return true
          } catch (cause) {
            return fail(cause)
          }
        }
        case 'cancel':
        case 'remove':
        case 'trash':
          setConfirmation({ mode: id, items: targets, clearAll: false })
          return true
        default:
          return false
      }
    },
    [openNewDownload, setView]
  )

  const askClearFinished = useCallback(() => {
    const history = useAppStore.getState().history
    if (history.length === 0) return
    setConfirmation({ mode: 'remove', items: history, clearAll: true })
  }, [])

  const handleConfirmRemoval = async (): Promise<void> => {
    if (!confirmation) return
    setBusy(true)
    setDialogError(null)
    const { mode, items, clearAll } = confirmation
    try {
      const ids = items.map((item) => item.id)
      for (const id of ids) {
        await window.flexo.removeDownload(id).catch(() => {})
        useAppStore.getState().forgetDownload(id)
      }
      if (clearAll) {
        useAppStore.getState().clearHistory()
      }
      setConfirmation(null)
    } catch (cause) {
      setDialogError(describeError(cause))
    } finally {
      setBusy(false)
    }
  }

  const actions = useMemo(() => ({ perform, askClearFinished }), [perform, askClearFinished])
  const state = useMemo(() => ({ busy }), [busy])

  return (
    <ActionsContext.Provider value={actions}>
      <StateContext.Provider value={state}>
        {children}
        <ActionErrorDialog failure={failure} onClose={() => setFailure(null)} />
        <FixLinkDialog download={fixing} onClose={() => setFixing(null)} />
        <RemoveDialog
          open={confirmation !== null}
          onOpenChange={(open) => !open && !busy && setConfirmation(null)}
          mode={confirmation?.mode ?? 'remove'}
          items={confirmation?.items ?? []}
          clearAll={confirmation?.clearAll ?? false}
          busy={busy}
          error={dialogError}
          onConfirm={handleConfirmRemoval}
        />
      </StateContext.Provider>
    </ActionsContext.Provider>
  )
}
