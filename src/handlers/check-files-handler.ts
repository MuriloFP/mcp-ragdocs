import { BaseHandler } from './base-handler.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';

const QUEUE_FILE = path.join(process.cwd(), 'queue.txt');

export class CheckFilesHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      const filePath = this.validateRequiredString(args, 'path');
      const addToQueue = args.add_to_queue as boolean || false;

      // Validate path exists
      try {
        await fs.access(filePath);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Path does not exist or is not accessible: ${filePath}`
        );
      }

      // Get file stats to determine if it's a file or directory
      const stats = await fs.stat(filePath);
      const files: string[] = [];

      if (stats.isDirectory()) {
        // Recursively scan directory
        await this.scanDirectory(filePath, files);
      } else {
        // Single file
        files.push(filePath);
      }

      if (addToQueue) {
        try {
          // Ensure queue file exists
          try {
            await fs.access(QUEUE_FILE);
          } catch {
            await fs.writeFile(QUEUE_FILE, '');
          }

          // Append paths to queue
          const pathsToAdd = files.join('\n') + (files.length > 0 ? '\n' : '');
          await fs.appendFile(QUEUE_FILE, pathsToAdd);

          return {
            content: [
              {
                type: 'text',
                text: `Found ${files.length} file(s) and added them to the queue:\n${files.join('\n')}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Failed to add files to queue: ${error}`,
              },
            ],
            isError: true,
          };
        }
      }

      // If not adding to queue, just return the list of files
      return {
        content: [
          {
            type: 'text',
            text: files.length > 0 
              ? `Found ${files.length} file(s):\n${files.join('\n')}`
              : 'No files found.',
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }

  private async scanDirectory(dirPath: string, files: string[]) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        await this.scanDirectory(fullPath, files);
      } else if (entry.isFile()) {
        // Add file to the list
        files.push(fullPath);
      }
    }
  }
} 