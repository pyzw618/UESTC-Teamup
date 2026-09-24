import dayjs from 'dayjs';

export { dayjs };

export interface CompetitionListItem {
  id: string;
  name: string;
  organizer: string | null;
  format: string | null;
  audience: string | null;
  difficulty: number | null;
  effort: number | null;
  isBonusEligible: boolean | null;
  bonusCategory: string | null;
  bonusPoints: string | null;
  levels: string[];
  tags: string[];
  recruitingTeams: number;
  nextDeadline: string | null;
  status: 'OPEN' | 'UPCOMING' | 'ENDED' | 'UNKNOWN';
  updatedAt: string;
}

export interface TimelineNode {
  id: string;
  competitionId: string;
  competitionName: string;
  stage: string;
  level: string | null;
  competitionLevels: string[];
  startAt: string | null;
  endAt: string | null;
  isLocked: boolean;
  kind: 'signup' | 'race';
}

export interface CompetitionDetail extends CompetitionListItem {
  aliases: string[];
  officialUrl: string | null;
  intro: string | null;
  teamSizeMin: number | null;
  teamSizeMax: number | null;
  sourceUrl: string | null;
  lastSyncedAt: string | null;
  timelines: {
    id: string;
    stage: string;
    level: string | null;
    startAt: string | null;
    endAt: string | null;
    isLocked: boolean;
  }[];
  awards: { id: string; year: number | null; awardName: string | null; teamName: string | null; members: string[] }[];
  materials: { id: string; kind: string; title: string; url: string }[];
  recruitingTeamsList?: TeamSummary[];
  createdAt: string;
}

/** 招募帖（广告牌模式）：无名额/成员概念，联系方式直接公开 */
export interface TeamLeaderView {
  id: string;
  nickname: string | null;
  college: string | null;
  grade: number | null;
  major: string | null;
  studentNo?: string;
}

/** 竞赛详情页内嵌的招募帖摘要 */
export interface TeamSummary {
  id: string;
  goal: string;
  status: string;
  deadline: string | null;
  neededRoles: string[];
  /** 计划招募人数（队长手填） */
  targetSize?: number | null;
  /** 已有成员数量 = 手填成员行数 */
  memberCount?: number;
  leader: TeamLeaderView;
}

export interface TeamListItem {
  id: string;
  goal: string;
  status: string;
  deadline: string | null;
  neededRoles: string[];
  expired: boolean;
  /** 计划招募人数（队长手填，展示用） */
  targetSize: number | null;
  /** 已有成员数量（派生） */
  memberCount: number;
  competition: { id: string; name: string };
  leader: TeamLeaderView;
  commentCount: number;
  createdAt: string;
}

export interface TeamDetail extends TeamListItem {
  requirement: string | null;
  /** 联系方式：QQ 与微信至少一项 */
  qq: string | null;
  wechat: string | null;
  competition: { id: string; name: string; levels: string[]; officialUrl: string | null };
  /** 已有成员情况（队长手填，纯展示） */
  members: { id: string; grade: number | null; college: string | null; major: string | null; rank: string | null; intro: string | null }[];
  /**
   * M15：后端契约 —— isLeader 仅表示「真实队长」，isAdmin 表示「当前用户是管理员」。
   * 写操作（编辑/解散/切状态）只看 isLeader；管理员在详情页是只读视角。
   */
  viewer: { isLeader: boolean; isAdmin?: boolean };
}

export interface NotificationItem {
  id: string;
  kind: string;
  kindLabel: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface CorrectionItem {
  id: string;
  competitionId: string;
  competition: { id: string; name: string } | null;
  field: string;
  currentValue: string | null;
  proposedValue: string | null;
  note: string | null;
  status: string;
  createdAt: string;
  reporter: { id: string; nickname: string | null; college: string | null } | null;
}

export interface RevisionItem {
  id: string;
  competitionId: string | null;
  competition: { id: string; name: string } | null;
  timelineId: string | null;
  timeline: { id: string; stage: string } | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  origin: string;
  createdAt: string;
}

export interface CommentItem {
  id: string;
  content: string;
  parentId: string | null;
  /** 楼中楼：这条回复真实回复的对象（挂在根评论下） */
  replyTo?: { id: string; nickname: string | null } | null;
  /** 点赞数（冗余计数，由后端 CommentLike 维护） */
  likes: number;
  /** 当前登录用户是否已点赞 */
  liked: boolean;
  createdAt: string;
  author: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null };
  replies: CommentItem[];
}

/**
 * M9：截止日期剩余天数，按**日历天差**计算（不是毫秒差取整）。
 *
 * 原实现 `Math.ceil((end - now) / 86400_000)` 的问题：
 * 今晚 23:59 截止会显示「剩 1 天」，午夜前后口径跳变；
 * 且过期为负数，调用方若只判 `>0` 就会把已过期误显示成「今日截止」。
 *
 * 新语义：0 = 今天截止，负数 = 已过期（N 天前截止）。
 * 例：今天 00:01 与今天 23:59 都返回 0。
 */
export function daysLeft(endAt: string | null): number | null {
  if (!endAt) return null;
  const end = dayjs(endAt);
  if (!end.isValid()) return null;
  return end.startOf('day').diff(dayjs().startOf('day'), 'day');
}

export function fmtDate(s: string | null | undefined, withTime = false): string {
  if (!s) return '待定';
  const d = dayjs(s);
  return withTime ? d.format('YYYY-MM-DD HH:mm') : d.format('YYYY-MM-DD');
}
