#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildDropImgServer } from './server.js';

void serveStdio(buildDropImgServer);
console.error('[DropImg MCP] Server running on stdio');
