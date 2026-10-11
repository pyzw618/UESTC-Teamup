<script setup lang="ts">
import { Audience, AudienceLabel, CompetitionFormat, CompetitionFormatLabel } from '@teamup/shared';

/**
 * 竞赛列表筛选面板：桌面端嵌在 sticky aside、移动端嵌在底部抽屉，
 * 两处共用同一份 filters（父组件 reactive 对象，深改即触发其单一数据流 watcher）。
 */
defineProps<{
  filters: {
    levels: string[];
    audience: string;
    format: string;
    status: string;
    year: number | null;
    bonusOnly: boolean;
  };
  levelOptions: { value: string; label: string }[];
  yearOptions: number[];
  currentYear: number;
}>();
</script>

<template>
  <div class="flex flex-col gap-14px">
    <div>
      <div class="filter-label">级别</div>
      <el-checkbox-group v-model="filters.levels" class="flex flex-col gap-4px">
        <el-checkbox v-for="l in levelOptions" :key="l.value" :value="l.value" :label="l.label" />
      </el-checkbox-group>
    </div>
    <div>
      <div class="filter-label">面向年级</div>
      <el-select v-model="filters.audience" placeholder="全部" clearable size="default" style="width: 100%">
        <el-option :value="Audience.UNDERGRAD" :label="AudienceLabel[Audience.UNDERGRAD]" />
        <el-option :value="Audience.POSTGRAD" :label="AudienceLabel[Audience.POSTGRAD]" />
        <el-option :value="Audience.MIXED" :label="AudienceLabel[Audience.MIXED]" />
      </el-select>
    </div>
    <div>
      <div class="filter-label">赛制</div>
      <el-select v-model="filters.format" placeholder="全部" clearable size="default" style="width: 100%">
        <el-option :value="CompetitionFormat.INDIVIDUAL" :label="CompetitionFormatLabel[CompetitionFormat.INDIVIDUAL]" />
        <el-option :value="CompetitionFormat.TEAM" :label="CompetitionFormatLabel[CompetitionFormat.TEAM]" />
      </el-select>
    </div>
    <div>
      <div class="filter-label">状态</div>
      <el-select v-model="filters.status" placeholder="全部" clearable size="default" style="width: 100%">
        <el-option value="OPEN" label="报名中" />
        <el-option value="UPCOMING" label="即将开始" />
        <el-option value="ENDED" label="已结束" />
      </el-select>
    </div>
    <div>
      <div class="filter-label">届次年份</div>
      <el-select v-model="filters.year" placeholder="全部" size="default" style="width: 100%">
        <el-option v-for="y in yearOptions" :key="y" :value="y" :label="`${y} 届${y === currentYear ? '（今年）' : ''}`" />
      </el-select>
    </div>
    <el-divider class="!my-4px" />
    <el-checkbox v-model="filters.bonusOnly" class="bonus-check">
      <span class="font-semibold" style="color: #8a5800">🎓 保研加分竞赛</span>
    </el-checkbox>
  </div>
</template>

<style scoped>
.filter-label {
  font-size: 12px;
  color: var(--ink-faint);
  margin-bottom: 4px;
}
.bonus-check :deep(.el-checkbox__inner) {
  border-color: rgba(217, 159, 0, 0.6);
}
</style>
