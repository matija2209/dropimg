import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { eq, desc, isNull } from 'drizzle-orm';
import sharp from 'sharp';

import { db } from '../db/client.js';
import { images, imageVariants } from '../db/schema.js';
import { config, storage } from '../config.js';
import { serializeImageAsset, type AssetVariantName } from '../lib/image-assets.js';
import {
  createUploadTicket,
  getTicketResult,
} from '../lib/upload-ticket.js';
import {
  processAndStoreImage,
  uploadModes,
  type UploadMode,
  ImageProcessingError,
} from '../services/image-processing.js';
import type { ResolvedMcpIdentity } from '../lib/mcp-auth.js';

export async function readBodyToBuffer(body: unknown): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body && typeof body === 'object' && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Unsupported body type');
}

function resolveVariantKey(
  image: { filename: string; mimeType: string; variants: Array<{ variant: string; storageKey: string; mimeType: string }> },
  requestedVariant: string
) {
  if (requestedVariant === 'original') {
    return {
      variant: 'original' as AssetVariantName,
      storageKey: image.filename,
      mimeType: image.mimeType,
    };
  }

  const variant = image.variants.find((entry) => entry.variant === requestedVariant);
  if (!variant) {
    return null;
  }

  return {
    variant: variant.variant as AssetVariantName,
    storageKey: variant.storageKey,
    mimeType: variant.mimeType,
  };
}

export type McpServerContext = {
  authInfo?: ResolvedMcpIdentity;
  user?: {
    id: string;
    role?: string;
  };
  isAdmin?: boolean;
};

