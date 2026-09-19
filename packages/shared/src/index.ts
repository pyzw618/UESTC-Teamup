/**
 * 前后端共享的枚举与类型（与 docs/DATA_MODEL.md §2 对齐）
 */

export enum Level {
  INTERNATIONAL = 'INTERNATIONAL',
  NATIONAL = 'NATIONAL',
  PROVINCIAL = 'PROVINCIAL',
  SCHOOL = 'SCHOOL',
}

export enum UserRole {
  STUDENT = 'STUDENT',
  CONTRIBUTOR = 'CONTRIBUTOR',
  ADMIN = 'ADMIN',
}

export enum CompetitionFormat {
  INDIVIDUAL = 'INDIVIDUAL',
  TEAM = 'TEAM',
}

export enum Audience {
  UNDERGRAD = 'UNDERGRAD',
  POSTGRAD = 'POSTGRAD',
  MIXED = 'MIXED',
}

export enum TeamGoal {
  PRIZE = 'PRIZE',
  PRACTICE = 'PRACTICE',
  NATIONAL_FIRST = 'NATIONAL_FIRST',
  BONUS_ONLY = 'BONUS_ONLY',
}

export enum TeamStatus {
  RECRUITING = 'RECRUITING',
  NEGOTIATING = 'NEGOTIATING',
  FULL = 'FULL',
  COMPETING = 'COMPETING',
  DISBANDED = 'DISBANDED',
}

export enum RoleType {
  ALGORITHM = 'ALGORITHM',
  FRONTEND = 'FRONTEND',
  BACKEND = 'BACKEND',
  HARDWARE = 'HARDWARE',
  MODELING = 'MODELING',
  UI = 'UI',
  PAPER = 'PAPER',
  DEFENSE = 'DEFENSE',
  OTHER = 'OTHER',
}

export enum ApplicationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum PublishStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  ARCHIVED = 'ARCHIVED',
}

export enum SourceHealth {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  FAILING = 'FAILING',
  SUSPENDED = 'SUSPENDED',
}

export enum MaterialKind {
  PAST_PAPER = 'PAST_PAPER',
  OPEN_SOURCE = 'OPEN_SOURCE',
  EXPERIENCE = 'EXPERIENCE',
  TEMPLATE = 'TEMPLATE',
}

export enum CommentTarget {
  COMPETITION = 'COMPETITION',
  POST = 'POST',
  TEAM = 'TEAM',
}

export enum NotificationKind {
  DDL_REMINDER = 'DDL_REMINDER',
  APPLICATION_NEW = 'APPLICATION_NEW',
  APPLICATION_RESULT = 'APPLICATION_RESULT',
  INVITATION_NEW = 'INVITATION_NEW',
  COMMENT_REPLY = 'COMMENT_REPLY',
  CRAWL_ANOMALY = 'CRAWL_ANOMALY',
  SOURCE_FAILING = 'SOURCE_FAILING',
  CORRECTION_NEW = 'CORRECTION_NEW',
}

export enum RevisionOrigin {
  CRAWL = 'CRAWL',
  MANUAL = 'MANUAL',
  ROLLBACK = 'ROLLBACK',
}

export enum CorrectionStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
}

export enum SourceKind {
  ACADEMIC_AFFAIRS = 'ACADEMIC_AFFAIRS',
  COLLEGE = 'COLLEGE',
  COMPETITION_SITE = 'COMPETITION_SITE',
  ACADEMY_LIST = 'ACADEMY_LIST',
}

export enum ParseStrategy {
  CSS = 'CSS',
  JSON_API = 'JSON_API',
  REGEX = 'REGEX',
}

/* ---------------- 中文标签映射（前后端共用展示文案） ---------------- */

export const LevelLabel: Record<Level, string> = {
  [Level.INTERNATIONAL]: '国际级',
  [Level.NATIONAL]: '国家级',
  [Level.PROVINCIAL]: '省级',
  [Level.SCHOOL]: '校级',
};

