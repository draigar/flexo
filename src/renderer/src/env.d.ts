/// <reference types="vite/client" />

import type { FlexoApi } from '../../bridge/flexoApi'

declare module 'csstype' {
  interface Properties {
    WebkitAppRegion?: 'drag' | 'no-drag'
  }
}

declare global {
  interface Window {
    flexo: FlexoApi
  }

  const __APP_VERSION__: string
  const __COMMIT_HASH__: string
  const __BUILD_TIME__: string
}

export {}
