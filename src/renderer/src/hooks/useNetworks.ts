import { useEffect, useState } from 'react'
import { useAppStore } from '../store/useAppStore'

export function useNetworkEvents(): void {
  const loadInterfaces = useAppStore((store) => store.loadInterfaces)

  useEffect(() => {
    void loadInterfaces()
    const timer = setInterval(() => {
      void loadInterfaces()
    }, 5000)
    return () => clearInterval(timer)
  }, [loadInterfaces])
}

const USAGE_POLL_MS = 2000

export function useNetworkUsage(active: boolean, revision = 0): Record<string, number> {
  const preferences = useAppStore((store) => store.networkPreferences)
  const [usage, setUsage] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!active) return
    // In Flexo, calculate or query network data usage
    setUsage({})
  }, [active, preferences, revision])

  return usage
}
