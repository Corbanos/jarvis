import type { ToolDefinition } from '../types/index.js';
import { renderScad, listCadJobs, isAvailable } from '../modules/openscad.js';

let _broadcastCard: ((cardType: string, data: Record<string, unknown>) => void) | null = null;

export function setCadBroadcast(fn: (cardType: string, data: Record<string, unknown>) => void) {
  _broadcastCard = fn;
}

export const cadTool: ToolDefinition = {
  name: 'cad',
  description: `Generate 3D printable models with OpenSCAD. Returns a preview image + STL file path.

Use when the operator asks for:
- "design a [thing]" — bracket, holder, gear, enclosure, mount, anything
- "make me a 3D model of X"
- "create something to print"

Write OpenSCAD code that produces the requested object. Use parametric design when sizes are mentioned.
Common primitives: cube([x,y,z]), cylinder(h=, r=), sphere(r=).
Common ops: union(), difference(), intersection(), translate([x,y,z]), rotate([x,y,z]), hull(), minkowski().

After rendering, mention the STL location and offer to print it via the print tool.`,
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['render', 'list', 'check'],
        description: 'render = generate STL+preview, list = show recent designs, check = verify openscad install',
      },
      name: { type: 'string', description: 'Short name for the design (e.g. "wall_bracket")' },
      code: { type: 'string', description: 'OpenSCAD source code' },
      previewOnly: { type: 'boolean', description: 'Skip STL export — just generate PNG preview (faster). Default false.' },
    },
    required: ['action'],
  },
  async handler(input) {
    const action = input['action'] as string;

    switch (action) {
      case 'check': {
        const ok = await isAvailable();
        return ok ? 'OpenSCAD ready at /opt/homebrew/bin/openscad.' : 'OpenSCAD NOT installed. Run: brew install --cask openscad';
      }
      case 'render': {
        const name = (input['name'] as string) ?? 'design';
        const code = input['code'] as string;
        if (!code) return 'Error: code required';

        const result = await renderScad(name, code, { previewOnly: !!input['previewOnly'] });
        if (result.error) return `CAD render failed: ${result.error}`;

        const sizeKB = result.size ? `${(result.size / 1024).toFixed(1)}KB` : '—';

        // Broadcast a CAD card to the HUD
        if (_broadcastCard && result.pngPath) {
          _broadcastCard('cad', {
            name,
            scadPath: result.scadPath,
            stlPath: result.stlPath ?? null,
            pngUrl: `/api/cad/preview?path=${encodeURIComponent(result.pngPath)}`,
            stlUrl: result.stlPath ? `/api/cad/file?path=${encodeURIComponent(result.stlPath)}` : null,
            size: result.size ?? 0,
            duration: result.duration,
          });
        }

        return `Rendered "${name}".
- SCAD: ${result.scadPath}
- STL:  ${result.stlPath ?? '(skipped)'} ${sizeKB ? `(${sizeKB})` : ''}
- PNG:  ${result.pngPath}
- Time: ${(result.duration / 1000).toFixed(1)}s

Use the print tool to send the STL to the Bambu printer.`;
      }
      case 'list': {
        const jobs = listCadJobs();
        if (!jobs.length) return 'No CAD designs yet.';
        return jobs.slice(0, 10).map((j) => {
          const date = new Date(j.mtime).toLocaleString();
          return `- ${j.name} (${date})  ${j.stl ? '✓STL' : ''} ${j.png ? '✓PNG' : ''}`;
        }).join('\n');
      }
      default:
        return `Unknown action: ${action}`;
    }
  },
};
