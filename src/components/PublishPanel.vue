<script setup lang="ts">
import type { DeviceStatus, MqttVersion, PublishOptions } from '../types'
import { IconBroadcast, IconChevronDown, IconChevronLeft, IconChevronRight, IconChevronUp, IconClock, IconInfoCircle, IconLock, IconMouse, IconPlayerPlay, IconPlayerStop, IconPlus, IconSend, IconX } from '@tabler/icons-vue'

const options = defineModel<PublishOptions>('options', { required: true })
const collapsed = defineModel<boolean>('collapsed', { required: true })
const mode = defineModel<'manual' | 'periodic'>('mode', { required: true })
const intervalSeconds = defineModel<number>('intervalSeconds', { required: true })
const countPerDevice = defineModel<number | null>('countPerDevice', { required: true })
const monitorTopics = defineModel<string>('monitorTopics', { required: true })

const props = defineProps<{
  mqttVersion: MqttVersion
  devices: DeviceStatus[]
  running: boolean
  scheduleRunning: boolean
  monitorRunning: boolean
  monitorEnabled: boolean
  successCount: number
  failureCount: number
}>()

const emit = defineEmits<{
  publish: []
  startSchedule: []
  stopSchedule: []
  startMonitor: []
  stopMonitor: []
}>()

const onlineCount = () => props.devices.filter((device) => device.status === 'connected').length

function updateOption<K extends keyof PublishOptions>(key: K, value: PublishOptions[K]) {
  options.value = { ...options.value, [key]: value }
}

function updateUserProperty(index: number, key: 0 | 1, value: string) {
  const next = options.value.userProperties.map((entry, entryIndex) => {
    if (entryIndex !== index) return entry
    const updated: [string, string] = [...entry]
    updated[key] = value
    return updated
  })
  updateOption('userProperties', next)
}

function addUserProperty() {
  updateOption('userProperties', [...options.value.userProperties, ['', '']])
}

function removeUserProperty(index: number) {
  updateOption('userProperties', options.value.userProperties.filter((_, entryIndex) => entryIndex !== index))
}

function updateCount(value: string) {
  const parsed = Number(value)
  countPerDevice.value = value === '' ? null : Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : null
}
</script>

