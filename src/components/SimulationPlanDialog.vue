<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { IconChevronRight, IconDeviceFloppy, IconPlus, IconSchema, IconServer, IconSettings, IconX } from '@tabler/icons-vue'
import type { MqttVersion, PayloadFormat, SimulationPlan } from '../types'

const props = defineProps<{
  plans: SimulationPlan[]
  selectedScenarioId: string
  selectPlan: (scenarioId: string) => Promise<void>
  savePlan: (plan: SimulationPlan) => Promise<void>
  deletePlan: (scenarioId: string) => Promise<void>
}>()

const emit = defineEmits<{ close: [] }>()
const dialogElement = ref<HTMLElement | null>(null)

const mode = ref<'list' | 'create' | 'edit'>('list')
const focusedScenarioId = ref(props.selectedScenarioId)
const draft = ref<SimulationPlan | null>(null)
const pendingDeleteId = ref('')
const errorMessage = ref('')
const busy = ref(false)
const selectedPlan = computed(() => props.plans.find((plan) => plan.scenario.id === focusedScenarioId.value) ?? props.plans[0])
const sharedConnectionCount = computed(() => {
  if (!draft.value) return 1
  return props.plans.filter((plan) => plan.profile.id === draft.value?.profile.id).length
})
const intervalSeconds = computed({
  get: () => draft.value ? Math.max(0.1, draft.value.scenario.intervalMs / 1000) : 1,
  set: (value: number) => {
    if (draft.value) draft.value.scenario.intervalMs = Math.max(100, Math.round(value * 1000))
  },
})

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function newPlan() {
  const source = selectedPlan.value ?? props.plans[0]
  if (!source) return
  const plan = clone(source)
  const nextNumber = props.plans.length + 1
  plan.profile.id = crypto.randomUUID()
  plan.profile.name = `新连接配置 ${nextNumber}`
  plan.scenario.id = crypto.randomUUID()
  plan.scenario.name = `新仿真方案 ${nextNumber}`
  plan.scenario.profileId = plan.profile.id
  draft.value = plan
  mode.value = 'create'
  pendingDeleteId.value = ''
  errorMessage.value = ''
}

function editPlan(plan: SimulationPlan) {
  draft.value = clone(plan)
  mode.value = 'edit'
  pendingDeleteId.value = ''
  errorMessage.value = ''
}

function cancelEdit() {
  draft.value = null
  mode.value = 'list'
  errorMessage.value = ''
}

async function select(plan: SimulationPlan) {
  focusedScenarioId.value = plan.scenario.id
  await props.selectPlan(plan.scenario.id)
}

function setMqttVersion(event: Event) {
  if (!draft.value) return
  const version = (event.target as HTMLSelectElement).value as MqttVersion
  draft.value.profile.mqttVersion = version
  draft.value.scenario.mqttVersion = version
}

function setPublishCount(event: Event) {
  if (!draft.value) return
  const raw = (event.target as HTMLInputElement).value.trim()
  draft.value.scenario.publishCountPerDevice = raw ? Math.max(1, Math.round(Number(raw))) : null
}

function setQos(event: Event) {
  if (!draft.value) return
  draft.value.scenario.qos = Number((event.target as HTMLSelectElement).value) as 0 | 1 | 2
}

function setPayloadFormat(event: Event) {
  if (!draft.value) return
  draft.value.scenario.payloadFormat = (event.target as HTMLSelectElement).value as PayloadFormat
}

