import type { DownloadState } from '@shared/types'
import { useEffect } from 'react'
import { DevToolsPanel } from './components/DevToolsPanel'
import { TitleBar, type TitleBarStatus } from './components/TitleBar'
import { NetworkBindingDialog } from './components/NetworkBindingDialog'
import { UpdateDialog } from './components/UpdateDialog'
import { Alert, AlertDescription } from './components/ui/alert'
import { TooltipProvider } from './components/ui/tooltip'
import { useDownloadEvents } from './hooks/useDownloadEvents'
import { CompleteScreen } from './screens/CompleteScreen'
import { DownloadingScreen } from './screens/DownloadingScreen'
import { ErrorScreen } from './screens/ErrorScreen'
import { IdleScreen } from './screens/IdleScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { NoConnectionsScreen } from './screens/NoConnectionsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { useAppStore } from './store/useAppStore'
import { ACTIVE_CONCEPT } from './theme'

function assertNever(status: never): never {
  throw new Error(`Unhandled download status: ${String(status)}`)
}

/** One screen + title-bar status per download.status — a switch with an assertNever default so
 * a new DownloadStatus value is a compile error here instead of silently falling into whichever
 * branch happened to be last. */
function renderDownload(
  download: DownloadState,
  handlers: { onNewDownload: () => void; onDownloadAgain: () => void }
): { screen: React.JSX.Element; titleBarStatus: TitleBarStatus } {
  switch (download.status) {
    case 'downloading':
      return {
        screen: <DownloadingScreen download={download} />,
        titleBarStatus: {
          kind: 'combined',
          networkCount: new Set(download.chunks.map((chunk) => chunk.interfaceId)).size
        }
      }
    case 'paused':
      return {
        screen: <DownloadingScreen download={download} />,
        titleBarStatus: {
          kind: 'paused',
          networkCount: new Set(download.chunks.map((chunk) => chunk.interfaceId)).size
        }
      }
    case 'assembling':
      return {
        screen: <DownloadingScreen download={download} />,
        titleBarStatus: { kind: 'assembling' }
      }
    case 'completed':
      return {
        screen: <CompleteScreen download={download} onNewDownload={handlers.onNewDownload} />,
        titleBarStatus: { kind: 'none' }
      }
    case 'error':
    case 'cancelled':
      return {
        screen: (
          <ErrorScreen
            download={download}
            onNewDownload={handlers.onNewDownload}
            onDownloadAgain={handlers.onDownloadAgain}
          />
        ),
        titleBarStatus: { kind: 'none' }
      }
    default:
      return assertNever(download.status)
  }
}

function App(): React.JSX.Element {
  useDownloadEvents()

  const interfaces = useAppStore((store) => store.interfaces)
  const interfacesStatus = useAppStore((store) => store.interfacesStatus)
  const currentDownload = useAppStore((store) => store.currentDownload)
  const clearCurrentDownload = useAppStore((store) => store.clearCurrentDownload)
  const checkForUpdate = useAppStore((store) => store.checkForUpdate)
  const themeSource = useAppStore((store) => store.themeSource)
  const captureError = useAppStore((store) => store.captureError)
  const page = useAppStore((store) => store.page)

  useEffect(() => {
    document.documentElement.dataset.concept = ACTIVE_CONCEPT
    document.documentElement.dataset.theme = themeSource
  }, [themeSource])

  useEffect(() => {
    checkForUpdate()
  }, [checkForUpdate])

  const handleNewDownload = (): void => {
    if (currentDownload) void window.flexo.removeDownload(currentDownload.id)
    clearCurrentDownload()
  }

  const handleDownloadAgain = (): void => {
    if (currentDownload) {
      const url = currentDownload.url
      void window.flexo.removeDownload(currentDownload.id)
      clearCurrentDownload()
      useAppStore.getState().setDraftUrl(url)
    }
  }

  const noConnections = interfacesStatus === 'ready' && interfaces.length === 0

  const downloadView = currentDownload
    ? renderDownload(currentDownload, {
        onNewDownload: handleNewDownload,
        onDownloadAgain: handleDownloadAgain
      })
    : null

  let screen: React.JSX.Element
  let titleBarStatus: TitleBarStatus = downloadView?.titleBarStatus ?? { kind: 'none' }

  if (page === 'settings') {
    screen = <SettingsScreen />
  } else if (page === 'library') {
    screen = <LibraryScreen />
  } else if (downloadView) {
    screen = downloadView.screen
  } else if (noConnections) {
    screen = <NoConnectionsScreen />
    titleBarStatus = { kind: 'offline' }
  } else {
    screen = <IdleScreen />
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TitleBar status={titleBarStatus} />
        {captureError && !currentDownload && (
          <div className="px-5 pt-3">
            <Alert variant="destructive" className="py-1.5">
              <AlertDescription>{captureError}</AlertDescription>
            </Alert>
          </div>
        )}
        <div className="min-h-0 flex-1">{screen}</div>
        <DevToolsPanel />
        <UpdateDialog />
        <NetworkBindingDialog />
      </div>
    </TooltipProvider>
  )
}

export default App
