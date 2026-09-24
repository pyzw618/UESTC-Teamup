<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Audience, CompetitionFormat, Level, LevelLabel, PublishStatus } from '@teamup/shared';
import { api } from '../../api/client';

const route = useRoute();
const router = useRouter();

const isEdit = computed(() => !!route.params.id);
const saving = ref(false);

const form = ref({
  name: '',
  aliases: [] as string[],
  organizer: '',
  officialUrl: '',
  format: null as CompetitionFormat | null,
  teamSizeMin: null as number | null,
  teamSizeMax: null as number | null,
  audience: null as Audience | null,
  intro: '',
  difficulty: null as number | null,
  effort: null as number | null,
  isBonusEligible: null as boolean | null,
  bonusCategory: '',
  bonusPoints: '',
  sourceUrl: '',
  status: PublishStatus.PUBLISHED,
  levels: [] as Level[],
  tags: [] as string[],
  timelines: [] as { id?: string; stage: string; level: Level | null; startAt: string | null; endAt: string | null }[],
});

const levelOptions = Object.values(Level).map((l) => ({ value: l, label: LevelLabel[l] }));

type TimelineForm = { id?: string; stage: string; level: Level | null; startAt: string | null; endAt: string | null };

/** S5：后端 adminDetail 现在返回字符串数组；防御性归一化，收到对象形态也不崩 */
function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  const o = v as { level?: unknown; name?: unknown } | null;
  return String(o?.level ?? o?.name ?? '');
}

onMounted(async () => {
  if (!isEdit.value) return;
  let c: Record<string, any>;
  try {
    c = await api.get<Record<string, any>>(`/admin/competitions/${route.params.id}`);
  } catch (e) {
    // H10：编辑态拉取失败（不存在/无权限）不能变成 unhandled rejection
    ElMessage.error(e instanceof Error ? e.message : '竞赛信息加载失败');
    router.push({ name: 'admin-competitions' });
    return;
  }
  /**
   * S5：显式挑选表单字段，不再 `{...c}` 全量展开。
   * 原来把接口返回的 id / createdAt / updatedAt 等一并塞进 form，
   * save() 再 `{...form.value}` 全量回传，等于把只读字段写回后端。
   */
  form.value = {
    name: c.name ?? '',
    aliases: Array.isArray(c.aliases) ? c.aliases : [],
    organizer: c.organizer ?? '',
    officialUrl: c.officialUrl ?? '',
    format: (c.format ?? null) as CompetitionFormat | null,
    teamSizeMin: c.teamSizeMin ?? null,
    teamSizeMax: c.teamSizeMax ?? null,
    audience: (c.audience ?? null) as Audience | null,
    intro: c.intro ?? '',
    difficulty: c.difficulty ?? null,
    effort: c.effort ?? null,
    isBonusEligible: c.isBonusEligible ?? null,
    bonusCategory: c.bonusCategory ?? '',
    bonusPoints: c.bonusPoints ?? '',
    sourceUrl: c.sourceUrl ?? '',
    status: (c.status ?? PublishStatus.PUBLISHED) as PublishStatus,
    levels: (Array.isArray(c.levels) ? c.levels : []).map(toStr).filter(Boolean) as Level[],
    tags: (Array.isArray(c.tags) ? c.tags : []).map(toStr).filter(Boolean),
    timelines: ((c.timelines ?? []) as TimelineForm[]).map((t) => ({
      id: t.id,
      stage: t.stage,
      level: t.level,
      startAt: t.startAt ? t.startAt.slice(0, 16) : null,
      endAt: t.endAt ? t.endAt.slice(0, 16) : null,
    })),
  };
});

function addTimeline() {
  form.value.timelines.push({ stage: '', level: null, startAt: null, endAt: null });
}

