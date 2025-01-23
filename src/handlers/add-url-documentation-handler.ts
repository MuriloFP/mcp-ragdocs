import { BaseHandler } from './base-handler.js';
import { DocumentChunk } from '../types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import crypto from 'crypto';

const COLLECTION_NAME = 'documentation';

export class AddUrlDocumentationHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      const url = this.validateRequiredString(args, 'url');

      // Validate URL format
      try {
        new URL(url);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid URL format: ${url}. Must be a valid URL including protocol (e.g., https://)`
        );
      }

      const chunks = await this.context.apiClient.fetchAndProcessUrl(url);
      
      if (chunks.length === 0) {
        throw new McpError(
          ErrorCode.InternalError,
          `No content could be extracted from ${url}. The page might be empty, blocked, or require authentication.`
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
            text: `Successfully added documentation from ${url} (${chunks.length} chunks processed)`,
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