import type { MediaCandidate, ProbeResult, StartDownloadRequest } from '@shared/types'
import { cn } from 'cn'
import { AlertTriangle, Film, FolderOpen, Lock, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useFormatSpeedLimit } from '../hooks/useFormatSpeed'
import { useNetworkUsage } from '../hooks/useNetworks'
import { useNetworkVisuals } from '../hooks/useNetworkVisuals'
import { useDownloadSchedule } from '../hooks/useDownloadSchedule'
import { useAppStore } from '../store/useAppStore'
import {
  acceptedLink,
  describeError,
  fileExtensionBadge,
  formatBytes,
  toDisplayPath
} from '../utils/format'
import { Button } from './ui/button'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ready'; result: ProbeResult }
  | { status: 'error'; message: string }

const PROBE_DEBOUNCE_MS = 600

type StreamsChoice = 'auto' | number
const STREAMS_CHOICES: StreamsChoice[] = ['auto', 4, 8, 16, 32]

const labelClass = 'w-16 shrink-0 text-[12.5px] text-[var(--text-secondary)]'

export function NewDownloadDialog(): React.JSX.Element {
  const open = useAppStore((store) => store.newDownloadOpen)
  const close = useAppStore((store) => store.closeNewDownload)
  const formKey = useAppStore((store) => store.formKey)

  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(next) => !next && close()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100%-2rem)] flex-col gap-0 p-0 sm:max-w-[560px]"
      >
        {open && <NewDownloadForm key={formKey} onDone={close} />}
      </DialogContent>
    </Dialog>
  )
}

