## Serena MCP -- MANDATORY FIRST ACTION

**CRITICAL: Before ANY code work, activate Serena:**

```
mcp__plugin_serena_serena__activate_project -> project: "product-scraper"
mcp__plugin_serena_serena__check_onboarding_performed
```

Then use Serena's semantic tools (`find_symbol`, `get_symbols_overview`, `search_for_pattern`, `replace_symbol_body`, `replace_content`) instead of Read/Grep/Glob/Edit. Only fall back to built-in tools for non-code files.
