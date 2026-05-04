import type { ToolDefinition } from '../types/index.js';
import * as cu from '../modules/computer-use.js';

export const computerTool: ToolDefinition = {
  name: 'computer',
  description: `Control the computer directly — move the mouse, click, type, take screenshots, press keys. 
Jarvis has its OWN independent cursor, so the user can continue working while Jarvis uses the computer.
Use this for: opening apps, clicking UI elements, filling forms, reading screen content.`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['screenshot', 'mouse_move', 'click', 'double_click', 'right_click', 'type', 'key', 'hotkey', 'scroll', 'get_position', 'get_screen_size'],
        description: 'Action to perform',
      },
      x: { type: 'number', description: 'X coordinate (for mouse actions)' },
      y: { type: 'number', description: 'Y coordinate (for mouse actions)' },
      text: { type: 'string', description: 'Text to type' },
      key: { type: 'string', description: 'Key name (enter, escape, tab, space, backspace, cmd, ctrl, alt, shift, up, down, left, right)' },
      keys: { type: 'array', items: { type: 'string' }, description: 'Keys for hotkey combination (e.g. ["cmd", "c"])' },
      direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction' },
      amount: { type: 'number', description: 'Scroll amount' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;
    const x = input['x'] as number | undefined;
    const y = input['y'] as number | undefined;

    try {
      switch (action) {
        case 'screenshot': {
          const buf = await cu.takeScreenshot();
          return buf ? `Screenshot captured (${buf.length} bytes). Use browser_screenshot to see browser window.` : 'Screenshot failed';
        }
        case 'mouse_move':
          if (x === undefined || y === undefined) return 'Error: x and y required';
          await cu.moveMouseSmooth(x, y);
          return `Mouse moved to (${x}, ${y})`;
        case 'click':
          if (x === undefined || y === undefined) return 'Error: x and y required';
          await cu.click(x, y, 'left');
          return `Clicked at (${x}, ${y})`;
        case 'double_click':
          if (x === undefined || y === undefined) return 'Error: x and y required';
          await cu.click(x, y, 'double');
          return `Double-clicked at (${x}, ${y})`;
        case 'right_click':
          if (x === undefined || y === undefined) return 'Error: x and y required';
          await cu.click(x, y, 'right');
          return `Right-clicked at (${x}, ${y})`;
        case 'type':
          if (!input['text']) return 'Error: text required';
          await cu.typeText(input['text'] as string);
          return `Typed: "${(input['text'] as string).slice(0, 50)}"`;
        case 'key':
          if (!input['key']) return 'Error: key required';
          await cu.pressKey(input['key'] as string);
          return `Pressed key: ${input['key']}`;
        case 'hotkey': {
          const keys = (input['keys'] as string[] | undefined) ?? [];
          if (!keys.length) return 'Error: keys array required';
          await cu.hotkey(...keys);
          return `Hotkey: ${keys.join('+')}`;
        }
        case 'scroll':
          if (x === undefined || y === undefined) return 'Error: x and y required';
          await cu.scroll(x, y, (input['direction'] as 'up' | 'down') ?? 'down', (input['amount'] as number) ?? 3);
          return `Scrolled ${input['direction'] ?? 'down'} at (${x}, ${y})`;
        case 'get_position': {
          const pos = await cu.getMousePosition();
          return `Mouse position: (${pos.x}, ${pos.y})`;
        }
        case 'get_screen_size': {
          const size = await cu.getScreenSize();
          return `Screen: ${size.width}x${size.height}`;
        }
        default:
          return `Unknown action: ${action}`;
      }
    } catch (err) {
      return `Computer action failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
