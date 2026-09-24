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
import { isLockedTimelineChangeAllowed } from '../src/modules/crawler/publisher.service';
import { CssParser } from '../src/modules/crawler/parser/css.parser';
import { JsonApiParser } from '../src/modules/crawler/parser/json-api.parser';
import { hashContent } from '../src/modules/crawler/differ.service';

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
