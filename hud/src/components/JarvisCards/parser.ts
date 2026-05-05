/**
 * Parses Jarvis response text into segments: plain text + structured cards.
 * Cards look like: <jarvis-card type="weather">{...JSON...}</jarvis-card>
 */
export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'card'; cardType: string; data: unknown };

export function parseJarvisResponse(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<jarvis-card\s+type="([^"]+)"\s*>([\s\S]*?)<\/jarvis-card>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const before = text.slice(last, m.index).trim();
      if (before) segments.push({ kind: 'text', text: before });
    }
    let data: unknown = null;
    try {
      data = JSON.parse(m[2]?.trim() ?? '{}');
    } catch {
      data = { raw: m[2] };
    }
    segments.push({ kind: 'card', cardType: m[1] ?? 'unknown', data });
    last = re.lastIndex;
  }

  if (last < text.length) {
    const tail = text.slice(last).trim();
    if (tail) segments.push({ kind: 'text', text: tail });
  }

  // If no cards at all, just return text
  if (segments.length === 0 && text.trim()) {
    segments.push({ kind: 'text', text: text.trim() });
  }

  return segments;
}

/** Strip cards out of text — used for spoken TTS so it only speaks prose */
export function stripCards(text: string): string {
  return text.replace(/<jarvis-card[\s\S]*?<\/jarvis-card>/g, '').trim();
}
