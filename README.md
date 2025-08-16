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

## Playwright Integration

This MCP server now includes Playwright browser automation capabilities! Your AI assistant can:

- Launch and control a headless browser
- Navigate to URLs and take screenshots
- Click elements and fill forms
- Execute JavaScript in the browser context
- Wait for elements and extract text content

### Playwright Tools Available

- `playwright_launch` - Start a new browser instance
- `playwright_navigate` - Navigate to a URL
- `playwright_screenshot` - Take a screenshot of the current page
- `playwright_click` - Click on an element
- `playwright_fill` - Fill input fields
- `playwright_evaluate` - Execute JavaScript in the page
- `playwright_wait_for_selector` - Wait for elements to appear/disappear
- `playwright_get_text` - Extract text from elements
- `playwright_close` - Close the browser

### Example Usage

Your AI assistant can now automate web tasks:

```javascript
// Launch browser
await playwright_launch({ headless: true });

// Navigate to a website
await playwright_navigate({ url: "https://example.com" });

// Take a screenshot
await playwright_screenshot({ 
  path: "/allowed/path/screenshot.png",
  fullPage: true 
});

// Fill a form
await playwright_fill({ 
  selector: "#username", 
  value: "myusername" 
});

// Click a button
await playwright_click({ selector: "#submit-button" });

// Extract text
const text = await playwright_get_text({ selector: "h1" });

// Close browser
await playwright_close();
```

### Security Notes for Playwright

- Screenshots can only be saved to allowed directories
- The browser runs in a sandboxed environment
- Browser instances are automatically cleaned up on server shutdown

## Security

- The MCP server can ONLY access directories you explicitly specify
- All file operations are logged
- Attempts to access files outside allowed directories will be rejected
- Playwright operations are sandboxed and screenshots follow the same directory restrictions

**Note: This is a temporary solution. We're working on native file operation support in CM Desktop.**

## 🚀 Advanced Setup: Dual MCP Configuration

For advanced browser automation, we recommend running this filesystem MCP alongside Microsoft's Playwright MCP:

1. **Quick Setup**: Use `dual-mcp-config-windows.json` in CM Desktop
2. **Full Guide**: See [DUAL_MCP_SETUP.md](DUAL_MCP_SETUP.md) for detailed instructions
3. **Quick Reference**: Check [DUAL_MCP_QUICK_REFERENCE.md](DUAL_MCP_QUICK_REFERENCE.md) for tool comparison

This gives you the best of both worlds:
- **Filesystem MCP**: All file operations + basic browser automation
- **Microsoft Playwright MCP**: Advanced browser features (30+ tools, accessibility, network monitoring)