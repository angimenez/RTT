import type { RttApi } from '../shared/types'

declare global {
  interface Window { rtt: RttApi }
}

declare module '*.css'
