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

export interface TeamSummary {
  id: string;
  goal: string;
  status: string;
  deadline: string | null;
  slots: { id: string; role: string; filled: boolean }[];
  memberCount: number;
  pendingCount?: number;
  leader: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null };
}

export interface TeamListItem {
  id: string;
  goal: string;
  status: string;
  deadline: string | null;
  teamSize: number | null;
  currentSize: number | null;
  expired: boolean;
  competition: { id: string; name: string };
  leader: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null };
  slots: { id: string; role: string; filled: boolean }[];
  openRoles: string[];
  memberCount: number;
  pendingCount: number;
  createdAt: string;
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
  createdAt: string;
  author: { id: string; nickname: string | null; college: string | null; grade: number | null; major: string | null };
  replies: CommentItem[];
}

export function daysLeft(endAt: string | null): number | null {
  if (!endAt) return null;
  return Math.ceil((new Date(endAt).getTime() - Date.now()) / 86400_000);
}

export function fmtDate(s: string | null | undefined, withTime = false): string {
  if (!s) return '待定';
  const d = dayjs(s);
  return withTime ? d.format('YYYY-MM-DD HH:mm') : d.format('YYYY-MM-DD');
}
