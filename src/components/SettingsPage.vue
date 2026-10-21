<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IconCheck, IconCopy, IconDeviceDesktop, IconKey, IconMoon, IconRefresh, IconServer, IconSun } from '@tabler/icons-vue'
import { loadMcpSettings, rotateMcpToken, updateMcpSettings } from '../lib/tauri'
import type { McpPermissions, McpSettings, ThemePreference } from '../types'
import { useThemePreference } from '../composables/useThemePreference'

const props = defineProps<{ desktopReady: boolean }>()
const { themePreference } = useThemePreference()
const settings = ref<McpSettings | null>(null)
const tokenVisible = ref(false)
const loading = ref(true)
const saving = ref(false)
const feedback = ref('')
const loadError = ref('')

const codexSnippet = computed(() => {
  const endpoint = settings.value?.endpoint ?? 'http://127.0.0.1:39541/mcp'
  return `[mcp_servers.telemetry-studio]\nurl = "${endpoint}"\nbearer_token_env_var = "TELEMETRY_STUDIO_MCP_TOKEN"`
})
const tokenCommand = computed(() => `$env:TELEMETRY_STUDIO_MCP_TOKEN = "${settings.value?.token ?? ''}"`)
const tokenCommandPreview = computed(() => `$env:TELEMETRY_STUDIO_MCP_TOKEN = "${tokenVisible ? settings.value?.token ?? '' : '••••••••'}"`)

const themeChoices: Array<{ value: ThemePreference; label: string; description: string }> = [
  { value: 'dark', label: '深色', description: '适合长时间查看设备状态与日志' },
  { value: 'light', label: '浅色', description: '在明亮环境中保持清晰对比' },
  { value: 'system', label: '跟随系统', description: '自动匹配 Windows 外观设置' },
]

const permissionItems: Array<{ key: keyof McpPermissions; title: string; description: string }> = [
  { key: 'readState', title: '读取状态', description: '查看设备连接、计数器、当前场景与发送状态。' },
  { key: 'connectionControl', title: '连接控制', description: '按当前工作台配置连接、断开或重试设备。' },
  { key: 'simulationControl', title: '仿真控制', description: '启动或停止当前场景的定时发送。' },
  { key: 'publishMessages', title: '发布消息', description: '立即按当前载荷和发布选项向所有在线设备发送。' },
]

onMounted(async () => {
  if (!props.desktopReady) {
    loading.value = false
    return
  }
  try {
    settings.value = await loadMcpSettings()
  } catch (error) {
    loadError.value = errorText(error)
  } finally {
    loading.value = false
  }
})

