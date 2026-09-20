<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api/client';
import { fmtDate } from '../../api/types';

const items = ref<
  { id: string; title: string; content: string; active: boolean; createdBy: string; createdAt: string }[]
>([]);
const loading = ref(true);

const form = ref({ title: '', content: '' });
const submitting = ref(false);

async function load() {
  loading.value = true;
  try {
    items.value = await api.get('/admin/announcements');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function publish() {
  if (!form.value.title.trim() || !form.value.content.trim()) {
    ElMessage.warning('请填写标题与内容');
    return;
  }
  submitting.value = true;
  try {
    await api.post('/admin/announcements', { title: form.value.title.trim(), content: form.value.content.trim() });
    ElMessage.success('公告已发布，将展示在全站顶部');
    form.value = { title: '', content: '' };
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '发布失败');
  } finally {
    submitting.value = false;
  }
}

async function toggle(row: (typeof items.value)[number]) {
  await api.post(`/admin/announcements/${row.id}/toggle`);
  ElMessage.success(row.active ? '已下线' : '已重新发布（旧公告自动下线）');
  load();
}

async function remove(row: (typeof items.value)[number]) {
  await ElMessageBox.confirm('确认删除该公告？', '删除公告', { type: 'warning' });
  await api.delete(`/admin/announcements/${row.id}`);
  ElMessage.success('已删除');
  load();
}
</script>

<template>
  <div class="flex flex-col gap-16px">
    <!-- 发布新公告 -->
    <div class="glass p-18px">
      <div class="font-bold text-15px mb-10px">📢 发布系统公告</div>
      <div class="flex flex-col gap-10px">
        <el-input v-model="form.title" maxlength="60" show-word-limit placeholder="公告标题" />
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="6"
          maxlength="2000"
          show-word-limit
          placeholder="公告内容，支持 Markdown（标题、列表、链接、加粗等），将在全站公告弹窗中渲染展示"
        />
        <div class="flex items-center gap-10px">
          <el-button type="primary" round :loading="submitting" @click="publish">发布公告</el-button>
          <span class="text-12px color-ink-faint">发布新公告会自动下线旧公告</span>
        </div>
      </div>
    </div>

    <!-- 历史公告 -->
    <div class="glass p-18px">
      <div class="font-bold text-15px mb-10px">历史公告</div>
      <div v-loading="loading" class="flex flex-col gap-10px min-h-120px">
        <div v-for="a in items" :key="a.id" class="rounded-14px p-12px" style="background: rgba(255,255,255,0.55)">
          <div class="flex items-center gap-8px flex-wrap mb-4px">
            <el-tag size="small" round :type="a.active ? 'success' : 'info'">{{ a.active ? '展示中' : '已下线' }}</el-tag>
            <span class="text-14px font-bold color-ink">{{ a.title }}</span>
            <span class="text-12px color-ink-faint ml-auto">{{ fmtDate(a.createdAt, true) }}</span>
          </div>
          <p class="text-13px color-ink-soft m-0 whitespace-pre-wrap">{{ a.content }}</p>
          <div class="flex gap-8px mt-8px">
            <el-button size="small" round :type="a.active ? 'danger' : 'primary'" :plain="a.active" @click="toggle(a)">{{ a.active ? '下线' : '重新发布' }}</el-button>
            <el-button size="small" link type="danger" @click="remove(a)">删除</el-button>
          </div>
        </div>
        <el-empty v-if="!loading && !items.length" description="还没有发布过公告" :image-size="56" />
      </div>
    </div>
  </div>
</template>
