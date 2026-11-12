/// <reference types="vite/client" />
import type { VisorApi } from '../preload/index'

declare global {
  interface Window {
    visor: VisorApi
  }
}

export {}
