import OpenAI from 'openai';

// Default configuration
export const DEFAULT_MODEL = 'gpt-4o-mini';
export const DEFAULT_TEMPERATURE = 0.7;

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
