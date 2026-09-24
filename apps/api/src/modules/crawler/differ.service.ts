import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma.service';

export interface CrawlDifference {
  contentHash: string;
  changed: boolean;
  previousHash: string | null;
}

export function hashContent(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

@Injectable()
export class DifferService {
  constructor(private readonly prisma: PrismaService) {}

  async check(sourceId: string, content: string | Uint8Array): Promise<CrawlDifference> {
    const contentHash = hashContent(content);
    const latest = await this.prisma.crawlSnapshot.findFirst({
      where: { sourceId },
      orderBy: { fetchedAt: 'desc' },
      select: { contentHash: true },
    });

    return {
      contentHash,
      previousHash: latest?.contentHash ?? null,
      changed: latest?.contentHash !== contentHash,
    };
  }

  /**
   * Call only after parsing and processing succeeded. This prevents a malformed response
   * from being recorded as the latest snapshot and then skipped on the next run.
   */
  async storeSuccessful(sourceId: string, contentHash: string): Promise<void> {
    await this.prisma.crawlSnapshot.create({
      data: { sourceId, contentHash },
    });
  }
}
