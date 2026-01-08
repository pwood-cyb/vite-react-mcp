import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ViteDevServer } from 'vite';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import { getVersionString, waitForEvent } from '../shared/node_util.js';
import {
  GetComponentStatesSchema,
  GetComponentTreeSchema,
  GetUnnecessaryRerendersSchema,
  HighlightComponentSchema,
} from './schema.js';

const DEFAULT_VITE_PORT = 5173;

type McpServerEndpoints = {
  sse: {
    local: string[];
    network: string[];
  };
  messages: {
    local: string[];
    network: string[];
  };
};

type McpServerMetadata = {
  endpoints: McpServerEndpoints;
};

function buildEndpointUrls(origins: string[], pathname: string) {
  const normalizedPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
  return origins.map((origin) => new URL(normalizedPath, origin).toString());
}

function getFallbackOrigin(viteDevServer: ViteDevServer) {
  const isHttps = Boolean(viteDevServer.config.server?.https);
  const protocol = isHttps ? 'https' : 'http';
  const addressInfo = viteDevServer.httpServer?.address();

  if (addressInfo && typeof addressInfo === 'object' && addressInfo.port) {
    const host =
      addressInfo.address === '::' || addressInfo.address === '0.0.0.0'
        ? 'localhost'
        : addressInfo.address;
    return `${protocol}://${host}:${addressInfo.port}`;
  }

  const hostConfig = viteDevServer.config.server?.host;
  const host =
    typeof hostConfig === 'string' && hostConfig !== '0.0.0.0'
      ? hostConfig
      : 'localhost';
  const port = viteDevServer.config.server?.port ?? DEFAULT_VITE_PORT;

  return `${protocol}://${host}:${port}`;
}

function resolveOrigins(viteDevServer: ViteDevServer, type: 'local' | 'network') {
  const resolved = viteDevServer.resolvedUrls?.[type];
  if (resolved && resolved.length > 0) {
    return resolved;
  }

  if (type === 'local') {
    return [getFallbackOrigin(viteDevServer)];
  }

  return [];
}

function getMcpServerEndpoints(viteDevServer: ViteDevServer): McpServerEndpoints {
  const localOrigins = resolveOrigins(viteDevServer, 'local');
  const networkOrigins = resolveOrigins(viteDevServer, 'network');

  return {
    sse: {
      local: buildEndpointUrls(localOrigins, '/sse'),
      network: buildEndpointUrls(networkOrigins, '/sse'),
    },
    messages: {
      local: buildEndpointUrls(localOrigins, '/messages'),
      network: buildEndpointUrls(networkOrigins, '/messages'),
    },
  };
}

export function initMcpServer(viteDevServer: ViteDevServer): Server {
  const server = new Server(
    {
      name: 'vite-react-mcp',
      version: getVersionString(),
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'highlight-component',
          description: 'Highlight React component based on the component name.',
          inputSchema: zodToJsonSchema(HighlightComponentSchema),
        },
        {
          name: 'get-component-tree',
          description:
            'Get the React component tree of the current page in ASCII format.',
          inputSchema: zodToJsonSchema(GetComponentTreeSchema),
        },
        {
          name: 'get-component-states',
          description:
            'Get the React component props, states, and contexts in JSON structure format.',
          inputSchema: zodToJsonSchema(GetComponentStatesSchema),
        },
        {
          name: 'get-unnecessary-rerenders',
          description:
            'Get the wasted re-rendered components of the current page',
          inputSchema: zodToJsonSchema(GetUnnecessaryRerendersSchema),
        },
      ],
    };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<CallToolResult> => {
      try {
        switch (request.params.name) {
          case 'highlight-component': {
            const args = HighlightComponentSchema.parse(
              request.params.arguments,
            );
            viteDevServer.ws.send({
              type: 'custom',
              event: 'highlight-component',
              data: JSON.stringify(args),
            });

            const response = await waitForEvent<string>(
              viteDevServer,
              'highlight-component-response',
            );
            return {
              content: [{ type: 'text', text: response.data }],
            };
          }

          case 'get-component-tree': {
            const args = GetComponentTreeSchema.parse(request.params.arguments);
            viteDevServer.ws.send({
              type: 'custom',
              event: 'get-component-tree',
              data: JSON.stringify(args),
            });

            const response = await waitForEvent<string>(
              viteDevServer,
              'get-component-tree-response',
            );
            return {
              content: [{ type: 'text', text: response.data }],
            };
          }

          case 'get-component-states': {
            const args = GetComponentStatesSchema.parse(
              request.params.arguments,
            );
            viteDevServer.ws.send({
              type: 'custom',
              event: 'get-component-states',
              data: JSON.stringify(args),
            });

            const response = await waitForEvent<string>(
              viteDevServer,
              'get-component-states-response',
            );
            return {
              content: [{ type: 'text', text: response.data }],
            };
          }

          case 'get-unnecessary-rerenders': {
            const args = GetUnnecessaryRerendersSchema.parse(
              request.params.arguments,
            );

            viteDevServer.ws.send({
              type: 'custom',
              event: 'get-unnecessary-rerenders',
              data: JSON.stringify(args),
            });

            const response = await waitForEvent<string>(
              viteDevServer,
              'get-unnecessary-rerenders-response',
            );
            return {
              content: [{ type: 'text', text: response.data }],
            };
          }
          default:
            throw new Error(`Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new Error(`Invalid input: ${JSON.stringify(error.errors)}`);
        }
        throw error;
      }
    },
  );

  return server;
}

export function instrumentViteDevServer(
  viteDevServer: ViteDevServer,
  mcpServer: Server,
): McpServerMetadata {
  const transports = new Map<string, SSEServerTransport>();
  const endpoints = getMcpServerEndpoints(viteDevServer);

  viteDevServer.middlewares.use(
    '/.well-known/vite-react-mcp.json',
    async (_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-cache, max-age=0');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(
        JSON.stringify({
          name: 'vite-react-mcp',
          version: getVersionString(),
          transport: 'sse',
          endpoints,
        }),
      );
    },
  );

  viteDevServer.middlewares.use('/sse', async (_req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    const transport = new SSEServerTransport('/messages', res);
    transports.set(transport.sessionId, transport);
    res.on('close', () => {
      transports.delete(transport.sessionId);
    });
    await mcpServer.connect(transport);
  });

  viteDevServer.middlewares.use('/messages', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end('Method Not Allowed');
      return;
    }

    const query = new URLSearchParams(req.url?.split('?').pop() || '');
    const clientId = query.get('sessionId');

    if (!clientId || typeof clientId !== 'string') {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    const transport = transports.get(clientId);
    if (!transport) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    await transport.handlePostMessage(req, res);
  });

  return {
    endpoints,
  };
}
