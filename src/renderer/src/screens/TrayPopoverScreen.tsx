import type { DownloadState, InterfaceSpeedInfo } from '@shared/types'
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  HardDrive,
  Maximize2,
  Pause,
  Play,
  Power,
  RefreshCw,
  Wifi,
  X,
  Zap
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useDownloadEvents } from '../hooks/useDownloadEvents'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useAppStore } from '../store/useAppStore'
import {
  fileExtensionBadge,
  formatBytes,
  formatEta,
  formatPercent,
  formatSpeed
} from '../utils/format'

function formatBits(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 Mbps'
  const bits = bytesPerSec * 8
  if (bits >= 1_000_000_000) {
    return `${(bits / 1_000_000_000).toFixed(1)} Gbps`
  }
  if (bits >= 1_000_000) {
    return `${(bits / 1_000_000).toFixed(1)} Mbps`
  }
  if (bits >= 1_000) {
    return `${(bits / 1_000).toFixed(0)} Kbps`
  }
  return `${bits.toFixed(0)} bps`
}

function getNetworkIcon(kind: string): React.JSX.Element {
  switch (kind) {
    case 'wifi':
      return <Wifi className="size-3" />
    case 'ethernet':
    case 'usb':
    default:
      return <HardDrive className="size-3" />
  }
}

