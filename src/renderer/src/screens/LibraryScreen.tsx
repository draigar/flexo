import type { DownloadRecord } from '@shared/types'
import { useEffect, useState } from 'react'
import { PageFrame } from '../components/PageFrame'
import { Button } from '../components/ui/button'
import { useAppStore } from '../store/useAppStore'
import { describeError, fileExtensionBadge, formatBytes, toDisplayPath } from '../utils/format'

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function LibraryScreen(): React.JSX.Element {
  const homeDir = useAppStore((store) => store.homeDir)
  const [records, setRecords] = useState<DownloadRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    const load = (): void => {
      void window.flexo
        .listDownloadHistory()
        .then((next) => {
          if (!disposed) {
            setRecords(next)
            setError(null)
          }
        })
        .catch((loadError) => {
          if (!disposed) setError(describeError(loadError))
        })
    }
    load()
    const unsub = window.flexo.onHistoryUpdated(load)
    return () => {
      disposed = true
      unsub()
    }
  }, [])

  return (
    <PageFrame title="Downloads">
      {error && <p className="mb-3 text-[12px] text-destructive">{error}</p>}
      {records.length === 0 && !error ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Files Flexo finishes are kept here. The list is stored in a local SQLite database, and
          removing a row leaves the file on disk.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {records.map((record) => (
            <li
              key={record.id}
              className="flex items-center gap-3 rounded-[9px] border border-border px-3 py-2.5"
            >
              <div className="flex h-8 w-11 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[9px] font-semibold tracking-wide text-[var(--text-secondary)]">
                {fileExtensionBadge(record.fileName)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-foreground">{record.fileName}</div>
                <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                  {formatBytes(record.totalBytes)} · {formatWhen(record.completedAt)}
                </div>
                <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                  {toDisplayPath(record.destinationPath, homeDir)}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={() => void window.flexo.revealInFolder(record.destinationPath)}
                  className="font-mono text-[10px] tracking-wide uppercase"
                >
                  Show
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  title="Remove from this list. The file stays on disk."
                  onClick={() => {
                    void window.flexo.removeDownloadHistory(record.id).then(() => {
                      setRecords((current) => current.filter((item) => item.id !== record.id))
                    })
                  }}
                  className="font-mono text-[10px] tracking-wide uppercase"
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </PageFrame>
  )
}
