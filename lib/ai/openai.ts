import OpenAI from 'openai';

// Default configuration
export const DEFAULT_MODEL = 'gpt-5.5-2026-04-23';
export const DEFAULT_TEMPERATURE = 0.7;

// GPT-5 family rejects custom `temperature` and instead takes `reasoning_effort`
// ("low" ~= 3.8x cheaper than medium with no quality loss on this task). gpt-4o*
// takes temperature and no reasoning knob. This adapter picks the right params so
// call sites can flip DEFAULT_MODEL freely. Spread it into chat.completions.create.
const IS_GPT5 = /^gpt-5/.test(DEFAULT_MODEL);
export function modelParams(temperature: number): {
  model: string;
  temperature?: number;
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
} {
  return IS_GPT5
    ? {
        model: DEFAULT_MODEL,
        reasoning_effort:
          (process.env.OPENAI_REASONING_EFFORT as 'low') ?? 'low',
      }
    : { model: DEFAULT_MODEL, temperature };
}

let openaiClient: OpenAI | null = null;

export function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured in environment variables');
    }

    openaiClient = new OpenAI({
      apiKey,
    });
  }

  return openaiClient;
}

// Export the client directly for convenience
export const openai = getOpenAIClient();
