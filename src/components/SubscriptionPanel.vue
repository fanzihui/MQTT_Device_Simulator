<script setup lang="ts">
import { computed, ref } from 'vue'
import { IconBroadcast, IconPlayerPlay, IconPlayerStop, IconPlus, IconX } from '@tabler/icons-vue'

const topicsValue = defineModel<string>('topics', { required: true })
const props = defineProps<{
  monitorRunning: boolean
  monitorEnabled: boolean
}>()

const emit = defineEmits<{
  start: []
  stop: []
}>()

const topicDraft = ref('')
const topics = computed(() => topicsValue.value.split(/[\n,;]/).map((topic) => topic.trim()).filter(Boolean))
const draftHasValue = computed(() => topicDraft.value.trim().length > 0)

function addTopics() {
  if (props.monitorRunning) return
  const additions = topicDraft.value.split(/[\n,;]/).map((topic) => topic.trim()).filter(Boolean)
  if (!additions.length) return
  const next = [...topics.value]
  for (const topic of additions) {
    if (!next.includes(topic)) next.push(topic)
  }
  topicsValue.value = next.join('\n')
  topicDraft.value = ''
}

function removeTopic(topicToRemove: string) {
  if (props.monitorRunning) return
  topicsValue.value = topics.value.filter((topic) => topic !== topicToRemove).join('\n')
}

function handleTopicKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    addTopics()
  }
}
</script>

<template>
  <section class="panel-card subscription-card" aria-labelledby="subscription-title">
    <div class="subscription-heading">
      <span class="subscription-icon"><IconBroadcast aria-hidden="true" :size="18" :stroke-width="1.8" /></span>
      <h2 id="subscription-title">消息订阅</h2>
      <span class="subscription-status" :class="{ live: monitorRunning }" role="status"><i />{{ monitorRunning ? '监听中' : '未启动' }}</span>
    </div>

    <label class="sr-only" for="subscription-topic-draft">订阅主题过滤器</label>
    <textarea
      id="subscription-topic-draft"
      v-model="topicDraft"
      class="subscription-input mono"
      rows="1"
      :disabled="monitorRunning"
      placeholder="例如：sensors/+/telemetry"
      @keydown="handleTopicKeydown"
    />
    <button class="subscription-add-button" type="button" :disabled="monitorRunning || !draftHasValue" @click="addTopics">
      <IconPlus aria-hidden="true" :size="16" />添加订阅
    </button>

    <div class="subscription-list" aria-label="待监听的主题">
      <div v-for="topic in topics" :key="topic" class="subscription-topic">
        <i />
        <span class="mono" :title="topic">{{ topic }}</span>
        <button type="button" :disabled="monitorRunning" :aria-label="`移除订阅 ${topic}`" :title="monitorRunning ? '停止监听后可编辑主题' : '移除主题'" @click="removeTopic(topic)">
          <IconX aria-hidden="true" :size="14" />
        </button>
      </div>
      <p v-if="!topics.length" class="subscription-empty">添加主题过滤器后即可启动监听。</p>
    </div>

    <button v-if="!monitorRunning" class="subscription-listen-button" :disabled="!monitorEnabled || !topics.length" type="button" @click="emit('start')">
      <IconPlayerPlay aria-hidden="true" :size="16" />开始监听
    </button>
    <button v-else class="subscription-listen-button stop" type="button" @click="emit('stop')">
      <IconPlayerStop aria-hidden="true" :size="16" />停止监听
    </button>
    <p class="subscription-caption">使用独立监视客户端，不占用模拟设备连接</p>
  </section>
</template>

<style scoped>
.subscription-card { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 14px 12px 11px; }
.subscription-heading { min-width: 0; display: flex; align-items: center; gap: 9px; margin-bottom: 12px; }
.subscription-icon { width: 30px; height: 30px; display: grid; flex: 0 0 30px; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); border-radius: 7px; color: var(--accent); background: var(--accent-soft); }
.subscription-heading h2 { min-width: 0; margin: 0; color: var(--ink); font-size: 13px; font-weight: 700; }
.subscription-status { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; border-radius: 999px; padding: 4px 7px; color: var(--muted); background: var(--surface-raised); font-size: 9px; white-space: nowrap; }
.subscription-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--subtle); }
.subscription-status.live { color: var(--green); background: var(--green-soft); }
.subscription-status.live i { background: var(--green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 14%, transparent); }
.subscription-input { width: 100%; min-height: 38px; max-height: 84px; resize: vertical; border: 1px solid var(--line-strong); border-radius: 6px; outline: none; padding: 9px 10px; color: var(--ink); background: var(--surface-input); font-size: 10px; line-height: 1.5; }
.subscription-input:focus { border-color: var(--focus-ring); box-shadow: 0 0 0 2px color-mix(in srgb, var(--focus-ring) 22%, transparent); }
.subscription-input:disabled { opacity: .65; }
.subscription-add-button, .subscription-listen-button { width: 100%; min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border: 1px solid var(--line-strong); border-radius: 6px; color: var(--accent); background: var(--accent-soft); font-size: 10px; font-weight: 700; cursor: pointer; }
.subscription-add-button { margin-top: 8px; }
.subscription-add-button:disabled, .subscription-listen-button:disabled { color: var(--subtle); border-color: var(--line); background: var(--surface-muted); cursor: not-allowed; }
.subscription-list { min-height: 42px; display: grid; align-content: start; gap: 6px; overflow: auto; margin: 12px 0 10px; }
.subscription-topic { min-width: 0; min-height: 34px; display: flex; align-items: center; gap: 8px; border-radius: 6px; padding: 0 8px; color: var(--ink-soft); background: var(--surface-muted); }
.subscription-topic > i { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: var(--accent); }
.subscription-topic > span { min-width: 0; overflow: hidden; flex: 1; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.subscription-topic > button { width: 23px; height: 23px; display: grid; flex: 0 0 23px; place-items: center; border: 0; border-radius: 5px; color: var(--muted); background: transparent; cursor: pointer; }
.subscription-topic > button:hover:not(:disabled) { color: var(--danger); background: var(--danger-soft); }
.subscription-topic > button:disabled { opacity: .42; cursor: not-allowed; }
.subscription-empty { margin: 0; padding: 8px 2px; color: var(--subtle); font-size: 10px; line-height: 1.5; }
.subscription-listen-button { margin-top: auto; border-color: var(--accent-strong); color: #fff; background: var(--accent-strong); }
.subscription-listen-button:hover:not(:disabled) { filter: brightness(1.06); }
.subscription-listen-button.stop { border-color: var(--danger); background: #a7443e; }
.subscription-caption { margin: 7px 0 0; color: var(--subtle); text-align: center; font-size: 9px; line-height: 1.4; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
