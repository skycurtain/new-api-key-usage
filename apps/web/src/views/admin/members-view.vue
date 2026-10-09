<script setup lang="ts">
/**
 * 成员管理（交互设计-成员管理）：清单表 · 开户 · 令牌明文/重发 · 启停
 */
import { computed, h, reactive, ref, watch } from "vue";
import { Tooltip, message } from "antdv-next";
import { QuestionCircleOutlined } from "@antdv-next/icons";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
import type { MemberItem } from "@new-api-key-usage/core";
import type { ApiError } from "@/api/http.ts";
import PageHeader from "@/components/common/page-header.vue";
import MemberTokenModal from "@/components/admin/member-token-modal.vue";
import {
  useCreateMember,
  useIssueMemberToken,
  useMembers,
  usePatchMember,
} from "@/queries/admin.ts";
import { formatMinute } from "@/utils/time.ts";

const membersQuery = useMembers();
const createMember = useCreateMember();
const patchMember = usePatchMember();
const issueToken = useIssueMemberToken();

const createOpen = ref(false);
const tokenOpen = ref(false);
const plainToken = ref("");
const tokenMemberName = ref("");

const createForm = reactive({ name: "", remark: "" });
const createError = ref("");

const filterName = ref("");
const filterStatus = ref<"active" | "disabled" | null>(null);

function syncFiltersFromRoute() {
  const q = route.query;
  filterName.value = typeof q.name === "string" ? q.name : "";
  filterStatus.value =
    q.status === "active" || q.status === "disabled" ? q.status : null;
}

function pushFilterQuery() {
  const query: Record<string, string> = {};
  const mid = route.query.member_id;
  if (typeof mid === "string" && mid) query.member_id = mid;
  if (filterName.value.trim()) query.name = filterName.value.trim();
  if (filterStatus.value) query.status = filterStatus.value;
  void router.replace({ path: "/admin/members", query });
}

syncFiltersFromRoute();
watch(() => route.query, () => syncFiltersFromRoute());
watch([filterName, filterStatus], () => pushFilterQuery());

function tipTitle(label: string, tip: string) {
  return h("span", { class: "overview-col-title" }, [
    label,
    h(
      Tooltip,
      { title: tip },
      () =>
        h(QuestionCircleOutlined, {
          class: "overview-col-title__icon",
          "aria-hidden": "true",
        }),
    ),
  ]);
}

const columns = [
  { title: "名称", key: "name", dataIndex: "name", width: 140 },
  { title: "备注", key: "remark" },
  { title: "状态", key: "status", width: 100 },
  {
    title: tipTitle("令牌签发", "明文已不可找回，如需新令牌请重发"),
    key: "token_issued_at",
    width: 170,
  },
  { title: "名下 Key 数", key: "key_count", width: 110 },
  { title: "操作", key: "actions", width: 200 },
];

const rows = computed(() => {
  let list = membersQuery.data.value ?? [];
  const mid = route.query.member_id;
  if (typeof mid === "string" && mid) {
    const n = Number(mid);
    list = list.filter((m) => m.id === n);
  }
  const name = filterName.value.trim();
  if (name) {
    const lower = name.toLowerCase();
    list = list.filter(
      (m) =>
        m.name.toLowerCase().includes(lower) ||
        (m.remark ?? "").toLowerCase().includes(lower),
    );
  }
  if (filterStatus.value) {
    list = list.filter((m) => m.status === filterStatus.value);
  }
  return list;
});

const hasFilter = computed(
  () =>
    !!filterName.value.trim() ||
    filterStatus.value != null ||
    (typeof route.query.member_id === "string" && !!route.query.member_id),
);

async function onCreate() {
  createError.value = "";
  const name = createForm.name.trim();
  if (!name) {
    createError.value = "请填写成员名称";
    return;
  }
  try {
    const res = await createMember.mutateAsync({
      name,
      remark: createForm.remark.trim(),
    });
    createOpen.value = false;
    createForm.name = "";
    createForm.remark = "";
    plainToken.value = res.token;
    tokenMemberName.value = res.member.name;
    tokenOpen.value = true;
  } catch (e) {
    const err = e as ApiError;
    createError.value = err.message || "开户失败";
  }
}

