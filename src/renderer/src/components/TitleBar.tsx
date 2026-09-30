import { ArrowDownToLine, FolderOpen, Plus, Settings } from 'lucide-react'
import { useAppStore } from '../store/useAppStore'
import { ColorBadge } from './ColorBadge'
import { ThemeToggle } from './ThemeToggle'
import { UpdateIndicator } from './UpdateIndicator'
import { WindowControls } from './WindowControls'

export type TitleBarStatus =
  | { kind: 'none' }
  | { kind: 'combined'; networkCount: number }
  | { kind: 'assembling' }
  | { kind: 'paused'; networkCount: number }
  | { kind: 'offline' }

const isMac = window.flexo.platform === 'darwin'

const pillClass =
  'h-auto flex items-center gap-[7px] rounded-full px-2.5 py-1 font-mono text-[10px] leading-none font-semibold tracking-[0.08em] uppercase whitespace-nowrap'
const pillDotClass = 'size-1.5 shrink-0 rounded-full'

/**
 * Custom title bar for the decorations-free Tauri window.
 * Drag anywhere on the bar; interactive controls opt out with no-drag.
 */
const navButtonClass =
  'flex size-[26px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-[0.5px] [-webkit-app-region:no-drag]'

export function TitleBar({ status }: { status: TitleBarStatus }): React.JSX.Element {
  const dimmed = status.kind === 'offline'
  const page = useAppStore((store) => store.page)
  const setPage = useAppStore((store) => store.setPage)
  const activeDownloads = useAppStore((store) => store.activeDownloads)
  const focusedDownloadId = useAppStore((store) => store.focusedDownloadId)
  const setFocusedDownloadId = useAppStore((store) => store.setFocusedDownloadId)

  const ongoingCount = Object.values(activeDownloads).filter(
    (d) =>
      d.status === 'downloading' ||
      d.status === 'assembling' ||
      d.status === 'paused' ||
      d.status === 'error'
  ).length

  return (
    <div
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-3 border-b-[0.5px] border-border bg-card px-3.5 [-webkit-app-region:drag]"
    >
      {isMac && <WindowControls />}

      <img
        src="/icon.png"
        alt=""
        data-tauri-drag-region
        className="size-[18px] shrink-0 rounded-[5px] [-webkit-app-region:drag]"
      />
      <div
        data-tauri-drag-region
        className={`font-sans text-[13px] leading-none font-bold tracking-[-0.02em] ${
          dimmed ? 'text-muted-foreground' : 'text-foreground'
        }`}
      >
        Flexo
      </div>

      <div data-tauri-drag-region className="flex-1" />

      {status.kind === 'combined' && (
        <ColorBadge
          bg="var(--color-wifi-bg)"
          border="var(--color-wifi-border)"
          text="var(--color-wifi-text)"
          className={`${pillClass} [-webkit-app-region:no-drag]`}
        >
          <div
            className={`${pillDotClass} bg-(--color-wifi) animate-[flexo-glow_2s_ease-in-out_infinite]`}
          />
          {status.networkCount} {status.networkCount === 1 ? 'network' : 'networks'} combined
        </ColorBadge>
      )}
      {status.kind === 'assembling' && (
        <ColorBadge
          bg="var(--color-ethernet-bg)"
          border="var(--color-ethernet-border)"
          text="var(--color-ethernet-text)"
          className={`${pillClass} [-webkit-app-region:no-drag]`}
        >
          <div
            className={`${pillDotClass} bg-(--color-ethernet) animate-[flexo-glow_1s_ease-in-out_infinite]`}
          />
          Assembling file…
        </ColorBadge>
      )}
      {status.kind === 'paused' && (
        <ColorBadge
          bg="var(--color-usb-bg)"
          border="var(--color-usb-border)"
          text="var(--color-usb-text)"
          className={`${pillClass} [-webkit-app-region:no-drag]`}
        >
          <div className={`${pillDotClass} bg-(--color-usb)`} />
          {status.networkCount} {status.networkCount === 1 ? 'network' : 'networks'} · Paused
        </ColorBadge>
      )}
      {status.kind === 'offline' && (
        <ColorBadge
          bg="var(--color-danger-bg)"
          border="var(--color-danger-border)"
          text="var(--color-danger)"
          className={`${pillClass} [-webkit-app-region:no-drag]`}
        >
          <div className={`${pillDotClass} bg-destructive`} />
          Offline
        </ColorBadge>
      )}

      {(ongoingCount > 0 || focusedDownloadId !== null || page === 'ongoing') && (
        <button
          type="button"
          title="New Download"
          aria-label="New Download"
          onClick={() => {
            setFocusedDownloadId(null)
            useAppStore.getState().setDraftUrl('')
            setPage('home')
          }}
          className={`${navButtonClass} border-border bg-secondary text-[var(--text-secondary)] hover:text-foreground hover:border-primary/50 transition-colors`}
        >
          <Plus size={14} />
        </button>
      )}

      {ongoingCount > 0 && (
        <button
          type="button"
          title="Ongoing Downloads"
          aria-label="Ongoing Downloads"
          aria-pressed={page === 'ongoing'}
          onClick={() => setPage(page === 'ongoing' ? 'home' : 'ongoing')}
          className={`relative ${navButtonClass} ${
            page === 'ongoing'
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-secondary text-[var(--text-secondary)]'
          }`}
        >
          <ArrowDownToLine size={14} />
          <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-primary font-mono text-[9px] font-bold text-primary-foreground ring-2 ring-card animate-pulse">
            {ongoingCount}
          </span>
        </button>
      )}

      <button
        type="button"
        aria-label="Downloads"
        aria-pressed={page === 'library'}
        onClick={() => setPage(page === 'library' ? 'home' : 'library')}
        className={`${navButtonClass} ${
          page === 'library'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-secondary text-[var(--text-secondary)]'
        }`}
      >
        <FolderOpen size={14} />
      </button>
      <button
        type="button"
        aria-label="Settings"
        aria-pressed={page === 'settings'}
        onClick={() => setPage(page === 'settings' ? 'home' : 'settings')}
        className={`${navButtonClass} ${
          page === 'settings'
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-secondary text-[var(--text-secondary)]'
        }`}
      >
        <Settings size={14} />
      </button>
      <UpdateIndicator />
      <ThemeToggle />
      {!isMac && <WindowControls />}
    </div>
  )
}