<template>
  <aside class="publish-column" :class="{ 'is-collapsed': collapsed }">
    <section v-if="collapsed" class="panel-card panel-rail publish-rail">
      <button class="panel-rail-toggle" type="button" aria-label="展开发送控制" title="展开发送控制" :aria-expanded="false" @click="collapsed = false">
        <span class="panel-rail-icon send-icon"><IconSend aria-hidden="true" :size="18" :stroke-width="1.8" /></span>
        <span class="panel-rail-title">发送控制</span>
        <span class="panel-rail-summary">{{ onlineCount() }} 台在线 · QoS {{ options.qos }}<template v-if="scheduleRunning"> · 定时发送中</template><template v-if="monitorRunning"> · 监听中</template></span>
        <IconChevronDown class="panel-rail-chevron" aria-hidden="true" :size="16" />
      </button>
      <span class="panel-rail-status" role="status" :aria-label="`${onlineCount()} 台设备在线`" :title="`${onlineCount()} 台设备在线`">
        <i class="panel-rail-dot" :class="onlineCount() > 0 ? 'is-green' : 'is-muted'" />{{ onlineCount() }} 台在线
      </span>
    </section>

    <section v-else class="panel-card publish-card">
      <div class="publish-heading">
        <div class="heading-icon send-icon"><IconSend aria-hidden="true" :size="19" :stroke-width="1.8" /></div>
        <div>
          <h2>发送控制</h2>
        </div>
        <span class="active-devices"><i /> {{ onlineCount() }} 在线</span>
        <button class="icon-button subtle panel-collapse-button" type="button" aria-label="收起发送控制" title="收起发送控制" :aria-expanded="true" @click="collapsed = true"><IconChevronUp aria-hidden="true" :size="18" /></button>
      </div>

      <div class="mode-tabs">
        <button :class="{ selected: mode === 'manual' }" type="button" @click="mode = 'manual'"><IconMouse aria-hidden="true" :size="16" />手动发送</button>
        <button :class="{ selected: mode === 'periodic' }" type="button" @click="mode = 'periodic'"><IconClock aria-hidden="true" :size="16" />定时发送</button>
      </div>

      <div class="publish-option-block">
        <div class="control-label-row">
          <span>服务质量 <small>QoS</small></span>
          <span class="tiny-help">按设备连接</span>
        </div>
        <div class="qos-options" role="radiogroup" aria-label="服务质量等级">
          <button v-for="level in [0, 1, 2] as const" :key="level" :class="{ active: options.qos === level }" type="button" role="radio" :aria-checked="options.qos === level" @click="updateOption('qos', level)">
            <strong>{{ level }}</strong><small>{{ ['至多一次', '至少一次', '恰好一次'][level] }}</small>
          </button>
        </div>
      </div>

      <div class="retain-line">
        <div>
          <strong>Retain 保留消息</strong>
          <span>Broker 保存该主题的最后一条消息</span>
        </div>
        <button class="toggle" :class="{ on: options.retain }" type="button" role="switch" :aria-checked="options.retain" @click="updateOption('retain', !options.retain)"><span /></button>
      </div>

      <div v-if="mode === 'periodic'" class="schedule-settings">
        <div class="field-row">
          <div class="field-block grow">
            <label class="control-label" for="publish-interval">发送间隔</label>
            <div class="input-suffix-wrap"><input id="publish-interval" v-model.number="intervalSeconds" class="control-input mono" type="number" min="0.1" step="0.1" /><span>秒</span></div>
          </div>
          <div class="field-block grow">
            <label class="control-label" for="publish-count">每台发送次数</label>
            <div class="input-suffix-wrap"><input id="publish-count" :value="countPerDevice ?? ''" class="control-input mono" type="number" min="1" placeholder="不限" @input="updateCount(($event.target as HTMLInputElement).value)" /><span>次</span></div>
          </div>
        </div>
        <p class="schedule-note"><IconInfoCircle aria-hidden="true" :size="15" />断线设备会暂停；恢复连接后从下一次间隔继续。</p>
      </div>

      <details v-if="props.mqttVersion === '5.0'" class="mqtt5-details">
        <summary><span>MQTT 5.0 发布属性</span><IconChevronDown aria-hidden="true" class="summary-caret" :size="16" /></summary>
        <div class="mqtt5-fields">
          <div class="field-row">
            <div class="field-block grow">
              <label class="control-label" for="message-expiry">消息过期</label>
              <div class="input-suffix-wrap"><input id="message-expiry" class="control-input mono" :value="options.messageExpirySeconds ?? ''" type="number" min="0" placeholder="默认" @input="updateOption('messageExpirySeconds', ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value))" /><span>秒</span></div>
            </div>
            <div class="field-block grow">
              <label class="control-label" for="content-type">Content Type</label>
              <input id="content-type" class="control-input" :value="options.contentType ?? ''" placeholder="application/json" @input="updateOption('contentType', ($event.target as HTMLInputElement).value || null)" />
            </div>
          </div>
          <div class="field-block">
            <label class="control-label" for="response-topic">Response Topic</label>
            <input id="response-topic" class="control-input mono" :value="options.responseTopic ?? ''" placeholder="留空则不发送" @input="updateOption('responseTopic', ($event.target as HTMLInputElement).value || null)" />
          </div>
          <div class="field-block">
            <label class="control-label" for="correlation-data">Correlation Data <small>Base64</small></label>
            <input id="correlation-data" class="control-input mono" :value="options.correlationDataBase64 ?? ''" placeholder="可选" @input="updateOption('correlationDataBase64', ($event.target as HTMLInputElement).value || null)" />
          </div>
          <div class="properties-heading"><span class="control-label">User Properties</span><button type="button" @click="addUserProperty"><IconPlus aria-hidden="true" :size="15" />添加</button></div>
          <div v-for="(pair, index) in options.userProperties" :key="index" class="property-row">
            <input class="control-input" :value="pair[0]" placeholder="Key" @input="updateUserProperty(index, 0, ($event.target as HTMLInputElement).value)" />
            <input class="control-input" :value="pair[1]" placeholder="Value" @input="updateUserProperty(index, 1, ($event.target as HTMLInputElement).value)" />
            <button class="remove-property" type="button" aria-label="删除属性" @click="removeUserProperty(index)"><IconX aria-hidden="true" :size="16" /></button>
          </div>
        </div>
      </details>
      <div v-else class="mqtt-version-note"><IconLock aria-hidden="true" :size="16" />MQTT 5.0 属性在当前协议版本中不可用</div>

      <div class="send-actions">
        <button v-if="mode === 'manual'" class="send-button" :disabled="!running || onlineCount() === 0" type="button" @click="emit('publish')">
          <IconSend aria-hidden="true" class="send-arrow" :size="17" />立即发送一轮
        </button>
        <button v-else-if="!scheduleRunning" class="send-button" :disabled="!running || onlineCount() === 0" type="button" @click="emit('startSchedule')"><IconPlayerPlay aria-hidden="true" class="send-arrow" :size="17" />开始定时发送</button>
        <button v-else class="send-button stop-schedule" type="button" @click="emit('stopSchedule')"><IconPlayerStop aria-hidden="true" class="send-arrow" :size="17" />停止定时发送</button>
        <div class="counter-row">
          <div><span class="counter-value success-value">{{ successCount }}</span><span>成功</span></div>
          <span class="counter-divider" />
          <div><span class="counter-value failure-value">{{ failureCount }}</span><span>失败</span></div>
          <div class="counter-devices">{{ devices.length }} 台设备</div>
        </div>
      </div>

      <div class="section-divider" />
      <div class="monitor-heading">
        <div><h3>消息订阅</h3></div>
        <span class="monitor-status" :class="{ live: monitorRunning }"><i />{{ monitorRunning ? '监听中' : '未启动' }}</span>
      </div>
      <label class="sr-only" for="monitor-topics">订阅主题过滤器</label>
      <textarea id="monitor-topics" v-model="monitorTopics" class="monitor-input mono" rows="2" placeholder="输入主题过滤器，每行一个&#10;例如：sensors/+/telemetry" />
      <button v-if="!monitorRunning" class="monitor-button" :disabled="!monitorEnabled" type="button" @click="emit('startMonitor')"><IconBroadcast aria-hidden="true" :size="16" />开始监听</button>
      <button v-else class="monitor-button stop-monitor" type="button" @click="emit('stopMonitor')"><IconPlayerStop aria-hidden="true" :size="16" />停止监听</button>
      <p class="monitor-caption">使用独立监视客户端订阅，不占用模拟设备连接</p>
    </section>
  </aside>