async function onReissue(record: MemberItem) {
  try {
    const res = await issueToken.mutateAsync(record.id);
    plainToken.value = res.token;
    tokenMemberName.value = record.name;
    tokenOpen.value = true;
  } catch (e) {
    message.error((e as ApiError).message || "重发失败");
  }
}

async function onToggle(record: MemberItem) {
  const next = record.status === "active" ? "disabled" : "active";
  try {
    await patchMember.mutateAsync({
      id: record.id,
      body: { status: next },
    });
    message.success(
      next === "disabled"
        ? "已停用——该成员视图立即不可访问，数据保留"
        : "已启用——下一请求即恢复",
    );
  } catch (e) {
    message.error((e as ApiError).message || "状态更新失败");
  }
}
</script>

<template>
  <section>
    <PageHeader title="成员管理" subtitle="开户、访问令牌与启停">
      <template #actions>
        <a-button type="primary" @click="createOpen = true">新建成员</a-button>
      </template>
    </PageHeader>

    <div class="members-filters">
      <a-input
        v-model:value="filterName"
        allow-clear
        placeholder="名称 / 备注"
        style="width: 180px"
      />
      <a-select
        v-model:value="filterStatus"
        :options="[
          { value: null, label: '全部状态' },
          { value: 'active', label: '启用中' },
          { value: 'disabled', label: '已停用' },
        ]"
        style="width: 120px"
        allow-clear
        placeholder="状态"
      />
    </div>

    <a-empty
      v-if="!membersQuery.isPending.value && rows.length === 0"
      :description="hasFilter ? '没有符合筛选的成员' : '还没有成员——为每位分摊朋友开户并发放访问令牌'"
    >
      <a-button v-if="!hasFilter" @click="createOpen = true">新建成员</a-button>
    </a-empty>

    <a-table
      v-else
      :columns="columns"
      :data-source="rows"
      :row-key="(r: MemberItem) => r.id"
      :loading="membersQuery.isPending.value || membersQuery.isFetching.value"
      :pagination="false"
      size="middle"
      :scroll="{ x: 900 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'remark'">
          {{ record.remark || "—" }}
        </template>
        <template v-else-if="column.key === 'status'">
          <a-badge
            :status="record.status === 'active' ? 'success' : 'default'"
            :text="record.status === 'active' ? '启用中' : '已停用'"
          />
        </template>
        <template v-else-if="column.key === 'token_issued_at'">
          {{ formatMinute(record.token_issued_at) }}
        </template>
        <template v-else-if="column.key === 'key_count'">
          {{ record.key_count }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-button
              size="small"
              @click="() => router.push({ path: '/admin/logs', query: { member_id: String(record.id) } })"
            >
              查调用
            </a-button>
            <a-popconfirm
              title="重发后旧令牌立即失效"
              description="该成员正在用的访问将中断"
              ok-text="重发"
              cancel-text="取消"
              @confirm="() => onReissue(record)"
            >
              <a-button size="small">重发令牌</a-button>
            </a-popconfirm>
            <a-popconfirm
              v-if="record.status === 'active'"
              title="停用后该成员的视图立即不可访问"
              description="令牌验证含状态检查；数据保留"
              ok-text="停用"
              cancel-text="取消"
              @confirm="() => onToggle(record)"
            >
              <a-button size="small" danger>停用</a-button>
            </a-popconfirm>
            <a-button v-else size="small" @click="() => onToggle(record)">
              启用
            </a-button>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="createOpen"
      title="新建成员"
      :confirm-loading="createMember.isPending.value"
      ok-text="开户并签发令牌"
      cancel-text="取消"
      @ok="onCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="名称" required>
          <a-input v-model:value="createForm.name" placeholder="成员名称" />
        </a-form-item>
        <a-form-item label="备注">
          <a-input v-model:value="createForm.remark" placeholder="备注（可选）" />
        </a-form-item>
        <a-alert v-if="createError" type="error" show-icon :message="createError" />
      </a-form>
    </a-modal>

    <MemberTokenModal
      v-model:open="tokenOpen"
      :token="plainToken"
      :member-name="tokenMemberName"
      @update:open="(v: boolean) => { if (!v) { plainToken = ''; tokenMemberName = ''; } }"
    />
  </section>
</template>

<style scoped>
.members-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.overview-col-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.overview-col-title__icon {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  cursor: help;
}
</style>
