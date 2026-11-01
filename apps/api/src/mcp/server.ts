import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { eq, desc, isNull, and } from 'drizzle-orm';
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
import { isVideoMime, mimeFromFileName } from '../lib/file-mime.js';
import {
  deleteDocument,
  findDocumentForCaller,
  isPdfFileName,
  listDocumentsForCaller,
  serializeDocument,
  type DocumentCaller,
} from '../services/documents.js';
import { processVideo, VideoProcessingError } from '../services/video-processing.js';
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

  const documentCaller: DocumentCaller = { id: callerUser?.id ?? null, isAdmin };

  const listDocumentsResult = async (limit: number, offset: number): Promise<CallToolResult> => {
    const rows = await listDocumentsForCaller(documentCaller, { limit, offset });
    const items = rows.map((doc) => serializeDocument(doc, { withUrl: false }));
    const lines = items
      .map((d) => `- **\`${d.id}\`**: ${d.originalFilename} (${(d.size / 1024).toFixed(1)} KB, ${d.pageCount ?? '?'} pages, ${d.visibility})`)
      .join('\n');
    return {
      content: [
        {
          type: 'text',
          text: items.length > 0
            ? `Found ${items.length} documents (offset ${offset}):\n\n${lines}\n\nCall get_document with an id to get a signed link that expires.`
            : 'No documents found.',
        },
      ],
      structuredContent: { count: items.length, offset, limit, documents: items },
    };
  };

  const deleteDocumentResult = async (id: string): Promise<CallToolResult> => {
    const doc = await findDocumentForCaller(id, documentCaller);
    if (!doc) {
      return { isError: true, content: [{ type: 'text', text: `Document not found: ${id}` }] };
    }
    try {
      await deleteDocument(doc);
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: `Failed to delete document ${id}: ${(error as Error).message}` }] };
    }
    return {
      content: [{ type: 'text', text: `Document ${id} deleted: the stored file is removed and all its links no longer work.` }],
      structuredContent: { success: true, id },
    };
  };

  const server = new McpServer(
    { name: 'dropimg', version: '1.0.0' },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
      },
      instructions:
        'DropImg MCP Server: Host, process, optimize, retrieve, and delete images, videos and PDF documents. Images and videos get automatic responsive variants, private gallery isolation, and markdown generation. ' +
        'When a file exists in your local container, sandbox, or filesystem, call request_upload_url to generate a signed direct upload URL and upload it with curl instead of generating massive base64 text. ' +
        'PDF documents (request_upload_url with mediaType "document", or any .pdf filename) are PRIVATE by default and stored exactly as uploaded: they have no permanent public URL, never appear in public galleries, and are shared only through signed links that EXPIRE (default 7 days, up to 30). ' +
        'After uploading a PDF, call claim_upload_ticket to get its link; when a link has expired or you need a new one, call get_document with the document id (and optional expiresInHours). Use list_documents to find documents and delete_document (or delete_image) to remove one and its stored file. ' +
        'Treat document links as secrets: share them only with the people who should read the document.',
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
        const rawUrl = `${config.cdnUrl}/raw/${processed.original.storageKey}`;
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

  // 1b. Tool: upload_video
  server.registerTool(
    'upload_video',
    {
      title: 'Upload Video',
      description:
        'Uploads a video to DropImg from a remote URL or base64 data string, generates a poster frame, extracts metadata, and returns playback URLs and HTML5 video embed code.',
      inputSchema: z.object({
        videoData: z
          .string()
          .optional()
          .describe('Base64 encoded video string or Data URL (e.g. data:video/mp4;base64,...). Required if videoUrl is not provided.'),
        videoUrl: z
          .string()
          .url()
          .optional()
          .describe('Public HTTP/HTTPS URL of a video to download and host. Required if videoData is not provided.'),
        filename: z
          .string()
          .optional()
          .describe('Optional filename with video extension (e.g. "demo.mp4", "clip.webm").'),
        altName: z
          .string()
          .optional()
          .describe('Optional descriptive title or caption for the video.'),
        transcode: z
          .boolean()
          .optional()
          .default(false)
          .describe('Optional transcode to web-optimized H.264 MP4 with faststart streaming.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ videoData, videoUrl, filename, altName, transcode = false }): Promise<CallToolResult> => {
      if (!config.videoUploadsEnabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Error: Video uploads are disabled on this server.' }],
        };
      }

      if (!videoData && !videoUrl) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'Error: Either videoData or videoUrl must be provided.' }],
        };
      }

      let buffer: Buffer;
      let detectedMime = 'video/mp4';
      let originalFilename = filename || 'video.mp4';

      try {
        if (videoData) {
          let base64Content = videoData;
          const dataUrlMatch = videoData.match(/^data:([^;]+);base64,(.+)$/);
          if (dataUrlMatch) {
            detectedMime = dataUrlMatch[1];
            base64Content = dataUrlMatch[2];
          }
          buffer = Buffer.from(base64Content, 'base64');
        } else if (videoUrl) {
          const response = await fetch(videoUrl);
          if (!response.ok) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Failed to fetch video from URL: HTTP ${response.status} ${response.statusText}` }],
            };
          }
          const arrayBuf = await response.arrayBuffer();
          buffer = Buffer.from(arrayBuf);
          const headerMime = response.headers.get('content-type')?.split(';')[0]?.trim();
          if (headerMime) detectedMime = headerMime;
          try {
            const urlObj = new URL(videoUrl);
            const pathname = urlObj.pathname;
            const nameFromPath = pathname.substring(pathname.lastIndexOf('/') + 1);
            if (nameFromPath) originalFilename = nameFromPath;
          } catch {
            // ignore
          }
        } else {
          return { isError: true, content: [{ type: 'text', text: 'No video provided.' }] };
        }

        if (buffer.length === 0) {
          return { isError: true, content: [{ type: 'text', text: 'Provided video is empty (0 bytes).' }] };
        }

        if (buffer.length > config.maxVideoUploadMb * 1024 * 1024) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Video size exceeds ${config.maxVideoUploadMb}MB limit.` }],
          };
        }

        const id = Math.random().toString(36).substring(2, 10);
        const deleteToken = Math.random().toString(36).substring(2, 15);

        const processed = await processVideo({
          id,
          fileName: originalFilename,
          mimeType: detectedMime,
          buffer,
          transcode,
          storage,
        });

        db.transaction((tx) => {
          tx.insert(images).values({
            id,
            filename: processed.original.storageKey,
            altName: altName || null,
            mimeType: processed.original.mimeType,
            mediaType: 'video',
            size: processed.original.size,
            width: processed.original.width,
            height: processed.original.height,
            durationMs: processed.durationMs,
            transcoded: processed.transcoded,
            originalSize: processed.originalSize,
            isAnimated: false,
            deleteToken,
            userId: callerUser?.id || null,
            source: 'mcp',
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
          mediaType: 'video',
          durationMs: processed.durationMs,
          transcoded: processed.transcoded,
          originalSize: processed.originalSize,
          size: processed.original.size,
          width: processed.original.width,
          height: processed.original.height,
          isAnimated: false,
          deleteToken,
          userId: callerUser?.id || null,
          source: 'mcp',
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
        const rawUrl = `${config.cdnUrl}/raw/${processed.original.storageKey}`;
        const posterUrl = serialized.variants.poster?.url;
        const markdown = posterUrl
          ? `[![${altName || id}](${posterUrl})](${pageUrl})`
          : `[Watch Video: ${altName || id}](${pageUrl})`;

        const resultPayload = {
          id,
          pageUrl,
          rawUrl,
          directUrl: serialized.directUrl,
          posterUrl,
          markdown,
          videoHtml: serialized.videoHtml,
          responsiveHtml: serialized.responsiveHtml,
          mediaType: 'video',
          mimeType: processed.original.mimeType,
          width: processed.original.width,
          height: processed.original.height,
          durationMs: processed.durationMs,
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
              text:
                `Video successfully uploaded and hosted on DropImg!\n\n` +
                `- **ID**: \`${id}\`\n` +
                `- **Direct Stream URL**: ${rawUrl}\n` +
                `- **Page View**: ${pageUrl}\n` +
                `- **Video HTML**: \`${serialized.videoHtml}\`\n` +
                `- **Poster**: ${posterUrl || 'None'}\n` +
                `- **Duration**: ${processed.durationMs ? `${(processed.durationMs / 1000).toFixed(1)}s` : 'Unknown'}\n` +
                `- **Dimensions**: ${processed.original.width || '?'}x${processed.original.height || '?'} (${processed.original.mimeType})\n` +
                `- **Delete Token**: \`${deleteToken}\`${callerUser ? `\n- **Owner**: \`${callerUser.id}\` (Private Gallery)` : ''}`,
            },
          ],
          structuredContent: resultPayload,
        };
      } catch (error) {
        const msg = error instanceof VideoProcessingError ? error.message : (error as Error).message;
        return {
          isError: true,
          content: [{ type: 'text', text: `Video upload failed: ${msg}` }],
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
          .enum(['original', 'thumbnail', 'card', 'tablet', 'social', 'poster'])
          .optional()
          .default('original')
          .describe('Asset variant to fetch (use "poster" for video poster frame).'),
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
        const doc = await findDocumentForCaller(id, documentCaller);
        if (doc) {
          return documentResult(`Document \`${doc.id}\` (documents are returned by get_document)`, serializeDocument(doc));
        }
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
      description: 'Lists images and videos on DropImg with pagination, dimensions, and URLs. Scoped to the authenticated user. Pass mediaType "document" to list private PDF documents instead.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(20).describe('Maximum number of images to return.'),
        offset: z.number().int().min(0).optional().default(0).describe('Pagination offset.'),
        mediaType: z
          .enum(['image', 'video', 'document'])
          .optional()
          .describe('Optional filter by media type. "document" lists your private PDF documents (same as list_documents). Omit to list images and videos.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit = 20, offset = 0, mediaType }): Promise<CallToolResult> => {
      if (mediaType === 'document') {
        return listDocumentsResult(limit, offset);
      }

      // Privacy scoping:
      // - Admins/Master see all
      // - Authenticated users see ONLY their own images
      // - Anonymous/Public see ONLY images without owner
      const ownerClause = isAdmin
        ? undefined
        : callerUser
          ? eq(images.userId, callerUser.id)
          : isNull(images.userId);
      const whereClause = mediaType ? and(ownerClause, eq(images.mediaType, mediaType)) : ownerClause;

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
          url: `${config.cdnUrl}/raw/${img.filename}`,
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
      description: 'Deletes an image, video, or PDF document (by id) from DropImg, including its variants and stored file.',
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
        // PDF documents live in their own table; delete_image works for them too.
        if (await findDocumentForCaller(id, documentCaller)) {
          return deleteDocumentResult(id);
        }
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
        'Generates a signed, temporary direct upload URL and curl command to upload an image, video, or PDF document directly from your local sandbox container or terminal. Use this when you have a file inside your Claude sandbox, container, or terminal, avoiding large base64 tokens in chat context. ' +
        'To upload a PDF pass mediaType "document" (or a filename ending in .pdf): documents are stored exactly as uploaded, are PRIVATE by default (no permanent public URL, never in public galleries), and are shared through signed links that EXPIRE (default 7 days). After running the curl command, call claim_upload_ticket to get the link; call get_document later for a fresh link when it expires.',
      inputSchema: z.object({
        filename: z
          .string()
          .optional()
          .describe('Optional filename of the file in your local container (e.g. "screenshot.png" or "recording.mp4").'),
        altName: z
          .string()
          .optional()
          .describe('Optional descriptive title or alt text for the media.'),
        mediaType: z
          .enum(['image', 'video', 'document'])
          .optional()
          .describe('Media type: "image", "video", or "document" (PDF only; private, expiring links). If omitted, inferred from the filename extension (e.g. .mp4, .mov, .webm, .pdf).'),
        visibility: z
          .enum(['private', 'public'])
          .optional()
          .describe('Documents only. "private" (default) returns expiring signed links only; "public" additionally gets a permanent unsigned URL. Ignored for images and videos.'),
        mode: z
          .enum(uploadModes)
          .optional()
          .default('upload')
          .describe(
            "Processing mode for images: 'upload' (default), 'compress-jpg', 'png-to-jpg', 'strip-metadata', or 'remove-background'."
          ),
        quality: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Optional compression quality from 1 to 100.'),
        transcode: z
          .boolean()
          .optional()
          .default(false)
          .describe('For video uploads: transcode to web-optimized H.264 MP4.'),
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
    async ({ filename, altName, mediaType, visibility, mode, quality, transcode = false, expiresInMinutes }): Promise<CallToolResult> => {
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

      const toolError = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

      const isDocument = mediaType === 'document' || (!mediaType && isPdfFileName(filename));
      if (!isDocument && mediaType && isPdfFileName(filename)) {
        return toolError(`"${filename}" is a PDF, but mediaType is "${mediaType}". Use mediaType "document" to upload PDFs.`);
      }

      if (isDocument) {
        if (!callerUser?.id) {
          return toolError('Authentication required: documents are private and can only be uploaded by an authenticated user.');
        }
        if (filename && !isPdfFileName(filename)) {
          return toolError(`Documents must be PDFs: filename "${filename}" does not end in .pdf.`);
        }
        if ((mode && mode !== 'upload') || quality !== undefined || transcode) {
          return toolError('The image options (mode, quality) and video option (transcode) do not apply to documents; PDFs are stored exactly as uploaded. Remove them and try again.');
        }

        const docFilename = filename || 'document.pdf';
        const { ticket, ticketId, expiresAt } = createUploadTicket({
          userId,
          filename: docFilename,
          altName,
          mediaType: 'document',
          visibility: visibility || 'private',
          expiresInSeconds: (expiresInMinutes || 15) * 60,
        });

        const uploadUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/api/upload/direct?ticket=${ticket}`;
        const curlCommand = `curl -s -X POST -F "file=@${docFilename}" "${uploadUrl}"`;

        return {
          content: [
            {
              type: 'text',
              text:
                `Direct Upload URL generated successfully!\n\n` +
                `- **Ticket ID**: \`${ticketId}\`\n` +
                `- **Media Type**: \`document\` (PDF, ${visibility || 'private'})\n` +
                `- **Max size**: ${config.maxDocumentUploadMb}MB\n` +
                `- **Expires At**: ${expiresAt.toISOString()}\n\n` +
                `**Execute this command in your sandbox/container shell**:\n` +
                `\`\`\`bash\n${curlCommand}\n\`\`\`\n\n` +
                `The file is validated by content (it must start with %PDF-). Then call claim_upload_ticket with this ticket ID to get a signed link that expires (default ${Math.round(config.documentUrlDefaultHours / 24)} days). Use get_document later for a fresh link.`,
            },
          ],
          structuredContent: {
            uploadUrl,
            ticketId,
            mediaType: 'document',
            visibility: visibility || 'private',
            maxSizeMb: config.maxDocumentUploadMb,
            expiresAt: expiresAt.toISOString(),
            curlCommand,
            instructions:
              'Run the curl command in your sandbox/container shell. Then call claim_upload_ticket with the ticketId to receive a signed document URL that expires; call get_document for a fresh link later.',
          },
        };
      }

      const fileExtMime = filename ? mimeFromFileName(filename) : undefined;
      const isVideo =
        mediaType === 'video' ||
        (fileExtMime ? isVideoMime(fileExtMime) : false);

      const { ticket, ticketId, expiresAt } = createUploadTicket({
        userId,
        filename,
        altName,
        mode: mode as UploadMode,
        quality,
        mediaType: isVideo ? 'video' : 'image',
        transcode,
        expiresInSeconds: (expiresInMinutes || 15) * 60,
      });

      const uploadUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/api/upload/direct?ticket=${ticket}`;
      const targetFile = filename || (isVideo ? 'video.mp4' : 'image.png');
      const curlCommand = `curl -s -X POST -F "file=@${targetFile}" "${uploadUrl}"`;

      const responsePayload = {
        uploadUrl,
        ticketId,
        mediaType: isVideo ? 'video' : 'image',
        expiresAt: expiresAt.toISOString(),
        curlCommand,
        instructions:
          'Run the curl command directly in your sandbox/container shell. Once finished, parse the JSON response for directUrl, markdown, and responsive HTML.',
      };

      return {
        content: [
          {
            type: 'text',
            text:
              `Direct Upload URL generated successfully!\n\n` +
              `- **Ticket ID**: \`${ticketId}\`\n` +
              `- **Media Type**: \`${isVideo ? 'video' : 'image'}\`\n` +
              `- **Expires At**: ${expiresAt.toISOString()}\n\n` +
              `**Execute this command in your sandbox/container shell**:\n` +
              `\`\`\`bash\n${curlCommand}\n\`\`\`\n\n` +
              `The curl response will return the final ${isVideo ? 'video stream' : 'image'} URLs, embed code, and responsive HTML snippets.`,
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
        'Retrieves the hosted URLs, embed code, and metadata for an image, video, or PDF document uploaded via a direct upload ticket. For documents this returns a signed URL that EXPIRES (default 7 days, set expiresInHours up to 720); the document itself has no permanent public URL.',
      inputSchema: z.object({
        ticketId: z.string().describe('The ticket ID returned by request_upload_url.'),
        expiresInHours: z
          .number()
          .int()
          .min(1)
          .max(config.documentUrlMaxHours)
          .optional()
          .describe(`Documents only: how long the signed link stays valid, in hours (default ${config.documentUrlDefaultHours}, maximum ${config.documentUrlMaxHours} = 30 days).`),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ ticketId, expiresInHours }): Promise<CallToolResult> => {
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

      if (result.mediaType === 'document') {
        const doc = await findDocumentForCaller(String(result.id), documentCaller);
        // A ticket result belongs to the uploader (or an admin); anyone else sees "not found".
        if (!doc) {
          return {
            isError: true,
            content: [{ type: 'text', text: `No upload found for ticket ID "${ticketId}". The document may have been deleted, or the ticket belongs to another user.` }],
          };
        }
        return documentResult(`Document details for ticket \`${ticketId}\``, serializeDocument(doc, { expiresInHours }));
      }

      const isVideo = result.mediaType === 'video';
      const embedLines = isVideo
        ? `- **Video HTML**: \`${result.videoHtml || result.responsiveHtml}\`\n- **Poster**: ${result.posterUrl || 'None'}\n- **Duration**: ${result.durationMs ? `${(Number(result.durationMs) / 1000).toFixed(1)}s` : 'Unknown'}`
        : `- **Markdown**: \`${result.markdown}\``;

      return {
        content: [
          {
            type: 'text',
            text:
              `${isVideo ? 'Video' : 'Image'} details for ticket \`${ticketId}\`:\n\n` +
              `- **ID**: \`${result.id}\`\n` +
              `- **Direct URL**: ${result.rawUrl || result.directUrl}\n` +
              `- **Page View**: ${result.pageUrl}\n` +
              `${embedLines}\n` +
              `- **Dimensions**: ${result.width || '?'}x${result.height || '?'} (${result.mimeType})\n` +
              `- **Delete Token**: \`${result.deleteToken}\``,
          },
        ],
        structuredContent: result,
      };
    }
  );

  // 6b. Tool: get_document
  server.registerTool(
    'get_document',
    {
      title: 'Get Document',
      description:
        'Returns metadata (filename, size, page count, visibility, created at) for a PDF document and a FRESH signed URL that expires. Use this whenever a previous link has expired or you need a new link for an existing document. Default expiry 7 days, maximum 30 days (expiresInHours).',
      inputSchema: z.object({
        id: z.string().describe('The document ID (starts with "doc_"), as returned by claim_upload_ticket or list_documents.'),
        expiresInHours: z
          .number()
          .int()
          .min(1)
          .max(config.documentUrlMaxHours)
          .optional()
          .describe(`How long the new signed link stays valid, in hours (default ${config.documentUrlDefaultHours} = 7 days, maximum ${config.documentUrlMaxHours} = 30 days).`),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ id, expiresInHours }): Promise<CallToolResult> => {
      const doc = await findDocumentForCaller(id, documentCaller);
      if (!doc) {
        return { isError: true, content: [{ type: 'text', text: `Document not found: ${id}` }] };
      }
      return documentResult(`Document \`${doc.id}\``, serializeDocument(doc, { expiresInHours }));
    }
  );

  // 6c. Tool: list_documents
  server.registerTool(
    'list_documents',
    {
      title: 'List Documents',
      description:
        'Lists PDF documents owned by the authenticated user (metadata only, newest first). Documents are private and never appear in public galleries. Signed links are not included in the list; call get_document with an id to get a fresh expiring link.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().default(20).describe('Maximum number of documents to return.'),
        offset: z.number().int().min(0).optional().default(0).describe('Pagination offset.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit = 20, offset = 0 }): Promise<CallToolResult> => listDocumentsResult(limit, offset)
  );

  // 6d. Tool: delete_document
  server.registerTool(
    'delete_document',
    {
      title: 'Delete Document',
      description:
        'Permanently deletes a PDF document: removes the stored file and its record, so every signed link stops working. Only the owner (or an admin) can delete a document.',
      inputSchema: z.object({
        id: z.string().describe('The document ID to delete.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ id }): Promise<CallToolResult> => deleteDocumentResult(id)
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
      const rawUrl = `${config.cdnUrl}/raw/${image?.filename || id}`;

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

type SerializedDocument = ReturnType<typeof serializeDocument>;

function documentResult(title: string, doc: SerializedDocument): CallToolResult {
  const withUrl = 'url' in doc ? doc : undefined;
  const lines = [
    `${title}:`,
    '',
    `- **ID**: \`${doc.id}\``,
    `- **Filename**: ${doc.originalFilename}`,
    `- **Size**: ${doc.size} bytes (${(doc.size / 1024).toFixed(1)} KB)`,
    `- **Pages**: ${doc.pageCount ?? 'unknown'}`,
    `- **Visibility**: ${doc.visibility}`,
    `- **Created**: ${doc.createdAt}`,
  ];
  if (withUrl) {
    lines.push(
      `- **Signed URL** (opens inline as PDF): ${withUrl.url}`,
      `- **URL expires**: ${withUrl.urlExpiresAt} (in ${withUrl.urlExpiresInHours}h). After this the link returns 403; call get_document for a fresh one.`
    );
    if ('permanentUrl' in withUrl) lines.push(`- **Permanent public URL**: ${withUrl.permanentUrl}`);
    else lines.push('- **Public URL**: none (private document; share only the expiring signed URL)');
  }
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: doc };
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
  const rawUrl = `${config.cdnUrl}/raw/${resolved.storageKey}`;
  const pageUrl = `${config.appUrl}/i/${image.id}`;

  const isVideo = image.mediaType === 'video';
  const embedText = isVideo
    ? `- **Video HTML**: \`${serialized.videoHtml}\`\n- **Duration**: ${image.durationMs ? `${(image.durationMs / 1000).toFixed(1)}s` : 'Unknown'}`
    : `- **Markdown**: \`![${image.altName || image.id}](${rawUrl})\``;

  const contentBlocks: CallToolResult['content'] = [
    {
      type: 'text',
      text: `### ${isVideo ? 'Video' : 'Image'}: \`${image.id}\`\n\n- **Variant**: \`${resolved.variant}\`\n- **URL**: ${rawUrl}\n- **Page**: ${pageUrl}\n- **Dimensions**: ${image.width || '?'}x${image.height || '?'} (${image.mimeType})\n- **Size**: ${(image.size / 1024).toFixed(1)} KB\n${embedText}`,
    },
  ];

  if (includeImageData && (image.mediaType !== 'video' || resolved.variant === 'poster')) {
    try {
      const { body, mimeType } = await storage.get(resolved.storageKey);
      const buf = await readBodyToBuffer(body);
      contentBlocks.push({
        type: 'image',
        data: buf.toString('base64'),
        mimeType: mimeType || resolved.mimeType || (image.mediaType === 'video' ? 'image/webp' : 'image/png'),
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
