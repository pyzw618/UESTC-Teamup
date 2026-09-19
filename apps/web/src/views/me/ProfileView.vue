<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';

const route = useRoute();
const auth = useAuthStore();

const form = ref({
  nickname: '',
  college: '',
  grade: null as number | null,
  major: '',
  bio: '',
});
const skills = ref<{ skill: string; level: number | null }[]>([]);
const saving = ref(false);

// 密码管理
const pwdForm = ref({ oldPassword: '', newPassword: '', confirm: '' });
const pwdSaving = ref(false);
const hasPassword = ref(false);

/** 注册后强制完善资料（字段清单：昵称/学院/年级/专业 注册时必填） */
const requiredMode = computed(() => route.query.required === '1');
const profileIncomplete = computed(
  () => !form.value.nickname.trim() || !form.value.college.trim() || !form.value.major.trim() || form.value.grade == null,
);

onMounted(async () => {
  const me = await api.get<typeof form.value & { skills: { skill: string; level: number | null }[]; hasPassword?: boolean }>('/users/me');
  form.value = { nickname: me.nickname || '', college: me.college || '', grade: me.grade, major: me.major || '', bio: me.bio || '' };
  skills.value = me.skills || [];
  // /auth/me 带 hasPassword（users/me 不含密码字段），此处再取一次
  const me2 = await api.get<{ hasPassword?: boolean }>('/auth/me');
  hasPassword.value = !!me2?.hasPassword;
});

function addSkill() {
  if (skills.value.length >= 20) return;
  skills.value.push({ skill: '', level: 3 });
}

async function save() {
  if (!form.value.nickname.trim()) {
    ElMessage.warning('昵称必填');
    return;
  }
  if (!form.value.college.trim()) {
    ElMessage.warning('学院必填');
    return;
  }
  if (form.value.grade == null) {
    ElMessage.warning('年级必填');
    return;
  }
  if (!form.value.major.trim()) {
    ElMessage.warning('专业必填');
    return;
  }
  saving.value = true;
  try {
    await api.put('/users/me', {
      ...form.value,
      grade: form.value.grade ?? undefined,
      skills: skills.value.filter((s) => s.skill.trim()).map((s) => ({ skill: s.skill.trim(), level: s.level ?? undefined })),
    });
    await auth.refresh();
    ElMessage.success('资料已保存');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function savePassword() {
  if (pwdForm.value.newPassword.length < 8) {
    ElMessage.warning('新密码至少 8 位');
    return;
  }
  if (pwdForm.value.newPassword !== pwdForm.value.confirm) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  pwdSaving.value = true;
  try {
    await api.post('/auth/password', {
      newPassword: pwdForm.value.newPassword,
      oldPassword: hasPassword.value ? pwdForm.value.oldPassword : undefined,
    });
    hasPassword.value = true;
    pwdForm.value = { oldPassword: '', newPassword: '', confirm: '' };
    ElMessage.success('密码已保存，下次可用密码登录');
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    pwdSaving.value = false;
  }
}
</script>

<template>
  <div class="glass p-22px">
    <el-alert
      v-if="requiredMode && profileIncomplete"
      type="warning"
      :closable="false"
      show-icon
      title="请先完善基本资料"
      description="昵称、学院、年级、专业为注册必填项，补全后即可正常使用平台功能"
      class="!mb-16px"
    />
    <div class="flex flex-col gap-16px">
      <div class="text-13px color-ink-faint">
        学号 {{ auth.user?.studentNo }} 与邮箱不可修改；学院/年级从学号自动解析，可手工修正
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-14px">
        <div>
          <div class="field-label">昵称</div>
          <el-input v-model="form.nickname" placeholder="怎么称呼你" maxlength="20" />
        </div>
        <div>
          <div class="field-label">学院</div>
          <el-input v-model="form.college" placeholder="如：信息与通信工程学院" />
        </div>
        <div>
          <div class="field-label">年级</div>
          <el-input-number v-model="form.grade" :min="2015" :max="2035" controls-position="right" style="width: 100%" placeholder="入学年份" />
        </div>
        <div>
          <div class="field-label">专业</div>
          <el-input v-model="form.major" placeholder="如：通信工程" />
        </div>
      </div>

      <div>
        <div class="field-label">自我介绍</div>
        <el-input
          v-model="form.bio"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="介绍一下自己：技能方向、参赛经历、找队意向…（会展示在个人名片上）"
        />
      </div>

      <div>
        <div class="flex items-center justify-between mb-8px">
          <div class="field-label !mb-0">技能标签（个人能力名片）</div>
          <el-button size="small" plain round @click="addSkill">+ 添加技能</el-button>
        </div>
        <div class="flex flex-col gap-8px">
          <div v-for="(s, i) in skills" :key="i" class="flex gap-8px items-center">
            <el-input v-model="s.skill" placeholder="如：嵌入式 / 后端 / 建模" style="max-width: 240px" />
            <el-rate
              :model-value="s.level ?? 0"
              :max="5"
              @update:model-value="(v: number) => (s.level = v || null)"
            />
            <el-button type="danger" plain circle size="small" @click="skills.splice(i, 1)">
              <el-icon><i-ep-delete /></el-icon>
            </el-button>
          </div>
        </div>
      </div>

      <el-button type="primary" round :loading="saving" @click="save" class="self-start px-24px">保存</el-button>
    </div>

    <!-- 密码管理 -->
    <el-divider class="!my-20px" />
    <div>
      <div class="flex items-center justify-between mb-10px">
        <div class="font-bold text-15px">🔐 登录密码</div>
        <el-tag :type="hasPassword ? 'success' : 'warning'" size="small" round>
          {{ hasPassword ? '已设置 · 可用密码登录' : '未设置 · 请先使用验证码登录' }}
        </el-tag>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-14px">
        <div v-if="hasPassword">
          <div class="field-label">当前密码</div>
          <el-input v-model="pwdForm.oldPassword" type="password" show-password placeholder="当前密码" />
        </div>
        <div>
          <div class="field-label">新密码（8-64 位）</div>
          <el-input v-model="pwdForm.newPassword" type="password" show-password placeholder="新密码" />
        </div>
        <div>
          <div class="field-label">确认新密码</div>
          <el-input v-model="pwdForm.confirm" type="password" show-password placeholder="再输一遍" @keyup.enter="savePassword" />
        </div>
      </div>
      <el-button
        type="primary"
        round
        class="mt-14px"
        :loading="pwdSaving"
        @click="savePassword"
      >{{ hasPassword ? '修改密码' : '设置密码' }}</el-button>
    </div>
  </div>
</template>

<style scoped>
.field-label {
  font-size: 13px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}
</style>
