import { PRESET_SEGMENT_MB, PRESET_STREAMS, planDownload, segmentPresetToBytes } from '@shared/plan'
import type { MediaCandidate, ProbeResult, SegmentPreset } from '@shared/types'
import { cn } from 'cn'
import { AlertTriangle, ClipboardPaste, Film, Info, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MediaCandidateSheet } from '../components/MediaCandidateSheet'
import { NetworkCard } from '../components/NetworkCard'
import { QueueSheet } from '../components/QueueSheet'
import { ScreenFooter } from '../components/ScreenFooter'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import { useNetworkPolling } from '../hooks/useNetworkPolling'
import { useAppStore } from '../store/useAppStore'
import { describeError, formatBytes, toDisplayPath } from '../utils/format'

type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ready'; result: ProbeResult }
  | { status: 'error'; message: string }

const PROBE_DEBOUNCE_MS = 600
const PASTE_SHORTCUT = window.flexo.platform === 'darwin' ? '⌘V' : 'Ctrl+V'

const fieldLabelClass = 'shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground'

function ErrorAlert({ message }: { message: string }): React.JSX.Element {
  return (
    <Alert variant="destructive" className="py-1.5">
      <AlertTriangle />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function WarningAlert({ title, message }: { title?: string; message: string }): React.JSX.Element {
  return (
    <Alert className="border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] py-2 text-[var(--color-warning-text)]">
      <AlertTriangle className="text-[var(--color-warning)]" />
      {title && <AlertTitle className="text-xs font-semibold">{title}</AlertTitle>}
      <AlertDescription className="text-xs leading-relaxed text-[var(--color-warning-text)]">
        {message}
      </AlertDescription>
    </Alert>
  )
}

function InfoAlert({ title, message }: { title?: string; message: string }): React.JSX.Element {
  return (
    <Alert className="border-[var(--color-bridge-border)] bg-[var(--color-bridge-bg)] py-2 text-[var(--color-bridge-text)]">
      <Info className="text-[var(--color-bridge)]" />
      {title && <AlertTitle className="text-xs font-semibold">{title}</AlertTitle>}
      <AlertDescription className="text-xs leading-relaxed text-[var(--color-bridge-text)]">
        {message}
      </AlertDescription>
    </Alert>
  )
}

export function IdleScreen(): React.JSX.Element {
  useNetworkPolling(true)

  const interfaces = useAppStore((store) => store.interfaces)
  const homeDir = useAppStore((store) => store.homeDir)
  const latencies = useAppStore((store) => store.latencies)
  const url = useAppStore((store) => store.draftUrl)
  const setUrl = useAppStore((store) => store.setDraftUrl)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const setDestinationDir = useAppStore((store) => store.setDestinationDir)
  const chunksPerNetwork = useAppStore((store) => store.streamsPerNetwork)
  const setChunksPerNetwork = useAppStore((store) => store.setStreamsPerNetwork)
  const segmentPreset = useAppStore((store) => store.segmentPreset)
  const setSegmentPreset = useAppStore((store) => store.setSegmentPreset)
  const mirrorUrls = useAppStore((store) => store.mirrorUrls)
  const setMirrorUrls = useAppStore((store) => store.setMirrorUrls)

  const [probe, setProbe] = useState<ProbeState>({ status: 'idle' })
  // Tracks deselections rather than selections, so a newly-detected interface starts selected.
  const [deselectedInterfaceIds, setDeselectedInterfaceIds] = useState<string[]>([])
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [fileNameOverride, setFileNameOverride] = useState<string | null>(null)
  const [mirrorDraft, setMirrorDraft] = useState('')
  const [resolvingMedia, setResolvingMedia] = useState(false)

  const probeRequestId = useRef(0)

  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed) {
      // Resetting derived probe state when its trigger (the URL) is cleared.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProbe({ status: 'idle' })
      setFileNameOverride(null)
      return
    }

    const requestId = ++probeRequestId.current
    setProbe({ status: 'probing' })
    setFileNameOverride(null)
    const timer = setTimeout(async () => {
      try {
        const result = await window.flexo.probeUrl(trimmed)
        if (probeRequestId.current !== requestId) return
        setProbe({ status: 'ready', result })
      } catch (error) {
        if (probeRequestId.current !== requestId) return
        setProbe({ status: 'error', message: describeError(error) })
      }
    }, PROBE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [url])

  const ready = probe.status === 'ready' ? probe.result : null
  const multiChunkAllowed = ready !== null && ready.supportsRanges && ready.totalBytes !== null
  const isSingleStreamOnly = ready !== null && !multiChunkAllowed

  const detectedIds = interfaces.map((iface) => iface.id)
  const enabledIds = detectedIds.filter((id) => !deselectedInterfaceIds.includes(id))
  const selectedInterfaceIds = isSingleStreamOnly ? enabledIds.slice(0, 1) : enabledIds

  const connectionsPerNetwork = isSingleStreamOnly ? 1 : chunksPerNetwork
  const selectedKinds = selectedInterfaceIds
    .map((id) => interfaces.find((iface) => iface.id === id)?.kind)
    .filter((kind): kind is NonNullable<typeof kind> => Boolean(kind))
  const maxBlockBytes = segmentPresetToBytes(segmentPreset, selectedKinds)
  // A small file gets fewer streams than asked for — one with no block to claim would only
  // idle — so once the file's size is known the count comes from the same plan the download
  // will use.
  const totalChunks = ready
    ? planDownload({
        totalBytes: ready.totalBytes ?? 0,
        splittable: multiChunkAllowed,
        networkCount: selectedInterfaceIds.length,
        streamsPerNetwork: chunksPerNetwork,
        maxBlockBytes
      }).streamNetworks.length
    : selectedInterfaceIds.length * chunksPerNetwork
  const startLabel = starting ? 'Starting…' : probe.status === 'probing' ? 'Checking…' : 'Start'
  const canStart =
    probe.status === 'ready' &&
    selectedInterfaceIds.length > 0 &&
    Boolean(destinationDir) &&
    !starting
  const footerParts = [
    `${selectedInterfaceIds.length} ${selectedInterfaceIds.length === 1 ? 'network' : 'networks'} selected`
  ]
  if (selectedInterfaceIds.length > 0) {
    footerParts.push(`${totalChunks} ${totalChunks === 1 ? 'stream' : 'parallel streams'}`)
  }
  if (ready && ready.totalBytes !== null) footerParts.push(formatBytes(ready.totalBytes))
  footerParts.push(
    segmentPreset === 'auto'
      ? `auto ${maxBlockBytes / (1024 * 1024)} MB blocks`
      : `${segmentPreset} MB blocks`
  )

  let subnetConflict: { subnet: string; names: string[] } | null = null
  if (selectedInterfaceIds.length > 1) {
    const subnets = new Map<string, string[]>()
    for (const id of selectedInterfaceIds) {
      const iface = interfaces.find((i) => i.id === id)
      const subnet = iface?.addresses.find((address) => address.family === 4)?.subnet
      if (subnet) {
        const names = subnets.get(subnet) ?? []
        names.push(iface.displayName)
        subnets.set(subnet, names)
      }
    }
    for (const [subnet, names] of subnets.entries()) {
      if (names.length > 1) {
        subnetConflict = { subnet, names }
        break
      }
    }
  }

  const handleToggleInterface = (id: string): void => {
    if (isSingleStreamOnly) {
      // Single-stream mode can only download through 1 interface at a time
      setDeselectedInterfaceIds(detectedIds.filter((otherId) => otherId !== id))
      return
    }

    setDeselectedInterfaceIds((prev) => {
      const isCurrentlySelected = !prev.includes(id)
      if (isCurrentlySelected) {
        // Deselecting: keep at least 1 interface selected
        const remainingCount = detectedIds.filter(
          (otherId) => !prev.includes(otherId) && otherId !== id
        ).length
        if (remainingCount === 0) return prev
        return [...prev, id]
      } else {
        return prev.filter((entry) => entry !== id)
      }
    })
  }

  const handleBrowse = async (): Promise<void> => {
    const chosen = await window.flexo.chooseDestinationFolder(destinationDir)
    if (chosen) setDestinationDir(chosen)
  }

  const handlePaste = async (): Promise<void> => {
    const text = await window.flexo.readClipboardText()
    if (text.trim()) setUrl(text.trim())
  }

  const handleStart = async (enqueue = false): Promise<void> => {
    if (probe.status !== 'ready' || !canStart) return
    setStarting(true)
    setStartError(null)
    const request = {
      url: probe.result.finalUrl,
      destinationDir,
      suggestedFileName: fileNameOverride?.trim() || probe.result.suggestedFileName,
      totalBytes: probe.result.totalBytes ?? 0,
      supportsRanges: multiChunkAllowed,
      interfaceIds: selectedInterfaceIds,
      chunkCount: totalChunks,
      connectionsPerNetwork,
      etag: probe.result.etag,
      lastModified: probe.result.lastModified,
      mirrorUrls: mirrorUrls.filter(Boolean),
      maxBlockBytes
    }
    try {
      if (enqueue) {
        await window.flexo.enqueueDownload(request)
        setUrl('')
      } else {
        const id = await window.flexo.startDownload(request)
        if (id) {
          useAppStore.getState().setFocusedDownloadId(id)
          useAppStore.getState().setDraftUrl('')
        }
      }
    } catch (error) {
      setStartError(describeError(error))
    } finally {
      setStarting(false)
    }
  }

  const handleAddMirror = (): void => {
    const next = mirrorDraft.trim()
    if (!next || mirrorUrls.includes(next)) return
    setMirrorUrls([...mirrorUrls, next])
    setMirrorDraft('')
  }

  const handleFindMedia = async (): Promise<void> => {
    const trimmed = url.trim()
    if (!trimmed) return
    setResolvingMedia(true)
    setStartError(null)
    try {
      const candidates = await window.flexo.resolveMedia(trimmed)
      useAppStore.getState().setMediaCandidates(candidates)
    } catch (error) {
      setStartError(describeError(error))
    } finally {
      setResolvingMedia(false)
    }
  }

  const handlePickMedia = async (candidate: MediaCandidate): Promise<void> => {
    if (candidate.drm || selectedInterfaceIds.length === 0) return
    setStarting(true)
    setStartError(null)
    try {
      const id = await window.flexo.startMediaDownload(candidate.id, {
        url: candidate.url,
        destinationDir,
        suggestedFileName: fileNameOverride?.trim() || candidate.title || 'video',
        totalBytes: candidate.totalBytes ?? 0,
        supportsRanges: true,
        interfaceIds: selectedInterfaceIds,
        chunkCount: totalChunks,
        connectionsPerNetwork,
        etag: null,
        lastModified: null,
        maxBlockBytes
      })
      if (id) {
        useAppStore.getState().setFocusedDownloadId(id)
        useAppStore.getState().setDraftUrl('')
      }
      useAppStore.getState().clearMediaCandidates()
    } catch (error) {
      setStartError(describeError(error))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex flex-col gap-[9px] px-5 pt-4 pb-3.5">
        <div className="flex items-center gap-[9px]">
          <div
            className={cn(
              'flex h-9 min-w-0 flex-1 items-center gap-[9px] rounded-[9px] border bg-[var(--input-bg)] px-3',
              probe.status === 'error' ? 'border-destructive' : 'border-input'
            )}
          >
            <div id="idle-link-label" className={fieldLabelClass}>
              LINK
            </div>
            <input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://"
              spellCheck={false}
              aria-labelledby="idle-link-label"
              className="min-w-0 flex-1 rounded-[3px] border-none bg-transparent font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            {url.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setUrl('')}
                className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                title="Clear link"
                aria-label="Clear link"
              >
                <X size={13} />
              </button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={handlePaste}
              className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide"
            >
              <ClipboardPaste data-icon="inline-start" />
              Paste {PASTE_SHORTCUT}
            </Button>
          </div>
          <Button
            type="button"
            onClick={() => void handleStart(false)}
            disabled={!canStart}
            className="h-9 w-28 shrink-0"
          >
            {startLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => void handleFindMedia()}
            disabled={!url.trim() || resolvingMedia}
            className="h-9 shrink-0 font-mono text-[9.5px] uppercase tracking-wide"
          >
            <Film data-icon="inline-start" />
            {resolvingMedia ? 'Media…' : 'Media'}
          </Button>
        </div>

        {probe.status === 'error' && <ErrorAlert message={probe.message} />}

        {isSingleStreamOnly && (
          <InfoAlert
            title="Single-connection mode"
            message="This server does not support parallel range requests (206 Partial Content). The download will run as a single stream through whichever network you choose below."
          />
        )}

        {subnetConflict && (
          <WarningAlert
            title="Same local network detected"
            message={`${subnetConflict.names.join(' and ')} are connected to the same subnet (${subnetConflict.subnet}). The operating system routes all traffic through one connection on the same subnet, so speeds cannot be combined. Connect to distinct networks (e.g. Wi-Fi + phone USB tethering) to combine bandwidth.`}
          />
        )}

        <div
          className={cn(
            'flex h-9 items-center gap-[9px] rounded-[9px] border px-3',
            ready ? 'border-border opacity-100' : 'border-dashed border-border opacity-50'
          )}
        >
          <div id="idle-saveas-label" className={fieldLabelClass}>
            SAVE AS
          </div>
          <input
            type="text"
            value={ready ? (fileNameOverride ?? ready.suggestedFileName) : ''}
            onChange={(event) => setFileNameOverride(event.target.value)}
            disabled={!ready}
            placeholder="—"
            aria-labelledby="idle-saveas-label"
            className="min-w-0 flex-1 rounded-[3px] border-none bg-transparent font-mono text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          {ready && ready.totalBytes !== null && (
            <div className="shrink-0 whitespace-nowrap font-mono text-[11px] font-medium text-muted-foreground">
              {formatBytes(ready.totalBytes)} (est.)
            </div>
          )}
        </div>

        <div className="flex h-9 items-center gap-[9px] rounded-[9px] border border-border px-3">
          <div className={fieldLabelClass}>TO</div>
          <div className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-[var(--text-secondary)]">
            {toDisplayPath(destinationDir, homeDir)}
          </div>
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={handleBrowse}
            className="h-auto shrink-0 px-0 font-mono text-[11px]"
          >
            Browse…
          </Button>
        </div>

        <div className="flex min-h-9 items-center gap-[9px] rounded-[9px] border border-border px-3 py-1.5">
          <div className={fieldLabelClass}>MIRRORS</div>
          <input
            type="url"
            value={mirrorDraft}
            onChange={(event) => setMirrorDraft(event.target.value)}
            placeholder="https://mirror.example/file"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-[3px] border-none bg-transparent font-mono text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <Button type="button" variant="secondary" size="xs" onClick={handleAddMirror}>
            <Plus data-icon="inline-start" />
            Add
          </Button>
        </div>
        {mirrorUrls.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {mirrorUrls.map((mirror) => (
              <button
                key={mirror}
                type="button"
                onClick={() => setMirrorUrls(mirrorUrls.filter((entry) => entry !== mirror))}
                className="max-w-full truncate rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive"
                title="Remove mirror"
              >
                {mirror}
              </button>
            ))}
          </div>
        )}

        <div
          className={cn(
            'flex min-h-9 items-center justify-between gap-3 rounded-[9px] border border-border px-3 py-1.5',
            isSingleStreamOnly && 'opacity-60'
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div id="idle-segment-label" className={fieldLabelClass}>
              SEGMENT
            </div>
            <ToggleGroup
              value={[segmentPreset]}
              onValueChange={(values) => {
                if (values.length === 0) return
                setSegmentPreset(values[0] as SegmentPreset)
              }}
              disabled={isSingleStreamOnly}
              aria-labelledby="idle-segment-label"
              variant="pill"
              size="xs"
              spacing={1}
            >
              <ToggleGroupItem value="auto" className="h-6 min-w-6">
                Auto
              </ToggleGroupItem>
              {PRESET_SEGMENT_MB.map((preset) => (
                <ToggleGroupItem key={preset} value={String(preset)} className="h-6 min-w-6">
                  {preset}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="text-right font-mono text-[11px] text-muted-foreground whitespace-nowrap">
            {maxBlockBytes / (1024 * 1024)} MB max
          </div>
        </div>

        <div
          className={cn(
            'flex min-h-9 items-center justify-between gap-3 rounded-[9px] border border-border px-3 py-1.5',
            isSingleStreamOnly && 'opacity-60'
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <div id="idle-streams-label" className={fieldLabelClass}>
              PARALLEL STREAMS
            </div>
            <ToggleGroup
              value={[String(chunksPerNetwork)]}
              onValueChange={(values) => {
                if (values.length === 0) return
                setChunksPerNetwork(Number(values[0]))
              }}
              disabled={isSingleStreamOnly}
              aria-labelledby="idle-streams-label"
              variant="pill"
              size="xs"
              spacing={1}
            >
              {PRESET_STREAMS.map((preset) => (
                // h-6/min-w-6: WCAG 2.5.8's 24px floor — the xs toggle size is 20px, and this is
                // the primary "how many parallel connections" control.
                <ToggleGroupItem key={preset} value={String(preset)} className="h-6 min-w-6">
                  {preset}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div
            className={cn(
              'text-right font-mono text-[11px] whitespace-nowrap',
              isSingleStreamOnly ? 'text-muted-foreground' : 'text-[var(--text-secondary)]'
            )}
          >
            {isSingleStreamOnly ? (
              '1 stream (server does not support ranges)'
            ) : (
              <>
                <span className="font-semibold text-foreground">{chunksPerNetwork}</span> / network
                {selectedInterfaceIds.length > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold text-foreground">{totalChunks}</span> total
                    parallel {totalChunks === 1 ? 'stream' : 'streams'}
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {startError && <ErrorAlert message={startError} />}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-3.5">
        <div className="flex items-baseline justify-between border-b border-border pb-2">
          <h2 className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            Connected Networks
          </h2>
          <div className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            {interfaces.length} detected · {selectedInterfaceIds.length} selected
          </div>
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-2.5 pt-3">
          {interfaces.map((iface) => (
            <NetworkCard
              key={iface.id}
              iface={iface}
              selected={selectedInterfaceIds.includes(iface.id)}
              latencyMs={latencies[iface.id]}
              onToggle={() => handleToggleInterface(iface.id)}
            />
          ))}
        </div>
      </div>

      <ScreenFooter className="gap-2.5">
        <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
          <div className="font-mono text-[11px] text-muted-foreground">
            {footerParts.join(' · ')}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              title="Reveal the browser extension. In Chrome or Edge, turn on Developer mode and choose Load unpacked."
              onClick={() => {
                void window.flexo.revealCaptureExtension().catch((error) => {
                  setStartError(describeError(error))
                })
              }}
              className="font-mono text-[10px] uppercase tracking-wide"
            >
              Extension
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!canStart}
              onClick={() => void handleStart(true)}
              className="font-mono text-[10px] uppercase tracking-wide"
            >
              Queue
            </Button>
          </div>
        </div>
      </ScreenFooter>
      <QueueSheet />
      <MediaCandidateSheet onPick={(candidate) => void handlePickMedia(candidate)} />
    </div>
  )
}
