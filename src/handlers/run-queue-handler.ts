import { BaseHandler } from './base-handler.js';
import fs from 'fs/promises';
import path from 'path';
import { AddUrlDocumentationHandler } from './add-url-documentation-handler.js';
import { AddLocalDocumentationHandler } from './add-local-documentation-handler.js';

const QUEUE_FILE = path.join(process.cwd(), 'queue.txt');

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

  async handle(_args: Record<string, unknown>) {
    try {
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

      let processedCount = 0;
      let failedCount = 0;
      const failedItems: Array<{path: string; error: string}> = [];

      while (true) {
        // Read current queue
        const content = await fs.readFile(QUEUE_FILE, 'utf-8');
        const items = content.split('\n').filter(item => item.trim() !== '');

        if (items.length === 0) {
          break; // Queue is empty
        }

        const currentItem = items[0];
        
        try {
          // Determine if it's a web URL or local path
          if (this.isWebUrl(currentItem)) {
            await this.addUrlHandler.handle({ url: currentItem });
          } else {
            // Verify the local path exists
            try {
              await fs.access(currentItem);
              await this.addLocalHandler.handle({ path: currentItem });
            } catch (error) {
              throw new Error(`Local path does not exist or is not accessible: ${currentItem}`);
            }
          }
          processedCount++;
        } catch (error) {
          failedCount++;
          failedItems.push({
            path: currentItem,
            error: error instanceof Error ? error.message : String(error)
          });
          console.error(`Failed to process item ${currentItem}:`, error);
        }

        // Remove the processed item from queue
        const remainingItems = items.slice(1);
        await fs.writeFile(QUEUE_FILE, remainingItems.join('\n') + (remainingItems.length > 0 ? '\n' : ''));
      }

      let resultText = `Queue processing complete.\nProcessed: ${processedCount} items\nFailed: ${failedCount} items`;
      if (failedItems.length > 0) {
        resultText += `\n\nFailed items:\n${failedItems.map(item => `${item.path} (${item.error})`).join('\n')}`;
      }

      return {
        content: [
          {
            type: 'text',
            text: resultText,
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }
} 