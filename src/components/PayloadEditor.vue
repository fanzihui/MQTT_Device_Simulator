<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { IconBraces, IconBulb, IconDeviceFloppy, IconFileCode, IconMaximize, IconMinimize, IconPlus, IconSchema, IconSparkles } from '@tabler/icons-vue'
import CodeEditor from './CodeEditor.vue'
import type { FieldRange, ProtoSchemaEntry, PayloadFormat } from '../types'
import {
  getMessageFields,
  fillEmptyProtoValues,
  listProtoMessageTypes,
  parseProtoSchema,
  type ProtoFieldDescriptor,
} from '../lib/payload'

const format = defineModel<PayloadFormat>('format', { required: true })
const topicTemplate = defineModel<string>('topicTemplate', { required: true })
const jsonTemplate = defineModel<string>('jsonTemplate', { required: true })
const schemas = defineModel<ProtoSchemaEntry[]>('schemas', { required: true })
const selectedSchemaId = defineModel<string>('schemaId', { required: true })
const messageType = defineModel<string>('messageType', { required: true })
const protoValues = defineModel<Record<string, unknown>>('protoValues', { required: true })
const fieldRanges = defineModel<Record<string, FieldRange>>('fieldRanges', { required: true })

const emit = defineEmits<{ save: [] }>()
const dynamicVariables = ['{{deviceId}}', '{{clientId}}', '{{timestamp}}']
const randomIntToken = '{{randomInt:min:max}}'
const randomFloatToken = '{{randomFloat:min:max}}'
const formattingError = ref('')
const fillMessage = ref('')
const isFullscreen = ref(false)

const selectedSchema = computed(() => schemas.value.find((schema) => schema.id === selectedSchemaId.value))
const topicPreview = computed(() => topicTemplate.value.replaceAll('{{deviceId}}', 'sensor-001'))
const schemaSource = computed({
  get: () => selectedSchema.value?.source ?? '',
  set: (source: string) => {
    if (!selectedSchema.value) return
    schemas.value = schemas.value.map((schema) => schema.id === selectedSchemaId.value ? { ...schema, source } : schema)
  },
})

const parsedSchema = computed(() => {
  if (!schemaSource.value.trim()) return { root: null, error: '添加或导入一个 proto3 Schema。' }
  try {
    return { root: parseProtoSchema(schemaSource.value), error: '' }
  } catch (error) {
    return { root: null, error: error instanceof Error ? error.message : 'Schema 解析失败。' }
  }
})
const messageTypes = computed(() => parsedSchema.value.root ? listProtoMessageTypes(parsedSchema.value.root) : [])
const fields = computed(() => {
  if (!parsedSchema.value.root || !messageType.value) return []
  try {
    return getMessageFields(parsedSchema.value.root, messageType.value)
  } catch {
    return []
  }
})

watch(messageTypes, (types) => {
  if (types.length && !types.includes(messageType.value)) messageType.value = types[0]!
}, { immediate: true })

function setSchemaName(value: string) {
  if (!selectedSchema.value) return
  schemas.value = schemas.value.map((schema) => schema.id === selectedSchemaId.value ? { ...schema, name: value } : schema)
}

function addSchema() {
  const id = crypto.randomUUID()
  const schema: ProtoSchemaEntry = {
    id,
    name: `新建 Schema ${schemas.value.length + 1}`,
    messageType: 'Telemetry',
    source: 'syntax = "proto3";\n\npackage telemetry;\n\nmessage Telemetry {\n  string device_id = 1;\n  double temperature = 2;\n  double humidity = 3;\n  int64 timestamp = 4;\n}',
  }
  schemas.value = [...schemas.value, schema]
  selectedSchemaId.value = id
  messageType.value = ''
  protoValues.value = {}
}

async function importSchema(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const source = await file.text()
  const id = crypto.randomUUID()
  const name = file.name.replace(/\.proto$/i, '') || `Schema ${schemas.value.length + 1}`
  schemas.value = [...schemas.value, { id, name, source, messageType: '' }]
  selectedSchemaId.value = id
  messageType.value = ''
  protoValues.value = {}
  input.value = ''
}

function rangeFor(field: ProtoFieldDescriptor): FieldRange {
  return fieldRanges.value[field.name] ?? { enabled: false, min: 0, max: 100 }
}

