import type { ToolDefinition } from '../types/index.js';
import {
  isConfigured, llmAnswer, queryFull, shortAnswer, spokenAnswer, resultToText, WolframNotConfigured,
} from '../modules/wolfram.js';

let _broadcastCard: ((cardType: string, data: Record<string, unknown>) => void) | null = null;
let _broadcastModule: ((event: string, payload: Record<string, unknown>) => void) | null = null;
export function setWolframBroadcast(card: typeof _broadcastCard, module: typeof _broadcastModule) {
  _broadcastCard = card;
  _broadcastModule = module;
}

const NOT_CONFIGURED = 'Wolfram|Alpha is not configured. Tell the operator to add WOLFRAM_APP_ID=<key> to the .env file (free at developer.wolframalpha.com). Answer from your own knowledge for now, and say the figure is approximate if it is.';

export const wolframTool: ToolDefinition = {
  name: 'wolfram',
  description: `Ask Wolfram|Alpha — the computational knowledge engine. Compute, don't estimate.

USE THIS for anything with an exact answer you would otherwise approximate:
- Maths: arithmetic, algebra, calculus, equations, plots, statistics, probability
- Unit & currency conversion, percentages, tips, dates and time zones, "days until…"
- Physics, chemistry, engineering constants and formulas; materials; element data
- Astronomy: sunrise/sunset, moon phase, planet positions, "how far is Mars right now"
- Nutrition, health metrics, geography facts, demographics, comparisons ("X vs Y")
- Finance: stock quotes, market data, mortgage/loan maths
- Definitions of formulas, sequences, integrals, matrices, number theory

MODES
- compute (default): full structured answer. The HUD gets a rich Wolfram|Alpha card with pods and plots AUTOMATICALLY — do not re-embed it. You receive text written for you to read. Reply with a one- or two-sentence spoken summary of the answer.
- short: a single line, for when you only need the number.
- spoken: a sentence phrased for reading aloud — use when the operator asked by voice and wants a quick verbal answer.

Phrase queries the way you'd type them into wolframalpha.com: "integrate x^2 sin x", "40 psi to bar", "population of Tokyo vs London", "moon phase tonight".`,
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The question, phrased as for wolframalpha.com.' },
      mode: { type: 'string', enum: ['compute', 'short', 'spoken'], description: 'Default compute.' },
    },
    required: ['query'],
  },
  async handler(input) {
    const query = String(input['query'] ?? '').trim();
    const mode = (input['mode'] as string | undefined) ?? 'compute';
    if (!query) return 'Wolfram: no query given.';
    if (!isConfigured()) return NOT_CONFIGURED;

    try {
      if (mode === 'short') {
        const r = await shortAnswer(query);
        return r.ok ? r.text : r.error ?? 'No answer.';
      }
      if (mode === 'spoken') {
        const r = await spokenAnswer(query);
        return r.ok ? r.text : r.error ?? 'No answer.';
      }

      // compute: the model gets the LLM-shaped text; the operator gets the pods.
      const [llm, full] = await Promise.all([llmAnswer(query), queryFull(query)]);

      if (full.success) {
        const data = full as unknown as Record<string, unknown>;
        _broadcastCard?.('wolfram', data);
        _broadcastModule?.('module', { action: 'open', type: 'wolfram', data });
      }

      if (llm.ok) return llm.text;
      if (full.success) return resultToText(full);
      return full.error ?? llm.error ?? 'Wolfram|Alpha returned no result.';
    } catch (err) {
      if (err instanceof WolframNotConfigured) return NOT_CONFIGURED;
      return `Wolfram lookup failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
