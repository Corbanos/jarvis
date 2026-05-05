/**
 * OpenSCAD integration — render SCAD files to STL/PNG.
 * Files saved under ~/.jarvis/cad/ for inspection.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, basename, extname } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);

const OPENSCAD_BIN = '/opt/homebrew/bin/openscad';
const CAD_DIR = join(homedir(), '.jarvis', 'cad');
mkdirSync(CAD_DIR, { recursive: true });

export interface RenderResult {
  scadPath: string;
  stlPath?: string;
  pngPath?: string;
  duration: number;
  size?: number;
  error?: string;
}

export async function isAvailable(): Promise<boolean> {
  return existsSync(OPENSCAD_BIN);
}

/**
 * Render an OpenSCAD source string to STL + PNG preview.
 */
export async function renderScad(name: string, code: string, opts: { previewOnly?: boolean } = {}): Promise<RenderResult> {
  const start = Date.now();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'untitled';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseDir = join(CAD_DIR, `${safeName}-${stamp}`);
  mkdirSync(baseDir, { recursive: true });

  const scadPath = join(baseDir, `${safeName}.scad`);
  const stlPath = join(baseDir, `${safeName}.stl`);
  const pngPath = join(baseDir, `${safeName}.png`);

  writeFileSync(scadPath, code, 'utf-8');

  try {
    // Render PNG preview
    await execAsync(
      `"${OPENSCAD_BIN}" -o "${pngPath}" --imgsize=1024,768 --colorscheme=Tomorrow --camera=0,0,0,55,0,25,140 "${scadPath}"`,
      { timeout: 60000 }
    );
  } catch (err) {
    return {
      scadPath, duration: Date.now() - start,
      error: `Preview render failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let stlOk = false;
  let stlSize = 0;
  if (!opts.previewOnly) {
    try {
      await execAsync(`"${OPENSCAD_BIN}" -o "${stlPath}" "${scadPath}"`, { timeout: 120000 });
      stlOk = true;
      stlSize = statSync(stlPath).size;
    } catch (err) {
      return {
        scadPath, pngPath, duration: Date.now() - start,
        error: `STL export failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return {
    scadPath,
    stlPath: stlOk ? stlPath : undefined,
    pngPath: existsSync(pngPath) ? pngPath : undefined,
    duration: Date.now() - start,
    size: stlSize,
  };
}

/**
 * List recent CAD jobs.
 */
export function listCadJobs(): Array<{ name: string; dir: string; scad?: string; stl?: string; png?: string; mtime: number }> {
  if (!existsSync(CAD_DIR)) return [];
  const entries = readdirSync(CAD_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const dir = join(CAD_DIR, e.name);
      const files = readdirSync(dir);
      const scad = files.find((f) => f.endsWith('.scad'));
      const stl = files.find((f) => f.endsWith('.stl'));
      const png = files.find((f) => f.endsWith('.png'));
      const mtime = statSync(dir).mtimeMs;
      return {
        name: e.name,
        dir,
        scad: scad ? join(dir, scad) : undefined,
        stl: stl ? join(dir, stl) : undefined,
        png: png ? join(dir, png) : undefined,
        mtime,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return entries.slice(0, 30);
}

export function readPng(path: string): Buffer {
  return readFileSync(path);
}

export function getCadDir(): string {
  return CAD_DIR;
}
