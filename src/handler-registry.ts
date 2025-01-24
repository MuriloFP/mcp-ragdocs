import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ApiClient } from './api-client.js';
import { HandlerContext } from './types.js';
import { AddUrlDocumentationHandler } from './handlers/add-url-documentation-handler.js';
import { AddLocalDocumentationHandler } from './handlers/add-local-documentation-handler.js';
import { SearchDocumentationHandler } from './handlers/search-documentation-handler.js';
import { ListSourcesHandler } from './handlers/list-sources-handler.js';
import { ExtractUrlsHandler } from './handlers/extract-urls-handler.js';
import { WipeDatabaseHandler } from './handlers/wipe-database-handler.js';
import { RemoveDocumentationHandler } from './handlers/remove-documentation-handler.js';
import { ListQueueHandler } from './handlers/list-queue-handler.js';
import { RunQueueHandler } from './handlers/run-queue-handler.js';
import { ClearQueueHandler } from './handlers/clear-queue-handler.js';
import { CheckFilesHandler } from './handlers/check-files-handler.js';
import { RemoveFromQueueHandler } from './handlers/remove-from-queue-handler.js';

const COLLECTION_NAME = 'documentation';

export class HandlerRegistry {
  private server: Server;
  private apiClient: ApiClient;
  private handlers: Map<string, any>;
  private context: HandlerContext;

  constructor(server: Server, apiClient: ApiClient) {
    this.server = server;
    this.apiClient = apiClient;
    this.context = {
      server,
      qdrantClient: apiClient.getQdrantClient(),
      getEmbeddings: (text: string) => apiClient.getEmbeddings(text),
      apiClient: {
        fetchAndProcessUrl: (url: string) => apiClient.fetchAndProcessUrl(url),
        processLocalFile: (filePath: string) => apiClient.processLocalFile(filePath),
        processLocalDirectory: (dirPath: string) => apiClient.processLocalDirectory(dirPath),
        initBrowser: () => apiClient.initBrowser(),
        get browser() { return apiClient.getBrowser(); },
        getEmbeddingService: () => apiClient.getEmbeddingService(),
      },
    };
    this.handlers = new Map();
    this.setupHandlers();
    this.registerHandlers();
  }

  private setupHandlers() {
    this.handlers.set('add_url_documentation', new AddUrlDocumentationHandler(this.context));
    this.handlers.set('add_local_documentation', new AddLocalDocumentationHandler(this.context));
    this.handlers.set('search_documentation', new SearchDocumentationHandler(this.context));
    this.handlers.set('list_sources', new ListSourcesHandler(this.context));
    this.handlers.set('extract_urls', new ExtractUrlsHandler(this.context));
    this.handlers.set('wipe_database', new WipeDatabaseHandler(this.context));
    this.handlers.set('remove_documentation', new RemoveDocumentationHandler(this.context));
    this.handlers.set('list_queue', new ListQueueHandler(this.context));
    this.handlers.set('run_queue', new RunQueueHandler(this.context));
    this.handlers.set('clear_queue', new ClearQueueHandler(this.context));
    this.handlers.set('check_files', new CheckFilesHandler(this.context));
    this.handlers.set('remove_from_queue', new RemoveFromQueueHandler(this.context));
  }

