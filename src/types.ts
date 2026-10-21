export type MqttVersion = '3.1.1' | '5.0'
export type PayloadFormat = 'json' | 'protobuf'
export type DeviceConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error' | 'stopped'

export interface BrokerProfile {
  id: string
  name: string
  host: string
  port: number
  mqttVersion: MqttVersion
  useTls: boolean
  caCertPath?: string | null
  username?: string | null
  sessionExpirySeconds: number
}

export interface BrokerConnection extends Omit<BrokerProfile, 'id' | 'name'> {
  password?: string | null
}

export interface DeviceBatch {
  count: number
  deviceIdPrefix: string
  clientIdPrefix: string
}

export interface ProtoSchemaEntry {
  id: string
  name: string
  source: string
  messageType: string
}

export interface Scenario {
  id: string
  name: string
  profileId: string
  mqttVersion?: MqttVersion | null
  deviceBatch: DeviceBatch
  topicTemplate: string
  payloadFormat: PayloadFormat
  jsonTemplate: string
  schemaId?: string | null
  messageType?: string | null
  protobufValuesJson: string
  qos: 0 | 1 | 2
  retain: boolean
  publishOptions?: PublishOptions | null
  fieldRanges?: Record<string, FieldRange>
  intervalMs: number
  publishCountPerDevice?: number | null
}

/** A user-facing simulation plan pairs one broker connection with one scenario. */
export interface SimulationPlan {
  profile: BrokerProfile
  scenario: Scenario
}

export interface FieldRange {
  enabled: boolean
  min: number
  max: number
}

export interface WorkspaceData {
  version: number
  profiles: BrokerProfile[]
  schemas: ProtoSchemaEntry[]
  scenarios: Scenario[]
}

export interface DeviceStatus {
  deviceId: string
  clientId: string
  status: DeviceConnectionState
  error?: string | null
  successCount: number
  failureCount: number
}

export interface PublishOptions {
  qos: 0 | 1 | 2
  retain: boolean
  messageExpirySeconds?: number | null
  responseTopic?: string | null
  correlationDataBase64?: string | null
  contentType?: string | null
  userProperties: Array<[string, string]>
}

export interface PublishRequest {
  deviceId: string
  topic: string
  payload: number[]
  payloadPreview: string
  payloadFormat: PayloadFormat
  timestamp: string
  options: PublishOptions
}

export interface PublishResult {
  deviceId: string
  topic: string
  status: 'confirmed' | 'sent_unconfirmed' | 'failed'
  error?: string | null
  timestamp: string
  payloadPreview: string
}

export interface MessageEntry {
  id: string
  direction: 'out' | 'in'
  topic: string
  timestamp: string
  qos: number
  retain: boolean
  payloadFormat: string
  payloadPreview: string
  payloadHex: string
  deviceId?: string | null
  properties: Array<[string, string]>
}

export interface SystemLogEntry {
  id: string
  timestamp: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
}

export type ThemePreference = 'dark' | 'light' | 'system'

export interface McpPermissions {
  readState: boolean
  connectionControl: boolean
  simulationControl: boolean
  publishMessages: boolean
}

export interface McpSettings {
  enabled: boolean
  token: string
  permissions: McpPermissions
  endpoint: string
}

export interface McpToolRequest {
  id: string
  name: string
  arguments: Record<string, unknown>
}
