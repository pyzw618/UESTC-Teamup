<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import { fmtDate, type NotificationItem } from '../api/types';

const router = useRouter();

const items = ref<NotificationItem[]>([]);
const unread = ref(0);
const total = ref(0);
const page = ref(1);
const loading = ref(true);
const filter = ref<'ALL' | 'UNREAD'>('ALL');

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ items: NotificationItem[]; unread: number; total: number }>(
      `/notifications?page=${page.value}&pageSize=20`,
    );
    items.value = filter.value === 'ALL' ? res.items : res.items.filter((i) => !i.readAt);
    unread.value = res.unread;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function read(n: NotificationItem) {
  if (n.readAt) return;
  await api.post(`/notifications/${n.id}/read`);
  n.readAt = new Date().toISOString();
  unread.value = Math.max(0, unread.value - 1);
}

async function readAll() {
  await api.post('/notifications/read-all');
  load();
}

const payloadText = (n: NotificationItem): { title: string; desc: string; link?: string } => {
  const p = n.payload as Record<string, string | number>;
  switch (n.kind) {
    case 'DDL_REMINDER':
      return {
        title: `⏰ 「${p.competitionName}」${p.stage}`,
        desc: `距截止还有 ${p.daysLeft} 天（${fmtDate(p.endAt as string, true)}），抓紧报名`,
        link: '/calendar',
      };
    case 'APPLICATION_NEW':
      return { title: '📥 收到新的入队申请', desc: '点击前往队伍处理', link: '/me/applications' };
    case 'APPLICATION_RESULT':
      return {
        title: p.kind === 'invitation' ? '📤 邀请有了结果' : p.accepted ? '🎉 你的申请已通过' : '申请被婉拒',
        desc: p.accepted ? '查看队伍信息，联系方式已解锁' : p.reason ? `理由：${p.reason}` : '继续寻找合适的队伍吧',
        link: p.teamId ? `/teams/${p.teamId}` : '/me/applications',
      };
    case 'INVITATION_NEW':
      return { title: '✉️ 你收到一条入队邀请', desc: '点击前往处理', link: '/me/applications' };
    case 'CORRECTION_NEW':
      return { title: '🔧 纠错处理通知', desc: String(p.message ?? (p.accepted ? '你的纠错已被采纳' : '有新的用户纠错待处理')), link: p.accepted ? undefined : '/admin/corrections' };
    case 'COMMENT_REPLY':
      return { title: '💬 你的留言有了回复', desc: '点击查看', link: `/competitions/${p.targetId}` };
    default:
      return { title: n.kindLabel, desc: '' };
  }
};

const shown = computed(() => items.value);
</script>

<template>
  <div class="page-wrap max-w-760px mx-auto">
    <div class="flex items-center justify-between mb-16px">
      <div>
        <h1 class="text-28px font-extrabold m-0">消息中心</h1>
        <p class="text-13px color-ink-soft m-0 mt-4px">{{ unread > 0 ? `${unread} 条未读` : '全部已读' }}</p>
      </div>
      <div class="flex gap-8px items-center">
        <el-radio-group v-model="filter" size="small" @change="load">
          <el-radio-button value="ALL">全部</el-radio-button>
          <el-radio-button value="UNREAD">未读</el-radio-button>
        </el-radio-group>
        <el-button size="small" round @click="readAll">全部已读</el-button>
      </div>
    </div>

    <div v-loading="loading" class="flex flex-col gap-10px min-h-200px">
      <div
        v-for="n in shown"
        :key="n.id"
        class="glass px-18px py-14px flex items-start gap-12px cursor-pointer"
        :style="n.readAt ? '' : 'border-left: 3px solid var(--ginkgo-gold)'"
        @click="read(n); payloadText(n).link && router.push(payloadText(n).link!)"
      >
        <div class="flex-1">
          <div class="text-14px font-semibold" :style="{ color: n.readAt ? 'var(--ink-soft)' : 'var(--ink)' }">
            {{ payloadText(n).title }}
          </div>
          <div class="text-13px color-ink-soft mt-2px">{{ payloadText(n).desc }}</div>
        </div>
        <div class="text-12px color-ink-faint text-right shrink-0">
          <div>{{ fmtDate(n.createdAt, true) }}</div>
          <div class="mt-2px">{{ n.kindLabel }}</div>
        </div>
      </div>
      <el-empty v-if="!loading && !shown.length" description="暂无消息" />
    </div>

    <div class="flex justify-center mt-16px">
      <el-pagination v-model:current-page="page" :total="total" :page-size="20" layout="prev, pager, next" @current-change="load" />
    </div>
  </div>
</template>
