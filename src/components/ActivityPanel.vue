<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { IconActivity, IconArrowDownLeft, IconArrowUpRight, IconListDetails, IconMaximize, IconMinimize, IconTrash, IconX } from '@tabler/icons-vue'
import type { ActivityClearSelection, MessageEntry, ProtoSchemaEntry, SystemLogEntry } from '../types'
import { bytesFromHex, decodeProtoMessage, listProtoMessageTypes, parseProtoSchema } from '../lib/payload'
import { tweenElement } from '../lib/motion'

const tab = defineModel<'published' | 'received' | 'logs'>('tab', { required: true })
const decodeSchemaId = defineModel<string>('decodeSchemaId', { required: true })
const decodeMessageType = defineModel<string>('decodeMessageType', { required: true })

const props = defineProps<{
  published: MessageEntry[]
  received: MessageEntry[]
  logs: SystemLogEntry[]
  schemas: ProtoSchemaEntry[]
}>()

const selectedMessageId = defineModel<string>('selectedMessageId', { required: true })
const pendingMessageAnimations = new Set<string>()
let knownPublishedIds = new Set(props.published.map((entry) => entry.id))
let knownReceivedIds = new Set(props.received.map((entry) => entry.id))
const isFullscreen = ref(false)
const clearDialogOpen = ref(false)
const clearSelection = ref({ published: false, received: false, logs: false })
const clearDialogElement = ref<HTMLElement | null>(null)
const clearRecordsButtonElement = ref<HTMLButtonElement | null>(null)
const emit = defineEmits<{ clearRecords: [selection: ActivityClearSelection] }>()
const selectedMessage = computed(() => [...props.published, ...props.received].find((entry) => entry.id === selectedMessageId.value))
const clearOptions = computed(() => [
  { key: 'published' as const, label: '已发送', count: props.published.length },
  { key: 'received' as const, label: '已接收', count: props.received.length },
  { key: 'logs' as const, label: '系统日志', count: props.logs.length },
])
const hasClearSelection = computed(() => Object.values(clearSelection.value).some(Boolean))
const selectedFormatLabel = computed(() => {
  const message = selectedMessage.value
  if (!message) return ''
  if (message.payloadFormat === 'json') return 'JSON'
  if (message.payloadFormat === 'protobuf') return 'Protobuf'
  const contentType = message.properties.find(([name]) => name === 'contentType')?.[1]
  if (contentType) return contentType
  const formatIndicator = message.properties.find(([name]) => name === 'payloadFormatIndicator')?.[1]
  return formatIndicator === '1' ? 'UTF-8 文本' : '自动识别'
})
const inboundPreview = computed(() => {
  if (!selectedMessage.value) return ''
  try {
    return JSON.stringify(JSON.parse(selectedMessage.value.payloadPreview), null, 2)
  } catch {
    return selectedMessage.value.payloadHex || selectedMessage.value.payloadPreview
  }
})
const selectedSchema = computed(() => props.schemas.find((schema) => schema.id === decodeSchemaId.value))
const messageTypes = computed(() => {
  if (!selectedSchema.value) return []
  try { return listProtoMessageTypes(parseProtoSchema(selectedSchema.value.source)) } catch { return [] }
})
watch(messageTypes, (types) => {
  if (types.length && !types.includes(decodeMessageType.value)) decodeMessageType.value = types[0]!
}, { immediate: true })

const decoded = computed(() => {
  if (!selectedMessage.value || !selectedSchema.value || !decodeMessageType.value) return { value: null as unknown, error: '' }
  try {
    const root = parseProtoSchema(selectedSchema.value.source)
    const bytes = bytesFromHex(selectedMessage.value.payloadHex)
    return { value: decodeProtoMessage(root, decodeMessageType.value, bytes), error: '' }
  } catch (error) {
    return { value: null as unknown, error: error instanceof Error ? error.message : '解码失败。' }
  }
})

const visibleMessages = computed(() => tab.value === 'received' ? props.received : props.published)

