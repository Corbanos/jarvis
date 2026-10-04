import type { ToolDefinition } from '../types/index.js';
import * as bc from '../modules/browser-control.js';

export const browserTool: ToolDefinition = {
  name: 'browser',
  description: `Control Jarvis's own independent browser (Chromium via Playwright).
Jarvis has a SEPARATE browser window from yours. Use for: web research, filling forms, logging into services, reading pages, Google searches.
Use directly in main chat for quick/current information and news article verification; short multi-call retrieval is not agent work. This browser runs on the SERVER, not the requesting phone: never use its geolocation or host IP as the operator location.
The browser is visible on screen — you can watch Jarvis work.`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['navigate', 'search', 'click', 'fill', 'type', 'screenshot', 'get_content', 'evaluate', 'new_tab', 'close', 'status'],
        description: 'Browser action to perform',
      },
      url: { type: 'string', description: 'URL to navigate to' },
      query: { type: 'string', description: 'Search query (for search action)' },
      selector: { type: 'string', description: 'CSS selector for click/fill/type' },
      value: { type: 'string', description: 'Value to fill/type into element' },
      script: { type: 'string', description: 'JavaScript to evaluate in browser' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;
    try {
      switch (action) {
        case 'navigate': {
          if (!input['url']) return 'Error: url required';
          const result = await bc.navigate(input['url'] as string);
          return `Navigated to: ${result.url}\nTitle: ${result.title}`;
        }
        case 'search': {
          if (!input['query']) return 'Error: query required';
          const results = await bc.searchGoogle(input['query'] as string);
          return `Search results for "${input['query']}":\n\n${results}`;
        }
        case 'click': {
          if (!input['selector']) return 'Error: selector required';
          await bc.clickElement(input['selector'] as string);
          return `Clicked: ${input['selector']}`;
        }
        case 'fill': {
          if (!input['selector'] || !input['value']) return 'Error: selector and value required';
          await bc.fillInput(input['selector'] as string, input['value'] as string);
          return `Filled ${input['selector']} with value`;
        }
        case 'type': {
          if (!input['selector'] || !input['value']) return 'Error: selector and value required';
          await bc.typeInto(input['selector'] as string, input['value'] as string);
          return `Typed into ${input['selector']}`;
        }
        case 'screenshot': {
          const b64 = await bc.screenshotBase64();
          return `Browser screenshot captured (base64, ${b64.length} chars). The browser is showing the current page.`;
        }
        case 'get_content': {
          const content = await bc.getPageContent();
          return content.slice(0, 4000);
        }
        case 'evaluate': {
          if (!input['script']) return 'Error: script required';
          const result = await bc.evaluate(input['script'] as string);
          return JSON.stringify(result, null, 2).slice(0, 2000);
        }
        case 'new_tab': {
          await bc.newTab(input['url'] as string | undefined);
          return `New tab opened${input['url'] ? ` at ${input['url']}` : ''}`;
        }
        case 'close': {
          await bc.closeBrowser();
          return 'Browser closed';
        }
        case 'status': {
          const status = await bc.getStatus();
          return status.open
            ? `Browser open — URL: ${status.url} | Title: ${status.title}`
            : 'Browser not running';
        }
        default:
          return `Unknown action: ${action}`;
      }
    } catch (err) {
      return `Browser action failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
