import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { BaseHandler } from './base-handler.js';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';

const QUEUE_FILE = path.join(process.cwd(), 'queue.txt');

export class ExtractUrlsHandler extends BaseHandler {
  async handle(args: Record<string, unknown>) {
    try {
      const url = this.validateRequiredString(args, 'url');
      const addToQueue = args.add_to_queue as boolean || false;

      // Validate URL format
      let baseUrl: URL;
      try {
        baseUrl = new URL(url);
      } catch (error) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid URL format: ${url}. Must be a valid URL including protocol (e.g., https://)`
        );
      }

      await this.context.apiClient.initBrowser();
      if (!this.context.apiClient.browser) {
        throw new McpError(
          ErrorCode.InternalError,
          'Browser initialization failed'
        );
      }
      const page = await this.context.apiClient.browser.newPage();

      try {
        const basePath = baseUrl.pathname.split('/').slice(0, 3).join('/'); // Get the base path (e.g., /3/ for Python docs)
        await page.goto(url, { waitUntil: 'networkidle' });
        const content = await page.content();
        const $ = cheerio.load(content);
        const urls = new Set<string>();

        $('a[href]').each((_, element) => {
          const href = $(element).attr('href');
          if (href) {
            try {
              const pageUrl = new URL(href, url);
              // Only include URLs from the same documentation section
              if (pageUrl.hostname === baseUrl.hostname && 
                  pageUrl.pathname.startsWith(basePath) && 
                  !pageUrl.hash && 
                  !pageUrl.href.endsWith('#')) {
                urls.add(pageUrl.href);
              }
            } catch (e) {
              // Ignore invalid URLs
            }
          }
        });

        const urlArray = Array.from(urls);

        if (addToQueue) {
          try {
            // Ensure queue file exists
            try {
              await fs.access(QUEUE_FILE);
            } catch {
              await fs.writeFile(QUEUE_FILE, '');
            }

            // Append URLs to queue
            const urlsToAdd = urlArray.join('\n') + (urlArray.length > 0 ? '\n' : '');
            await fs.appendFile(QUEUE_FILE, urlsToAdd);

            return {
              content: [
                {
                  type: 'text',
                  text: `Successfully added ${urlArray.length} URLs to the queue`,
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to add URLs to queue: ${error}`,
                },
              ],
              isError: true,
            };
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: urlArray.join('\n') || 'No URLs found on this page.',
            },
          ],
        };
      } finally {
        await page.close();
      }
    } catch (error) {
      return this.formatErrorResponse(error);
    }
  }
} 