import { BaseHandler } from './base-handler.js';
import fs from 'fs/promises';
import path from 'path';
import { AddUrlDocumentationHandler } from './add-url-documentation-handler.js';

const QUEUE_FILE = path.join(process.cwd(), 'queue.txt');

export class RunQueueHandler extends BaseHandler {
  private addDocHandler: AddUrlDocumentationHandler;

  constructor(context: any) {
    super(context);
    this.addDocHandler = new AddUrlDocumentationHandler(context);
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
      const failedUrls: string[] = [];

      while (true) {
        // Read current queue
        const content = await fs.readFile(QUEUE_FILE, 'utf-8');
        const urls = content.split('\n').filter(url => url.trim() !== '');

        if (urls.length === 0) {
          break; // Queue is empty
        }

        const currentUrl = urls[0]; // Get first URL
        
        try {
          // Process the URL using add_documentation handler
          await this.addDocHandler.handle({ url: currentUrl });
          processedCount++;
        } catch (error) {
          failedCount++;
          failedUrls.push(currentUrl);
          console.error(`Failed to process URL ${currentUrl}:`, error);
        }

        // Remove the processed URL from queue
        const remainingUrls = urls.slice(1);
        await fs.writeFile(QUEUE_FILE, remainingUrls.join('\n') + (remainingUrls.length > 0 ? '\n' : ''));
      }

      let resultText = `Queue processing complete.\nProcessed: ${processedCount} URLs\nFailed: ${failedCount} URLs`;
      if (failedUrls.length > 0) {
        resultText += `\n\nFailed URLs:\n${failedUrls.join('\n')}`;
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