  private registerHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'add_url_documentation',
          description: 'Add documentation from a URL to the RAG database. This tool fetches the content from the specified URL, processes it into chunks suitable for semantic search, and stores them in the vector database. Handles various webpage formats and automatically extracts meaningful content while removing boilerplate elements like navigation menus and footers.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The complete URL of the documentation to fetch (must include protocol, e.g., https://). The page must be publicly accessible.',
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'add_local_documentation',
          description: 'Add documentation from a local file or directory to the RAG database. This tool processes local files into chunks suitable for semantic search and stores them in the vector database. Uses the aboslute path to the file or directory as the path parameter.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute path to the local file or directory to process. For directories, all supported file types will be processed recursively.',
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'search_documentation',
          description: 'Search through stored documentation using natural language queries. Use this tool to find relevant information across all stored documentation sources. Returns matching excerpts with context, ranked by relevance. Useful for finding specific information, code examples, or related documentation.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The text to search for in the documentation. Can be a natural language query, specific terms, or code snippets.',
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results to return (1-20). Higher limits provide more comprehensive results but may take longer to process. Default is 5.',
                default: 5,
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_sources',
          description: 'List all documentation sources currently stored in the system. Returns a comprehensive list of all indexed documentation including source URLs, titles, and last update times. By default shows a condensed view with grouped URLs, but can show expanded details with the expanded flag. Use this to understand what documentation is available for searching or to verify if specific sources have been indexed.',
          inputSchema: {
            type: 'object',
            properties: {
              expanded: {
                type: 'boolean',
                description: 'If true, shows all URLs under each domain. If false (default), only shows the base domain URL with grouped sources.',
                default: false
              }
            }
          },
        },
        {
          name: 'extract_urls',
          description: 'Extract and analyze all URLs from a given web page. This tool crawls the specified webpage, identifies all hyperlinks, and optionally adds them to the processing queue. Useful for discovering related documentation pages, API references, or building a documentation graph. Handles various URL formats and validates links before extraction.',
          inputSchema: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The complete URL of the webpage to analyze (must include protocol, e.g., https://). The page must be publicly accessible.',
              },
              add_to_queue: {
                type: 'boolean',
                description: 'If true, automatically add extracted URLs to the processing queue for later indexing. This enables recursive documentation discovery. Use with caution on large sites to avoid excessive queuing.',
                default: false,
              },
            },
            required: ['url'],
          },
        },
        {
          name: 'check_files',
          description: 'Scan a local file or directory and list all files found. Can optionally add the found files to the processing queue. Similar to extract_urls but for local filesystem.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute path to the file or directory to scan. For directories, all files will be listed recursively.',
              },
              add_to_queue: {
                type: 'boolean',
                description: 'If true, automatically add found files to the processing queue for later indexing.',
                default: false,
              },
            },
            required: ['path'],
          },
        },
        {
          name: 'wipe_database',
          description: 'Wipe the entire RAG database, removing all stored documentation. This action cannot be undone. The database will be reinitialized with empty collections after wiping.',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: 'remove_documentation',
          description: 'Remove specific documentation from the database. This action cannot be undone.',
          inputSchema: {
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                items: {
                  type: 'string',
                  description: 'Path to the documentation to remove. Can be relative or absolute.',
                },
                description: 'Array of paths to remove from the database',
              },
            },
            required: ['paths'],
          },
        },
        {
          name: 'list_queue',
          description: 'List all URLs currently waiting in the documentation processing queue. Shows pending documentation sources that will be processed when run_queue is called. Use this to monitor queue status, verify URLs were added correctly, or check processing backlog.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'run_queue',
          description: 'Process and index all URLs currently in the documentation queue. Each URL is processed sequentially, with proper error handling and retry logic. Progress updates are provided as processing occurs. Long-running operations will process until the queue is empty or an unrecoverable error occurs.',
          inputSchema: {
            type: 'object',
            properties: {
              maxConcurrent: {
                type: 'number',
                description: 'Maximum number of items to process in parallel (1-5). Higher values may process faster but use more resources.',
                minimum: 1,
                maximum: 5,
                default: 3
              },
              retryAttempts: {
                type: 'number',
                description: 'Number of times to retry failed items before giving up.',
                minimum: 0,
                maximum: 5,
                default: 3
              },
              retryDelay: {
                type: 'number',
                description: 'Delay in milliseconds between retry attempts.',
                minimum: 1000,
                maximum: 10000,
                default: 1000
              },
              batchSize: {
                type: 'number',
                description: 'Maximum number of text chunks to process in a single embedding batch.',
                minimum: 1,
                maximum: 100,
                default: 20
              }
            }
          },
        },
        {
          name: 'clear_queue',
          description: 'Remove all pending URLs from the documentation processing queue. Use this to reset the queue when you want to start fresh, remove unwanted URLs, or cancel pending processing. This operation is immediate and permanent - URLs will need to be re-added if you want to process them later.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'remove_from_queue',
          description: 'Remove one or more items from the documentation processing queue. Items can be URLs or local file paths.',
          inputSchema: {
            type: 'object',
            properties: {
              paths: {
                type: 'array',
                items: {
                  type: 'string',
                  description: 'URL or file path to remove from the queue. Must match exactly (but case-insensitive suggestions are provided if no exact match is found).',
                },
                description: 'Array of URLs or file paths to remove from the queue.',
              },
            },
            required: ['paths'],
          },
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      await this.apiClient.initCollection(COLLECTION_NAME);

      const handler = this.handlers.get(request.params.name);
      if (!handler) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      const response = await handler.handle(request.params.arguments);
      return response;
    });
  }
} 