import "server-only";

export function isUnipileConfigured(): boolean {
  return Boolean(process.env.UNIPILE_API_KEY || process.env.Unipile_Api_Key);
}
