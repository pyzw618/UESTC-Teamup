import assert from 'node:assert/strict';
import test from 'node:test';
import iconv from 'iconv-lite';
import { extractDateRange, extractTimelineStages } from '../src/modules/crawler/chinese-date.extractor';
import { decodeResponseBody } from '../src/modules/crawler/fetcher.service';
import { evaluateGuardRules } from '../src/modules/crawler/guard.service';
import {
  matchCompetition,
  normalizeTitle,
  textSimilarity,
} from '../src/modules/crawler/matcher.service';
import { isLockedTimelineChangeAllowed, mayReplaceByPriority } from '../src/modules/crawler/publisher.service';
import { OFFICIAL_COMPETITION_PRESETS } from '../src/modules/crawler/official-competition.presets';
import { CssParser } from '../src/modules/crawler/parser/css.parser';
import { JsonApiParser } from '../src/modules/crawler/parser/json-api.parser';
import { hashContent } from '../src/modules/crawler/differ.service';
import { filterUnseenCrawlItems } from '../src/modules/crawler/crawler.service';

test('fetcher decodes GBK using the HTTP charset', () => {
  const rawBody = iconv.encode('竞赛报名通知', 'gbk');
  const decoded = decodeResponseBody(rawBody, 'text/html; charset=gbk');

  assert.equal(decoded.charset, 'gbk');
  assert.equal(decoded.body, '竞赛报名通知');
});

test('fetcher detects GBK from an HTML meta charset', () => {
  const html = '<html><head><meta charset="gbk"></head><body>中文通知</body></html>';
  const rawBody = iconv.encode(html, 'gbk');
  const decoded = decodeResponseBody(rawBody);

  assert.equal(decoded.charset, 'gbk');
  assert.match(decoded.body, /中文通知/);
});

test('fetcher defaults to UTF-8 when no charset is declared', () => {
  const rawBody = Buffer.from('竞赛通知', 'utf8');
  const decoded = decodeResponseBody(rawBody);

  assert.equal(decoded.charset, 'utf-8');
  assert.equal(decoded.body, '竞赛通知');
});

test('date extractor infers a nearby year from publishTime', () => {
  const publishTime = new Date('2025-11-20T08:00:00.000Z');
  const range = extractDateRange('报名时间：12月1日至12月8日', publishTime);

  assert.equal(range.startAt?.toISOString(), '2025-12-01T00:00:00.000Z');
  assert.equal(range.endAt?.toISOString(), '2025-12-08T00:00:00.000Z');
});

test('date extractor handles year rollover in an explicit date range', () => {
  const range = extractDateRange(
    '报名时间：2025年12月20日至1月10日',
    new Date('2025-12-15T00:00:00.000Z'),
  );

  assert.equal(range.startAt?.toISOString(), '2025-12-20T00:00:00.000Z');
  assert.equal(range.endAt?.toISOString(), '2026-01-10T00:00:00.000Z');
});

test('date extractor leaves fuzzy date ranges empty instead of inventing dates', () => {
  const range = extractDateRange('报名时间：4月上旬至4月中旬', new Date('2025-03-01T00:00:00.000Z'));

  assert.equal(range.startAt, null);
  assert.equal(range.endAt, null);
});

test('date extractor recognizes competition stages', () => {
  const stages = extractTimelineStages(
    '报名：2026年3月1日至3月15日\n初赛：4月2日\n决赛：5月8日',
    new Date('2026-02-01T00:00:00.000Z'),
  );

  assert.deepEqual(
    stages.map((stage) => stage.stage),
    ['报名', '初赛', '决赛'],
  );
  assert.equal(stages[0]?.startAt?.toISOString(), '2026-03-01T00:00:00.000Z');
  assert.equal(stages[1]?.startAt?.toISOString(), '2026-04-02T00:00:00.000Z');
});

test('title normalization removes years, editions, and announcement noise', () => {
  const cleaned = normalizeTitle('关于2024年第五届中国大学生竞赛报名通知');

  assert.equal(cleaned, '中国大学生竞赛');
});

test('matcher uses normalized names, aliases, and text similarity', () => {
  const candidates = [
    {
      id: 'competition-1',
      name: '中国大学生电子设计竞赛',
      aliases: ['电赛'],
    },
  ];

  assert.equal(
    matchCompetition('2025年第五届中国大学生电子设计竞赛通知', candidates).competitionId,
    'competition-1',
  );
  assert.equal(matchCompetition('电赛', candidates).matchedBy, 'alias');
  assert.ok(textSimilarity('中国大学生电子设计竞赛', '中国大学生电子设计竞赛报名通知') > 0.7);
  assert.equal(matchCompetition('全新竞赛', candidates).action, 'CREATE_DRAFT');
});

