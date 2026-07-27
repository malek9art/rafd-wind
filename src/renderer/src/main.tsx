import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// خط IBM Plex Sans Arabic مضمَّن محليًا داخل الحزمة — لا استدعاء شبكي إطلاقًا (§18.3)
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
