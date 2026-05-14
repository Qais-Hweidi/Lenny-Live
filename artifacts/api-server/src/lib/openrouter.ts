import OpenAI from "openai";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY environment variable is required");
}

function getClient(apiKey?: string) {
  return new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: apiKey || OPENROUTER_API_KEY!,
  });
}

export const openrouter = getClient();

export async function chat(
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: Partial<OpenAI.ChatCompletionCreateParamsNonStreaming>,
  apiKey?: string,
): Promise<string> {
  const client = apiKey ? getClient(apiKey) : openrouter;
  const response = await client.chat.completions.create({
    model,
    messages,
    ...options,
  });
  return response.choices[0].message.content ?? "";
}

export async function chatStream(
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: Partial<OpenAI.ChatCompletionCreateParamsStreaming>,
  apiKey?: string,
): Promise<AsyncIterable<OpenAI.ChatCompletionChunk>> {
  const client = apiKey ? getClient(apiKey) : openrouter;
  return client.chat.completions.create({
    model,
    messages,
    stream: true,
    ...options,
  });
}
