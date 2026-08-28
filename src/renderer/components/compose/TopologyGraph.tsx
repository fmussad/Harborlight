import { useMemo, type ReactElement } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ComposeProject, ComposeService } from '@shared/schemas/domain'
import { cn } from '@/lib/cn'
import { EmptyState } from '@/components/ui/primitives'

type ServiceNodeData = {
  service: ComposeService
}

type ServiceNode = Node<ServiceNodeData, 'service'>

function ServiceNodeView({ data }: NodeProps<ServiceNode>): ReactElement {
  const { service } = data
  const running = service.state === 'running'

  return (
    <div
      className={cn(
        'w-44 rounded-card border bg-surface px-2.5 py-2 shadow-card',
        running ? 'border-success-line' : 'border-line'
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            running ? 'bg-success' : service.state ? 'bg-warning' : 'bg-line-strong'
          )}
        />
        <span className="truncate text-xs font-semibold text-ink">{service.name}</span>
      </div>
      <p
        className="mt-0.5 truncate font-mono text-[10px] text-ink-muted"
        title={service.image ?? undefined}
      >
        {service.image ?? service.build ?? 'build context'}
      </p>
      {service.ports.length > 0 ? (
        <p className="mt-1 truncate font-mono text-[10px] text-accent">{service.ports.join(' ')}</p>
      ) : null}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { service: ServiceNodeView }

/**
 * Lays services out in dependency layers: things nothing depends on sit at the
 * top, their dependencies below. Cycles fall back to a single row.
 */
function layout(services: ComposeService[]): Map<string, { x: number; y: number }> {
  const byName = new Map(services.map((service) => [service.name, service]))
  const depth = new Map<string, number>()

  const resolve = (name: string, seen: Set<string>): number => {
    if (depth.has(name)) return depth.get(name)!
    if (seen.has(name)) return 0
    seen.add(name)
    const service = byName.get(name)
    const dependencies = service?.dependsOn.filter((dependency) => byName.has(dependency)) ?? []
    const value =
      dependencies.length === 0 ? 0 : 1 + Math.max(...dependencies.map((d) => resolve(d, seen)))
    depth.set(name, value)
    return value
  }

  for (const service of services) resolve(service.name, new Set())

  const rows = new Map<number, string[]>()
  for (const service of services) {
    const level = depth.get(service.name) ?? 0
    rows.set(level, [...(rows.get(level) ?? []), service.name])
  }

  const positions = new Map<string, { x: number; y: number }>()
  const maxLevel = Math.max(0, ...rows.keys())
  for (const [level, names] of rows) {
    names.forEach((name, index) => {
      positions.set(name, {
        x: index * 210 + (maxLevel - level) * 20,
        y: (maxLevel - level) * 130
      })
    })
  }
  return positions
}

export function TopologyGraph({ project }: { project: ComposeProject | null }): ReactElement {
  const { nodes, edges } = useMemo(() => {
    if (!project || project.services.length === 0) {
      return { nodes: [] as ServiceNode[], edges: [] as Edge[] }
    }

    const positions = layout(project.services)
    const serviceNodes: ServiceNode[] = project.services.map((service) => ({
      id: service.name,
      type: 'service',
      position: positions.get(service.name) ?? { x: 0, y: 0 },
      data: { service }
    }))

    const serviceEdges: Edge[] = project.services.flatMap((service) =>
      service.dependsOn
        .filter((dependency) => project.services.some((entry) => entry.name === dependency))
        .map((dependency) => ({
          id: `${service.name}->${dependency}`,
          source: service.name,
          target: dependency,
          animated: service.state === 'running',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }
        }))
    )

    return { nodes: serviceNodes, edges: serviceEdges }
  }, [project])

  if (nodes.length === 0) {
    return (
      <EmptyState
        title="Nothing to draw yet"
        description="Define services in the editor and the topology appears here."
      />
    )
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
      minZoom={0.3}
      maxZoom={1.6}
      nodesDraggable
      nodesConnectable={false}
      edgesFocusable={false}
    >
      <Background color="var(--hl-border)" gap={18} size={1} />
      <Controls showInteractive={false} className="!border-line !bg-surface !shadow-card" />
    </ReactFlow>
  )
}
