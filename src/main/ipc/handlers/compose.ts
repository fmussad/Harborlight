import { readFile, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { ComposeValidation } from '@shared/schemas/domain'
import type { AppContext } from '../../context'
import {
  buildComposeArgs,
  buildComposeConfigArgs,
  formatCommandPreview,
  isDestructiveAction,
  requiresVolumeConfirmation
} from '../../compose/args'
import { mergeProjectState, projectsFromContainers } from '../../compose/discover'
import {
  composeProjectFromYaml,
  lintComposeDocument,
  parseComposeYaml
} from '@shared/compose/parse'
import {
  assertFileInsideWorkingDir,
  defaultWorkingDirFor,
  resolveComposeFile,
  resolveWorkingDir
} from '../../compose/paths'
import {
  cancelComposeOperation,
  capture,
  resolveComposeBinary,
  runComposeStreaming,
  withBinary
} from '../../compose/runner'
import { HarborlightError } from '../../errors'
import { logger } from '../../services/logger'
import type { CommandHandlers } from '../registry'

const MAX_COMPOSE_FILE_BYTES = 2 * 1024 * 1024

/**
 * Compose Studio.
 *
 * Every path is resolved and checked before use, commands never touch a shell,
 * and the user's YAML is only written when the renderer sends an explicit
 * confirmation flag.
 */
export const composeHandlers = {
  'compose.discover': async (_payload, context: AppContext) => {
    const containers = await context.engines.current().listContainers(true)
    return projectsFromContainers(containers)
  },

  'compose.readFile': async (payload) => {
    const file = resolveComposeFile(payload.path)
    const content = await readComposeFile(file)
    return { path: file, content }
  },

  'compose.openFile': async (payload, context: AppContext) => {
    const file = resolveComposeFile(payload.path)
    const workingDir = resolveWorkingDir(defaultWorkingDirFor(file))
    assertFileInsideWorkingDir(file, workingDir)

    const content = await readComposeFile(file)
    const parsed = parseComposeYaml(content)
    if (!parsed.data) {
      throw new HarborlightError(
        'validation',
        parsed.error?.message ?? 'The Compose file could not be parsed.',
        {
          details: parsed.error?.problems.map((problem) => problem.message).join('\n') ?? null
        }
      )
    }

    const name =
      basename(workingDir)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '-') || 'compose'
    const project = composeProjectFromYaml(parsed.data, {
      name,
      workingDir,
      configFiles: [file]
    })

    const containers = await context.engines
      .current()
      .listContainers(true)
      .catch(() => [])
    const running = projectsFromContainers(containers).find((entry) => entry.name === name) ?? null

    return { path: file, content, project: mergeProjectState(project, running) }
  },

  /** Writing only happens with `confirmed: true`, sent after a UI prompt. */
  'compose.saveFile': async (payload) => {
    const file = resolveComposeFile(payload.path)
    const parsed = parseComposeYaml(payload.content)
    if (!parsed.data) {
      throw new HarborlightError('validation', 'Refusing to save: the YAML is invalid.', {
        details: parsed.error?.problems.map((problem) => problem.message).join('\n') ?? null
      })
    }
    await writeFile(file, payload.content, 'utf8')
    logger.info(
      'compose',
      `Saved ${file} (${payload.content.length} bytes) after explicit confirmation`
    )
    return { ok: true as const, message: `Saved ${basename(file)}.` }
  },

  /**
   * Validation runs the real `docker compose config` so the user sees exactly
   * what Compose thinks, with a local YAML lint as a fast fallback.
   */
  'compose.validate': async (payload): Promise<ComposeValidation> => {
    const workingDir = resolveWorkingDir(payload.workingDir)
    const files = payload.files.map(resolveComposeFile)
    for (const file of files) assertFileInsideWorkingDir(file, workingDir)

    if (payload.content !== null) {
      const parsed = parseComposeYaml(payload.content)
      if (!parsed.data) {
        return (
          parsed.error ?? { valid: false, message: 'Invalid YAML.', normalized: null, problems: [] }
        )
      }
      const problems = lintComposeDocument(parsed.data)
      if (problems.some((problem) => problem.severity === 'error')) {
        return {
          valid: false,
          message: 'The Compose file has structural problems.',
          normalized: null,
          problems
        }
      }
    }

    const binary = await resolveComposeBinary()
    const { program, args } = withBinary(
      binary,
      buildComposeConfigArgs({ projectName: payload.projectName, files })
    )
    const result = await capture({ program, args, cwd: workingDir, timeoutMs: 30_000 })

    if (result.code === 0) {
      return {
        valid: true,
        message: 'docker compose config accepted this project.',
        normalized: result.stdout,
        problems: payload.content ? lintComposeDocument(parseComposeYaml(payload.content).data) : []
      }
    }

    return {
      valid: false,
      message: 'docker compose config rejected this project.',
      normalized: null,
      problems: result.stderr
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .slice(0, 20)
        .map((line) => ({
          line: null,
          column: null,
          severity: 'error' as const,
          message: line.trim()
        }))
    }
  },

  'compose.preview': async (payload) => {
    const workingDir = resolveWorkingDir(payload.workingDir)
    const files = payload.files.map(resolveComposeFile)
    for (const file of files) assertFileInsideWorkingDir(file, workingDir)

    const binary = await resolveComposeBinary()
    const { program, args } = withBinary(
      binary,
      buildComposeArgs({ ...payload, workingDir, files })
    )
    return {
      program,
      args,
      cwd: workingDir,
      display: formatCommandPreview(program, args),
      destructive: isDestructiveAction(payload)
    }
  },

  'compose.action': async (payload) => {
    const workingDir = resolveWorkingDir(payload.workingDir)
    const files = payload.files.map(resolveComposeFile)
    for (const file of files) assertFileInsideWorkingDir(file, workingDir)

    if (isDestructiveAction(payload) && !payload.confirmedDestructive) {
      throw new HarborlightError(
        'not-allowed',
        'This Compose action needs an explicit confirmation.',
        {
          hint: 'The renderer must confirm destructive actions before they are sent.'
        }
      )
    }
    if (requiresVolumeConfirmation(payload) && !payload.confirmedDestructive) {
      throw new HarborlightError('not-allowed', '"down --volumes" needs a separate confirmation.', {
        hint: 'Named volumes are deleted permanently.'
      })
    }

    const args = buildComposeArgs({ ...payload, workingDir, files })
    const binary = await resolveComposeBinary()
    const preview = withBinary(binary, args)
    const operationId = await runComposeStreaming({
      args,
      cwd: workingDir,
      label: `compose ${payload.action} · ${payload.projectName}`,
      detail: formatCommandPreview(preview.program, preview.args)
    })
    return { operationId }
  },

  'compose.cancel': async (payload) => {
    cancelComposeOperation(payload.operationId)
    return { ok: true as const, message: 'Stop signal sent to the Compose process.' }
  }
} satisfies Partial<CommandHandlers>

async function readComposeFile(file: string): Promise<string> {
  const content = await readFile(file, 'utf8')
  if (content.length > MAX_COMPOSE_FILE_BYTES) {
    throw new HarborlightError('validation', `${basename(file)} is larger than 2 MB.`, {
      hint: `Harborlight only opens Compose files up to 2 MB. Directory: ${dirname(file)}`
    })
  }
  return content
}
