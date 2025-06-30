# Filesystem MCP

A Model Context Protocol (MCP) server that provides secure filesystem access to AI assistants in Code Maestro Desktop.

## What it does

This MCP server allows AI assistants to:
- Read and write files
- Create and navigate directories
- Search for files
- Edit existing files with precision
- And more filesystem operations

All operations are restricted to the directories you explicitly allow.

## Why This Fork?

We forked the original `@modelcontextprotocol/server-filesystem` to make it more efficient for AI assistants. The original package could return extremely large outputs that waste tokens and overwhelm language models.

**Our improvements:**
- **Smart file reading limits** - Prevents reading gigantic files in full
- **Directory listing caps** - Returns manageable results even in folders with thousands of files
- **Depth-limited tree traversal** - Avoids getting lost in deep folder structures
- **Optimized search results** - Returns relevant matches without flooding the output
- **Skip large folders** - Automatically bypasses `node_modules`, `.git`, and similar directories

These changes ensure your AI assistant gets the information it needs without drowning in unnecessary data.

## Quick Start

**1. Open CM Desktop and click connectors**

**2. Click "Add" and paste the following JSON:**

```json
{
  "mcpServers": {
    "Code Maestro - Filesystem MCP": {
      "transport": "stdio",
      "enabled": true,
      "command": "npx",
      "args": [
        "github:codemaestroai/filesystem-mcp",
        "<YOUR_PROJECT_PATH>"
      ],
      "env": {},
      "url": null,
      "headers": null
    }
  }
}
```

**3. Replace `<YOUR_PROJECT_PATH>` with the actual path to your project directory**

Example paths:
- Windows: `"C:\\Users\\YourName\\Projects\\my-project"`
- macOS/Linux: `"/home/username/projects/my-project"`

You can specify multiple directories:
```json
"args": [
  "github:codemaestroai/filesystem-mcp",
  "/path/to/project1",
  "/path/to/project2"
]
```

## Security

- The MCP server can ONLY access directories you explicitly specify
- All file operations are logged
- Attempts to access files outside allowed directories will be rejected

**Note: This is a temporary solution. We're working on native file operation support in CM Desktop.**