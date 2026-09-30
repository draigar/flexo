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

  const { default: App } = await import('./App')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void main()