function Sparkline({
  data,
  color,
  gradientId,
  height = 24,
  width = 110
}: {
  data: number[]
  color: string
  gradientId: string
  height?: number
  width?: number
}): React.JSX.Element {
  const pointsData = data.length < 2 ? [0, ...(data.length === 1 ? data : [0])] : data
  const maxVal = Math.max(...pointsData, 50_000) // minimum threshold for visibility
  const step = width / (pointsData.length - 1)

  const points = pointsData.map((val, idx) => {
    const x = idx * step
    const y = height - (val / maxVal) * (height - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const pathD = `M ${points.join(' L ')}`
  const areaD = `${pathD} L ${width.toFixed(1)},${height} L 0,${height} Z`
  const lastX = width
  const lastY = height - (pointsData[pointsData.length - 1] / maxVal) * (height - 6) - 3

  return (
    <div className="relative overflow-hidden rounded bg-[var(--bg-tertiary)]/60 px-1 py-0.5 border border-[var(--border)]/40">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-5 block overflow-visible"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.45" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#${gradientId})`} />
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle
          cx={lastX}
          cy={lastY}
          r="2"
          fill={color}
          className="animate-pulse"
        />
      </svg>
    </div>
  )
}

interface SpeedHistoryMap {
  [interfaceId: string]: {
    download: number[]
    upload: number[]
  }
}

export function TrayPopoverScreen(): React.JSX.Element {
  useDownloadEvents()

  const activeDownloadsMap = useAppStore((store) => store.activeDownloads)
  const currentDownload = useAppStore((store) => store.currentDownload)
  const networkSpeeds = useAppStore((store) => store.networkSpeeds)
  const isTestingSpeed = useAppStore((store) => store.isTestingSpeed)
  const triggerSpeedTest = useAppStore((store) => store.triggerSpeedTest)
  const interfaces = useAppStore((store) => store.interfaces)
  const loadInterfaces = useAppStore((store) => store.loadInterfaces)
  const resolveVisual = useNetworkVisuals()

  const [history, setHistory] = useState<SpeedHistoryMap>({})
  const historyRef = useRef<SpeedHistoryMap>({})
  historyRef.current = history

  useEffect(() => {
    void loadInterfaces()
  }, [loadInterfaces])

  // Combine active downloads
  const activeDownloads = useMemo(() => {
    const map = new Map<string, DownloadState>()
    if (
      currentDownload &&
      (currentDownload.status === 'downloading' ||
        currentDownload.status === 'assembling' ||
        currentDownload.status === 'paused')
    ) {
      map.set(currentDownload.id, currentDownload)
    }
    for (const d of Object.values(activeDownloadsMap)) {
      if (d.status === 'downloading' || d.status === 'assembling' || d.status === 'paused') {
        map.set(d.id, d)
      }
    }
    return Array.from(map.values())
  }, [activeDownloadsMap, currentDownload])

  const downloadingCount = activeDownloads.filter((d) => d.status === 'downloading').length

  const handleOpenMain = (): void => {
    void window.flexo.presentMainWindow()
    void window.flexo.hideTrayPopover()
  }

  const handleClose = (): void => {
    void window.flexo.hideTrayPopover()
  }

  const handleQuit = (): void => {
    void window.flexo.quitApp()
  }

  // Interfaces list merged with speed snapshot
  const speedInterfaces: InterfaceSpeedInfo[] = useMemo(() => {
    if (networkSpeeds && networkSpeeds.interfaces.length > 0) {
      return networkSpeeds.interfaces
    }
    return interfaces.map((iface) => ({
      interfaceId: iface.id,
      device: iface.device,
      displayName: iface.displayName,
      kind: iface.kind,
      address: iface.addresses[0]?.address ?? '',
      downloadBytesPerSec: 0,
      uploadBytesPerSec: 0,
      latencyMs: undefined,
      isActiveProbe: false,
      lastUpdatedMs: Date.now()
    }))
  }, [networkSpeeds, interfaces])

  // Update rolling sparkline history when speeds update
  useEffect(() => {
    if (!speedInterfaces || speedInterfaces.length === 0) return

    setHistory((prev) => {
      const next: SpeedHistoryMap = { ...prev }
      for (const iface of speedInterfaces) {
        const prevData = next[iface.interfaceId] || {
          download: [0, 0, 0, 0, 0],
          upload: [0, 0, 0, 0, 0]
        }
        const newDl = [...prevData.download, iface.downloadBytesPerSec].slice(-16)
        const newUl = [...prevData.upload, iface.uploadBytesPerSec].slice(-16)
        next[iface.interfaceId] = {
          download: newDl,
          upload: newUl
        }
      }
      return next
    })
  }, [speedInterfaces])

  return (
    <div className="flex h-screen w-[320px] flex-col overflow-hidden bg-[var(--bg-primary)] font-sans text-[var(--text-primary)] select-none border border-[var(--border)] shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5 bg-[var(--bg-secondary)]/90 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-bold text-[11px]">
            ⚡
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-xs tracking-wide">FLEXO</span>
            {downloadingCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400 border border-emerald-500/30">
                <span className="size-1 rounded-full bg-emerald-400 animate-pulse" />
                {downloadingCount} active
              </span>
            ) : (
              <span className="rounded-full bg-[var(--bg-tertiary)] px-1.5 py-0.2 text-[9px] text-[var(--text-muted)] border border-[var(--border)]">
                Idle
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleOpenMain}
            title="Open Flexo App"
            className="flex size-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <Maximize2 className="size-3" />
          </button>
          <button
            type="button"
            onClick={handleQuit}
            title="Quit Flexo"
            className="flex size-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-red-500/15 hover:text-red-400 transition-colors cursor-pointer"
          >
            <Power className="size-3" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            title="Close menu"
            className="flex size-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 space-y-3">
        {/* Section 1: Active Downloads */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Active Downloads ({activeDownloads.length})
            </span>
            {activeDownloads.length > 0 && (
              <button
                type="button"
                onClick={handleOpenMain}
                className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>View all</span>
                <ExternalLink className="size-2.5" />
              </button>
            )}
          </div>

          {activeDownloads.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-secondary)]/40 p-3 text-center">
              <div className="mx-auto mb-1 flex size-7 items-center justify-center rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                <HardDrive className="size-3.5 opacity-60" />
              </div>
              <p className="text-[11px] font-medium text-[var(--text-primary)]">No active downloads</p>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                Copied links or browser downloads appear here
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {activeDownloads.map((download) => {
                const percent = formatPercent(download.bytesDownloaded, download.totalBytes)
                const isPaused = download.status === 'paused'
                const isAssembling = download.status === 'assembling'
                const ext = fileExtensionBadge(download.fileName)

                return (
                  <div
                    key={download.id}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-2.5 shadow-xs space-y-1.5"
                  >
                    {/* File row */}
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="rounded bg-emerald-500/20 px-1 py-0.2 font-mono text-[8px] font-bold text-emerald-300 shrink-0">
                          {ext}
                        </span>
                        <span
                          className="truncate text-[11px] font-semibold text-[var(--text-primary)]"
                          title={download.fileName}
                        >
                          {download.fileName}
                        </span>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        {isPaused ? (
                          <button
                            type="button"
                            onClick={() => void window.flexo.resumeDownload(download.id)}
                            title="Resume"
                            className="size-5 flex items-center justify-center rounded hover:bg-[var(--bg-tertiary)] text-emerald-400 cursor-pointer"
                          >
                            <Play className="size-2.5 fill-current" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void window.flexo.pauseDownload(download.id)}
                            title="Pause"
                            className="size-5 flex items-center justify-center rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                          >
                            <Pause className="size-2.5 fill-current" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void window.flexo.cancelDownload(download.id)}
                          title="Cancel"
                          className="size-5 flex items-center justify-center rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-red-400 cursor-pointer"
                        >
                          <X className="size-2.5" />
                        </button>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300"
                        style={{ width: `${Math.max(2, percent)}%` }}
                      />
                    </div>

                    {/* Stats Row */}
                    <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
                      <span>
                        {percent}%
                        {download.totalBytes > 0 && (
                          <span className="text-[9px] opacity-75 ml-1">
                            ({formatBytes(download.bytesDownloaded)})
                          </span>
                        )}
                      </span>
                      <span className="font-semibold text-emerald-400">
                        {isAssembling
                          ? 'Assembling…'
                          : isPaused
                          ? 'Paused'
                          : formatSpeed(download.speedBytesPerSec)}
                      </span>
                      <span>ETA {formatEta(download.totalBytes - download.bytesDownloaded, download.speedBytesPerSec)}</span>
                    </div>

                    {/* Multi-network breakdown chips */}
                    {download.chunks.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-[var(--border)]/40">
                        {Array.from(
                          download.chunks.reduce<Map<string, { label: string; speed: number; kind: string }>>(
                            (acc, chunk) => {
                              const existing = acc.get(chunk.interfaceId)
                              if (existing) {
                                existing.speed += chunk.speedBytesPerSec
                              } else {
                                acc.set(chunk.interfaceId, {
                                  label: chunk.interfaceLabel,
                                  speed: chunk.speedBytesPerSec,
                                  kind: chunk.interfaceKind
                                })
                              }
                              return acc
                            },
                            new Map()
                          ).entries()
                        ).map(([ifaceId, data]) => {
                          const visual = resolveVisual(ifaceId, data.kind as any, data.label)
                          return (
                            <div
                              key={ifaceId}
                              className="flex items-center gap-1 rounded px-1 py-0.2 text-[8px] font-mono border"
                              style={{
                                background: visual.bg,
                                borderColor: visual.border,
                                color: visual.text
                              }}
                            >
                              <span
                                className="size-1 rounded-full"
                                style={{ background: visual.solid }}
                              />
                              <span className="font-medium">{visual.label}:</span>
                              <span className="font-bold">{formatSpeed(data.speed)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Section 2: Network Speeds with Sparklines */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Network Speeds
              </span>
              <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-1 py-0.2 text-[8px] font-bold text-emerald-400 border border-emerald-500/20">
                <span className="size-1 rounded-full bg-emerald-400 animate-ping" />
                LIVE
              </span>
            </div>

            <button
              type="button"
              onClick={() => void triggerSpeedTest()}
              disabled={isTestingSpeed}
              title="Run instant speed test"
              className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-emerald-400 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`size-2.5 ${isTestingSpeed ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{isTestingSpeed ? 'Testing…' : 'Test Now'}</span>
            </button>
          </div>

          <div className="space-y-2">
            {speedInterfaces.map((iface) => {
              const visual = resolveVisual(iface.interfaceId, iface.kind, iface.displayName)
              const ifaceHistory = history[iface.interfaceId] || {
                download: [0, 0, 0, 0, 0],
                upload: [0, 0, 0, 0, 0]
              }

              return (
                <div
                  key={iface.interfaceId}
                  className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-2 space-y-1.5 transition-all"
                >
                  {/* Interface Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <div
                        className="flex size-4 items-center justify-center rounded text-[9px]"
                        style={{ background: visual.bg, color: visual.text }}
                      >
                        {getNetworkIcon(iface.kind)}
                      </div>
                      <span className="font-semibold text-[11px] text-[var(--text-primary)]">
                        {visual.label}
                      </span>
                      <span className="font-mono text-[9px] text-[var(--text-muted)]">
                        ({iface.device})
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {iface.latencyMs != null && (
                        <span className="flex items-center gap-0.5 font-mono text-[9px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] px-1 py-0.2 rounded border border-[var(--border)]">
                          <Zap className="size-2 text-amber-400" />
                          {iface.latencyMs}ms
                        </span>
                      )}
                      <span className="text-[8px] uppercase px-1 py-0.2 rounded font-mono font-medium text-[var(--text-muted)] bg-[var(--bg-tertiary)]">
                        {iface.isActiveProbe ? 'Probe' : 'Stream'}
                      </span>
                    </div>
                  </div>

                  {/* Dual Speed Columns with Fancy Sparklines */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-[var(--border)]/40">
                    {/* Download */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="flex items-center gap-0.5 text-emerald-400 font-semibold">
                          <ArrowDown className="size-2.5" />
                          <span>Down</span>
                        </span>
                        <span className="font-bold text-[10px] text-[var(--text-primary)]">
                          {formatBits(iface.downloadBytesPerSec)}
                        </span>
                      </div>

                      <Sparkline
                        data={ifaceHistory.download}
                        color="#10b981"
                        gradientId={`spark-dl-${iface.interfaceId}`}
                      />

                      <div className="text-[8px] text-[var(--text-muted)] text-right font-mono">
                        {formatSpeed(iface.downloadBytesPerSec)}
                      </div>
                    </div>

                    {/* Upload */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span className="flex items-center gap-0.5 text-cyan-400 font-semibold">
                          <ArrowUp className="size-2.5" />
                          <span>Up</span>
                        </span>
                        <span className="font-bold text-[10px] text-[var(--text-primary)]">
                          {formatBits(iface.uploadBytesPerSec)}
                        </span>
                      </div>

                      <Sparkline
                        data={ifaceHistory.upload}
                        color="#06b6d4"
                        gradientId={`spark-ul-${iface.interfaceId}`}
                      />

                      <div className="text-[8px] text-[var(--text-muted)] text-right font-mono">
                        {formatSpeed(iface.uploadBytesPerSec)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[var(--border)] bg-[var(--bg-secondary)]/90 px-3 py-2 flex items-center justify-between">
        <button
          type="button"
          onClick={handleOpenMain}
          className="flex-1 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-semibold text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Activity className="size-3" />
          <span>Open Full Flexo Window</span>
        </button>
      </div>
    </div>
  )
}