</template>

<style scoped>
.publish-column { min-width: 0; }
.publish-column.is-collapsed { overflow: hidden; }
.publish-card { padding: 16px; }
.publish-heading { min-height: 34px; display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.heading-icon { width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center; border-radius: 7px; }
.send-icon { color: var(--accent); background: var(--accent-soft); }
.publish-heading h2 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 700; }
.active-devices { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; border-radius: 5px; padding: 5px 7px; color: var(--green); background: var(--green-soft); font-size: 10px; white-space: nowrap; }
.active-devices i, .monitor-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
.mode-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px; margin-bottom: 15px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-muted); }
.mode-tabs button { min-height: 34px; display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 6px; color: var(--muted); background: transparent; font-size: 11px; font-weight: 550; cursor: pointer; transition: color .14s ease, background .14s ease, box-shadow .14s ease; }
.mode-tabs button.selected { color: var(--ink); background: var(--surface); box-shadow: 0 1px 3px rgb(15 23 42 / 12%); font-weight: 700; }
.publish-option-block { margin-bottom: 12px; }
.control-label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; color: var(--ink-soft); font-size: 11px; font-weight: 650; }
.control-label-row small { margin-left: 4px; color: var(--muted); font: 10px var(--font-mono); }
.tiny-help { color: var(--subtle); font-size: 10px; font-weight: 450; }
.qos-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px; padding: 3px; border: 0; border-radius: 8px; background: #1e293b; }
.qos-options button { min-width: 0; min-height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: 0; border-radius: 6px; color: var(--muted); background: transparent; cursor: pointer; transition: color .14s ease, background .14s ease, box-shadow .14s ease; }
.qos-options button:hover { color: var(--ink-soft); }
.qos-options button.active { color: var(--ink); background: var(--surface); box-shadow: 0 1px 3px rgb(15 23 42 / 18%); }
.qos-options button strong { font: 700 13px var(--font-mono); }
.qos-options button small { color: var(--muted); font-size: 9px; white-space: nowrap; }
:root[data-theme='light'] .qos-options { background: #f1f5f9; }
.retain-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 0 1px 11px; border-bottom: 1px solid var(--line); }
.retain-line strong, .retain-line span { display: block; }
.retain-line strong { color: var(--ink-soft); font-size: 11px; }
.retain-line div > span { margin-top: 3px; color: var(--muted); font-size: 10px; line-height: 1.4; }
.toggle { width: 38px; height: 22px; flex: 0 0 auto; padding: 3px; border: 0; border-radius: 999px; background: #cbd5e1; cursor: pointer; transition: background .18s ease, box-shadow .18s ease; }
.toggle span { display: block; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(15 23 42 / 20%); transition: transform .18s cubic-bezier(.2,.8,.2,1); }
.toggle.on { background: #0891b2; box-shadow: 0 0 0 2px color-mix(in srgb, #0891b2 15%, transparent); }
.toggle.on span { transform: translateX(16px); }
:root:not([data-theme='light']) .toggle:not(.on) { background: #475569; }
.schedule-settings { padding: 11px 0 2px; }
.field-row { display: flex; gap: 8px; }
.field-block { flex: 1; min-width: 0; }
.control-label { display: block; margin-bottom: 7px; color: var(--muted); font-size: 10px; font-weight: 600; }
.control-label small { margin-left: 4px; color: var(--subtle); font-weight: 450; }
.input-suffix-wrap { height: 32px; display: flex; align-items: center; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--surface-input); }
.input-suffix-wrap:focus-within { border-color: var(--focus-ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-ring) 22%, transparent); }
.input-suffix-wrap input { width: 0; flex: 1; height: 100%; border: 0; outline: 0; padding: 0 8px; color: var(--ink); background: transparent; font-size: 11px; }
.input-suffix-wrap > span { padding: 0 8px; color: var(--subtle); font-size: 10px; }
.control-input { width: 100%; min-width: 0; height: 32px; border: 1px solid var(--line-strong); border-radius: 6px; outline: none; padding: 0 8px; color: var(--ink); background: var(--surface-input); font-size: 11px; }
.control-input:focus { border-color: var(--focus-ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-ring) 22%, transparent); }
.control-input::placeholder { color: var(--placeholder); opacity: 1; }
.schedule-note { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0 0; color: var(--muted); font-size: 10px; line-height: 1.45; }
.schedule-note svg { flex: 0 0 auto; color: var(--accent); }
.mqtt5-details { margin-top: 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-muted); }
.mqtt5-details summary { min-height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px; color: var(--ink-soft); font-size: 10px; font-weight: 600; cursor: pointer; list-style: none; }
.mqtt5-details summary::-webkit-details-marker { display: none; }
.summary-caret { color: var(--subtle); transition: transform .14s ease; }
.mqtt5-details[open] .summary-caret { transform: rotate(180deg); }
.mqtt5-fields { display: grid; gap: 9px; padding: 0 9px 10px; }
.mqtt5-fields .field-row { gap: 7px; }
.properties-heading { display: flex; align-items: center; justify-content: space-between; }
.properties-heading .control-label { margin: 0; }
.properties-heading button { display: inline-flex; align-items: center; gap: 4px; border: 0; border-radius: 5px; padding: 4px 6px; color: var(--accent); background: var(--accent-soft); font-size: 10px; font-weight: 650; cursor: pointer; }
.property-row { display: grid; grid-template-columns: 1fr 1fr 28px; gap: 5px; }
.remove-property { display: grid; place-items: center; border: 0; border-radius: 5px; color: var(--muted); background: transparent; cursor: pointer; }
.remove-property:hover { color: var(--danger); background: var(--danger-soft); }
.mqtt-version-note { min-height: 38px; display: flex; align-items: center; gap: 7px; padding: 5px 0; color: var(--muted); font-size: 10px; }
.mqtt-version-note svg { flex: 0 0 auto; color: var(--subtle); }
.send-actions { margin-top: 12px; }
.send-button { width: 100%; min-height: 42px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--accent-strong); border-radius: 6px; color: #fff; background: var(--accent-strong); box-shadow: 0 1px 2px rgb(15 23 42 / 14%); font-size: 12px; font-weight: 700; cursor: pointer; transition: background .14s ease, transform .14s ease, box-shadow .14s ease; }
.send-button:hover:not(:disabled) { background: #155e75; box-shadow: 0 2px 5px rgb(15 23 42 / 18%); }
.send-button:disabled { color: var(--subtle); border-color: var(--line); background: var(--surface-raised); cursor: not-allowed; }
.send-button small { margin-left: auto; margin-right: 10px; color: #08343a; font: 10px var(--font-mono); }
.send-arrow { flex: 0 0 auto; }
.stop-schedule { color: #fff; border-color: var(--danger); background: #a7443e; }
.stop-schedule:hover:not(:disabled) { background: #913a35; }
.counter-row { display: flex; align-items: center; gap: 9px; margin-top: 9px; }
.counter-row > div:not(.counter-devices) { display: flex; align-items: baseline; gap: 5px; color: var(--muted); font-size: 10px; }
.counter-value { font: 700 12px var(--font-mono); }
.success-value { color: var(--green); }
.failure-value { color: var(--danger); }
.counter-divider { width: 1px; height: 14px; background: var(--line-strong); }
.counter-devices { margin-left: auto; color: var(--muted); font-size: 10px; }
.section-divider { height: 1px; margin: 12px 0; background: var(--line); }
.monitor-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.monitor-heading h3 { margin: 0; color: var(--ink-soft); font-size: 12px; font-weight: 650; }
.monitor-status { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 10px; }
.monitor-status i { background: var(--subtle); box-shadow: 0 0 0 3px color-mix(in srgb, var(--subtle) 14%, transparent); }
.monitor-status.live { color: var(--green); }
.monitor-status.live i { background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 17%, transparent), 0 0 9px color-mix(in srgb, var(--green) 45%, transparent); }
.monitor-input { width: 100%; min-height: 54px; resize: vertical; border: 1px solid transparent; border-radius: 6px; outline: none; padding: 9px 10px; color: var(--ink-soft); background: var(--surface-input); font-size: 11px; line-height: 1.5; transition: box-shadow .14s ease; }
.monitor-input:focus { border-color: transparent; box-shadow: 0 0 0 2px var(--focus-ring); }
.monitor-input::placeholder { color: var(--placeholder); opacity: 1; }
.monitor-button { width: 100%; min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; margin-top: 7px; border: 1px solid var(--line-strong); border-radius: 6px; color: var(--accent); background: var(--accent-soft); font-size: 10px; font-weight: 700; cursor: pointer; }
.monitor-button:hover:not(:disabled) { border-color: var(--accent); }
.monitor-button:disabled { color: var(--subtle); border-color: var(--line); background: var(--surface-muted); cursor: not-allowed; }
.stop-monitor { color: var(--danger); border-color: var(--danger-soft); background: var(--danger-soft); }
.monitor-caption { margin: 7px 0 0; color: var(--subtle); text-align: center; font-size: 9px; line-height: 1.4; }
.publish-rail { min-height: 48px; }
.publish-rail .panel-rail-status { padding-right: 2px; }
.publish-collapsed .publish-rail { min-height: 176px; flex-direction: column; justify-content: flex-start; gap: 12px; padding: 10px 3px; }
.publish-collapsed .publish-rail .panel-rail-toggle { min-height: 100px; flex: 0 0 100px; flex-direction: column; justify-content: center; gap: 9px; padding: 0; }
.publish-collapsed .publish-rail .panel-rail-title { writing-mode: vertical-rl; }
.publish-collapsed .publish-rail .panel-rail-summary, .publish-collapsed .publish-rail .panel-rail-chevron { display: none; }
.publish-collapsed .publish-rail .panel-rail-status { font-size: 0; }
.publish-collapsed .publish-rail .panel-rail-status .panel-rail-dot { width: 8px; height: 8px; }
.publish-collapsed .publish-rail .panel-rail-toggle .panel-rail-icon { width: 32px; height: 32px; }
@media (max-width: 1120px) {
  .publish-collapsed .publish-rail { min-height: 48px; flex-direction: row; justify-content: space-between; padding: 6px 13px; }
  .publish-collapsed .publish-rail .panel-rail-toggle { min-height: 38px; flex: 1; flex-direction: row; justify-content: flex-start; gap: 10px; padding: 0 4px; }
  .publish-collapsed .publish-rail .panel-rail-title { writing-mode: horizontal-tb; }
  .publish-collapsed .publish-rail .panel-rail-summary, .publish-collapsed .publish-rail .panel-rail-chevron { display: block; }
  .publish-collapsed .publish-rail .panel-rail-status { font-size: 11px; }
}
@media (max-width: 680px) {
  .publish-card { padding: 14px; }
  .active-devices { display: none; }
  .counter-devices { display: none; }
}
</style>
