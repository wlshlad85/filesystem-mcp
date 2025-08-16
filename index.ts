#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import path from "path";
import os from 'os';
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { diffLines, createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';
import { chromium, Browser, Page, BrowserContext } from 'playwright';

// Command line argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: mcp-server-filesystem <allowed-directory> [additional-directories...]");
  process.exit(1);
}

// Normalize all paths consistently
function normalizePath(p: string): string {
  return path.normalize(p);
}

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

// Store allowed directories in normalized form
const allowedDirectories = args.map(dir =>
  normalizePath(path.resolve(expandHome(dir)))
);

// Validate that all directories exist and are accessible
await Promise.all(args.map(async (dir) => {
  try {
    const stats = await fs.stat(expandHome(dir));
    if (!stats.isDirectory()) {
      console.error(`Error: ${dir} is not a directory`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error accessing directory ${dir}:`, error);
    process.exit(1);
  }
}));

// Security utilities
async function validatePath(requestedPath: string): Promise<string> {
  const expandedPath = expandHome(requestedPath);
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath);

  const normalizedRequested = normalizePath(absolute);

  // Check if path is within allowed directories
  const isAllowed = allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
  if (!isAllowed) {
    throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute);
    const normalizedReal = normalizePath(realPath);
    const isRealPathAllowed = allowedDirectories.some(dir => normalizedReal.startsWith(dir));
    if (!isRealPathAllowed) {
      throw new Error("Access denied - symlink target outside allowed directories");
    }
    return realPath;
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute);
    try {
      const realParentPath = await fs.realpath(parentDir);
      const normalizedParent = normalizePath(realParentPath);
      const isParentAllowed = allowedDirectories.some(dir => normalizedParent.startsWith(dir));
      if (!isParentAllowed) {
        throw new Error("Access denied - parent directory outside allowed directories");
      }
      return absolute;
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
  }
}

// Schema definitions
const ReadFileArgsSchema = z.object({
  path: z.string(),
  tail: z.number().optional().describe('If provided, returns only the last N lines of the file'),
  head: z.number().optional().describe('If provided, returns only the first N lines of the file')
});

const ReadMultipleFilesArgsSchema = z.object({
  paths: z.array(z.string()),
});

const WriteFileArgsSchema = z.object({
  path: z.string(),
  content: z.string(),
});

const EditOperation = z.object({
  oldText: z.string().describe('Text to search for - must match exactly'),
  newText: z.string().describe('Text to replace with')
});

const EditFileArgsSchema = z.object({
  path: z.string(),
  edits: z.array(EditOperation),
  dryRun: z.boolean().default(false).describe('Preview changes using git-style diff format')
});

const CreateDirectoryArgsSchema = z.object({
  path: z.string(),
});

const ListDirectoryArgsSchema = z.object({
  path: z.string(),
});

const ListDirectoryWithSizesArgsSchema = z.object({
  path: z.string(),
  sortBy: z.enum(['name', 'size']).optional().default('name').describe('Sort entries by name or size'),
});

const DirectoryTreeArgsSchema = z.object({
  path: z.string(),
});

const MoveFileArgsSchema = z.object({
  source: z.string(),
  destination: z.string(),
});

const SearchFilesArgsSchema = z.object({
  path: z.string(),
  pattern: z.string(),
  excludePatterns: z.array(z.string()).optional().default([])
});

const GetFileInfoArgsSchema = z.object({
  path: z.string(),
});

// Playwright schemas
const PlaywrightLaunchArgsSchema = z.object({
  headless: z.boolean().optional().default(true).describe('Run browser in headless mode'),
  timeout: z.number().optional().default(30000).describe('Maximum time in milliseconds to wait for the browser instance to start'),
});

const PlaywrightNavigateArgsSchema = z.object({
  url: z.string().url().describe('The URL to navigate to'),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional().default('load').describe('When to consider navigation succeeded'),
  timeout: z.number().optional().default(30000).describe('Maximum navigation time in milliseconds'),
});

const PlaywrightScreenshotArgsSchema = z.object({
  path: z.string().optional().describe('The file path to save the screenshot. If not provided, returns base64'),
  fullPage: z.boolean().optional().default(false).describe('When true, takes a screenshot of the full scrollable page'),
  type: z.enum(['png', 'jpeg']).optional().default('png').describe('Screenshot image format'),
});

const PlaywrightClickArgsSchema = z.object({
  selector: z.string().describe('CSS selector of the element to click'),
  timeout: z.number().optional().default(5000).describe('Maximum time to wait for the element'),
  clickCount: z.number().optional().default(1).describe('Number of clicks'),
});

const PlaywrightFillArgsSchema = z.object({
  selector: z.string().describe('CSS selector of the input element'),
  value: z.string().describe('Value to fill'),
  timeout: z.number().optional().default(5000).describe('Maximum time to wait for the element'),
});

const PlaywrightEvaluateArgsSchema = z.object({
  script: z.string().describe('JavaScript code to execute in the page context'),
});

const PlaywrightWaitForSelectorArgsSchema = z.object({
  selector: z.string().describe('CSS selector to wait for'),
  state: z.enum(['attached', 'detached', 'visible', 'hidden']).optional().default('visible').describe('State to wait for'),
  timeout: z.number().optional().default(5000).describe('Maximum time to wait in milliseconds'),
});

const PlaywrightGetTextArgsSchema = z.object({
  selector: z.string().describe('CSS selector of the element to get text from'),
  timeout: z.number().optional().default(5000).describe('Maximum time to wait for the element'),
});

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

interface FileInfo {
  size: number;
  created: Date;
  modified: Date;
  accessed: Date;
  isDirectory: boolean;
  isFile: boolean;
  permissions: string;
}

// Server setup
const server = new Server(
  {
    name: "secure-filesystem-server",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Playwright browser state
let browser: Browser | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;

// Tool implementations
async function getFileStats(filePath: string): Promise<FileInfo> {
  const stats = await fs.stat(filePath);
  return {
    size: stats.size,
    created: stats.birthtime,
    modified: stats.mtime,
    accessed: stats.atime,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    permissions: stats.mode.toString(8).slice(-3),
  };
}

// ============================================================================
// CONFIGURATION CONSTANTS - Grouped for easy modification
// ============================================================================

// File reading limits
const FILE_SIZE_LIMIT = 1024 * 1024; // 1MB default
const FILE_SIZE_WARNING_THRESHOLD = 512 * 1024; // 512KB - warn before hitting limit
const DEFAULT_MAX_LINES = 1000; // Max lines when not using head/tail
const MAX_FILES_TO_READ = 10; // Maximum files for read_multiple_files
const MAX_TOTAL_SIZE_MULTIPLE_FILES = 5 * 1024 * 1024; // 5MB total for multiple files

// Directory listing limits
const MAX_DIR_ENTRIES = 500; // Maximum entries to return per directory
const MAX_DIR_ENTRIES_WARNING = 100; // Warn when directory has more than this

// Tree traversal limits
const MAX_TREE_DEPTH = 5; // Maximum depth for directory tree
const MAX_TREE_ENTRIES = 1000; // Maximum total entries in tree
const TREE_SKIP_PATTERNS = [
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.DS_Store',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.nyc_output',
  '.pytest_cache',
  '__pycache__',
  '.venv',
  'venv',
  '.env',
  'env',
  'vendor',
  'bower_components',
  'jspm_packages',
  '.npm',
  '.yarn',
  'tmp',
  'temp',
  '.tmp',
  '.temp',
  'logs',
  '*.log'
];

// Search limits
const MAX_SEARCH_RESULTS = 100; // Maximum search results to return
const MAX_SEARCH_DEPTH = 10; // Maximum depth for file search
const SEARCH_SKIP_PATTERNS = TREE_SKIP_PATTERNS; // Reuse same patterns for search

// Output formatting
const TRUNCATION_MESSAGE = (shown: number, total: number) => 
  `\n... truncated ${total - shown} additional entries ...`;
const SIZE_WARNING_MESSAGE = (size: number, limit: number) => 
  `\nWarning: File size (${formatSize(size)}) exceeds limit (${formatSize(limit)})`;

// ============================================================================
// END CONFIGURATION
// ============================================================================

// Normalize line endings for consistent processing
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

// Create a unified diff string for two file contents
function createUnifiedDiff(originalContent: string, newContent: string, filepath: string = 'file'): string {
  // Ensure consistent line endings for diff
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);

  return createTwoFilesPatch(
    filepath,
    filepath,
    normalizedOriginal,
    normalizedNew,
    'original',
    'modified'
  );
}

// Apply a series of text edits to a file, with optional dry run
async function applyFileEdits(
  filePath: string,
  edits: Array<{oldText: string, newText: string}>,
  dryRun = false
): Promise<string> {
  // Read file content and normalize line endings
  const content = normalizeLineEndings(await fs.readFile(filePath, 'utf-8'));

  // Apply edits sequentially
  let modifiedContent = content;
  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);

    // If exact match exists, use it
    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }

    // Otherwise, try line-by-line matching with flexibility for whitespace
    const oldLines = normalizedOld.split('\n');
    const contentLines = modifiedContent.split('\n');
    let matchFound = false;

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const potentialMatch = contentLines.slice(i, i + oldLines.length);

      // Compare lines with normalized whitespace
      const isMatch = oldLines.every((oldLine, j) => {
        const contentLine = potentialMatch[j];
        return oldLine.trim() === contentLine.trim();
      });

      if (isMatch) {
        // Preserve original indentation of first line
        const originalIndent = contentLines[i].match(/^\s*/)?.[0] || '';
        const newLines = normalizedNew.split('\n').map((line, j) => {
          if (j === 0) return originalIndent + line.trimStart();
          // For subsequent lines, try to preserve relative indentation
          const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] || '';
          const newIndent = line.match(/^\s*/)?.[0] || '';
          if (oldIndent && newIndent) {
            const relativeIndent = newIndent.length - oldIndent.length;
            return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
          }
          return line;
        });

        contentLines.splice(i, oldLines.length, ...newLines);
        modifiedContent = contentLines.join('\n');
        matchFound = true;
        break;
      }
    }

    if (!matchFound) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }

  // Create unified diff
  const diff = createUnifiedDiff(content, modifiedContent, filePath);

  // Format diff with appropriate number of backticks
  let numBackticks = 3;
  while (diff.includes('`'.repeat(numBackticks))) {
    numBackticks++;
  }
  const formattedDiff = `${'`'.repeat(numBackticks)}diff\n${diff}${'`'.repeat(numBackticks)}\n\n`;

  if (!dryRun) {
    await fs.writeFile(filePath, modifiedContent, 'utf-8');
  }

  return formattedDiff;
}

// Helper functions
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 B';
  
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  if (i === 0) return `${bytes} ${units[i]}`;
  
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

// Memory-efficient implementation to get the last N lines of a file
async function tailFile(filePath: string, numLines: number): Promise<string> {
  const CHUNK_SIZE = 1024; // Read 1KB at a time
  const stats = await fs.stat(filePath);
  const fileSize = stats.size;
  
  if (fileSize === 0) return '';
  
  // Open file for reading
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const lines: string[] = [];
    let position = fileSize;
    let chunk = Buffer.alloc(CHUNK_SIZE);
    let linesFound = 0;
    let remainingText = '';
    
    // Read chunks from the end of the file until we have enough lines
    while (position > 0 && linesFound < numLines) {
      const size = Math.min(CHUNK_SIZE, position);
      position -= size;
      
      const { bytesRead } = await fileHandle.read(chunk, 0, size, position);
      if (!bytesRead) break;
      
      // Get the chunk as a string and prepend any remaining text from previous iteration
      const readData = chunk.slice(0, bytesRead).toString('utf-8');
      const chunkText = readData + remainingText;
      
      // Split by newlines and count
      const chunkLines = normalizeLineEndings(chunkText).split('\n');
      
      // If this isn't the end of the file, the first line is likely incomplete
      // Save it to prepend to the next chunk
      if (position > 0) {
        remainingText = chunkLines[0];
        chunkLines.shift(); // Remove the first (incomplete) line
      }
      
      // Add lines to our result (up to the number we need)
      for (let i = chunkLines.length - 1; i >= 0 && linesFound < numLines; i--) {
        lines.unshift(chunkLines[i]);
        linesFound++;
      }
    }
    
    return lines.join('\n');
  } finally {
    await fileHandle.close();
  }
}

// New function to get the first N lines of a file
async function headFile(filePath: string, numLines: number): Promise<string> {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    const lines: string[] = [];
    let buffer = '';
    let bytesRead = 0;
    const chunk = Buffer.alloc(1024); // 1KB buffer
    
    // Read chunks and count lines until we have enough or reach EOF
    while (lines.length < numLines) {
      const result = await fileHandle.read(chunk, 0, chunk.length, bytesRead);
      if (result.bytesRead === 0) break; // End of file
      bytesRead += result.bytesRead;
      buffer += chunk.slice(0, result.bytesRead).toString('utf-8');
      
      const newLineIndex = buffer.lastIndexOf('\n');
      if (newLineIndex !== -1) {
        const completeLines = buffer.slice(0, newLineIndex).split('\n');
        buffer = buffer.slice(newLineIndex + 1);
        for (const line of completeLines) {
          lines.push(line);
          if (lines.length >= numLines) break;
        }
      }
    }
    
    // If there is leftover content and we still need lines, add it
    if (buffer.length > 0 && lines.length < numLines) {
      lines.push(buffer);
    }
    
    return lines.join('\n');
  } finally {
    await fileHandle.close();
  }
}

// Add helper to check if path should be skipped
function shouldSkipPath(pathName: string, skipPatterns: string[]): boolean {
  const baseName = path.basename(pathName);
  return skipPatterns.some(pattern => {
    if (pattern.includes('*')) {
      return minimatch(baseName, pattern);
    }
    return baseName === pattern;
  });
}

// Add helper to count lines efficiently without loading entire file
async function countFileLines(filePath: string): Promise<number> {
  const fileHandle = await fs.open(filePath, 'r');
  try {
    let lineCount = 0;
    let buffer = Buffer.alloc(65536); // 64KB buffer
    let leftover = '';
    let position = 0;
    
    while (true) {
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      
      const chunk = leftover + buffer.slice(0, bytesRead).toString('utf-8');
      const lines = chunk.split('\n');
      
      // Keep the last incomplete line for next iteration
      leftover = lines.pop() || '';
      lineCount += lines.length;
      position += bytesRead;
    }
    
    if (leftover) lineCount++; // Count the last line
    return lineCount;
  } finally {
    await fileHandle.close();
  }
}

// Update searchFiles to respect limits
async function searchFiles(
  rootPath: string,
  pattern: string,
  excludePatterns: string[] = []
): Promise<string[]> {
  const results: string[] = [];
  let totalChecked = 0;

  async function search(currentPath: string, depth: number = 0) {
    // Check depth limit
    if (depth > MAX_SEARCH_DEPTH) return;
    
    // Check results limit
    if (results.length >= MAX_SEARCH_RESULTS) return;

    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      try {
        // Validate each path before processing
        await validatePath(fullPath);

        // Check if we should skip this path
        if (shouldSkipPath(entry.name, SEARCH_SKIP_PATTERNS)) continue;

        // Check if path matches any exclude pattern
        const relativePath = path.relative(rootPath, fullPath);
        const shouldExclude = excludePatterns.some(pattern => {
          return minimatch(relativePath, pattern);
        });

        if (shouldExclude) continue;

        totalChecked++;

        if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
          results.push(fullPath);
          if (results.length >= MAX_SEARCH_RESULTS) {
            results.push(TRUNCATION_MESSAGE(results.length - 1, totalChecked));
            return;
          }
        }

        if (entry.isDirectory()) {
          await search(fullPath, depth + 1);
        }
      } catch (error) {
        // Skip invalid paths during search
        continue;
      }
    }
  }

  await search(rootPath);
  return results;
}

