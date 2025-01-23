import { QdrantClient } from '@qdrant/js-client-rest';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { chromium, Browser } from 'playwright';
import * as cheerio from 'cheerio';
import axios from 'axios';
import crypto from 'crypto';
import { EmbeddingService } from './embeddings.js';
import { DocumentChunk, QdrantCollectionInfo } from './types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const TIMEOUT_MS = 10000; // 10 seconds timeout for requests

export class ApiClient {
  private qdrantClient: QdrantClient;
  private embeddingService: EmbeddingService;
  private browser: Browser | null = null;

  constructor() {
    const QDRANT_URL = process.env.QDRANT_URL;
    const QDRANT_API_KEY = process.env.QDRANT_API_KEY;

    if (!QDRANT_URL) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'QDRANT_URL environment variable is required for cloud configuration'
      );
    }

    // Validate URL format
    try {
      new URL(QDRANT_URL);
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid QDRANT_URL format: ${QDRANT_URL}. Must be a valid URL including protocol (e.g., https://)`
      );
    }

    // Initialize with timeout settings
    this.qdrantClient = new QdrantClient({
      url: QDRANT_URL,
      apiKey: QDRANT_API_KEY,
      timeout: TIMEOUT_MS
    });

    // Initialize embedding service with validation
    const provider = process.env.EMBEDDING_PROVIDER as 'ollama' | 'openai';
    const model = process.env.EMBEDDING_MODEL;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (provider === 'openai' && !openaiKey) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'OPENAI_API_KEY environment variable is required when using OpenAI embeddings'
      );
    }

    this.embeddingService = EmbeddingService.createFromConfig({
      provider,
      model,
      apiKey: openaiKey
    });
  }

  getBrowser(): Browser | null {
    return this.browser;
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  async initBrowser() {
    if (!this.browser) {
      try {
        this.browser = await chromium.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
      } catch (error) {
        console.error('Failed to initialize browser:', error);
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to initialize browser: ${error}`
        );
      }
    }
  }

  async testConnection() {
    try {
      const response = await Promise.race([
        this.qdrantClient.getCollections(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), TIMEOUT_MS)
        )
      ]) as { collections: Array<{ name: string }> };
      
      console.error('Successfully connected to Qdrant:', response.collections);
    } catch (error) {
      if (error instanceof Error && error.message === 'Connection timeout') {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to connect to Qdrant: Connection timed out after ${TIMEOUT_MS/1000} seconds`
        );
      }
      
      if (error instanceof Error && error.message.includes('401')) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Failed to authenticate with Qdrant: Invalid API key'
        );
      }

      if (error instanceof Error && error.message.includes('403')) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          'Failed to access Qdrant: Insufficient permissions'
        );
      }

      console.error('Failed to connect to Qdrant:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to establish connection to Qdrant server: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async initCollection(collectionName: string) {
    try {
      const requiredVectorSize = this.embeddingService.getVectorSize();
      const collections = await this.qdrantClient.getCollections();
      const collection = collections.collections.find(c => c.name === collectionName);

      if (!collection) {
        console.error(`Creating new collection with vector size ${requiredVectorSize}`);
        await this.qdrantClient.createCollection(collectionName, {
          vectors: {
            size: requiredVectorSize,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
            memmap_threshold: 20000,
          },
          replication_factor: 2,
        });
        return;
      }

      const collectionInfo = await this.qdrantClient.getCollection(collectionName) as QdrantCollectionInfo;
      const currentVectorSize = collectionInfo.config?.params?.vectors?.size;

      if (!currentVectorSize) {
        console.error('Could not determine current vector size, recreating collection...');
        await this.recreateCollection(collectionName, requiredVectorSize);
        return;
      }

      if (currentVectorSize !== requiredVectorSize) {
        console.error(`Vector size mismatch: collection=${currentVectorSize}, required=${requiredVectorSize}`);
        await this.recreateCollection(collectionName, requiredVectorSize);
      }
    } catch (error) {
      if (error instanceof McpError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to initialize Qdrant collection: ${error}`
      );
    }
  }

  private async recreateCollection(collectionName: string, vectorSize: number) {
    try {
      console.error('Recreating collection with new vector size...');
      await this.qdrantClient.deleteCollection(collectionName);
      await this.qdrantClient.createCollection(collectionName, {
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
      console.error(`Collection recreated with new vector size ${vectorSize}`);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to recreate collection: ${error}`
      );
    }
  }

  async getEmbeddings(text: string): Promise<number[]> {
    return this.embeddingService.generateEmbeddings(text);
  }

  getQdrantClient(): QdrantClient {
    return this.qdrantClient;
  }

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  async fetchAndProcessUrl(url: string): Promise<DocumentChunk[]> {
    if (!this.browser) {
      this.browser = await chromium.launch();
    }
    const page = await this.browser.newPage();
    
    try {
      await page.goto(url, { waitUntil: 'networkidle' });
      const content = await page.content();
      const $ = cheerio.load(content);
      
      // Remove script tags, style tags, and comments
      $('script').remove();
      $('style').remove();
      $('noscript').remove();
      
      // Extract main content
      const title = $('title').text() || url;
      const mainContent = $('main, article, .content, .documentation, body').text();
      
      // Split content into chunks
      const chunks = this.chunkText(mainContent, 1000);
      
      return chunks.map(chunk => ({
        text: chunk,
        url,
        title,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch URL ${url}: ${error}`
      );
    } finally {
      await page.close();
    }
  }

  private chunkText(text: string, maxChunkSize: number): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk: string[] = [];
    
    for (const word of words) {
      currentChunk.push(word);
      const currentLength = currentChunk.join(' ').length;
      
      if (currentLength >= maxChunkSize) {
        chunks.push(currentChunk.join(' '));
        currentChunk = [];
      }
    }
    
    if (currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
    }
    
    return chunks;
  }

  async processLocalDirectory(dirPath: string, baseDir?: string, currentDepth = 0): Promise<DocumentChunk[]> {
    try {
      const allChunks: DocumentChunk[] = [];
      const normalizedPath = path.normalize(dirPath);
      
      // If this is the root call, set baseDir
      if (!baseDir) {
        baseDir = normalizedPath;
      }

      // Create folder entry
      const relativePath = path.relative(baseDir, normalizedPath);
      const pathSegments = relativePath ? relativePath.split(path.sep) : [];
      const parentFolder = pathSegments.length > 1 ? pathSegments.slice(0, -1).join('/') : '';
      
      // Add folder document
      if (relativePath) {
        allChunks.push({
          text: `Directory: ${relativePath}`,
          url: `file://${normalizedPath}`,
          title: path.basename(normalizedPath),
          timestamp: new Date().toISOString(),
          path_segments: pathSegments,
          parent_folder: parentFolder,
          is_folder: true,
          depth: currentDepth
        });
      }

      const files = await fs.readdir(normalizedPath);
      
      for (const file of files) {
        const fullPath = path.resolve(normalizedPath, file);
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile()) {
          // Only process text files
          if (file.toLowerCase().match(/\.(txt|md|mdx|markdown|js|jsx|ts|tsx|py|java|c|cpp|h|hpp|json|yaml|yml|xml|html|htm|css|sql|log|conf|ini|sh|bash|zsh|ps1|bat|cmd)$/)) {
            const fileChunks = await this.processLocalFile(fullPath, baseDir, currentDepth + 1);
            allChunks.push(...fileChunks);
          }
        } else if (stats.isDirectory()) {
          const subDirChunks = await this.processLocalDirectory(fullPath, baseDir, currentDepth + 1);
          allChunks.push(...subDirChunks);
        }
      }
      
      return allChunks;
    } catch (error: unknown) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to process directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async processLocalFile(filePath: string, baseDir?: string, depth = 0): Promise<DocumentChunk[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const normalizedPath = path.normalize(filePath);
      const relativePath = baseDir ? path.relative(baseDir, normalizedPath) : normalizedPath;
      const pathSegments = relativePath.split(path.sep);
      const parentFolder = pathSegments.length > 1 ? pathSegments.slice(0, -1).join('/') : '';
      
      // Split content into chunks
      const chunks = this.chunkText(content, 1000);
      
      return chunks.map(chunk => ({
        text: chunk,
        url: `file://${normalizedPath}`,
        title: path.basename(normalizedPath),
        timestamp: new Date().toISOString(),
        path_segments: pathSegments,
        parent_folder: parentFolder,
        is_folder: false,
        depth
      }));
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to process file ${filePath}: ${error}`
      );
    }
  }

  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }
} 