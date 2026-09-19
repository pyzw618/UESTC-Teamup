/**
 * 种子数据
 * 1. 推免加分清单：来自 prisma/bonus-list.json（由 extract_bonus.py 从校教〔2026〕39 号 PDF 提取）
 * 2. 重点竞赛：补全级别/标签/赛程/简介（时间轴为 2026-2027 赛季演示占位，以官网为准）
 * 3. 演示用户与招募中队伍：保证首屏不空
 *
 * 运行：pnpm db:seed
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient, Audience, CompetitionFormat, Level, PublishStatus, RoleType, TeamGoal, TeamStatus } from '@prisma/client';
import { hashPassword } from '../src/common/password';

const prisma = new PrismaClient();

interface BonusFile {
  standard: { category: string; national: Record<string, string>; provincial: Record<string, string> };
  competitions: string[];
}

const bonusStandard = '国家级 3 / 2.5 / 1.5 分；省级 1 / 0.3 / 0.1 分（最高奖/次高奖/次次高奖）';

/** 重点竞赛的丰富信息；时间轴为演示占位日期，真实赛程以当年官网通知为准 */
const ENRICHED: Record<
  string,
  {
    aliases?: string[];
    organizer?: string;
    officialUrl?: string;
    levels: Level[];
    tags: string[];
    format?: CompetitionFormat;
    teamSize?: [number, number];
    audience?: Audience;
    difficulty?: number;
    effort?: number;
    intro: string;
    timelines: { stage: string; level?: Level; startAt: string | null; endAt: string | null }[];
  }
