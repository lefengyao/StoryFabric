import type { CSSProperties } from 'react'

/** Keep modal centering on the legacy transform path used by Android WebView 83. */
export const legacyModalPositionStyle: CSSProperties = {
  transform: 'translate(-50%, -50%)',
  translate: 'none'
}