async function save(next: McpSettings) {
  saving.value = true
  feedback.value = ''
  loadError.value = ''
  try {
    settings.value = await updateMcpSettings(next)
    feedback.value = next.enabled ? 'MCP 服务已启用。' : '设置已保存。'
  } catch (error) {
    loadError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

function setEnabled(event: Event) {
  if (!settings.value) return
  const enabled = (event.target as HTMLInputElement).checked
  void save({ ...settings.value, enabled })
}

function setPermission(key: keyof McpPermissions, event: Event) {
  if (!settings.value) return
  const enabled = (event.target as HTMLInputElement).checked
  void save({
    ...settings.value,
    permissions: { ...settings.value.permissions, [key]: enabled },
  })
}

async function regenerateToken() {
  if (!settings.value || !window.confirm('生成新令牌后，现有 MCP 客户端凭据将立即失效。继续吗？')) return
  saving.value = true
  feedback.value = ''
  try {
    settings.value = await rotateMcpToken()
    tokenVisible.value = true
    feedback.value = '已生成新令牌。请同步更新 Codex 环境变量。'
  } catch (error) {
    loadError.value = errorText(error)
  } finally {
    saving.value = false
  }
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value)
    feedback.value = `${label}已复制。`
  } catch {
    feedback.value = '复制失败，请手动选择并复制内容。'
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
</script>

<template>
  <main class="settings-main">
    <div class="settings-intro">
      <span class="settings-kicker">PREFERENCES</span>
      <h1>设置</h1>
      <p>调整工作台外观，并按需开放本机 MCP 能力给 Codex 等 AI 客户端。</p>
    </div>

    <section class="settings-section panel-card">
      <div class="settings-section-heading">
        <div class="settings-icon"><IconSun :size="18" aria-hidden="true" /></div>
        <div><h2>外观</h2><p>选择工作台显示主题</p></div>
      </div>
      <div class="theme-options" role="radiogroup" aria-label="应用主题">
        <label v-for="choice in themeChoices" :key="choice.value" class="theme-option" :class="{ selected: themePreference === choice.value }">
          <input v-model="themePreference" type="radio" name="theme" :value="choice.value" />
          <span class="theme-option-icon">
            <IconMoon v-if="choice.value === 'dark'" :size="17" aria-hidden="true" />
            <IconSun v-else-if="choice.value === 'light'" :size="17" aria-hidden="true" />
            <IconDeviceDesktop v-else :size="17" aria-hidden="true" />
          </span>
          <span class="theme-option-copy"><strong>{{ choice.label }}</strong><small>{{ choice.description }}</small></span>
          <IconCheck v-if="themePreference === choice.value" class="theme-check" :size="16" aria-hidden="true" />
        </label>
      </div>
    </section>

    <section class="settings-section mcp-settings-card panel-card">
      <div class="settings-section-heading mcp-heading">
        <div class="settings-icon"><IconServer :size="18" aria-hidden="true" /></div>
        <div class="mcp-heading-copy"><h2>AI 工具连接（MCP）</h2><p>运行期间在本机提供受令牌保护的 HTTP MCP 服务。</p></div>
        <span class="service-state" :class="settings?.enabled ? 'is-running' : ''"><i />{{ settings?.enabled ? '运行中' : '已关闭' }}</span>
      </div>

      <div v-if="!desktopReady" class="settings-notice">
        MCP 服务需要在 Tauri 桌面应用中运行。浏览器预览仍可调整主题。
      </div>
      <div v-else-if="loading" class="settings-notice">正在读取 MCP 设置…</div>
      <div v-else-if="loadError && !settings" class="settings-error" role="alert">{{ loadError }}</div>
      <template v-else-if="settings">
        <div class="mcp-enable-row">
          <div><strong>启用 MCP 服务</strong><span>只绑定 127.0.0.1，服务关闭后连接立即失效。</span></div>
          <label class="switch-control"><input type="checkbox" :checked="settings.enabled" :disabled="saving" @change="setEnabled" /><span class="switch-track" /><span class="sr-only">启用 MCP 服务</span></label>
        </div>

        <div class="mcp-endpoint-row">
          <div><span class="field-caption">本机端点</span><code>{{ settings.endpoint }}</code></div>
          <span class="loopback-tag">仅本机</span>
        </div>

        <div class="token-block">
          <div class="token-title-row"><div><span class="field-caption">Bearer 令牌</span><small>只分享给你信任的本机 AI 客户端。</small></div><IconKey :size="16" aria-hidden="true" /></div>
          <div class="token-input-row">
            <input :value="settings.token" :type="tokenVisible ? 'text' : 'password'" readonly aria-label="MCP Bearer 令牌" />
            <button class="secondary-button" type="button" @click="tokenVisible = !tokenVisible">{{ tokenVisible ? '隐藏' : '显示' }}</button>
            <button class="secondary-button icon-button" type="button" title="复制令牌" aria-label="复制令牌" @click="copyText(settings.token, '令牌')"><IconCopy :size="15" aria-hidden="true" /></button>
            <button class="secondary-button icon-button" type="button" title="重新生成令牌" aria-label="重新生成令牌" :disabled="saving" @click="regenerateToken"><IconRefresh :size="15" aria-hidden="true" /></button>
          </div>
        </div>

        <div class="permission-block">
          <div class="permission-heading"><div><h3>工具权限</h3><p>按类别控制 AI 客户端可调用的工具</p></div><span>读取默认开启，写入默认关闭</span></div>
          <label v-for="item in permissionItems" :key="item.key" class="permission-row">
            <span class="permission-copy"><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span>
            <input type="checkbox" :checked="settings.permissions[item.key]" :disabled="saving" @change="setPermission(item.key, $event)" />
          </label>
        </div>

        <div class="codex-config-block">
          <div class="config-heading"><div><h3>Codex 配置示例</h3><p>添加到 <code>~/.codex/config.toml</code>，并在启动 Codex 的终端设置令牌环境变量。</p></div><button class="secondary-button" type="button" @click="copyText(codexSnippet, 'Codex 配置')"><IconCopy :size="14" aria-hidden="true" />复制配置</button></div>
          <pre><code>{{ codexSnippet }}</code></pre>
          <div class="env-command-row"><code>{{ tokenCommandPreview }}</code><button class="secondary-button" type="button" @click="copyText(tokenCommand, 'PowerShell 命令')">复制令牌命令</button></div>
        </div>
      </template>

      <p v-if="feedback" class="settings-feedback" role="status" aria-live="polite">{{ feedback }}</p>
      <p v-if="loadError && settings" class="settings-error" role="alert">{{ loadError }}</p>
    </section>
  </main>
</template>

<style scoped>
.settings-main { flex: 1; min-height: 0; overflow: auto; padding: 40px clamp(18px, 5vw, 76px); }
.settings-intro, .settings-section { width: min(100%, 860px); margin-right: auto; margin-left: auto; }
.settings-intro { margin-bottom: 22px; }
.settings-kicker { color: var(--accent); font: 650 10px var(--font-mono); letter-spacing: .12em; }
.settings-intro h1 { margin: 8px 0 6px; color: var(--ink); font-size: 27px; letter-spacing: -.025em; }
.settings-intro p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.6; }
.settings-section { margin-bottom: 14px; padding: 18px; }
.settings-section-heading { display: flex; align-items: center; gap: 11px; margin-bottom: 16px; }
.settings-icon { width: 34px; height: 34px; display: grid; flex: 0 0 34px; place-items: center; border: 1px solid var(--line); border-radius: 8px; color: var(--accent); background: var(--accent-soft); }
.settings-section-heading h2 { margin: 0; color: var(--ink); font-size: 14px; }
.settings-section-heading p { margin: 4px 0 0; color: var(--muted); font-size: 11px; }
.theme-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; }
.theme-option { min-width: 0; min-height: 75px; position: relative; display: flex; align-items: flex-start; gap: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: var(--surface-muted); cursor: pointer; }
.theme-option.selected { border-color: var(--accent); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent); }
.theme-option input { position: absolute; opacity: 0; pointer-events: none; }
.theme-option-icon { width: 28px; height: 28px; display: grid; flex: 0 0 28px; place-items: center; border-radius: 6px; color: var(--accent); background: var(--accent-soft); }
.theme-option-copy { min-width: 0; display: grid; gap: 4px; }
.theme-option-copy strong { color: var(--ink-soft); font-size: 11px; }
.theme-option-copy small { color: var(--muted); font-size: 9px; line-height: 1.45; }
.theme-check { margin-left: auto; color: var(--accent); }
.mcp-heading { margin-bottom: 15px; }
.mcp-heading-copy { flex: 1; }
.service-state { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--line); border-radius: 999px; padding: 5px 8px; color: var(--muted); background: var(--surface-muted); font-size: 10px; white-space: nowrap; }
.service-state i { width: 6px; height: 6px; border-radius: 50%; background: var(--subtle); }
.service-state.is-running { border-color: color-mix(in srgb, var(--green) 36%, transparent); color: var(--green); background: var(--green-soft); }
.service-state.is-running i { background: var(--green); }
.settings-notice { border: 1px solid var(--line); border-radius: 7px; padding: 12px; color: var(--muted); background: var(--surface-muted); font-size: 11px; line-height: 1.5; }
.settings-error { margin: 10px 0 0; color: var(--danger); font-size: 11px; }
.mcp-enable-row, .mcp-endpoint-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: var(--surface-muted); }
.mcp-enable-row > div, .mcp-endpoint-row > div { min-width: 0; display: grid; gap: 4px; }
.mcp-enable-row strong { color: var(--ink-soft); font-size: 11px; }
.mcp-enable-row span:not(.switch-track) { color: var(--muted); font-size: 10px; }
.switch-control { position: relative; display: inline-flex; flex: 0 0 auto; cursor: pointer; }
.switch-control input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.switch-track { width: 38px; height: 22px; position: relative; display: block; border: 1px solid var(--line-strong); border-radius: 99px; background: var(--surface-input); transition: .16s ease; }
.switch-track::after { content: ''; width: 16px; height: 16px; position: absolute; top: 2px; left: 2px; border-radius: 50%; background: var(--muted); transition: .16s ease; }
.switch-control input:checked + .switch-track { border-color: var(--accent); background: var(--accent); }
.switch-control input:checked + .switch-track::after { left: 18px; background: var(--canvas); }
.switch-control input:focus-visible + .switch-track { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.switch-control input:disabled + .switch-track { opacity: .55; }
.mcp-endpoint-row { margin-top: 8px; }
.field-caption { color: var(--muted); font-size: 9px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
.mcp-endpoint-row code { overflow: hidden; color: var(--ink-soft); text-overflow: ellipsis; white-space: nowrap; font: 11px var(--font-mono); }
.loopback-tag { flex: 0 0 auto; border: 1px solid color-mix(in srgb, var(--green) 35%, transparent); border-radius: 5px; padding: 4px 7px; color: var(--green); background: var(--green-soft); font-size: 9px; }
.token-block { margin-top: 13px; }
.token-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; color: var(--accent); }
.token-title-row > div { display: grid; gap: 3px; }
.token-title-row small { color: var(--muted); font-size: 9px; }
.token-input-row { display: flex; gap: 6px; }
.token-input-row > input { min-width: 0; height: 34px; flex: 1; border: 1px solid var(--line-strong); border-radius: 6px; padding: 0 9px; color: var(--ink-soft); background: var(--surface-input); font: 10px var(--font-mono); }
.secondary-button { min-height: 30px; display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 5px; border: 1px solid var(--line-strong); border-radius: 6px; padding: 0 9px; color: var(--ink-soft); background: var(--surface-raised); font-size: 9px; font-weight: 600; cursor: pointer; }
.secondary-button:hover { border-color: var(--accent); color: var(--accent); }
.secondary-button:disabled { opacity: .5; cursor: not-allowed; }
.icon-button { width: 32px; padding: 0; }
.permission-block { margin-top: 18px; }
.permission-heading, .config-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.permission-heading h3, .config-heading h3 { margin: 0; color: var(--ink-soft); font-size: 11px; }
.permission-heading p, .config-heading p { margin: 4px 0 0; color: var(--muted); font-size: 9px; line-height: 1.5; }
.permission-heading > span { color: var(--subtle); font-size: 9px; }
.permission-row { min-height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid var(--line); padding: 8px 3px; cursor: pointer; }
.permission-copy { min-width: 0; display: grid; gap: 4px; }
.permission-copy strong { color: var(--ink-soft); font-size: 10px; }
.permission-copy small { color: var(--muted); font-size: 9px; line-height: 1.4; }
.permission-row > input { width: 15px; height: 15px; flex: 0 0 auto; accent-color: var(--accent); }
.codex-config-block { margin-top: 15px; border-top: 1px solid var(--line); padding-top: 14px; }
.config-heading { align-items: center; }
.config-heading > div { min-width: 0; }
.config-heading p code { color: var(--accent); font: 9px var(--font-mono); }
.codex-config-block pre { overflow-x: auto; margin: 0; border: 1px solid var(--line); border-radius: 7px; padding: 11px; color: var(--ink-soft); background: var(--code-surface); font: 10px/1.6 var(--font-mono); }
.env-command-row { display: flex; align-items: center; justify-content: space-between; gap: 9px; margin-top: 7px; border: 1px solid var(--line); border-radius: 7px; padding: 7px 8px; background: var(--surface-muted); }
.env-command-row code { min-width: 0; overflow-x: auto; color: var(--muted); white-space: nowrap; font: 9px var(--font-mono); }
.settings-feedback { margin: 12px 0 0; color: var(--green); font-size: 10px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 640px) {
  .settings-main { padding: 22px 12px; }
  .settings-section { padding: 13px; }
  .theme-options { grid-template-columns: minmax(0, 1fr); }
  .theme-option { min-height: 62px; }
  .mcp-heading { flex-wrap: wrap; }
  .mcp-heading-copy { flex: 1 1 calc(100% - 48px); }
  .service-state { margin-left: 45px; }
  .permission-heading { align-items: flex-start; flex-direction: column; gap: 5px; }
  .config-heading { align-items: flex-start; }
  .env-command-row { align-items: flex-start; flex-direction: column; }
}
</style>
