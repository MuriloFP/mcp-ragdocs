import { BaseHandler } from './base-handler.js';
import { isDocumentPayload } from '../types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import * as path from 'node:path';

const COLLECTION_NAME = 'documentation';
const SCROLL_LIMIT = 100;

interface Source {
  title: string;
  url: string;
  isLocal: boolean;
  normalizedPath?: string;
  pathSegments?: string[];
  depth?: number;
  isFolder?: boolean;
}

interface TreeNode {
  name: string;
  isFolder: boolean;
  children: Map<string, TreeNode>;
}

export class ListSourcesHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      const urlSources: Source[] = [];
      const localSources: Source[] = [];
      let hasMore = true;
      let offset = 0;

      while (hasMore) {
        const scroll = await this.context.qdrantClient.scroll(COLLECTION_NAME, {
          with_payload: true,
          limit: SCROLL_LIMIT,
          offset: offset,
        });

        for (const point of scroll.points) {
          if (isDocumentPayload(point.payload)) {
            const { title, url, path_segments, depth, is_folder } = point.payload;
            const isLocal = url.startsWith('file://');
            
            const source: Source = {
              title,
              url,
              isLocal,
              normalizedPath: isLocal ? path.normalize(url.replace('file://', '')).replace(/\\/g, '/') : undefined,
              pathSegments: path_segments,
              depth: depth as number,
              isFolder: is_folder as boolean
            };

            if (isLocal) {
              if (!localSources.some(s => s.normalizedPath === source.normalizedPath)) {
                localSources.push(source);
              }
            } else {
              if (!urlSources.some(s => s.url === source.url)) {
                urlSources.push(source);
              }
            }
          }
        }

        hasMore = scroll.points.length === SCROLL_LIMIT;
        offset += scroll.points.length;
      }

      // Sort sources
      urlSources.sort((a, b) => a.title.localeCompare(b.title));
      localSources.sort((a, b) => {
        const aPath = a.pathSegments?.join('/') || '';
        const bPath = b.pathSegments?.join('/') || '';
        return aPath.localeCompare(bPath);
      });

      // Format output
      const lines: string[] = [];
      
      if (urlSources.length > 0) {
        lines.push('Web Documentation Sources:');
        lines.push('');
        for (const source of urlSources) {
          lines.push(`  • ${source.title}`);
          lines.push(`    ${source.url}`);
        }
        lines.push('');
      }

      if (localSources.length > 0) {
        lines.push('Local Documentation Sources:');
        lines.push('');
        
        // Build tree structure
        const root: TreeNode = { name: '', isFolder: true, children: new Map() };
        for (const source of localSources) {
          if (!source.pathSegments) continue;
          
          let current = root;
          for (let i = 0; i < source.pathSegments.length; i++) {
            const segment = source.pathSegments[i];
            const isLast = i === source.pathSegments.length - 1;
            
            if (!current.children.has(segment)) {
              current.children.set(segment, {
                name: segment,
                isFolder: isLast ? !!source.isFolder : true,
                children: new Map()
              });
            }
            current = current.children.get(segment)!;
          }
        }

        // Render tree
        this.renderTree(root, '', lines);
      }

      if (lines.length === 0) {
        lines.push('No documentation sources found.');
      }

      return {
        content: [
          {
            type: 'text',
            text: lines.join('\n'),
          },
        ],
      };
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }

  private renderTree(node: TreeNode, prefix: string, lines: string[]) {
    for (const [name, child] of node.children.entries()) {
      const icon = child.isFolder ? '📁' : '📄';
      lines.push(`${prefix}${prefix ? '  ' : ''}${icon} ${name}`);
      
      if (child.children.size > 0) {
        this.renderTree(child, `${prefix}${prefix ? '  ' : ''}`, lines);
      }
    }
  }
} 