export const TeamStatusLabel: Record<TeamStatus, string> = {
  [TeamStatus.RECRUITING]: '招募中',
  [TeamStatus.NEGOTIATING]: '沟通中',
  [TeamStatus.FULL]: '已满员',
  [TeamStatus.COMPETING]: '已参赛',
  [TeamStatus.DISBANDED]: '已解散',
};

export const TeamGoalLabel: Record<TeamGoal, string> = {
  [TeamGoal.PRIZE]: '保奖',
  [TeamGoal.PRACTICE]: '学习练手',
  [TeamGoal.NATIONAL_FIRST]: '冲国一',
  [TeamGoal.BONUS_ONLY]: '只为加分',
};

export const RoleTypeLabel: Record<RoleType, string> = {
  [RoleType.ALGORITHM]: '算法',
  [RoleType.FRONTEND]: '前端',
  [RoleType.BACKEND]: '后端',
  [RoleType.HARDWARE]: '硬件',
  [RoleType.MODELING]: '建模',
  [RoleType.UI]: 'UI',
  [RoleType.PAPER]: '论文',
  [RoleType.DEFENSE]: '答辩',
  [RoleType.OTHER]: '其他',
};

export const AudienceLabel: Record<Audience, string> = {
  [Audience.UNDERGRAD]: '本科生',
  [Audience.POSTGRAD]: '研究生',
  [Audience.MIXED]: '本研皆可',
};

export const CompetitionFormatLabel: Record<CompetitionFormat, string> = {
  [CompetitionFormat.INDIVIDUAL]: '个人赛',
  [CompetitionFormat.TEAM]: '团队赛',
};

export const MaterialKindLabel: Record<MaterialKind, string> = {
  [MaterialKind.PAST_PAPER]: '真题',
  [MaterialKind.OPEN_SOURCE]: '开源作品',
  [MaterialKind.EXPERIENCE]: '经验帖',
  [MaterialKind.TEMPLATE]: '答辩模板',
};

export const NotificationKindLabel: Record<NotificationKind, string> = {
  [NotificationKind.DDL_REMINDER]: 'DDL 提醒',
  [NotificationKind.APPLICATION_NEW]: '收到的申请',
  [NotificationKind.APPLICATION_RESULT]: '申请结果',
  [NotificationKind.INVITATION_NEW]: '入队邀请',
  [NotificationKind.COMMENT_REPLY]: '回复',
  [NotificationKind.CRAWL_ANOMALY]: '采集异常',
  [NotificationKind.SOURCE_FAILING]: '数据源告警',
  [NotificationKind.CORRECTION_NEW]: '用户纠错',
};

export const CorrectionStatusLabel: Record<CorrectionStatus, string> = {
  [CorrectionStatus.PENDING]: '待处理',
  [CorrectionStatus.ACCEPTED]: '已采纳',
  [CorrectionStatus.REJECTED]: '已驳回',
};

export const PublishStatusLabel: Record<PublishStatus, string> = {
  [PublishStatus.DRAFT]: '草稿',
  [PublishStatus.PUBLISHED]: '已发布',
  [PublishStatus.ARCHIVED]: '已下线',
};

export const ApplicationStatusLabel: Record<ApplicationStatus, string> = {
  [ApplicationStatus.PENDING]: '待处理',
  [ApplicationStatus.ACCEPTED]: '已通过',
  [ApplicationStatus.REJECTED]: '已婉拒',
  [ApplicationStatus.WITHDRAWN]: '已撤回',
};

/* ---------------- 通用类型 ---------------- */

export interface ApiResponse<T> {
  code: number;
  data: T;
  message?: string;
  /** 仅 DEV 环境：登录验证码回显等 */
  dev?: Record<string, unknown>;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 半匿名规则下对陌生人可见的用户信息 */
export interface PublicUser {
  id: string;
  nickname: string | null;
  college: string | null;
  grade: number | null;
  major: string | null;
  skills?: { skill: string; level: number | null }[];
}