// Add new helper for directory tree with limits
async function getDirectoryTree(
  dirPath: string, 
  depth: number = 0,
  entriesCount: { count: number }
): Promise<any> {
  if (depth > MAX_TREE_DEPTH) {
    return {
      name: path.basename(dirPath),
      type: 'directory',
      children: [{ name: '... max depth reached ...', type: 'truncation' }]
    };
  }

  if (entriesCount.count >= MAX_TREE_ENTRIES) {
    return {
      name: path.basename(dirPath),
      type: 'directory',
      children: [{ name: '... max entries reached ...', type: 'truncation' }]
    };
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const tree: any = {
    name: path.basename(dirPath),
    type: 'directory',
    children: []
  };

  for (const entry of entries) {
    if (entriesCount.count >= MAX_TREE_ENTRIES) {
      tree.children.push({ name: '... max entries reached ...', type: 'truncation' });
      break;
    }

    // Skip patterns
    if (shouldSkipPath(entry.name, TREE_SKIP_PATTERNS)) continue;

    entriesCount.count++;

    if (entry.isDirectory()) {
      const subPath = path.join(dirPath, entry.name);
      try {
        await validatePath(subPath);
        const subTree = await getDirectoryTree(subPath, depth + 1, entriesCount);
        tree.children.push(subTree);
      } catch (error) {
        // Skip inaccessible directories
        tree.children.push({
          name: entry.name,
          type: 'directory',
          error: 'access denied'
        });
      }
    } else {
      tree.children.push({
        name: entry.name,
        type: 'file'
      });
    }
  }

  return tree;
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_file",
        description:
          "Read the complete contents of a file from the file system. " +
          "Handles various text encodings and provides detailed error messages " +
          "if the file cannot be read. Use this tool when you need to examine " +
          "the contents of a single file. Use the 'head' parameter to read only " +
          "the first N lines of a file, or the 'tail' parameter to read only " +
          "the last N lines of a file. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ReadFileArgsSchema) as ToolInput,
      },
      {
        name: "read_multiple_files",
        description:
          "Read the contents of multiple files simultaneously. This is more " +
          "efficient than reading files one by one when you need to analyze " +
          "or compare multiple files. Each file's content is returned with its " +
          "path as a reference. Failed reads for individual files won't stop " +
          "the entire operation. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput,
      },
      {
        name: "write_file",
        description:
          "Create a new file or completely overwrite an existing file with new content. " +
          "Use with caution as it will overwrite existing files without warning. " +
          "Handles text content with proper encoding. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput,
      },
      {
        name: "edit_file",
        description:
          "Make line-based edits to a text file. Each edit replaces exact line sequences " +
          "with new content. Returns a git-style diff showing the changes made. " +
          "Only works within allowed directories.",
        inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput,
      },
      {
        name: "create_directory",
        description:
          "Create a new directory or ensure a directory exists. Can create multiple " +
          "nested directories in one operation. If the directory already exists, " +
          "this operation will succeed silently. Perfect for setting up directory " +
          "structures for projects or ensuring required paths exist. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema) as ToolInput,
      },
      {
        name: "list_directory",
        description:
          "Get a detailed listing of all files and directories in a specified path. " +
          "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
          "prefixes. This tool is essential for understanding directory structure and " +
          "finding specific files within a directory. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
      },
      {
        name: "list_directory_with_sizes",
        description:
          "Get a detailed listing of all files and directories in a specified path, including sizes. " +
          "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
          "prefixes. This tool is useful for understanding directory structure and " +
          "finding specific files within a directory. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(ListDirectoryWithSizesArgsSchema) as ToolInput,
      },
      {
        name: "directory_tree",
        description:
            "Get a recursive tree view of files and directories as a JSON structure. " +
            "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
            "Files have no children array, while directories always have a children array (which may be empty). " +
            "The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema) as ToolInput,
      },
      {
        name: "move_file",
        description:
          "Move or rename files and directories. Can move files between directories " +
          "and rename them in a single operation. If the destination exists, the " +
          "operation will fail. Works across different directories and can be used " +
          "for simple renaming within the same directory. Both source and destination must be within allowed directories.",
        inputSchema: zodToJsonSchema(MoveFileArgsSchema) as ToolInput,
      },
      {
        name: "search_files",
        description:
          "Recursively search for files and directories matching a pattern. " +
          "Searches through all subdirectories from the starting path. The search " +
          "is case-insensitive and matches partial names. Returns full paths to all " +
          "matching items. Great for finding files when you don't know their exact location. " +
          "Only searches within allowed directories.",
        inputSchema: zodToJsonSchema(SearchFilesArgsSchema) as ToolInput,
      },
      {
        name: "get_file_info",
        description:
          "Retrieve detailed metadata about a file or directory. Returns comprehensive " +
          "information including size, creation time, last modified time, permissions, " +
          "and type. This tool is perfect for understanding file characteristics " +
          "without reading the actual content. Only works within allowed directories.",
        inputSchema: zodToJsonSchema(GetFileInfoArgsSchema) as ToolInput,
      },
      {
        name: "list_allowed_directories",
        description:
          "Returns the list of directories that this server is allowed to access. " +
          "Use this to understand which directories are available before trying to access files.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      // Playwright tools
      {
        name: "playwright_launch",
        description:
          "Launch a new browser instance using Playwright. This creates a browser context and page " +
          "that can be used for web automation. The browser runs in headless mode by default. " +
          "Only one browser instance can be active at a time.",
        inputSchema: zodToJsonSchema(PlaywrightLaunchArgsSchema) as ToolInput,
      },
      {
        name: "playwright_close",
        description:
          "Close the current browser instance and clean up all resources. " +
          "This should be called when you're done with browser automation.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "playwright_navigate",
        description:
          "Navigate the browser to a specified URL. Waits for the page to load according to the " +
          "specified criteria (load, domcontentloaded, or networkidle). " +
          "Requires an active browser instance from playwright_launch.",
        inputSchema: zodToJsonSchema(PlaywrightNavigateArgsSchema) as ToolInput,
      },
      {
        name: "playwright_screenshot",
        description:
          "Take a screenshot of the current page. Can capture the visible viewport or the full page. " +
          "If a path is provided within allowed directories, saves the screenshot to disk. " +
          "Otherwise returns the screenshot as base64-encoded data. " +
          "Requires an active browser instance.",
        inputSchema: zodToJsonSchema(PlaywrightScreenshotArgsSchema) as ToolInput,
      },
      {
        name: "playwright_click",
        description:
          "Click on an element matching the provided CSS selector. " +
          "Waits for the element to be visible and clickable before performing the action. " +
          "Requires an active browser instance.",
        inputSchema: zodToJsonSchema(PlaywrightClickArgsSchema) as ToolInput,
      },
      {
        name: "playwright_fill",
        description:
          "Fill an input field with the specified text. Clears any existing value before filling. " +
          "The element must be an input, textarea, or contenteditable element. " +
          "Requires an active browser instance.",
        inputSchema: zodToJsonSchema(PlaywrightFillArgsSchema) as ToolInput,
      },
      {
        name: "playwright_evaluate",
        description:
          "Execute JavaScript code in the context of the current page. " +
          "Returns the result of the evaluation. Can access page variables and DOM. " +
          "Requires an active browser instance.",
        inputSchema: zodToJsonSchema(PlaywrightEvaluateArgsSchema) as ToolInput,
      },
      {
        name: "playwright_wait_for_selector",
        description:
          "Wait for an element matching the CSS selector to reach the specified state. " +
          "States: 'attached' (DOM), 'detached' (removed), 'visible' (visible), 'hidden' (hidden). " +
          "Requires an active browser instance.",
        inputSchema: zodToJsonSchema(PlaywrightWaitForSelectorArgsSchema) as ToolInput,
      },
      {
        name: "playwright_get_text",
        description:
          "Get the text content of an element matching the provided CSS selector. " +
          "Waits for the element to be visible before retrieving text. " +
          "Requires an active browser instance.",
        inputSchema: zodToJsonSchema(PlaywrightGetTextArgsSchema) as ToolInput,
      },
    ],
  };
});


