import OpenAI from "openai";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY environment variable is required");
}

export const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: OPENROUTER_API_KEY,
});

export async function chat(
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: Partial<OpenAI.ChatCompletionCreateParamsNonStreaming>
): Promise<string> {
  const response = await openrouter.chat.completions.create({
    model,
    messages,
    ...options,
  });
  return response.choices[0].message.content ?? "";
}

export async function chatStream(
  model: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  options?: Partial<OpenAI.ChatCompletionCreateParamsStreaming>
): Promise<AsyncIterable<OpenAI.ChatCompletionChunk>> {
  return openrouter.chat.completions.create({
    model,
    messages,
    stream: true,
    ...options,
  });
}
