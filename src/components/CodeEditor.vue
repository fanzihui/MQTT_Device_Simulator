<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { json } from '@codemirror/lang-json'
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { protobuf } from '@codemirror/legacy-modes/mode/protobuf'
import { Compartment, EditorState } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import { basicSetup, EditorView } from 'codemirror'

const model = defineModel<string>({ required: true })

const props = defineProps<{
  language: 'json' | 'protobuf'
  editorLabel: string
}>()

const host = ref<HTMLDivElement | null>(null)
const languageConfig = new Compartment()
const accessibilityConfig = new Compartment()
let editorView: EditorView | null = null

function languageExtension(language: 'json' | 'protobuf') {
  return language === 'json' ? json() : StreamLanguage.define(protobuf)
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--ink-soft)',
    backgroundColor: 'var(--code-surface)',
    fontSize: '12px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.8',
  },
  '.cm-content': {
    minHeight: '100%',
    caretColor: 'var(--ink)',
    padding: '12px 0',
  },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': {
    color: 'var(--subtle)',
    backgroundColor: 'var(--surface-muted)',
    border: 'none',
    borderRight: '1px solid var(--line)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 11px 0 8px' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ink) 3%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--ink) 4%, transparent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--focus-ring) 28%, transparent)',
  },
  '.cm-matchingBracket': {
    color: 'var(--ink)',
    backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)',
  },
  '.cm-tooltip': {
    color: 'var(--ink)',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--line)',
  },
})

const codeHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--code-key)' },
  { tag: tags.string, color: 'var(--code-string)' },
  { tag: tags.number, color: 'var(--code-number)' },
  { tag: [tags.bool, tags.null], color: 'var(--code-literal)' },
  { tag: tags.keyword, color: 'var(--code-keyword)' },
  { tag: tags.comment, color: 'var(--subtle)', fontStyle: 'italic' },
  { tag: tags.variableName, color: 'var(--ink-soft)' },
]))

onMounted(() => {
  if (!host.value) return

  editorView = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: model.value,
      extensions: [
        basicSetup,
        codeHighlighting,
        editorTheme,
        languageConfig.of(languageExtension(props.language)),
        accessibilityConfig.of(EditorView.contentAttributes.of({ 'aria-label': props.editorLabel, spellcheck: 'false' })),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const value = update.state.doc.toString()
          if (value !== model.value) model.value = value
        }),
      ],
    }),
  })
})

watch(model, (value) => {
  if (!editorView || editorView.state.doc.toString() === value) return
  editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: value } })
})

watch(() => props.language, (language) => {
  editorView?.dispatch({ effects: languageConfig.reconfigure(languageExtension(language)) })
})

watch(() => props.editorLabel, (editorLabel) => {
  editorView?.dispatch({
    effects: accessibilityConfig.reconfigure(EditorView.contentAttributes.of({ 'aria-label': editorLabel, spellcheck: 'false' })),
  })
})

onUnmounted(() => {
  editorView?.destroy()
  editorView = null
})
</script>

<template>
  <div ref="host" class="code-editor-host" />
</template>