test('guard blocks epoch dates, large jumps, reversed intervals, and null overwrites', () => {
  const now = new Date('2025-06-01T00:00:00.000Z');
  const violations = evaluateGuardRules(
    {
      startAt: new Date('2025-06-01T00:00:00.000Z'),
      endAt: new Date('2025-06-10T00:00:00.000Z'),
      organizer: '原主办方',
    },
    {
      startAt: new Date('1970-01-01T00:00:00.000Z'),
      organizer: null,
    },
    now,
  );

  const rules = new Set(violations.map((violation) => violation.rule));
  assert.ok(rules.has('epoch-date'));
  assert.ok(rules.has('date-out-of-range'));
  assert.ok(rules.has('null-overwrite'));

  // Test reversed dates (end before start)
  const reversedViolations = evaluateGuardRules(
    {},
    {
      startAt: new Date('2025-06-15T00:00:00.000Z'),
      endAt: new Date('2025-06-10T00:00:00.000Z'),
    },
    now,
  );
  assert.ok(reversedViolations.some((v) => v.rule === 'end-before-start'));

  const jumpViolations = evaluateGuardRules(
    { startAt: new Date('2025-06-01T00:00:00.000Z') },
    { startAt: new Date('2025-12-01T00:00:00.000Z') },
    now,
  );
  assert.ok(jumpViolations.some((violation) => violation.rule === 'jump-too-large'));
});

test('locked timeline nodes are never eligible for crawler updates', () => {
  const existing = {
    isLocked: true,
    startAt: new Date('2025-06-01T00:00:00.000Z'),
    endAt: new Date('2025-06-10T00:00:00.000Z'),
  };

  assert.equal(
    isLockedTimelineChangeAllowed(existing, {
      stage: '报名',
      startAt: new Date('2025-06-02T00:00:00.000Z'),
      endAt: existing.endAt,
    }),
    false,
  );
  assert.equal(
    isLockedTimelineChangeAllowed(existing, {
      stage: '报名',
      startAt: existing.startAt,
      endAt: existing.endAt,
    }),
    true,
  );
});

test('source priority protects aggregate and manual values while filling gaps', () => {
  assert.equal(mayReplaceByPriority('成电校内通知', 2, { origin: 'CRAWL', source: { priority: 1 } }), false);
  assert.equal(mayReplaceByPriority('官网旧通知', 1, { origin: 'CRAWL', source: { priority: 2 } }), true);
  assert.equal(mayReplaceByPriority('人工修订', 1, { origin: 'MANUAL', source: null }), false);
  assert.equal(mayReplaceByPriority(null, 2), true);
  assert.equal(mayReplaceByPriority('历史自动时间', 2, undefined, true), true);
});

test('official site catalog keeps unsupported sites disabled', () => {
  assert.equal(OFFICIAL_COMPETITION_PRESETS.length, 56);
  assert.ok(OFFICIAL_COMPETITION_PRESETS.every((source) => source.priority === 2));
  assert.ok(OFFICIAL_COMPETITION_PRESETS.some((source) => source.enabled));
  assert.ok(OFFICIAL_COMPETITION_PRESETS.some((source) => !source.enabled));
});

test('verified second-level official lists are enabled without reviving stale sites', () => {
  const byCatalogId = (catalogId: number) => OFFICIAL_COMPETITION_PRESETS.find((source) =>
    (source.selectorConf as Record<string, unknown>).catalogId === catalogId);
  for (const id of [19, 26, 27, 30, 31, 40, 42, 50]) {
    const source = byCatalogId(id);
    assert.equal(source?.enabled, true, `catalog #${id} should be enabled`);
    assert.equal((source?.selectorConf as Record<string, unknown>).maxItems, undefined);
  }
  assert.match(byCatalogId(19)?.url ?? '', /\/Competition\/Index/);
  assert.match(byCatalogId(31)?.url ?? '', /\/newss\.html/);
  assert.match(byCatalogId(50)?.url ?? '', /\/inform\?value=2/);
  for (const id of [5, 17, 29, 56]) {
    assert.equal(byCatalogId(id)?.enabled, false, `catalog #${id} needs further review`);
  }
});

