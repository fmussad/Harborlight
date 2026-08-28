import { describe, expect, it } from 'vitest'
import { tokenizeCommand } from '@main/docker/command'
import { HarborlightError } from '@main/errors'

describe('tokenizeCommand', () => {
  it('splits on whitespace', () => {
    expect(tokenizeCommand('npm run start')).toEqual(['npm', 'run', 'start'])
    expect(tokenizeCommand('  ls   -la  ')).toEqual(['ls', '-la'])
  })

  it('keeps quoted arguments together', () => {
    expect(tokenizeCommand('sh -c "echo hello"')).toEqual(['sh', '-c', 'echo hello'])
    expect(tokenizeCommand("psql -c 'select 1'")).toEqual(['psql', '-c', 'select 1'])
  })

  it('supports escaped quotes inside double quotes', () => {
    expect(tokenizeCommand('echo "say \\"hi\\""')).toEqual(['echo', 'say "hi"'])
  })

  it('preserves empty quoted arguments', () => {
    expect(tokenizeCommand('app --flag ""')).toEqual(['app', '--flag', ''])
  })

  it('rejects shell operators so nothing can be chained', () => {
    for (const input of [
      'ls | grep x',
      'ls && rm -rf /',
      'ls; whoami',
      'cat > /etc/passwd',
      'echo $HOME'
    ]) {
      expect(() => tokenizeCommand(input), input).toThrow(HarborlightError)
    }
  })

  it('allows those characters when they are quoted', () => {
    expect(tokenizeCommand('printf "a|b"')).toEqual(['printf', 'a|b'])
  })

  it('rejects unbalanced quotes', () => {
    expect(() => tokenizeCommand('echo "unterminated')).toThrow(/Unbalanced quote/)
  })

  it('returns nothing for an empty command', () => {
    expect(tokenizeCommand('   ')).toEqual([])
  })
})
