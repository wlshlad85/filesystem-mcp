# Dual MCP Setup: Filesystem + Microsoft Playwright

This guide explains how to run both the filesystem MCP (with basic Playwright) and Microsoft's advanced Playwright MCP simultaneously.

## Why Use Both?

- **Filesystem MCP**: Provides secure file operations, directory management, and basic browser automation
- **Microsoft Playwright MCP**: Offers advanced browser automation with 30+ tools, accessibility features, and enterprise-grade security

## Installation Steps

### 1. Setup Filesystem MCP (Already Done)
```bash
cd /mnt/c/Users/RICHARD/OneDrive/Documents/GitHub/filesystem-mcp
npm install
npm run build
```

### 2. Setup Microsoft Playwright MCP
```bash
cd /mnt/c/Users/RICHARD/OneDrive/Documents/GitHub
git clone https://github.com/microsoft/playwright-mcp.git
cd playwright-mcp
npm install
npm run build
npx playwright install chromium  # Install browser binaries
```

### 3. Configure Your MCP Client

#### Option A: Use the provided configuration file
Copy the contents of `dual-mcp-config.json` to your MCP client settings.

#### Option B: Manual configuration
Add both servers to your MCP configuration:

```json
{
  "mcpServers": {
    "filesystem-mcp": {
      "transport": "stdio",
      "enabled": true,
      "command": "node",
      "args": [
        "/path/to/filesystem-mcp/dist/index.js",
        "/path/to/allowed/directory"
      ]
    },
    "playwright-mcp": {
      "transport": "stdio", 
      "enabled": true,
      "command": "node",
      "args": [
        "/path/to/playwright-mcp/dist/index.js"
      ]
    }
  }
}
```

## Usage Examples

### When to Use Filesystem MCP

Use filesystem MCP for:
- File reading/writing operations
- Directory management
- File searching and information
- Basic browser tasks (if Microsoft's MCP is unavailable)

```javascript
// Filesystem operations
await read_file({ path: "/path/to/file.txt" });
await write_file({ path: "/path/to/new.txt", content: "Hello" });
await search_files({ path: "/path", pattern: "*.js" });

// Basic browser automation (filesystem MCP)
await playwright_launch({ headless: true });
await playwright_navigate({ url: "https://example.com" });
await playwright_screenshot({ path: "/path/to/screenshot.png" });
```

### When to Use Microsoft Playwright MCP

Use Microsoft's Playwright MCP for:
- Complex browser automation
- Accessibility testing
- Network monitoring
- Mobile device emulation
- Multi-tab management
- Advanced debugging

```javascript
// Advanced browser automation (Microsoft MCP)
await browser_init({ 
  headless: true,
  allowedOrigins: ["https://*.example.com"]
});

// Accessibility snapshot (better than screenshots for AI)
await browser_screenshot({
  name: "snapshot",
  useAria: true,
  fullPage: true
});

// Network monitoring
await browser_console({ action: "enable" });

// Mobile emulation
await browser_init({
  device: "iPhone 12"
});

// Multi-tab management
await browser_tabs_create({ url: "https://example.com" });
await browser_tabs_switch({ index: 1 });
```

## Tool Comparison

| Feature | Filesystem MCP | Microsoft Playwright MCP |
|---------|---------------|-------------------------|
| File Operations | ✅ Full support | ❌ Not available |
| Basic Browser Navigation | ✅ Available | ✅ Advanced |
| Screenshots | ✅ Basic | ✅ Advanced (with accessibility) |
| Network Monitoring | ❌ | ✅ Full support |
| Console Capture | ❌ | ✅ Available |
| Tab Management | ❌ | ✅ Full support |
| Mobile Emulation | ❌ | ✅ Available |
| Dialog Handling | ❌ | ✅ Available |
| PDF Generation | ❌ | ✅ Available |
| Security | Directory-based | Origin-based + capabilities |

## Best Practices

1. **Use filesystem MCP for all file operations** - It has specialized security for directory access
2. **Use Microsoft Playwright MCP for complex browser tasks** - It's more robust and feature-rich
3. **Don't run browser operations on both simultaneously** - This avoids resource conflicts
4. **Configure allowed directories/origins appropriately** for security

## Troubleshooting

### Both MCPs not showing up
- Ensure both are built: Check for `dist/index.js` in both directories
- Verify paths in configuration are absolute paths
- Check MCP client logs for errors

### Browser automation fails
- Run `npx playwright install chromium` in the playwright-mcp directory
- Check if another browser instance is already running
- Verify you have sufficient system resources

### File operations fail
- Ensure the filesystem MCP has the correct allowed directories
- Check file permissions
- Verify paths are within allowed directories

## Security Considerations

1. **Filesystem MCP**: Only allows access to specified directories
2. **Microsoft Playwright MCP**: 
   - Configure `allowedOrigins` to restrict web access
   - Use `blockedOrigins` to prevent specific sites
   - Enable only needed capabilities

## Example: Web Scraping with File Storage

```javascript
// 1. Use Microsoft MCP to navigate and extract data
await browser_init({ headless: true });
await browser_navigate({ url: "https://example.com/data" });
const data = await browser_eval({ 
  script: "document.querySelector('.data').innerText" 
});

// 2. Use Filesystem MCP to save the data
await write_file({ 
  path: "/allowed/path/scraped_data.txt",
  content: data
});

// 3. Clean up
await browser_close();
```

This dual setup gives you the best of both worlds - powerful file operations and advanced browser automation!