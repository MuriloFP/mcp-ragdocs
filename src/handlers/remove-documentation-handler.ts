import { BaseHandler } from './base-handler.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import path from 'path';

const COLLECTION_NAME = 'documentation';

interface DocumentPayload {
  fileName?: string;
  filePath?: string;
  relativePath?: string;
  url?: string;
}

function normalizePathForComparison(p: string): string {
  // Convert Windows path to forward slashes and lowercase
  return path.normalize(p).replace(/\\/g, '/').toLowerCase();
}

export class RemoveDocumentationHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      // Support both urls and paths
      const urls = args.urls ? this.validateStringArray(args, 'urls') : [];
      const paths = args.paths ? this.validateStringArray(args, 'paths') : [];

      if (urls.length === 0 && paths.length === 0) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Either urls or paths must be provided as a non-empty array'
        );
      }

      // For paths, first find all matching documents including those in subdirectories
      if (paths.length > 0) {
        // First, check if the files/directories exist in the database
        const searchResults = await this.context.qdrantClient.scroll(COLLECTION_NAME, {
          filter: {
            must: [
              {
                key: 'url',
                match: { text: 'file://' } // Only match file URLs
              }
            ]
          },
          limit: 100,
          with_payload: true
        });

        // For relative paths, filter the results to only include exact matches at the end of the path
        const filteredResults = searchResults.points.filter(record => {
          const payload = record.payload as DocumentPayload;
          if (!payload || !payload.url) return false;

          const storedPath = normalizePathForComparison(payload.url.replace('file://', ''));
          
          return paths.some(p => {
            if (path.isAbsolute(p)) {
              // For absolute paths, exact match
              return storedPath === normalizePathForComparison(p);
            } else {
              // For relative paths:
              const normalizedInput = normalizePathForComparison(p);
              // 1. Check if it's a direct file match at the end
              const isExactFileMatch = storedPath.endsWith('/' + normalizedInput);
              // 2. Check if it's a directory that appears in the path
              const isDirMatch = storedPath.includes('/' + normalizedInput + '/');
              // 3. Check if it matches the entire path (for single file case)
              const isFullMatch = storedPath === normalizedInput;
              
              return isExactFileMatch || isDirMatch || isFullMatch;
            }
          });
        });

        if (filteredResults.length === 0) {
          const notFoundPaths = paths.join(', ');
          const debugInfo = [
            `\nDebug information:`,
            `- Input paths: ${paths.join(', ')}`,
            `- Looking for matches where stored path contains:`,
            ...paths.map(p => {
              const normalizedInput = normalizePathForComparison(p);
              return `  • /${normalizedInput}/ (as directory) or /${normalizedInput} (as file)`;
            }),
            `\nAvailable documents in database:`,
            ...(await this.context.qdrantClient.scroll(COLLECTION_NAME, { limit: 10, with_payload: true }))
              .points.map(p => {
                const url = (p.payload as DocumentPayload).url;
                const storedPath = normalizePathForComparison(url!.replace('file://', ''));
                return `  • ${url} (normalized: ${storedPath})`;
              })
          ].join('\n');

          throw new McpError(
            ErrorCode.InvalidParams,
            `No documents found matching the specified path(s): ${notFoundPaths}${debugInfo}`
          );
        }

        // Check for ambiguous directory matches
        const dirMatches = new Map<string, Set<string>>();
        
        for (const record of filteredResults) {
          const payload = record.payload as DocumentPayload;
          if (!payload || !payload.url) continue;
          
          const storedPath = normalizePathForComparison(payload.url.replace('file://', ''));
          
          // For each input path that's not absolute, check if it matches as a directory
          for (const p of paths) {
            if (!path.isAbsolute(p)) {
              const normalizedInput = normalizePathForComparison(p);
              if (storedPath.includes('/' + normalizedInput + '/')) {
                // Extract the parent path up to the matching directory
                const parentPath = storedPath.substring(0, storedPath.indexOf('/' + normalizedInput + '/'));
                const matches = dirMatches.get(normalizedInput) || new Set();
                matches.add(parentPath);
                dirMatches.set(normalizedInput, matches);
              }
            }
          }
        }

        // Check if any directory name appears in multiple locations
        const ambiguousDirs = Array.from(dirMatches.entries())
          .filter(([_, locations]) => locations.size > 1)
          .map(([dirName, locations]) => ({
            dirName,
            locations: Array.from(locations)
          }));

        if (ambiguousDirs.length > 0) {
          const errorDetails = ambiguousDirs.map(d => 
            `\n- "${d.dirName}" found in multiple locations:\n  ${d.locations.map(loc => `• ${loc}/${d.dirName}`).join('\n  ')}`
          ).join('');
          
          throw new McpError(
            ErrorCode.InvalidParams,
            `Multiple directories found with the same name. Please use a more specific path to indicate which one to remove:${errorDetails}`
          );
        }

        // Group documents by their unique file paths (ignoring chunks)
        const uniqueFiles = new Map<string, Array<{id: string}>>();
        
        for (const record of filteredResults) {
          const payload = record.payload as DocumentPayload;
          if (!payload || !payload.url) continue;

          const fileUrl = payload.url;
          const filePath = fileUrl.replace('file://', '');
          
          const existing = uniqueFiles.get(filePath) || [];
          uniqueFiles.set(filePath, [...existing, {id: String(record.id)}]);
        }

        // Check for duplicates (different files with the same name)
        const filesByName = new Map<string, Array<string>>();
        for (const filePath of uniqueFiles.keys()) {
          const fileName = path.basename(filePath);
          const existing = filesByName.get(fileName) || [];
          if (!existing.includes(filePath)) {
            filesByName.set(fileName, [...existing, filePath]);
          }
        }

        const duplicates = Array.from(filesByName.entries())
          .filter(([_, paths]) => paths.length > 1)
          .map(([fileName, paths]) => ({
            fileName,
            paths
          }));

        if (duplicates.length > 0) {
          const errorDetails = duplicates.map(d => 
            `\n- "${d.fileName}" found in multiple locations: ${d.paths.join(', ')}`
          ).join('');
          
          throw new McpError(
            ErrorCode.InvalidParams,
            `Multiple files found with the same name. Please use full paths to specify which file to remove:${errorDetails}`
          );
        }

        // If no duplicates found, proceed with deletion
        const filter = {
          should: [
            ...urls.map((url) => ({
              key: 'url',
              match: { value: url }
            })),
            // Use the IDs from our filtered results for exact matches
            {
              has_id: filteredResults.map(r => r.id)
            }
          ]
        };

        // Delete matching documents
        const result = await this.context.qdrantClient.delete(COLLECTION_NAME, {
          filter,
          wait: true
        });

        if (!['acknowledged', 'completed'].includes(result.status)) {
          throw new Error('Delete operation failed');
        }

        // Map the results to show what was deleted
        const deletedPaths = Array.from(uniqueFiles.keys()).map(storedPath => {
          // For display, use the input path that matched
          const matchingInputPath = paths.find(p => {
            if (path.isAbsolute(p)) {
              return normalizePathForComparison(storedPath) === normalizePathForComparison(p);
            } else {
              const normalizedInput = normalizePathForComparison(p);
              // 1. Check if it's a direct file match at the end
              const isExactFileMatch = storedPath.endsWith('/' + normalizedInput);
              // 2. Check if it's a directory that appears in the path
              const isDirMatch = storedPath.includes('/' + normalizedInput + '/');
              // 3. Check if it matches the entire path (for single file case)
              const isFullMatch = storedPath === normalizedInput;
              
              return isExactFileMatch || isDirMatch || isFullMatch;
            }
          });
          return matchingInputPath || storedPath;
        });

        const chunkCount = filteredResults.length;
        const fileCount = uniqueFiles.size;
        return {
          content: [
            {
              type: 'text',
              text: `Successfully removed ${fileCount} file${fileCount !== 1 ? 's' : ''} (${chunkCount} chunks): ${deletedPaths.join(', ')}${urls.length > 0 ? ` and ${urls.length} URL${urls.length !== 1 ? 's' : ''}: ${urls.join(', ')}` : ''}`,
            },
          ],
        };
      }

      // If only URLs were provided
      // First check if URLs exist
      const urlSearchResults = await this.context.qdrantClient.scroll(COLLECTION_NAME, {
        filter: {
          should: urls.map((url) => ({
            key: 'url',
            match: { value: url }
          }))
        },
        limit: 100,
        with_payload: true
      });

      if (urlSearchResults.points.length === 0) {
        const notFoundUrls = urls.join(', ');
        throw new McpError(
          ErrorCode.InvalidParams,
          `No documents found matching the specified URL(s): ${notFoundUrls}`
        );
      }

      // Delete matching documents
      const result = await this.context.qdrantClient.delete(COLLECTION_NAME, {
        filter: {
          should: urls.map((url) => ({
            key: 'url',
            match: { value: url }
          }))
        },
        wait: true
      });

      if (!['acknowledged', 'completed'].includes(result.status)) {
        throw new Error('Delete operation failed');
      }

      return {
        content: [
          {
            type: 'text',
            text: `Successfully removed ${urlSearchResults.points.length} document${urlSearchResults.points.length !== 1 ? 's' : ''} from ${urls.length} URL${urls.length !== 1 ? 's' : ''}: ${urls.join(', ')}`,
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }
} 