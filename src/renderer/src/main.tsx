import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { bootstrapFlexo, flexoApi } from '../../bridge/flexoApi'
import { ACTIVE_CONCEPT } from './theme'

async function main(): Promise<void> {
  await bootstrapFlexo()
  window.flexo = flexoApi
  document.documentElement.dataset.concept = ACTIVE_CONCEPT
  document.documentElement.dataset.theme = flexoApi.initialState.themeSource

  let isTray = false
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    isTray = getCurrentWebviewWindow().label === 'tray-popover'
  } catch {
    // browser or dev fallback
    isTray =
      window.location.search.includes('window=tray') ||
      window.location.hash.includes('tray') ||
      window.location.pathname.includes('tray')
  }

  if (isTray) {
    const { TrayPopoverScreen } = await import('./screens/TrayPopoverScreen')
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <TrayPopoverScreen />
      </StrictMode>
    )
    return
  }

  const { default: App } = await import('./App')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void main()
