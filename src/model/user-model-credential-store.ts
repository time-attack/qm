import { decryptSecret, deriveConnectorKey, encryptSecret } from "../connectors/connector-client-store.ts";
import type { DurableMap } from "../persistence/durable-map.ts";
import type { ModelProvider } from "./pi-models.ts";

export type UserCredentialKind = "apikey" | "oauth";

export interface UserOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accountId?: string;
  expiresAt?: number;
}

export interface UserModelCredential {
  provider: ModelProvider;
  kind: UserCredentialKind;
  apiKey?: string;
  oauth?: UserOAuthTokens;
  updatedAt: number;
}

export interface StoredUserModelCredential {
  userId: string;
  provider: ModelProvider;
  kind: UserCredentialKind;
  secretEnc: string;
  disabled?: boolean;
  updatedAt: number;
}

interface SecretPayload {
  apiKey?: string;
  oauth?: UserOAuthTokens;
}

export interface UserModelCredentialStore {
  get(userId: string, provider: ModelProvider): Promise<UserModelCredential | null>;
  connected(userId: string): Promise<ModelProvider[]>;
  hasAny(userId: string): Promise<boolean>;
  setApiKey(userId: string, provider: ModelProvider, apiKey: string): Promise<void>;
  setOAuth(userId: string, provider: ModelProvider, tokens: UserOAuthTokens): Promise<void>;
  delete(userId: string, provider: ModelProvider): Promise<void>;
}

const PROVIDERS: ModelProvider[] = ["anthropic", "openai"];

function keyFor(userId: string, provider: ModelProvider): string {
  return `${userId}:${provider}`;
}

export function createUserModelCredentialStore(input: {
  backing: DurableMap<StoredUserModelCredential>;
  keyMaterial: string | Buffer;
}): UserModelCredentialStore {
  const key = deriveConnectorKey(input.keyMaterial, "user-model-credentials");

  async function read(userId: string, provider: ModelProvider): Promise<UserModelCredential | null> {
    const saved = await input.backing.get(keyFor(userId, provider));
    if (!saved || saved.disabled || !saved.secretEnc) return null;
    const payload = JSON.parse(decryptSecret(saved.secretEnc, key)) as SecretPayload;
    return {
      provider: saved.provider,
      kind: saved.kind,
      apiKey: payload.apiKey,
      oauth: payload.oauth,
      updatedAt: saved.updatedAt,
    };
  }

  async function write(
    userId: string,
    provider: ModelProvider,
    kind: UserCredentialKind,
    payload: SecretPayload,
  ): Promise<void> {
    await input.backing.put(keyFor(userId, provider), {
      userId,
      provider,
      kind,
      secretEnc: encryptSecret(JSON.stringify(payload), key),
      disabled: false,
      updatedAt: Date.now(),
    });
  }

  return {
    get: read,

    async connected(userId) {
      const found = await Promise.all(
        PROVIDERS.map(async (provider) => ((await read(userId, provider)) ? provider : null)),
      );
      return found.filter((p): p is ModelProvider => p !== null);
    },

    async hasAny(userId) {
      return (await this.connected(userId)).length > 0;
    },

    async setApiKey(userId, provider, apiKey) {
      const secret = apiKey.trim();
      if (!secret) throw new Error("API key is required");
      await write(userId, provider, "apikey", { apiKey: secret });
    },

    async setOAuth(userId, provider, tokens) {
      if (!tokens.accessToken?.trim()) throw new Error("access token is required");
      await write(userId, provider, "oauth", { oauth: tokens });
    },

    async delete(userId, provider) {
      const saved = await input.backing.get(keyFor(userId, provider));
      if (!saved) return;
      await input.backing.put(keyFor(userId, provider), { ...saved, disabled: true, updatedAt: Date.now() });
    },
  };
}
