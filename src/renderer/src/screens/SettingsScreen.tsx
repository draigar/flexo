import { PRESET_SEGMENT_MB, PRESET_STREAMS } from '@shared/plan'
import type { SegmentPreset, ThemeSource } from '@shared/types'
import { cn } from 'cn'
import { PageFrame } from '../components/PageFrame'
import { Button } from '../components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import { useAppStore } from '../store/useAppStore'
import { describeError, toDisplayPath } from '../utils/format'

const sectionLabelClass = 'font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase'

function SettingRow({
  title,
  detail,
  children
}: {
  title: string
  detail: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[9px] border border-border px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function OnOff({
  on,
  label,
  onChange
}: {
  on: boolean
  label: string
  onChange: (next: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        'h-6 min-w-12 rounded-md border px-2 font-mono text-[10px] font-semibold tracking-wide uppercase',
        on
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-muted text-[var(--text-secondary)]'
      )}
    >
      {on ? 'On' : 'Off'}
    </button>
  )
}

export function SettingsScreen(): React.JSX.Element {
  const homeDir = useAppStore((store) => store.homeDir)
  const destinationDir = useAppStore((store) => store.destinationDir)
  const setDestinationDir = useAppStore((store) => store.setDestinationDir)
  const streamsPerNetwork = useAppStore((store) => store.streamsPerNetwork)
  const setStreamsPerNetwork = useAppStore((store) => store.setStreamsPerNetwork)
  const segmentPreset = useAppStore((store) => store.segmentPreset)
  const setSegmentPreset = useAppStore((store) => store.setSegmentPreset)
  const themeSource = useAppStore((store) => store.themeSource)
  const setThemeSource = useAppStore((store) => store.setThemeSource)
  const autoDownload = useAppStore((store) => store.autoDownload)
  const setAutoDownload = useAppStore((store) => store.setAutoDownload)
  const watchClipboard = useAppStore((store) => store.watchClipboard)
  const setWatchClipboard = useAppStore((store) => store.setWatchClipboard)

  const browse = async (): Promise<void> => {
    const chosen = await window.flexo.chooseDestinationFolder(destinationDir)
    if (chosen) setDestinationDir(chosen)
  }

  const revealExtension = async (): Promise<void> => {
    try {
      await window.flexo.revealCaptureExtension()
    } catch (error) {
      useAppStore.getState().setCaptureError(describeError(error))
    }
  }

  return (
    <PageFrame title="Settings">
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h2 className={sectionLabelClass}>Capture</h2>
          <SettingRow
            title="Auto-download"
            detail="When a browser download or Flexo link arrives, start it immediately. Off leaves the link ready for Start."
          >
            <OnOff on={autoDownload} label="Auto-download" onChange={setAutoDownload} />
          </SettingRow>
          <SettingRow
            title="Clipboard links"
            detail="When you copy an http, https, or magnet link, put it in the link field."
          >
            <OnOff on={watchClipboard} label="Clipboard links" onChange={setWatchClipboard} />
          </SettingRow>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={sectionLabelClass}>Transfers</h2>
          <SettingRow
            title="Download folder"
            detail={toDisplayPath(destinationDir, homeDir) || 'Choose a folder'}
          >
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => void browse()}
              className="font-mono text-[10px] tracking-wide uppercase"
            >
              Browse
            </Button>
          </SettingRow>
          <div className="flex flex-col gap-2 rounded-[9px] border border-border px-3 py-2.5">
            <div className="text-[13px] font-medium text-foreground">Parallel streams</div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Connections opened on each selected network. A server that cannot serve ranges still
              uses one stream.
            </p>
            <ToggleGroup
              value={[String(streamsPerNetwork)]}
              onValueChange={(values) => {
                if (values.length === 0) return
                setStreamsPerNetwork(Number(values[0]))
              }}
              variant="pill"
              size="xs"
              spacing={1}
              aria-label="Parallel streams per network"
            >
              {PRESET_STREAMS.map((preset) => (
                <ToggleGroupItem key={preset} value={String(preset)} className="h-6 min-w-6">
                  {preset}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-2 rounded-[9px] border border-border px-3 py-2.5">
            <div className="text-[13px] font-medium text-foreground">Block size</div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Auto uses 32 MB when the selected networks match, and 8 MB when they differ.
            </p>
            <ToggleGroup
              value={[segmentPreset]}
              onValueChange={(values) => {
                const next = values[0]
                if (next === 'auto' || next === '8' || next === '16' || next === '32' || next === '64') {
                  setSegmentPreset(next)
                }
              }}
              variant="pill"
              size="xs"
              spacing={1}
              aria-label="Block size"
            >
              <ToggleGroupItem value="auto" className="h-6 min-w-6">
                Auto
              </ToggleGroupItem>
              {PRESET_SEGMENT_MB.map((preset) => (
                <ToggleGroupItem key={preset} value={String(preset) as SegmentPreset} className="h-6 min-w-6">
                  {preset}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={sectionLabelClass}>Appearance</h2>
          <SettingRow title="Theme" detail="Light or dark, inside the current palette.">
            <ToggleGroup
              value={[themeSource]}
              onValueChange={(values) => {
                const next = values[0]
                if (next === 'light' || next === 'dark') setThemeSource(next as ThemeSource)
              }}
              variant="pill"
              size="xs"
              spacing={1}
              aria-label="Theme"
            >
              <ToggleGroupItem value="light" className="h-6 min-w-6">
                Light
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="h-6 min-w-6">
                Dark
              </ToggleGroupItem>
            </ToggleGroup>
          </SettingRow>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className={sectionLabelClass}>Browser</h2>
          <SettingRow
            title="Capture extension"
            detail="Load this folder in Chrome or Edge with Developer mode, then Load unpacked. Reload it after an update."
          >
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => void revealExtension()}
              className="font-mono text-[10px] tracking-wide uppercase"
            >
              Show folder
            </Button>
          </SettingRow>
        </section>
      </div>
    </PageFrame>
  )
}
