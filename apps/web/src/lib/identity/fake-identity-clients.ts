import type { MorphromProviderProfile, ThaidIdentityClaims } from '@gacp/contracts';
import type { MorphromClient, ProviderLookup } from './morphrom-client.ts';
import type {
  ThaidAuthorizationChecks,
  ThaidAuthorizationStart,
  ThaidClient,
} from './thaid-client.ts';

// client ปลอมสำหรับ test: ตอบตามที่ตั้งไว้ ไม่มี HTTP

export class FakeThaidClient implements ThaidClient {
  private readonly claims: ThaidIdentityClaims;

  constructor(claims: ThaidIdentityClaims) {
    this.claims = claims;
  }

  async startAuthorization(redirectUri: string): Promise<ThaidAuthorizationStart> {
    const url = new URL('https://thaid.test/authorize');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', 'fake-state');
    return { url, state: 'fake-state', nonce: 'fake-nonce', pkceCodeVerifier: null };
  }

  async completeAuthorization(
    callbackUrl: URL,
    checks: ThaidAuthorizationChecks,
  ): Promise<ThaidIdentityClaims> {
    if (callbackUrl.searchParams.get('state') !== checks.state) {
      throw new Error('state ไม่ตรง');
    }
    return this.claims;
  }
}

export class FakeMorphromClient implements MorphromClient {
  private readonly accountId: string;
  private readonly provider: MorphromProviderProfile | null;

  constructor(accountId: string, provider: MorphromProviderProfile | null) {
    this.accountId = accountId;
    this.provider = provider;
  }

  authorizationUrl(redirectUri: string, state: string): URL {
    const url = new URL('https://healthid.test/oauth/redirect');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url;
  }

  async exchangeCode() {
    return {
      accessToken: 'fake-health-token',
      identity: {
        accountId: this.accountId,
        displayName: null,
        hashCid: this.provider?.hashCid ?? null,
      },
    };
  }

  async lookupProvider(): Promise<ProviderLookup> {
    return this.provider ? { kind: 'PROVIDER', profile: this.provider } : { kind: 'NOT_PROVIDER' };
  }
}
