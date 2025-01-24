import { BaseHandler } from './base-handler.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';

const QUEUE_FILE = path.join(process.cwd(), 'queue.txt');

interface RemoveResult {
  path: string;
  status: 'removed' | 'not_found' | 'case_mismatch';
  suggestion?: string;
}

export class RemoveFromQueueHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      const itemsToRemove = this.validateStringArray(args, 'paths');

      if (itemsToRemove.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'At least one path must be provided'
        );
      }

      // Check if queue file exists
      try {
        await fs.access(QUEUE_FILE);
      } catch {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Queue is empty (queue file does not exist)'
        );
      }

      // Read current queue
      const content = await fs.readFile(QUEUE_FILE, 'utf-8');
      const items = content.split('\n').filter(item => item.trim() !== '');
      const results: RemoveResult[] = [];
      const remainingItems = new Set(items);

      // Process each item to remove
      for (const itemToRemove of itemsToRemove) {
        // Try exact match first
        if (remainingItems.has(itemToRemove)) {
          remainingItems.delete(itemToRemove);
          results.push({ path: itemToRemove, status: 'removed' });
          continue;
        }

        // If not found, try case-insensitive match
        const caseInsensitiveMatch = Array.from(remainingItems).find(
          item => item.toLowerCase() === itemToRemove.toLowerCase()
        );

        if (caseInsensitiveMatch) {
          results.push({
            path: itemToRemove,
            status: 'case_mismatch',
            suggestion: caseInsensitiveMatch
          });
        } else {
          results.push({ path: itemToRemove, status: 'not_found' });
        }
      }

      // Write back to queue file if any items were removed
      const removedCount = results.filter(r => r.status === 'removed').length;
      if (removedCount > 0) {
        const newContent = Array.from(remainingItems);
        await fs.writeFile(QUEUE_FILE, newContent.join('\n') + (newContent.length > 0 ? '\n' : ''));
      }

      // Generate detailed response message
      let resultText = '';
      
      // Successful removals
      const removed = results.filter(r => r.status === 'removed');
      if (removed.length > 0) {
        resultText += `Successfully removed ${removed.length} item(s):\n${removed.map(r => r.path).join('\n')}\n\n`;
      }

      // Case mismatches
      const mismatches = results.filter(r => r.status === 'case_mismatch');
      if (mismatches.length > 0) {
        resultText += `Found ${mismatches.length} case-insensitive match(es):\n${mismatches.map(r => 
          `${r.path} (Did you mean: ${r.suggestion}?)`
        ).join('\n')}\n\n`;
      }

      // Not found
      const notFound = results.filter(r => r.status === 'not_found');
      if (notFound.length > 0) {
        resultText += `${notFound.length} item(s) not found:\n${notFound.map(r => r.path).join('\n')}\n\n`;
      }

      resultText += `${remainingItems.size} items remaining in queue.`;

      // If nothing was removed and there are items in the queue, show them
      if (removedCount === 0 && remainingItems.size > 0) {
        resultText += `\n\nCurrent queue contains:\n${Array.from(remainingItems).join('\n')}`;
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