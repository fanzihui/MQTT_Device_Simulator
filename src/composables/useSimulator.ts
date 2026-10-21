import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import type {
  BrokerConnection,
  BrokerProfile,
  DeviceBatch,
  DeviceStatus,
  FieldRange,
  MessageEntry,
  MqttVersion,
  PayloadFormat,
  ProtoSchemaEntry,
  PublishOptions,
  PublishRequest,
  Scenario,
  SimulationPlan,
  SystemLogEntry,
  WorkspaceData,
} from '../types'
import {
  bytesFromHex,
  encodeProtoMessage,
  formatHex,
  getMessageFields,
  parseProtoSchema,
  resolveJsonTemplate,
  sampleInclusiveFloat,
  type ProtoFieldDescriptor,
} from '../lib/payload'
import {
  isDesktopApp,
  listenToSimulatorEvents,
  loadWorkspace,
  publishMessages,
  retryDevice as invokeRetryDevice,
  saveWorkspace,
  startBatch,
  startMonitor as invokeStartMonitor,
  stopBatch,
  stopMonitor as invokeStopMonitor,
} from '../lib/tauri'

const defaultJsonTemplate = `{
  "deviceId": "{{deviceId}}",
  "clientId": "{{clientId}}",
  "timestamp": "{{timestamp}}",
  "temperature": {{randomFloat:18:28}},
  "humidity": {{randomFloat:35:65}},
  "battery": {{randomInt:70:100}},
  "status": "online"
}`

const defaultProtoSource = `syntax = "proto3";

package telemetry;

enum DeviceState {
  DEVICE_STATE_UNKNOWN = 0;
  DEVICE_STATE_ONLINE = 1;
  DEVICE_STATE_OFFLINE = 2;
}

message Location {
  double latitude = 1;
  double longitude = 2;
}

message DeviceTelemetry {
  string device_id = 1;
  double temperature = 2;
  double humidity = 3;
  int64 timestamp_ms = 4;
  repeated string tags = 5;
  bytes signature = 6;
  DeviceState state = 7;
  Location location = 8;
}`

const defaultSchema: ProtoSchemaEntry = {
  id: 'schema-telemetry-default',
  name: 'Telemetry 示例',
  source: defaultProtoSource,
  messageType: 'telemetry.DeviceTelemetry',
}

function createDefaultProfile(): BrokerProfile {
  return {
    id: crypto.randomUUID(),
    name: '本地 Broker',
    host: 'localhost',
    port: 1883,
    mqttVersion: '5.0',
    useTls: false,
    caCertPath: null,
    username: null,
    sessionExpirySeconds: 0,
  }
}

function createDefaultWorkspace(): WorkspaceData {
  const profile = createDefaultProfile()
  const scenario = createDefaultScenario(profile.id, profile.mqttVersion, 'scenario-default')
  return { version: 1, profiles: [profile], schemas: [defaultSchema], scenarios: [scenario] }
}

function defaultFieldRanges(): Record<string, FieldRange> {
  return {
    temperature: { enabled: true, min: 18, max: 28 },
    humidity: { enabled: true, min: 35, max: 65 },
  }
}

function createDefaultScenario(profileId: string, mqttVersion: MqttVersion, id = `scenario-${profileId}`): Scenario {
  return {
    id,
    name: '默认遥测模拟',
    profileId,
    mqttVersion,
    deviceBatch: { count: 1, deviceIdPrefix: 'sensor-', clientIdPrefix: 'sim-sensor-' },
    topicTemplate: 'sensors/{{deviceId}}/telemetry',
    payloadFormat: 'json',
    jsonTemplate: defaultJsonTemplate,
    schemaId: defaultSchema.id,
    messageType: defaultSchema.messageType,
    protobufValuesJson: JSON.stringify({
      device_id: '{{deviceId}}', temperature: 23.5, humidity: 50, timestamp_ms: '{{timestamp}}',
      tags: ['simulated', 'telemetry'], signature: '', state: 'DEVICE_STATE_ONLINE',
      location: { latitude: 31.2304, longitude: 121.4737 },
    }, null, 2),
    qos: 1,
    retain: false,
    publishOptions: emptyPublishOptions(),
    fieldRanges: defaultFieldRanges(),
    intervalMs: 1000,
    publishCountPerDevice: 10,
  }
}

