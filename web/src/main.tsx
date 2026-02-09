import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import Bootstrap from './Bootstrap'
import { ToastProvider } from './components/ToastProvider'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <Bootstrap />
    </ToastProvider>
  </StrictMode>,
)
