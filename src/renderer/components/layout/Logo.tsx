import type { ReactElement } from 'react'
import { cn } from '@/lib/cn'

/**
 * The Harborlight mark: a lighthouse beam over a harbour, in the brand orange
 * gradient. Drawn inline so it stays crisp at any size and needs no network.
 */
export function LogoMark({ className }: { className?: string }): ReactElement {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('size-7', className)}
      role="img"
      aria-label="Harborlight"
    >
      <defs>
        <linearGradient id="hl-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF8A3D" />
          <stop offset="55%" stopColor="#F04E23" />
          <stop offset="100%" stopColor="#D8341A" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#hl-mark)" />
      <path
        d="M16 6.4c1.9 0 3.4 1.5 3.4 3.4v1.1h-6.8V9.8c0-1.9 1.5-3.4 3.4-3.4Z"
        fill="#fff"
        fillOpacity="0.95"
      />
      <path
        d="M12.3 12.4h7.4l1.5 12.9a.7.7 0 0 1-.7.8h-9a.7.7 0 0 1-.7-.8l1.5-12.9Z"
        fill="#fff"
        fillOpacity="0.92"
      />
      <path d="M13.9 16.2h4.2l.3 3h-4.8l.3-3Z" fill="#F04E23" fillOpacity="0.85" />
      <path
        d="M9.4 9.6 6 8.1M22.6 9.6 26 8.1"
        stroke="#fff"
        strokeOpacity="0.7"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LogoWordmark({ compact = false }: { compact?: boolean }): ReactElement {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark className={compact ? 'size-6' : 'size-7'} />
      <span
        className={cn(
          'font-semibold tracking-tight text-ink',
          compact ? 'text-[13px]' : 'text-[15px]'
        )}
      >
        Harborlight
      </span>
    </div>
  )
}
