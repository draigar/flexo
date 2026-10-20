import { useAppStore } from '../store/useAppStore'
import { formatSpeed, formatSpeedLimit } from '../utils/format'

export function useFormatSpeed(): (bytesPerSec: number) => string {
  const unit = useAppStore((store) => store.speedUnit)
  return (bytesPerSec) => formatSpeed(bytesPerSec, unit)
}

export function useFormatSpeedLimit(): (bytesPerSec: number) => string {
  const unit = useAppStore((store) => store.speedUnit)
  return (bytesPerSec) => formatSpeedLimit(bytesPerSec, unit)
}
