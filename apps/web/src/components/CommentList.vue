<script setup lang="ts">
import { ref } from 'vue';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ElMessage } from 'element-plus';
import { api } from '../api/client';
import type { CommentItem } from '../api/types';
import UserAvatar from './UserAvatar.vue';
import { useAuthStore } from '../stores/auth';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const props = defineProps<{
  comments: CommentItem[];
  targetType: 'COMPETITION' | 'POST' | 'TEAM';
  targetId: string;
}>();
const emit = defineEmits<{ posted: [] }>();

const auth = useAuthStore();
const content = ref('');
const submitting = ref(false);
const replyTo = ref<CommentItem | null>(null);
const replyContent = ref('');

async function post() {
  if (!content.value.trim()) return;
  submitting.value = true;
  try {
    await api.post('/comments', { targetType: props.targetType, targetId: props.targetId, content: content.value.trim() });
    content.value = '';
    ElMessage.success('已发布');
    emit('posted');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发布失败');
  } finally {
    submitting.value = false;
  }
}

async function reply(item: CommentItem) {
  if (!replyContent.value.trim()) return;
  try {
    await api.post('/comments', {
      targetType: props.targetType,
      targetId: props.targetId,
      content: replyContent.value.trim(),
      parentId: item.id,
    });
    replyContent.value = '';
    replyTo.value = null;
    emit('posted');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '回复失败');
  }
}

function time(s: string) {
  return dayjs(s).fromNow();
}
</script>

<template>
  <div>
    <div v-if="auth.isLoggedIn" class="flex gap-10px mb-18px">
      <el-input
        v-model="content"
        placeholder="友善留言，理性讨论…"
        @keyup.ctrl.enter="post"
      />
      <el-button type="primary" :loading="submitting" @click="post">发布</el-button>
    </div>
    <div v-else class="text-13px color-ink-soft mb-18px">
      <router-link :to="{ name: 'login' }" class="color-uestc-500 no-underline">登录</router-link>
      后参与讨论
    </div>

    <el-empty v-if="!comments.length" description="还没有留言" :image-size="54" />

    <div class="flex flex-col gap-14px">
      <div v-for="c in comments" :key="c.id" class="flex gap-10px">
        <UserAvatar :name="c.author.nickname || c.author.college || 'U'" :size="34" />
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-8px flex-wrap">
            <span class="text-13px font-semibold color-ink">{{ c.author.nickname || '同学' }}</span>
            <span class="text-12px color-ink-faint">{{ c.author.college || '' }} {{ time(c.createdAt) }}</span>
            <a v-if="auth.isLoggedIn" class="text-12px color-uestc-500 cursor-pointer" @click="replyTo = replyTo?.id === c.id ? null : c">回复</a>
          </div>
          <p class="text-14px color-ink m-0 mt-2px whitespace-pre-wrap">{{ c.content }}</p>

          <!-- 楼中楼 -->
          <div v-if="c.replies?.length" class="mt-8px flex flex-col gap-8px pl-10px border-l-2 border-rgba(15,76,140,0.08)">
            <div v-for="r in c.replies" :key="r.id" class="flex gap-8px">
              <UserAvatar :name="r.author.nickname || 'U'" :size="24" />
              <div>
                <span class="text-12px font-semibold color-ink">{{ r.author.nickname || '同学' }}</span>
                <span class="text-11px color-ink-faint ml-6px">{{ time(r.createdAt) }}</span>
                <p class="text-13px color-ink-soft m-0">{{ r.content }}</p>
              </div>
            </div>
          </div>

          <div v-if="replyTo?.id === c.id" class="mt-8px flex gap-8px">
            <el-input v-model="replyContent" size="small" placeholder="回复…" @keyup.enter="reply(c)" />
            <el-button size="small" type="primary" @click="reply(c)">回复</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
