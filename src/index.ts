#!/usr/bin/env node
/*
 * Copyright 2024 [MFPires]
 * 
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * 
 * This file contains code derived from:
 * 1. mcp-ragdocs project (original version copyright [qpd-v])
 *    Licensed under Apache License 2.0
 * 2. hannesrudolph/mcp-ragdocs
 *    Licensed under MIT License
 * 
 * Modifications include:
 * - Reorganized code structure
 * - Enhanced error handling
 * - Improved configuration management
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ApiClient } from './api-client.js';
import { HandlerRegistry } from './handler-registry.js';

class RagDocsServer {
  private server: Server;
  private apiClient: ApiClient;
  private handlerRegistry: HandlerRegistry;

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

    this.apiClient = new ApiClient();
    this.handlerRegistry = new HandlerRegistry(this.server, this.apiClient);
    
    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup() {
    await this.apiClient.cleanup();
    await this.server.close();
  }

  async run() {
    try {
      await this.apiClient.testConnection();
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
