<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { IconDeviceDesktopAnalytics, IconDeviceFloppy, IconLayoutDashboard, IconPlus, IconServer, IconSettings } from '@tabler/icons-vue'
import ActivityPanel from './components/ActivityPanel.vue'
import BrokerPanel from './components/BrokerPanel.vue'
import PayloadEditor from './components/PayloadEditor.vue'
import PublishPanel from './components/PublishPanel.vue'
import SettingsPage from './components/SettingsPage.vue'
import SimulationPlanDialog from './components/SimulationPlanDialog.vue'
import { useSimulator } from './composables/useSimulator'
import { useThemePreference } from './composables/useThemePreference'
import { completeMcpTool } from './lib/tauri'
import type { McpToolRequest } from './types'

const simulator = reactive(useSimulator())
useThemePreference()
const publishControlsCollapsed = ref(false)
const activePage = ref<'workspace' | 'settings'>('workspace')
const connectionDialogOpen = ref(false)
const planDialogOpen = ref(false)
const planDialogInitialMode = ref<'list' | 'create'>('list')
const connectionDialogElement = ref<HTMLElement | null>(null)
const selectedPlan = computed(() => simulator.simulationPlans.find((plan) => plan.scenario.id === simulator.selectedScenarioId))
let unlistenMcpTools: UnlistenFn | undefined

watch([connectionDialogOpen, planDialogOpen], ([connectionOpen, planOpen]) => {
  document.body.classList.toggle('modal-open', connectionOpen || planOpen)
})

watch(connectionDialogOpen, async (open) => {
  if (!open) return
  await nextTick()
  connectionDialogElement.value?.focus()
})

onMounted(async () => {
  if (!simulator.isDesktopApp()) return
  unlistenMcpTools = await listen<McpToolRequest>('mcp-tool-request', async ({ payload }) => {
    try {
      let result: unknown
      switch (payload.name) {
        case 'get_simulator_status':
          result = {
            profile: {
              name: simulator.profile.name,
              host: simulator.profile.host,
              port: simulator.profile.port,
              mqttVersion: simulator.mqttVersion,
              useTls: simulator.profile.useTls,
            },
            scenario: {
              name: simulator.scenarioName,
              topicTemplate: simulator.topicTemplate,
              payloadFormat: simulator.payloadFormat,
            },
            connectedDeviceCount: simulator.onlineDevices.length,
            totalDeviceCount: simulator.devices.length,
            scheduleRunning: simulator.scheduleRunning,
            monitorRunning: simulator.monitorRunning,
            successCount: simulator.successCount,
            failureCount: simulator.failureCount,
            devices: simulator.devices.map((device) => ({
              deviceId: device.deviceId,
              clientId: device.clientId,
              status: device.status,
              error: device.error,
              successCount: device.successCount,
              failureCount: device.failureCount,
            })),
          }
          break
        case 'connect_devices':
          if (!simulator.profile.host.trim()) throw new Error('请先填写 Broker 地址。')
          await simulator.connect()
          if (!simulator.devices.length) throw new Error('未能启动设备批次，请检查 Broker 配置和应用日志。')
          result = { started: true, devices: simulator.devices.length }
          break
        case 'disconnect_devices':
          await simulator.stop()
          result = { stopped: true }
          break
        case 'retry_failed_devices':
          if (!simulator.devices.some((device) => ['error', 'disconnected'].includes(device.status))) {
            throw new Error('当前没有可重试的失败或断开设备。')
          }
          await simulator.retryFailedDevices()
          result = { retried: true }
          break
        case 'start_simulation':
          simulator.startSchedule()
          if (!simulator.scheduleRunning) throw new Error('定时发送未启动，请确认至少有一台设备已连接。')
          result = { running: simulator.scheduleRunning }
          break
        case 'stop_simulation':
          simulator.stopSchedule()
          result = { running: simulator.scheduleRunning }
          break
        case 'publish_once':
          if (!simulator.onlineDevices.length) throw new Error('当前没有已连接设备。')
          await simulator.publishOnce()
          result = { published: true }
          break
        case 'start_monitor':
          if (!simulator.monitorTopics.trim()) throw new Error('请先填写订阅主题过滤器。')
          await simulator.startMonitor()
          if (!simulator.monitorRunning) throw new Error('订阅监视未启动，请检查连接配置和应用日志。')
          result = { running: simulator.monitorRunning }
          break
        case 'stop_monitor':
          await simulator.stopMonitor()
          result = { running: simulator.monitorRunning }
          break
        default:
          throw new Error(`未知的 MCP 工具：${payload.name}`)
      }
      await completeMcpTool(payload.id, result)
    } catch (error) {
      await completeMcpTool(payload.id, null, error instanceof Error ? error.message : String(error))
    }
  })
})

