import { QdrantClient } from '@qdrant/js-client-rest';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export interface DocumentChunk {
  text: string;
  url: string;
  title: string;
  timestamp: string;
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