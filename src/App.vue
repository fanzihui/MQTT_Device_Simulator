<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { IconDeviceFloppy, IconLayoutDashboard, IconPlus, IconServer, IconSettings } from '@tabler/icons-vue'
import type { Update } from '@tauri-apps/plugin-updater'
import appIcon from './assets/app-icon.png'
import ActivityPanel from './components/ActivityPanel.vue'
import BrokerPanel from './components/BrokerPanel.vue'
import ConnectionOverviewPanel from './components/ConnectionOverviewPanel.vue'
import PayloadEditor from './components/PayloadEditor.vue'
import PublishPanel from './components/PublishPanel.vue'
import SettingsPage from './components/SettingsPage.vue'
import SimulationPlanDialog from './components/SimulationPlanDialog.vue'
import SubscriptionPanel from './components/SubscriptionPanel.vue'
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
const updateDialogElement = ref<HTMLElement | null>(null)
const updateDialogOpen = ref(false)
const currentVersion = ref('')
const updateVersion = ref('')
const updateNotes = ref('')
const updateStatus = ref<'idle' | 'downloading' | 'installing' | 'error'>('idle')
const updateProgress = ref(0)
const updateProgressKnown = ref(false)
const updateError = ref('')
const selectedPlan = computed(() => simulator.simulationPlans.find((plan) => plan.scenario.id === simulator.selectedScenarioId))
let unlistenMcpTools: UnlistenFn | undefined
let pendingUpdate: Update | null = null

watch([connectionDialogOpen, planDialogOpen, updateDialogOpen], ([connectionOpen, planOpen, updateOpen]) => {
  document.body.classList.toggle('modal-open', connectionOpen || planOpen || updateOpen)
})

watch(connectionDialogOpen, async (open) => {
  if (!open) return
  await nextTick()
  connectionDialogElement.value?.focus()
})

watch(updateDialogOpen, async (open) => {
  if (!open) return
  await nextTick()
  updateDialogElement.value?.focus()
})

onMounted(async () => {
  if (!simulator.isDesktopApp()) return
  void checkForUpdates()
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

async function checkForUpdates() {
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({ timeout: 15_000 })
    if (!update) return

    pendingUpdate = update
    currentVersion.value = update.currentVersion
    updateVersion.value = update.version
    updateNotes.value = update.body?.trim() ?? ''
    updateStatus.value = 'idle'
    updateDialogOpen.value = true
  } catch (error) {
    console.warn('自动更新检查失败。', error)
  }
}

async function installUpdate() {
  if (!pendingUpdate || updateStatus.value === 'downloading' || updateStatus.value === 'installing') return

  updateStatus.value = 'downloading'
  updateProgress.value = 0
  updateProgressKnown.value = false
  updateError.value = ''
  let contentLength = 0
  let downloadedBytes = 0

  try {
    await pendingUpdate.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        contentLength = event.data.contentLength ?? 0
        updateProgressKnown.value = contentLength > 0
      } else if (event.event === 'Progress') {
        downloadedBytes += event.data.chunkLength
        if (contentLength > 0) {
          updateProgress.value = Math.min(100, Math.floor((downloadedBytes / contentLength) * 100))
        }
      } else if (event.event === 'Finished') {
        updateProgress.value = 100
      }
    }, { restartAfterInstall: true })
    updateStatus.value = 'installing'
  } catch (error) {
    updateStatus.value = 'error'
    updateError.value = error instanceof Error ? error.message : String(error)
  }
}

