import {
  DEFAULT_AGENT_MODEL_ID,
  DEFAULT_CODEX_MODEL_ID,
  defaultModelForHarness,
  defaultModelForProvider,
  resolveModel,
  type ModelProvider,
} from "../model/pi-models.ts";
import type { UserModelCredential } from "../model/user-model-credential-store.ts";

export type IndividualAuthRouting =
  | { kind: "apikey"; provider: ModelProvider; harness: "pi"; model: string | undefined; apiKey: string }
  | { kind: "oauth"; provider: "anthropic"; harness: "claude"; model: string }
  | { kind: "oauth"; provider: "openai"; harness: "codex"; model: string }
  | null;

export function resolveIndividualAuthRouting(
  anthCred: UserModelCredential | null,
  oaiCred: UserModelCredential | null,
  requestedModel: string | undefined,
): IndividualAuthRouting {
  const requestedProvider = requestedModel ? resolveModel(requestedModel)?.provider : undefined;
  const pick = ((): { provider: "anthropic" | "openai"; cred: UserModelCredential } | null => {
    if (requestedProvider === "anthropic" && anthCred) return { provider: "anthropic", cred: anthCred };
    if (requestedProvider === "openai" && oaiCred) return { provider: "openai", cred: oaiCred };
    if (anthCred) return { provider: "anthropic", cred: anthCred };
    if (oaiCred) return { provider: "openai", cred: oaiCred };
    return null;
  })();
  if (!pick) return null;
  if (pick.cred.kind === "apikey" && pick.cred.apiKey) {
    return {
      kind: "apikey",
      provider: pick.provider,
      harness: "pi",
      apiKey: pick.cred.apiKey,
      model:
        requestedModel && requestedProvider === pick.provider
          ? requestedModel
          : defaultModelForProvider("pi", pick.provider),
    };
  }
  if (pick.cred.kind === "oauth" && pick.cred.oauth) {
    return pick.provider === "anthropic"
      ? {
          kind: "oauth",
          provider: "anthropic",
          harness: "claude",
          model: defaultModelForHarness("claude", DEFAULT_AGENT_MODEL_ID),
        }
      : {
          kind: "oauth",
          provider: "openai",
          harness: "codex",
          model: defaultModelForHarness("codex", DEFAULT_CODEX_MODEL_ID),
        };
  }
  return null;
}
