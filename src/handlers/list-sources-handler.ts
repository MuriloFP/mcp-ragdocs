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
      const expanded = args.expanded as boolean || false;
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
        lines.push('🌐 Web Documentation Sources:');
        lines.push('');

        // Group URLs by domain
        const domainGroups = new Map<string, Source[]>();
        
        for (const source of urlSources) {
          try {
            const url = new URL(source.url);
            const domain = `${url.protocol}//${url.hostname}/`;
            const group = domainGroups.get(domain) || [];
            group.push(source);
            domainGroups.set(domain, group);
          } catch {
            // If URL parsing fails, treat it as a standalone entry
            lines.push(`  • 📚 ${source.title}`);
            lines.push(`    ${source.url}`);
          }
        }

        // Display grouped URLs
        for (const [domain, sources] of domainGroups) {
          // Find the source that matches the base domain URL
          const baseSource = sources.find(s => s.url === domain) || sources[0];
          // Use the base source's title, removing any page-specific information
          const baseTitle = baseSource.title.split(' - ')[0].split(' | ')[0].trim();
          lines.push(`  • 📚 ${baseTitle}`);
          lines.push(`    ${domain}`);
          
          // If expanded, show all URLs under this domain
          if (expanded && sources.length > 1) {
            for (const source of sources) {
              // Skip if it's the same as the domain
              if (source.url === domain) continue;
              lines.push(`      - ${source.url}`);
            }
          }
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
    const entries = Array.from(node.children.entries()).sort(([nameA], [nameB]) => {
      // Sort folders before files, then alphabetically
      const isAFolder = node.children.get(nameA)?.isFolder || false;
      const isBFolder = node.children.get(nameB)?.isFolder || false;
      if (isAFolder !== isBFolder) {
        return isAFolder ? -1 : 1;
      }
      return nameA.localeCompare(nameB);
    });

    entries.forEach(([name, child], index) => {
      const isLast = index === entries.length - 1;
      const icon = child.isFolder ? '📁' : '📄';
      const connector = isLast ? '└──' : '├──';
      const newPrefix = prefix + (isLast ? '    ' : '│   ');

      // Check if this is a folder with only folders as children (no files)
      const hasOnlyFolderChildren = child.isFolder && 
        Array.from(child.children.values()).every(grandchild => grandchild.isFolder);
      
      // If this is a folder with only folder children and it's not empty, use "..."
      if (hasOnlyFolderChildren && child.children.size > 0) {
        const lastDescendant = this.findFirstFolderWithFiles(child);
        if (lastDescendant) {
          lines.push(`${prefix}...📁${lastDescendant.name}`);
          this.renderTree(lastDescendant, newPrefix, lines);
          return;
        }
      }
      
      lines.push(`${prefix}${connector} ${icon} ${name}`);
      
      if (child.children.size > 0) {
        this.renderTree(child, newPrefix, lines);
      }
    });
  }

  private findFirstFolderWithFiles(node: TreeNode): TreeNode | null {
    // If this folder contains any files directly, return it
    const hasFiles = Array.from(node.children.values()).some(child => !child.isFolder);
    if (hasFiles) {
      return node;
    }

    // Otherwise, recursively check children
    for (const child of node.children.values()) {
      if (child.isFolder) {
        const result = this.findFirstFolderWithFiles(child);
        if (result) {
          return result;
        }
      }
    }

    return null;
  }
} 