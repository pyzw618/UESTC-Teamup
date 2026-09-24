import { Injectable } from '@nestjs/common';
import iconv from 'iconv-lite';
import type { FetchResult } from './crawler.types';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const MIN_REQUEST_INTERVAL_MS = 3_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; UESTC-TeamUp-Crawler/1.0; +https://teamup.uestc.edu.cn)';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCharset(charset: string | undefined): string | null {
  if (!charset) return null;

  const value = charset.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  if (!value) return null;
  if (value === 'gb2312' || value === 'x-gbk' || value === 'gb_2312-80') return 'gbk';
  if (value === 'utf8') return 'utf-8';
  return value;
}

function charsetFromContentType(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = contentType.match(/charset\s*=\s*([^;\s]+)/i);
  return normalizeCharset(match?.[1]);
}

function charsetFromMeta(buffer: Buffer): string | null {
  // HTML charset declarations use ASCII-compatible bytes, so a Latin-1 preview is sufficient.
  const preview = iconv.decode(buffer.subarray(0, 8_192), 'latin1');
  const direct = preview.match(/<meta\b[^>]*\bcharset\s*=\s*["']?\s*([^"' />;]+)/i);
  if (direct?.[1]) return normalizeCharset(direct[1]);

  const contentType = preview.match(
    /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([^;"']+)/i,
  );
  return normalizeCharset(contentType?.[1]);
}

export function detectCharset(rawBody: Buffer, contentType?: string): string {
  if (rawBody.length >= 3 && rawBody[0] === 0xef && rawBody[1] === 0xbb && rawBody[2] === 0xbf) {
    return 'utf-8';
  }

  const fromHeader = charsetFromContentType(contentType);
  if (fromHeader && iconv.encodingExists(fromHeader)) return fromHeader;

  const fromMeta = charsetFromMeta(rawBody);
  if (fromMeta && iconv.encodingExists(fromMeta)) return fromMeta;

  return 'utf-8';
}

export function decodeResponseBody(rawBody: Buffer, contentType?: string): {
  body: string;
  charset: string;
} {
  const charset = detectCharset(rawBody, contentType);
  const usableCharset = iconv.encodingExists(charset) ? charset : 'utf-8';
  return { body: iconv.decode(rawBody, usableCharset), charset: usableCharset };
}

@Injectable()
export class FetcherService {
  private lastRequestStartedAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();

  async fetch(url: string): Promise<FetchResult> {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new Error(`Unsupported crawl URL protocol: ${parsedUrl.protocol}`);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        return await this.serializedRequest(async () => this.fetchOnce(parsedUrl.toString()));
      } catch (error) {
        lastError = error;
        if (attempt < MAX_RETRIES) await sleep(250 * (attempt + 1));
      }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to fetch crawl source');
  }

  private async fetchOnce(url: string): Promise<FetchResult> {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/json,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`Crawl request failed with HTTP ${response.status}: ${url}`);
    }

    const rawBody = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? undefined;
    const { body, charset } = decodeResponseBody(rawBody, contentType);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    return {
      url: response.url || url,
      status: response.status,
      headers,
      charset,
      body,
      rawBody,
      fetchedAt: new Date(),
    };
  }

  private async serializedRequest<T>(request: () => Promise<T>): Promise<T> {
    const previous = this.requestQueue;
    let release!: () => void;
    this.requestQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      const remaining = MIN_REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestStartedAt);
      if (this.lastRequestStartedAt > 0 && remaining > 0) await sleep(remaining);
      this.lastRequestStartedAt = Date.now();
      return await request();
    } finally {
      release();
    }
  }
}
