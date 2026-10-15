<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../../api/client';
import { fmtDate } from '../../api/types';
import MarkdownView from '../../components/MarkdownView.vue';

const items = ref<
  { id: string; title: string; content: string; active: boolean; createdBy: string; createdAt: string }[]
>([]);
const loading = ref(true);

const form = ref({ title: '', content: '' });
const submitting = ref(false);

/** 编辑弹窗：展示中的公告也要能改文案，不然只能「下线再发一条」 */
const editVisible = ref(false);
const editSaving = ref(false);
const editing = ref({ id: '', title: '', content: '' });

async function load() {
  loading.value = true;
  try {
    items.value = await api.get('/admin/announcements');
  } catch (e) {
    // H10：补 catch
    ElMessage.error(e instanceof Error ? e.message : '公告列表加载失败');
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

function openEdit(row: (typeof items.value)[number]) {
  // 复制一份再编辑：取消时原列表不受影响
  editing.value = { id: row.id, title: row.title, content: row.content };
  editVisible.value = true;
}

async function saveEdit() {
  if (!editing.value.title.trim() || !editing.value.content.trim()) {
    ElMessage.warning('请填写标题与内容');
    return;
  }
  editSaving.value = true;
  try {
    await api.patch(`/admin/announcements/${editing.value.id}`, {
      title: editing.value.title.trim(),
      content: editing.value.content.trim(),
    });
    ElMessage.success('公告已更新（已投递的消息中心通知同步更新）');
    editVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    editSaving.value = false;
  }
}

async function toggle(row: (typeof items.value)[number]) {
  // H10：原本无 try/catch，接口失败即 unhandled rejection 且用户看不到任何提示
  try {
    await api.post(`/admin/announcements/${row.id}/toggle`);
    ElMessage.success(row.active ? '已下线' : '已重新发布（旧公告自动下线）');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败');
  }
  await load();
}

async function remove(row: (typeof items.value)[number]) {
  try {
    await ElMessageBox.confirm('确认删除该公告？', '删除公告', { type: 'warning' });
  } catch {
    return; // H10：用户取消 / 关闭弹窗
  }
  try {
    await api.delete(`/admin/announcements/${row.id}`);
    ElMessage.success('已删除');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败');
  }
  await load();
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
            <el-button size="small" round @click="openEdit(a)">编辑</el-button>
            <el-button size="small" link type="danger" @click="remove(a)">删除</el-button>
          </div>
        </div>
        <el-empty v-if="!loading && !items.length" description="还没有发布过公告" :image-size="56" />
      </div>
    </div>

    <!-- 编辑公告（展示中的公告同样可改；正文改动会同步到消息中心已投递的通知） -->
    <el-dialog v-model="editVisible" width="min(720px, 92vw)" align-center title="编辑公告">
      <div class="flex flex-col gap-12px">
        <el-input v-model="editing.title" maxlength="60" show-word-limit placeholder="公告标题" />
        <el-input
          v-model="editing.content"
          type="textarea"
          :rows="8"
          maxlength="2000"
          show-word-limit
          placeholder="公告内容，支持 Markdown（标题、列表、链接、加粗等）"
        />
        <div>
          <div class="text-12px color-ink-faint mb-6px">预览（用户看到的样子）</div>
          <div class="ann-preview">
            <MarkdownView :source="editing.content" />
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <el-button round @click="editVisible = false">取消</el-button>
          <el-button type="primary" round :loading="editSaving" @click="saveEdit">保存修改</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.ann-preview {
  border: 1px solid rgba(232, 232, 232, 0.9);
  border-radius: 12px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.7);
  max-height: 240px;
  overflow-y: auto;
}
</style>