function emptyPublishOptions(): PublishOptions {
  return {
    qos: 1,
    retain: false,
    messageExpirySeconds: null,
    responseTopic: null,
    correlationDataBase64: null,
    contentType: null,
    userProperties: [],
  }
}

export function useSimulator() {
  const workspace = ref<WorkspaceData>(createDefaultWorkspace())
  const profile = ref<BrokerProfile>({ ...workspace.value.profiles[0]! })
  const mqttVersion = ref<MqttVersion>(profile.value.mqttVersion)
  const password = ref('')
  const selectedScenarioId = ref(workspace.value.scenarios[0]?.id ?? '')
  const scenarioName = ref(workspace.value.scenarios[0]?.name ?? '默认遥测模拟')
  const deviceBatch = ref<DeviceBatch>({ count: 1, deviceIdPrefix: 'sensor-', clientIdPrefix: 'sim-sensor-' })
  const topicTemplate = ref('sensors/{{deviceId}}/telemetry')
  const payloadFormat = ref<PayloadFormat>('json')
  const jsonTemplate = ref(defaultJsonTemplate)
  const selectedSchemaId = ref(defaultSchema.id)
  const messageType = ref(defaultSchema.messageType)
  const protoValues = ref<Record<string, unknown>>({
    device_id: '{{deviceId}}', temperature: 23.5, humidity: 50, timestamp_ms: '{{timestamp}}',
    tags: ['simulated', 'telemetry'], signature: '', state: 'DEVICE_STATE_ONLINE',
    location: { latitude: 31.2304, longitude: 121.4737 },
  })
  const fieldRanges = ref<Record<string, FieldRange>>(defaultFieldRanges())
  const publishOptions = ref<PublishOptions>(emptyPublishOptions())
  const publishMode = ref<'manual' | 'periodic'>('manual')
  const intervalSeconds = ref(1)
  const countPerDevice = ref<number | null>(10)
  const monitorTopics = ref('sensors/+/telemetry')
  const devices = ref<DeviceStatus[]>([])
  const published = shallowRef<MessageEntry[]>([])
  const received = shallowRef<MessageEntry[]>([])
  const logs = shallowRef<SystemLogEntry[]>([])
  const selectedActivityTab = ref<'published' | 'received' | 'logs'>('published')
  const selectedMessageId = ref('')
  const decodeSchemaId = ref('')
  const decodeMessageType = ref('')
  const connecting = ref(false)
  const scheduleRunning = ref(false)
  const monitorRunning = ref(false)
  const workspaceReady = ref(false)
  const profileMenuId = computed(() => profile.value.id)
  const profileScenarios = computed(() => workspace.value.scenarios.filter((scenario) => scenario.profileId === profile.value.id))
  const simulationPlans = computed<SimulationPlan[]>(() => workspace.value.scenarios.flatMap((scenario) => {
    const planProfile = workspace.value.profiles.find((item) => item.id === scenario.profileId)
    return planProfile ? [{ profile: planProfile, scenario }] : []
  }))
  const activeSchema = computed(() => workspace.value.schemas.find((schema) => schema.id === selectedSchemaId.value))
  const running = computed(() => devices.value.some((device) => !['stopped', 'error'].includes(device.status)))
  const onlineDevices = computed(() => devices.value.filter((device) => device.status === 'connected'))
  const successCount = computed(() => devices.value.reduce((total, device) => total + device.successCount, 0))
  const failureCount = computed(() => devices.value.reduce((total, device) => total + device.failureCount, 0))

  let scheduleTimer: number | undefined
  let scheduleBusy = false
  let scheduleAttempts = new Map<string, number>()
  let unlistenEvents: Array<() => void> = []

  function addLog(level: SystemLogEntry['level'], message: string) {
    const next: SystemLogEntry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, message }
    logs.value = [...logs.value, next].slice(-200)
  }

  function appendMessage(target: 'published' | 'received', entry: MessageEntry) {
    const next = { ...entry, direction: target === 'published' ? 'out' : 'in' } as MessageEntry
    if (target === 'published') published.value = [...published.value, next].slice(-200)
    else received.value = [...received.value, next].slice(-200)
    while (published.value.length + received.value.length > 200) {
      const oldestPublished = published.value[0]
      const oldestReceived = received.value[0]
      if (!oldestReceived || (oldestPublished && oldestPublished.timestamp <= oldestReceived.timestamp)) {
        published.value = published.value.slice(1)
      } else {
        received.value = received.value.slice(1)
      }
    }
    selectedMessageId.value = next.id
  }

  async function saveCurrent() {
    const currentProfile = {
      ...profile.value,
      mqttVersion: mqttVersion.value,
      username: profile.value.username || null,
      caCertPath: profile.value.caCertPath || null,
    }
    const profileIndex = workspace.value.profiles.findIndex((item) => item.id === currentProfile.id)
    workspace.value.profiles = profileIndex < 0
      ? [...workspace.value.profiles, currentProfile]
      : workspace.value.profiles.map((item) => item.id === currentProfile.id ? currentProfile : item)

    const scenario: Scenario = {
      id: selectedScenarioId.value || crypto.randomUUID(),
      name: scenarioName.value.trim() || '未命名场景',
      profileId: currentProfile.id,
      mqttVersion: mqttVersion.value,
      deviceBatch: { ...deviceBatch.value },
      topicTemplate: topicTemplate.value,
      payloadFormat: payloadFormat.value,
      jsonTemplate: jsonTemplate.value,
      schemaId: selectedSchemaId.value || null,
      messageType: messageType.value || null,
      protobufValuesJson: JSON.stringify(protoValues.value, null, 2),
      qos: publishOptions.value.qos,
      retain: publishOptions.value.retain,
      publishOptions: { ...publishOptions.value, userProperties: publishOptions.value.userProperties.map((pair) => [...pair] as [string, string]) },
      fieldRanges: Object.fromEntries(Object.entries(fieldRanges.value).map(([name, range]) => [name, { ...range }])),
      intervalMs: Math.round(intervalSeconds.value * 1000),
      publishCountPerDevice: countPerDevice.value,
    }
    selectedScenarioId.value = scenario.id
    scenarioName.value = scenario.name
    workspace.value.scenarios = workspace.value.scenarios.some((item) => item.id === scenario.id)
      ? workspace.value.scenarios.map((item) => item.id === scenario.id ? scenario : item)
      : [...workspace.value.scenarios, scenario]
    await persistWorkspace('连接配置、场景和 Schema 已保存到本机。')
  }

  async function persistWorkspace(successMessage: string) {
    workspace.value.version = 1
    if (isDesktopApp()) {
      try {
        await saveWorkspace(workspace.value)
        addLog('success', successMessage)
      } catch (error) {
        addLog('error', `保存配置失败：${errorMessage(error)}`)
      }
    } else {
      addLog('info', '当前为浏览器预览，配置暂存于页面内存。')
    }
  }

  async function savePlan(plan: SimulationPlan) {
    const nextProfile: BrokerProfile = {
      ...plan.profile,
      mqttVersion: plan.scenario.mqttVersion ?? plan.profile.mqttVersion,
      username: plan.profile.username || null,
      caCertPath: plan.profile.caCertPath || null,
    }
    const nextScenario: Scenario = {
      ...plan.scenario,
      profileId: nextProfile.id,
      mqttVersion: nextProfile.mqttVersion,
    }
    const isActiveProfile = profile.value.id === nextProfile.id
    const isActiveScenario = selectedScenarioId.value === nextScenario.id
    if (isActiveProfile && (running.value || monitorRunning.value)) await stop()

    workspace.value.profiles = workspace.value.profiles.some((item) => item.id === nextProfile.id)
      ? workspace.value.profiles.map((item) => item.id === nextProfile.id ? nextProfile : item)
      : [...workspace.value.profiles, nextProfile]
    workspace.value.scenarios = workspace.value.scenarios.some((item) => item.id === nextScenario.id)
      ? workspace.value.scenarios.map((item) => item.id === nextScenario.id ? nextScenario : item)
      : [...workspace.value.scenarios, nextScenario]

    if (isActiveProfile) profile.value = { ...nextProfile }
    if (isActiveScenario) {
      profile.value = { ...nextProfile }
      password.value = ''
      applyScenario(nextScenario)
    }
    await persistWorkspace('仿真方案已保存到本机。')
    addLog('success', `已保存仿真方案“${nextScenario.name}”。`)
  }

  async function deletePlan(scenarioId: string) {
    const scenario = workspace.value.scenarios.find((item) => item.id === scenarioId)
    if (!scenario) return
    if (workspace.value.scenarios.length <= 1) {
      addLog('warning', '至少保留一个仿真方案。')
      return
    }

    const wasActive = selectedScenarioId.value === scenarioId
    if (wasActive && (running.value || monitorRunning.value)) await stop()
    workspace.value.scenarios = workspace.value.scenarios.filter((item) => item.id !== scenarioId)
    const hasRelatedScenario = workspace.value.scenarios.some((item) => item.profileId === scenario.profileId)
    if (!hasRelatedScenario) {
      workspace.value.profiles = workspace.value.profiles.filter((item) => item.id !== scenario.profileId)
    }

    if (wasActive) {
      const fallbackScenario = workspace.value.scenarios[0]
      const fallbackProfile = fallbackScenario
        ? workspace.value.profiles.find((item) => item.id === fallbackScenario.profileId)
        : undefined
      if (fallbackScenario && fallbackProfile) {
        profile.value = { ...fallbackProfile }
        password.value = ''
        applyScenario(fallbackScenario)
      }
    }
    await persistWorkspace('仿真方案已更新到本机。')
    addLog('info', `已删除仿真方案“${scenario.name}”。`)
  }

  async function selectPlan(scenarioId: string) {
    const scenario = workspace.value.scenarios.find((item) => item.id === scenarioId)
    if (!scenario) return
    if (scenario.profileId !== profile.value.id) await selectProfile(scenario.profileId)
    await selectScenario(scenarioId)
  }

  function applyScenario(scenario: Scenario | undefined) {
    if (!scenario) return
    selectedScenarioId.value = scenario.id
    scenarioName.value = scenario.name
    mqttVersion.value = scenario.mqttVersion
      ?? workspace.value.profiles.find((item) => item.id === scenario.profileId)?.mqttVersion
      ?? '5.0'
    deviceBatch.value = { ...scenario.deviceBatch }
    topicTemplate.value = scenario.topicTemplate
    payloadFormat.value = scenario.payloadFormat
    jsonTemplate.value = scenario.jsonTemplate
    selectedSchemaId.value = scenario.schemaId ?? workspace.value.schemas[0]?.id ?? ''
    messageType.value = scenario.messageType ?? workspace.value.schemas[0]?.messageType ?? ''
    try { protoValues.value = JSON.parse(scenario.protobufValuesJson) as Record<string, unknown> } catch { protoValues.value = {} }
    publishOptions.value = scenario.publishOptions
      ? { ...emptyPublishOptions(), ...scenario.publishOptions, userProperties: scenario.publishOptions.userProperties.map((pair) => [...pair] as [string, string]) }
      : { ...emptyPublishOptions(), qos: scenario.qos as 0 | 1 | 2, retain: scenario.retain }
    fieldRanges.value = scenario.fieldRanges && Object.keys(scenario.fieldRanges).length
      ? Object.fromEntries(Object.entries(scenario.fieldRanges).map(([name, range]) => [name, { ...range }]))
      : defaultFieldRanges()
    intervalSeconds.value = Math.max(0.1, scenario.intervalMs / 1000)
    countPerDevice.value = scenario.publishCountPerDevice ?? null
  }

  async function selectScenario(id: string) {
    const scenario = profileScenarios.value.find((item) => item.id === id)
    if (!scenario || scenario.id === selectedScenarioId.value) return
    const nextMqttVersion = scenario.mqttVersion ?? profile.value.mqttVersion
    if (nextMqttVersion !== mqttVersion.value && (running.value || monitorRunning.value)) await stop()
    applyScenario(scenario)
  }

  function createScenario() {
    const nextNumber = profileScenarios.value.length + 1
    selectedScenarioId.value = crypto.randomUUID()
    scenarioName.value = `新场景 ${nextNumber}`
    addLog('info', `已创建场景草稿“${scenarioName.value}”，保存后会写入本机。`)
  }

  async function selectProfile(id: string) {
    const selected = workspace.value.profiles.find((item) => item.id === id)
    if (!selected || selected.id === profile.value.id) return
    if (running.value || monitorRunning.value) await stop()
    profile.value = { ...selected }
    password.value = ''
    const scenario = workspace.value.scenarios.find((item) => item.profileId === id)
    applyScenario(scenario ?? createDefaultScenario(id, selected.mqttVersion, `draft-${crypto.randomUUID()}`))
  }

  async function createProfile() {
    if (running.value || monitorRunning.value) await stop()
    const next = createDefaultProfile()
    next.name = `新连接 ${workspace.value.profiles.length + 1}`
    profile.value = next
    password.value = ''
    applyScenario(createDefaultScenario(next.id, next.mqttVersion, `draft-${crypto.randomUUID()}`))
    addLog('info', '已创建一个新的本地连接配置。')
  }

  function connectionSnapshot(): BrokerConnection {
    return {
      host: profile.value.host.trim(),
      port: Number(profile.value.port),
      mqttVersion: mqttVersion.value,
      useTls: profile.value.useTls,
      caCertPath: profile.value.caCertPath || null,
      username: profile.value.username || null,
      password: password.value || null,
      sessionExpirySeconds: Number(profile.value.sessionExpirySeconds) || 0,
    }
  }

  function publishOptionsSnapshot(): PublishOptions {
    if (mqttVersion.value === '5.0') {
      return { ...publishOptions.value, userProperties: publishOptions.value.userProperties.map((pair) => [...pair] as [string, string]) }
    }
    return {
      ...publishOptions.value,
      messageExpirySeconds: null,
      responseTopic: null,
      correlationDataBase64: null,
      contentType: null,
      userProperties: [],
    }
  }

  async function connect() {
    if (!isDesktopApp()) {
      addLog('warning', '请在 Tauri 桌面应用中连接 MQTT Broker。')
      return
    }
    if (!profile.value.host.trim()) {
      addLog('error', '请先填写 Broker 地址。')
      return
    }
    stopSchedule()
    connecting.value = true
    try {
      const statuses = await startBatch(connectionSnapshot(), deviceBatch.value)
      devices.value = statuses
      if (statuses.length) addLog('info', `正在启动 ${statuses.length} 台 MQTT ${mqttVersion.value} 虚拟设备。`)
    } catch (error) {
      addLog('error', `启动设备失败：${errorMessage(error)}`)
    } finally {
      connecting.value = false
    }
  }

  async function stop() {
    stopSchedule()
    monitorRunning.value = false
    try {
      if (isDesktopApp()) {
        await Promise.all([stopBatch(), invokeStopMonitor()])
      }
    } catch (error) {
      addLog('warning', `停止连接时返回错误：${errorMessage(error)}`)
    }
    devices.value = devices.value.map((device) => ({ ...device, status: 'stopped' }))
    addLog('info', '设备批次已停止。')
  }

  async function startRetryDevice(deviceId: string) {
    const previous = devices.value.find((device) => device.deviceId === deviceId)
    const status = await invokeRetryDevice(deviceId)
    devices.value = devices.value.map((device) => device.deviceId === deviceId
      ? { ...status, successCount: previous?.successCount ?? device.successCount, failureCount: previous?.failureCount ?? device.failureCount }
      : device)
  }

  async function retryDevice(deviceId: string) {
    if (!isDesktopApp()) return
    try {
      await startRetryDevice(deviceId)
      addLog('info', `正在重试设备 ${deviceId}。`)
    } catch (error) {
      addLog('error', `重试 ${deviceId} 失败：${errorMessage(error)}`)
    }
  }

  async function retryFailedDevices() {
    if (!isDesktopApp()) return
    const retryable = devices.value.filter((device) => ['error', 'disconnected'].includes(device.status))
    if (!retryable.length) return
    addLog('info', `正在批量重试 ${retryable.length} 台失败或断开的设备。`)
    await Promise.all(retryable.map(async (device) => {
      try {
        await startRetryDevice(device.deviceId)
      } catch (error) {
        addLog('error', `重试 ${device.deviceId} 失败：${errorMessage(error)}`)
      }
    }))
  }

  async function startMonitor() {
    if (!isDesktopApp()) {
      addLog('warning', '订阅监听请在 Tauri 桌面应用中使用。')
      return
    }
    const topics = monitorTopics.value.split(/[\n,;]/).map((topic) => topic.trim()).filter(Boolean)
    if (!topics.length) {
      addLog('error', '请至少输入一个订阅主题过滤器。')
      return
    }
    try {
      await invokeStartMonitor(connectionSnapshot(), topics)
      monitorRunning.value = true
      addLog('info', `监视客户端已订阅 ${topics.length} 个主题。`)
    } catch (error) {
      addLog('error', `启动订阅失败：${errorMessage(error)}`)
    }
  }

  async function stopMonitor() {
    try {
      if (isDesktopApp()) await invokeStopMonitor()
    } catch (error) {
      addLog('warning', `停止订阅失败：${errorMessage(error)}`)
    }
    monitorRunning.value = false
    addLog('info', '订阅监听已停止。')
  }

  function topicForDevice(template: string, device: DeviceStatus, timestamp: string) {
    return template
      .replaceAll('{{deviceId}}', device.deviceId)
      .replaceAll('{{clientId}}', device.clientId)
      .replaceAll('{{timestamp}}', timestamp)
  }

  function resolveProtoValue(value: unknown, device: DeviceStatus, timestamp: string): unknown {
    if (typeof value === 'string') {
      return value
        .replaceAll('{{deviceId}}', device.deviceId)
        .replaceAll('{{clientId}}', device.clientId)
        .replaceAll('{{timestamp}}', String(Date.now()))
    }
    if (Array.isArray(value)) return value.map((item) => resolveProtoValue(item, device, timestamp))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, resolveProtoValue(nested, device, timestamp)]))
    }
    return value
  }

  function sampledRange(field: ProtoFieldDescriptor) {
    const range = fieldRanges.value[field.name]
    if (!range?.enabled) return undefined
    if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max) {
      throw new Error(`字段 ${field.name} 的动态范围无效。`)
    }
    const isInteger = !['float', 'double'].includes(field.type)
    if (!isInteger) return sampleInclusiveFloat(range.min, range.max)
    const minimum = Math.ceil(range.min)
    const maximum = Math.floor(range.max)
    if (minimum > maximum) throw new Error(`字段 ${field.name} 的动态范围内没有整数。`)
    return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum
  }

  function protoPayload(device: DeviceStatus, timestamp: string) {
    const schema = activeSchema.value
    if (!schema) throw new Error('请先选择一个 Protobuf Schema。')
    const root = parseProtoSchema(schema.source)
    if (!messageType.value) throw new Error('请先选择 Protobuf 消息类型。')
    const fields = getMessageFields(root, messageType.value)
    const editableValues = JSON.parse(JSON.stringify(protoValues.value)) as Record<string, unknown>
    const value = resolveProtoValue(editableValues, device, timestamp) as Record<string, unknown>
    for (const field of fields) {
      const rangeValue = sampledRange(field)
      if (rangeValue !== undefined) {
        if (field.repeated) {
          const currentValues = Array.isArray(value[field.name]) ? value[field.name] as unknown[] : []
          value[field.name] = currentValues.map(() => sampledRange(field)!)
        } else {
          value[field.name] = rangeValue
        }
      }
      if (field.type === 'bytes') {
        const decodeBytes = (encoded: unknown) => {
          if (typeof encoded !== 'string' || !encoded) return encoded
          if (encoded.startsWith('base64:')) {
            const binary = atob(encoded.slice(7))
            return Uint8Array.from(binary, (character) => character.charCodeAt(0))
          }
          return bytesFromHex(encoded)
        }
        value[field.name] = Array.isArray(value[field.name])
          ? (value[field.name] as unknown[]).map(decodeBytes)
          : decodeBytes(value[field.name])
      }
    }
    const bytes = encodeProtoMessage(root, messageType.value, value)
    return { bytes, preview: formatHex(bytes), value }
  }

  function makePublishRequest(device: DeviceStatus): PublishRequest {
    const timestamp = new Date().toISOString()
    const topic = topicForDevice(topicTemplate.value, device, timestamp)
    if (!topic.trim()) throw new Error('发布主题不能为空。')
    if (payloadFormat.value === 'json') {
      const value = resolveJsonTemplate(jsonTemplate.value, {
        deviceId: device.deviceId,
        clientId: device.clientId,
        timestamp,
      })
      const body = JSON.stringify(value)
      const bytes = new TextEncoder().encode(body)
      return {
        deviceId: device.deviceId,
        topic,
        payload: Array.from(bytes),
        payloadPreview: JSON.stringify(value, null, 2),
        payloadFormat: 'json',
        timestamp,
        options: publishOptionsSnapshot(),
      }
    }

    const payload = protoPayload(device, timestamp)
    return {
      deviceId: device.deviceId,
      topic,
      payload: Array.from(payload.bytes),
      payloadPreview: payload.preview,
      payloadFormat: 'protobuf',
      timestamp,
      options: publishOptionsSnapshot(),
    }
  }

  async function publishTo(targetDevices: DeviceStatus[]) {
    const requests: PublishRequest[] = []
    for (const device of targetDevices) {
      try {
        requests.push(makePublishRequest(device))
      } catch (error) {
        devices.value = devices.value.map((item) => item.deviceId === device.deviceId ? { ...item, failureCount: item.failureCount + 1 } : item)
        addLog('error', `${device.deviceId} 消息生成失败：${errorMessage(error)}`)
      }
    }
    if (!requests.length) return
    if (!isDesktopApp()) {
      addLog('warning', '消息已在本地生成；请在桌面应用中连接 Broker 后发送。')
      return
    }
    try {
      await publishMessages(requests)
      addLog('info', `已提交 ${requests.length} 条消息到发送队列。`)
    } catch (error) {
      devices.value = devices.value.map((device) => requests.some((request) => request.deviceId === device.deviceId)
        ? { ...device, failureCount: device.failureCount + 1 }
        : device)
      addLog('error', `提交消息失败：${errorMessage(error)}`)
    }
  }

  async function publishOnce() {
    if (!onlineDevices.value.length) {
      addLog('warning', '当前没有已连接设备。')
      return
    }
    await publishTo(onlineDevices.value)
  }

  async function publishScheduledRound() {
    if (scheduleBusy) return
    scheduleBusy = true
    try {
      const eligible = onlineDevices.value.filter((device) => {
        const attempted = scheduleAttempts.get(device.deviceId) ?? 0
        return countPerDevice.value === null || attempted < countPerDevice.value
      })
      for (const device of eligible) scheduleAttempts.set(device.deviceId, (scheduleAttempts.get(device.deviceId) ?? 0) + 1)
      await publishTo(eligible)
      const completed = countPerDevice.value !== null
        && devices.value.length > 0
        && devices.value.every((device) => (scheduleAttempts.get(device.deviceId) ?? 0) >= countPerDevice.value!)
      if (completed) stopSchedule()
    } finally {
      scheduleBusy = false
    }
  }

  function startSchedule() {
    if (scheduleRunning.value) return
    if (!onlineDevices.value.length) {
      addLog('warning', '至少需要一台已连接设备才能开始定时发送。')
      return
    }
    const interval = Math.max(100, Math.round(intervalSeconds.value * 1000))
    if (countPerDevice.value !== null && countPerDevice.value < 1) {
      addLog('error', '每台设备的发送次数至少为 1。')
      return
    }
    scheduleAttempts = new Map(devices.value.map((device) => [device.deviceId, 0]))
    scheduleRunning.value = true
    addLog('info', `定时发送已启动，间隔 ${interval} ms。`)
    void publishScheduledRound()
    scheduleTimer = window.setInterval(() => void publishScheduledRound(), interval)
  }

  function stopSchedule() {
    if (scheduleTimer !== undefined) {
      window.clearInterval(scheduleTimer)
      scheduleTimer = undefined
    }
    if (scheduleRunning.value) addLog('info', '定时发送已停止。')
    scheduleRunning.value = false
  }

  async function load() {
    if (isDesktopApp()) {
      try {
        const loaded = await loadWorkspace()
        workspace.value = loaded
        if (!workspace.value.profiles.length) workspace.value.profiles = [createDefaultProfile()]
        if (!workspace.value.schemas.length) workspace.value.schemas = [{ ...defaultSchema }]
        for (const item of workspace.value.profiles) {
          if (!workspace.value.scenarios.some((scenario) => scenario.profileId === item.id)) {
            workspace.value.scenarios.push(createDefaultScenario(item.id, item.mqttVersion))
          }
        }
        profile.value = { ...(workspace.value.profiles[0] ?? createDefaultProfile()) }
        const scenario = workspace.value.scenarios.find((item) => item.profileId === profile.value.id)
        applyScenario(scenario ?? createDefaultScenario(profile.value.id, profile.value.mqttVersion, `draft-${crypto.randomUUID()}`))
        decodeSchemaId.value = workspace.value.schemas[0]?.id ?? ''
        workspaceReady.value = true
      } catch (error) {
        addLog('error', `读取本地配置失败：${errorMessage(error)}`)
        workspaceReady.value = true
      }
    } else {
      workspaceReady.value = true
    }
  }

  onMounted(async () => {
    await load()
    if (!isDesktopApp()) return
    try {
      unlistenEvents = await listenToSimulatorEvents({
        onDeviceStatus: (next) => {
          devices.value = devices.value.some((device) => device.deviceId === next.deviceId)
            ? devices.value.map((device) => device.deviceId === next.deviceId
              ? {
                  ...next,
                  successCount: Math.max(next.successCount, device.successCount),
                  failureCount: Math.max(next.failureCount, device.failureCount),
                }
              : device)
            : [...devices.value, next]
          if (next.status === 'connected') addLog('success', `${next.deviceId} 已连接。`)
          if (next.status === 'error' || next.status === 'disconnected') addLog('warning', `${next.deviceId}：${next.error || '连接中断'}`)
        },
        onPublishResult: (result) => {
          if (result.status === 'confirmed') {
            addLog('success', `${result.deviceId} 已确认发布到 ${result.topic}。`)
          } else if (result.status === 'sent_unconfirmed') {
            addLog('info', `${result.deviceId} 已发送到 ${result.topic}，QoS 0 未确认。`)
          } else {
            addLog('error', `${result.deviceId} 发布到 ${result.topic} 失败：${result.error || 'Broker 拒绝消息。'}`)
          }
        },
        onPublishedMessage: (entry) => appendMessage('published', entry),
        onInboundMessage: (entry) => appendMessage('received', entry),
        onLog: (entry) => {
          logs.value = [...logs.value, entry].slice(-200)
        },
      })
    } catch (error) {
      addLog('error', `初始化事件监听失败：${errorMessage(error)}`)
    }
  })

  onUnmounted(() => {
    stopSchedule()
    unlistenEvents.forEach((unlisten) => unlisten())
  })

  return {
    workspace,
    profile,
    mqttVersion,
    password,
    selectedScenarioId,
    scenarioName,
    profileScenarios,
    simulationPlans,
    deviceBatch,
    topicTemplate,
    payloadFormat,
    jsonTemplate,
    selectedSchemaId,
    messageType,
    protoValues,
    fieldRanges,
    publishOptions,
    publishMode,
    intervalSeconds,
    countPerDevice,
    monitorTopics,
    devices,
    published,
    received,
    logs,
    selectedActivityTab,
    selectedMessageId,
    decodeSchemaId,
    decodeMessageType,
    connecting,
    scheduleRunning,
    monitorRunning,
    workspaceReady,
    profileMenuId,
    running,
    onlineDevices,
    successCount,
    failureCount,
    isDesktopApp,
    saveCurrent,
    savePlan,
    deletePlan,
    selectPlan,
    selectProfile,
    selectScenario,
    createScenario,
    createProfile,
    connect,
    stop,
    retryDevice,
    retryFailedDevices,
    publishOnce,
    startSchedule,
    stopSchedule,
    startMonitor,
    stopMonitor,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
