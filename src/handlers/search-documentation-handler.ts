import { BaseHandler } from './base-handler.js';
import { DocumentPayload, isDocumentPayload } from '../types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const COLLECTION_NAME = 'documentation';
const MAX_LIMIT = 20;

export class SearchDocumentationHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      const query = this.validateRequiredString(args, 'query');
      let limit = this.validateOptionalNumber(args, 'limit', 5);

      // Validate limit range
      if (limit < 1 || limit > MAX_LIMIT) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid limit: must be between 1 and ${MAX_LIMIT}, got ${limit}`
        );
      }

      const embedding = await this.context.getEmbeddings(query);
      
      const searchResults = await this.context.qdrantClient.search(COLLECTION_NAME, {
        vector: embedding,
        limit,
        with_payload: true,
      });

      const results = searchResults
        .filter((result): result is typeof result & { payload: DocumentPayload } => {
          return result.payload !== undefined && 
                 result.payload !== null && 
                 isDocumentPayload(result.payload);
        })
        .map((result) => ({
          score: result.score,
          text: result.payload.text,
          url: result.payload.url,
          title: result.payload.title,
        }));

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No relevant documentation found for your query. Try rephrasing or using different terms.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: results
              .map(
                (r) =>
                  `[${r.title}](${r.url}) (score: ${r.score.toFixed(2)})\n${r.text}\n`
              )
              .join('\n---\n'),
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }
} 