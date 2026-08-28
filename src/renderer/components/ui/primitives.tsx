import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes
} from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerSoft' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-fg hover:bg-brand-hover shadow-sm disabled:bg-brand/50',
  secondary:
    'bg-surface text-ink border border-line hover:bg-surface-2 hover:border-line-strong disabled:text-ink-muted',
  ghost: 'text-ink-secondary hover:bg-surface-2 hover:text-ink',
  danger: 'bg-danger text-white hover:brightness-110 shadow-sm',
  dangerSoft: 'bg-danger-soft text-danger-fg border border-danger-line hover:brightness-105',
  subtle: 'bg-surface-2 text-ink border border-transparent hover:border-line'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-control',
  lg: 'h-10 px-4 text-sm gap-2 rounded-control',
  icon: 'h-8 w-8 justify-center rounded-control'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    children,
    disabled,
    ...props
  },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center font-medium transition-colors select-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
})

/* ------------------------------------------------------------------- Card */

export function Card({
  className,
  children,
  ...props
}: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div className={cn('hl-card', className)} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  actions,
  className
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}): ReactElement {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ Badge */

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent' | 'teal' | 'brand'

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-ink-secondary border-line',
  success: 'bg-success-soft text-success-fg border-success-line',
  warning: 'bg-warning-soft text-warning-fg border-warning-line',
  danger: 'bg-danger-soft text-danger-fg border-danger-line',
  accent: 'bg-accent-soft text-accent border-transparent',
  teal: 'bg-teal-soft text-teal border-transparent',
  brand: 'bg-brand-soft text-brand border-transparent'
}

export function Badge({
  tone = 'neutral',
  children,
  className,
  dot = false
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  dot?: boolean
}): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap',
        BADGE_TONES[tone],
        className
      )}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ Input */

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
  suffix?: ReactNode
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, icon, suffix, wrapperClassName, ...props },
  ref
) {
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-2 rounded-control border border-line bg-surface px-2.5',
        'focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20',
        wrapperClassName
      )}
    >
      {icon ? <span className="shrink-0 text-ink-muted">{icon}</span> : null}
      <input
        ref={ref}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted',
          className
        )}
        {...props}
      />
      {suffix}
    </div>
  )
})

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactElement {
  return (
    <textarea
      className={cn(
        'w-full rounded-control border border-line bg-surface px-2.5 py-2 font-mono text-xs text-ink outline-none',
        'focus:border-brand focus:ring-2 focus:ring-brand/20 placeholder:text-ink-muted',
        className
      )}
      {...props}
    />
  )
}

/* ----------------------------------------------------------------- Select */

export interface SelectOption {
  value: string
  label: string
}

export function Select({
  value,
  onChange,
  options,
  className,
  ariaLabel
}: {
  value: string
  onChange(value: string): void
  options: SelectOption[]
  className?: string
  ariaLabel?: string
}): ReactElement {
  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-8 w-full appearance-none rounded-control border border-line bg-surface pr-7 pl-2.5',
          'text-[13px] text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20'
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-muted"
        aria-hidden
      />
    </div>
  )
}

/* --------------------------------------------------------------- Checkbox */

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
  className
}: {
  checked: boolean
  onCheckedChange(checked: boolean): void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}): ReactElement {
  const control = (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded border transition-colors',
        checked ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface',
        disabled && 'opacity-50'
      )}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-3" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )

  if (!label) return <div className={className}>{control}</div>

  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5',
        disabled && 'cursor-not-allowed',
        className
      )}
    >
      <span className="mt-0.5">{control}</span>
      <span className="min-w-0">
        <span className="block text-[13px] text-ink">{label}</span>
        {description ? <span className="block text-xs text-ink-muted">{description}</span> : null}
      </span>
    </label>
  )
}

/* ----------------------------------------------------------------- Switch */

export function Switch({
  checked,
  onCheckedChange,
  ariaLabel,
  disabled
}: {
  checked: boolean
  onCheckedChange(checked: boolean): void
  ariaLabel: string
  disabled?: boolean
}): ReactElement {
  return (
    <SwitchPrimitive.Root
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-line-strong',
        disabled && 'opacity-50'
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform',
          checked && 'translate-x-[18px]'
        )}
      />
    </SwitchPrimitive.Root>
  )
}

/* ---------------------------------------------------------------- Tooltip */

export function TooltipProvider({ children }: { children: ReactNode }): ReactElement {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export function Tooltip({
  content,
  children,
  side = 'bottom'
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}): ReactElement {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink shadow-pop"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/* ------------------------------------------------------------ Misc pieces */

export function Spinner({ className }: { className?: string }): ReactElement {
  return <Loader2 className={cn('size-4 animate-spin text-ink-muted', className)} aria-hidden />
}

export function Kbd({ children }: { children: ReactNode }): ReactElement {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-muted">
      {children}
    </kbd>
  )
}

export function ProgressBar({
  value,
  tone = 'brand',
  className
}: {
  value: number | null
  tone?: 'brand' | 'accent' | 'success'
  className?: string
}): ReactElement {
  const tones = { brand: 'bg-brand', accent: 'bg-accent', success: 'bg-success' }
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-300',
          tones[tone],
          value === null && 'w-1/3 animate-pulse'
        )}
        style={value === null ? undefined : { width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}): ReactElement {
  return (
    <div
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      {icon ? (
        <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-xs text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }): ReactElement {
  return <div className={cn('animate-pulse rounded bg-surface-3', className)} />
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel
}: {
  value: T
  onChange(value: T): void
  options: { value: T; label: ReactNode; title?: string }[]
  ariaLabel: string
}): ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-0.5 rounded-control border border-line bg-surface-2 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex h-6 items-center gap-1.5 rounded-[6px] px-2 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-surface text-ink shadow-sm'
              : 'text-ink-muted hover:text-ink-secondary'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
