# Playwright MCP Tools Reference

Names assume the MCP server is registered as `playwright` (full tool names `mcp__playwright__browser_navigate`, …). If it is registered under another name, use that prefix.

| Tool | Usage |
|------|-------|
| `browser_navigate` | Navigate to application pages |
| `browser_snapshot` | Capture the accessible page state (preferred over screenshots for analysis) |
| `browser_click` | Interact with buttons, links and clickable elements |
| `browser_type` | Fill form fields |
| `browser_fill_form` | Fill several fields at once |
| `browser_select_option` | Select options in dropdowns |
| `browser_press_key` | Simulate keys (Enter, Tab, etc.) |
| `browser_take_screenshot` | Capture visual evidence — pass `filename` under the SPEC's `tmp/` (or `evidence/` for cited evidence) |
| `browser_console_messages` | Check the browser console for errors |
| `browser_network_requests` | Verify API calls |
