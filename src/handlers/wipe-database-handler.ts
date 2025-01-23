import { BaseHandler } from './base-handler.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

const COLLECTION_NAME = 'documentation';

export class WipeDatabaseHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      // Check if collection exists
      const collections = await this.context.qdrantClient.getCollections();
      const collection = collections.collections.find(c => c.name === COLLECTION_NAME);
      
      if (!collection) {
        return {
          content: [
            {
              type: 'text',
              text: 'No database found to wipe.',
            },
          ],
        };
      }

      // Delete the collection
      await this.context.qdrantClient.deleteCollection(COLLECTION_NAME);
      
      // Recreate the collection with the same settings
      const vectorSize = this.context.apiClient.getEmbeddingService().getVectorSize();
      await this.context.qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
        optimizers_config: {
          default_segment_number: 2,
          memmap_threshold: 20000,
        },
        replication_factor: 2,
      });

      return {
        content: [
          {
            type: 'text',
            text: 'Database successfully wiped and reinitialized.',
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }
} 