async function saveDraft() {
  if (!draft.value || busy.value) return
  const next = clone(draft.value)
  next.profile.name = next.profile.name.trim()
  next.profile.host = next.profile.host.trim()
  next.scenario.name = next.scenario.name.trim()
  next.scenario.topicTemplate = next.scenario.topicTemplate.trim()
  if (!next.profile.name || !next.profile.host || !next.scenario.name || !next.scenario.topicTemplate) {
    errorMessage.value = '请填写连接名称、Broker 地址、方案名称和发布主题。'
    return
  }
  next.profile.port = Math.min(65535, Math.max(1, Math.round(Number(next.profile.port) || 1883)))
  next.profile.mqttVersion = next.profile.mqttVersion || '5.0'
  next.scenario.profileId = next.profile.id
  next.scenario.mqttVersion = next.profile.mqttVersion
  next.scenario.qos = Number(next.scenario.qos) as 0 | 1 | 2
  next.scenario.publishOptions = {
    messageExpirySeconds: null,
    responseTopic: null,
    correlationDataBase64: null,
    contentType: null,
    userProperties: [],
    ...next.scenario.publishOptions,
    qos: next.scenario.qos,
    retain: next.scenario.retain,
  }
  errorMessage.value = ''
  busy.value = true
  try {
    await props.savePlan(next)
    focusedScenarioId.value = next.scenario.id
    draft.value = null
    mode.value = 'list'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败，请重试。'
  } finally {
    busy.value = false
  }
}

async function confirmDelete() {
  if (!pendingDeleteId.value || busy.value || props.plans.length <= 1) return
  const id = pendingDeleteId.value
  busy.value = true
  try {
    await props.deletePlan(id)
    pendingDeleteId.value = ''
    focusedScenarioId.value = props.plans.find((plan) => plan.scenario.id !== id)?.scenario.id ?? ''
  } finally {
    busy.value = false
  }
}

function closeDialog() {
  if (!busy.value) emit('close')
}