> = {
  '中国国际大学生创新大赛': {
    aliases: ['互联网+', '国赛', '中国国际互联网+大学生创新创业大赛'],
    organizer: '教育部等部委与地方人民政府',
    officialUrl: 'https://cy.ncss.cn',
    levels: [Level.NATIONAL],
    tags: ['创新创业', '综合'],
    format: CompetitionFormat.TEAM,
    teamSize: [3, 15],
    audience: Audience.MIXED,
    difficulty: 4,
    effort: 5,
    intro: '原"互联网+"大学生创新创业大赛，国内规格最高的双创赛事。高教主赛道强调科技创新与产业化落地，成电在集成电路、人工智能等硬科技赛道优势明显。',
    timelines: [
      { stage: '校级报名', level: Level.SCHOOL, startAt: '2026-09-01T00:00:00Z', endAt: '2026-09-30T16:00:00Z' },
      { stage: '省赛', level: Level.PROVINCIAL, startAt: '2026-10-20T00:00:00Z', endAt: '2026-11-10T16:00:00Z' },
      { stage: '全国总决赛', level: Level.NATIONAL, startAt: '2026-11-25T00:00:00Z', endAt: '2026-11-28T16:00:00Z' },
    ],
  },
  '“挑战杯”全国大学生课外学术科技作品竞赛': {
    aliases: ['挑战杯', '大挑'],
    organizer: '共青团中央、中国科协、教育部等',
    officialUrl: 'https://www.tiaozhanbei.net',
    levels: [Level.NATIONAL, Level.PROVINCIAL],
    tags: ['学术科技', '综合'],
    format: CompetitionFormat.TEAM,
    teamSize: [1, 8],
    audience: Audience.MIXED,
    difficulty: 4,
    effort: 4,
    intro: '与中国国际大学生创新大赛并称"两大挑"，偶数年办"小挑"（创业计划）、奇数年办"大挑"（课外学术科技作品）。自然科学类学术论文、哲学社科类调查报告、科技发明制作三类作品。',
    timelines: [
      { stage: '校级选拔报名', level: Level.SCHOOL, startAt: '2027-02-20T00:00:00Z', endAt: '2027-03-15T16:00:00Z' },
      { stage: '省赛', level: Level.PROVINCIAL, startAt: '2027-04-10T00:00:00Z', endAt: '2027-05-20T16:00:00Z' },
      { stage: '全国决赛', level: Level.NATIONAL, startAt: '2027-10-15T00:00:00Z', endAt: '2027-10-18T16:00:00Z' },
    ],
  },
  'ACM-ICPC 国际大学生程序设计竞赛': {
    aliases: ['ICPC', 'ACM', '程序设计竞赛'],
    organizer: '国际计算机学会（ACM）',
    officialUrl: 'https://icpc.global',
    levels: [Level.INTERNATIONAL, Level.NATIONAL, Level.PROVINCIAL],
    tags: ['算法', '程序设计'],
    format: CompetitionFormat.TEAM,
    teamSize: [3, 3],
    audience: Audience.MIXED,
    difficulty: 5,
    effort: 5,
    intro: '历史最悠久的大学生程序设计竞赛，三人一队共用一台电脑，5 小时解 10+ 道题。成电常年有队伍晋级 EC-Final 与 World Finals。',
    timelines: [
      { stage: '网络预选赛报名', level: Level.NATIONAL, startAt: '2026-08-25T00:00:00Z', endAt: '2026-09-10T16:00:00Z' },
      { stage: '全国邀请赛', level: Level.NATIONAL, startAt: '2026-10-01T00:00:00Z', endAt: '2026-10-02T16:00:00Z' },
      { stage: '区域赛（济南/杭州/南京等）', level: Level.NATIONAL, startAt: '2026-10-25T00:00:00Z', endAt: '2026-11-20T16:00:00Z' },
    ],
  },
  '全国大学生数学建模竞赛': {
    aliases: ['数模国赛', '数学建模', 'CUMCM'],
    organizer: '中国工业与应用数学学会（CSIAM）',
    officialUrl: 'https://www.mcm.edu.cn',
    levels: [Level.NATIONAL, Level.PROVINCIAL, Level.SCHOOL],
    tags: ['数学建模', '综合'],
    format: CompetitionFormat.TEAM,
    teamSize: [3, 3],
    audience: Audience.MIXED,
    difficulty: 4,
    effort: 3,
    intro: '三人一队，72 小时完成一道开放性工程问题的建模、求解与论文。校内建模氛围浓厚，是保研加分与科研入门的常见起点。',
    timelines: [
      { stage: '报名开始', level: Level.SCHOOL, startAt: '2027-06-01T00:00:00Z', endAt: null },
      { stage: '报名截止', level: Level.SCHOOL, startAt: null, endAt: '2027-09-03T16:00:00Z' },
      { stage: '正式比赛（72小时）', level: Level.NATIONAL, startAt: '2027-09-09T18:00:00Z', endAt: '2027-09-12T20:00:00Z' },
    ],
  },
  '美国大学生数学建模竞赛': {
    aliases: ['美赛', 'MCM', 'ICM', 'MCM/ICM'],
    organizer: '美国数学及其应用联合会（COMAP）',
    officialUrl: 'https://www.comap.com',
    levels: [Level.INTERNATIONAL],
    tags: ['数学建模', '国际'],
    format: CompetitionFormat.TEAM,
    teamSize: [3, 3],
    audience: Audience.MIXED,
    difficulty: 3,
    effort: 3,
    intro: '全球规模最大的大学生数学建模赛事，99 小时英文论文。注意：Outstanding Winner 按国家级最高奖计，Finalist 按国家级次高奖计，Meritorious 按国家级次次高奖计。',
    timelines: [
      { stage: '报名截止', level: Level.INTERNATIONAL, startAt: null, endAt: '2027-01-22T16:00:00Z' },
      { stage: '正式比赛（99小时）', level: Level.INTERNATIONAL, startAt: '2027-02-04T17:00:00Z', endAt: '2027-02-08T20:00:00Z' },
    ],
  },
  '全国大学生电子设计竞赛': {
    aliases: ['电赛', 'TI杯'],
    organizer: '教育部高等教育司、工业和信息化部人事教育司',
    officialUrl: 'https://nuedc.xjtu.edu.cn',
    levels: [Level.NATIONAL, Level.PROVINCIAL, Level.SCHOOL],
    tags: ['电子', '嵌入式', '硬件'],
    format: CompetitionFormat.TEAM,
    teamSize: [3, 3],
    audience: Audience.UNDERGRAD,
    difficulty: 5,
    effort: 5,
    intro: '两年一届的电子类顶级赛事（单数年国赛、双数年省赛 TI 杯），四天三夜完成一个完整的电子系统。成电是传统强校，校内选拔赛由信通学院等组织。',
    timelines: [
      { stage: '校内选拔报名', level: Level.SCHOOL, startAt: '2026-10-08T00:00:00Z', endAt: '2026-10-20T16:00:00Z' },
      { stage: '省赛（TI杯）', level: Level.PROVINCIAL, startAt: '2027-07-28T00:00:00Z', endAt: '2027-07-31T16:00:00Z' },
      { stage: '全国总决赛', level: Level.NATIONAL, startAt: '2027-08-04T00:00:00Z', endAt: '2027-08-07T16:00:00Z' },
    ],
  },
  '全国大学生智能汽车竞赛': {
    aliases: ['智能车', '恩智浦杯'],
    organizer: '教育部高等学校自动化类专业教学指导委员会',
    levels: [Level.NATIONAL, Level.PROVINCIAL, Level.SCHOOL],
    tags: ['嵌入式', '控制', '机器人'],
    format: CompetitionFormat.TEAM,
    teamSize: [2, 4],
    audience: Audience.UNDERGRAD,
    difficulty: 4,
    effort: 5,
    intro: '以智能模型车为载体的创意科技竞赛，涉及嵌入式、控制算法、机械结构。成电智能车基地常年面向全校招新。',
    timelines: [
      { stage: '校内赛报名', level: Level.SCHOOL, startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-25T16:00:00Z' },
      { stage: '分区赛', level: Level.PROVINCIAL, startAt: '2027-06-15T00:00:00Z', endAt: '2027-07-10T16:00:00Z' },
      { stage: '全国总决赛', level: Level.NATIONAL, startAt: '2027-08-15T00:00:00Z', endAt: '2027-08-18T16:00:00Z' },
    ],
  },
  '全国大学生信息安全竞赛': {
    aliases: ['CISCN', '信息安全国赛'],
    organizer: '教育部高等学校网络空间安全专业教学指导委员会',
    levels: [Level.NATIONAL],
    tags: ['网络安全', 'CTF'],
    format: CompetitionFormat.TEAM,
    teamSize: [4, 4],
    audience: Audience.MIXED,
    difficulty: 4,
    effort: 4,
    intro: '国内最具影响力的大学生网络安全赛事，线上赛为 CTF 解题模式，线下赛为攻防对抗（AWD）。',
    timelines: [
      { stage: '线上赛报名', level: Level.NATIONAL, startAt: '2027-04-01T00:00:00Z', endAt: '2027-05-10T16:00:00Z' },
      { stage: '线上初赛', level: Level.NATIONAL, startAt: '2027-05-15T00:00:00Z', endAt: '2027-05-16T16:00:00Z' },
    ],
  },
  '中国大学生计算机设计大赛': {
    aliases: ['4C', '计算机设计大赛'],
    organizer: '教育部高校计算机类专业教学指导委员会等',
    levels: [Level.NATIONAL, Level.PROVINCIAL],
    tags: ['软件应用', '设计'],
    format: CompetitionFormat.TEAM,
    teamSize: [1, 3],
    audience: Audience.UNDERGRAD,
    difficulty: 3,
    effort: 3,
    intro: '分设软件应用与开发、微课与教学辅助、物联网应用、大数据应用、人工智能应用、信息可视化等多个大类。',
    timelines: [
      { stage: '校级赛报名', level: Level.SCHOOL, startAt: '2027-03-01T00:00:00Z', endAt: '2027-03-25T16:00:00Z' },
      { stage: '省级复赛', level: Level.PROVINCIAL, startAt: '2027-05-10T00:00:00Z', endAt: '2027-06-10T16:00:00Z' },
      { stage: '全国决赛', level: Level.NATIONAL, startAt: '2027-07-15T00:00:00Z', endAt: '2027-08-10T16:00:00Z' },
    ],
  },
  '中国高校计算机大赛': {
    aliases: ['C4', '天梯赛', '大数据挑战赛'],
    organizer: '教育部高校计算机类专业教学指导委员会等',
    levels: [Level.NATIONAL, Level.PROVINCIAL],
    tags: ['算法', '大数据', '程序设计'],
    audience: Audience.MIXED,
    difficulty: 4,
    effort: 3,
    intro: '下设大数据挑战赛、团体程序设计天梯赛、移动应用创新赛、网络技术挑战赛、人工智能创意赛五个赛道。',
    timelines: [
      { stage: '天梯赛报名', level: Level.NATIONAL, startAt: '2027-02-25T00:00:00Z', endAt: '2027-03-20T16:00:00Z' },
      { stage: '天梯赛全国总决赛', level: Level.NATIONAL, startAt: '2027-04-17T00:00:00Z', endAt: '2027-04-17T16:00:00Z' },
    ],
  },
  '华为ICT大赛': {
    aliases: ['华为ICT'],
    organizer: '华为技术有限公司',
    officialUrl: 'https://e.huawei.com/cn/talent/ict-contest',
    levels: [Level.NATIONAL, Level.INTERNATIONAL],
    tags: ['网络', '云计算', '通信'],
    format: CompetitionFormat.TEAM,
    teamSize: [3, 3],
    audience: Audience.MIXED,
    difficulty: 3,
    effort: 3,
    intro: '面向全球高校学生的 ICT 技术赛事，设网络、云、计算、昇腾 AI 等赛道，实践性与就业关联度高。',
    timelines: [
      { stage: '校内报名', level: Level.SCHOOL, startAt: '2026-10-15T00:00:00Z', endAt: '2026-11-10T16:00:00Z' },
      { stage: '省赛初赛', level: Level.PROVINCIAL, startAt: '2026-11-20T00:00:00Z', endAt: '2026-12-05T16:00:00Z' },
    ],
  },
  '全国大学生集成电路创新创业大赛': {
    aliases: ['集创赛'],
    organizer: '教育部电子信息类专业教学指导委员会等',
    levels: [Level.NATIONAL, Level.PROVINCIAL],
    tags: ['集成电路', '芯片'],
    format: CompetitionFormat.TEAM,
    teamSize: [1, 3],
    audience: Audience.UNDERGRAD,
    difficulty: 4,
    effort: 4,
    intro: '集成电路领域规模最大的全国性赛事，覆盖数字/模拟芯片设计、EDA、FPGA 等多个杯赛方向，与成电微电子学科高度契合。',
    timelines: [
      { stage: '报名开始', level: Level.NATIONAL, startAt: '2026-12-01T00:00:00Z', endAt: null },
      { stage: '报名截止', level: Level.NATIONAL, startAt: null, endAt: '2027-03-10T16:00:00Z' },
      { stage: '全国总决赛', level: Level.NATIONAL, startAt: '2027-07-20T00:00:00Z', endAt: '2027-07-23T16:00:00Z' },
    ],
  },
  '全国大学生机器人大赛（CURC）': {
    aliases: ['RoboMaster', '机器人竞赛', '机甲大师'],
    organizer: '共青团中央、全国学联',
    levels: [Level.NATIONAL, Level.PROVINCIAL],
    tags: ['机器人', '机械', '嵌入式'],
    format: CompetitionFormat.TEAM,
    teamSize: [5, 20],
    audience: Audience.UNDERGRAD,
    difficulty: 5,
    effort: 5,
    intro: '包含 RoboMaster 机甲大师等赛项，机器人对抗类赛事的巅峰，成电机器人队常年招募机械、电控、视觉队员。',
    timelines: [
      { stage: '校内招募', level: Level.SCHOOL, startAt: '2026-09-20T00:00:00Z', endAt: '2026-10-15T16:00:00Z' },
      { stage: '区域赛', level: Level.PROVINCIAL, startAt: '2027-05-20T00:00:00Z', endAt: '2027-05-25T16:00:00Z' },
      { stage: '全国总决赛', level: Level.NATIONAL, startAt: '2027-08-20T00:00:00Z', endAt: '2027-08-24T16:00:00Z' },
    ],
  },
};

/** 追加的非认定清单竞赛（演示"暂无认定信息"空态与校级入口） */
const EXTRA_COMPETITIONS: {
  name: string;
  aliases?: string[];
  levels: Level[];
  tags: string[];
  isBonusEligible: boolean | null;
  intro?: string;
  timelines?: { stage: string; level?: Level; startAt: string | null; endAt: string | null }[];
  difficulty?: number;
  effort?: number;
  format?: CompetitionFormat;
}[] = [
  {
    name: '蓝桥杯全国软件和信息技术专业人才大赛',
    aliases: ['蓝桥杯'],
    levels: [Level.PROVINCIAL, Level.NATIONAL],
    tags: ['程序设计', '算法'],
    isBonusEligible: null,
    difficulty: 3,
    effort: 2,
    intro: '个人赛制、参赛门槛低，适合作为算法入门第一赛。注意：暂未列入校教〔2026〕39 号认定清单，请以学院当年细则为准。',
    timelines: [
      { stage: '报名截止', level: Level.SCHOOL, startAt: null, endAt: '2026-12-10T16:00:00Z' },
      { stage: '省赛', level: Level.PROVINCIAL, startAt: '2027-04-10T00:00:00Z', endAt: '2027-04-12T16:00:00Z' },
    ],
  },
  {
    name: '电子科技大学电子设计竞赛',
    aliases: ['校电赛'],
    levels: [Level.SCHOOL],
    tags: ['电子', '嵌入式'],
    isBonusEligible: null,
    format: CompetitionFormat.TEAM,
    difficulty: 2,
    effort: 3,
    intro: '校内选拔性质的电子设计赛事，成绩优秀者将组队参加省赛与国赛，是电赛的起点。',
    timelines: [
      { stage: '报名开始', level: Level.SCHOOL, startAt: '2026-10-08T00:00:00Z', endAt: null },
      { stage: '报名截止', level: Level.SCHOOL, startAt: null, endAt: '2026-10-20T16:00:00Z' },
      { stage: '校内赛', level: Level.SCHOOL, startAt: '2026-11-05T00:00:00Z', endAt: '2026-11-08T16:00:00Z' },
    ],
  },
  {
    name: '电子科技大学数学建模校内赛',
    aliases: ['校模赛'],
    levels: [Level.SCHOOL],
    tags: ['数学建模'],
    isBonusEligible: null,
    format: CompetitionFormat.TEAM,
    difficulty: 2,
    effort: 2,
    intro: '面向全校的数模校内热身赛，优秀队伍可获推省赛/国赛资格。',
    timelines: [
      { stage: '报名截止', level: Level.SCHOOL, startAt: null, endAt: '2026-10-28T16:00:00Z' },
      { stage: '比赛（48小时）', level: Level.SCHOOL, startAt: '2026-11-06T13:00:00Z', endAt: '2026-11-08T13:00:00Z' },
    ],
  },
];

const DEMO_USERS = [
  {
    // 管理员（可用密码 123456789 登录，登录后进入后台）
    email: '2024080909015@std.uestc.edu.cn',
    studentNo: '2024080909015',
    password: '123456789',
    nickname: '雷达站长',
    college: '信息与通信工程学院',
    grade: 2024,
    major: '信息工程',
    role: 'ADMIN' as const,
    skills: [['嵌入式', 4], ['组织协调', 3]] as [string, number][],
  },
  {
    // 测试用户（可用密码 123456789 登录）
    email: '2024080909000@std.uestc.edu.cn',
    studentNo: '2024080909000',
    password: '123456789',
    nickname: '测试同学',
    college: '信息与通信工程学院',
    grade: 2024,
    major: '电子信息工程',
    skills: [['Python', 3]] as [string, number][],
  },
  {
    // 以下演示用户未设密码：用验证码登录后可设置密码
    email: '2024080901015@std.uestc.edu.cn',
    studentNo: '2024080901015',
    nickname: '陈软硬件都会',
    college: '信息与通信工程学院',
    grade: 2024,
    major: '电子信息工程',
    skills: [['STM32', 4], ['PCB', 3], ['C++', 4]] as [string, number][],
  },
  {
    email: '2024060202021@std.uestc.edu.cn',
    studentNo: '2024060202021',
    nickname: '李建模',
    college: '数学科学学院',
    grade: 2024,
    major: '数学与应用数学',
    skills: [['MATLAB', 4], ['论文写作', 4], ['Python', 3]] as [string, number][],
  },
  {
    email: '2023060110122@std.uestc.edu.cn',
    studentNo: '2023060110122',
    nickname: '张算法',
    college: '计算机科学与工程学院',
    grade: 2023,
    major: '计算机科学与技术',
    skills: [['算法竞赛', 5], ['C++', 5], ['深度学习', 3]] as [string, number][],
  },
  {
    email: '2025050303110@std.uestc.edu.cn',
    studentNo: '2025050303110',
    nickname: '王前端',
    college: '信息与软件工程学院',
    grade: 2025,
    major: '软件工程',
    skills: [['Vue', 4], ['TypeScript', 4], ['UI设计', 2]] as [string, number][],
  },
];

async function main() {
  const bonusFile: BonusFile = JSON.parse(
    readFileSync(join(__dirname, 'bonus-list.json'), 'utf-8'),
  );

  console.log('清空旧数据…');
  await prisma.$transaction([
    prisma.notification.deleteMany(),
    prisma.commentLike.deleteMany(),
    prisma.comment.deleteMany(),
    prisma.favorite.deleteMany(),
    prisma.team.deleteMany(),
    prisma.correctionReport.deleteMany(),
    prisma.crawlRevision.deleteMany(),
    prisma.competitionMaterial.deleteMany(),
    prisma.competitionAward.deleteMany(),
    prisma.competitionTimeline.deleteMany(),
    prisma.competitionTag.deleteMany(),
    prisma.competitionLevel.deleteMany(),
    prisma.crawlAnomaly.deleteMany(),
    prisma.competition.deleteMany(),
    prisma.userSkill.deleteMany(),
    prisma.banRecord.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  console.log('写入用户…');
  const users: Record<string, string> = {};
  for (const u of DEMO_USERS) {
    const created = await prisma.user.create({
      data: {
        email: u.email,
        studentNo: u.studentNo,
        nickname: u.nickname,
        college: u.college,
        grade: u.grade,
        major: u.major,
        role: u.role ?? 'STUDENT',
        passwordHash: u.password ? hashPassword(u.password) : null,
        skills: { create: u.skills.map(([skill, level]) => ({ skill, level })) },
      },
    });
    users[u.nickname] = created.id;
  }

  console.log('写入竞赛清单（56 项认定 + 3 项追加）…');
  const compIds: Record<string, string> = {};

  // 1) 认定清单基础条目
  for (const name of bonusFile.competitions) {
    const enriched = ENRICHED[name];
    const comp = await prisma.competition.create({
      data: {
        name,
        aliases: enriched?.aliases ?? [],
        organizer: enriched?.organizer,
        officialUrl: enriched?.officialUrl,
        format: enriched?.format,
        teamSizeMin: enriched?.teamSize?.[0],
        teamSizeMax: enriched?.teamSize?.[1],
        audience: enriched?.audience,
        difficulty: enriched?.difficulty,
        effort: enriched?.effort,
        intro: enriched?.intro,
        isBonusEligible: true,
        bonusCategory: bonusFile.standard.category,
        bonusPoints: bonusStandard,
        sourceUrl: '校教〔2026〕39号《关于开展推荐2027届优秀应届本科毕业生免试攻读研究生工作的通知》',
        levels: { create: (enriched?.levels ?? [Level.NATIONAL, Level.PROVINCIAL]).map((level) => ({ level })) },
        tags: { create: (enriched?.tags ?? ['学科竞赛']).map((tag) => ({ tag })) },
        timelines: enriched?.timelines
          ? { create: enriched.timelines.map((t) => ({ stage: t.stage, level: t.level, startAt: t.startAt, endAt: t.endAt })) }
          : undefined,
      },
    });
    compIds[name] = comp.id;
  }

  // 2) 追加竞赛（非认定，用于空态展示与校级入口）
  for (const e of EXTRA_COMPETITIONS) {
    const comp = await prisma.competition.create({
      data: {
        name: e.name,
        aliases: e.aliases ?? [],
        difficulty: e.difficulty,
        effort: e.effort,
        format: e.format,
        intro: e.intro,
        isBonusEligible: e.isBonusEligible,
        levels: { create: e.levels.map((level) => ({ level })) },
        tags: { create: e.tags.map((tag) => ({ tag })) },
        timelines: e.timelines
          ? { create: e.timelines.map((t) => ({ stage: t.stage, level: t.level, startAt: t.startAt, endAt: t.endAt })) }
          : undefined,
      },
    });
    compIds[e.name] = comp.id;
  }

  console.log('写入获奖记录…');
  const elecId = compIds['全国大学生电子设计竞赛'];
  const icpcId = compIds['ACM-ICPC 国际大学生程序设计竞赛'];
  await prisma.competitionAward.createMany({
    data: [
      {
        competitionId: elecId,
        year: 2025,
        awardName: '全国一等奖',
        teamName: '成电一队',
        members: ['陈软硬件都会', '李建模', '张算法'],
      },
      {
        competitionId: elecId,
        year: 2025,
        awardName: '全国二等奖',
        teamName: '格院联队',
        members: ['赵一', '钱二', '孙三'],
      },
      {
        competitionId: icpcId,
        year: 2025,
        awardName: '亚洲区域赛银牌',
        teamName: 'UESTC_Astral',
        members: ['张算法', '周四', '吴五'],
      },
    ],
  });

  console.log('写入招募帖…');
  const ddl = (s: string) => new Date(s);
  const teamIds: Record<string, string> = {};

  const teamsData = [
    {
      competitionName: '全国大学生电子设计竞赛',
      leaderNick: '陈软硬件都会',
      goal: TeamGoal.PRIZE,
      neededRoles: [RoleType.HARDWARE, RoleType.PAPER],
      requirement: '缺硬件和论文队友。有 STM32 开发经验优先，每周能到实验室 3 次以上，目标省一冲国奖。',
      contact: 'QQ 2451109901（备注：电赛组队）',
      deadline: ddl('2026-10-20T16:00:00Z'),
      targetSize: 4,
      members: [
        { grade: 2024, college: '信息与通信工程学院', major: '电子信息工程', rank: '前 10%', intro: '陈同学（队长），软硬件都会，负责整体方案与嵌入式开发。' },
        { grade: 2024, college: '自动化工程学院', major: '自动化', rank: '前 15%', intro: '刘同学，负责建模与仿真，熟悉 MATLAB。' },
      ],
      status: TeamStatus.RECRUITING,
    },
    {
      competitionName: '全国大学生数学建模竞赛',
      leaderNick: '李建模',
      goal: TeamGoal.NATIONAL_FIRST,
      neededRoles: [RoleType.ALGORITHM],
      requirement: '三人队还缺一名编程手（Python/MATLAB 均可），最好有数值算法功底，赛前一起刷真题。',
      contact: '微信 ljianmo2024',
      deadline: ddl('2027-09-03T16:00:00Z'),
      targetSize: 3,
      members: [
        { grade: 2024, college: '数学科学学院', major: '数学与应用数学', rank: '前 5%', intro: '李同学（队长），建模与论文写作。' },
      ],
      status: TeamStatus.RECRUITING,
    },
    {
      competitionName: 'ACM-ICPC 国际大学生程序设计竞赛',
      leaderNick: '张算法',
      goal: TeamGoal.PRACTICE,
      neededRoles: [RoleType.ALGORITHM, RoleType.OTHER],
      requirement: '招一名能稳定出的队友，Codeforces 1600+ 优先，一起备战济南区域赛。',
      contact: 'QQ 1133246670',
      deadline: ddl('2026-09-30T16:00:00Z'),
      targetSize: 3,
      members: [
        { grade: 2023, college: '计算机科学与工程学院', major: '计算机科学与技术', rank: '前 3%', intro: '张同学（队长），CF 1900，主写代码。' },
      ],
      status: TeamStatus.RECRUITING,
    },
    {
      competitionName: '中国国际大学生创新大赛',
      leaderNick: '王前端',
      goal: TeamGoal.BONUS_ONLY,
      neededRoles: [RoleType.DEFENSE, RoleType.PAPER],
      requirement: '已有完整项目（AI+医疗方向），缺路演和商业计划书撰写队友，加分为主、拿奖随缘。',
      contact: '微信 wangfd_uestc',
      deadline: ddl('2026-09-28T16:00:00Z'),
      targetSize: 5,
      members: [
        { grade: 2025, college: '信息与软件工程学院', major: '软件工程', rank: '前 20%', intro: '王同学（队长），负责前端与产品演示。' },
        { grade: 2024, college: '信息与软件工程学院', major: '软件工程', rank: null, intro: '郑同学，负责后端开发。' },
      ],
      status: TeamStatus.RECRUITING,
    },
    {
      competitionName: '全国大学生机器人大赛（CURC）',
      leaderNick: '雷达站长',
      goal: TeamGoal.PRACTICE,
      neededRoles: [RoleType.HARDWARE, RoleType.ALGORITHM, RoleType.FRONTEND],
      requirement: '机器人队秋季招新，机械/电控/视觉三个方向都要人，氛围好、经费足。',
      contact: 'QQ 986312504（机器人队招新群）',
      deadline: ddl('2026-10-15T16:00:00Z'),
      targetSize: 8,
      members: [
        { grade: 2024, college: '信息与通信工程学院', major: '信息工程', rank: '前 10%', intro: '雷达站长（队长），负责组织与电控。' },
        { grade: 2023, college: '机械与电气工程学院', major: '机械设计制造及其自动化', rank: '前 20%', intro: '冯同学，负责机械结构设计。' },
      ],
      status: TeamStatus.RECRUITING,
    },
  ];

  for (const t of teamsData) {
    const team = await prisma.team.create({
      data: {
        competitionId: compIds[t.competitionName],
        leaderId: users[t.leaderNick],
        goal: t.goal,
        neededRoles: t.neededRoles,
        requirement: t.requirement,
        contact: t.contact,
        deadline: t.deadline,
        targetSize: t.targetSize,
        status: t.status,
        members: { create: t.members },
      },
    });
    teamIds[t.leaderNick] = team.id;
  }

  console.log('写入留言与关注…');
  await prisma.comment.createMany({
    data: [
      {
        authorId: users['张算法'],
        targetType: 'COMPETITION',
        targetId: elecId,
        content: '校选赛题目偏基础，认真准备稳过。实验室常开但冬冷夏热，自备外套。',
      },
      {
        authorId: users['李建模'],
        targetType: 'COMPETITION',
        targetId: compIds['全国大学生数学建模竞赛'],
        content: '想找队友的可以直接去组队区看看，A 题一般偏物理，B 题偏离散优化。',
      },
      // 招募帖下的评论区（广告牌模式：感兴趣直接留言 + 加联系方式）
      {
        authorId: users['李建模'],
        targetType: 'TEAM',
        targetId: teamIds['陈软硬件都会'],
        content: '我对论文方向很感兴趣，之前拿过校模赛一等奖，可以投简历看看吗？',
        likes: 2,
      },
      {
        authorId: users['王前端'],
        targetType: 'TEAM',
        targetId: teamIds['陈软硬件都会'],
        content: '帮顶！这个队靠谱。',
        likes: 1,
      },
    ],
  });
  const elecTeamComment = await prisma.comment.findFirst({
    where: { targetType: 'TEAM', targetId: teamIds['陈软硬件都会'], authorId: users['李建模'] },
  });
  if (elecTeamComment) {
    await prisma.commentLike.createMany({
      data: [
        { userId: users['张算法'], commentId: elecTeamComment.id },
        { userId: users['雷达站长'], commentId: elecTeamComment.id },
      ],
    });
  }
  await prisma.favorite.create({
    data: { userId: users['雷达站长'], targetType: 'COMPETITION', targetId: elecId },
  });

  // 系统公告 + 全员系统通知（消息中心可见，横幅只在首页弹一次）
  if ((await prisma.announcement.count()) === 0) {
    const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const ann = await prisma.announcement.create({
      data: {
        title: '欢迎来到 UESTC TeamUp',
        content: '校内竞赛信息与组队平台试运行中，遇到问题请通过留言或举报反馈。',
        createdBy: admin!.id,
      },
    });
    const allUsers = await prisma.user.findMany({ select: { id: true } });
    await prisma.notification.createMany({
      data: allUsers.map((u) => ({
        userId: u.id,
        kind: 'SYSTEM_NOTIFICATION' as const,
        payload: { announcementId: ann.id, title: ann.title, content: ann.content },
      })),
    });
  }

  const counts = {
    competitions: await prisma.competition.count(),
    bonusEligible: await prisma.competition.count({ where: { isBonusEligible: true } }),
    teams: await prisma.team.count(),
    users: await prisma.user.count(),
    timelines: await prisma.competitionTimeline.count(),
  };
  console.log('种子完成：', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
