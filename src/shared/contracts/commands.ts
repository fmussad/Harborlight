import { z } from 'zod'
import {
  cleanupCategorySchema,
  registryKindSchema,
  settingsSchema,
  themeSchema
} from '../schemas/domain'

/**
 * The IPC command allowlist.
 *
 * A command that is not a key of `commandSchemas` is rejected by the main
 * process before any handler runs. Every payload is parsed with the schema
 * below, so handlers only ever see validated input.
 */

const containerRef = z.object({ id: z.string().min(1).max(128) })
const imageRef = z.object({ id: z.string().min(1).max(512) })
const empty = z.object({}).strict()

/** Docker reference: registry/namespace/name:tag or @sha256:digest. */
export const dockerReferenceSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9._:\-/]*(@sha256:[a-f0-9]{64})?$/,
    'Invalid image reference. Use registry/name:tag or name@sha256:digest.'
  )

/** Absolute path with no shell metacharacters or parent traversal. */
export const absolutePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => value.startsWith('/'), 'Path must be absolute.')
  .refine((value) => !value.split('/').includes('..'), 'Path must not contain "..".')
  .refine((value) => !/[\0\n\r]/.test(value), 'Path must not contain control characters.')

export const composeFileSchema = absolutePathSchema.refine(
  (value) =>
    /(^|\/)(docker-)?compose\.ya?ml$/.test(value) || /(^|\/)[\w.-]+\.compose\.ya?ml$/.test(value),
  'Compose files must be named compose.yml, compose.yaml, docker-compose.yml or docker-compose.yaml.'
)

export const containerNameSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Invalid container name.')

