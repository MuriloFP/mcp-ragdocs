import { BaseHandler } from './base-handler.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { AddUrlDocumentationHandler } from './add-url-documentation-handler.js';
import { AddLocalDocumentationHandler } from './add-local-documentation-handler.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const QUEUE_FILE = 'queue.txt';
const PROCESSING_FILE = 'processing.txt';

interface ProcessResult {
  item: string;
  success: boolean;
  error?: string;
  attempts: number;
}

interface QueueStats {
  completed: number;
  failed: number;
  errors: Array<{
    item: string;
    error: string;
    attempts: number;
  }>;
  startTime: number;
}

export class RunQueueHandler extends BaseHandler {
  private urlHandler: AddUrlDocumentationHandler;
  private localHandler: AddLocalDocumentationHandler;

  constructor(context: any) {
    super(context);
    this.urlHandler = new AddUrlDocumentationHandler(context);
    this.localHandler = new AddLocalDocumentationHandler(context);
  }

  private isWebUrl(str: string): boolean {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async processItem(item: string, retryAttempts: number, retryDelay: number): Promise<ProcessResult> {
    let lastError: Error | undefined;
    let attempts = 0;

    while (attempts < retryAttempts) {
      attempts++;
      try {
        if (this.isWebUrl(item)) {
          await this.urlHandler.handle({ url: item });
        } else {
          // For local files, first verify they exist
          try {
            await fs.access(item);
            await this.localHandler.handle({ path: item });
          } catch (error) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `File not accessible: ${item} - ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        return { item, success: true, attempts };
      } catch (error) {
        lastError = error as Error;
        console.error(`Attempt ${attempts} failed for ${item}:`, error);
        if (attempts < retryAttempts) {
          await this.delay(retryDelay);
        }
      }
    }

    return {
      item,
      success: false,
      error: String(lastError?.message || 'Unknown error'),
      attempts
    };
  }

  private async processBatch(items: string[], retryAttempts: number, retryDelay: number): Promise<ProcessResult[]> {
    return Promise.all(
      items.map(item => this.processItem(item, retryAttempts, retryDelay))
    );
  }

  private async updateProcessingItems(items: string[]): Promise<void> {
    await fs.writeFile(PROCESSING_FILE, items.join('\n'));
  }

  private async removeFromProcessing(items: string[]): Promise<void> {
    try {
      const processing = await fs.readFile(PROCESSING_FILE, 'utf-8');
      const currentItems = processing.split('\n').filter(Boolean);
      const remainingItems = currentItems.filter(item => !items.includes(item));
      
      if (remainingItems.length > 0) {
        await fs.writeFile(PROCESSING_FILE, remainingItems.join('\n'));
      } else {
        await fs.unlink(PROCESSING_FILE);
      }
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private formatResults(stats: QueueStats): string {
    const endTime = Date.now();
    const duration = endTime - stats.startTime;
    const minutes = Math.floor(duration / 60000);
    const seconds = ((duration % 60000) / 1000).toFixed(0);
    
    const lines = [
      `⏱️ Processing completed in: ${minutes}m ${seconds}s`,
      `✅ Successfully processed: ${stats.completed}`,
      `❌ Failed: ${stats.failed}`
    ];

    if (stats.errors.length > 0) {
      lines.push('', '📋 Failed items:');
      stats.errors.forEach(result => {
        lines.push(`  • ${result.item}`);
        lines.push(`    (${result.attempts} attempts: ${result.error})`);
      });
    }

    return lines.join('\n');
  }

  async handle(args: Record<string, unknown>) {
    try {
      const maxConcurrent = Math.min(Number(args.maxConcurrent) || 3, 5);
      const retryAttempts = Math.min(Number(args.retryAttempts) || 3, 5);
      const retryDelay = Math.min(Number(args.retryDelay) || 1000, 10000);

      const stats: QueueStats = {
        completed: 0,
        failed: 0,
        errors: [],
        startTime: Date.now()
      };

      // Read queue file
      let queueContents: string;
      try {
        queueContents = await fs.readFile(QUEUE_FILE, 'utf-8');
      } catch (error) {
        throw new McpError(ErrorCode.InvalidRequest, 'Queue is empty');
      }

      let items = queueContents.split('\n').filter(Boolean);
      if (items.length === 0) {
        throw new McpError(ErrorCode.InvalidRequest, 'Queue is empty');
      }

      // Process items in batches
      while (items.length > 0) {
        const batch = items.slice(0, maxConcurrent);
        await this.updateProcessingItems(batch);

        console.log(`Processing batch of ${batch.length} items...`);
        const batchResults = await this.processBatch(batch, retryAttempts, retryDelay);
        
        // Update stats
        for (const result of batchResults) {
          if (result.success) {
            stats.completed++;
          } else {
            stats.failed++;
            stats.errors.push({
              item: result.item,
              error: result.error || 'Unknown error',
              attempts: result.attempts
            });
          }
        }

        // Remove processed items from queue and processing
        items = items.slice(maxConcurrent);
        await this.removeFromProcessing(batch);

        // Update queue file
        if (items.length > 0) {
          await fs.writeFile(QUEUE_FILE, items.join('\n'));
        } else {
          await fs.unlink(QUEUE_FILE);
        }
      }

      return {
        content: [{
          type: 'text',
          text: this.formatResults(stats)
        }]
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to process queue: ${(error as Error).message}`
      );
    }
  }
} 