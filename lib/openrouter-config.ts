import "server-only";

export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.Open_Router_Api_Key);
}