test('official CSS parser keeps only matching article links', () => {
  const parser = new CssParser();
  const html = '<a href="#">大赛首页</a><a href="/news/123">第十八届全国大学生数学竞赛通知</a><a href="/news/124">其他公告</a>';
  const items = parser.parseList({
    url: 'https://www.cmathc.org.cn/', status: 200, headers: {}, charset: 'utf-8',
    body: html, rawBody: Buffer.from(html), fetchedAt: new Date('2026-09-27'),
  }, {
    url: 'https://www.cmathc.org.cn/', selectorConf: {
      itemSelector: 'a[href]', titleSelector: 'a', linkSelector: 'a',
      titlePattern: '数学竞赛', linkPattern: '/news/', maxItems: 1,
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.link, 'https://www.cmathc.org.cn/news/123');
});

test('official CSS parser selects the newest notice after pinned older items', () => {
  const parser = new CssParser();
  const html = '<a href="/details?id=old">置顶 嵌入式大赛报名通知 2026-02-10</a>' +
    '<a href="/details?id=new">嵌入式大赛决赛通知 2026-08-24</a>';
  const items = parser.parseList({
    url: 'https://example.org/notices', status: 200, headers: {}, charset: 'utf-8',
    body: html, rawBody: Buffer.from(html), fetchedAt: new Date('2026-09-27'),
  }, {
    url: 'https://example.org/notices', selectorConf: {
      itemSelector: 'a[href]', titleSelector: 'a', linkSelector: 'a',
      titlePattern: '嵌入式', publishTimeFromItemText: true, sortByPublishTime: true,
    },
  });
  assert.equal(items.length, 2);
  assert.equal(items[0]?.link, 'https://example.org/details?id=new');
  assert.equal(items[1]?.link, 'https://example.org/details?id=old');
});

test('one crawl processes every unseen page item, using external IDs when links are shared', () => {
  const candidates = [
    { title: '旧公告', link: 'https://example.org/', externalId: '101' },
    { title: '新公告一', link: 'https://example.org/', externalId: '102' },
    { title: '新公告二', link: 'https://example.org/', externalId: '103' },
    { title: '新公告二重复展示', link: 'https://example.org/', externalId: '103' },
    { title: '新网页公告', link: 'https://example.org/news/4' },
  ];
  const previous = [
    { link: 'https://example.org/', externalId: '101', processed: true },
    { link: 'https://example.org/', externalId: '102', processed: false },
  ];
  assert.deepEqual(filterUnseenCrawlItems(candidates, previous).map((item) => item.title),
    ['新公告一', '新公告二', '新网页公告']);
});

test('CssParser parses UESTC graduate school SSR html correctly', () => {
  const parser = new CssParser();
  const html = `
    <div class="topic_item">
      <div class="title"><a href="/jiuye/152/14817">第五届中国研究生网络安全创新大赛校内赛报名通知</a></div>
      <div class="time">2026年09月10日</div>
    </div>
  `;
  const items = parser.parseList(
    {
      url: 'https://gr.uestc.edu.cn/jiuye/152',
      status: 200,
      headers: {},
      charset: 'utf-8',
      body: html,
      rawBody: Buffer.from(html),
      fetchedAt: new Date('2026-09-11T00:00:00.000Z'),
    },
    {
      url: 'https://gr.uestc.edu.cn/jiuye/152',
      selectorConf: {
        itemSelector: '.topic_item',
        titleSelector: '.title a',
        linkSelector: '.title a',
        publishTimeSelector: '.time',
      },
    },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, '第五届中国研究生网络安全创新大赛校内赛报名通知');
  assert.equal(items[0]?.link, 'https://gr.uestc.edu.cn/jiuye/152/14817');
  assert.equal(items[0]?.publishTime?.toISOString(), '2026-09-10T00:00:00.000Z');
});

test('JsonApiParser parses xkjs news JSON API correctly', () => {
  const parser = new JsonApiParser();
  const json = JSON.stringify({
    code: 0,
    msg: 'success',
    data: {
      records: [
        {
          newsId: 10143,
          title: '关于第三届“中国电子杯”高校 ICT 产教融合创新大赛报名的通知',
          content: '<p>报名截止：2026年10月15日</p><p>初赛时间：2026年10月25日前</p>',
          publishTime: '2026-09-22 15:47:13',
          urlLink: '',
        },
      ],
    },
  });

  const items = parser.parseList(
    {
      url: 'https://xkjs.uestc.edu.cn/prod-api/home/news/page',
      status: 200,
      headers: {},
      charset: 'utf-8',
      body: json,
      rawBody: Buffer.from(json),
      fetchedAt: new Date('2026-09-23T00:00:00.000Z'),
    },
    {
      url: 'https://xkjs.uestc.edu.cn/prod-api/home/news/page',
      selectorConf: {
        itemsPath: 'data.records',
        titlePath: 'title',
        urlPath: 'urlLink',
        publishTimePath: 'publishTime',
        contentPath: 'content',
        externalIdPath: 'newsId',
        defaultUrl: 'https://xkjs.uestc.edu.cn/home/homepage',
      },
    },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, '关于第三届“中国电子杯”高校 ICT 产教融合创新大赛报名的通知');
  assert.equal(items[0]?.link, 'https://xkjs.uestc.edu.cn/home/homepage');
  assert.ok(items[0]?.stages?.some((s) => s.stage === '报名' && s.startAt !== null));
});

test('DifferService hashContent creates stable sha256 hashes', () => {
  const hash1 = hashContent('test content');
  const hash2 = hashContent('test content');
  const hash3 = hashContent('different content');

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
});
