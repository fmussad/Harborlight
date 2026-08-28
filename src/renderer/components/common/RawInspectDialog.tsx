import { type ReactElement } from 'react'
import { Copy } from 'lucide-react'
import { Button, Skeleton } from '@/components/ui/primitives'
import { Dialog } from '@/components/ui/overlays'
import { useToast } from '@/providers/ToastProvider'

/** Read-only viewer for the raw Docker inspect payload of any resource. */
export function RawInspectDialog({
  title,
  raw,
  loading,
  error,
  onClose
}: {
  title: string | null
  raw: string | null
  loading: boolean
  error: string | null
  onClose(): void
}): ReactElement {
  const { toast } = useToast()

  return (
    <Dialog
      open={title !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      width="xl"
      title={`Inspect ${title ?? ''}`}
      footer={
        <>
          <Button
            variant="secondary"
            icon={<Copy className="size-3.5" />}
            disabled={!raw}
            onClick={() => {
              if (!raw) return
              void navigator.clipboard.writeText(raw)
              toast({ level: 'success', title: 'Copied to clipboard' })
            }}
          >
            Copy JSON
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {error ? (
        <p className="selectable text-xs text-danger-fg">{error}</p>
      ) : loading || !raw ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <pre className="selectable hl-scroll max-h-[55vh] rounded-control border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink-secondary">
          {raw}
        </pre>
      )}
    </Dialog>
  )
}
