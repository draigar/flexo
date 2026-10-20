import type { MediaCandidate } from '@shared/types'
import { Download, Film, Layers, Play, ShieldAlert, Sparkles, X } from 'lucide-react'
import { Button } from './ui/button'
import { useAppStore } from '../store/useAppStore'
import { formatBytes } from '../utils/format'

export function MediaCandidateSheet({
  onPick
}: {
  onPick: (candidate: MediaCandidate) => void
}): React.JSX.Element | null {
  const candidates = useAppStore((store) => store.mediaCandidates)
  const clearMediaCandidates = useAppStore((store) => store.clearMediaCandidates)

  if (candidates.length === 0) return null

  // Sort candidates by totalBytes descending, or title
  const sorted = [...candidates].sort((a, b) => {
    if (a.totalBytes && b.totalBytes) return b.totalBytes - a.totalBytes
    return 0
  })

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 p-4 shadow-2xl backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-foreground font-semibold uppercase">
          <div className="flex size-5 items-center justify-center rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
            <Film className="size-3" />
          </div>
          <span>Video Streams & Qualities Detected</span>
          <span className="rounded-full bg-muted px-1.5 py-0.2 text-[9px] font-mono text-muted-foreground border border-border">
            {candidates.length} {candidates.length === 1 ? 'stream' : 'options'}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={clearMediaCandidates}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5 mr-1" />
          Dismiss
        </Button>
      </div>

      <div className="grid max-h-56 grid-cols-1 md:grid-cols-2 gap-2 overflow-y-auto pr-1">
        {sorted.map((candidate) => {
          const isAdaptive = candidate.kind === 'hls' || candidate.kind === 'dash'
          const qualityBadge = candidate.quality || (isAdaptive ? candidate.kind.toUpperCase() : 'Standard')

          return (
            <button
              key={candidate.id}
              type="button"
              disabled={candidate.drm}
              onClick={() => onPick(candidate)}
              className="group flex items-center justify-between gap-3 rounded-[9px] border border-border bg-card/60 p-2.5 text-left transition hover:border-emerald-500/40 hover:bg-emerald-500/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-emerald-400 border border-emerald-500/25">
                    {qualityBadge}
                  </span>
                  <div className="truncate font-mono text-[12px] text-foreground font-medium">
                    {candidate.title || candidate.url.split('/').pop()?.split('?')[0] || 'Video Stream'}
                  </div>
                </div>

                <div className="mt-1 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                  <span className="uppercase">{candidate.kind}</span>
                  {candidate.mimeType && <span>· {candidate.mimeType}</span>}
                  {candidate.totalBytes != null && (
                    <span className="text-foreground font-medium">
                      · {formatBytes(candidate.totalBytes)}
                    </span>
                  )}
                </div>

                {candidate.drm && (
                  <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-[var(--color-warning-text)]">
                    <ShieldAlert className="size-3" />
                    {candidate.unsupportedReason || 'DRM protected — cannot download'}
                  </div>
                )}
              </div>

              {!candidate.drm && (
                <div className="flex shrink-0 items-center justify-center rounded-md bg-secondary p-1.5 text-muted-foreground group-hover:bg-emerald-500 group-hover:text-black transition-colors">
                  <Download className="size-3.5" />
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