export const commandSchemas = {
  // ---------------------------------------------------------------- system
  'system.getAppInfo': empty,
  'system.getPlatformInfo': empty,
  'system.openExternal': z.object({ url: z.string().url().max(2048) }),
  'system.checkForUpdates': empty,
  'system.exportDiagnostics': empty,
  'system.listTasks': empty,
  'system.cancelTask': z.object({ id: z.string().min(1).max(128) }),
  'system.pickComposeFile': empty,
  'system.quit': empty,
  'system.minimizeToTray': empty,

  // -------------------------------------------------------------- settings
  'settings.get': empty,
  'settings.update': settingsSchema.partial(),
  'settings.reset': empty,
  'settings.setTheme': z.object({ theme: themeSchema }),

  // ---------------------------------------------------------------- engine
  'engine.getStatus': empty,
  'engine.reconnect': empty,
  'engine.listSockets': empty,
  'engine.getDiskUsage': empty,
  'engine.getUsageHistory': z.object({ windowHours: z.number().int().min(1).max(72).default(24) }),

  // ------------------------------------------------------------ containers
  'containers.list': z.object({ all: z.boolean().default(true) }),
  'containers.inspect': containerRef,
  'containers.stats': containerRef,
  'containers.start': containerRef,
  'containers.stop': containerRef.extend({
    timeoutSeconds: z.number().int().min(0).max(600).default(10)
  }),
  'containers.restart': containerRef.extend({
    timeoutSeconds: z.number().int().min(0).max(600).default(10)
  }),
  'containers.pause': containerRef,
  'containers.unpause': containerRef,
  'containers.kill': containerRef.extend({
    signal: z.enum(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP']).default('SIGKILL')
  }),
  'containers.rename': containerRef.extend({ name: containerNameSchema }),
  'containers.remove': containerRef.extend({
    force: z.boolean().default(false),
    removeVolumes: z.boolean().default(false)
  }),
  'containers.run': z.object({
    image: dockerReferenceSchema,
    name: containerNameSchema.optional(),
    command: z.string().max(2048).optional(),
    ports: z
      .array(
        z.object({
          hostPort: z.number().int().min(1).max(65535),
          containerPort: z.number().int().min(1).max(65535),
          protocol: z.enum(['tcp', 'udp']).default('tcp')
        })
      )
      .max(64)
      .default([]),
    env: z
      .array(z.object({ key: z.string().min(1).max(256), value: z.string().max(8192) }))
      .max(128)
      .default([]),
    volumes: z
      .array(
        z.object({
          source: z.string().min(1).max(4096),
          target: absolutePathSchema,
          readOnly: z.boolean().default(false)
        })
      )
      .max(32)
      .default([]),
    restartPolicy: z.enum(['no', 'on-failure', 'always', 'unless-stopped']).default('no'),
    autoRemove: z.boolean().default(false),
    detach: z.boolean().default(true)
  }),

  // ------------------------------------------------------------------ logs
  'logs.start': z.object({
    containerId: z.string().min(1).max(128),
    tail: z.number().int().min(1).max(20_000).default(500),
    timestamps: z.boolean().default(true),
    sinceSeconds: z
      .number()
      .int()
      .min(0)
      .max(60 * 60 * 24 * 30)
      .nullable()
      .default(null),
    follow: z.boolean().default(true)
  }),
  'logs.stop': z.object({ streamId: z.string().min(1).max(128) }),
  'logs.export': z.object({
    containerId: z.string().min(1).max(128),
    tail: z.number().int().min(1).max(200_000).default(5000),
    timestamps: z.boolean().default(true)
  }),

  // ------------------------------------------------------------------ exec
  'exec.start': z.object({
    containerId: z.string().min(1).max(128),
    shell: z.string().min(1).max(256).nullable().default(null),
    user: z.string().max(128).nullable().default(null),
    workingDir: z.string().max(4096).nullable().default(null),
    cols: z.number().int().min(2).max(1000).default(80),
    rows: z.number().int().min(2).max(500).default(24)
  }),
  'exec.write': z.object({ sessionId: z.string().min(1).max(128), data: z.string().max(65_536) }),
  'exec.resize': z.object({
    sessionId: z.string().min(1).max(128),
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(2).max(500)
  }),
  'exec.stop': z.object({ sessionId: z.string().min(1).max(128) }),

  // ---------------------------------------------------------------- images
  'images.list': empty,
  'images.inspect': imageRef,
  'images.history': imageRef,
  'images.pull': z.object({
    reference: dockerReferenceSchema,
    registryId: z.string().max(128).nullable().default(null)
  }),
  'images.remove': imageRef.extend({
    force: z.boolean().default(false),
    pruneChildren: z.boolean().default(false)
  }),
  'images.tag': imageRef.extend({ reference: dockerReferenceSchema }),
  'images.scan': z.object({ reference: dockerReferenceSchema }),
  'images.scanAvailability': empty,

  // --------------------------------------------------------------- volumes
  'volumes.list': empty,
  'volumes.inspect': z.object({ name: z.string().min(1).max(255) }),
  'volumes.remove': z.object({
    name: z.string().min(1).max(255),
    force: z.boolean().default(false)
  }),

  // -------------------------------------------------------------- networks
  'networks.list': empty,
  'networks.inspect': z.object({ id: z.string().min(1).max(128) }),
  'networks.remove': z.object({ id: z.string().min(1).max(128) }),

  // --------------------------------------------------------------- cleanup
  'cleanup.analyze': empty,
  'cleanup.run': z.object({
    categories: z.array(cleanupCategorySchema).min(1),
    dryRun: z.boolean().default(false)
  }),

  // --------------------------------------------------------------- compose
  'compose.discover': empty,
  'compose.openFile': z.object({ path: composeFileSchema }),
  'compose.readFile': z.object({ path: composeFileSchema }),
  'compose.saveFile': z.object({
    path: composeFileSchema,
    content: z.string().max(2_000_000),
    confirmed: z.literal(true)
  }),
  'compose.validate': z.object({
    projectName: z.string().min(1).max(255),
    workingDir: absolutePathSchema,
    files: z.array(composeFileSchema).min(1).max(8),
    content: z.string().max(2_000_000).nullable().default(null)
  }),
  'compose.action': z.object({
    action: z.enum(['up', 'down', 'start', 'stop', 'restart', 'pull', 'build', 'rebuild']),
    projectName: z.string().min(1).max(255),
    workingDir: absolutePathSchema,
    files: z.array(composeFileSchema).min(1).max(8),
    services: z.array(z.string().min(1).max(255)).max(64).default([]),
    detach: z.boolean().default(true),
    removeVolumes: z.boolean().default(false),
    removeOrphans: z.boolean().default(false),
    noCache: z.boolean().default(false),
    confirmedDestructive: z.boolean().default(false)
  }),
  'compose.preview': z.object({
    action: z.enum(['up', 'down', 'start', 'stop', 'restart', 'pull', 'build', 'rebuild']),
    projectName: z.string().min(1).max(255),
    workingDir: absolutePathSchema,
    files: z.array(composeFileSchema).min(1).max(8),
    services: z.array(z.string().min(1).max(255)).max(64).default([]),
    detach: z.boolean().default(true),
    removeVolumes: z.boolean().default(false),
    removeOrphans: z.boolean().default(false),
    noCache: z.boolean().default(false)
  }),
  'compose.cancel': z.object({ operationId: z.string().min(1).max(128) }),

  // -------------------------------------------------------------- registry
  'registry.status': empty,
  'registry.list': empty,
  'registry.add': z.object({
    name: z.string().min(1).max(120),
    kind: registryKindSchema,
    serverAddress: z.string().min(1).max(512)
  }),
  'registry.remove': z.object({ id: z.string().min(1).max(128) }),
  'registry.login': z.object({
    id: z.string().min(1).max(128),
    username: z.string().min(1).max(256),
    secret: z.string().min(1).max(4096)
  }),
  'registry.logout': z.object({ id: z.string().min(1).max(128) })
} as const

export type CommandName = keyof typeof commandSchemas
export const COMMAND_NAMES = Object.keys(commandSchemas) as CommandName[]

export type CommandInput<K extends CommandName> = z.input<(typeof commandSchemas)[K]>
export type CommandPayload<K extends CommandName> = z.output<(typeof commandSchemas)[K]>

export function isCommandName(value: unknown): value is CommandName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(commandSchemas, value)
}
