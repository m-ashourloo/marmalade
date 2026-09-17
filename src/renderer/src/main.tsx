// pdfjs must be configured before anything else imports it — see pdf/pdfjs.ts.
import './pdf/pdfjs'
import './styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
)
