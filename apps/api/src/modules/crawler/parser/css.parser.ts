import { Injectable } from '@nestjs/common';
import { load } from 'cheerio';
import {
  extractFirstExplicitDate,
  extractTimelineStages,
} from '../chinese-date.extractor';
import type {
  CrawlParsedItem,
  CssParserConfig,
  FetchResult,
  ParserConfig,
  ParserSource,
} from '../crawler.types';
import type { CrawlerParser } from './crawler-parser.interface';

const DEFAULT_ITEM_SELECTOR = 'article, .news-list li, .list li, .content li, .topic_item';
const DEFAULT_TITLE_SELECTOR = 'a[title], .title a, .title, h1, h2, h3, a';
const DEFAULT_LINK_SELECTOR = 'a[href]';
const DEFAULT_TIME_SELECTOR = 'time, .date, .time, .publish-time';
const DEFAULT_CONTENT_SELECTOR = 'article, .article, .content, .detail, .news-content, .topic_content';

function asConfig(value: unknown): CssParserConfig {
  return value && typeof value === 'object' ? (value as ParserConfig as CssParserConfig) : {};
}

function absoluteHttpUrl(value: string, baseUrl: string): string | null {
  try {
    const resolved = new URL(value.trim(), baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

@Injectable()
export class CssParser implements CrawlerParser {
  parseList(result: FetchResult, source: ParserSource): CrawlParsedItem[] {
    const config = asConfig(source.selectorConf);
    const $ = load(result.body);
    const itemSelector = config.itemSelector ?? DEFAULT_ITEM_SELECTOR;
    const titleSelector = config.titleSelector ?? DEFAULT_TITLE_SELECTOR;
    const linkSelector = config.linkSelector ?? DEFAULT_LINK_SELECTOR;
    const timeSelector = config.publishTimeSelector ?? DEFAULT_TIME_SELECTOR;
    const contentSelector = config.contentSelector ?? '.summary, .description, .intro, .content';

    const items: CrawlParsedItem[] = [];

    $(itemSelector).each((_index, element) => {
      const el = $(element);
      const titleElement = el.find(titleSelector).first();
      const title = (titleElement.attr('title') ?? titleElement.text()).replace(/\s+/g, ' ').trim();

      const linkElement = titleElement.is('a[href]') ? titleElement : el.find(linkSelector).first();
      const href = linkElement.attr('href');
      const link = href ? absoluteHttpUrl(href, result.url || source.url) : null;
      if (!title || !link) return;

      const timeText = el.find(timeSelector).first().text().trim();
      const rawText = el.text().replace(/\s+/g, ' ').trim();
      const content = el.find(contentSelector).first().text().replace(/\s+/g, ' ').trim();
      const publishTime = timeText
        ? extractFirstExplicitDate(timeText, result.fetchedAt)
        : null;

      items.push({
        title,
        link,
        publishTime,
        rawText,
        content: content || null,
        stages: extractTimelineStages(`${title} ${rawText}`, publishTime),
      });
    });

    return items;
  }

  parseDetail(result: FetchResult, source: ParserSource): CrawlParsedItem {
    const config = asConfig(source.selectorConf);
    const $ = load(result.body);
    const titleSelector = config.detailTitleSelector ?? 'h1, .article-title, .topic_title, .title';
    const contentSelector = config.detailContentSelector ?? DEFAULT_CONTENT_SELECTOR;

    const title =
      $(titleSelector).first().text().replace(/\s+/g, ' ').trim() ||
      $('title').first().text().replace(/\s+/g, ' ').trim();
    const content = $(contentSelector).first().text().replace(/\s+/g, ' ').trim();
    const rawText = $('body').text().replace(/\s+/g, ' ').trim();

    return {
      title,
      link: result.url || source.url,
      content: content || null,
      rawText,
      publishTime: extractFirstExplicitDate(rawText, result.fetchedAt),
      stages: extractTimelineStages(`${title} ${content || rawText}`, result.fetchedAt),
    };
  }
}