onUnmounted(() => {
  unlistenMcpTools?.()
  document.body.classList.remove('modal-open')
})

function closeConnectionDialog() {
  connectionDialogOpen.value = false
}

function openPlanDialog(initialMode: 'list' | 'create') {
  planDialogInitialMode.value = initialMode
  planDialogOpen.value = true
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <IconDeviceDesktopAnalytics aria-hidden="true" :size="20" :stroke-width="1.8" />
        </div>
        <div class="brand-copy">
          <strong>Telemetry <span>Studio</span></strong>
          <small>MQTT DEVICE SIMULATOR</small>
        </div>
      </div>

      <nav class="primary-nav" aria-label="主导航">
        <button class="nav-item" :class="{ active: activePage === 'workspace' }" type="button" @click="activePage = 'workspace'">
          <IconLayoutDashboard aria-hidden="true" :size="16" />工作台
        </button>
        <button class="nav-item" :class="{ active: activePage === 'settings' }" type="button" @click="activePage = 'settings'">
          <IconSettings aria-hidden="true" :size="16" />设置
        </button>
      </nav>

      <div class="topbar-spacer" />

      <div v-if="activePage === 'workspace'" class="topbar-selectors" aria-label="工作区选择">
        <label class="profile-select-wrap plan-select-wrap">
          <span>仿真方案</span>
          <select :value="simulator.selectedScenarioId" @change="simulator.selectPlan(($event.target as HTMLSelectElement).value)">
            <option v-for="plan in simulator.simulationPlans" :key="plan.scenario.id" :value="plan.scenario.id">{{ plan.scenario.name }} · {{ plan.profile.name }}</option>
            <option v-if="!selectedPlan" :value="simulator.selectedScenarioId">{{ simulator.scenarioName }}（未保存）</option>
          </select>
        </label>
      </div>

      <button v-if="activePage === 'workspace'" class="connection-settings-trigger" type="button" @click="connectionDialogOpen = true">
        <span class="connection-trigger-icon"><IconServer aria-hidden="true" :size="16" /></span>
        <span class="connection-trigger-copy"><strong>连接设置</strong><small>{{ simulator.profile.host }}:{{ simulator.profile.port }}</small></span>
      </button>

      <div class="header-status" :class="{ connected: simulator.onlineDevices.length > 0 }" role="status" aria-live="polite">
        <i />
        <span>{{ simulator.onlineDevices.length > 0 ? `${simulator.onlineDevices.length} 台在线` : '未连接' }}</span>
      </div>

      <div v-if="activePage === 'workspace'" class="topbar-actions">
        <button class="new-workspace-button" type="button" @click="openPlanDialog('create')"><IconPlus aria-hidden="true" :size="16" /><span>新建</span></button>
        <button class="new-workspace-button" type="button" @click="openPlanDialog('list')"><IconSettings aria-hidden="true" :size="16" /><span>方案管理</span></button>
        <button class="save-workspace-button" type="button" @click="simulator.saveCurrent">
          <IconDeviceFloppy aria-hidden="true" :size="16" /><span>保存</span>
        </button>
      </div>
    </header>

    <main v-if="activePage === 'workspace'" class="workspace-main">
      <div class="workbench-grid" :class="{ 'publish-collapsed': publishControlsCollapsed }">
        <PayloadEditor
          v-model:format="simulator.payloadFormat"
          v-model:topic-template="simulator.topicTemplate"
          v-model:json-template="simulator.jsonTemplate"
          v-model:schemas="simulator.workspace.schemas"
          v-model:schema-id="simulator.selectedSchemaId"
          v-model:message-type="simulator.messageType"
          v-model:proto-values="simulator.protoValues"
          v-model:field-ranges="simulator.fieldRanges"
          @save="simulator.saveCurrent"
        />

        <PublishPanel
          v-model:collapsed="publishControlsCollapsed"
          v-model:options="simulator.publishOptions"
          v-model:mode="simulator.publishMode"
          v-model:interval-seconds="simulator.intervalSeconds"
          v-model:count-per-device="simulator.countPerDevice"
          v-model:monitor-topics="simulator.monitorTopics"
          :devices="simulator.devices"
          :mqtt-version="simulator.mqttVersion"
          :running="simulator.running"
          :schedule-running="simulator.scheduleRunning"
          :monitor-running="simulator.monitorRunning"
          :monitor-enabled="simulator.isDesktopApp()"
          :success-count="simulator.successCount"
          :failure-count="simulator.failureCount"
          @publish="simulator.publishOnce"
          @start-schedule="simulator.startSchedule"
          @stop-schedule="simulator.stopSchedule"
          @start-monitor="simulator.startMonitor"
          @stop-monitor="simulator.stopMonitor"
        />

        <ActivityPanel
          v-model:tab="simulator.selectedActivityTab"
          v-model:decode-schema-id="simulator.decodeSchemaId"
          v-model:decode-message-type="simulator.decodeMessageType"
          v-model:selected-message-id="simulator.selectedMessageId"
          :published="simulator.published"
          :received="simulator.received"
          :logs="simulator.logs"
          :schemas="simulator.workspace.schemas"
        />
      </div>
    </main>

    <SettingsPage v-else :desktop-ready="simulator.isDesktopApp()" />

    <footer class="statusbar">
      <div class="statusbar-left">
        <span class="statusbar-dot" :class="simulator.isDesktopApp() ? 'desktop-dot' : 'preview-dot'" />
        <span>{{ simulator.isDesktopApp() ? '本地桌面会话' : '浏览器预览' }}</span>
        <span class="statusbar-separator">/</span>
        <span>{{ simulator.mqttVersion }} · {{ simulator.profile.useTls ? 'TLS' : 'TCP' }}</span>
      </div>
      <div class="statusbar-right">
        <span v-if="simulator.scheduleRunning" class="schedule-indicator"><i />定时发送中</span>
        <span>{{ simulator.devices.length }} / 100 设备</span>
        <span class="statusbar-separator">·</span>
        <span>消息记录 {{ simulator.published.length + simulator.received.length }}/200</span>
      </div>
    </footer>

    <Teleport to="body">
      <div v-if="connectionDialogOpen" class="dialog-backdrop" role="presentation" @click.self="closeConnectionDialog" @keydown.esc.prevent.stop="closeConnectionDialog">
        <section ref="connectionDialogElement" class="dialog-surface connection-dialog" role="dialog" aria-modal="true" aria-label="连接设置" tabindex="-1">
          <BrokerPanel
            v-model="simulator.profile"
            v-model:mqtt-version="simulator.mqttVersion"
            v-model:password="simulator.password"
            v-model:batch="simulator.deviceBatch"
            :devices="simulator.devices"
            :connecting="simulator.connecting"
            :running="simulator.running"
            :protocol-locked="simulator.running || simulator.connecting || simulator.monitorRunning"
            :desktop-ready="simulator.isDesktopApp()"
            @connect="simulator.connect"
            @stop="simulator.stop"
            @retry="simulator.retryDevice"
            @retry-failed="simulator.retryFailedDevices"
            @save="simulator.saveCurrent"
            @close="closeConnectionDialog"
          />
        </section>
      </div>

      <SimulationPlanDialog
        v-if="planDialogOpen"
        :initial-mode="planDialogInitialMode"
        :plans="simulator.simulationPlans"
        :selected-scenario-id="simulator.selectedScenarioId"
        :active-password="simulator.password"
        :select-plan="simulator.selectPlan"
        :save-plan="simulator.savePlan"
        :delete-plan="simulator.deletePlan"
        @close="planDialogOpen = false"
      />
    </Teleport>
  </div>
</template>
