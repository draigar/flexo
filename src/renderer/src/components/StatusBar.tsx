import type { SpeedUnit } from '@shared/types'
import { useAppStore } from '../store/useAppStore'
import { formatBytes } from '../utils/format'
import { useFormatSpeedLimit } from '../hooks/useFormatSpeed'
import { useDownloadSchedule } from '../hooks/useDownloadSchedule'
import { ScreenFooter } from './ScreenFooter'
import { ThemeToggle } from './ThemeToggle'
import { Switch } from './ui/switch'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

function SpeedUnitToggle(): React.JSX.Element {
  const speedUnit = useAppStore((store) => store.speedUnit)
  const setSpeedUnit = useAppStore((store) => store.setSpeedUnit)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToggleGroup
            aria-label="Speed units"
            value={[speedUnit]}
            onValueChange={(values) => {
              if (values[0] !== undefined) setSpeedUnit(values[0] as SpeedUnit)
            }}
            size="xs"
            spacing={0.5}
            className="h-[26px] rounded-[6px] border-[0.5px] border-border p-0.5 [-webkit-app-region:no-drag]"
          >
            {(['bytes', 'bits'] as const).map((unit) => (
              <ToggleGroupItem
                key={unit}
                value={unit}
                className="h-full rounded-[4px] px-1.5 font-mono text-[11px] font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground"
              >
                {unit === 'bytes' ? 'MB/s' : 'Mbps'}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <TooltipContent>Speed units</TooltipContent>
    </Tooltip>
  )
}

export function StatusBar(): React.JSX.Element {
  const formatSpeedLimit = useFormatSpeedLimit()
  const { message } = useDownloadSchedule()
  const waiting = useAppStore(
    (store) =>
      Object.values(store.downloads).filter((download) => download.status === 'queued').length
  )
  const slowMode = useAppStore((store) => store.slowMode)
  const slowModeSpeed = useAppStore((store) => store.slowModeSpeed)
  const setSlowMode = useAppStore((store) => store.setSlowMode)

  const status = [
    waiting > 0 && `${waiting} waiting in queue`
  ].filter(Boolean)

  return (
    <ScreenFooter className="gap-4 font-mono text-[11.5px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate tabular-nums">{status.join(' · ')}</span>
      {message && <span className="truncate">{message}</span>}
      <div className="flex shrink-0 items-center gap-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <label className="flex items-center gap-2 cursor-pointer">
                Slow mode
                <Switch checked={slowMode} onCheckedChange={setSlowMode} />
              </label>
            }
          />
          <TooltipContent>Limit downloads to {formatSpeedLimit(slowModeSpeed)}</TooltipContent>
        </Tooltip>
        <SpeedUnitToggle />
        <ThemeToggle />
      </div>
    </ScreenFooter>
  )
}
