/// <reference types="vite/client" />

import type { RafdLocalApi } from '../../shared/types'

declare global {
  interface Window {
    rafdLocal: RafdLocalApi
  }
}

export {}