async function dismissUpdateDialog() {
  if (updateStatus.value === 'downloading' || updateStatus.value === 'installing') return
  updateDialogOpen.value = false
  updateStatus.value = 'idle'
  updateError.value = ''
  const update = pendingUpdate
  pendingUpdate = null
  if (update) await update.close().catch(() => undefined)
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark" aria-hidden="true">
          <img class="brand-icon-image" :src="appIcon" alt="" />
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
          <select aria-label="选择连接配置与模拟场景" :value="simulator.selectedScenarioId" @change="simulator.selectPlan(($event.target as HTMLSelectElement).value)">
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
      <div class="workbench-grid">
        <aside class="connection-column">
          <ConnectionOverviewPanel
            :profile="simulator.profile"
            :mqtt-version="simulator.mqttVersion"
            :devices="simulator.devices"
            :connecting="simulator.connecting"
          />
          <SubscriptionPanel
            v-model:topics="simulator.monitorTopics"
            :monitor-running="simulator.monitorRunning"
            :monitor-enabled="simulator.isDesktopApp()"
            @start="simulator.startMonitor"
            @stop="simulator.stopMonitor"
          />
        </aside>

        <div class="composer-column">
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
            :devices="simulator.devices"
            :mqtt-version="simulator.mqttVersion"
            :running="simulator.running"
            :schedule-running="simulator.scheduleRunning"
            :monitor-running="simulator.monitorRunning"
            :success-count="simulator.successCount"
            :failure-count="simulator.failureCount"
            @publish="simulator.publishOnce"
            @start-schedule="simulator.startSchedule"
            @stop-schedule="simulator.stopSchedule"
          />
        </div>

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

      <div
        v-if="updateDialogOpen"
        class="dialog-backdrop update-backdrop"
        role="presentation"
        @click.self="dismissUpdateDialog"
        @keydown.esc.prevent.stop="dismissUpdateDialog"
      >
        <section
          ref="updateDialogElement"
          class="dialog-surface update-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-dialog-title"
          tabindex="-1"
        >
          <div class="update-dialog-header">
            <img class="update-dialog-icon" :src="appIcon" alt="" />
            <div>
              <p class="update-eyebrow">MQTT DEVICE SIMULATOR</p>
              <h2 id="update-dialog-title">发现新版本 {{ updateVersion }}</h2>
              <p class="update-version-line">当前版本 {{ currentVersion }} · 安装完成后自动重新启动</p>
            </div>
          </div>

          <div v-if="updateNotes" class="update-notes">{{ updateNotes }}</div>
          <p v-else class="update-notes update-notes-empty">此版本包含模拟器更新。安装包将经过签名校验后安装。</p>

          <div v-if="updateStatus === 'downloading'" class="update-progress-section" role="status" aria-live="polite">
            <div class="update-progress-track">
              <div
                class="update-progress-fill"
                :class="{ indeterminate: !updateProgressKnown }"
                :style="updateProgressKnown ? { width: `${updateProgress}%` } : undefined"
              />
            </div>
            <span>{{ updateProgressKnown ? `正在下载更新 ${updateProgress}%` : '正在下载更新…' }}</span>
          </div>
          <p v-else-if="updateStatus === 'installing'" class="update-status-message" role="status">安装程序已启动，模拟器即将重新启动。</p>
          <p v-else-if="updateStatus === 'error'" class="update-error-message" role="alert">更新失败：{{ updateError }}</p>

          <div class="update-dialog-actions">
            <button
              v-if="updateStatus === 'idle' || updateStatus === 'error'"
              class="update-later-button"
              type="button"
              @click="dismissUpdateDialog"
            >
              稍后提醒
            </button>
            <button
              v-if="updateStatus === 'idle'"
              class="update-install-button"
              type="button"
              @click="installUpdate"
            >
              下载并安装
            </button>
            <button
              v-else-if="updateStatus === 'error'"
              class="update-install-button"
              type="button"
              @click="installUpdate"
            >
              重试更新
            </button>
            <button v-else class="update-install-button" type="button" disabled>
              {{ updateStatus === 'downloading' ? '正在更新…' : '正在重启…' }}
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.brand-icon-image { width: 100%; height: 100%; display: block; border-radius: inherit; object-fit: cover; }

.update-dialog { width: min(480px, 100%); padding: 22px; }
.update-dialog-header { display: flex; align-items: center; gap: 14px; }
.update-dialog-icon { width: 48px; height: 48px; flex: 0 0 48px; border-radius: 12px; }
.update-eyebrow { margin: 0 0 4px; color: var(--accent); font: 650 9px var(--font-mono); letter-spacing: .12em; }
.update-dialog-header h2 { margin: 0; color: var(--ink); font-size: 18px; letter-spacing: -.02em; }
.update-version-line { margin: 5px 0 0; color: var(--muted); font-size: 11px; line-height: 1.45; }
.update-notes { max-height: 180px; overflow: auto; margin: 18px 0 0; border: 1px solid var(--line); border-radius: 8px; padding: 12px; color: var(--ink-soft); background: var(--surface-muted); font-size: 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.update-notes-empty { color: var(--muted); }
.update-progress-section { display: grid; gap: 8px; margin-top: 16px; color: var(--muted); font-size: 11px; }
.update-progress-track { height: 6px; overflow: hidden; border-radius: 999px; background: var(--surface-raised); }
.update-progress-fill { height: 100%; border-radius: inherit; background: var(--accent-strong); transition: width .16s ease; }
.update-progress-fill.indeterminate { width: 36%; animation: update-progress 1.25s ease-in-out infinite alternate; }
.update-status-message, .update-error-message { margin: 16px 0 0; font-size: 11px; line-height: 1.5; }
.update-status-message { color: var(--green); }
.update-error-message { color: var(--danger); overflow-wrap: anywhere; }
.update-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.update-dialog-actions button { min-height: 36px; border: 1px solid var(--line-strong); border-radius: 7px; padding: 0 12px; font-size: 11px; font-weight: 650; cursor: pointer; }
.update-later-button { color: var(--ink-soft); background: var(--surface-raised); }
.update-install-button { color: #fff; border-color: var(--accent-strong) !important; background: var(--accent-strong); }
.update-install-button:disabled { opacity: .65; }
@keyframes update-progress { from { transform: translateX(-35%); } to { transform: translateX(195%); } }

.composer-column :deep(.payload-card) {
  border-bottom: 0;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.composer-column :deep(.publish-card),
.composer-column :deep(.publish-rail) {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.composer-column :deep(.publish-card) {
  padding: 9px 14px 10px;
}
</style>
