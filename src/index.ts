#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { QdrantClient } from '@qdrant/js-client-rest';
import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import axios from 'axios';
import crypto from 'crypto';
import { EmbeddingService } from './embeddings.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Environment variables for configuration
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const QDRANT_URL = process.env.QDRANT_URL;
if (!QDRANT_URL) {
  throw new Error('QDRANT_URL environment variable is required');
}
const COLLECTION_NAME = 'documentation';
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER || 'ollama';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface QdrantCollectionConfig {
		params: {
				vectors: {
						size: number;
						distance: string;
				};
		};
}

interface QdrantCollectionInfo {
		config: QdrantCollectionConfig;
}

interface DocumentChunk {
  text: string;
  url: string;
  title: string;
  timestamp: string;
}

interface DocumentPayload extends DocumentChunk {
  _type: 'DocumentChunk';
  [key: string]: unknown;
}

interface LocalFileChunk extends DocumentChunk {
  filePath: string;
}

function isDocumentPayload(payload: unknown): payload is DocumentPayload {
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

class RagDocsServer {
  private server: Server;
  private qdrantClient!: QdrantClient;
  private browser: any;
  private embeddingService!: EmbeddingService;

  private async testQdrantConnection() {
    try {
      const response = await this.qdrantClient.getCollections();
      console.error('Successfully connected to Qdrant. Collections:', response.collections);
    } catch (error) {
      console.error('Failed initial Qdrant connection test:', error);
      if (error instanceof Error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to establish initial connection to Qdrant server: ${error.message}`
        );
      }
      throw new McpError(
        ErrorCode.InternalError,
        'Failed to establish initial connection to Qdrant server: Unknown error'
      );
    }
  }

  private async init() {
    // Test connection with direct axios call
    const axiosInstance = axios.create({
      baseURL: QDRANT_URL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {})
      }
    });

    // Test connection
    try {
      const response = await axiosInstance.get('/collections');
      console.error('Successfully connected to Qdrant:', response.data);
    } catch (error) {
      console.error('Failed to connect to Qdrant:', error);
      throw new McpError(
        ErrorCode.InternalError,
        'Failed to establish initial connection to Qdrant server'
      );
    }

    // Initialize Qdrant client with minimal configuration
    this.qdrantClient = new QdrantClient({
      url: QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY
    });

    // Initialize embedding service from environment configuration
    this.embeddingService = EmbeddingService.createFromConfig({
      provider: EMBEDDING_PROVIDER as 'ollama' | 'openai',
      model: EMBEDDING_MODEL,
      apiKey: OPENAI_API_KEY
    });

    this.setupToolHandlers();
  }

  constructor() {
    this.server = new Server(
      {
        name: 'mcp-ragdocs',
        version: '0.1.0',
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup() {
    if (this.browser) {
      await this.browser.close();
    }
    await this.server.close();
  }

  private async initBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch();
    }
  }

  private async getEmbeddings(text: string): Promise<number[]> {
    return this.embeddingService.generateEmbeddings(text);
  }

  private async initCollection() {
    try {
      // First ensure we can connect to Qdrant
      await this.testQdrantConnection();

      const requiredVectorSize = this.embeddingService.getVectorSize();

      try {
								// Check if collection exists
        const collections = await this.qdrantClient.getCollections();
        const collection = collections.collections.find(c => c.name === COLLECTION_NAME);

								if (!collection) {
          console.error(`Creating new collection with vector size ${requiredVectorSize}`);
          await this.qdrantClient.createCollection(COLLECTION_NAME, {
            vectors: {
              size: requiredVectorSize,
              distance: 'Cosine',
            },
          });
          return;
        }

								// Get collection info to check vector size
								const collectionInfo = await this.qdrantClient.getCollection(COLLECTION_NAME) as QdrantCollectionInfo;
        const currentVectorSize = collectionInfo.config?.params?.vectors?.size;
        
        if (!currentVectorSize) {
          console.error('Could not determine current vector size, recreating collection...');
          await this.recreateCollection(requiredVectorSize);
          return;
        }

        if (currentVectorSize !== requiredVectorSize) {
          console.error(`Vector size mismatch: collection=${currentVectorSize}, required=${requiredVectorSize}`);
          await this.recreateCollection(requiredVectorSize);
        }
      } catch (error) {
        console.error('Failed to initialize collection:', error);
        throw new McpError(
          ErrorCode.InternalError,
          'Failed to initialize Qdrant collection. Please check server logs for details.'
        );
      }
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Unexpected error initializing Qdrant: ${error}`
      );
    }
  }

  private async recreateCollection(vectorSize: number) {
    try {
      console.error('Recreating collection with new vector size...');
      await this.qdrantClient.deleteCollection(COLLECTION_NAME);
      await this.qdrantClient.createCollection(COLLECTION_NAME, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      });
      console.error(`Collection recreated with new vector size ${vectorSize}`);
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to recreate collection: ${error}`
      );
    }
  }

  private async fetchAndProcessUrl(url: string): Promise<DocumentChunk[]> {
    await this.initBrowser();
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

  private generatePointId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private async processLocalFile(filePath: string): Promise<DocumentChunk[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const fileName = path.basename(filePath);
      
      // Split content into chunks
      const chunks = this.chunkText(content, 1000);
      
      return chunks.map(chunk => ({
        text: chunk,
        url: `file://${filePath}`,
        title: fileName,
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to process file ${filePath}: ${error}`
      );
    }
  }

  private async processLocalDirectory(dirPath: string): Promise<DocumentChunk[]> {
    try {
      const allChunks: DocumentChunk[] = [];
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stats = await fs.stat(fullPath);
        
        if (stats.isFile()) {
          // Only process text files
          if (file.match(/\.(txt|md|js|ts|py|java|c|cpp|h|hpp|json|yaml|yml|xml|html|css|sql)$/i)) {
            const chunks = await this.processLocalFile(fullPath);
            allChunks.push(...chunks);
          }
        } else if (stats.isDirectory()) {
          const subDirChunks = await this.processLocalDirectory(fullPath);
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

  private async handleAddLocalDocumentation(args: Record<string, unknown>) {
    if (!args.path || typeof args.path !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'File/directory path is required');
    }

    try {
      const stats = await fs.stat(args.path);
      let chunks: DocumentChunk[];
      
      if (stats.isFile()) {
        chunks = await this.processLocalFile(args.path);
      } else if (stats.isDirectory()) {
        chunks = await this.processLocalDirectory(args.path);
      } else {
        throw new McpError(ErrorCode.InvalidParams, 'Path must be a file or directory');
      }
      
      for (const chunk of chunks) {
        const embedding = await this.getEmbeddings(chunk.text);
        const payload = {
          ...chunk,
          _type: 'DocumentChunk' as const,
        };
        
        await this.qdrantClient.upsert(COLLECTION_NAME, {
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
            text: `Successfully added documentation from ${args.path} (${chunks.length} chunks processed)`,
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to add local documentation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: 'add_url_documentation',
          description: 'Add documentation from a URL to the RAG database',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'URL of the documentation to fetch',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'add_local_documentation',
          description: 'Add documentation from a local file or directory to the RAG database',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute path to the local file or directory',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'search_documentation',
          description: 'Search through stored documentation',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_sources',
          description: 'List all documentation sources',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.initCollection();
      const response = await this.handleCallTool(request);
      return response;
    });
  }

  private async handleCallTool(request: CallToolRequest) {
    console.error('Received request:', JSON.stringify(request, null, 2));
    if (!request.params?.name || !request.params?.arguments) {
      console.error('Missing name or arguments. Request params:', request.params);
      throw new McpError(ErrorCode.InvalidParams, 'Tool name and arguments are required');
    }

    const args = request.params.arguments as Record<string, unknown>;

    switch (request.params.name) {
      case 'add_url_documentation':
        return this.handleAddDocumentation(args);
      case 'search_documentation':
        return this.handleSearchDocumentation(args);
      case 'list_sources':
        return this.handleListSources(args);
      case 'test_ollama':
        return this.handleTestEmbeddings(args);
      case 'add_local_documentation':
        return this.handleAddLocalDocumentation(args);
      default:
        throw new McpError(
          ErrorCode.InvalidParams,
          `Unknown tool: ${request.params.name}`
        );
    }
  }

  private async handleTestEmbeddings(args: Record<string, unknown>) {
    if (!args.text || typeof args.text !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Text is required');
    }

    try {
      // Create a new embedding service instance with the requested configuration
      const provider = (args.provider as 'ollama' | 'openai') || 'ollama';
      const apiKey = typeof args.apiKey === 'string' ? args.apiKey : undefined;
      const model = typeof args.model === 'string' ? args.model : undefined;

      const tempEmbeddingService = EmbeddingService.createFromConfig({
        provider,
        apiKey,
        model,
      });

      const embedding = await tempEmbeddingService.generateEmbeddings(args.text);
      const modelName = model || (provider === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small');

      // If test is successful, update the server's embedding service
      this.embeddingService = tempEmbeddingService;
      
      // Reinitialize collection with new vector size
      await this.initCollection();

      return {
        content: [
          {
            type: 'text',
            text: `Successfully configured ${provider} embeddings (${modelName}).\nVector size: ${embedding.length}\nQdrant collection updated to match new vector size.`,
          },
        ],
      };
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to test embeddings: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleAddDocumentation(args: Record<string, unknown>) {
    if (!args.url || typeof args.url !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'URL is required');
    }

    try {
      const chunks = await this.fetchAndProcessUrl(args.url);
      
      for (const chunk of chunks) {
        const embedding = await this.getEmbeddings(chunk.text);
        const payload = {
          ...chunk,
          _type: 'DocumentChunk' as const,
        };
        
        await this.qdrantClient.upsert(COLLECTION_NAME, {
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
            text: `Successfully added documentation from ${args.url} (${chunks.length} chunks processed)`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to add documentation: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleSearchDocumentation(args: Record<string, unknown>) {
    if (!args.query || typeof args.query !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, 'Query is required');
    }

    const limit = typeof args.limit === 'number' ? args.limit : 5;

    try {
      const embedding = await this.getEmbeddings(args.query);
      
      const searchResults = await this.qdrantClient.search(COLLECTION_NAME, {
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
              text: 'No relevant documentation found.',
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
    } catch (error: unknown) {
      return {
        content: [
          {
            type: 'text',
            text: `Failed to search documentation: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleListSources(args: Record<string, unknown>) {
    try {
      const scroll = await this.qdrantClient.scroll(COLLECTION_NAME, {
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

  private async handleResult(result: { content: Array<{ type: string; text: string }>; isError?: boolean }): Promise<void> {
    if (result.isError) {
      throw new McpError(ErrorCode.InternalError, result.content[0]?.text || 'Unknown error');
    }
  }

  async run() {
    try {
      await this.init();
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('RAG Docs MCP server running on stdio');
    } catch (error) {
      console.error('Failed to initialize server:', error);
      process.exit(1);
    }
  }
}

const server = new RagDocsServer();
server.run().catch(console.error);
