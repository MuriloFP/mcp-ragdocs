import { BaseHandler } from './base-handler.js';
import fs from 'fs/promises';
import path from 'path';

const QUEUE_FILE = path.join(process.cwd(), 'queue.txt');

export class ListQueueHandler extends BaseHandler {
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

      // Read queue file
      const content = await fs.readFile(QUEUE_FILE, 'utf-8');
      const items = content.split('\n').filter(item => item.trim() !== '');

      if (items.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Queue is empty',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `📋 Queue contains ${items.length} item${items.length !== 1 ? 's' : ''}:\n${items.map(item => `  • ${item}`).join('\n')}`,
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }
} 