function isNumberField(field: ProtoFieldDescriptor) {
  return field.kind === 'scalar' && ['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(field.type)
}

function showValue(field: ProtoFieldDescriptor): string {
  const value = protoValues.value[field.name]
  if (field.kind === 'message' || field.repeated) return JSON.stringify(value ?? (field.repeated ? [] : {}), null, 2)
  if (field.type === 'bool') return value === true ? 'true' : 'false'
  return value === undefined || value === null ? '' : String(value)
}

function updateValue(field: ProtoFieldDescriptor, event: Event) {
  const raw = (event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value
  let value: unknown = raw
  if (field.kind === 'message' || field.repeated) {
    try {
      value = JSON.parse(raw)
    } catch {
      value = raw.split(',').map((item) => item.trim()).filter(Boolean)
    }
    if (field.kind === 'message' && (typeof value !== 'object' || value === null || Array.isArray(value))) value = {}
  } else if (field.kind === 'scalar') {
    if (field.type === 'bool') value = raw === 'true'
    else if (field.type !== 'string' && field.type !== 'bytes') value = raw === '' ? undefined : Number(raw)
  }
  protoValues.value = { ...protoValues.value, [field.name]: value }
}

function updateRange(field: ProtoFieldDescriptor, key: 'enabled' | 'min' | 'max', event: Event) {
  const current = rangeFor(field)
  const target = event.target as HTMLInputElement
  fieldRanges.value = {
    ...fieldRanges.value,
    [field.name]: { ...current, [key]: key === 'enabled' ? target.checked : Number(target.value) },
  }
}

function formatJsonTemplate() {
  try {
    jsonTemplate.value = JSON.stringify(JSON.parse(jsonTemplate.value), null, 2)
    formattingError.value = ''
  } catch (error) {
    formattingError.value = error instanceof Error ? error.message : 'JSON 模板格式不正确。'
  }
}

function fillEmptyFields() {
  if (!parsedSchema.value.root || !messageType.value) return
  try {
    protoValues.value = fillEmptyProtoValues(parsedSchema.value.root, messageType.value, protoValues.value)
    fillMessage.value = '已补齐空字段，已有值已保留。'
  } catch (error) {
    fillMessage.value = error instanceof Error ? error.message : '自动填充失败。'
  }
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  document.body.classList.toggle('payload-fullscreen-open', isFullscreen.value)
}

function handleFullscreenKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isFullscreen.value) toggleFullscreen()
}

onMounted(() => window.addEventListener('keydown', handleFullscreenKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', handleFullscreenKeydown)
  document.body.classList.remove('payload-fullscreen-open')
})
</script>