function closeOrBack() {
  if (busy.value) return
  if (mode.value !== 'list') {
    cancelEdit()
    return
  }
  if (pendingDeleteId.value) {
    pendingDeleteId.value = ''
    return
  }
  closeDialog()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeOrBack()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  dialogElement.value?.focus()
})
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <div class="dialog-backdrop plan-dialog-backdrop" role="presentation" @click.self="closeDialog">
    <section ref="dialogElement" class="dialog-surface plan-dialog" :class="{ 'is-editing': mode !== 'list' }" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title" tabindex="-1">
      <header class="plan-dialog-header">
        <div class="plan-dialog-heading">
          <span class="plan-brand-mark"><IconSchema aria-hidden="true" :size="19" :stroke-width="1.8" /></span>
          <div>
            <p class="plan-eyebrow">MQTT SIMULATION WORKSPACE</p>
            <h2 id="plan-dialog-title">{{ mode === 'list' ? '仿真方案' : mode === 'create' ? '新建仿真方案' : '编辑仿真方案' }}</h2>
            <p class="plan-dialog-description">{{ mode === 'list' ? '将 Broker 连接与设备模拟场景组合管理。' : '连接配置与场景参数保存在同一方案中。' }}</p>
          </div>
        </div>
        <div class="plan-dialog-header-actions">
          <span v-if="mode === 'list'" class="plan-count"><strong>{{ plans.length }}</strong> 个方案</span>
          <button v-if="mode === 'list'" class="plan-create-button" type="button" @click="newPlan"><IconPlus aria-hidden="true" :size="16" />新建方案</button>
          <button v-else class="plan-back-button" type="button" @click="cancelEdit">返回列表</button>
          <button class="dialog-close-button" type="button" aria-label="关闭仿真方案" :disabled="busy" @click="closeDialog"><IconX aria-hidden="true" :size="18" /></button>
        </div>
      </header>

      <div v-if="mode === 'list'" class="plan-manager-content">
        <aside class="plan-list-pane" aria-label="已保存仿真方案">
          <div class="plan-list-heading"><span>已保存</span><small>选择一个方案进行编辑或切换</small></div>
          <div class="plan-list-scroll">
            <button
              v-for="plan in plans"
              :key="plan.scenario.id"
              class="plan-list-item"
              :class="{ active: plan.scenario.id === selectedPlan?.scenario.id }"
              type="button"
              @click="select(plan)"
            >
              <span class="plan-list-icon"><IconSchema aria-hidden="true" :size="17" /></span>
              <span class="plan-list-copy">
                <strong>{{ plan.scenario.name }}</strong>
                <small>{{ plan.profile.name }}</small>
                <span class="plan-list-endpoint">{{ plan.profile.host }}:{{ plan.profile.port }}</span>
              </span>
              <span v-if="plan.scenario.id === selectedScenarioId" class="current-plan-badge">当前</span>
              <IconChevronRight v-else class="plan-list-chevron" aria-hidden="true" :size="16" />
            </button>
          </div>
          <p class="plan-list-footnote">删除方案时，如果连接仍被其他方案使用，将会保留该连接。</p>
        </aside>

        <section class="plan-overview-pane">
          <template v-if="selectedPlan">
            <div class="plan-overview-heading">
              <div>
                <p class="plan-eyebrow">{{ selectedPlan.scenario.id === selectedScenarioId ? '当前运行方案' : '方案概览' }}</p>
                <h3>{{ selectedPlan.scenario.name }}</h3>
                <p>{{ selectedPlan.profile.name }} <span class="plan-heading-dot">·</span> {{ selectedPlan.profile.host }}:{{ selectedPlan.profile.port }}</p>
              </div>
              <span class="plan-protocol-badge">MQTT {{ selectedPlan.scenario.mqttVersion ?? selectedPlan.profile.mqttVersion }}</span>
            </div>

            <div class="plan-summary-grid">
              <article class="plan-summary-card">
                <div class="plan-summary-title"><span class="plan-summary-icon"><IconServer aria-hidden="true" :size="16" /></span><strong>连接配置</strong></div>
                <dl>
                  <div><dt>Broker</dt><dd>{{ selectedPlan.profile.host }}:{{ selectedPlan.profile.port }}</dd></div>
                  <div><dt>传输</dt><dd>{{ selectedPlan.profile.useTls ? 'TLS 加密' : 'TCP' }}</dd></div>
                  <div><dt>认证</dt><dd>{{ selectedPlan.profile.username ? `用户名 · ${selectedPlan.profile.username}` : '匿名连接' }}</dd></div>
                  <div><dt>设备数量</dt><dd>{{ selectedPlan.scenario.deviceBatch.count }} 台</dd></div>
                </dl>
              </article>
              <article class="plan-summary-card">
                <div class="plan-summary-title"><span class="plan-summary-icon"><IconSettings aria-hidden="true" :size="16" /></span><strong>模拟场景</strong></div>
                <dl>
                  <div><dt>发布主题</dt><dd class="plan-topic-value">{{ selectedPlan.scenario.topicTemplate }}</dd></div>
                  <div><dt>载荷格式</dt><dd>{{ selectedPlan.scenario.payloadFormat === 'protobuf' ? 'Protobuf' : 'JSON' }}</dd></div>
                  <div><dt>发布质量</dt><dd>QoS {{ selectedPlan.scenario.qos }}</dd></div>
                  <div><dt>发送间隔</dt><dd>{{ (selectedPlan.scenario.intervalMs / 1000).toFixed(1) }} 秒</dd></div>
                </dl>
              </article>
            </div>

            <div class="plan-overview-footer">
              <div v-if="pendingDeleteId === selectedPlan.scenario.id" class="plan-delete-confirm" role="alert">
                <div><strong>删除此仿真方案？</strong><span>方案中的场景将被移除；若连接没有其他场景使用，连接配置也会一并删除。</span></div>
                <div class="plan-delete-actions">
                  <button class="plan-secondary-button compact" type="button" :disabled="busy" @click="pendingDeleteId = ''">取消</button>
                  <button class="plan-danger-button compact" type="button" :disabled="busy" @click="confirmDelete">确认删除</button>
                </div>
              </div>
              <p v-else-if="plans.length <= 1" class="plan-minimum-hint">至少保留一个仿真方案。</p>
              <div v-else class="plan-action-row">
                <button class="plan-danger-button" type="button" @click="pendingDeleteId = selectedPlan.scenario.id"><span class="plan-delete-mark">×</span>删除</button>
                <div class="plan-action-spacer" />
                <button class="plan-secondary-button" type="button" @click="editPlan(selectedPlan)"><IconSettings aria-hidden="true" :size="15" />编辑方案</button>
                <button v-if="selectedPlan.scenario.id !== selectedScenarioId" class="plan-primary-button" type="button" @click="select(selectedPlan)">切换到此方案<IconChevronRight aria-hidden="true" :size="15" /></button>
                <span v-else class="plan-active-label"><i />正在使用</span>
              </div>
            </div>
          </template>
          <div v-else class="plan-empty-state">
            <span><IconSchema aria-hidden="true" :size="24" /></span>
            <strong>还没有仿真方案</strong>
            <small>创建一个方案，将 Broker 连接与模拟场景放在一起管理。</small>
            <button class="plan-primary-button" type="button" @click="newPlan"><IconPlus aria-hidden="true" :size="15" />新建方案</button>
          </div>
        </section>
      </div>

      <form v-else-if="draft" class="plan-form-content" @submit.prevent="saveDraft">
        <div class="plan-form-intro">
          <span class="plan-form-step">{{ mode === 'create' ? 'NEW PLAN' : 'EDIT PLAN' }}</span>
          <p>{{ mode === 'create' ? '新方案以当前配置为起点，你可以在下方分别调整连接与场景。' : '修改后的连接参数会同步到所有共用该连接的方案。' }}</p>
        </div>

        <div class="plan-form-grid">
          <section class="plan-edit-card">
            <div class="plan-edit-card-heading">
              <span class="plan-edit-icon connection-edit-icon"><IconServer aria-hidden="true" :size="17" /></span>
              <div><h3>连接配置</h3><p>Broker 地址、协议与设备身份</p></div>
              <span class="plan-section-index">01</span>
            </div>
            <div class="plan-fields">
              <label class="plan-field full"><span>连接名称</span><input v-model="draft.profile.name" required maxlength="60" placeholder="例如：实验室 Broker" /></label>
              <label class="plan-field full"><span>Broker 地址</span><input v-model="draft.profile.host" required maxlength="255" placeholder="broker.example.com" /></label>
              <div class="plan-field-pair">
                <label class="plan-field"><span>端口</span><input v-model.number="draft.profile.port" type="number" min="1" max="65535" required /></label>
                <label class="plan-field"><span>MQTT 版本</span><select :value="draft.profile.mqttVersion" @change="setMqttVersion"><option value="5.0">MQTT 5.0</option><option value="3.1.1">MQTT 3.1.1</option></select></label>
              </div>
              <label class="plan-field full"><span>用户名 <small>可选</small></span><input v-model="draft.profile.username" autocomplete="off" placeholder="匿名连接时留空" /></label>
              <label class="plan-field full"><span>CA 证书路径 <small>启用 TLS 时可选</small></span><input v-model="draft.profile.caCertPath" placeholder="证书文件路径" /></label>
              <label class="plan-toggle-row">
                <span class="plan-toggle-copy"><strong>启用 TLS 加密</strong><small>使用安全传输连接 Broker</small></span>
                <input v-model="draft.profile.useTls" type="checkbox" />
              </label>
              <div class="plan-field-pair">
                <label class="plan-field"><span>模拟设备数</span><input v-model.number="draft.scenario.deviceBatch.count" type="number" min="1" max="100" required /></label>
                <label class="plan-field"><span>设备 ID 前缀</span><input v-model="draft.scenario.deviceBatch.deviceIdPrefix" maxlength="48" /></label>
              </div>
            </div>
            <p v-if="mode === 'edit' && sharedConnectionCount > 1" class="plan-shared-note">此连接还被 {{ sharedConnectionCount - 1 }} 个仿真方案使用，保存后连接设置会同步更新。</p>
          </section>

          <section class="plan-edit-card">
            <div class="plan-edit-card-heading">
              <span class="plan-edit-icon scenario-edit-icon"><IconSettings aria-hidden="true" :size="17" /></span>
              <div><h3>模拟场景</h3><p>发布主题、载荷格式与发送节奏</p></div>
              <span class="plan-section-index">02</span>
            </div>
            <div class="plan-fields">
              <label class="plan-field full"><span>方案名称</span><input v-model="draft.scenario.name" required maxlength="60" placeholder="例如：温湿度遥测" /></label>
              <label class="plan-field full"><span>发布主题</span><input v-model="draft.scenario.topicTemplate" required placeholder="sensors/{{deviceId}}/telemetry" class="plan-mono-input" /></label>
              <div class="plan-field-pair">
                <label class="plan-field"><span>载荷格式</span><select :value="draft.scenario.payloadFormat" @change="setPayloadFormat"><option value="json">JSON</option><option value="protobuf">Protobuf</option></select></label>
                <label class="plan-field"><span>QoS</span><select :value="draft.scenario.qos" @change="setQos"><option :value="0">QoS 0</option><option :value="1">QoS 1</option><option :value="2">QoS 2</option></select></label>
              </div>
              <div class="plan-field-pair">
                <label class="plan-field"><span>发送间隔（秒）</span><input v-model.number="intervalSeconds" type="number" min="0.1" step="0.1" required /></label>
                <label class="plan-field"><span>每设备发送次数 <small>留空为不限</small></span><input :value="draft.scenario.publishCountPerDevice ?? ''" type="number" min="1" placeholder="不限" @input="setPublishCount" /></label>
              </div>
              <label class="plan-toggle-row">
                <span class="plan-toggle-copy"><strong>保留消息</strong><small>Broker 保存该主题的最后一条消息</small></span>
                <input v-model="draft.scenario.retain" type="checkbox" />
              </label>
              <div class="plan-payload-note"><span>载荷编辑</span><p>JSON 模板与 Protobuf Schema 可在工作台的「消息载荷」区域继续编辑。</p></div>
            </div>
          </section>
        </div>

        <footer class="plan-form-footer">
          <p v-if="errorMessage" class="plan-form-error" role="alert">{{ errorMessage }}</p>
          <p v-else class="plan-form-caption">保存后可在工作台顶部快速切换方案。</p>
          <div><button class="plan-secondary-button" type="button" :disabled="busy" @click="cancelEdit">取消</button><button class="plan-primary-button" type="submit" :disabled="busy"><IconDeviceFloppy aria-hidden="true" :size="16" />{{ busy ? '正在保存…' : '保存仿真方案' }}</button></div>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.plan-dialog-backdrop { z-index: 210; padding: 22px; }
