import React from 'react'
import flatLogoUrl from '../../../../../storyfabric-logo-flat.svg'
import monoLogoUrl from '../../../../../storyfabric-logo-mono.svg'

export type BrandMarkProps = {
  variant: 'flat' | 'mono'
  size?: number
  className?: string
  style?: React.CSSProperties
  'aria-label'?: string
}

const DEFAULT_SIZE = 36
const DEFAULT_LABEL = '织章 StoryFabric'

export function BrandMark({
  variant,
  size = DEFAULT_SIZE,
  className,
  style,
  'aria-label': ariaLabel = DEFAULT_LABEL
}: BrandMarkProps): React.ReactElement {
  if (variant === 'flat') {
    return (
      <img
        src={flatLogoUrl}
        width={size}
        height={size}
        className={className}
        style={style}
        role="img"
        alt={ariaLabel}
        aria-label={ariaLabel}
      />
    )
  }

  return (
    <span
      className={className}
      role="img"
      aria-label={ariaLabel}
      style={{
        ...style,
        width: size,
        height: size,
        display: 'inline-block',
        backgroundColor: 'currentColor',
        maskImage: `url(${monoLogoUrl})`,
        WebkitMaskImage: `url(${monoLogoUrl})`,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskSize: 'contain'
      }}
    />
  )
}