<template>
  <Teleport to="body" :disabled="!isFullscreen">
  <section class="panel-card payload-card" :class="{ 'is-fullscreen': isFullscreen }">
    <div class="payload-heading">
      <div>
        <p class="eyebrow">设备上报数据</p>
        <h2>消息载荷</h2>
      </div>
      <div class="payload-heading-actions">
        <span class="live-pill"><i /> 已就绪</span>
        <button class="tool-button fullscreen-button" type="button" :aria-label="isFullscreen ? '退出全屏编辑' : '全屏编辑载荷'" :title="isFullscreen ? '退出全屏编辑' : '全屏编辑载荷'" @click="toggleFullscreen">
          <IconMinimize v-if="isFullscreen" aria-hidden="true" :size="16" />
          <IconMaximize v-else aria-hidden="true" :size="16" />
          <span>{{ isFullscreen ? '退出全屏' : '全屏编辑' }}</span>
        </button>
      </div>
    </div>

    <div class="topic-row">
      <div class="topic-title">
        <label for="topic-template">发布主题</label>
        <span class="helper">支持设备变量</span>
      </div>
      <div class="topic-input-wrap">
        <span class="topic-prefix">TOPIC</span>
        <input id="topic-template" v-model="topicTemplate" class="topic-input mono" spellcheck="false" />
      </div>
      <span class="topic-hint">{{ topicPreview }}</span>
    </div>

    <div class="editor-toolbar">
      <div class="format-tabs" role="tablist" aria-label="消息格式">
        <button class="format-tab" :class="{ active: format === 'json' }" type="button" @click="format = 'json'">
          <IconBraces aria-hidden="true" class="format-mark json-mark" :size="17" :stroke-width="1.8" />JSON
        </button>
        <button class="format-tab" :class="{ active: format === 'protobuf' }" type="button" @click="format = 'protobuf'">
          <IconSchema aria-hidden="true" class="format-mark proto-mark" :size="17" :stroke-width="1.8" />Protobuf
        </button>
      </div>
      <div class="toolbar-tools">
        <span class="editor-language">{{ format === 'json' ? 'JSON template' : 'proto3 schema' }}</span>
        <button v-if="format === 'json'" class="tool-button" type="button" @click="formatJsonTemplate">格式化</button>
        <template v-else>
          <button class="tool-button" type="button" @click="addSchema"><IconPlus aria-hidden="true" :size="15" />新建</button>
          <label class="tool-button import-button">导入 .proto<input type="file" accept=".proto,text/plain" @change="importSchema" /></label>
          <button class="tool-button save-button" type="button" @click="emit('save')"><IconDeviceFloppy aria-hidden="true" :size="15" />保存 Schema</button>
        </template>
      </div>
    </div>

    <div v-if="format === 'json'" class="json-editor-shell">
      <CodeEditor v-model="jsonTemplate" class="json-editor-host" language="json" editor-label="JSON 消息模板" />
      <div class="editor-status"><span>UTF-8</span><span>JSON</span><span class="editor-status-good">模板变量可用</span></div>
    </div>
    <p v-if="format === 'json' && formattingError" class="formatting-error">{{ formattingError }}</p>

    <div v-if="format === 'protobuf'" class="proto-workspace">
      <div class="schema-source-pane">
        <div class="schema-heading-row">
          <div class="schema-select-wrap">
            <label class="sr-only" for="schema-select">选择 Schema</label>
            <select id="schema-select" v-model="selectedSchemaId" class="schema-select">
              <option v-for="schema in schemas" :key="schema.id" :value="schema.id">{{ schema.name }}</option>
            </select>
            <input v-if="selectedSchema" class="schema-name-edit" :value="selectedSchema.name" aria-label="Schema 名称" @change="setSchemaName(($event.target as HTMLInputElement).value)" />
          </div>
          <span class="schema-type-tag">proto3</span>
        </div>
        <CodeEditor v-model="schemaSource" class="schema-editor-host" language="protobuf" editor-label="Proto3 Schema 源码" />
        <div class="schema-footer">
          <span v-if="schemaSource.trim()" :class="parsedSchema.error ? 'validation-bad' : 'validation-good'">
            <i /> {{ parsedSchema.error ? 'Schema 有错误' : `${messageTypes.length} 个消息类型已识别` }}
          </span>
          <span v-else class="validation-bad"><i /> 请添加 Schema</span>
          <span class="editor-language">不支持外部 imports</span>
        </div>
        <p v-if="parsedSchema.error" class="schema-error">{{ parsedSchema.error }}</p>
      </div>

      <div class="field-form-pane">
        <div class="field-form-heading">
          <div>
            <p class="eyebrow">消息结构</p>
            <h3>字段值</h3>
          </div>
          <div class="field-form-tools">
            <select v-if="messageTypes.length" v-model="messageType" class="message-type-select" aria-label="选择消息类型">
              <option v-for="type in messageTypes" :key="type" :value="type">{{ type }}</option>
            </select>
            <button class="tool-button fill-button" type="button" :disabled="!fields.length" @click="fillEmptyFields">
              <IconSparkles aria-hidden="true" :size="14" />自动填充
            </button>
          </div>
          <span v-if="!messageTypes.length" class="empty-schema">等待有效 Schema</span>
        </div>

        <div v-if="fields.length" class="field-grid">
          <div v-for="field in fields" :key="field.id" class="proto-field-card">
            <div class="proto-field-top">
              <label class="proto-field-name" :for="`field-${field.name}`">{{ field.name }}</label>
              <span class="proto-field-type">{{ field.repeated ? 'repeated ' : '' }}{{ field.type }}</span>
            </div>
            <select
              v-if="field.kind === 'enum' && !field.repeated"
              :id="`field-${field.name}`"
              class="proto-control"
              :value="showValue(field) || field.enumValues?.[0]"
              @change="updateValue(field, $event)"
            >
              <option v-for="option in field.enumValues" :key="option" :value="option">{{ option }}</option>
            </select>
            <select v-else-if="field.type === 'bool' && field.kind === 'scalar'" :id="`field-${field.name}`" class="proto-control" :value="showValue(field) || 'false'" @change="updateValue(field, $event)">
              <option value="false">false</option><option value="true">true</option>
            </select>
            <textarea
              v-else-if="field.kind === 'message' || field.repeated"
              :id="`field-${field.name}`"
              class="proto-control json-value-control mono"
              :value="showValue(field)"
              placeholder="JSON 结构，例如 [1, 2]"
              @change="updateValue(field, $event)"
            />
            <input
              v-else
              :id="`field-${field.name}`"
              class="proto-control"
              :type="isNumberField(field) ? 'number' : 'text'"
              :value="showValue(field)"
              :placeholder="field.type === 'bytes' ? '十六进制或 Base64' : `输入 ${field.name}`"
              @input="updateValue(field, $event)"
            />
            <div v-if="field.type === 'bytes'" class="bytes-help">Hex，或以 <code>base64:</code> 开头</div>
            <div v-if="isNumberField(field)" class="range-control">
              <label><input type="checkbox" :checked="rangeFor(field).enabled" @change="updateRange(field, 'enabled', $event)" />动态范围</label>
              <template v-if="rangeFor(field).enabled">
                <input :value="rangeFor(field).min" type="number" :aria-label="`${field.name} 最小值`" @input="updateRange(field, 'min', $event)" />
                <span>至</span>
                <input :value="rangeFor(field).max" type="number" :aria-label="`${field.name} 最大值`" @input="updateRange(field, 'max', $event)" />
              </template>
            </div>
          </div>
        </div>
        <div v-else class="field-empty-state">
          <IconFileCode aria-hidden="true" class="empty-icon" :size="28" :stroke-width="1.5" />
          <strong>{{ parsedSchema.error ? 'Schema 尚不可用' : '选择一个消息类型' }}</strong>
          <small>修复 Schema 错误后，字段表单会自动生成。</small>
        </div>
        <p v-if="fillMessage" class="fill-feedback" role="status" aria-live="polite">{{ fillMessage }}</p>
        <div class="field-form-footnote"><span>字段值将在每次发送时编码</span><span>bytes 以二进制上行</span></div>
      </div>
    </div>

    <div class="template-help">
      <IconBulb aria-hidden="true" class="help-bulb" :size="16" :stroke-width="1.8" />
      <strong>动态变量</strong>
      <code v-for="variable in dynamicVariables" :key="variable">{{ variable }}</code>
      <span class="help-copy"><span>数值范围：</span><code class="comment-token">{{ randomIntToken }}</code><span>或</span><code class="comment-token">{{ randomFloatToken }}</code></span>
    </div>
  </section>
  </Teleport>
