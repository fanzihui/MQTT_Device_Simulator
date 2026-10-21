<script setup lang="ts">
import { computed } from 'vue'
import { IconArrowUpRight, IconChevronDown, IconChevronUp, IconDeviceFloppy, IconRefresh, IconServer } from '@tabler/icons-vue'
import type { BrokerProfile, DeviceBatch, DeviceStatus, MqttVersion } from '../types'

const profile = defineModel<BrokerProfile>({ required: true })
const mqttVersion = defineModel<MqttVersion>('mqttVersion', { required: true })
const password = defineModel<string>('password', { required: true })
const batch = defineModel<DeviceBatch>('batch', { required: true })
const collapsed = defineModel<boolean>('collapsed', { required: true })

const props = defineProps<{
  devices: DeviceStatus[]
  connecting: boolean
  running: boolean
  protocolLocked: boolean
  desktopReady: boolean
}>()

const emit = defineEmits<{
  connect: []
  stop: []
  retry: [deviceId: string]
  retryFailed: []
  save: []
}>()

const onlineCount = computed(() => props.devices.filter((device) => device.status === 'connected').length)
const retryableCount = computed(() => props.devices.filter((device) => ['error', 'disconnected'].includes(device.status)).length)
</script>

<template>
  <aside class="broker-column" :class="{ 'is-collapsed': collapsed }">
    <section v-if="collapsed" class="panel-card panel-rail broker-rail">
      <button class="panel-rail-toggle" type="button" aria-label="展开连接设置" title="展开连接设置" :aria-expanded="false" @click="collapsed = false">
        <span class="panel-rail-icon broker-icon"><IconServer aria-hidden="true" :size="18" :stroke-width="1.8" /></span>
        <span class="panel-rail-title">连接设置</span>
        <span class="panel-rail-endpoint mono">{{ profile.host }}:{{ profile.port }} · MQTT {{ mqttVersion }}</span>
        <IconChevronDown class="panel-rail-chevron" aria-hidden="true" :size="16" />
      </button>
      <span class="panel-rail-status" role="status" :aria-label="`${onlineCount} / ${batch.count} 台设备在线`" :title="`${onlineCount} / ${batch.count} 台设备在线`">
        <i class="panel-rail-dot" :class="onlineCount > 0 ? 'is-green' : connecting ? 'is-amber' : 'is-muted'" />
        <span>{{ onlineCount }}/{{ batch.count }}</span>
      </span>
    </section>

    <section v-else class="panel-card broker-card">
      <div class="card-heading">
        <div class="heading-icon broker-icon"><IconServer aria-hidden="true" :size="19" :stroke-width="1.8" /></div>
        <div>
          <h2>连接设置</h2>
        </div>
        <div class="heading-actions">
          <button class="icon-button subtle" type="button" aria-label="保存连接配置" title="保存连接配置" @click="emit('save')"><IconDeviceFloppy aria-hidden="true" :size="18" :stroke-width="1.8" /></button>
          <button class="icon-button subtle panel-collapse-button" type="button" aria-label="收起连接设置" title="收起连接设置" :aria-expanded="true" @click="collapsed = true"><IconChevronUp aria-hidden="true" :size="18" /></button>
        </div>
      </div>

      <div class="connection-settings-grid">
        <div class="field-block profile-name-field">
          <label class="field-label" for="profile-name">配置名称</label>
          <input id="profile-name" v-model="profile.name" class="text-input" placeholder="例如：本地开发环境" />
        </div>

        <div class="field-row broker-endpoint-row">
          <div class="field-block grow">
            <label class="field-label" for="broker-host">Broker 地址</label>
            <input id="broker-host" v-model="profile.host" class="text-input mono" placeholder="localhost" autocomplete="off" />
          </div>
          <div class="field-block port-field">
            <label class="field-label" for="broker-port">端口</label>
            <input id="broker-port" v-model.number="profile.port" class="text-input mono" type="number" min="1" max="65535" />
          </div>
        </div>

        <div class="field-block version-field">
          <label class="field-label" for="mqtt-version">协议版本</label>
          <select id="mqtt-version" v-model="mqttVersion" class="text-input select-input" :disabled="protocolLocked">
            <option value="5.0">MQTT 5.0</option>
            <option value="3.1.1">MQTT 3.1.1</option>
          </select>
          <small v-if="protocolLocked" class="protocol-lock-note">停止设备和订阅监听后可更改协议版本。</small>
        </div>

        <div class="field-row auth-row">
          <div class="field-block grow">
            <label class="field-label" for="broker-user">用户名 <span class="optional-label">可选</span></label>
            <input id="broker-user" v-model="profile.username" class="text-input" placeholder="username" autocomplete="off" />
          </div>
          <div class="field-block grow">
            <label class="field-label" for="broker-password">密码 <span class="memory-label">仅本次运行</span></label>
            <input id="broker-password" v-model="password" class="text-input" type="password" placeholder="不会保存到配置" autocomplete="new-password" />
          </div>
        </div>

        <div class="connection-extras">
          <div class="toggle-line tls-line">
            <div>
              <strong>TLS 加密</strong>
              <span>使用系统证书信任</span>
            </div>
            <button class="toggle" :class="{ on: profile.useTls }" type="button" role="switch" :aria-checked="profile.useTls" @click="profile.useTls = !profile.useTls">
              <span />
            </button>
          </div>
          <div v-if="profile.useTls" class="field-block ca-field">
            <label class="field-label" for="ca-path">自定义 CA 证书路径 <span class="optional-label">可选</span></label>
            <input id="ca-path" v-model="profile.caCertPath" class="text-input mono" placeholder="C:\certs\broker-ca.pem" />
            <small>留空时使用系统证书；填写后使用此 CA 验证 Broker。</small>
          </div>
          <div v-if="mqttVersion === '5.0'" class="field-block session-field">
            <label class="field-label" for="session-expiry">会话过期间隔 <span class="optional-label">秒</span></label>
            <input id="session-expiry" v-model.number="profile.sessionExpirySeconds" class="text-input mono" type="number" min="0" max="4294967295" />
          </div>
        </div>
      </div>

      <div class="section-divider" />

      <div class="device-batch-grid">
        <div class="subsection-heading">
          <div>
            <h3>虚拟设备</h3>
          </div>
          <div class="device-heading-actions">
            <button v-if="retryableCount" class="batch-retry-button" type="button" :disabled="!desktopReady" @click="emit('retryFailed')"><IconRefresh aria-hidden="true" :size="14" />批量重试 {{ retryableCount }}</button>
            <span class="limit-badge">最多 100 台</span>
          </div>
        </div>

        <div class="field-block device-count-field">
          <div class="field-label-row">
            <label class="field-label" for="device-count">设备数量</label>
            <span class="count-readout">{{ batch.count }} <small>台</small></span>
          </div>
          <input id="device-count" v-model.number="batch.count" class="range-input" type="range" min="1" max="100" />
        </div>

        <div class="field-row prefix-row">
          <div class="field-block grow">
            <label class="field-label" for="device-prefix">设备 ID 前缀</label>
            <input id="device-prefix" v-model="batch.deviceIdPrefix" class="text-input mono" />
          </div>
          <div class="field-block grow">
            <label class="field-label" for="client-prefix">Client ID 前缀</label>
            <input id="client-prefix" v-model="batch.clientIdPrefix" class="text-input mono" />
          </div>
        </div>

        <div class="device-preview-line">
          <span class="status-dot" :class="running ? 'is-green' : connecting ? 'is-amber' : 'is-muted'" />
          <span>{{ running ? `${onlineCount} 台已连接` : connecting ? '正在建立连接…' : '尚未启动设备' }}</span>
          <span v-if="devices.length" class="preview-id">{{ devices[0]?.clientId }}{{ devices.length > 1 ? ` + ${devices.length - 1}` : '' }}</span>
        </div>

        <div v-if="devices.length" class="device-list">
          <div v-for="device in devices.slice(0, 8)" :key="device.deviceId" class="device-row">
            <span class="status-dot" :class="device.status === 'connected' ? 'is-green' : device.status === 'connecting' ? 'is-amber' : 'is-red'" />
            <span class="device-name mono">{{ device.deviceId }}</span>
            <span class="device-state">{{ device.status === 'connected' ? '在线' : device.status === 'connecting' ? '连接中' : device.status === 'stopped' ? '已停止' : '离线' }}</span>
            <button v-if="['error', 'disconnected'].includes(device.status)" class="text-action" type="button" @click="emit('retry', device.deviceId)">重试</button>
          </div>
          <div v-if="devices.length > 8" class="more-devices">以及其他 {{ devices.length - 8 }} 台设备</div>
        </div>
      </div>

      <div class="connection-actions">
        <button class="button button-primary connect-button" :disabled="connecting || !desktopReady" type="button" @click="emit('connect')">
          <IconArrowUpRight aria-hidden="true" :size="17" />{{ running ? '重新连接设备' : '连接并启动设备' }}
        </button>
        <button v-if="running" class="button button-quiet stop-button" type="button" @click="emit('stop')">停止</button>
      </div>
      <p v-if="!desktopReady" class="browser-note">浏览器预览模式。连接功能请在桌面应用中使用。</p>
    </section>
  </aside>
