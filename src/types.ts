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
  _type?: 'DocumentChunk';  // type identifier for the document
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

export interface QueueConfig {
  maxConcurrent: number;     // Maximum items to process in parallel
  retryAttempts: number;     // Number of retry attempts for failed items
  retryDelay: number;        // Delay between retries in ms
}

export interface BatchConfig {
  maxBatchSize: number;      // Maximum chunks per batch
  maxTokens: number;         // Maximum tokens per batch
  chunkOverlap: number;      // Overlap between chunks
}

export interface QueueProgress {
  totalItems: number;        // Total items in queue
  processing: string[];      // Currently processing items
  completed: number;         // Number of completed items
  failed: number;           // Number of failed items
  errors: Array<{           // Detailed error information
    item: string;
    error: string;
    attempts: number;
  }>;
  startTime: number;        // When processing started
  estimatedTimeRemaining?: number; // Estimated time remaining in ms
}

export interface HandlerContext {
  server: Server;
  qdrantClient: QdrantClient;
  getEmbeddings: (text: string) => Promise<number[]>;
  getBatchEmbeddings: (texts: string[]) => Promise<number[][]>;
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
    typeof p.text === 'string' &&
    typeof p.url === 'string' &&
    typeof p.title === 'string' &&
    typeof p.timestamp === 'string'
  );
} 