import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  FolderOpen,
  Hammer,
  Play,
  Save,
  Square,
  Terminal,
  WandSparkles,
  X
} from 'lucide-react'
import type { ComposeProject, ComposeValidation } from '@shared/schemas/domain'
import type { ComposeCommandPreview } from '@shared/contracts/responses'
import { composeProjectFromYaml, parseComposeYaml } from '@shared/compose/parse'
import { cn } from '@/lib/cn'
import { invoke, subscribe } from '@/lib/bridge'
import { queryKeys, useComposeProjects } from '@/lib/queries'
import { Badge, Button, EmptyState, Select, Spinner } from '@/components/ui/primitives'
import { Dialog, DropdownMenu, Tabs } from '@/components/ui/overlays'
import { YamlEditor, type CursorPosition } from '@/components/compose/YamlEditor'
import { TopologyGraph } from '@/components/compose/TopologyGraph'
import { useToast } from '@/providers/ToastProvider'

type ComposeAction = 'up' | 'down' | 'start' | 'stop' | 'restart' | 'pull' | 'build' | 'rebuild'

interface OpenFile {
  path: string
  content: string
  project: ComposeProject
}

interface OutputLine {
  key: number
  stream: 'stdout' | 'stderr'
  text: string
}

/** Whitespace-only normalisation; the document structure is never rewritten. */
function normalizeWhitespace(content: string): string {
  const normalized = content
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\t/g, '  ').replace(/[ \t]+$/, ''))
    .join('\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

function ProblemList({ validation }: { validation: ComposeValidation }): ReactElement {
  return (
    <ul className="space-y-1">
      {validation.problems.map((problem, index) => (
        <li key={index} className="flex items-start gap-2 text-xs">
          <AlertTriangle
            className={cn(
              'mt-0.5 size-3.5 shrink-0',
              problem.severity === 'error' ? 'text-danger' : 'text-warning'
            )}
            aria-hidden
          />
          <span className="selectable text-ink-secondary">
            {problem.line ? (
              <span className="font-mono text-ink-muted">line {problem.line}: </span>
            ) : null}
            {problem.message}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ComposePage(): ReactElement {
  const client = useQueryClient()
  const { toast, toastError } = useToast()
  const { data: discovered = [], isLoading } = useComposeProjects()

  const [file, setFile] = useState<OpenFile | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [validation, setValidation] = useState<ComposeValidation | null>(null)
  const [validating, setValidating] = useState(false)
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 })
  const [rightTab, setRightTab] = useState('topology')
  const [preview, setPreview] = useState<{
    action: ComposeAction
    command: ComposeCommandPreview
  } | null>(null)
  const [operationId, setOperationId] = useState<string | null>(null)
  const [output, setOutput] = useState<OutputLine[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  const lineCounter = useRef(0)

  // Live topology reflects what is in the editor, not the last saved file.
  const localProject = useMemo(() => {
    if (!file) return null
    const parsed = parseComposeYaml(content)
    if (!parsed.data) return file.project
    const project = composeProjectFromYaml(parsed.data, {
      name: file.project.name,
      workingDir: file.project.workingDir,
      configFiles: file.project.configFiles
    })
    // Keep the runtime state discovered from Docker for services that still exist.
    return {
      ...project,
      running: file.project.running,
      services: project.services.map((service) => {
        const known = file.project.services.find((entry) => entry.name === service.name)
        return known
          ? { ...service, state: known.state, health: known.health, containers: known.containers }
          : service
      })
    }
  }, [content, file])

  useEffect(() => {
    if (!operationId) return undefined
    return subscribe((event) => {
      if (event.type === 'compose:output' && event.payload.operationId === operationId) {
        const lines = event.payload.data.split('\n').filter((line) => line.length > 0)
        setOutput((current) => [
          ...current,
          ...lines.map((text) => ({
            key: ++lineCounter.current,
            stream: event.payload.stream,
            text
          }))
        ])
      } else if (event.type === 'compose:exit' && event.payload.operationId === operationId) {
        setOutput((current) => [
          ...current,
          { key: ++lineCounter.current, stream: 'stdout', text: event.payload.message }
        ])
        setOperationId(null)
        void client.invalidateQueries({ queryKey: queryKeys.compose })
        void client.invalidateQueries({ queryKey: queryKeys.containers })
        toast({
          level: event.payload.exitCode === 0 ? 'success' : 'error',
          title: event.payload.exitCode === 0 ? 'Compose finished' : 'Compose failed',
          message: event.payload.message
        })
      }
    })
  }, [client, operationId, toast])

  useEffect(() => {
    const node = outputRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [output])

  const openProject = useCallback(
    async (project: ComposeProject): Promise<void> => {
      const path = project.configFiles[0]
      if (!path) {
        toast({
          level: 'warning',
          title: `${project.name} has no Compose file on disk`,
          message: 'The stack is running, but its configuration file is not reachable from here.'
        })
        return
      }
      try {
        const result = await invoke('compose.openFile', { path })
        setFile({
          path: result.path,
          content: result.content,
          project: { ...result.project, ...project }
        })
        setContent(result.content)
        setDirty(false)
        setValidation(null)
      } catch (error) {
        toastError(error, `Could not open ${path}`)
      }
    },
    [toast, toastError]
  )

  const pickFile = async (): Promise<void> => {
    try {
      const picked = await invoke('system.pickComposeFile')
      if (picked.cancelled || !picked.path) return
      const result = await invoke('compose.openFile', { path: picked.path })
      setFile(result)
      setContent(result.content)
      setDirty(false)
      setValidation(null)
    } catch (error) {
      toastError(error, 'Could not open the Compose file')
    }
  }

  const validate = async (): Promise<ComposeValidation | null> => {
    if (!file) return null
    setValidating(true)
    try {
      const result = await invoke('compose.validate', {
        projectName: file.project.name,
        workingDir: file.project.workingDir ?? file.path.slice(0, file.path.lastIndexOf('/')),
        files: [file.path],
        content: dirty ? content : null
      })
      setValidation(result)
      return result
    } catch (error) {
      toastError(error, 'Validation failed')
      return null
    } finally {
      setValidating(false)
    }
  }

  const save = async (): Promise<void> => {
    if (!file) return
    try {
      await invoke('compose.saveFile', { path: file.path, content, confirmed: true })
      setFile({ ...file, content })
      setDirty(false)
      toast({ level: 'success', title: 'Compose file saved', message: file.path })
    } catch (error) {
      toastError(error, 'Could not save the file')
    }
  }

  const requestAction = async (action: ComposeAction): Promise<void> => {
    if (!file) return
    try {
      const command = await invoke('compose.preview', {
        action,
        projectName: file.project.name,
        workingDir: file.project.workingDir ?? file.path.slice(0, file.path.lastIndexOf('/')),
        files: [file.path],
        services: [],
        detach: true,
        removeVolumes: false,
        removeOrphans: false,
        noCache: action === 'rebuild'
      })
      setPreview({ action, command })
    } catch (error) {
      toastError(error, 'Could not prepare the command')
    }
  }

  const runAction = async (): Promise<void> => {
    if (!file || !preview) return
    const { action } = preview
    setPreview(null)
    setOutput([])
    setConsoleOpen(true)
    try {
      const result = await invoke('compose.action', {
        action,
        projectName: file.project.name,
        workingDir: file.project.workingDir ?? file.path.slice(0, file.path.lastIndexOf('/')),
        files: [file.path],
        services: [],
        detach: true,
        removeVolumes: false,
        removeOrphans: false,
        noCache: action === 'rebuild',
        confirmedDestructive: preview.command.destructive
      })
      setOperationId(result.operationId)
    } catch (error) {
      toastError(error, `docker compose ${action} failed to start`)
    }
  }

  const projectOptions = useMemo(
    () => [
      ...(file && !discovered.some((project) => project.name === file.project.name)
        ? [{ value: file.project.name, label: `${file.project.name} (opened)` }]
        : []),
      ...discovered.map((project) => ({
        value: project.name,
        label: `${project.name} · ${project.running}/${project.total} running`
      }))
    ],
    [discovered, file]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <h1 className="text-sm font-semibold text-ink">Compose Studio</h1>

        <Select
          ariaLabel="Compose project"
          className="w-64"
          value={file?.project.name ?? ''}
          onChange={(value) => {
            const project = discovered.find((entry) => entry.name === value)
            if (project) void openProject(project)
          }}
          options={
            projectOptions.length > 0
              ? projectOptions
              : [{ value: '', label: isLoading ? 'Looking for projects…' : 'No projects found' }]
          }
        />

        <Button
          variant="secondary"
          icon={<FolderOpen className="size-3.5" />}
          onClick={() => void pickFile()}
        >
          Open file…
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={!file}
            icon={<WandSparkles className="size-3.5" />}
            onClick={() => {
              const next = normalizeWhitespace(content)
              if (next !== content) {
                setContent(next)
                setDirty(true)
              }
            }}
          >
            Format
          </Button>
          <Button
            variant="secondary"
            disabled={!file}
            loading={validating}
            icon={<CheckCircle2 className="size-3.5" />}
            onClick={() => void validate()}
          >
            Validate
          </Button>
          <Button
            variant="secondary"
            disabled={!file || operationId !== null}
            icon={<Play className="size-3.5" />}
            onClick={() => void requestAction('up')}
          >
            Up
          </Button>
          <DropdownMenu
            items={[
              {
                label: 'Stop services',
                icon: <Square className="size-3.5" />,
                onSelect: () => void requestAction('stop')
              },
              {
                label: 'Restart services',
                icon: <ArrowDownUp className="size-3.5" />,
                onSelect: () => void requestAction('restart')
              },
              {
                label: 'Pull images',
                icon: <ArrowDownUp className="size-3.5" />,
                onSelect: () => void requestAction('pull')
              },
              {
                label: 'Build',
                icon: <Hammer className="size-3.5" />,
                onSelect: () => void requestAction('build')
              },
              {
                label: 'Rebuild without cache',
                icon: <Hammer className="size-3.5" />,
                onSelect: () => void requestAction('rebuild')
              },
              {
                label: 'Down (remove containers)',
                icon: <X className="size-3.5" />,
                destructive: true,
                separatorBefore: true,
                onSelect: () => void requestAction('down')
              }
            ]}
            trigger={
              <Button variant="secondary" disabled={!file || operationId !== null}>
                Actions
                <ChevronDown className="size-3.5" />
              </Button>
            }
          />
          <Button
            variant="primary"
            disabled={!file || !dirty}
            icon={<Save className="size-3.5" />}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </div>

      {!file ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={<FileCode2 className="size-5" />}
            title={discovered.length > 0 ? 'Pick a project to edit' : 'No Compose projects found'}
            description={
              discovered.length > 0
                ? 'Choose a running stack above, or open any compose.yml from disk.'
                : 'Harborlight discovers running stacks from container labels. You can also open a Compose file directly.'
            }
            action={
              <Button
                variant="primary"
                size="sm"
                icon={<FolderOpen className="size-3.5" />}
                onClick={() => void pickFile()}
              >
                Open a Compose file
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
          <div className="flex min-h-0 flex-col border-r border-line">
            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <FileCode2 className="size-3.5 text-ink-muted" aria-hidden />
                {file.path.split('/').pop()}
              </span>
              {dirty ? <Badge tone="warning">unsaved</Badge> : null}
              <span className="truncate font-mono text-[11px] text-ink-muted">{file.path}</span>
            </div>

            <div className="min-h-0 flex-1">
              <YamlEditor
                value={content}
                onChange={(next) => {
                  setContent(next)
                  setDirty(next !== file.content)
                }}
                validation={validation}
                onCursorChange={setCursor}
              />
            </div>

            <div className="flex shrink-0 items-center gap-4 border-t border-line bg-surface px-3 py-1 text-[11px] text-ink-muted">
              <span>
                Ln {cursor.line}, Col {cursor.column}
              </span>
              <span>Spaces: 2</span>
              <span>UTF-8</span>
              <span>YAML</span>
              {validation ? (
                <span
                  className={cn(
                    'ml-auto font-medium',
                    validation.valid ? 'text-success-fg' : 'text-danger-fg'
                  )}
                >
                  {validation.valid ? 'Valid' : `${validation.problems.length} problems`}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="shrink-0 border-b border-line bg-surface px-3">
              <Tabs
                size="sm"
                value={rightTab}
                onValueChange={setRightTab}
                tabs={[
                  { value: 'topology', label: 'Topology' },
                  {
                    value: 'problems',
                    label: 'Problems',
                    badge:
                      validation && validation.problems.length > 0 ? (
                        <Badge tone={validation.valid ? 'warning' : 'danger'}>
                          {validation.problems.length}
                        </Badge>
                      ) : null
                  }
                ]}
              />
            </div>

            <div className="min-h-0 flex-1 bg-canvas">
              {rightTab === 'topology' ? (
                <TopologyGraph project={localProject} />
              ) : (
                <div className="hl-scroll h-full p-3">
                  {!validation ? (
                    <p className="py-6 text-center text-xs text-ink-muted">
                      Run Validate to check the file with{' '}
                      <span className="font-mono">docker compose config</span>.
                    </p>
                  ) : validation.problems.length === 0 ? (
                    <p className="flex items-center justify-center gap-1.5 py-6 text-xs text-success-fg">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {validation.message}
                    </p>
                  ) : (
                    <ProblemList validation={validation} />
                  )}
                </div>
              )}
            </div>

            {consoleOpen ? (
              <div className="flex h-56 shrink-0 flex-col border-t border-line">
                <div className="flex shrink-0 items-center gap-2 bg-surface px-3 py-1.5">
                  <Terminal className="size-3.5 text-ink-muted" aria-hidden />
                  <span className="text-xs font-medium text-ink">Compose output</span>
                  {operationId ? <Spinner className="size-3" /> : null}
                  <div className="ml-auto flex items-center gap-1.5">
                    {operationId ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void invoke('compose.cancel', { operationId }).catch((error) =>
                            toastError(error, 'Could not cancel')
                          )
                        }
                      >
                        Cancel
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Close output"
                      onClick={() => setConsoleOpen(false)}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <div
                  ref={outputRef}
                  className="hl-scroll min-h-0 flex-1 bg-canvas px-3 py-2 font-mono text-[11px]"
                >
                  {output.map((line) => (
                    <p
                      key={line.key}
                      className={cn(
                        'selectable break-all whitespace-pre-wrap',
                        line.stream === 'stderr' ? 'text-danger-fg' : 'text-ink-secondary'
                      )}
                    >
                      {line.text}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null)
        }}
        title={`Run docker compose ${preview?.action ?? ''}`}
        description="Harborlight shows the exact command it will execute. Nothing runs through a shell."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              variant={preview?.command.destructive ? 'danger' : 'primary'}
              onClick={() => void runAction()}
            >
              {preview?.command.destructive ? 'Run anyway' : 'Run command'}
            </Button>
          </>
        }
      >
        <pre className="selectable rounded-control border border-line bg-canvas p-3 font-mono text-[11px] text-ink-secondary">
          {preview?.command.display}
        </pre>
        <p className="mt-2 text-[11px] text-ink-muted">
          Working directory: <span className="font-mono">{preview?.command.cwd}</span>
        </p>
        {preview?.command.destructive ? (
          <p className="mt-2 flex items-start gap-2 rounded-control border border-danger-line bg-danger-soft p-2 text-[11px] text-danger-fg">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            This removes containers created for the project. Named volumes are kept unless the
            command above includes --volumes.
          </p>
        ) : null}
      </Dialog>
    </div>
  )
}
