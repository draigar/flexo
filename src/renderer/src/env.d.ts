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
}

export {}
