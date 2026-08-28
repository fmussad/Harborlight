import { describe, expect, it } from 'vitest'
import { COMMAND_NAMES, commandSchemas, isCommandName } from '@shared/contracts/commands'
import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL } from '@shared/contracts/channels'

describe('command allowlist', () => {
  it('only recognises declared commands', () => {
    expect(isCommandName('containers.list')).toBe(true)
    expect(isCommandName('containers.destroyEverything')).toBe(false)
    expect(isCommandName('toString')).toBe(false)
    expect(isCommandName('__proto__')).toBe(false)
    expect(isCommandName(42)).toBe(false)
  })

  it('exposes every schema through COMMAND_NAMES', () => {
    expect(COMMAND_NAMES).toHaveLength(Object.keys(commandSchemas).length)
    for (const name of COMMAND_NAMES) expect(commandSchemas[name]).toBeDefined()
  })

  it('uses namespaced channels so nothing collides with Electron internals', () => {
    expect(IPC_INVOKE_CHANNEL).toMatch(/^harborlight:/)
    expect(IPC_EVENT_CHANNEL).toMatch(/^harborlight:/)
    expect(IPC_INVOKE_CHANNEL).not.toBe(IPC_EVENT_CHANNEL)
  })
})

describe('payload validation', () => {
  it('applies defaults so handlers never see undefined', () => {
    expect(commandSchemas['containers.list'].parse({})).toEqual({ all: true })
    expect(commandSchemas['containers.stop'].parse({ id: 'abc' })).toEqual({
      id: 'abc',
      timeoutSeconds: 10
    })
  })

  it('rejects empty and oversized identifiers', () => {
    expect(commandSchemas['containers.inspect'].safeParse({ id: '' }).success).toBe(false)
    expect(commandSchemas['containers.inspect'].safeParse({ id: 'x'.repeat(200) }).success).toBe(
      false
    )
  })

  it('rejects unknown keys on commands that take no payload', () => {
    expect(commandSchemas['engine.getStatus'].safeParse({ sneaky: true }).success).toBe(false)
  })

  it('validates image references', () => {
    const schema = commandSchemas['images.pull']
    expect(schema.safeParse({ reference: 'ghcr.io/org/app:1.0.0' }).success).toBe(true)
    expect(schema.safeParse({ reference: 'app@sha256:' + 'a'.repeat(64) }).success).toBe(true)
    expect(schema.safeParse({ reference: 'app; rm -rf /' }).success).toBe(false)
    expect(schema.safeParse({ reference: '$(whoami)' }).success).toBe(false)
    expect(schema.safeParse({ reference: '' }).success).toBe(false)
  })

  it('validates container names', () => {
    const schema = commandSchemas['containers.rename']
    expect(schema.safeParse({ id: 'abc', name: 'my-service_1.0' }).success).toBe(true)
    expect(schema.safeParse({ id: 'abc', name: '-bad-start' }).success).toBe(false)
    expect(schema.safeParse({ id: 'abc', name: 'has space' }).success).toBe(false)
  })

  it('only accepts absolute, non-traversing Compose paths', () => {
    const schema = commandSchemas['compose.openFile']
    expect(schema.safeParse({ path: '/srv/app/compose.yml' }).success).toBe(true)
    expect(schema.safeParse({ path: '/srv/app/prod.compose.yaml' }).success).toBe(true)
    expect(schema.safeParse({ path: 'compose.yml' }).success).toBe(false)
    expect(schema.safeParse({ path: '/srv/../etc/compose.yml' }).success).toBe(false)
    expect(schema.safeParse({ path: '/srv/app/values.yml' }).success).toBe(false)
  })

  it('requires an explicit confirmation before writing a Compose file', () => {
    const schema = commandSchemas['compose.saveFile']
    const payload = { path: '/srv/app/compose.yml', content: 'services: {}' }
    expect(schema.safeParse(payload).success).toBe(false)
    expect(schema.safeParse({ ...payload, confirmed: true }).success).toBe(true)
  })

  it('bounds numeric inputs', () => {
    expect(
      commandSchemas['logs.start'].safeParse({ containerId: 'a', tail: 999_999 }).success
    ).toBe(false)
    expect(
      commandSchemas['exec.resize'].safeParse({ sessionId: 'a', cols: 1, rows: 24 }).success
    ).toBe(false)
    expect(commandSchemas['engine.getUsageHistory'].safeParse({ windowHours: 200 }).success).toBe(
      false
    )
  })

  it('only allows well-known signals to be sent', () => {
    const schema = commandSchemas['containers.kill']
    expect(schema.safeParse({ id: 'a', signal: 'SIGKILL' }).success).toBe(true)
    expect(schema.safeParse({ id: 'a', signal: 'SIGSEGV' }).success).toBe(false)
  })

  it('requires https-style URLs for external links', () => {
    const schema = commandSchemas['system.openExternal']
    expect(schema.safeParse({ url: 'https://github.com/fmussad/Harborlight' }).success).toBe(true)
    expect(schema.safeParse({ url: 'not a url' }).success).toBe(false)
  })

  it('requires at least one cleanup category', () => {
    expect(commandSchemas['cleanup.run'].safeParse({ categories: [] }).success).toBe(false)
    expect(
      commandSchemas['cleanup.run'].safeParse({ categories: ['danglingImages'] }).success
    ).toBe(true)
    expect(commandSchemas['cleanup.run'].safeParse({ categories: ['everything'] }).success).toBe(
      false
    )
  })

  it('accepts a fully specified run request and rejects impossible ports', () => {
    const schema = commandSchemas['containers.run']
    expect(
      schema.safeParse({
        image: 'nginx:1.27',
        ports: [{ hostPort: 8080, containerPort: 80 }],
        env: [{ key: 'TZ', value: 'Europe/Madrid' }]
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({ image: 'nginx', ports: [{ hostPort: 70_000, containerPort: 80 }] }).success
    ).toBe(false)
  })
})
