import { BaseHandler } from './base-handler.js';
import fs from 'fs/promises';
import path from 'path';
import { AddUrlDocumentationHandler } from './add-url-documentation-handler.js';
import { AddLocalDocumentationHandler } from './add-local-documentation-handler.js';

const QUEUE_FILE = path.join(process.cwd(), 'queue.txt');

interface ProcessResult {
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
  private addUrlHandler: AddUrlDocumentationHandler;
  private addLocalHandler: AddLocalDocumentationHandler;

  constructor(context: any) {
    super(context);
    this.addUrlHandler = new AddUrlDocumentationHandler(context);
    this.addLocalHandler = new AddLocalDocumentationHandler(context);
  }

  private isWebUrl(str: string): boolean {
    try {
      const url = new URL(str);
      // Only consider it a web URL if it uses http/https protocol
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private formatResult(result: ProcessResult): string {
    const elapsed = Math.floor((Date.now() - result.startTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    
    let output = `⏱️ Total processing time: ${minutes}m ${seconds}s\n`;
    output += `✅ Completed: ${result.completed}\n`;
    output += `❌ Failed: ${result.failed}\n`;
    
    if (result.errors.length > 0) {
      output += '\n⚠️ Failed items:\n';
      output += result.errors.map(e => 
        `  • ${e.item} (${e.attempts} attempt${e.attempts !== 1 ? 's' : ''}): ${e.error}`
      ).join('\n');
    }

    return output;
  }

  async handle(args: Record<string, unknown>) {
    try {
      const maxConcurrent = Math.min(Number(args.maxConcurrent) || 3, 5);
      const retryAttempts = Math.min(Number(args.retryAttempts) || 3, 5);
      const retryDelay = Math.min(Number(args.retryDelay) || 1000, 10000);

      const result: ProcessResult = {
        completed: 0,
        failed: 0,
        errors: [],
        startTime: Date.now()
      };

      // Check if queue file exists
      try {
        await fs.access(QUEUE_FILE);
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: 'Queue is empty (queue file does not exist)',
            },
          ],
        };
      }

      while (true) {
        // Read current queue
        const content = await fs.readFile(QUEUE_FILE, 'utf-8');
        const items = content.split('\n').filter(item => item.trim() !== '');

        if (items.length === 0) {
          break; // Queue is empty
        }

        // Take up to maxConcurrent items
        const batch = items.slice(0, maxConcurrent);
        
        try {
          // Process items in parallel
          const batchResults = await Promise.all(
            batch.map(async item => {
              let lastError: Error | null = null;
              let attempts = 0;
              
              for (let attempt = 1; attempt <= retryAttempts; attempt++) {
                attempts = attempt;
                try {
                  if (this.isWebUrl(item)) {
                    await this.addUrlHandler.handle({ url: item });
                  } else {
                    await fs.access(item);
                    await this.addLocalHandler.handle({ path: item });
                  }
                  return { success: true, item };
                } catch (error) {
                  lastError = error as Error;
                  if (attempt < retryAttempts) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                  }
                }
              }
              
              return { 
                success: false, 
                item, 
                error: String(lastError?.message || 'Unknown error'),
                attempts: attempts || 1
              };
            })
          );

          // Update counts and track failures
          for (const batchResult of batchResults) {
            if (batchResult.success) {
              result.completed++;
            } else {
              result.failed++;
              result.errors.push({
                item: batchResult.item,
                error: batchResult.error || 'Unknown error',
                attempts: batchResult.attempts || 1
              });
            }
          }

          // Remove processed items from queue
          const remainingItems = items.slice(batch.length);
          await fs.writeFile(QUEUE_FILE, remainingItems.join('\n') + (remainingItems.length > 0 ? '\n' : ''));
        } catch (error) {
          throw error;
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: this.formatResult(result),
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }
} 