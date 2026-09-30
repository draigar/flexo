import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'

const isMac = window.flexo.platform === 'darwin'

const buttonClass =
  'flex size-[26px] shrink-0 items-center justify-center text-[var(--text-secondary)] [-webkit-app-region:no-drag] transition-colors'

/** Custom window chrome for a decorations-free Tauri window. */
export function WindowControls(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const window = getCurrentWindow()
    void window.isMaximized().then(setMaximized)
    let unlisten: (() => void) | undefined
    void window
      .onResized(() => {
        void window.isMaximized().then(setMaximized)
      })
      .then((fn) => {
        unlisten = fn
      })
    return () => unlisten?.()
  }, [])

  const minimize = (): void => {
    void getCurrentWindow().minimize()
  }
  const toggleMaximize = (): void => {
    void getCurrentWindow().toggleMaximize()
  }
  const close = (): void => {
    void getCurrentWindow().close()
  }

  if (isMac) {
    return (
      <div className="flex items-center gap-[7px] [-webkit-app-region:no-drag]">
        <MacLight
          color="#ff5f57"
          label="Close"
          onClick={close}
          icon={
            <path
              d="M4.5 4.5l7 7M11.5 4.5l-7 7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          }
        />
        <MacLight
          color="#febc2e"
          label="Minimize"
          onClick={minimize}
          icon={<path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />}
        />
        <MacLight
          color="#28c840"
          label={maximized ? 'Restore' : 'Maximize'}
          onClick={toggleMaximize}
          icon={
            maximized ? (
              <path
                d="M5.2 6.2h4.6v4.6H5.2zM6.8 5h4.6v4.6"
                stroke="currentColor"
                strokeWidth="1.1"
                fill="none"
              />
            ) : (
              <path
                d="M4.2 8V4.8h3.2M11.8 8v3.2H8.6"
                stroke="currentColor"
                strokeWidth="1.1"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            )
          }
        />
      </div>
    )
  }

  return (
    <div className="flex items-center [-webkit-app-region:no-drag]">
      <button
        type="button"
        aria-label="Minimize"
        onClick={minimize}
        className={`${buttonClass} rounded-[6px] hover:bg-secondary`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        onClick={toggleMaximize}
        className={`${buttonClass} rounded-[6px] hover:bg-secondary`}
      >
        {maximized ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M3.5 4.5h5v5h-5zM4.5 3.5h5v5"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        className={`${buttonClass} rounded-[6px] hover:bg-destructive/15 hover:text-destructive`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M3 3l6 6M9 3l-6 6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}

function MacLight({
  color,
  label,
  onClick,
  icon
}: {
  color: string
  label: string
  onClick: () => void
  icon: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="group flex size-[12px] items-center justify-center rounded-full"
      style={{ backgroundColor: color }}
    >
      <svg
        width="8"
        height="8"
        viewBox="0 0 16 16"
        className="opacity-0 text-black/55 transition-opacity group-hover:opacity-100"
      >
        {icon}
      </svg>
    </button>
  )
}
