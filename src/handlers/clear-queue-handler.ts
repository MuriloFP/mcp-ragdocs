import { BaseHandler } from './base-handler.js';
import fs from 'fs/promises';
import path from 'path';

const QUEUE_FILE = path.join(process.cwd(), 'queue.txt');

export class ClearQueueHandler extends BaseHandler {
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
              text: 'Queue is already empty (queue file does not exist)',
            },
          ],
        };
      }

      // Read current queue to get count of URLs being cleared
      const content = await fs.readFile(QUEUE_FILE, 'utf-8');
      const urlCount = content.split('\n').filter(url => url.trim() !== '').length;

      // Clear the queue by emptying the file
      await fs.writeFile(QUEUE_FILE, '');

      return {
        content: [
          {
            type: 'text',
            text: `Queue cleared successfully. Removed ${urlCount} URL${urlCount === 1 ? '' : 's'} from the queue.`,
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }
} 