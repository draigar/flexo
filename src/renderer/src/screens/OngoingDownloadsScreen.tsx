import type { DownloadState } from '@shared/types'
import { AlertCircle, ArrowDownToLine, ChevronRight, Pause, Play, Plus, Trash2 } from 'lucide-react'
import { PageFrame } from '../components/PageFrame'
import { Button } from '../components/ui/button'
import { useAppStore } from '../store/useAppStore'
import {
  fileExtensionBadge,
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed
} from '../utils/format'

export function OngoingDownloadsScreen(): React.JSX.Element {
  const activeDownloads = useAppStore((store) => store.activeDownloads)
  const setPage = useAppStore((store) => store.setPage)
  const setFocusedDownloadId = useAppStore((store) => store.setFocusedDownloadId)

  const downloadsList = Object.values(activeDownloads).filter(
    (d) => d.status !== 'completed' && d.status !== 'cancelled'
  )

  const handleSelectDownload = (id: string): void => {
    setFocusedDownloadId(id)
    setPage('home')
  }

  const handlePauseResume = (e: React.MouseEvent, download: DownloadState): void => {
    e.stopPropagation()
    if (download.status === 'downloading') {
      void window.flexo.pauseDownload(download.id)
    } else {
      void window.flexo.resumeDownload(download.id)
    }
  }

  const handleRemove = (e: React.MouseEvent, id: string): void => {
    e.stopPropagation()
    void window.flexo.removeDownload(id)
    useAppStore.getState().removeActiveDownload(id)
  }

  const handleNewDownload = (): void => {
    setFocusedDownloadId(null)
    useAppStore.getState().setDraftUrl('')
    setPage('home')
  }

  return (
    <PageFrame title="Ongoing Downloads">
      {downloadsList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
            <ArrowDownToLine size={20} />
          </div>
          <h2 className="mt-4 font-sans text-[15px] font-semibold text-foreground">
            No active downloads
          </h2>
          <p className="mt-1 max-w-[320px] font-sans text-[12.5px] leading-relaxed text-muted-foreground">
            Downloads currently running, paused, or requiring attention will appear here.
          </p>
          <Button
            type="button"
            onClick={handleNewDownload}
            className="mt-5 gap-1.5 font-mono text-[11px] tracking-wide uppercase"
          >
            <Plus size={13} />
            Start New Download
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between pb-1">
            <span className="font-mono text-[11px] text-muted-foreground">
              {downloadsList.length} {downloadsList.length === 1 ? 'task' : 'tasks'}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleNewDownload}
              className="gap-1 font-mono text-[10px] tracking-wide uppercase"
            >
              <Plus size={12} />
              New Download
            </Button>
          </div>

          <div className="flex flex-col gap-2.5">
            {downloadsList.map((download) => {
              const knownSize = download.totalBytes > 0
              const percent = knownSize
                ? Math.min(100, Math.round((download.bytesDownloaded / download.totalBytes) * 100))
                : 0
              const isDownloading = download.status === 'downloading'
              const isPaused = download.status === 'paused'
              const isError = download.status === 'error'
              const isAssembling = download.status === 'assembling'

              return (
                <div
                  key={download.id}
                  onClick={() => handleSelectDownload(download.id)}
                  className="group relative flex cursor-pointer flex-col gap-2.5 rounded-[11px] border border-border bg-card p-3.5 transition-all hover:border-[var(--border-strong)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.15)]"
                >
                  <div className="flex items-center gap-3">
                    {/* Extension Badge */}
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-[7px] border border-[var(--border-strong)] bg-muted font-mono text-[9px] font-semibold text-[var(--text-secondary)]">
                      {fileExtensionBadge(download.fileName)}
                    </div>

                    {/* File Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-sans text-[13px] font-semibold text-foreground group-hover:text-primary transition-colors">
                          {download.fileName}
                        </div>
                        {isError && (
                          <span className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-destructive bg-destructive/10 border border-destructive/20">
                            <AlertCircle size={10} />
                            Failed
                          </span>
                        )}
                        {isPaused && (
                          <span className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-[var(--color-usb)] bg-[var(--color-usb-bg)] border border-[var(--color-usb-border)]">
                            <Pause size={10} />
                            Paused
                          </span>
                        )}
                        {isAssembling && (
                          <span className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] font-medium text-[var(--color-ethernet)] bg-[var(--color-ethernet-bg)] border border-[var(--color-ethernet-border)]">
                            Assembling…
                          </span>
                        )}
                      </div>

                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        <span>
                          {formatBytes(download.bytesDownloaded)}
                          {knownSize ? ` / ${formatBytes(download.totalBytes)}` : ''}
                        </span>
                        {knownSize && <span>({percent}%)</span>}
                        {isDownloading && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-foreground font-medium">
                              {formatSpeed(download.speedBytesPerSec)}
                            </span>
                            {knownSize && download.speedBytesPerSec > 0 && (
                              <>
                                <span className="opacity-40">·</span>
                                <span>
                                  ETA{' '}
                                  {formatEta(
                                    Math.max(0, download.totalBytes - download.bytesDownloaded),
                                    download.speedBytesPerSec
                                  )}
                                </span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Quick Action Controls */}
                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!isAssembling && (
                        <Button
                          type="button"
                          variant={isPaused || isError ? 'default' : 'secondary'}
                          size="xs"
                          onClick={(e) => handlePauseResume(e, download)}
                          className="h-7 px-2.5 font-mono text-[10px] tracking-wide uppercase gap-1"
                        >
                          {isPaused || isError ? (
                            <>
                              <Play size={11} />
                              Resume
                            </>
                          ) : (
                            <>
                              <Pause size={11} />
                              Pause
                            </>
                          )}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={(e) => handleRemove(e, download.id)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        title="Remove download"
                      >
                        <Trash2 size={13} />
                      </Button>
                      <ChevronRight size={14} className="text-muted-foreground ml-1" />
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full transition-all duration-300 ${
                        isError
                          ? 'bg-destructive'
                          : isPaused
                            ? 'bg-[var(--color-usb)]'
                            : 'bg-primary'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </PageFrame>
  )
}
