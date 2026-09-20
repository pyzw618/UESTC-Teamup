<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
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
  targetType: 'COMPETITION' | 'POST' | 'TEAM';
  targetId: string;
}>();
const emit = defineEmits<{ posted: [] }>();

const auth = useAuthStore();
const comments = ref<CommentItem[]>([]);
const loading = ref(false);
const content = ref('');
const submitting = ref(false);
const replyTo = ref<CommentItem | null>(null);
const replyContent = ref('');

async function load() {
  if (!props.targetId) return;
  loading.value = true;
  try {
    comments.value = await api.get<CommentItem[]>(
      `/comments?targetType=${props.targetType}&targetId=${props.targetId}`,
    );
  } catch {
    comments.value = [];
  } finally {
    loading.value = false;
  }
}

watch(() => props.targetId, load);
onMounted(load);

async function post() {
  if (!content.value.trim()) return;
  submitting.value = true;
  try {
    await api.post('/comments', { targetType: props.targetType, targetId: props.targetId, content: content.value.trim() });
    content.value = '';
    await load();
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
    await load();
    emit('posted');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '回复失败');
  }
}

/** 点赞 / 取消点赞：本地即时反馈，后端幂等切换 */
async function toggleLike(item: CommentItem) {
  if (!auth.isLoggedIn) {
    ElMessage.info('登录后才能点赞');
    return;
  }
  // 乐观更新
  const nextLiked = !item.liked;
  item.likes = Math.max(0, item.likes + (nextLiked ? 1 : -1));
  item.liked = nextLiked;
  try {
    const res = await api.post<{ liked: boolean; likes: number }>(`/comments/${item.id}/like`);
    item.liked = res.liked;
    item.likes = res.likes;
  } catch (e) {
    // 回滚
    item.liked = !nextLiked;
    item.likes = Math.max(0, item.likes + (nextLiked ? -1 : 1));
    ElMessage.error(e instanceof Error ? e.message : '点赞失败');
  }
}

async function remove(item: CommentItem) {
  try {
    await api.delete(`/comments/${item.id}`);
    await load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
}

function time(s: string) {
  return dayjs(s).fromNow();
}
</script>

<template>
  <div v-loading="loading">
    <div v-if="auth.isLoggedIn" class="flex gap-10px mb-18px">
      <el-input
        v-model="content"
        placeholder="友善留言，理性讨论…"
        @keyup.ctrl.enter="post"
      />
      <el-button round :loading="submitting" @click="post">发布</el-button>
    </div>
    <div v-else class="text-13px color-ink-soft mb-18px">
      <router-link :to="{ name: 'login' }" class="color-uestc-500 no-underline">登录</router-link>
      后参与讨论
    </div>

    <el-empty v-if="!comments.length && !loading" description="还没有留言" :image-size="54" />

    <div class="flex flex-col gap-14px">
      <div v-for="c in comments" :key="c.id" class="flex gap-10px">
        <UserAvatar :name="c.author.nickname || c.author.college || 'U'" :size="34" />
        <div class="flex-1 min-w-0">
          <div class="flex items-baseline gap-8px flex-wrap">
            <span class="text-13px font-semibold color-ink">{{ c.author.nickname || '同学' }}</span>
            <span class="text-12px color-ink-faint">{{ c.author.college || '' }} {{ time(c.createdAt) }}</span>
            <el-button v-if="auth.isLoggedIn" link size="small" type="primary" @click="replyTo = replyTo?.id === c.id ? null : c">回复</el-button>
            <el-button v-if="auth.isLoggedIn && auth.user?.id === c.author.id" link size="small" type="danger" @click="remove(c)">删除</el-button>
          </div>
          <p class="text-14px color-ink m-0 mt-2px whitespace-pre-wrap">{{ c.content }}</p>

          <div class="mt-6px">
            <button
              class="like-btn"
              :class="{ liked: c.liked }"
              type="button"
              @click.stop="toggleLike(c)"
            >
              <span class="like-icon">{{ c.liked ? '❤️' : '🤍' }}</span>
              <span v-if="c.likes > 0">{{ c.likes }}</span>
            </button>
          </div>

          <!-- 楼中楼 -->
          <div v-if="c.replies?.length" class="mt-8px flex flex-col gap-8px pl-10px border-l-2 border-rgba(15,76,140,0.08)">
            <div v-for="r in c.replies" :key="r.id" class="flex gap-8px">
              <UserAvatar :name="r.author.nickname || 'U'" :size="24" />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-8px flex-wrap">
                  <span class="text-12px font-semibold color-ink">{{ r.author.nickname || '同学' }}</span>
                  <template v-if="r.replyTo">
                    <span class="text-11px color-ink-faint">回复</span>
                    <span class="text-12px color-uestc-500">@{{ r.replyTo.nickname || '同学' }}</span>
                  </template>
                  <span class="text-11px color-ink-faint">{{ time(r.createdAt) }}</span>
                  <el-button v-if="auth.isLoggedIn" link size="small" type="primary" @click="replyTo = replyTo?.id === r.id ? null : r">回复</el-button>
                </div>
                <p class="text-13px color-ink-soft m-0">{{ r.content }}</p>
                <button
                  class="like-btn"
                  :class="{ liked: r.liked }"
                  type="button"
                  @click.stop="toggleLike(r)"
                >
                  <span class="like-icon">{{ r.liked ? '❤️' : '🤍' }}</span>
                  <span v-if="r.likes > 0">{{ r.likes }}</span>
                </button>
                <div v-if="replyTo?.id === r.id" class="mt-6px flex gap-8px">
                  <el-input v-model="replyContent" size="small" :placeholder="`回复 @${r.author.nickname || '同学'}…`" @keyup.enter="reply(r)" />
                  <el-button size="small" round @click="reply(r)">回复</el-button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="replyTo?.id === c.id" class="mt-8px flex gap-8px">
            <el-input v-model="replyContent" size="small" :placeholder="`回复 @${c.author.nickname || '同学'}…`" @keyup.enter="reply(c)" />
            <el-button size="small" round @click="reply(c)">回复</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 玻璃胶囊小按钮（工艺同全局 seg-switch / 铃铛按钮） */
.like-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(15, 76, 140, 0.12);
  background: rgba(255, 255, 255, 0.7);
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--ink-faint, #9aa3ad);
  cursor: pointer;
  transition: all 0.15s ease-out;
}
.like-btn:hover {
  background: #fff;
  border-color: rgba(15, 76, 140, 0.35);
  transform: translateY(-1px);
}
.like-btn:active {
  transform: translateY(1px);
}
.like-btn:hover,
.like-btn.liked {
  color: #c0392b;
}
.like-icon {
  font-size: 13px;
  line-height: 1;
}
</style>
