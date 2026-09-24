import { ParseStrategy, Prisma, SourceKind } from '@prisma/client';

export const CRAWLER_PRESETS: Prisma.CrawlSourceCreateManyInput[] = [
  {
    name: '电子科技大学竞赛管理系统-通知公告',
    url: 'https://xkjs.uestc.edu.cn/prod-api/home/news/page?pageNum=1&pageSize=20&topicId=10000',
    kind: SourceKind.ACADEMIC_AFFAIRS,
    cron: '0 15 */6 * * *',
    parseStrategy: ParseStrategy.JSON_API,
    enabled: true,
    selectorConf: {
      itemsPath: 'data.records',
      titlePath: 'title',
      urlPath: 'urlLink',
      publishTimePath: 'publishTime',
      contentPath: 'content',
      externalIdPath: 'newsId',
      defaultUrl: 'https://xkjs.uestc.edu.cn/home/homepage',
    } as Prisma.InputJsonValue,
  },
  {
    name: '电子科技大学竞赛管理系统-竞赛动态',
    url: 'https://xkjs.uestc.edu.cn/prod-api/home/notice/list?pageNum=1&pageSize=20&status=',
    kind: SourceKind.COMPETITION_SITE,
    cron: '0 30 */6 * * *',
    parseStrategy: ParseStrategy.JSON_API,
    enabled: true,
    selectorConf: {
      itemsPath: 'data.records',
      titlePath: 'name',
      publishTimePath: 'publishTime',
      externalIdPath: 'competitionId',
      defaultUrl: 'https://xkjs.uestc.edu.cn/home/homepage',
    } as Prisma.InputJsonValue,
  },
  {
    name: '电子科技大学研究生院-竞赛实践',
    url: 'https://gr.uestc.edu.cn/jiuye/152',
    kind: SourceKind.COLLEGE,
    cron: '0 45 */6 * * *',
    parseStrategy: ParseStrategy.CSS,
    enabled: true,
    selectorConf: {
      itemSelector: '.topic_item',
      titleSelector: '.title a',
      linkSelector: '.title a',
      publishTimeSelector: '.time',
      contentSelector: '.content',
      detailTitleSelector: '.topic_detail_header .title, .title',
      detailContentSelector: '.content',
    } as Prisma.InputJsonValue,
  },
];