server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case "read_file": {
        const parsed = ReadFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for read_file: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        
        // Check file size before reading
        const stats = await fs.stat(validPath);
        if (stats.size > FILE_SIZE_LIMIT && !parsed.data.head && !parsed.data.tail) {
          throw new Error(
            `File size (${formatSize(stats.size)}) exceeds limit (${formatSize(FILE_SIZE_LIMIT)}). ` +
            `Use 'head' or 'tail' parameters to read partial content.`
          );
        }
        
        if (parsed.data.head && parsed.data.tail) {
          throw new Error("Cannot specify both head and tail");
        }
        
        if (parsed.data.tail) {
          const content = await tailFile(validPath, parsed.data.tail);
          return {
            content: [{ type: "text", text: content }],
          };
        }
        
        if (parsed.data.head) {
          const content = await headFile(validPath, parsed.data.head);
          return {
            content: [{ type: "text", text: content }],
          };
        }
        
        // For full file read, check line count
        if (stats.size > FILE_SIZE_WARNING_THRESHOLD) {
          const lineCount = await countFileLines(validPath);
          if (lineCount > DEFAULT_MAX_LINES) {
            const content = await headFile(validPath, DEFAULT_MAX_LINES);
            return {
              content: [{ 
                type: "text", 
                text: content + `\n\n... truncated after ${DEFAULT_MAX_LINES} lines (file has ${lineCount} total lines) ...`
              }],
            };
          }
        }
        
        const content = await fs.readFile(validPath, "utf-8");
        return {
          content: [{ type: "text", text: content }],
        };
      }

      case "read_multiple_files": {
        const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for read_multiple_files: ${parsed.error}`);
        }
        
        if (parsed.data.paths.length > MAX_FILES_TO_READ) {
          throw new Error(
            `Too many files requested (${parsed.data.paths.length}). Maximum is ${MAX_FILES_TO_READ}.`
          );
        }
        
        let totalSize = 0;
        const results = await Promise.all(
          parsed.data.paths.map(async (filePath: string) => {
            try {
              const validPath = await validatePath(filePath);
              const stats = await fs.stat(validPath);
              
              if (totalSize + stats.size > MAX_TOTAL_SIZE_MULTIPLE_FILES) {
                return `\n--- ${filePath} ---\n[Skipped: Total size limit exceeded]`;
              }
              
              if (stats.size > FILE_SIZE_LIMIT) {
                return `\n--- ${filePath} ---\n[Skipped: File too large (${formatSize(stats.size)})]`;
              }
              
              totalSize += stats.size;
              const content = await fs.readFile(validPath, "utf-8");
              
              // Apply line limit per file
              const lines = content.split('\n');
              if (lines.length > DEFAULT_MAX_LINES) {
                return `\n--- ${filePath} ---\n${lines.slice(0, DEFAULT_MAX_LINES).join('\n')}\n... truncated after ${DEFAULT_MAX_LINES} lines ...`;
              }
              
              return `\n--- ${filePath} ---\n${content}`;
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return `\n--- ${filePath} ---\n[Error: ${errorMessage}]`;
            }
          }),
        );
        return {
          content: [{ type: "text", text: results.join("\n---\n") }],
        };
      }

      case "write_file": {
        const parsed = WriteFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for write_file: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        await fs.writeFile(validPath, parsed.data.content, "utf-8");
        return {
          content: [{ type: "text", text: `Successfully wrote to ${parsed.data.path}` }],
        };
      }

      case "edit_file": {
        const parsed = EditFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for edit_file: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const result = await applyFileEdits(validPath, parsed.data.edits, parsed.data.dryRun);
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "create_directory": {
        const parsed = CreateDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for create_directory: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        await fs.mkdir(validPath, { recursive: true });
        return {
          content: [{ type: "text", text: `Successfully created directory ${parsed.data.path}` }],
        };
      }

      case "list_directory": {
        const parsed = ListDirectoryArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for list_directory: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        
        let formatted: string;
        if (entries.length > MAX_DIR_ENTRIES) {
          const truncated = entries.slice(0, MAX_DIR_ENTRIES);
          formatted = truncated
            .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
            .join("\n");
          formatted += TRUNCATION_MESSAGE(MAX_DIR_ENTRIES, entries.length);
        } else {
          formatted = entries
            .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
            .join("\n");
          
          if (entries.length > MAX_DIR_ENTRIES_WARNING) {
            formatted += `\n\nNote: Directory contains ${entries.length} entries.`;
          }
        }
        
        return {
          content: [{ type: "text", text: formatted }],
        };
      }

      case "list_directory_with_sizes": {
        const parsed = ListDirectoryWithSizesArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for list_directory_with_sizes: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        
        // Limit entries to process
        const entriesToProcess = entries.length > MAX_DIR_ENTRIES 
          ? entries.slice(0, MAX_DIR_ENTRIES)
          : entries;
        
        const entriesWithSizes = await Promise.all(
          entriesToProcess.map(async (entry) => {
            const fullPath = path.join(validPath, entry.name);
            if (entry.isDirectory()) {
              return { name: entry.name, size: 0, isDirectory: true };
            } else {
              try {
                const stats = await fs.stat(fullPath);
                return { name: entry.name, size: stats.size, isDirectory: false };
              } catch {
                return { name: entry.name, size: 0, isDirectory: false };
              }
            }
          })
        );
        
        // Sort entries based on sortBy parameter
        if (parsed.data.sortBy === 'size') {
          entriesWithSizes.sort((a, b) => b.size - a.size);
        } else {
          entriesWithSizes.sort((a, b) => a.name.localeCompare(b.name));
        }
        
        let formatted = entriesWithSizes
          .map((entry) => {
            const prefix = entry.isDirectory ? "[DIR] " : "[FILE]";
            const sizeStr = entry.isDirectory ? "" : ` (${formatSize(entry.size)})`;
            return `${prefix} ${entry.name}${sizeStr}`;
          })
          .join("\n");
        
        if (entries.length > MAX_DIR_ENTRIES) {
          formatted += TRUNCATION_MESSAGE(MAX_DIR_ENTRIES, entries.length);
        }
        
        return {
          content: [{ type: "text", text: formatted }],
        };
      }

      case "directory_tree": {
        const parsed = DirectoryTreeArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for directory_tree: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        
        const entriesCount = { count: 0 };
        const tree = await getDirectoryTree(validPath, 0, entriesCount);
        
        let result = JSON.stringify(tree, null, 2);
        if (entriesCount.count >= MAX_TREE_ENTRIES) {
          result += `\n\nNote: Output truncated at ${MAX_TREE_ENTRIES} entries.`;
        }
        
        return {
          content: [{ type: "text", text: result }],
        };
      }

      case "move_file": {
        const parsed = MoveFileArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for move_file: ${parsed.error}`);
        }
        const validSourcePath = await validatePath(parsed.data.source);
        const validDestPath = await validatePath(parsed.data.destination);
        await fs.rename(validSourcePath, validDestPath);
        return {
          content: [{ type: "text", text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}` }],
        };
      }

      case "search_files": {
        const parsed = SearchFilesArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for search_files: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const results = await searchFiles(
          validPath,
          parsed.data.pattern,
          parsed.data.excludePatterns
        );
        
        let output = results.join("\n");
        if (results.length === 0) {
          output = "No matching files found.";
        } else if (results.length >= MAX_SEARCH_RESULTS) {
          output += `\n\nNote: Results limited to ${MAX_SEARCH_RESULTS} matches.`;
        }
        
        return {
          content: [{ type: "text", text: output }],
        };
      }

      case "get_file_info": {
        const parsed = GetFileInfoArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`);
        }
        const validPath = await validatePath(parsed.data.path);
        const info = await getFileStats(validPath);
        return {
          content: [{ type: "text", text: Object.entries(info)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n") }],
        };
      }

      case "list_allowed_directories": {
        return {
          content: [{
            type: "text",
            text: `Allowed directories:\n${allowedDirectories.join('\n')}`
          }],
        };
      }

      // Playwright tool handlers
      case "playwright_launch": {
        const parsed = PlaywrightLaunchArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for playwright_launch: ${parsed.error}`);
        }
        
        // Close existing browser if any
        if (browser) {
          await browser.close();
        }
        
        browser = await chromium.launch({
          headless: parsed.data.headless,
          timeout: parsed.data.timeout,
        });
        context = await browser.newContext();
        page = await context.newPage();
        
        return {
          content: [{
            type: "text",
            text: "Browser launched successfully"
          }],
        };
      }

      case "playwright_close": {
        if (browser) {
          await browser.close();
          browser = null;
          context = null;
          page = null;
          return {
            content: [{
              type: "text",
              text: "Browser closed successfully"
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: "No browser instance to close"
          }],
        };
      }

      case "playwright_navigate": {
        if (!page) {
          throw new Error("No browser instance. Call playwright_launch first.");
        }
        
        const parsed = PlaywrightNavigateArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for playwright_navigate: ${parsed.error}`);
        }
        
        await page.goto(parsed.data.url, {
          waitUntil: parsed.data.waitUntil as any,
          timeout: parsed.data.timeout,
        });
        
        return {
          content: [{
            type: "text",
            text: `Navigated to ${parsed.data.url}`
          }],
        };
      }

      case "playwright_screenshot": {
        if (!page) {
          throw new Error("No browser instance. Call playwright_launch first.");
        }
        
        const parsed = PlaywrightScreenshotArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for playwright_screenshot: ${parsed.error}`);
        }
        
        const screenshotOptions: any = {
          fullPage: parsed.data.fullPage,
          type: parsed.data.type,
        };
        
        if (parsed.data.path) {
          // Validate path is within allowed directories
          const validPath = await validatePath(parsed.data.path);
          screenshotOptions.path = validPath;
          await page.screenshot(screenshotOptions);
          return {
            content: [{
              type: "text",
              text: `Screenshot saved to ${validPath}`
            }],
          };
        } else {
          const buffer = await page.screenshot(screenshotOptions);
          return {
            content: [{
              type: "text",
              text: buffer.toString('base64')
            }],
          };
        }
      }

      case "playwright_click": {
        if (!page) {
          throw new Error("No browser instance. Call playwright_launch first.");
        }
        
        const parsed = PlaywrightClickArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for playwright_click: ${parsed.error}`);
        }
        
        await page.click(parsed.data.selector, {
          timeout: parsed.data.timeout,
          clickCount: parsed.data.clickCount,
        });
        
        return {
          content: [{
            type: "text",
            text: `Clicked element: ${parsed.data.selector}`
          }],
        };
      }

      case "playwright_fill": {
        if (!page) {
          throw new Error("No browser instance. Call playwright_launch first.");
        }
        
        const parsed = PlaywrightFillArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for playwright_fill: ${parsed.error}`);
        }
        
        await page.fill(parsed.data.selector, parsed.data.value, {
          timeout: parsed.data.timeout,
        });
        
        return {
          content: [{
            type: "text",
            text: `Filled element ${parsed.data.selector} with value`
          }],
        };
      }

      case "playwright_evaluate": {
        if (!page) {
          throw new Error("No browser instance. Call playwright_launch first.");
        }
        
        const parsed = PlaywrightEvaluateArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for playwright_evaluate: ${parsed.error}`);
        }
        
        const result = await page.evaluate(parsed.data.script);
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }],
        };
      }

      case "playwright_wait_for_selector": {
        if (!page) {
          throw new Error("No browser instance. Call playwright_launch first.");
        }
        
        const parsed = PlaywrightWaitForSelectorArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for playwright_wait_for_selector: ${parsed.error}`);
        }
        
        await page.waitForSelector(parsed.data.selector, {
          state: parsed.data.state as any,
          timeout: parsed.data.timeout,
        });
        
        return {
          content: [{
            type: "text",
            text: `Element ${parsed.data.selector} is now ${parsed.data.state}`
          }],
        };
      }

      case "playwright_get_text": {
        if (!page) {
          throw new Error("No browser instance. Call playwright_launch first.");
        }
        
        const parsed = PlaywrightGetTextArgsSchema.safeParse(args);
        if (!parsed.success) {
          throw new Error(`Invalid arguments for playwright_get_text: ${parsed.error}`);
        }
        
        const element = await page.waitForSelector(parsed.data.selector, {
          timeout: parsed.data.timeout,
        });
        
        if (!element) {
          throw new Error(`Element not found: ${parsed.data.selector}`);
        }
        
        const text = await element.textContent();
        
        return {
          content: [{
            type: "text",
            text: text || ""
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
});

// Start server
// Cleanup function for browser
async function cleanupBrowser() {
  if (browser) {
    try {
      await browser.close();
      browser = null;
      context = null;
      page = null;
    } catch (error) {
      console.error("Error closing browser:", error);
    }
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  await cleanupBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanupBrowser();
  process.exit(0);
});

process.on('exit', () => {
  if (browser) {
    // Synchronous cleanup attempt on exit
    browser.close().catch(() => {});
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Secure MCP Filesystem Server running on stdio");
  console.error("Allowed directories:", allowedDirectories);
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