async function save() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填写竞赛名称');
    return;
  }
  saving.value = true;
  try {
    // S5：显式列出可写字段（原来 `...form.value` 会把只读字段一并回传）
    const payload = {
      name: form.value.name.trim(),
      aliases: form.value.aliases.filter((a) => a.trim()),
      organizer: form.value.organizer || undefined,
      officialUrl: form.value.officialUrl || undefined,
      format: form.value.format ?? undefined,
      teamSizeMin: form.value.teamSizeMin ?? undefined,
      teamSizeMax: form.value.teamSizeMax ?? undefined,
      audience: form.value.audience ?? undefined,
      intro: form.value.intro || undefined,
      difficulty: form.value.difficulty ?? undefined,
      effort: form.value.effort ?? undefined,
      isBonusEligible: form.value.isBonusEligible ?? undefined,
      bonusCategory: form.value.bonusCategory || undefined,
      bonusPoints: form.value.bonusPoints || undefined,
      sourceUrl: form.value.sourceUrl || undefined,
      status: form.value.status,
      levels: form.value.levels,
      tags: form.value.tags.filter((t) => t.trim()),
      timelines: form.value.timelines
        .filter((t) => t.stage.trim())
        .map((t) => ({
          id: t.id,
          stage: t.stage.trim(),
          level: t.level ?? undefined,
          startAt: t.startAt ? new Date(t.startAt).toISOString() : null,
          endAt: t.endAt ? new Date(t.endAt).toISOString() : null,
        })),
    };
    if (isEdit.value) {
      await api.put(`/admin/competitions/${route.params.id}`, payload);
      ElMessage.success('已保存（字段变更已记录版本，时间轴改动自动加锁）');
    } else {
      await api.post('/admin/competitions', payload);
      ElMessage.success('竞赛已录入');
    }
    router.push({ name: 'admin-competitions' });
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="glass p-22px">
    <div class="flex flex-col gap-16px">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-14px">
        <div>
          <div class="f-label">竞赛名称 *</div>
          <el-input v-model="form.name" placeholder="全国大学生电子设计竞赛" />
        </div>
        <div>
          <div class="f-label">别名（逗号分隔，用于搜索与去重）</div>
          <el-input
            :model-value="form.aliases.join(',')"
            placeholder="电赛,TI杯"
            @update:model-value="(v: string) => (form.aliases = v.split(/[,，]/).map((s) => s.trim()))"
          />
        </div>
        <div>
          <div class="f-label">主办方</div>
          <el-input v-model="form.organizer" />
        </div>
        <div>
          <div class="f-label">官网链接</div>
          <el-input v-model="form.officialUrl" placeholder="https://" />
        </div>
        <div>
          <div class="f-label">赛制</div>
          <el-select v-model="form.format" placeholder="—" clearable style="width: 100%">
            <el-option value="INDIVIDUAL" label="个人赛" />
            <el-option value="TEAM" label="团队赛" />
          </el-select>
        </div>
        <div class="grid grid-cols-2 gap-8px">
          <div>
            <div class="f-label">团队人数下限</div>
            <el-input-number v-model="form.teamSizeMin" :min="1" :max="99" style="width: 100%" controls-position="right" />
          </div>
          <div>
            <div class="f-label">上限</div>
            <el-input-number v-model="form.teamSizeMax" :min="1" :max="99" style="width: 100%" controls-position="right" />
          </div>
        </div>
        <div>
          <div class="f-label">面向年级</div>
          <el-select v-model="form.audience" placeholder="—" clearable style="width: 100%">
            <el-option value="UNDERGRAD" label="本科生" />
            <el-option value="POSTGRAD" label="研究生" />
            <el-option value="MIXED" label="本研皆可" />
          </el-select>
        </div>
        <div class="grid grid-cols-2 gap-8px">
          <div>
            <div class="f-label">难度（1-5★）</div>
            <el-rate
              :model-value="form.difficulty ?? 0"
              :max="5"
              @update:model-value="(v: number) => (form.difficulty = v || null)"
            />
          </div>
          <div>
            <div class="f-label">投入度（1-5●）</div>
            <el-rate
              :model-value="form.effort ?? 0"
              :max="5"
              @update:model-value="(v: number) => (form.effort = v || null)"
            />
          </div>
        </div>
      </div>

      <!-- 级别多值 + 标签 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-14px">
        <div>
          <div class="f-label">级别（多值：校→省→国 链路）</div>
          <el-select v-model="form.levels" multiple placeholder="选择级别" style="width: 100%">
            <el-option v-for="l in levelOptions" :key="l.value" :value="l.value" :label="l.label" />
          </el-select>
        </div>
        <div>
          <div class="f-label">学科标签（逗号分隔）</div>
          <el-input
            :model-value="form.tags.join(',')"
            placeholder="电子,嵌入式"
            @update:model-value="(v: string) => (form.tags = v.split(/[,，]/).map((s) => s.trim()))"
          />
        </div>
      </div>

      <!-- 推免加分 -->
      <div class="rounded-14px p-14px" style="background: linear-gradient(135deg, rgba(255,240,198,0.4), rgba(255,255,255,0.4))">
        <div class="f-label font-bold">🎓 推免加分（独立口径，人工维护）</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-12px mt-6px">
          <div>
            <div class="f-label">是否计入</div>
            <el-select v-model="form.isBonusEligible" placeholder="暂无认定信息" clearable style="width: 100%">
              <el-option :value="true" label="计入" />
              <el-option :value="false" label="不计入" />
            </el-select>
          </div>
          <div>
            <div class="f-label">认定类别</div>
            <el-input v-model="form.bonusCategory" placeholder="如：A类 / 国赛" />
          </div>
          <div>
            <div class="f-label">分值说明</div>
            <el-input v-model="form.bonusPoints" placeholder="如：国一3分/国二2分" />
          </div>
        </div>
      </div>

      <!-- 时间轴 -->
      <div>
        <div class="flex items-center justify-between mb-6px">
          <div class="f-label !mb-0 font-bold">时间轴节点</div>
          <el-button size="small" plain round @click="addTimeline">+ 添加节点</el-button>
        </div>
        <div class="flex flex-col gap-8px">
          <div
            v-for="(t, i) in form.timelines"
            :key="i"
            class="grid grid-cols-2 md:grid-cols-5 gap-8px items-center rounded-12px p-10px"
            style="background: rgba(255,255,255,0.5)"
          >
            <el-input v-model="t.stage" placeholder="阶段：报名截止/初赛/决赛" />
            <el-select v-model="t.level" placeholder="级别" clearable>
              <el-option v-for="l in levelOptions" :key="l.value" :value="l.value" :label="l.label" />
            </el-select>
            <el-date-picker v-model="t.startAt" type="datetime" placeholder="开始" style="width: 100%" value-format="YYYY-MM-DDTHH:mm" />
            <el-date-picker v-model="t.endAt" type="datetime" placeholder="截止" style="width: 100%" value-format="YYYY-MM-DDTHH:mm" />
            <el-button type="danger" plain circle size="small" @click="form.timelines.splice(i, 1)">
              <el-icon><i-ep-delete /></el-icon>
            </el-button>
          </div>
          <div class="text-12px color-ink-faint">人工修改过的节点会自动加锁（isLocked），采集上线后也不会被自动更新覆盖</div>
        </div>
      </div>

      <div>
        <div class="f-label">竞赛简介</div>
        <el-input v-model="form.intro" type="textarea" :rows="4" placeholder="给同学们看的介绍：比赛内容、形式、建议…" />
      </div>

      <div>
        <div class="f-label">信息来源（用户可见处会标注）</div>
        <el-input v-model="form.sourceUrl" placeholder="https://www.jwc.uestc.edu.cn/…" />
      </div>

      <div class="flex gap-10px">
        <el-button type="primary" round size="large" :loading="saving" @click="save">保存</el-button>
        <el-button round size="large" @click="router.back()">取消</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.f-label {
  font-size: 13px;
  color: var(--ink-soft);
  margin-bottom: 6px;
}
</style>
