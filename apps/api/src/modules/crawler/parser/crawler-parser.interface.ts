import type { CrawlParsedItem, FetchResult, ParserSource } from '../crawler.types';

export interface CrawlerParser {
  parseList(result: FetchResult, source: ParserSource): CrawlParsedItem[];
  parseDetail(result: FetchResult, source: ParserSource): CrawlParsedItem;
}
