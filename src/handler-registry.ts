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
        get browser() { return apiClient.browser; },
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
          description: 'Add documentation from a local file or directory to the RAG database. This tool processes local files into chunks suitable for semantic search and stores them in the vector database. Supports multiple file formats including markdown, text, and source code files. When processing directories, it recursively handles all supported files while maintaining proper context and relationships.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute or relative path to the local file or directory to process. For directories, all supported file types will be processed recursively.',
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
          description: 'List all documentation sources currently stored in the system. Returns a comprehensive list of all indexed documentation including source URLs, titles, and last update times. Use this to understand what documentation is available for searching or to verify if specific sources have been indexed.',
          inputSchema: {
            type: 'object',
            properties: {},
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