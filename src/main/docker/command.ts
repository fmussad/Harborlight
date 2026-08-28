import { HarborlightError } from '../errors'

/**
 * Splits a user-typed command into an argv array.
 *
 * Harborlight never hands strings to a shell, so the tokenizer only supports
 * quoting and rejects shell metacharacters outside quotes. Anything that looks
 * like an attempt to chain commands is refused with a clear message.
 */
export function tokenizeCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let hasToken = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] as string

    if (quote) {
      if (char === quote) {
        quote = null
      } else if (char === '\\' && quote === '"' && index + 1 < input.length) {
        index += 1
        current += input[index]
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      hasToken = true
      continue
    }

    if (/\s/.test(char)) {
      if (hasToken) {
        tokens.push(current)
        current = ''
        hasToken = false
      }
      continue
    }

    if ('|&;<>$`\n'.includes(char)) {
      throw new HarborlightError(
        'validation',
        `The character "${char}" is not allowed: Harborlight runs commands without a shell.`,
        {
          hint: 'Wrap the whole command in your own entrypoint, or quote the argument. Shell operators such as | && ; > $ are never interpreted.'
        }
      )
    }

    current += char
    hasToken = true
  }

  if (quote) {
    throw new HarborlightError('validation', 'Unbalanced quote in the command.')
  }
  if (hasToken) tokens.push(current)
  return tokens
}
