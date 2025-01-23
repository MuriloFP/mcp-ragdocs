import { QdrantClient } from '@qdrant/js-client-rest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Browser } from 'playwright';
import { EmbeddingService } from './embeddings.js';

export interface DocumentChunk {
  text: string;
  url: string;
  title: string;
  timestamp: string;
  path_segments?: string[];  // e.g., ['docs', 'api', 'v1']
  parent_folder?: string;    // e.g., 'docs/api'
  is_folder?: boolean;       // true for directory entries
  depth?: number;           // nesting level, 0 for root
}

export interface DocumentPayload extends DocumentChunk {
  _type: 'DocumentChunk';
  [key: string]: unknown;
}

export interface LocalFileChunk extends DocumentChunk {
  filePath: string;
}

export interface QdrantCollectionConfig {
  params: {
    vectors: {
      size: number;
      distance: string;
    };
  };
}

export interface QdrantCollectionInfo {
  config: QdrantCollectionConfig;
}

export interface HandlerContext {
  server: Server;
  qdrantClient: QdrantClient;
  getEmbeddings: (text: string) => Promise<number[]>;
  apiClient: {
    fetchAndProcessUrl: (url: string) => Promise<DocumentChunk[]>;
    processLocalFile: (filePath: string) => Promise<DocumentChunk[]>;
    processLocalDirectory: (dirPath: string) => Promise<DocumentChunk[]>;
    initBrowser: () => Promise<void>;
    browser: Browser | null;
    getEmbeddingService: () => EmbeddingService;
  };
}

export function isDocumentPayload(payload: unknown): payload is DocumentPayload {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Partial<DocumentPayload>;
  return (
    p._type === 'DocumentChunk' &&
    typeof p.text === 'string' &&
    typeof p.url === 'string' &&
    typeof p.title === 'string' &&
    typeof p.timestamp === 'string'
  );
} 