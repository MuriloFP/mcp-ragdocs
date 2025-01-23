import { HandlerContext } from '../types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export abstract class BaseHandler {
  protected context: HandlerContext;

  constructor(context: HandlerContext) {
    this.context = context;
  }

  abstract handle(args: Record<string, unknown>): Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;

  protected validateRequiredString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (value === undefined) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Missing required parameter: '${key}'`
      );
    }
    if (typeof value !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameter type: '${key}' must be a string, got ${typeof value}`
      );
    }
    if (value.trim().length === 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameter value: '${key}' cannot be empty`
      );
    }
    return value;
  }

  protected validateOptionalNumber(args: Record<string, unknown>, key: string, defaultValue: number): number {
    const value = args[key];
    if (value === undefined) return defaultValue;
    
    if (typeof value !== 'number') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameter type: '${key}' must be a number, got ${typeof value}`
      );
    }
    
    if (isNaN(value)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameter value: '${key}' must be a valid number, got NaN`
      );
    }
    
    return value;
  }

  protected validateOptionalBoolean(args: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
    const value = args[key];
    if (value === undefined) return defaultValue;
    
    if (typeof value !== 'boolean') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameter type: '${key}' must be a boolean, got ${typeof value}`
      );
    }
    
    return value;
  }

  protected validateStringArray(args: Record<string, unknown>, key: string): string[] {
    const value = args[key];
    if (!Array.isArray(value)) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid parameter type: '${key}' must be an array, got ${typeof value}`
      );
    }
    
    const invalidItems = value.filter(item => typeof item !== 'string');
    if (invalidItems.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid array contents: '${key}' must contain only strings, found items of type: ${invalidItems.map(item => typeof item).join(', ')}`
      );
    }
    
    return value;
  }

  protected formatErrorResponse(error: unknown): {
    content: Array<{ type: string; text: string }>;
    isError: true;
  } {
    let message: string;
    
    if (error instanceof McpError) {
      message = error.message;
    } else if (error instanceof Error) {
      message = error.message;
    } else {
      message = String(error);
    }

    return {
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
    };
  }
} 