function trackNewMessageIds(ids: string[], knownIds: Set<string>) {
  for (const id of ids) {
    if (!knownIds.has(id)) pendingMessageAnimations.add(id)
  }
  knownIds.clear()
  for (const id of ids) knownIds.add(id)
  while (pendingMessageAnimations.size > 200) {
    const oldestId = pendingMessageAnimations.values().next().value
    if (oldestId === undefined) break
    pendingMessageAnimations.delete(oldestId)
  }
}

watch(() => props.published.map((entry) => entry.id), (ids) => trackNewMessageIds(ids, knownPublishedIds))
watch(() => props.received.map((entry) => entry.id), (ids) => trackNewMessageIds(ids, knownReceivedIds))
watch(tab, () => pendingMessageAnimations.clear(), { flush: 'sync' })

function enterMessageRow(element: Element, done: () => void) {
  const row = element as HTMLElement
  const id = row.dataset.messageId
  if (!id || !pendingMessageAnimations.delete(id)) {
    done()
    return
  }
  tweenElement(row, { opacity: 0, y: 6 }, { opacity: 1, y: 0 }, 170, done)
}

function formatTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString('zh-CN', { hour12: false })
}

function selectMessage(entry: MessageEntry) {
  selectedMessageId.value = entry.id
}

function toggleFullscreen() {
  isFullscreen.value = !isFullscreen.value
  document.body.classList.toggle('activity-fullscreen-open', isFullscreen.value)
}

function openClearDialog() {
  clearSelection.value = { published: false, received: false, logs: false }
  clearDialogOpen.value = true
}

function closeClearDialog() {
  clearDialogOpen.value = false
  void nextTick(() => clearRecordsButtonElement.value?.focus())
}

function clearSelectedRecords() {
  if (!hasClearSelection.value) return
  emit('clearRecords', { ...clearSelection.value })
  closeClearDialog()
}

function handleClearDialogKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const focusable = clearDialogElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')
  if (!focusable?.length) return
  const first = focusable[0]!
  const last = focusable[focusable.length - 1]!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function handleFullscreenKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (clearDialogOpen.value) closeClearDialog()
  else if (isFullscreen.value) toggleFullscreen()
}

watch(clearDialogOpen, async (open) => {
  if (!open) return
  await nextTick()
  clearDialogElement.value?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
})

onMounted(() => window.addEventListener('keydown', handleFullscreenKeydown))
onUnmounted(() => {
  window.removeEventListener('keydown', handleFullscreenKeydown)
  document.body.classList.remove('activity-fullscreen-open')
})
</script>

