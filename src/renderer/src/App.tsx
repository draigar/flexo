import type { DownloadState, FinishedDownload } from '@shared/types'
import { useEffect } from 'react'
import { DownloadActionsProvider } from './components/DownloadActionsProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { NetworkBindingDialog } from './components/NetworkBindingDialog'
import { NewDownloadDialog } from './components/NewDownloadDialog'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import { UpdateDialog } from './components/UpdateDialog'
import { TooltipProvider } from './components/ui/tooltip'
import { useDownloadEvents } from './hooks/useDownloadEvents'
import { useNetworkEvents } from './hooks/useNetworks'
import { useNewDownloadShortcuts, useOpenedLinks } from './hooks/useOpenedLinks'
import { CompleteScreen } from './screens/CompleteScreen'
import { DownloadingScreen } from './screens/DownloadingScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { ErrorScreen } from './screens/ErrorScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { OngoingDownloadsScreen } from './screens/OngoingDownloadsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { useAppStore } from './store/useAppStore'
import { ACTIVE_CONCEPT } from './theme'

function assertNever(status: never): never {
  throw new Error(`Unhandled download status: ${String(status)}`)
}

function renderDownload(download: DownloadState | FinishedDownload): React.JSX.Element {
  if ('unitsWritten' in download) return <CompleteScreen download={download} />
  switch (download.status) {
    case 'queued':
    case 'downloading':
    case 'paused':
    case 'assembling':
      return <DownloadingScreen download={download} />
    case 'completed':
      return <CompleteScreen download={download} />
    case 'error':
    case 'cancelled':
      return <ErrorScreen download={download} />
    default:
      return assertNever(download.status as never)
  }
}

function CurrentScreen(): React.JSX.Element {
  const page = useAppStore((store) => store.page)
  const shown = useAppStore((store) => {
    const { view } = store
    if (view.name !== 'download') return null
    return store.downloads[view.id] ?? store.history.find((entry) => entry.id === view.id) ?? null
  })

  if (page === 'settings') {
    return <SettingsScreen />
  }
  if (page === 'library') {
    return <LibraryScreen />
  }
  if (page === 'ongoing') {
    return <OngoingDownloadsScreen />
  }

  const cancelled = shown && !('unitsWritten' in shown) && shown.status === 'cancelled'
  return shown && !cancelled ? renderDownload(shown) : <DownloadsScreen />
}

function App(): React.JSX.Element {
  useDownloadEvents()
  useOpenedLinks()
  useNewDownloadShortcuts()
  useNetworkEvents()

  const themeSource = useAppStore((store) => store.themeSource)
  const checkForUpdate = useAppStore((store) => store.checkForUpdate)

  useEffect(() => {
    document.documentElement.dataset.concept = ACTIVE_CONCEPT
    document.documentElement.dataset.theme = themeSource
  }, [themeSource])

  useEffect(() => {
    void checkForUpdate()
  }, [checkForUpdate])

  return (
    <TooltipProvider>
      <DownloadActionsProvider>
        <div className="flex h-full flex-col bg-background text-foreground">
          <TitleBar />
          <div className="min-h-0 flex-1">
            <ErrorBoundary>
              <CurrentScreen />
            </ErrorBoundary>
          </div>
          <StatusBar />
          <NewDownloadDialog />
          <NetworkBindingDialog />
          <UpdateDialog />
        </div>
      </DownloadActionsProvider>
    </TooltipProvider>
  )
}

export default App