</template>

<style scoped>
.payload-card { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 18px; }
.payload-card.is-fullscreen { position: fixed; inset: 14px; z-index: 120; width: auto; height: auto; max-height: none; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 22px; box-shadow: 0 24px 90px #0008; }
.payload-heading { min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.payload-heading-actions { min-width: 0; display: flex; align-items: center; gap: 8px; }
.fullscreen-button { min-height: 32px; }
.fullscreen-button span { white-space: nowrap; }
.payload-heading h2 { margin: 2px 0 0; color: var(--ink); font-size: 15px; font-weight: 700; }
.eyebrow { margin: 0; color: var(--subtle); font-size: 10px; font-weight: 600; letter-spacing: .04em; }
.live-pill { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #5ad5a033; border-radius: 5px; padding: 5px 7px; color: var(--green); background: var(--green-soft); font-size: 10px; font-weight: 600; white-space: nowrap; }
.live-pill i, .schema-footer i, .validation-bad i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
.topic-row { display: grid; grid-template-columns: 104px minmax(0, 1fr); align-items: center; column-gap: 10px; row-gap: 5px; margin-bottom: 8px; }
.topic-title label { display: block; color: var(--ink-soft); font-size: 11px; font-weight: 650; }
.helper { display: block; margin-top: 3px; color: var(--muted); font-size: 10px; }
.topic-input-wrap { min-width: 0; height: 34px; display: flex; align-items: center; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface-input); overflow: hidden; }
.topic-input-wrap:focus-within { border-color: var(--focus-ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-ring) 22%, transparent); }
.topic-prefix { height: 100%; display: flex; align-items: center; padding: 0 9px; border-right: 1px solid var(--line); color: var(--subtle); background: var(--surface-muted); font: 650 9px var(--font-mono); letter-spacing: .04em; }
.topic-input { flex: 1; width: 0; height: 100%; border: 0; outline: 0; padding: 0 10px; color: var(--ink); background: transparent; font-size: 11px; }
.topic-hint { grid-column: 2; color: var(--subtle); font: 10px var(--font-mono); }
.editor-toolbar { min-height: 40px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--line); }
.format-tabs { display: flex; gap: 0; align-self: stretch; }
.format-tab { display: flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; color: var(--muted); background: transparent; font-size: 11px; font-weight: 550; cursor: pointer; transition: color .14s ease, background .14s ease; }
.format-tab:hover { color: var(--ink); }
.format-tab.active { color: var(--ink); border-bottom-color: var(--accent); background: color-mix(in srgb, var(--surface-raised) 72%, transparent); font-weight: 700; }
.format-mark { flex: 0 0 auto; }
.json-mark { color: var(--accent); }
.proto-mark { color: var(--accent); }
.toolbar-tools { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
.editor-language { color: var(--subtle); font: 9px var(--font-mono); white-space: nowrap; }
.tool-button { min-height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--line-strong); border-radius: 5px; padding: 0 8px; color: var(--ink-soft); background: var(--surface-raised); font-size: 10px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.tool-button:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.save-button { color: #062126; border-color: var(--accent); background: var(--accent); }
.save-button:hover { color: #062126; border-color: var(--accent-strong); background: var(--accent-strong); }
.import-button { position: relative; overflow: hidden; }
.import-button input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.json-editor-shell { flex: 1; min-height: 220px; display: grid; grid-template-rows: minmax(0, 1fr) 28px; margin-top: 10px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--code-surface); box-shadow: inset 0 1px 0 rgb(255 255 255 / 3%); }
.payload-card.is-fullscreen .json-editor-shell { min-height: 0; }
.json-editor-host { grid-row: 1; min-height: 0; }
.editor-status { grid-column: 1 / -1; grid-row: 2; display: flex; align-items: center; gap: 12px; padding: 0 10px; border-top: 1px solid var(--line); color: var(--subtle); background: var(--surface-muted); font: 9px var(--font-mono); }
.editor-status-good { margin-left: auto; color: var(--green); }
.formatting-error { margin: 6px 0 0; color: var(--danger); font-size: 10px; }
.proto-workspace { flex: 1; min-height: 280px; display: grid; grid-template-columns: minmax(0, .92fr) minmax(0, 1.08fr); gap: 9px; margin-top: 9px; }
.payload-card.is-fullscreen .proto-workspace { min-height: 0; }
.schema-source-pane, .field-form-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 7px; overflow: hidden; background: var(--surface-muted); }
.schema-source-pane { padding: 9px; }
.schema-heading-row { min-height: 32px; display: flex; align-items: center; gap: 7px; }
.schema-select-wrap { min-width: 0; display: flex; flex: 1; gap: 6px; }
.schema-select, .schema-name-edit { width: 0; min-width: 0; height: 30px; flex: 1; border: 1px solid var(--line-strong); border-radius: 5px; outline: none; padding: 0 7px; color: var(--ink-soft); background: var(--surface-input); font-size: 10px; }
.schema-select { flex: 0 1 45%; }
.schema-name-edit { flex: 1; }
.schema-type-tag { flex: 0 0 auto; border-radius: 4px; padding: 4px 6px; color: var(--accent); background: var(--accent-soft); font: 9px var(--font-mono); }
.schema-editor-host { flex: 1; min-height: 120px; margin-top: 7px; border: 1px solid var(--line); border-radius: 5px; overflow: hidden; background: var(--code-surface); }
.schema-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 7px; }
.schema-footer > span:first-child { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; }
.validation-good { color: var(--green); }
.validation-bad { color: var(--danger); }
.validation-bad i { background: var(--danger); }
.schema-error { margin: 7px 1px 0; color: var(--danger); font-size: 10px; line-height: 1.45; overflow-wrap: anywhere; }
.field-form-pane { padding: 10px; }
.field-form-heading { min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
.field-form-tools { min-width: 0; display: flex; align-items: center; gap: 6px; }
.fill-button { color: var(--accent); }
.fill-button:disabled { opacity: .45; cursor: not-allowed; }
.fill-feedback { margin: 5px 1px 0; color: var(--green); font-size: 10px; }
.field-form-heading h3 { margin: 2px 0 0; color: var(--ink-soft); font-size: 12px; }
.message-type-select { max-width: 58%; height: 29px; border: 1px solid var(--line-strong); border-radius: 5px; padding: 0 7px; color: var(--ink-soft); background: var(--surface-input); font-size: 10px; }
.empty-schema { color: var(--muted); font-size: 10px; }
.field-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 7px; overflow-y: auto; padding: 1px 2px 2px 1px; }
.proto-field-card { min-width: 0; padding: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.proto-field-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px; }
.proto-field-name { min-width: 0; overflow: hidden; color: var(--ink-soft); text-overflow: ellipsis; white-space: nowrap; font: 650 10px var(--font-mono); }
.proto-field-type { flex: 0 0 auto; color: var(--subtle); font: 9px var(--font-mono); }
.proto-control { display: block; width: 100%; height: 30px; border: 1px solid var(--line-strong); border-radius: 5px; padding: 0 7px; color: var(--ink); background: var(--surface-input); outline: none; font-size: 10px; }
.proto-control:focus { border-color: var(--focus-ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-ring) 22%, transparent); }
.json-value-control { height: 54px; padding: 6px 7px; resize: vertical; font: 9px/1.5 var(--font-mono); }
.bytes-help { margin-top: 4px; color: var(--muted); font-size: 9px; }
.bytes-help code { color: var(--accent); font: 9px var(--font-mono); }
.range-control { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-top: 6px; color: var(--muted); font-size: 9px; }
.range-control label { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.range-control input[type=checkbox] { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); }
.range-control input[type=number] { width: 52px; min-width: 0; height: 24px; border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 5px; color: var(--ink-soft); background: var(--surface-input); font: 9px var(--font-mono); }
.field-empty-state { flex: 1; min-height: 100px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: var(--muted); text-align: center; }
.empty-icon { color: var(--subtle); }
.field-empty-state strong { color: var(--ink-soft); font-size: 12px; }
.field-empty-state small { color: var(--muted); font-size: 10px; }
.field-form-footnote { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; color: var(--subtle); font-size: 9px; }
.template-help { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-height: 30px; margin-top: 8px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); background: var(--surface-muted); font-size: 10px; }
.help-bulb { flex: 0 0 auto; color: var(--accent); }
.template-help strong { color: var(--ink-soft); font-size: 10px; }
.template-help > code { border-radius: 4px; padding: 3px 6px; color: #0e7490; background: #ecfeff; font: 9px var(--font-mono); }
.help-copy { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-left: auto; color: var(--subtle); font-size: 9px; }
.template-help .comment-token { padding: 0; color: var(--subtle); background: transparent; font-size: 9px; }
:root:not([data-theme='light']) .template-help > code { color: #67e8f9; background: #083344; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1120px) {
  .payload-card { min-height: 580px; }
  .proto-workspace { min-height: 470px; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); }
  .help-copy { display: none; }
}
@media (max-width: 720px) {
  .payload-card { min-height: 760px; padding: 14px; }
  .topic-row { grid-template-columns: minmax(0, 1fr); }
  .topic-hint { grid-column: 1; }
  .editor-toolbar { align-items: flex-start; flex-direction: column; padding-top: 3px; }
  .toolbar-tools { width: 100%; justify-content: flex-start; flex-wrap: wrap; padding-bottom: 6px; }
  .editor-language { margin-right: auto; }
  .proto-workspace { min-height: 600px; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(210px, .8fr) minmax(330px, 1.2fr); }
  .field-grid { grid-template-columns: minmax(0, 1fr); }
  .field-form-heading { align-items: flex-start; flex-wrap: wrap; }
  .field-form-tools { width: 100%; }
  .field-form-tools .message-type-select { max-width: none; flex: 1; }
  .field-form-footnote { flex-wrap: wrap; }
  .payload-card.is-fullscreen { inset: 6px; padding: 12px; }
  .payload-card.is-fullscreen .proto-workspace { min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(190px, .8fr) minmax(250px, 1.2fr); }
}
</style>