function NewDownloadForm({ onDone }: { onDone: () => void }): React.JSX.Element {
  const { schedule, window: scheduleWindow } = useDownloadSchedule()
  const scheduledWait = schedule?.enabled && !scheduleWindow.allowed
  const interfaces = useAppStore((store) => store.interfaces)
  const homeDir = useAppStore((store) => store.homeDir)
  const url = useAppStore((store) => store.draftUrl)
  const setUrl = useAppStore((store) => store.setDraftUrl)
  const draftFileName = useAppStore((store) => store.draftFileName)
  const draftReferer = useAppStore((store) => store.draftReferer)
  const draftCookies = useAppStore((store) => store.draftCookies)
  const setDraftReferer = useAppStore((store) => store.setDraftReferer)
  const setDraftCookies = useAppStore((store) => store.setDraftCookies)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const setDestinationDir = useAppStore((store) => store.setDestinationDir)
  const full = useAppStore(
    (store) =>
      Object.values(store.downloads).filter((download) => download.status === 'downloading')
        .length >= store.downloadsAtOnce
  )
  const networkVisual = useNetworkVisuals()
  const networkPreferences = useAppStore((store) => store.networkPreferences)
  const usage = useNetworkUsage(true)
  const formatSpeedLimit = useFormatSpeedLimit()
  const linkInput = useRef<HTMLInputElement>(null)

  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  const [deselectedInterfaceIds, setDeselectedInterfaceIds] = useState<string[]>(() =>
    Object.entries(useAppStore.getState().networkPreferences)
      .filter(([, preference]) => preference.off)
      .map(([id]) => id)
  )
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [fileNameOverride, setFileNameOverride] = useState<string | null>(null)
  const [streamsChoice, setStreamsChoice] = useState<StreamsChoice>('auto')
  const [referer, setReferer] = useState<string>(() => draftReferer || '')
  const [cookies, setCookies] = useState<string>(() => draftCookies || '')
  const [showHeaders, setShowHeaders] = useState<boolean>(() => Boolean(draftReferer || draftCookies))

  // Media candidates state
  const [mediaCandidates, setMediaCandidates] = useState<MediaCandidate[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<MediaCandidate | null>(null)
  const [resolvingMedia, setResolvingMedia] = useState(false)

  useEffect(() => {
    if (useAppStore.getState().draftUrl) return
    void window.flexo
      .readClipboardText()
      .then((text) => {
        const link = acceptedLink(text)
        const { draftUrl, startedUrl } = useAppStore.getState()
        if (link && link !== startedUrl && !draftUrl) setUrl(link)
      })
      .catch(() => {})
  }, [setUrl])

  const runProbe = async (targetUrl: string, ref?: string, cook?: string): Promise<void> => {
    const trimmed = targetUrl.trim()
    if (!trimmed) {
      setProbe({ status: 'idle' })
      return
    }
    setProbe({ status: 'probing' })
    try {
      const payload =
        ref || cook
          ? { url: trimmed, referer: ref || undefined, cookies: cook || undefined }
          : trimmed
      const result = await window.flexo.probeUrl(payload)
      setProbe({ status: 'ready', result })
    } catch (error) {
      setProbe({ status: 'error', message: describeError(error) })
    }
  }

  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      setProbe({ status: 'idle' })
      setMediaCandidates([])
      setSelectedCandidate(null)
      return
    }

    setProbe({ status: 'probing' })
    const timer = setTimeout(() => {
      void runProbe(trimmed, referer.trim() || undefined, cookies.trim() || undefined)
    }, PROBE_DEBOUNCE_MS)

    // Check if URL could be a video streaming link
    if (/youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|\.m3u8|\.mpd/i.test(trimmed)) {
      setResolvingMedia(true)
      window.flexo
        .resolveMedia(trimmed)
        .then((candidates) => {
          setMediaCandidates(candidates)
          if (candidates.length > 0) {
            setSelectedCandidate(candidates[0])
          }
        })
        .catch(() => {})
        .finally(() => setResolvingMedia(false))
    }

    return () => clearTimeout(timer)
  }, [url])

  const ready = probe.status === 'ready'
  const probeResult = ready ? probe.result : null

  const fileName =
    fileNameOverride ??
    draftFileName ??
    selectedCandidate?.title ??
    probeResult?.suggestedFileName ??
    'download'

  const totalBytes = selectedCandidate?.totalBytes ?? probeResult?.totalBytes ?? null

  const isSingleStreamOnly = probeResult !== null && !probeResult.supportsRanges

  const availableIds = interfaces
    .filter((iface) => {
      const pref = networkPreferences[iface.id]
      if (pref?.dataLimit && (usage[iface.id] ?? 0) >= pref.dataLimit) return false
      return true
    })
    .map((iface) => iface.id)

  const selectedInterfaceIds = interfaces
    .map((iface) => iface.id)
    .filter((id) => !deselectedInterfaceIds.includes(id))

  const handleToggleInterface = (id: string): void => {
    setDeselectedInterfaceIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const handleBrowse = async (): Promise<void> => {
    try {
      const picked = await window.flexo.chooseDestinationFolder(destinationDir)
      if (picked) setDestinationDir(picked)
    } catch {}
  }

  const handleStart = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!ready || selectedInterfaceIds.length === 0) return
    setStarting(true)
    setStartError(null)

    try {
      const streams = streamsChoice === 'auto' ? 2 : streamsChoice
      const chunkCount = Math.max(1, selectedInterfaceIds.length * streams)

      const startReq: StartDownloadRequest = {
        kind: 'http',
        url: selectedCandidate?.url ?? probeResult?.finalUrl ?? url.trim(),
        destinationDir,
        suggestedFileName: fileName,
        totalBytes: totalBytes ?? 0,
        supportsRanges: isSingleStreamOnly ? false : (probeResult?.supportsRanges ?? true),
        interfaceIds: selectedInterfaceIds,
        chunkCount,
        connectionsPerNetwork: streamsChoice === 'auto' ? undefined : streamsChoice,
        streamsPerNetwork: streamsChoice === 'auto' ? undefined : streamsChoice,
        etag: probeResult?.etag ?? null,
        lastModified: probeResult?.lastModified ?? null,
        referer: referer.trim() || undefined,
        cookies: cookies.trim() || undefined
      }

      if (selectedCandidate) {
        await window.flexo.startMediaDownload(selectedCandidate.id, startReq)
      } else if (full) {
        await window.flexo.enqueueDownload(startReq)
      } else {
        await window.flexo.startDownload(startReq)
      }

      useAppStore.getState().setDraftUrl('')
      setDraftReferer(undefined)
      setDraftCookies(undefined)
      onDone()
    } catch (error) {
      setStartError(describeError(error))
      setStarting(false)
    }
  }

  const canStart = ready && selectedInterfaceIds.length > 0 && !starting
  const startLabel = starting
    ? 'Starting…'
    : scheduledWait
      ? 'Start scheduled'
      : full
        ? 'Add to queue'
        : 'Download'

  return (
    <form onSubmit={handleStart} className="flex flex-col">
      <div className="flex items-center justify-between border-b-[0.5px] border-border px-4 py-3">
        <DialogTitle className="text-[16px] font-semibold">New download</DialogTitle>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto p-4 max-h-[75vh]">
        {/* URL input */}
        <div className="flex flex-col gap-1.5">
          <input
            ref={linkInput}
            autoFocus
            type="text"
            placeholder="Paste download link or magnet URL…"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 font-mono text-[13px] outline-none focus:ring-2 focus:ring-ring"
          />
          {probe.status === 'probing' && (
            <div className="text-[12px] text-muted-foreground">Checking link…</div>
          )}
          {probe.status === 'error' && (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-[12px] text-destructive">
              <div>{probe.message}</div>
              {probe.message.toLowerCase().includes('403') && (
                <div className="flex flex-col gap-2 rounded border border-border/40 bg-background/50 p-2 text-[11.5px] text-foreground/90">
                  <span>
                    The server blocked access (403 Forbidden). Enter the source webpage URL below to send as <strong>Referer</strong>:
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="e.g. https://watchhentai.net/download/..."
                      value={referer}
                      onChange={(e) => setReferer(e.target.value)}
                      className="flex-1 rounded border border-border bg-background px-2.5 py-1 font-mono text-[11.5px] outline-none focus:ring-1 focus:ring-ring text-foreground"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="h-6 text-[11px] px-2.5"
                      onClick={() => void runProbe(url.trim(), referer.trim(), cookies.trim())}
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Headers / Referer collapsible options */}
        <div className="border-t border-border/50 pt-1">
          <button
            type="button"
            onClick={() => setShowHeaders(!showHeaders)}
            className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <span>{showHeaders ? '▼' : '▶'}</span>
            <span>Headers & Source Webpage (Referer, Cookies)</span>
          </button>
          {showHeaders && (
            <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-2.5 text-[12px]">
              <div className="flex flex-col gap-1">
                <label className="text-[10.5px] font-semibold text-muted-foreground uppercase">
                  Referer / Source Page URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="https://example.com/source-page"
                    value={referer}
                    onChange={(e) => setReferer(e.target.value)}
                    className="flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11.5px] outline-none focus:ring-1 focus:ring-ring"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] px-2"
                    onClick={() => void runProbe(url.trim(), referer.trim(), cookies.trim())}
                  >
                    Apply & Probe
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10.5px] font-semibold text-muted-foreground uppercase">
                  Cookies (optional)
                </label>
                <input
                  type="text"
                  placeholder="key=value; ..."
                  value={cookies}
                  onChange={(e) => setCookies(e.target.value)}
                  className="rounded border border-border bg-background px-2 py-1 font-mono text-[11.5px] outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          )}
        </div>

        {/* Media candidates resolution */}
        {mediaCandidates.length > 0 && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase text-emerald-500">
                <Film className="size-3.5" />
                Detected Media Streams ({mediaCandidates.length})
              </span>
            </div>
            <div className="grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto">
              {mediaCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => setSelectedCandidate(candidate)}
                  className={cn(
                    'flex items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-[12px] transition',
                    selectedCandidate?.id === candidate.id
                      ? 'border-emerald-500 bg-emerald-500/15 font-medium text-emerald-400'
                      : 'border-border bg-card hover:bg-muted'
                  )}
                >
                  <span className="truncate">{candidate.quality || candidate.title || candidate.kind.toUpperCase()}</span>
                  {candidate.totalBytes && (
                    <span className="font-mono text-[11px] text-muted-foreground ml-2">
                      {formatBytes(candidate.totalBytes)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* File info card */}
        {ready && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary font-mono text-[11px] font-bold">
              {fileExtensionBadge(fileName)}
            </div>
            <div className="min-w-0 flex-1">
              <input
                type="text"
                value={fileName}
                onChange={(event) => setFileNameOverride(event.target.value)}
                className="w-full truncate bg-transparent font-medium text-[13px] outline-none hover:underline focus:underline"
              />
              <div className="flex items-center gap-2 font-mono text-[11.5px] text-muted-foreground">
                <span>{totalBytes ? formatBytes(totalBytes) : 'Unknown size'}</span>
                {probeResult?.supportsRanges && (
                  <>
                    <span>·</span>
                    <span className="text-emerald-500">Parallel split supported</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Destination folder */}
        <div className="flex items-center justify-between gap-3">
          <div className={labelClass}>Folder</div>
          <div className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted-foreground">
            {toDisplayPath(destinationDir, homeDir)}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={handleBrowse}>
            <FolderOpen className="size-3.5 mr-1" />
            Change
          </Button>
        </div>

        {/* Networks selection */}
        <div className="flex items-start gap-3">
          <div className={cn(labelClass, 'pt-1.5')}>Networks</div>
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {interfaces.map((iface) => {
              const visual = networkVisual(iface.id, iface.kind, iface.displayName)
              const selected = selectedInterfaceIds.includes(iface.id)
              return (
                <button
                  key={iface.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => handleToggleInterface(iface.id)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors cursor-pointer',
                    selected
                      ? 'border-transparent font-medium'
                      : 'border-border text-muted-foreground opacity-60'
                  )}
                  style={
                    selected ? { background: visual.bg, borderColor: visual.border } : undefined
                  }
                >
                  <span className="size-2 rounded-full" style={{ background: visual.solid }} />
                  {visual.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Streams count selector */}
        {ready && !isSingleStreamOnly && (
          <div className="flex items-center gap-3">
            <div className={labelClass}>Streams</div>
            <ToggleGroup
              value={[String(streamsChoice)]}
              onValueChange={(values) => {
                if (values.length === 0) return
                setStreamsChoice(values[0] === 'auto' ? 'auto' : Number(values[0]))
              }}
              variant="pill"
              size="xs"
              spacing={1}
            >
              {STREAMS_CHOICES.map((choice) => (
                <ToggleGroupItem key={choice} value={String(choice)} className="h-6 min-w-6 px-2">
                  {choice === 'auto' ? 'Auto' : choice}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="font-mono text-[11px] text-muted-foreground">per network</div>
          </div>
        )}

        {startError && (
          <div className="text-[12px] text-destructive">{startError}</div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t-[0.5px] border-border px-4 py-2.5">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canStart}>
          {startLabel}
        </Button>
      </div>
    </form>
  )
}
