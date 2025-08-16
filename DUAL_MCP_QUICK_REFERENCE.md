# Dual MCP Quick Reference

## 🗂️ Filesystem MCP Tools

### File Operations
- `read_file` - Read file contents (with head/tail options)
- `read_multiple_files` - Read multiple files at once
- `write_file` - Create or overwrite a file
- `edit_file` - Make line-based edits with diff output

### Directory Operations
- `create_directory` - Create directories
- `list_directory` - List directory contents
- `list_directory_with_sizes` - List with file sizes
- `directory_tree` - Get recursive tree structure
- `move_file` - Move or rename files/directories

### Search & Info
- `search_files` - Search for files by pattern
- `get_file_info` - Get file metadata
- `list_allowed_directories` - Show allowed paths

### Basic Browser (Filesystem MCP)
- `playwright_launch` - Start browser
- `playwright_navigate` - Go to URL
- `playwright_screenshot` - Take screenshot
- `playwright_click` - Click element
- `playwright_fill` - Fill input
- `playwright_evaluate` - Run JavaScript
- `playwright_wait_for_selector` - Wait for element
- `playwright_get_text` - Get element text
- `playwright_close` - Close browser

## 🎭 Microsoft Playwright MCP Tools

### Core Browser
- `browser_init` - Initialize browser with advanced options
- `browser_navigate` - Navigate with network control
- `browser_back` / `browser_forward` - Navigation history
- `browser_reload` - Reload page
- `browser_close` - Close browser

### Interaction
- `browser_click` - Click with advanced options
- `browser_fill` - Fill inputs
- `browser_hover` - Hover over elements
- `browser_select` - Select dropdown options
- `browser_drag` - Drag elements
- `browser_type` - Type with keyboard

### Content Extraction
- `browser_screenshot` - Screenshot with accessibility
- `browser_pdf` - Generate PDF
- `browser_get_text` - Extract text
- `browser_get_html` - Get HTML content
- `browser_eval` - Execute JavaScript

### Advanced Features
- `browser_console` - Capture console logs
- `browser_network` - Monitor network requests
- `browser_storage` - Manage cookies/storage
- `browser_wait_for` - Wait for various conditions
- `browser_tabs_*` - Tab management (create/close/switch)

### Mobile & Emulation
- Device emulation via `browser_init({ device: "iPhone 12" })`
- Geolocation, timezone, locale settings

## 🔧 Common Workflows

### File + Browser Combo
```javascript
// Microsoft MCP: Scrape data
await browser_init({});
await browser_navigate({ url: "https://api.example.com/data" });
const json = await browser_eval({ script: "document.body.innerText" });

// Filesystem MCP: Save data
await write_file({ 
  path: "/data/api_response.json",
  content: json 
});
```

### Screenshot Comparison
```javascript
// Filesystem MCP: Basic screenshot
await playwright_launch({});
await playwright_navigate({ url: "https://example.com" });
await playwright_screenshot({ path: "/screenshots/basic.png" });

// Microsoft MCP: Accessibility snapshot
await browser_init({});
await browser_navigate({ url: "https://example.com" });
await browser_screenshot({ 
  name: "accessible",
  useAria: true,
  fullPage: true 
});
```

### Directory + Browser Automation
```javascript
// Filesystem MCP: Create output directory
await create_directory({ path: "/output/reports" });

// Microsoft MCP: Generate PDFs
const urls = ["page1.com", "page2.com", "page3.com"];
for (const url of urls) {
  await browser_navigate({ url });
  await browser_pdf({ 
    path: `/output/reports/${url.replace('.com', '')}.pdf` 
  });
}
```

## 🚀 Pro Tips

1. **Filesystem MCP** handles all file I/O - don't try file operations with Microsoft's MCP
2. **Microsoft MCP** for complex browser tasks - more reliable and feature-rich
3. **Coordinate between them** - Use Microsoft MCP to gather data, Filesystem MCP to store it
4. **Security first** - Configure allowed directories and origins properly
5. **One browser at a time** - Close one before starting the other to avoid conflicts