import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  BrokerConnection,
  DeviceBatch,
  DeviceStatus,
  MessageEntry,
  McpSettings,
  PublishRequest,
  PublishResult,
  SystemLogEntry,
  WorkspaceData,
} from '../types'

export const isDesktopApp = () => '__TAURI_INTERNALS__' in window

export const loadWorkspace = () => invoke<WorkspaceData>('load_workspace')
export const saveWorkspace = (data: WorkspaceData) => invoke<void>('save_workspace', { data })
export const startBatch = (connection: BrokerConnection, batch: DeviceBatch) =>
  invoke<DeviceStatus[]>('start_batch', { connection, batch })
export const retryDevice = (deviceId: string) => invoke<DeviceStatus>('retry_device', { deviceId })
export const stopBatch = () => invoke<void>('stop_batch')
export const publishMessages = (messages: PublishRequest[]) =>
  invoke<void>('publish_messages', { messages })
export const startMonitor = (connection: BrokerConnection, topicFilters: string[]) =>
  invoke<void>('start_monitor', { connection, topicFilters })
export const stopMonitor = () => invoke<void>('stop_monitor')
export const loadMcpSettings = () => invoke<McpSettings>('mcp_load_settings')
export const updateMcpSettings = (settings: McpSettings) => invoke<McpSettings>('mcp_update_settings', { settings })
export const rotateMcpToken = () => invoke<McpSettings>('mcp_rotate_token')
export const completeMcpTool = (id: string, result: unknown, error?: string) =>
  invoke<void>('mcp_complete_tool', { id, result, error: error ?? null })

export function listenToSimulatorEvents(handlers: {
  onDeviceStatus: (event: DeviceStatus) => void
  onPublishResult: (event: PublishResult) => void
  onPublishedMessage: (event: MessageEntry) => void
  onInboundMessage: (event: MessageEntry) => void
  onLog: (event: SystemLogEntry) => void
}): Promise<UnlistenFn[]> {
  return Promise.all([
    listen<DeviceStatus>('device-status', ({ payload }) => handlers.onDeviceStatus(payload)),
    listen<PublishResult>('publish-result', ({ payload }) => handlers.onPublishResult(payload)),
    listen<MessageEntry>('published-message', ({ payload }) => handlers.onPublishedMessage(payload)),
    listen<MessageEntry>('inbound-message', ({ payload }) => handlers.onInboundMessage(payload)),
    listen<SystemLogEntry>('system-log', ({ payload }) => handlers.onLog(payload)),
  ])
}
