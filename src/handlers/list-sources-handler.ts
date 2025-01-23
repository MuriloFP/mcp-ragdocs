import { BaseHandler } from './base-handler.js';
import { isDocumentPayload } from '../types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const COLLECTION_NAME = 'documentation';

export class ListSourcesHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      const scroll = await this.context.qdrantClient.scroll(COLLECTION_NAME, {
        with_payload: true,
      });

      const sources = new Set<string>();
      for (const point of scroll.points) {
        if (isDocumentPayload(point.payload)) {
          sources.add(`${point.payload.title} (${point.payload.url})`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: Array.from(sources).join('\n') || 'No documentation sources found.',
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to list sources: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }
} 