.plan-dialog { width: min(1120px, 100%); max-height: min(800px, calc(100dvh - 44px)); display: flex; flex-direction: column; border-color: color-mix(in srgb, var(--line-strong) 72%, var(--accent)); border-radius: 16px; }
.plan-dialog-header { min-height: 100px; display: flex; align-items: center; justify-content: space-between; gap: 22px; padding: 20px 24px; border-bottom: 1px solid var(--line); background: linear-gradient(112deg, color-mix(in srgb, var(--accent-soft) 55%, var(--surface)) 0%, var(--surface) 53%); }
.plan-dialog-heading { min-width: 0; display: flex; align-items: center; gap: 15px; }
.plan-brand-mark { width: 46px; height: 46px; display: grid; flex: 0 0 46px; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent); border-radius: 12px; color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 1px 0 color-mix(in srgb, white 8%, transparent); }
.plan-eyebrow { margin: 0 0 5px; color: var(--accent); font: 700 9px var(--font-mono); letter-spacing: .13em; }
.plan-dialog-heading h2 { margin: 0; color: var(--ink); font-size: 21px; font-weight: 720; letter-spacing: -.035em; }
.plan-dialog-description { margin: 4px 0 0; color: var(--muted); font-size: 11px; }
.plan-dialog-header-actions { display: flex; align-items: center; gap: 9px; flex: 0 0 auto; }
.plan-count { color: var(--muted); font-size: 11px; white-space: nowrap; }
.plan-count strong { color: var(--ink); font: 650 12px var(--font-mono); }
.plan-create-button, .plan-primary-button, .plan-secondary-button, .plan-danger-button, .plan-back-button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid transparent; border-radius: 7px; padding: 0 12px; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: pointer; transition: .14s ease; }
.plan-create-button, .plan-primary-button { border-color: var(--accent); color: #062126; background: var(--accent); }
.plan-create-button:hover, .plan-primary-button:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--accent-strong); }
.plan-create-button { min-height: 34px; }
.plan-secondary-button, .plan-back-button { border-color: var(--line-strong); color: var(--ink-soft); background: var(--surface-raised); }
.plan-secondary-button:hover:not(:disabled), .plan-back-button:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.plan-danger-button { border-color: color-mix(in srgb, var(--danger) 26%, var(--line)); color: var(--danger); background: color-mix(in srgb, var(--danger-soft) 50%, var(--surface)); }
.plan-danger-button:hover:not(:disabled) { border-color: var(--danger); background: var(--danger-soft); }
.plan-primary-button:disabled, .plan-secondary-button:disabled, .plan-danger-button:disabled { opacity: .55; cursor: wait; }
.dialog-close-button { flex: 0 0 34px; }
.plan-manager-content { min-height: 0; flex: 1; display: grid; grid-template-columns: minmax(265px, .78fr) minmax(0, 1.42fr); }
.plan-list-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid var(--line); background: var(--surface-muted); }
.plan-list-heading { min-height: 56px; display: flex; flex-direction: column; justify-content: center; gap: 3px; padding: 0 18px; border-bottom: 1px solid var(--line); }
.plan-list-heading > span { color: var(--ink-soft); font-size: 11px; font-weight: 700; }
.plan-list-heading small { color: var(--subtle); font-size: 9px; }
.plan-list-scroll { flex: 1; min-height: 0; overflow: auto; padding: 8px; scrollbar-width: thin; scrollbar-color: var(--line-strong) transparent; }
.plan-list-item { width: 100%; min-width: 0; display: flex; align-items: center; gap: 10px; margin-bottom: 5px; border: 1px solid transparent; border-radius: 9px; padding: 10px 9px; color: var(--ink-soft); background: transparent; text-align: left; cursor: pointer; transition: border-color .14s ease, background .14s ease; }
.plan-list-item:hover { border-color: var(--line); background: var(--surface); }
.plan-list-item.active { border-color: color-mix(in srgb, var(--accent) 34%, var(--line)); background: color-mix(in srgb, var(--accent-soft) 57%, var(--surface)); }
.plan-list-icon { width: 34px; height: 34px; display: grid; flex: 0 0 34px; place-items: center; border-radius: 8px; color: var(--muted); background: var(--surface-raised); }
.plan-list-item.active .plan-list-icon { color: var(--accent); background: var(--accent-soft); }
.plan-list-copy { min-width: 0; display: grid; flex: 1; gap: 3px; }
.plan-list-copy strong, .plan-list-copy small, .plan-list-endpoint { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-list-copy strong { color: var(--ink); font-size: 11px; font-weight: 700; }
.plan-list-copy small { color: var(--muted); font-size: 9px; }
.plan-list-endpoint { color: var(--subtle); font: 9px var(--font-mono); }
.current-plan-badge { flex: 0 0 auto; border-radius: 4px; padding: 4px 6px; color: var(--green); background: var(--green-soft); font-size: 9px; font-weight: 700; }
.plan-list-chevron { flex: 0 0 auto; color: var(--subtle); }
.plan-list-footnote { margin: 0; padding: 11px 15px; border-top: 1px solid var(--line); color: var(--subtle); font-size: 9px; line-height: 1.5; }
.plan-overview-pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 24px; overflow: auto; }
.plan-overview-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 19px; border-bottom: 1px solid var(--line); }
.plan-overview-heading h3 { overflow: hidden; margin: 2px 0 5px; color: var(--ink); font-size: 19px; font-weight: 720; letter-spacing: -.03em; text-overflow: ellipsis; white-space: nowrap; }
.plan-overview-heading > div > p:last-child { margin: 0; color: var(--muted); font-size: 10px; }
.plan-heading-dot { padding: 0 5px; color: var(--subtle); }
.plan-protocol-badge { flex: 0 0 auto; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; color: var(--accent); background: var(--surface-muted); font: 10px var(--font-mono); }
.plan-summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; margin-top: 18px; }
.plan-summary-card { min-width: 0; border: 1px solid var(--line); border-radius: 10px; padding: 13px 14px; background: var(--surface-muted); }
.plan-summary-title { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.plan-summary-icon { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; color: var(--accent); background: var(--accent-soft); }
.plan-summary-title strong { color: var(--ink-soft); font-size: 10px; }
.plan-summary-card dl { display: grid; gap: 8px; margin: 0; }
.plan-summary-card dl > div { min-width: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.plan-summary-card dt { flex: 0 0 auto; color: var(--subtle); font-size: 9px; }
.plan-summary-card dd { min-width: 0; margin: 0; overflow: hidden; color: var(--ink-soft); font-size: 9px; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.plan-summary-card dd.plan-topic-value { font-family: var(--font-mono); }
.plan-overview-footer { min-height: 54px; margin-top: auto; padding-top: 18px; }
.plan-action-row { display: flex; align-items: center; gap: 8px; }
.plan-action-spacer { flex: 1; }
.plan-active-label { display: inline-flex; align-items: center; gap: 6px; padding: 0 8px; color: var(--green); font-size: 10px; font-weight: 700; }
.plan-active-label i { width: 6px; height: 6px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 3px var(--green-soft); }
.plan-delete-mark { font-size: 17px; font-weight: 400; line-height: 1; }
.plan-danger-button.compact, .plan-secondary-button.compact { min-height: 30px; padding: 0 9px; font-size: 10px; }
.plan-delete-confirm { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--line)); border-radius: 8px; padding: 10px 11px; background: var(--danger-soft); }
.plan-delete-confirm > div:first-child { min-width: 0; display: grid; gap: 3px; }
.plan-delete-confirm strong { color: var(--danger); font-size: 10px; }
.plan-delete-confirm span { color: var(--muted); font-size: 9px; line-height: 1.45; }
.plan-delete-actions { display: flex; flex: 0 0 auto; gap: 6px; }
.plan-minimum-hint { margin: 0; color: var(--subtle); font-size: 10px; text-align: right; }
.plan-empty-state { min-height: 340px; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 10px; color: var(--muted); text-align: center; }
.plan-empty-state > span { width: 48px; height: 48px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 13px; color: var(--accent); background: var(--accent-soft); }
.plan-empty-state strong { color: var(--ink); font-size: 13px; }
.plan-empty-state small { max-width: 280px; margin-bottom: 5px; font-size: 10px; line-height: 1.55; }
.plan-form-content { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: auto; }
.plan-form-intro { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-bottom: 1px solid var(--line); background: var(--surface-muted); }
.plan-form-step { flex: 0 0 auto; border: 1px solid var(--line); border-radius: 5px; padding: 5px 7px; color: var(--accent); background: var(--surface); font: 700 8px var(--font-mono); letter-spacing: .08em; }
.plan-form-intro p { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.5; }
.plan-form-grid { min-height: 0; flex: 1; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 14px; overflow: auto; padding: 18px 22px; }
.plan-edit-card { min-width: 0; border: 1px solid var(--line); border-radius: 11px; padding: 16px; background: var(--surface-muted); }
.plan-edit-card-heading { display: flex; align-items: center; gap: 10px; padding-bottom: 13px; border-bottom: 1px solid var(--line); }
.plan-edit-icon { width: 34px; height: 34px; display: grid; flex: 0 0 34px; place-items: center; border-radius: 8px; }
.connection-edit-icon { color: var(--accent); background: var(--accent-soft); }
.scenario-edit-icon { color: var(--green); background: var(--green-soft); }
.plan-edit-card-heading > div { min-width: 0; }
.plan-edit-card-heading h3 { margin: 0; color: var(--ink); font-size: 12px; font-weight: 720; }
.plan-edit-card-heading p { margin: 3px 0 0; color: var(--muted); font-size: 9px; }
.plan-section-index { margin-left: auto; color: var(--subtle); font: 10px var(--font-mono); }
.plan-fields { display: grid; gap: 12px; padding-top: 13px; }
.plan-field { min-width: 0; display: grid; align-content: start; gap: 6px; }
.plan-field > span { color: var(--ink-soft); font-size: 9px; font-weight: 650; }
.plan-field > span small { color: var(--subtle); font-size: 8px; font-weight: 400; }
.plan-field input, .plan-field select { width: 100%; min-width: 0; height: 34px; border: 1px solid var(--line-strong); border-radius: 6px; outline: none; padding: 0 9px; color: var(--ink); background: var(--surface-input); font-size: 10px; }
.plan-field input::placeholder { color: var(--subtle); }
.plan-field input:focus, .plan-field select:focus { border-color: var(--focus-ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-ring) 19%, transparent); }
.plan-field.full { grid-column: 1 / -1; }
.plan-field-pair { min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.plan-mono-input { font-family: var(--font-mono) !important; }
.plan-toggle-row { min-height: 50px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid var(--line); border-radius: 7px; padding: 8px 10px; background: var(--surface); cursor: pointer; }
.plan-toggle-copy { min-width: 0; display: grid; gap: 3px; }
.plan-toggle-copy strong { color: var(--ink-soft); font-size: 9px; }
.plan-toggle-copy small { color: var(--muted); font-size: 8px; }
.plan-toggle-row input { width: 15px; height: 15px; flex: 0 0 auto; accent-color: var(--accent-strong); }
.plan-shared-note { margin: 12px 0 0; border-left: 2px solid var(--amber); padding: 6px 8px; color: var(--muted); background: var(--amber-soft); font-size: 9px; line-height: 1.5; }
.plan-payload-note { border: 1px solid var(--line); border-radius: 7px; padding: 9px 10px; background: var(--surface); }
.plan-payload-note span { color: var(--ink-soft); font-size: 9px; font-weight: 700; }
.plan-payload-note p { margin: 4px 0 0; color: var(--muted); font-size: 9px; line-height: 1.5; }
.plan-form-footer { min-height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: auto; border-top: 1px solid var(--line); padding: 10px 22px; background: var(--surface); }
.plan-form-footer > div { display: flex; flex: 0 0 auto; gap: 8px; }
.plan-form-caption, .plan-form-error { margin: 0; color: var(--subtle); font-size: 9px; line-height: 1.45; }
.plan-form-error { color: var(--danger); }

@media (max-width: 800px) {
  .plan-dialog-backdrop { align-items: start; padding: 10px; }
  .plan-dialog { max-height: calc(100dvh - 20px); }
  .plan-manager-content { grid-template-columns: minmax(0, 1fr); }
  .plan-list-pane { max-height: 220px; border-right: 0; border-bottom: 1px solid var(--line); }
  .plan-list-scroll { max-height: 160px; }
  .plan-overview-pane { min-height: 300px; padding: 18px; }
  .plan-form-grid { grid-template-columns: minmax(0, 1fr); padding: 14px; }
}
@media (max-width: 540px) {
  .plan-dialog-backdrop { padding: 6px; }
  .plan-dialog { max-height: calc(100dvh - 12px); border-radius: 12px; }
  .plan-dialog-header { min-height: 78px; gap: 8px; padding: 12px; }
  .plan-dialog-heading { gap: 9px; }
  .plan-brand-mark { width: 36px; height: 36px; flex-basis: 36px; border-radius: 9px; }
  .plan-dialog-heading h2 { font-size: 17px; }
  .plan-dialog-description { max-width: 205px; font-size: 9px; line-height: 1.4; }
  .plan-eyebrow { font-size: 7px; }
  .plan-dialog-header-actions { gap: 5px; }
  .plan-count { display: none; }
  .plan-create-button { min-height: 31px; gap: 4px; padding: 0 7px; font-size: 9px; }
  .plan-dialog-header-actions .dialog-close-button { width: 30px; height: 30px; flex-basis: 30px; }
  .plan-overview-pane { min-height: 0; padding: 14px 11px; }
  .plan-summary-grid { grid-template-columns: minmax(0, 1fr); }
  .plan-overview-heading h3 { font-size: 16px; }
  .plan-action-row { flex-wrap: wrap; }
  .plan-action-spacer { display: none; }
  .plan-active-label { margin-left: auto; }
  .plan-delete-confirm { align-items: flex-start; flex-direction: column; }
  .plan-delete-actions { width: 100%; justify-content: flex-end; }
  .plan-form-intro { align-items: flex-start; padding: 10px 12px; }
  .plan-form-grid { gap: 10px; padding: 10px; }
  .plan-edit-card { padding: 12px; }
  .plan-form-footer { align-items: flex-start; flex-direction: column; padding: 10px 12px; }
  .plan-form-footer > div { width: 100%; }
  .plan-form-footer > div > button { flex: 1; }
}
</style>