</template>

<style scoped>
.broker-column { min-width: 0; }
.broker-card { display: flex; flex-direction: column; overflow: hidden; padding: 0; }
.card-heading { min-height: 46px; display: flex; align-items: center; gap: 9px; padding: 0 13px; border-bottom: 1px solid var(--line); }
.heading-actions { display: flex; align-items: center; gap: 3px; margin-left: auto; }
.heading-actions .icon-button { margin-left: 0; }
.card-heading h2 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 700; }
.heading-icon { width: 28px; height: 28px; flex: 0 0 28px; display: grid; place-items: center; border-radius: 7px; }
.broker-icon { color: var(--accent); background: var(--accent-soft); }
.icon-button { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid transparent; border-radius: 7px; color: var(--muted); background: transparent; cursor: pointer; }
.icon-button.subtle:hover { color: var(--accent); border-color: var(--line-strong); background: var(--surface-raised); }
.connection-settings-grid { display: grid; grid-template-columns: minmax(130px, .9fr) minmax(220px, 1.5fr) minmax(140px, .9fr) minmax(220px, 1.45fr); align-items: end; gap: 9px; padding: 11px 13px 9px; }
.connection-settings-grid .field-block { min-width: 0; margin: 0; }
.field-label { display: block; margin-bottom: 5px; color: var(--muted); font-size: 11px; font-weight: 600; }
.field-label-row { display: flex; align-items: center; justify-content: space-between; }
.optional-label { margin-left: 4px; color: var(--subtle); font-size: 10px; font-weight: 450; }
.memory-label { margin-left: 4px; color: var(--accent); font-size: 10px; font-weight: 600; }
.text-input { width: 100%; height: 34px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 0 9px; color: var(--ink); background: var(--surface-input); outline: none; font-size: 12px; }
.text-input:hover { border-color: var(--subtle); }
.text-input:focus { border-color: var(--focus-ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-ring) 22%, transparent); }
.text-input::placeholder { color: var(--subtle); }
.mono { font-family: var(--font-mono); font-size: 11px; }
.field-row { min-width: 0; display: flex; gap: 8px; }
.grow { flex: 1; min-width: 0; }
.port-field { width: 76px; flex: 0 0 76px; }
.select-input:disabled { color: var(--subtle); background: var(--surface-muted); cursor: not-allowed; }
.protocol-lock-note { display: block; margin-top: 5px; color: var(--subtle); font-size: 10px; }
.auth-row { gap: 7px; }
.connection-extras { grid-column: 1 / -1; display: flex; align-items: center; flex-wrap: wrap; gap: 12px 20px; min-width: 0; padding-top: 1px; }
.toggle-line { display: inline-flex; align-items: center; gap: 12px; }
.tls-line { padding: 0; }
.toggle-line strong, .toggle-line span { display: block; }
.toggle-line strong { color: var(--ink-soft); font-size: 11px; font-weight: 600; }
.toggle-line div > span { margin-top: 2px; color: var(--subtle); font-size: 10px; }
.toggle { width: 34px; height: 20px; padding: 2px; border: 0; border-radius: 12px; background: var(--line-strong); cursor: pointer; transition: background .14s ease; }
.toggle span { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--ink); transition: transform .14s ease; }
.toggle.on { background: var(--accent-strong); }
.toggle.on span { transform: translateX(14px); }
.ca-field { flex: 1 1 280px; padding: 0; margin: 0; border: 0; background: transparent; }
.ca-field small { display: block; margin-top: 4px; color: var(--subtle); font-size: 10px; line-height: 1.45; }
.session-field { flex: 0 0 160px; }
.section-divider { display: none; }
.device-batch-grid { display: grid; grid-template-columns: minmax(150px, .8fr) minmax(260px, 1.3fr) minmax(190px, 1fr); align-items: center; gap: 8px 14px; padding: 9px 13px 11px; border-top: 1px solid var(--line); }
.subsection-heading { display: flex; align-items: center; justify-content: space-between; gap: 7px; min-width: 0; margin: 0; }
.subsection-heading h3 { margin: 0; color: var(--ink-soft); font-size: 12px; font-weight: 650; }
.device-heading-actions { display: flex; align-items: center; gap: 6px; }
.batch-retry-button { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--amber-soft); border-radius: 6px; padding: 5px 7px; color: var(--amber); background: var(--amber-soft); font-size: 10px; font-weight: 650; cursor: pointer; }
.batch-retry-button:disabled { opacity: .55; cursor: not-allowed; }
.limit-badge { border-radius: 5px; padding: 4px 6px; color: var(--muted); background: var(--surface-raised); font-size: 10px; white-space: nowrap; }
.device-count-field { margin: 0; }
.count-readout { color: var(--accent); font: 700 13px var(--font-mono); }
.count-readout small { color: var(--muted); font: 500 10px var(--font-sans); }
.range-input { width: 100%; height: 4px; border-radius: 4px; background: var(--line-strong); accent-color: var(--accent); }
.range-input::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border: 2px solid var(--surface); border-radius: 50%; background: var(--accent); cursor: ew-resize; }
.prefix-row { margin: 0; }
.device-preview-line { grid-column: 1 / -1; display: flex; align-items: center; min-height: 24px; gap: 8px; margin: 0; color: var(--muted); font-size: 11px; }
.status-dot { display: inline-block; width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--subtle); }
.status-dot.is-green { background: var(--green); }
.status-dot.is-amber { background: var(--amber); }
.status-dot.is-red { background: var(--danger); }
.status-dot.is-muted { background: var(--subtle); }
.preview-id { margin-left: auto; color: var(--subtle); font: 10px var(--font-mono); }
.device-list { grid-column: 1 / -1; max-height: 100px; overflow-y: auto; border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px; margin: 0; background: var(--surface-muted); }
.device-row { display: flex; align-items: center; min-height: 28px; gap: 8px; border-bottom: 1px solid var(--line); }
.device-row:last-of-type { border-bottom: 0; }
.device-name { flex: 1; color: var(--ink-soft); font-size: 10px; }
.device-state { color: var(--muted); font-size: 10px; }
.text-action { border: 0; border-radius: 5px; padding: 4px 6px; color: var(--accent); background: transparent; font-size: 10px; font-weight: 650; cursor: pointer; }
.text-action:hover { background: var(--accent-soft); }
.more-devices { padding: 5px 0; color: var(--muted); text-align: center; font-size: 10px; }
.connection-actions { display: flex; gap: 8px; padding: 0 13px 12px; }
.button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; border-radius: 6px; padding: 0 12px; font-size: 12px; font-weight: 700; cursor: pointer; transition: transform .14s ease, background .14s ease; }
.button:disabled { opacity: .55; cursor: not-allowed; }
.button-primary { color: #06242a; background: var(--accent); }
.button-primary:hover:not(:disabled) { background: var(--accent-strong); }
.connect-button { flex: 1; }
.button-quiet { color: var(--muted); border-color: var(--line-strong); background: var(--surface-raised); }
.button-quiet:hover { color: var(--ink); background: var(--surface-muted); }
.browser-note { margin: 0 13px 12px; color: var(--subtle); font-size: 10px; line-height: 1.45; }
.broker-rail { min-height: 50px; }
.broker-rail .panel-rail-status { padding-right: 3px; }

@media (max-width: 1100px) {
  .connection-settings-grid { grid-template-columns: minmax(130px, 1fr) minmax(220px, 1.6fr) minmax(145px, 1fr); }
  .auth-row { grid-column: 1 / -1; }
  .device-batch-grid { grid-template-columns: minmax(130px, .8fr) minmax(240px, 1.2fr); }
  .prefix-row { grid-column: 1 / -1; }
}
@media (max-width: 680px) {
  .connection-settings-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .profile-name-field, .broker-endpoint-row, .auth-row, .connection-extras { grid-column: 1 / -1; }
  .connection-extras { align-items: flex-start; }
  .device-batch-grid { grid-template-columns: minmax(0, 1fr); }
  .subsection-heading, .prefix-row, .device-preview-line, .device-list { grid-column: 1; }
  .panel-rail-summary { display: none; }
}
</style>
