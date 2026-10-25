<script setup lang="ts">
import { computed } from 'vue'
import { IconServer } from '@tabler/icons-vue'
import type { BrokerProfile, DeviceStatus, MqttVersion } from '../types'

const props = defineProps<{
  profile: BrokerProfile
  mqttVersion: MqttVersion
  devices: DeviceStatus[]
  connecting: boolean
}>()

const onlineCount = computed(() => props.devices.filter((device) => device.status === 'connected').length)
const connectionLabel = computed(() => props.connecting ? '连接中' : onlineCount.value > 0 ? '已连接' : '未连接')
</script>

<template>
  <section class="panel-card connection-overview-card" aria-labelledby="connection-overview-title">
    <div class="overview-heading">
      <span class="overview-icon"><IconServer aria-hidden="true" :size="18" :stroke-width="1.8" /></span>
      <div class="overview-heading-copy">
        <h2 id="connection-overview-title">连接概览</h2>
        <span>{{ profile.name }}</span>
      </div>
      <span class="overview-status" :class="{ connected: onlineCount > 0, connecting }" role="status">
        <i />{{ connectionLabel }}
      </span>
    </div>

    <dl class="overview-details">
      <div>
        <dt>Broker 地址</dt>
        <dd class="mono">{{ profile.host }}:{{ profile.port }}</dd>
      </div>
      <div>
        <dt>协议版本</dt>
        <dd>MQTT {{ mqttVersion }}</dd>
      </div>
      <div>
        <dt>设备在线</dt>
        <dd>{{ onlineCount }} / {{ devices.length }} 台</dd>
      </div>
      <div>
        <dt>传输方式</dt>
        <dd>{{ profile.useTls ? 'TLS 加密' : 'TCP' }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.connection-overview-card { min-width: 0; padding: 14px 13px 12px; }
.overview-heading { min-width: 0; display: flex; align-items: center; gap: 9px; margin-bottom: 14px; }
.overview-icon { width: 30px; height: 30px; display: grid; flex: 0 0 30px; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); border-radius: 7px; color: var(--accent); background: var(--accent-soft); }
.overview-heading-copy { min-width: 0; display: grid; gap: 3px; }
.overview-heading-copy h2 { margin: 0; color: var(--ink); font-size: 13px; font-weight: 700; }
.overview-heading-copy > span { overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.overview-status { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; margin-left: auto; border-radius: 5px; padding: 5px 7px; color: var(--muted); background: var(--surface-raised); font-size: 10px; font-weight: 650; white-space: nowrap; }
.overview-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--subtle); }
.overview-status.connected { color: var(--green); background: var(--green-soft); }
.overview-status.connected i { background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 14%, transparent); }
.overview-status.connecting { color: var(--amber); background: var(--amber-soft); }
.overview-status.connecting i { background: var(--amber); }
.overview-details { display: grid; gap: 10px; margin: 0; }
.overview-details > div { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 9px; }
.overview-details dt { flex: 0 0 auto; color: var(--muted); font-size: 10px; }
.overview-details dd { min-width: 0; overflow: hidden; margin: 0; color: var(--ink-soft); font-size: 10px; font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.overview-details .mono { font: 10px var(--font-mono); }
</style>
