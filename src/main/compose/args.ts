export type ComposeAction =
  'up' | 'down' | 'start' | 'stop' | 'restart' | 'pull' | 'build' | 'rebuild'

export interface ComposeCommandSpec {
  action: ComposeAction
  projectName: string
  workingDir: string
  files: string[]
  services: string[]
  detach: boolean
  removeVolumes: boolean
  removeOrphans: boolean
  noCache: boolean
}

/**
 * Builds the argv array for a Docker Compose invocation.
 *
 * Pure and exhaustively unit-tested: this is the only place that decides what
 * Harborlight is allowed to run, and it is always executed with `shell: false`
 * so no value here can be reinterpreted by a shell.
 */
export function buildComposeArgs(spec: ComposeCommandSpec): string[] {
  const args: string[] = ['compose', '--project-name', spec.projectName]
  for (const file of spec.files) args.push('--file', file)

  switch (spec.action) {
    case 'up':
      args.push('up')
      if (spec.detach) args.push('--detach')
      if (spec.removeOrphans) args.push('--remove-orphans')
      break
    case 'down':
      args.push('down')
      if (spec.removeVolumes) args.push('--volumes')
      if (spec.removeOrphans) args.push('--remove-orphans')
      break
    case 'start':
      args.push('start')
      break
    case 'stop':
      args.push('stop')
      break
    case 'restart':
      args.push('restart')
      break
    case 'pull':
      args.push('pull')
      break
    case 'build':
      args.push('build')
      if (spec.noCache) args.push('--no-cache')
      break
    case 'rebuild':
      args.push('up', '--build', '--force-recreate')
      if (spec.detach) args.push('--detach')
      break
    default: {
      const exhaustive: never = spec.action
      throw new Error(`Unsupported compose action: ${String(exhaustive)}`)
    }
  }

  // `down` targets the whole project; Compose rejects service names there.
  if (spec.action !== 'down' && spec.services.length > 0) {
    args.push(...spec.services)
  }
  return args
}

export function buildComposeConfigArgs(
  spec: Pick<ComposeCommandSpec, 'projectName' | 'files'>
): string[] {
  const args = ['compose', '--project-name', spec.projectName]
  for (const file of spec.files) args.push('--file', file)
  args.push('config')
  return args
}

/** Human-readable preview shown before a Compose action runs. */
export function formatCommandPreview(program: string, args: string[]): string {
  return [program, ...args].map(quoteForDisplay).join(' ')
}

function quoteForDisplay(value: string): string {
  return /[\s"'$`\\|&;<>()]/.test(value) ? `'${value.replace(/'/g, `'\\''`)}'` : value
}

/** Actions that can destroy data and therefore need explicit confirmation. */
export function isDestructiveAction(
  spec: Pick<ComposeCommandSpec, 'action' | 'removeVolumes'>
): boolean {
  if (spec.action === 'down') return true
  return false
}

export function requiresVolumeConfirmation(
  spec: Pick<ComposeCommandSpec, 'action' | 'removeVolumes'>
): boolean {
  return spec.action === 'down' && spec.removeVolumes
}
