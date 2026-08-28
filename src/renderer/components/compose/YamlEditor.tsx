import { useEffect, useRef, useState, type ReactElement } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
  indentUnit
} from '@codemirror/language'
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { yaml } from '@codemirror/lang-yaml'
import { tags } from '@lezer/highlight'
import type { ComposeValidation } from '@shared/schemas/domain'

function harborlightHighlight(): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: 'var(--hl-accent)' },
      { tag: tags.propertyName, color: 'var(--hl-accent)' },
      { tag: tags.string, color: 'var(--hl-teal)' },
      { tag: tags.number, color: 'var(--hl-brand)' },
      { tag: tags.bool, color: 'var(--hl-brand)' },
      { tag: tags.null, color: 'var(--hl-brand)' },
      { tag: tags.comment, color: 'var(--hl-text-muted)', fontStyle: 'italic' },
      { tag: tags.meta, color: 'var(--hl-text-muted)' }
    ])
  )
}

const baseTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--hl-surface)', color: 'var(--hl-text)' },
  '.cm-content': { caretColor: 'var(--hl-brand)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--hl-accent) 25%, transparent) !important'
  },
  '.cm-lintRange-error': { textDecorationColor: 'var(--hl-danger)' }
})

export interface CursorPosition {
  line: number
  column: number
}

/**
 * CodeMirror 6 editor for Compose files.
 *
 * Validation problems come from the main process (`docker compose config`) and
 * are shown as gutter diagnostics; the editor never rewrites the document by
 * itself.
 */
export function YamlEditor({
  value,
  onChange,
  validation,
  readOnly = false,
  onCursorChange
}: {
  value: string
  onChange(next: string): void
  validation: ComposeValidation | null
  readOnly?: boolean
  onCursorChange?(position: CursorPosition): void
}): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onCursorRef = useRef(onCursorChange)
  const [ready, setReady] = useState(false)

  // Latest callbacks without tearing down the editor when a parent re-renders.
  useEffect(() => {
    onChangeRef.current = onChange
    onCursorRef.current = onCursorChange
  }, [onChange, onCursorChange])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          highlightSelectionMatches(),
          history(),
          bracketMatching(),
          lintGutter(),
          indentUnit.of('  '),
          yaml(),
          harborlightHighlight(),
          baseTheme,
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.editable.of(!readOnly),
          EditorState.readOnly.of(readOnly),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head
              const line = update.state.doc.lineAt(head)
              onCursorRef.current?.({ line: line.number, column: head - line.from + 1 })
            }
          })
        ]
      })
    })

    viewRef.current = view
    setReady(true)

    return () => {
      view.destroy()
      viewRef.current = null
      setReady(false)
    }
    // The editor is created once per mount; `value` is synced by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  // Adopt external changes (opening another file, formatting) without losing focus.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !ready) return

    const diagnostics: Diagnostic[] = (validation?.problems ?? [])
      .filter((problem) => problem.line !== null)
      .map((problem) => {
        const lineNumber = Math.min(Math.max(problem.line ?? 1, 1), view.state.doc.lines)
        const line = view.state.doc.line(lineNumber)
        return {
          from: line.from,
          to: line.to,
          severity: problem.severity,
          message: problem.message
        }
      })

    view.dispatch(setDiagnostics(view.state, diagnostics))
  }, [ready, validation])

  return <div ref={hostRef} className="h-full min-h-0 overflow-hidden" />
}