<template>
  <Teleport to="body" :disabled="!isFullscreen">
  <section class="panel-card activity-card" :class="{ 'is-fullscreen': isFullscreen }">
    <div class="activity-topbar">
      <div class="activity-title">
        <div class="activity-icon"><IconListDetails aria-hidden="true" :size="19" :stroke-width="1.8" /></div>
        <div><h2>消息记录</h2></div>
      </div>
      <div class="activity-tabs" role="tablist">
        <button :class="{ active: tab === 'published' }" type="button" @click="tab = 'published'">已发送 <span>{{ published.length }}</span></button>
        <button :class="{ active: tab === 'received' }" type="button" @click="tab = 'received'">已接收 <span>{{ received.length }}</span></button>
        <button :class="{ active: tab === 'logs' }" type="button" @click="tab = 'logs'">系统日志 <span>{{ logs.length }}</span></button>
      </div>
      <div class="activity-cap">最多保留 200 条</div>
      <div class="activity-header-actions">
        <button ref="clearRecordsButtonElement" class="activity-clear-button" type="button" aria-label="清空记录" title="选择要清空的记录" @click="openClearDialog">
          <IconTrash aria-hidden="true" :size="15" />
          <span>清空记录</span>
        </button>
        <button class="activity-fullscreen-button" type="button" :aria-label="isFullscreen ? '退出消息记录全屏' : '全屏查看消息记录'" :title="isFullscreen ? '退出全屏' : '全屏查看'" @click="toggleFullscreen">
          <IconMinimize v-if="isFullscreen" aria-hidden="true" :size="16" />
          <IconMaximize v-else aria-hidden="true" :size="16" />
          <span>{{ isFullscreen ? '退出全屏' : '全屏' }}</span>
        </button>
      </div>
    </div>

    <div v-if="tab !== 'logs'" class="activity-content">
      <div class="message-list">
        <div class="table-head">
          <span>TOPIC</span><span>DEVICE</span><span>PAYLOAD</span><span>QOS</span><span>STATUS</span><span>TIME</span>
        </div>
        <TransitionGroup tag="div" class="message-row-group" :css="false" @enter="enterMessageRow">
          <button v-for="entry in visibleMessages.slice().reverse()" :key="entry.id" :data-message-id="entry.id" class="message-row" :class="{ selected: selectedMessageId === entry.id }" type="button" @click="selectMessage(entry)">
            <span class="message-topic mono"><IconArrowUpRight v-if="entry.direction === 'out'" aria-hidden="true" class="out-arrow" :size="15" /><IconArrowDownLeft v-else aria-hidden="true" class="in-arrow" :size="15" />{{ entry.topic }}</span>
            <span class="message-device mono">{{ entry.deviceId || '订阅客户端' }}</span>
            <span class="message-payload mono">{{ entry.payloadPreview || entry.payloadHex || '（空载荷）' }}</span>
            <span class="message-qos">{{ entry.qos }}</span>
            <span class="message-status"><i />{{ entry.direction === 'out' ? (entry.qos === 0 ? '已发送·未确认' : '已确认') : entry.retain ? '保留消息' : '已接收' }}</span>
            <span class="message-time mono">{{ formatTime(entry.timestamp) }}</span>
          </button>
        </TransitionGroup>
        <div v-if="!visibleMessages.length" class="empty-activity">
          <IconActivity aria-hidden="true" class="empty-activity-icon" :size="60" :stroke-width="1.25" />
          <strong>{{ tab === 'published' ? '还没有发送消息' : '还没有收到消息' }}</strong>
          <small>{{ tab === 'published' ? '连接设备并开始发送后，消息会显示在这里。' : '启动订阅监听后，Broker 消息会显示在这里。' }}</small>
        </div>
      </div>

      <aside class="message-detail">
        <div class="detail-heading">
          <div><strong>消息载荷</strong></div>
          <div v-if="tab === 'received' && schemas.length" class="decode-selects">
            <select v-model="decodeSchemaId" aria-label="选择解码 Schema">
              <option value="">Hex 预览</option>
              <option v-for="schema in schemas" :key="schema.id" :value="schema.id">{{ schema.name }}</option>
            </select>
            <select v-if="messageTypes.length" v-model="decodeMessageType" aria-label="选择解码类型">
              <option v-for="type in messageTypes" :key="type" :value="type">{{ type }}</option>
            </select>
          </div>
        </div>
        <div v-if="selectedMessage" class="detail-body">
          <div class="detail-topic mono">{{ selectedMessage.topic }}</div>
          <div v-if="tab === 'received'" class="message-metadata">
            <span>QoS {{ selectedMessage.qos }}</span>
            <span>{{ selectedMessage.retain ? 'Retain' : '非 Retain' }}</span>
            <span>{{ selectedFormatLabel }}</span>
            <span>{{ formatTime(selectedMessage.timestamp) }}</span>
          </div>
          <div v-if="tab === 'received' && decodeSchemaId && decoded.error" class="decode-error">解码失败：{{ decoded.error }}</div>
          <pre v-else-if="tab === 'received' && decodeSchemaId && decoded.value !== null" class="payload-pre mono">{{ JSON.stringify(decoded.value, null, 2) }}</pre>
          <pre v-else-if="tab === 'received' && decodeSchemaId" class="payload-pre mono">{{ selectedMessage.payloadHex || '（空载荷）' }}</pre>
          <pre v-else-if="tab === 'received'" class="payload-pre mono">{{ inboundPreview || '（空载荷）' }}</pre>
          <pre v-else class="payload-pre mono">{{ selectedMessage.payloadPreview || selectedMessage.payloadHex || '（空载荷）' }}</pre>
          <div v-if="tab === 'received' && selectedMessage.payloadHex" class="hex-preview"><span>HEX</span><code>{{ selectedMessage.payloadHex }}</code></div>
          <div v-if="tab === 'received' && selectedMessage.properties.length" class="mqtt-properties">
            <strong>MQTT 5 属性</strong>
            <div v-for="([name, value], index) in selectedMessage.properties" :key="`${name}-${index}`" class="mqtt-property-row">
              <span>{{ name }}</span><code>{{ value }}</code>
            </div>
          </div>
        </div>
        <div v-else class="detail-placeholder">选择一条消息查看载荷内容</div>
      </aside>
    </div>

    <div v-else class="log-list">
      <div v-for="entry in logs.slice().reverse()" :key="entry.id" class="log-row">
        <span class="log-time mono">{{ formatTime(entry.timestamp) }}</span>
        <span class="log-level" :class="`level-${entry.level}`">{{ { info: 'INFO', success: 'OK', warning: 'WARN', error: 'ERR' }[entry.level] }}</span>
        <span class="log-message">{{ entry.message }}</span>
      </div>
      <div v-if="!logs.length" class="empty-activity compact"><strong>暂无系统日志</strong><small>连接状态和发送结果会显示在这里。</small></div>
    </div>
  </section>
  </Teleport>

  <Teleport to="body">
    <div v-if="clearDialogOpen" class="dialog-backdrop activity-clear-backdrop" role="presentation" @click.self="closeClearDialog">
      <section ref="clearDialogElement" class="dialog-surface clear-record-dialog" role="dialog" aria-modal="true" aria-labelledby="clear-record-title" @keydown="handleClearDialogKeydown">
        <header class="clear-dialog-heading">
          <div class="clear-dialog-icon"><IconTrash aria-hidden="true" :size="18" /></div>
          <div>
            <h2 id="clear-record-title">清空消息记录</h2>
            <p>选择要清除的记录类型和范围。</p>
          </div>
          <button class="clear-dialog-close" type="button" aria-label="关闭清空记录" @click="closeClearDialog"><IconX aria-hidden="true" :size="17" /></button>
        </header>

        <fieldset class="clear-record-options">
          <legend class="sr-only">选择要清空的记录类型</legend>
          <label v-for="option in clearOptions" :key="option.key" class="clear-record-option" :class="{ unavailable: option.count === 0 }">
            <input v-model="clearSelection[option.key]" type="checkbox" :disabled="option.count === 0" />
            <span>{{ option.label }}</span>
            <small>{{ option.count }} 条</small>
          </label>
        </fieldset>

        <p class="clear-dialog-note">清空后无法恢复。此操作只影响当前运行期间的记录。</p>
        <footer class="clear-dialog-actions">
          <button class="clear-cancel-button" type="button" @click="closeClearDialog">取消</button>
          <button class="clear-confirm-button" type="button" :disabled="!hasClearSelection" @click="clearSelectedRecords">清空所选记录</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.activity-card { min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.activity-card.is-fullscreen { position: fixed; inset: 14px; z-index: 120; width: auto; height: auto; min-height: 0; max-height: none; overflow: hidden; border-color: var(--line-strong); border-radius: 12px; box-shadow: 0 24px 90px #0008; }
.activity-card:not(.is-fullscreen) .activity-topbar { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "title actions" "tabs tabs"; align-items: center; gap: 6px 10px; padding: 10px 12px 0; }
.activity-card:not(.is-fullscreen) .activity-title { grid-area: title; min-width: 0; }
.activity-card:not(.is-fullscreen) .activity-tabs { grid-area: tabs; width: 100%; min-width: 0; height: 38px; justify-content: space-between; gap: 8px; margin: 0; }
.activity-card:not(.is-fullscreen) .activity-cap { display: none; }
.activity-card:not(.is-fullscreen) .activity-header-actions { grid-area: actions; margin-left: 0; }
.activity-topbar { min-height: 62px; display: flex; align-items: center; gap: 18px; padding: 0 18px; border-bottom: 1px solid var(--line); }
.activity-header-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; margin-left: auto; }
.activity-title { display: flex; align-items: center; gap: 9px; flex: 0 0 auto; }
.activity-icon { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 7px; color: var(--accent); background: var(--accent-soft); }
.activity-title h2 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 700; }
.activity-tabs { align-self: stretch; display: flex; align-items: stretch; gap: 14px; margin-left: auto; }
.activity-tabs button { position: relative; display: flex; align-items: center; gap: 6px; padding: 0 2px; border: 0; color: var(--muted); background: transparent; font-size: 11px; font-weight: 500; cursor: pointer; transition: color .14s ease; }
.activity-tabs button::after { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; border-radius: 999px; background: transparent; content: ''; transform: scaleX(.55); transition: background .14s ease, transform .14s ease; }
.activity-tabs button:hover { color: var(--ink); }
.activity-tabs button.active { color: var(--accent); font-weight: 600; }
.activity-tabs button.active::after { background: var(--accent); transform: scaleX(1); }
.activity-tabs button span { min-width: 19px; padding: 3px 5px; border-radius: 4px; color: var(--muted); background: var(--surface-raised); font: 10px var(--font-mono); text-align: center; }
.activity-tabs button.active span { color: var(--accent); background: var(--accent-soft); }
.activity-cap { color: var(--subtle); font-size: 10px; white-space: nowrap; }
.activity-clear-button, .activity-fullscreen-button { min-height: 31px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 0 8px; color: var(--ink-soft); background: var(--surface-raised); font-size: 10px; font-weight: 650; white-space: nowrap; cursor: pointer; }
.activity-clear-button { color: var(--danger); }
.activity-clear-button:hover { border-color: var(--danger); background: var(--danger-soft); }
.activity-fullscreen-button { margin-left: 0; }
.activity-fullscreen-button:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.activity-content { flex: 1; min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(180px, .9fr) minmax(180px, 1.1fr); }
.activity-content > * { min-width: 0; }
.activity-card:not(.is-fullscreen) .table-head, .activity-card:not(.is-fullscreen) .message-row { grid-template-columns: minmax(0, 1fr) 34px 67px 60px; gap: 5px; min-width: 0; padding-inline: 9px; }
.activity-card:not(.is-fullscreen) .table-head > span:nth-child(2), .activity-card:not(.is-fullscreen) .table-head > span:nth-child(3), .activity-card:not(.is-fullscreen) .message-row > span:nth-child(2), .activity-card:not(.is-fullscreen) .message-row > span:nth-child(3) { display: none; }
.activity-card:not(.is-fullscreen) .table-head { height: 32px; }
.activity-card:not(.is-fullscreen) .message-row { min-height: 38px; }
.message-list { min-width: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
.message-row-group { display: contents; }
.table-head, .message-row { display: grid; grid-template-columns: minmax(150px, 1.2fr) minmax(90px, .72fr) minmax(170px, 1.35fr) 52px 124px 92px; align-items: center; gap: 12px; }
.table-head { position: sticky; top: 0; z-index: 1; min-width: 820px; height: 38px; padding: 0 16px; color: var(--subtle); background: color-mix(in srgb, var(--surface-muted) 50%, transparent); border-bottom: 1px solid var(--line); font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
.message-row { width: 100%; min-width: 820px; min-height: 42px; padding: 0 16px; border: 0; border-bottom: 1px solid var(--line); color: var(--ink-soft); background: var(--surface); text-align: left; cursor: pointer; transition: background .12s ease; }
.message-row:hover { background: var(--surface-raised); }
.message-row.selected { background: var(--accent-soft); }
.message-row > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mono { font-family: var(--font-mono); }
.message-topic { display: flex; align-items: center; gap: 6px; color: var(--ink-soft); font-size: 10px; }
.out-arrow { flex: 0 0 auto; color: var(--green); }
.in-arrow { flex: 0 0 auto; color: var(--accent); }
.message-device, .message-time { color: var(--muted); font-size: 10px; }
.message-payload { color: var(--subtle); font-size: 10px; }
.message-qos { color: var(--muted); font: 10px var(--font-mono); text-align: center; }
.message-status { display: flex; align-items: center; justify-content: center; gap: 6px; color: var(--green); font-size: 10px; font-weight: 600; white-space: nowrap; }
.message-time { text-align: center; }
.message-status i { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; background: var(--green); }
.message-row:has(.in-arrow) .message-status { color: var(--accent); }
.message-row:has(.in-arrow) .message-status i { background: var(--accent); }
.empty-activity { min-height: 180px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; color: var(--muted); text-align: center; padding: 24px 16px; }
.empty-activity-icon { margin-bottom: 3px; color: var(--empty-state-icon); }
.empty-activity strong { color: var(--ink-soft); font-size: 12px; font-weight: 600; }
.empty-activity small { max-width: 360px; color: var(--subtle); font-size: 11px; line-height: 1.55; }
.activity-card:not(.is-fullscreen) .message-detail { border-left: 0; border-top: 1px solid var(--line); }
.message-detail { min-width: 0; display: flex; flex-direction: column; border-left: 1px solid var(--line); background: var(--surface-muted); }
.detail-heading { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--line); }
.detail-heading > * { min-width: 0; }
.detail-heading strong { display: block; color: var(--ink-soft); font-size: 11px; font-weight: 650; }
.decode-selects { display: flex; gap: 5px; min-width: 0; }
.decode-selects select { max-width: 130px; height: 28px; min-width: 0; border: 1px solid var(--line-strong); border-radius: 5px; padding: 0 6px; color: var(--ink-soft); background: var(--surface-input); font-size: 10px; }
.detail-body { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: auto; padding: 10px 12px; }
.detail-topic { overflow: hidden; margin-bottom: 8px; color: var(--accent); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.message-metadata { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 8px; color: var(--muted); font-size: 9px; }
.message-metadata span { border-radius: 4px; padding: 4px 5px; background: var(--surface-raised); }
.payload-pre { min-height: 0; flex: 1; overflow: auto; margin: 0; color: var(--ink-soft); font-size: 10px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.hex-preview { display: flex; align-items: flex-start; gap: 7px; margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--line); color: var(--muted); font: 9px var(--font-mono); }
.hex-preview code { overflow-wrap: anywhere; color: var(--ink-soft); }
.mqtt-properties { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--line); }
.mqtt-properties > strong { display: block; margin-bottom: 5px; color: var(--ink-soft); font-size: 10px; font-weight: 650; }
.mqtt-property-row { display: grid; grid-template-columns: minmax(80px, .8fr) minmax(0, 1.2fr); gap: 7px; padding: 4px 0; color: var(--muted); font: 9px var(--font-mono); }
.mqtt-property-row code { min-width: 0; overflow-wrap: anywhere; color: var(--ink-soft); }
.decode-error { border-radius: 5px; padding: 7px 8px; color: var(--danger); background: var(--danger-soft); font-size: 10px; line-height: 1.5; }
.detail-placeholder { flex: 1; display: grid; place-items: center; padding: 14px; color: var(--muted); font-size: 11px; text-align: center; }
.log-list { flex: 1; min-height: 0; overflow: auto; padding: 4px 0; }
.log-row { min-height: 34px; display: grid; grid-template-columns: 74px 48px minmax(0, 1fr); align-items: center; gap: 9px; padding: 0 13px; border-bottom: 1px solid var(--line); }
.log-time { color: var(--muted); font-size: 9px; }
.log-level { display: inline-flex; align-items: center; justify-content: center; height: 18px; border-radius: 4px; font: 700 9px var(--font-mono); }
.level-info { color: var(--accent); background: var(--accent-soft); }
.level-success { color: var(--green); background: var(--green-soft); }
.level-warning { color: var(--amber); background: var(--amber-soft); }
.level-error { color: var(--danger); background: var(--danger-soft); }
.log-message { overflow: hidden; color: var(--ink-soft); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.compact { min-height: 110px; }
.activity-card.is-fullscreen .activity-topbar { min-height: 66px; padding-inline: 20px; }
.activity-card.is-fullscreen .activity-title h2 { font-size: 15px; }
.activity-card.is-fullscreen .activity-content { grid-template-columns: minmax(0, 1.2fr) minmax(340px, .8fr); }
.activity-card.is-fullscreen .message-detail { min-height: 0; }
.activity-card.is-fullscreen .detail-body { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 16px; }
.activity-card.is-fullscreen .payload-pre { max-height: none; min-height: 150px; flex: 1; font-size: 12px; }
.activity-card.is-fullscreen .message-row { min-height: 46px; }
.activity-card.is-fullscreen .log-row { min-height: 42px; align-items: start; padding-block: 9px; }
.activity-card.is-fullscreen .log-message { overflow: visible; overflow-wrap: anywhere; text-overflow: clip; white-space: normal; line-height: 1.55; }
.activity-clear-backdrop { z-index: 220; }
.clear-record-dialog { width: min(440px, 100%); padding: 20px; }
.clear-dialog-heading { display: flex; align-items: center; gap: 11px; }
.clear-dialog-icon { width: 36px; height: 36px; display: grid; flex: 0 0 36px; place-items: center; border-radius: 9px; color: var(--danger); background: var(--danger-soft); }
.clear-dialog-heading h2 { margin: 0; color: var(--ink); font-size: 15px; }
.clear-dialog-heading p { margin: 4px 0 0; color: var(--muted); font-size: 10px; }
.clear-dialog-close { width: 30px; height: 30px; display: grid; flex: 0 0 30px; place-items: center; margin-left: auto; border: 1px solid transparent; border-radius: 7px; color: var(--muted); background: transparent; cursor: pointer; }
.clear-dialog-close:hover { color: var(--ink); border-color: var(--line); background: var(--surface-raised); }
.clear-record-options { display: grid; gap: 7px; margin: 17px 0 0; border: 0; padding: 0; }
.clear-record-option { min-height: 43px; display: flex; align-items: center; gap: 9px; border: 1px solid var(--line); border-radius: 7px; padding: 0 10px; color: var(--ink-soft); background: var(--surface-muted); font-size: 11px; cursor: pointer; }
.clear-record-option:has(input:checked) { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); background: var(--danger-soft); }
.clear-record-option input { width: 15px; height: 15px; flex: 0 0 auto; accent-color: var(--danger); }
.clear-record-option small { margin-left: auto; color: var(--muted); font: 10px var(--font-mono); }
.clear-record-option.unavailable { opacity: .55; cursor: not-allowed; }
.clear-dialog-note { margin: 12px 0 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
.clear-dialog-actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 18px; }
.clear-dialog-actions button { min-height: 32px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 0 10px; font-size: 10px; font-weight: 650; cursor: pointer; }
.clear-cancel-button { color: var(--ink-soft); background: var(--surface-raised); }
.clear-confirm-button { border-color: var(--danger) !important; color: #fff; background: var(--danger); }
.clear-confirm-button:hover:not(:disabled) { filter: brightness(.92); }
.clear-confirm-button:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 1120px) {
  .activity-card { min-height: 372px; }
  .activity-card:not(.is-fullscreen) .activity-content { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(150px, auto) minmax(160px, 230px); }
  .message-detail { border-left: 0; border-top: 1px solid var(--line); }
  .activity-card.is-fullscreen .activity-content { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) minmax(240px, .8fr); }
}
@media (max-width: 680px) {
  .activity-topbar { flex-wrap: wrap; gap: 0 10px; padding: 8px 10px 0; }
  .activity-title { min-height: 38px; }
  .activity-header-actions { margin-left: auto; }
  .activity-tabs { width: 100%; height: 38px; justify-content: space-between; gap: 8px; margin: 0; }
  .activity-cap { display: none; }
  .activity-fullscreen-button { margin-left: 0; }
  .activity-card.is-fullscreen { inset: 6px; }
  .activity-card.is-fullscreen .activity-topbar { gap: 0 10px; padding: 8px 10px 0; }
  .activity-card.is-fullscreen .activity-content { grid-template-rows: minmax(200px, .9fr) minmax(220px, 1.1fr); }
  .activity-card.is-fullscreen .message-detail { border-top: 1px solid var(--line); }
  .table-head { min-width: 820px; }
  .detail-heading { flex-wrap: wrap; padding: 8px 10px; }
  .decode-selects { width: 100%; }
  .decode-selects select { max-width: none; flex: 1; }
}
</style>
