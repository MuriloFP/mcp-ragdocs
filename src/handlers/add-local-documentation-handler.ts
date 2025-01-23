import { BaseHandler } from './base-handler.js';
import { DocumentChunk } from '../types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';
import * as fs from 'node:fs/promises';

const COLLECTION_NAME = 'documentation';

export class AddLocalDocumentationHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      const path = this.validateRequiredString(args, 'path');

      // Validate path exists
      try {
        await fs.access(path);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid path: ${path}. The file or directory does not exist or is not accessible.`
        );
      }

      const chunks = await this.context.apiClient.processLocalFile(path);
      
      if (chunks.length === 0) {
        throw new McpError(
          ErrorCode.InternalError,
          `No content could be extracted from ${path}. The file might be empty or in an unsupported format.`
        );
      }
      
      for (const chunk of chunks) {
        const embedding = await this.context.getEmbeddings(chunk.text);
        const payload = {
          ...chunk,
          _type: 'DocumentChunk' as const,
        };
        
        await this.context.qdrantClient.upsert(COLLECTION_NAME, {
          wait: true,
          points: [
            {
              id: this.generatePointId(),
              vector: embedding,
              payload: payload as Record<string, unknown>,
            },
          ],
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully added documentation from ${path} (${chunks.length} chunks processed)`,
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }
} 