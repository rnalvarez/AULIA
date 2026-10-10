// Lightweight client-side pacing shared by AULIA's Groq PDF ingestion stages.
// The free-tier TPM budget is model-scoped. Estimates reserve max_completion_tokens,
// because admission control can account for the requested output ceiling, not only
// the shorter response the model eventually returns.
const DEFAULT_TOKENS_PER_MINUTE = 8000;
const SAFE_TPM_FRACTION = 0.82;
const ROLLING_WINDOW_MS = 60000;
const SAFETY_MS = 900;
export const MAX_GROQ_REQUEST_TOKENS = 7800;

const recentUsageByModel = new Map();

export function estimateGroqRequestTokens({
  promptText = "",
  maxCompletionTokens = 0,
  imageCount = 0,
} = {}) {
  const textTokens = Math.ceil(String(promptText || "").length / 3);
  const outputReservation = Math.max(0, Number(maxCompletionTokens) || 0);
  const images = Math.max(0, Number(imageCount) || 0);
  // Groq documents 2048 input tokens per image for Qwen 3.8 27B.
  return textTokens + outputReservation + images * 2088 + 200;
}

export async function waitForGroqCapacity({
  model,
  estimatedTokens,
  onProgress = () => {},
  progress = {},
} = {}) {
  const key = String(model || "unknown-model");
  const budget = Math.max(1000, Math.floor(DEFAULT_TOKENS_PER_MINUTE * SAFE_TPM_FRACTION));
  const needed = Math.max(1, Number(estimatedTokens) || 1);
  let usage = recentUsageByModel.get(key) || [];

  while (true) {
    const now = Date.now();
    usage = usage.filter(item => now - item.at < ROLLING_WINDOW_MS);
    recentUsageByModel.set(key, usage);
    const used = usage.reduce((sum, item) => sum + item.tokens, 0);

    // Allow a single request when the local window is empty, even if it uses
    // most of the budget. Later requests wait until enough of that window expires.
    if (!usage.length || used + needed <= budget) return;

    const first = usage[0];
    const waitMs = Math.max(500, first.at + ROLLING_WINDOW_MS - now + SAFETY_MS);
    onProgress({
      ...progress,
      phase: "rate-wait",
      message: "AULIA está dosificando las tandas para respetar la cuota gratuita de Groq. La próxima consulta se enviará cuando se libere suficiente presupuesto; el avance ya guardado se conserva.",
    });
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

export function recordGroqUsage(model, estimatedTokens, actualTokens = 0) {
  const key = String(model || "unknown-model");
  const usage = (recentUsageByModel.get(key) || [])
    .filter(item => Date.now() - item.at < ROLLING_WINDOW_MS);
  const estimated = Math.max(1, Number(estimatedTokens) || 1);
  const actual = Math.max(0, Number(actualTokens) || 0);
  usage.push({ at: Date.now(), tokens: Math.max(estimated, actual) });
  recentUsageByModel.set(key, usage);
}
