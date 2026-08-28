import type { Keychain } from "../credentials/keychain.ts";
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

interface SecretPayload {
  kind: UserCredentialKind;
  apiKey?: string;
  oauth?: UserOAuthTokens;
}

export interface UserCredentialConnection {
  provider: ModelProvider;
  kind: UserCredentialKind;
}

export interface UserModelCredentialStore {
  get(userId: string, provider: ModelProvider): Promise<UserModelCredential | null>;
  connections(userId: string): Promise<UserCredentialConnection[]>;
  setApiKey(userId: string, provider: ModelProvider, apiKey: string): Promise<void>;
  setOAuth(userId: string, provider: ModelProvider, tokens: UserOAuthTokens): Promise<void>;
  delete(userId: string, provider: ModelProvider): Promise<void>;
}

const PROVIDERS: ModelProvider[] = ["anthropic", "openai"];
const ORIGIN = "individual-model-auth";

function serviceFor(provider: ModelProvider): string {
  return `model-${provider}`;
}

function providerFor(service: string): ModelProvider | null {
  const match = PROVIDERS.find((provider) => serviceFor(provider) === service);
  return match ?? null;
}

/**
 * Per-user AI-account custody, backed by the org keychain — NOT a parallel
 * secret store. Each (user, provider) pair is one ordinary keychain credential
 * owned by that user, so keychain encryption, ownership checks, admin
 * visibility, and "remove my credentials" all apply to AI logins for free.
 * Token expiry lives inside the payload (not the keychain's `expiresAt`):
 * an expired access token is still a live connection — its refresh token is
 * exactly what the pre-turn refresh needs to read.
 */
export function createUserModelCredentialStore(input: { keychain: Keychain }): UserModelCredentialStore {
  const { keychain } = input;

  async function find(userId: string, provider: ModelProvider) {
    const all = await keychain.listByOwner(userId);
    return all.find((c) => c.service === serviceFor(provider) && c.origin === ORIGIN) ?? null;
  }

  async function write(userId: string, provider: ModelProvider, payload: SecretPayload): Promise<void> {
    await keychain.save({
      ownerId: userId,
      service: serviceFor(provider),
      secret: JSON.stringify(payload),
      origin: ORIGIN,
      ...(payload.oauth?.accountId ? { accountLabel: payload.oauth.accountId } : {}),
    });
  }

  return {
    async get(userId, provider) {
      const meta = await find(userId, provider);
      if (!meta) return null;
      const raw = await keychain.readOwnSecret(userId, meta.id);
      if (!raw) return null;
      let payload: SecretPayload;
      try {
        payload = JSON.parse(raw) as SecretPayload;
      } catch {
        return null;
      }
      if (payload.kind !== "apikey" && payload.kind !== "oauth") return null;
      return {
        provider,
        kind: payload.kind,
        ...(payload.apiKey ? { apiKey: payload.apiKey } : {}),
        ...(payload.oauth ? { oauth: payload.oauth } : {}),
        updatedAt: meta.updatedAt,
      };
    },

    async connections(userId) {
      const all = await keychain.listByOwner(userId);
      const found: UserCredentialConnection[] = [];
      for (const meta of all) {
        if (meta.origin !== ORIGIN) continue;
        const provider = providerFor(meta.service);
        if (!provider) continue;
        const raw = await keychain.readOwnSecret(userId, meta.id);
        if (!raw) continue;
        try {
          const payload = JSON.parse(raw) as SecretPayload;
          if (payload.kind === "apikey" || payload.kind === "oauth") found.push({ provider, kind: payload.kind });
        } catch {
          continue;
        }
      }
      return found.sort((a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider));
    },

    async setApiKey(userId, provider, apiKey) {
      const secret = apiKey.trim();
      if (!secret) throw new Error("API key is required");
      await write(userId, provider, { kind: "apikey", apiKey: secret });
    },

    async setOAuth(userId, provider, tokens) {
      if (!tokens.accessToken?.trim()) throw new Error("access token is required");
      await write(userId, provider, { kind: "oauth", oauth: tokens });
    },

    async delete(userId, provider) {
      const meta = await find(userId, provider);
      if (meta) await keychain.remove(userId, meta.id);
    },
  };
}
