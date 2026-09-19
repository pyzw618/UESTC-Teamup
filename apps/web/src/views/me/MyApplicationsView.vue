<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { ApplicationStatus, ApplicationStatusLabel } from '@teamup/shared';
import { api } from '../../api/client';
import { fmtDate } from '../../api/types';
import UserAvatar from '../../components/UserAvatar.vue';

const router = useRouter();

const sent = ref<
  { id: string; pitch: string; status: ApplicationStatus; reason: string | null; createdAt: string; team: { id: string; competition: { name: string }; leader: { nickname: string | null } } }[]
>([]);
const received = ref<
  { id: string; pitch: string; status: ApplicationStatus; createdAt: string; team: { id: string; competition: { name: string } }; user: { id: string; nickname: string | null; college: string | null; grade: number | null } }[]
>([]);
const invitations = ref<
  { id: string; status: string; createdAt: string; team: { id: string; competition: { name: string }; leader: { nickname: string | null } } }[]
>([]);
const loading = ref(true);

const statusType = (s: string) =>
  s === 'PENDING' ? 'warning' : s === 'ACCEPTED' ? 'success' : s === 'REJECTED' ? 'danger' : 'info';

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ sent: typeof sent.value; received: typeof received.value }>('/teams/me/applications');
    sent.value = res.sent;
    received.value = res.received;
    invitations.value = await api.get('/teams/me/invitations');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function withdraw(id: string) {
  await api.post(`/teams/applications/${id}/withdraw`);
  ElMessage.success('已撤回');
  load();
}

async function respondInvitation(id: string, accept: boolean) {
  try {
    await api.post(`/teams/invitations/${id}/respond`, { action: accept ? 'accept' : 'reject' });
    ElMessage.success(accept ? '已加入队伍！' : '已拒绝邀请');
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
    load();
  }
}
</script>

<template>
  <div v-loading="loading" class="flex flex-col gap-16px min-h-200px">
    <!-- 收到的邀请 -->
    <section v-if="invitations.length" class="glass p-18px">
      <h2 class="text-15px font-bold m-0 mb-10px">📤 收到的邀请</h2>
      <div class="flex flex-col gap-10px">
        <div v-for="i in invitations" :key="i.id" class="flex items-center gap-10px flex-wrap rounded-12px p-10px" style="background: rgba(255,255,255,0.5)">
          <span class="text-13px">
            <b>{{ i.team.leader?.nickname || '队长' }}</b> 邀请你加入「{{ i.team.competition.name }}」的队伍
          </span>
          <span class="text-12px color-ink-faint">{{ fmtDate(i.createdAt) }}</span>
          <div class="ml-auto flex gap-6px">
            <template v-if="i.status === 'PENDING'">
              <el-button size="small" type="primary" round @click="respondInvitation(i.id, true)">同意加入</el-button>
              <el-button size="small" round @click="respondInvitation(i.id, false)">拒绝</el-button>
            </template>
            <el-tag v-else size="small" round>{{ i.status === 'ACCEPTED' ? '已加入' : '已拒绝' }}</el-tag>
          </div>
        </div>
      </div>
    </section>

    <!-- 收到的申请（队长） -->
    <section v-if="received.length" class="glass p-18px">
      <h2 class="text-15px font-bold m-0 mb-10px">📥 收到的申请（去队伍详情页审批）</h2>
      <div class="flex flex-col gap-8px">
        <div
          v-for="a in received"
          :key="a.id"
          class="flex items-center gap-10px cursor-pointer rounded-12px p-10px"
          style="background: rgba(255,255,255,0.5)"
          @click="router.push(`/teams/${a.team.id}`)"
        >
          <UserAvatar :name="a.user.nickname || 'U'" :size="28" />
          <span class="text-13px font-semibold">{{ a.user.nickname || '同学' }}</span>
          <span class="text-12px color-ink-soft">申请加入「{{ a.team.competition.name }}」</span>
          <el-tag :type="statusType(a.status) as never" size="small" round class="ml-auto">
            {{ ApplicationStatusLabel[a.status] ?? a.status }}
          </el-tag>
        </div>
      </div>
    </section>

    <!-- 我发出的申请 -->
    <section class="glass p-18px">
      <h2 class="text-15px font-bold m-0 mb-10px">📨 我发出的申请</h2>
      <el-empty v-if="!sent.length" description="还没有申请过任何队伍" :image-size="56" />
      <div class="flex flex-col gap-10px">
        <div v-for="a in sent" :key="a.id" class="rounded-14px p-12px" style="background: rgba(255,255,255,0.5)">
          <div class="flex items-center gap-8px flex-wrap mb-4px">
            <span
              class="text-13px font-semibold color-uestc-600 cursor-pointer"
              @click="router.push(`/teams/${a.team.id}`)"
            >{{ a.team.competition.name }} →</span>
            <span class="text-12px color-ink-faint">队长 {{ a.team.leader?.nickname || '—' }} · {{ fmtDate(a.createdAt) }}</span>
            <div class="ml-auto flex items-center gap-6px">
              <el-tag :type="statusType(a.status) as never" size="small" round>
                {{ ApplicationStatusLabel[a.status] ?? a.status }}
              </el-tag>
              <el-button v-if="a.status === 'PENDING'" size="small" text type="danger" @click="withdraw(a.id)">撤回</el-button>
            </div>
          </div>
          <p class="text-12px color-ink-soft m-0 truncate">{{ a.pitch }}</p>
          <p v-if="a.reason" class="text-12px mt-4px m-0" style="color: #c0392b">婉拒理由：{{ a.reason }}</p>
        </div>
      </div>
    </section>
  </div>
</template>
