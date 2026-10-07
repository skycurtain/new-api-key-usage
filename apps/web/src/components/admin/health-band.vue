<script setup lang="ts">
/**
 * 健康带（交互-全员总览 §1.1）：引擎轮次 · 全池数据截止 · 未关联订阅
 * 文案偏完整说明，不追求极简电报体。
 */
import { computed } from "vue";
import type { EngineStatus } from "@new-api-key-usage/core";
import type { AdminOverview } from "@/api/admin/overview.ts";
import { formatMinute, hoursSince } from "@/utils/time.ts";

const props = defineProps<{
  engine: EngineStatus | undefined;
  overview: AdminOverview | undefined;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: "go-failed-keys"): void;
}>();

const lastRound = computed(() => props.engine?.last_round ?? null);
const failedCount = computed(() => lastRound.value?.failed ?? 0);
const cutoff = computed(() => props.overview?.data_cutoff ?? null);
const cutoffHours = computed(() => hoursSince(cutoff.value));
const cutoffStale = computed(
  () => cutoffHours.value != null && cutoffHours.value > 2,
);
const unassigned = computed(
  () => props.overview?.unassigned_subscription ?? null,
);
const unassignedBad = computed(
  () => (unassigned.value?.count ?? 0) > 0 || (unassigned.value?.quota ?? 0) > 0,
);
</script>

<template>
  <div class="health-band">
    <a-skeleton v-if="loading" active :paragraph="{ rows: 1 }" :title="false" />
    <template v-else>
      <div class="health-band__item">
        <div class="health-band__title">同步引擎</div>
        <div class="health-band__body">
          <template v-if="lastRound">
            最近一次同步轮次共处理
            <strong>{{ lastRound.keys_total }}</strong>
            枚 key，其中成功
            <strong>{{ lastRound.succeeded }}</strong>
            枚。
            <template v-if="failedCount > 0">
              有
              <a-button
                type="link"
                size="small"
                class="health-band__fail-btn"
                @click="emit('go-failed-keys')"
              >
                {{ failedCount }} 枚拉取失败
              </a-button>
              ，可到 Key 管理筛选「最近轮次失败」查看是哪几枚。
            </template>
            <template v-else>没有拉取失败。</template>
          </template>
          <span v-else class="health-band__muted">
            引擎尚未完成过同步轮次，或引擎进程未启动——此时用量数据可能还不完整。
          </span>
        </div>
      </div>

      <div class="health-band__item">
        <div class="health-band__title">数据截止</div>
        <div class="health-band__body">
          <a-tooltip
            title="取全部 key 的 log_synced_at 中最慢的那一个；某枚 key 同步失败会一直不写该字段，从而拖住全池截止"
          >
            <span>全池同步截止于 <strong>{{ formatMinute(cutoff) }}</strong>（北京时间）。</span>
          </a-tooltip>
          <template v-if="cutoffStale">
            <span v-if="failedCount > 0" class="health-band__warn">
              截止时间落后超过 2 小时——通常是
              <a-button
                type="link"
                size="small"
                class="health-band__fail-btn"
                @click="emit('go-failed-keys')"
              >
                同步失败的 key
              </a-button>
              一直未成功、拖住了全池最慢值；请到 Key 管理处理（必要时停用）。
            </span>
            <span v-else class="health-band__warn">
              截止时间落后超过 2 小时，而最近轮次没有失败 key——同步链路可能停滞，请检查引擎日志。
            </span>
          </template>
          <span v-else-if="cutoff != null" class="health-band__ok">
            目前在正常滞后范围内。
          </span>
        </div>
      </div>

      <div class="health-band__item">
        <div class="health-band__title">未关联订阅</div>
        <div class="health-band__body">
          <a-tooltip
            title="统计的是「来源为订阅、但日志上没有订阅编号」的用量；正常情况下应始终为 0"
          >
            <template v-if="unassignedBad">
              <span class="health-band__danger">
                本时段发现
                {{ unassigned?.count }} 条 / ${{ unassigned?.quota_usd }}
                订阅来源用量未关联到任何订阅编号
              </span>
              （说明支付记录缺登记，或上游计费行为发生了变化），需要人工核对。
            </template>
            <template v-else>
              本时段没有出现「订阅来源却关联不到订阅编号」的用量，属正常状态。
            </template>
          </a-tooltip>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.health-band {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 20px;
  margin-bottom: 24px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fafafa;
  font-size: 13px;
  line-height: 22px;
}

.health-band__item {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 16px;
  align-items: start;
}

.health-band__title {
  color: rgba(0, 0, 0, 0.45);
  padding-top: 1px;
}

.health-band__body {
  color: rgba(0, 0, 0, 0.88);
  min-width: 0;
}

.health-band__body strong {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.health-band__muted {
  color: rgba(0, 0, 0, 0.45);
}

.health-band__ok {
  color: rgba(0, 0, 0, 0.45);
  margin-left: 4px;
}

.health-band__warn {
  color: #d48806;
  margin-left: 4px;
}

.health-band__danger {
  color: #cf1322;
  font-weight: 600;
}

.health-band__fail-btn {
  padding: 0 4px;
  height: auto;
  line-height: inherit;
  color: #cf1322;
  font-weight: 600;
}
</style>