export function buildDropImgServer(context?: McpServerContext | any): McpServer {
  const callerUser = context?.authInfo?.user || context?.user;
  const isAdmin = Boolean(context?.authInfo?.isAdmin || context?.isAdmin || callerUser?.role === 'admin');

  const server = new McpServer(
    { name: 'dropimg', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        resources: { listChanged: true },
        prompts: {},
      },
      instructions:
        'DropImg MCP Server: Host, process, optimize, retrieve, and delete images with automatic responsive variants, private gallery isolation, and markdown generation. When an image exists in your local container, sandbox, or filesystem, call request_upload_url to generate a signed direct upload URL and upload it with curl instead of generating massive base64 text.',
    }
  );

  // 1. Tool: upload_image
  server.registerTool(
    'upload_image',
    {
      title: 'Upload Image',
      description:
        'Uploads an image to DropImg from a base64 string or a public image URL. Supports image compression, format conversion, and AI background removal.',
      inputSchema: z.object({
        imageData: z
          .string()
          .optional()
          .describe('Base64 encoded image string or Data URL (e.g. data:image/png;base64,...). Required if imageUrl is not provided.'),
        imageUrl: z
          .string()
          .url()
          .optional()
          .describe('Public HTTP/HTTPS URL of an image to download and host. Required if imageData is not provided.'),
        altName: z
          .string()
          .optional()
          .describe('Optional descriptive title or alt text for the image.'),
        mode: z
          .enum(uploadModes)
          .optional()
          .default('upload')
          .describe(
            "Processing mode: 'upload' (default), 'compress-jpg', 'png-to-jpg', 'strip-metadata', or 'remove-background'."
          ),
        quality: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Optional compression quality from 1 to 100.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ imageData, imageUrl, altName, mode, quality }): Promise<CallToolResult> => {
      if (!imageData && !imageUrl) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Error: Either imageData or imageUrl must be provided.' }],
        };
      }

      let buffer: Buffer;
      let detectedMime = 'image/png';
      let originalFilename = 'image.png';

      try {
        if (imageUrl) {
          const res = await fetch(imageUrl, {
            headers: { 'User-Agent': 'DropImg-MCP/1.0' },
            signal: AbortSignal.timeout(20000),
          });
          if (!res.ok) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Failed to download image from URL (${res.status} ${res.statusText})` }],
            };
          }
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.startsWith('image/')) {
            detectedMime = contentType.split(';')[0].trim();
          }
          const arrayBuf = await res.arrayBuffer();
          buffer = Buffer.from(arrayBuf);
          try {
            const urlObj = new URL(imageUrl);
            const pathParts = urlObj.pathname.split('/');
            const lastPart = pathParts[pathParts.length - 1];
            if (lastPart && lastPart.includes('.')) {
              originalFilename = decodeURIComponent(lastPart);
            }
          } catch {
            // fallback
          }
        } else {
          let rawBase64 = imageData!;
          const dataUrlMatch = rawBase64.match(/^data:([a-zA-Z0-9/+-]+);base64,(.+)$/);
          if (dataUrlMatch) {
            detectedMime = dataUrlMatch[1];
            rawBase64 = dataUrlMatch[2];
          }
          buffer = Buffer.from(rawBase64, 'base64');
          if (buffer.length === 0) {
            return {
              isError: true,
              content: [{ type: 'text', text: 'Provided base64 image data is empty.' }],
            };
          }
        }

        // Try detecting format via Sharp metadata if mime is generic or unknown
        try {
          const metadata = await sharp(buffer).metadata();
          if (metadata.format) {
            const formatMimeMap: Record<string, string> = {
              jpeg: 'image/jpeg',
              jpg: 'image/jpeg',
              png: 'image/png',
              webp: 'image/webp',
              gif: 'image/gif',
              svg: 'image/svg+xml',
              avif: 'image/avif',
            };
            if (formatMimeMap[metadata.format]) {
              detectedMime = formatMimeMap[metadata.format];
            }
          }
        } catch (sharpError) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Invalid or unreadable image data: ${(sharpError as Error).message}` }],
          };
        }

        if (!config.allowedTypes.includes(detectedMime)) {
          return {
            isError: true,
            content: [{ type: 'text', text: `File type ${detectedMime} is not allowed. Supported types: ${config.allowedTypes.join(', ')}` }],
          };
        }

        if (buffer.length > config.maxUploadMb * 1024 * 1024) {
          return {
            isError: true,
            content: [{ type: 'text', text: `File size exceeds ${config.maxUploadMb}MB limit.` }],
          };
        }

        const id = Math.random().toString(36).substring(2, 10);
        const deleteToken = Math.random().toString(36).substring(2, 15);

        const processed = await processAndStoreImage({
          id,
          fileName: originalFilename,
          mimeType: detectedMime,
          buffer,
          mode: (mode as UploadMode) || 'upload',
          quality,
          backgroundRemoval: {
            apiKey: config.photoroom.apiKey,
            apiUrl: config.photoroom.apiUrl,
            outputFormat: config.photoroom.outputFormat,
          },
          storage,
        });

        db.transaction((tx) => {
          tx.insert(images).values({
            id,
            filename: processed.original.storageKey,
            altName: altName || null,
            mimeType: processed.original.mimeType,
            mediaType: 'image',
            size: processed.original.size,
            width: processed.original.width,
            height: processed.original.height,
            isAnimated: processed.isAnimated,
            deleteToken,
            userId: callerUser?.id || null,
            source: callerUser ? 'mcp-user' : 'mcp',
            createdAt: new Date(),
          }).run();

          if (processed.variants.length > 0) {
            tx.insert(imageVariants).values(
              processed.variants.map((v) => ({
                imageId: id,
                variant: v.variant,
                storageKey: v.storageKey,
                mimeType: v.mimeType,
                size: v.size,
                width: v.width,
                height: v.height,
              }))
            ).run();
          }
        });

        const serialized = serializeImageAsset({
          id,
          filename: processed.original.storageKey,
          altName: altName || null,
          mimeType: processed.original.mimeType,
          mediaType: 'image',
          durationMs: null,
          transcoded: false,
          originalSize: null,
          size: processed.original.size,
          width: processed.original.width,
          height: processed.original.height,
          isAnimated: processed.isAnimated,
          deleteToken,
          userId: callerUser?.id || null,
          source: callerUser ? 'mcp-user' : 'mcp',
          createdAt: new Date(),
          variants: processed.variants.map((v) => ({
            imageId: id,
            variant: v.variant,
            storageKey: v.storageKey,
            mimeType: v.mimeType,
            size: v.size,
            width: v.width,
            height: v.height,
          })),
        });

        const pageUrl = `${config.appUrl}/i/${id}`;
        const rawUrl = `${config.publicBaseUrl}/raw/${processed.original.storageKey}`;
        const markdown = `![${altName || id}](${rawUrl})`;

        const resultPayload = {
          id,
          pageUrl,
          rawUrl,
          markdown,
          responsiveHtml: serialized.responsiveHtml,
          mimeType: processed.original.mimeType,
          width: processed.original.width,
          height: processed.original.height,
          size: processed.original.size,
          deleteToken,
          variants: serialized.variants,
          processing: processed.processing,
          userId: callerUser?.id || null,
        };

        return {
          content: [
            {
              type: 'text',
              text: `Image successfully uploaded and hosted on DropImg!\n\n- **ID**: \`${id}\`\n- **Direct URL**: ${rawUrl}\n- **Page View**: ${pageUrl}\n- **Markdown**: \`${markdown}\`\n- **Dimensions**: ${processed.original.width}x${processed.original.height} (${processed.original.mimeType})\n- **Delete Token**: \`${deleteToken}\`${callerUser ? `\n- **Owner**: \`${callerUser.id}\` (Private Gallery)` : ''}`,
            },
          ],
          structuredContent: resultPayload,
        };
      } catch (error) {
        const msg = error instanceof ImageProcessingError ? error.message : (error as Error).message;
        return {
          isError: true,
          content: [{ type: 'text', text: `Upload failed: ${msg}` }],
        };
      }
    }
  );

  // 2. Tool: get_image
  server.registerTool(
    'get_image',
    {
      title: 'Get Image',
      description:
        'Retrieves metadata, public URLs, responsive HTML, and optional base64 image content for visual inspection by multimodal AI models.',
      inputSchema: z.object({
        id: z.string().describe('The unique image ID or storage filename.'),
        variant: z
          .enum(['original', 'thumbnail', 'card', 'tablet', 'social'])
          .optional()
          .default('original')
          .describe('Image variant to fetch.'),
        includeImageData: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, returns a native MCP image block with base64 data for multimodal LLMs to view the image.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, variant = 'original', includeImageData = false }): Promise<CallToolResult> => {
      let image = await db.query.images.findFirst({
        where: eq(images.id, id),
        with: { variants: true },
      });

      if (!image) {
        image = await db.query.images.findFirst({
          where: eq(images.filename, id),
          with: { variants: true },
        });
      }

      if (!image) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Image not found: ${id}` }],
        };
      }

      // Check privacy: If owned by someone else and caller is not admin
      const isOwner = callerUser && callerUser.id === image.userId;
      if (image.userId && !isOwner && !isAdmin) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Image not found: ${id}` }],
        };
      }

      return await handleGetImage(image, variant, includeImageData);
    }
  );

  // 3. Tool: list_images
  server.registerTool(
    'list_images',
    {
      title: 'List Images',
      description: 'Lists images on DropImg with pagination, dimensions, and URLs. Scoped to the authenticated user.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(20).describe('Maximum number of images to return.'),
        offset: z.number().int().min(0).optional().default(0).describe('Pagination offset.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit = 20, offset = 0 }): Promise<CallToolResult> => {
      // Privacy scoping:
      // - Admins/Master see all
      // - Authenticated users see ONLY their own images
      // - Anonymous/Public see ONLY images without owner
      const whereClause = isAdmin
        ? undefined
        : callerUser
          ? eq(images.userId, callerUser.id)
          : isNull(images.userId);

      const rows = await db.query.images.findMany({
        where: whereClause,
        limit,
        offset,
        orderBy: [desc(images.createdAt)],
        with: { variants: true },
      });

      const items = rows.map((img) => {
        const serialized = serializeImageAsset(img);
        return {
          id: img.id,
          altName: img.altName,
          mimeType: img.mimeType,
          mediaType: img.mediaType,
          size: img.size,
          width: img.width,
          height: img.height,
          createdAt: img.createdAt,
          userId: img.userId,
          url: `${config.publicBaseUrl}/raw/${img.filename}`,
          pageUrl: `${config.appUrl}/i/${img.id}`,
          thumbnailUrl: serialized.variants?.thumbnail?.url,
        };
      });

      const markdownList = items
        .map(
          (item) =>
            `- **\`${item.id}\`**: [${item.altName || item.id}](${item.url}) (${item.width || '?'}x${item.height || '?'}, ${item.mimeType}) - [Page](${item.pageUrl})`
        )
        .join('\n');

      const scopeDesc = isAdmin ? 'All Images' : callerUser ? `Private Gallery (${callerUser.id})` : 'Public/Anonymous Images';

      return {
        content: [
          {
            type: 'text',
            text: items.length > 0 ? `Found ${items.length} images [${scopeDesc}] (offset ${offset}):\n\n${markdownList}` : `No images found [${scopeDesc}].`,
          },
        ],
        structuredContent: {
          scope: scopeDesc,
          count: items.length,
          offset,
          limit,
          images: items,
        },
      };
    }
  );

  // 4. Tool: delete_image
  server.registerTool(
    'delete_image',
    {
      title: 'Delete Image',
      description: 'Deletes an image and its responsive variants from DropImg.',
      inputSchema: z.object({
        id: z.string().describe('The unique image ID to delete.'),
        deleteToken: z
          .string()
          .optional()
          .describe('The delete token issued when the image was uploaded (not needed if you are the owner or admin).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id, deleteToken }): Promise<CallToolResult> => {
      const image = await db.query.images.findFirst({
        where: eq(images.id, id),
        with: { variants: true },
      });

      if (!image) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Image not found: ${id}` }],
        };
      }

      // Permission check:
      // 1. Authenticated user is the owner
      // 2. Authenticated user is an admin
      // 3. Valid delete token provided
      const isOwner = callerUser && image.userId === callerUser.id;
      const hasToken = deleteToken && (deleteToken === image.deleteToken || deleteToken === config.adminToken);

      if (!isOwner && !isAdmin && !hasToken) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Unauthorized: You do not have permission to delete this image.' }],
        };
      }

      await Promise.allSettled([
        storage.delete(image.filename),
        ...image.variants.map((v) => storage.delete(v.storageKey)),
      ]);

      db.transaction((tx) => {
        tx.delete(imageVariants).where(eq(imageVariants.imageId, id)).run();
        tx.delete(images).where(eq(images.id, id)).run();
      });

      return {
        content: [{ type: 'text', text: `Image ${id} successfully deleted.` }],
        structuredContent: { success: true, id },
      };
    }
  );

  // 5. Tool: request_upload_url (Direct Upload for Claude/Container/Sandbox)
  server.registerTool(
    'request_upload_url',
    {
      title: 'Request Direct Upload URL',
      description:
        'Generates a signed, temporary direct upload URL and curl command to upload an image directly from your local sandbox container or terminal. Use this when you have an image file inside your Claude sandbox, container, or terminal, avoiding large base64 tokens in chat context.',
      inputSchema: z.object({
        filename: z
          .string()
          .optional()
          .describe('Optional filename of the image in your local container (e.g. "screenshot.png").'),
        altName: z
          .string()
          .optional()
          .describe('Optional descriptive title or alt text for the image.'),
        mode: z
          .enum(uploadModes)
          .optional()
          .default('upload')
          .describe(
            "Processing mode: 'upload' (default), 'compress-jpg', 'png-to-jpg', 'strip-metadata', or 'remove-background'."
          ),
        quality: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Optional compression quality from 1 to 100.'),
        expiresInMinutes: z
          .number()
          .int()
          .min(1)
          .max(60)
          .optional()
          .default(15)
          .describe('Ticket expiration duration in minutes (default 15).'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ filename, altName, mode, quality, expiresInMinutes }): Promise<CallToolResult> => {
      const userId = callerUser?.id || (config.publicMode ? 'anonymous' : null);
      if (!userId) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'Authentication required: You must be authenticated to request a direct upload URL.',
            },
          ],
        };
      }

      const { ticket, ticketId, expiresAt } = createUploadTicket({
        userId,
        filename,
        altName,
        mode: mode as UploadMode,
        quality,
        expiresInSeconds: (expiresInMinutes || 15) * 60,
      });

      const uploadUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/api/upload/direct?ticket=${ticket}`;
      const targetFile = filename || 'image.png';
      const curlCommand = `curl -s -X POST -F "file=@${targetFile}" "${uploadUrl}"`;

      const responsePayload = {
        uploadUrl,
        ticketId,
        expiresAt: expiresAt.toISOString(),
        curlCommand,
        instructions:
          'Run the curl command directly in your sandbox/container shell. Once finished, parse the JSON response for directUrl, markdown, and pictureHtml.',
      };

      return {
        content: [
          {
            type: 'text',
            text:
              `Direct Upload URL generated successfully!\n\n` +
              `- **Ticket ID**: \`${ticketId}\`\n` +
              `- **Expires At**: ${expiresAt.toISOString()}\n\n` +
              `**Execute this command in your sandbox/container shell**:\n` +
              `\`\`\`bash\n${curlCommand}\n\`\`\`\n\n` +
              `The curl response will return the final image URLs, markdown embed code, and responsive HTML snippets.`,
          },
        ],
        structuredContent: responsePayload,
      };
    }
  );

  // 6. Tool: claim_upload_ticket
  server.registerTool(
    'claim_upload_ticket',
    {
      title: 'Claim Upload Ticket Result',
      description:
        'Retrieves the hosted image URLs, markdown embed code, and metadata for an image uploaded via a direct upload ticket.',
      inputSchema: z.object({
        ticketId: z.string().describe('The ticket ID returned by request_upload_url.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ ticketId }): Promise<CallToolResult> => {
      const result = getTicketResult(ticketId);
      if (!result) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `No upload found for ticket ID "${ticketId}". The file may not have finished uploading yet, or the ticket has expired.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text:
              `Image details for ticket \`${ticketId}\`:\n\n` +
              `- **ID**: \`${result.id}\`\n` +
              `- **Direct URL**: ${result.rawUrl || result.directUrl}\n` +
              `- **Page View**: ${result.pageUrl}\n` +
              `- **Markdown**: \`${result.markdown}\`\n` +
              `- **Dimensions**: ${result.width}x${result.height} (${result.mimeType})\n` +
              `- **Delete Token**: \`${result.deleteToken}\``,
          },
        ],
        structuredContent: result,
      };
    }
  );

  // 7. MCP Resource: dropimg://images/{id}
  server.registerResource(
    'image-metadata',
    new ResourceTemplate('dropimg://images/{id}', { list: undefined }),
    { description: 'Metadata, direct URLs, and responsive variants for an image asset' },
    async (uri, { id }) => {
      const image = await db.query.images.findFirst({
        where: eq(images.id, String(id)),
        with: { variants: true },
      });

      if (!image) {
        throw new Error(`Image not found: ${id}`);
      }

      const isOwner = callerUser && callerUser.id === image.userId;
      if (image.userId && !isOwner && !isAdmin) {
        throw new Error(`Image not found: ${id}`);
      }

      const serialized = serializeImageAsset(image);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(serialized, null, 2),
          },
        ],
      };
    }
  );

  // 6. MCP Prompt: embed_image
  server.registerPrompt(
    'embed_image',
    {
      description: 'Generates HTML and Markdown embedding snippets for an image hosted on DropImg.',
      argsSchema: {
        id: z.string().describe('Image ID'),
        altText: z.string().optional().describe('Alternative text for accessibility'),
      },
    },
    async ({ id, altText }) => {
      const image = await db.query.images.findFirst({
        where: eq(images.id, id),
        with: { variants: true },
      });

      const alt = altText || image?.altName || id;
      const rawUrl = `${config.publicBaseUrl}/raw/${image?.filename || id}`;

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Generate Markdown and HTML embed codes for image ${id} with alt text "${alt}". The raw URL is ${rawUrl}. Include responsive picture tag and direct markdown link.`,
            },
          },
        ],
      };
    }
  );

  return server;
}

async function handleGetImage(
  image: any,
  variantName: string,
  includeImageData: boolean
): Promise<CallToolResult> {
  const resolved = resolveVariantKey(image, variantName);
  if (!resolved) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Variant '${variantName}' not found for image ${image.id}` }],
    };
  }

  const serialized = serializeImageAsset(image);
  const rawUrl = `${config.publicBaseUrl}/raw/${resolved.storageKey}`;
  const pageUrl = `${config.appUrl}/i/${image.id}`;

  const contentBlocks: CallToolResult['content'] = [
    {
      type: 'text',
      text: `### Image: \`${image.id}\`\n\n- **Variant**: \`${resolved.variant}\`\n- **URL**: ${rawUrl}\n- **Page**: ${pageUrl}\n- **Dimensions**: ${image.width || '?'}x${image.height || '?'} (${image.mimeType})\n- **Size**: ${(image.size / 1024).toFixed(1)} KB\n- **Markdown**: \`![${image.altName || image.id}](${rawUrl})\``,
    },
  ];

  if (includeImageData && image.mediaType !== 'video') {
    try {
      const { body, mimeType } = await storage.get(resolved.storageKey);
      const buf = await readBodyToBuffer(body);
      contentBlocks.push({
        type: 'image',
        data: buf.toString('base64'),
        mimeType: mimeType || resolved.mimeType || 'image/png',
      });
    } catch (err) {
      console.error(`Failed to read image data for MCP tool:`, err);
    }
  }

  return {
    content: contentBlocks,
    structuredContent: {
      ...serialized,
      selectedVariant: resolved.variant,
      rawUrl,
      pageUrl,
    },
  };
}
