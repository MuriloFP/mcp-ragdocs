# MCP-Ragdocs

> This project incorporates code from:
> - [mcp-ragdocs](https://github.com/qpd-v/mcp-ragdocs) (Apache License 2.0)
> - [hannesrudolph/mcp-ragdocs](https://github.com/hannesrudolph/mcp-ragdocs) (MIT License)
>
> Enhanced with improved architecture, error handling, and new features. See the [NOTICE](NOTICE) file for details about modifications and original attribution.

A Model Context Protocol (MCP) server that enables semantic search and retrieval of documentation using a vector database (Qdrant). This server allows you to add documentation from URLs or local files and then search through them using natural language queries.

## Version

Current version: 0.1.6

## Features

- Add documentation from URLs or local files
- Store documentation in a vector database for semantic search
- Search through documentation using natural language
- List all documentation sources

## Installation

Install globally using npm:

```bash
npm install -g @qpd-v/mcp-server-ragdocs
```

This will install the server in your global npm directory, which you'll need for the configuration steps below.

## Requirements

- Node.js 16 or higher
- Qdrant (either local or cloud)
- One of the following for embeddings:
  - Ollama running locally (default, free)
  - OpenAI API key (optional, paid)

## Qdrant Setup Options

### Option 1: Local Qdrant

1. Using Docker (recommended):
```bash
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

2. Or download from [Qdrant's website](https://qdrant.tech/documentation/quick-start/)

### Option 2: Qdrant Cloud

1. Create an account at [Qdrant Cloud](https://cloud.qdrant.io/)
2. Create a new cluster
3. Get your cluster URL and API key from the dashboard
4. Use these in your configuration (see Configuration section below)

## Configuration

The server can be used with both Cline and Claude Desktop. Configuration differs slightly between them:

### Cline Configuration

Add to your Cline settings file (`%AppData%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\cline_mcp_settings.json`):

1. Using npm global install (recommended):
```json
{
		"mcpServers": {
				"ragdocs": {
						"command": "node",
      "args": ["C:/Users/YOUR_USERNAME/AppData/Roaming/npm/node_modules/@qpd-v/mcp-server-ragdocs/build/index.js"],
      "env": {
        "QDRANT_URL": "http://127.0.0.1:6333",
        "EMBEDDING_PROVIDER": "ollama",
        "OLLAMA_URL": "http://localhost:11434"
      }
    }
  }
}
```

For OpenAI instead of Ollama:
```json
{
		"mcpServers": {
				"ragdocs": {
						"command": "node",
      "args": ["C:/Users/YOUR_USERNAME/AppData/Roaming/npm/node_modules/@qpd-v/mcp-server-ragdocs/build/index.js"],
      "env": {
        "QDRANT_URL": "http://127.0.0.1:6333",
        "EMBEDDING_PROVIDER": "openai",
        "OPENAI_API_KEY": "your-openai-api-key"
      }
    }
  }
}
```

2. Using local development setup:
```json
{
		"mcpServers": {
				"ragdocs": {
						"command": "node",
						"args": ["PATH_TO_PROJECT/mcp-ragdocs/build/index.js"],
						"env": {
								"QDRANT_URL": "http://127.0.0.1:6333",
								"EMBEDDING_PROVIDER": "ollama",
								"OLLAMA_URL": "http://localhost:11434"
						}
				}
		}
}
```

### Claude Desktop Configuration

Add to your Claude Desktop config file:
- Windows: `%AppData%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

1. Windows Setup with Ollama (using full paths):
```json
{
  "mcpServers": {
    "ragdocs": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": [
        "C:\\Users\\YOUR_USERNAME\\AppData\\Roaming\\npm\\node_modules\\@qpd-v/mcp-server-ragdocs\\build\\index.js"
      ],
      "env": {
								"QDRANT_URL": "http://127.0.0.1:6333",
								"EMBEDDING_PROVIDER": "ollama",
								"OLLAMA_URL": "http://localhost:11434"
						}
				}
		}
}
```

Windows Setup with OpenAI:
```json
{
		"mcpServers": {
				"ragdocs": {
						"command": "C:\\Program Files\\nodejs\\node.exe",
						"args": [
								"C:\\Users\\YOUR_USERNAME\\AppData\\Roaming\\npm\\node_modules\\@qpd-v/mcp-server-ragdocs\\build\\index.js"
						],
						"env": {
								"QDRANT_URL": "http://127.0.0.1:6333",
								"EMBEDDING_PROVIDER": "openai",
								"OPENAI_API_KEY": "your-openai-api-key"
						}
				}
		}
}
```

2. macOS Setup with Ollama:
```json
{
		"mcpServers": {
				"ragdocs": {
						"command": "/usr/local/bin/node",
						"args": [
								"/usr/local/lib/node_modules/@qpd-v/mcp-server-ragdocs/build/index.js"
						],
						"env": {
								"QDRANT_URL": "http://127.0.0.1:6333",
								"EMBEDDING_PROVIDER": "ollama",
								"OLLAMA_URL": "http://localhost:11434"
						}
				}
		}
}
```

### Qdrant Cloud Configuration

For either Cline or Claude Desktop, when using Qdrant Cloud, modify the env section:

With Ollama:
```json
{
		"env": {
				"QDRANT_URL": "https://your-cluster-url.qdrant.tech",
				"QDRANT_API_KEY": "your-qdrant-api-key",
				"EMBEDDING_PROVIDER": "ollama",
				"OLLAMA_URL": "http://localhost:11434"
		}
}
```

With OpenAI:
```json
{
		"env": {
				"QDRANT_URL": "https://your-cluster-url.qdrant.tech",
				"QDRANT_API_KEY": "your-qdrant-api-key",
				"EMBEDDING_PROVIDER": "openai",
				"OPENAI_API_KEY": "your-openai-api-key"
		}
}
```

### Environment Variables

#### Qdrant Configuration
- `QDRANT_URL` (required): URL of your Qdrant instance
  - For local: http://localhost:6333
  - For cloud: https://your-cluster-url.qdrant.tech
- `QDRANT_API_KEY` (required for cloud): Your Qdrant Cloud API key

#### Embeddings Configuration
- `EMBEDDING_PROVIDER` (optional): Choose between 'ollama' (default) or 'openai'
- `EMBEDDING_MODEL` (optional):
  - For Ollama: defaults to 'nomic-embed-text'
  - For OpenAI: defaults to 'text-embedding-3-small'
- `OLLAMA_URL` (optional): URL of your Ollama instance (defaults to http://localhost:11434)
- `OPENAI_API_KEY` (required if using OpenAI): Your OpenAI API key

## Available Tools

1. `add_url_documentation`
   - Add documentation from a URL to the RAG database
   - Automatically extracts meaningful content while removing boilerplate elements
   - Parameters:
     - `url` (required): Complete URL of the documentation to fetch (must include protocol)

2. `add_local_documentation`
   - Add documentation from local files or directories
   - Supports recursive directory processing
   - Parameters:
     - `path` (required): Absolute path to the file or directory to process

3. `search_documentation`
   - Search through stored documentation using natural language queries
   - Returns ranked results with context
   - Parameters:
     - `query` (required): Search query text
     - `limit` (optional): Maximum results to return (1-20, default: 5)

4. `list_sources`
   - List all documentation sources with hierarchical organization
   - Shows both web and local documentation sources
   - Parameters:
     - `expanded` (optional): Show detailed URL listings under each domain (default: false)

5. `extract_urls`
   - Extract and analyze URLs from a webpage
   - Can automatically add discovered URLs to the processing queue
   - Parameters:
     - `url` (required): URL to analyze
     - `add_to_queue` (optional): Add extracted URLs to queue (default: false)

6. `check_files`
   - Scan local filesystem and list all supported files
   - Can add found files to the processing queue
   - Parameters:
     - `path` (required): Path to scan
     - `add_to_queue` (optional): Add found files to queue (default: false)

7. `wipe_database`
   - Remove all stored documentation
   - Reinitializes empty collections
   - No parameters required

8. `remove_documentation`
   - Remove specific documentation from the database
   - Supports both URLs and file paths
   - Parameters:
     - `paths` (required): Array of paths to remove

9. `list_queue`
   - Show pending items in the documentation processing queue
   - Displays queue contents with status
   - No parameters required

10. `run_queue`
    - Process all items in the documentation queue
    - Supports batch processing with retry logic
    - Parameters:
      - `maxConcurrent` (optional): Max parallel items (1-5, default: 3)
      - `retryAttempts` (optional): Number of retries (0-5, default: 3)
      - `retryDelay` (optional): Delay between retries in ms (1000-10000, default: 1000)
      - `batchSize` (optional): Chunk batch size (1-100, default: 20)

11. `clear_queue`
    - Remove all items from the processing queue
    - Immediate and permanent operation
    - No parameters required

12. `remove_from_queue`
    - Remove specific items from the processing queue
    - Provides suggestions for case-insensitive matches
    - Parameters:
      - `paths` (required): Array of URLs or file paths to remove

## Example Usage

In Claude Desktop or any other MCP-compatible client:

1. Add web documentation:
```
Add this documentation: https://docs.example.com/api
```

2. Add local documentation:
```
Add documentation from this folder: C:\Users\YourName\Documents\ProjectDocs
```

3. Search documentation:
```
Search the documentation for: how to implement authentication
```

4. List current sources:
```
Show me all documentation sources
```

5. Queue management:
```
Extract URLs from: https://docs.example.com/api
List the current queue
Run the queue with 3 concurrent items
Clear the queue
```

6. Remove documentation:
```
Remove documentation: docs/outdated-guide.md
```

## Supported File Types

The following file extensions are supported for local documentation:
- Markdown: `.md`, `.mdx`, `.markdown`
- Text: `.txt`
- Source code: `.js`, `.jsx`, `.ts`, `.tsx`, `.py`, `.java`, `.c`, `.cpp`, `.h`, `.hpp`
- Configuration: `.json`, `.yaml`, `.yml`, `.xml`, `.conf`, `.ini`
- Web: `.html`, `.htm`, `.css`
- Scripts: `.sh`, `.bash`, `.zsh`, `.ps1`, `.bat`, `.cmd`
- Other: `.sql`, `.log`

## Development

1. Clone the repository:
```bash
git clone https://github.com/qpd-v/mcp-server-ragdocs.git
cd mcp-server-ragdocs
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Run locally:
```bash
npm start
```

## License

APACHE 2.0

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
