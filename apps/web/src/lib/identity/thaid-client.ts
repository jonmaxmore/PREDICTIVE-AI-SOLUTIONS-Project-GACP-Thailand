import { type ThaidIdentityClaims, thaidIdentityClaimsSchema } from '@gacp/contracts';
import * as oidc from 'openid-client';

// ThaID = OpenID Connect ของกรมการปกครอง (discovery https://imauth.bora.dopa.go.th หรือ sandbox imauthsbx)
// ทำตามตัวอย่าง Relying Party ของ ETDA: code flow + state + ตรวจ id_token ด้วย JWKS เพิ่ม nonce และ PKCE เมื่อเซิร์ฟเวอร์รองรับ

export const THAID_SCOPE = 'openid pid name given_name family_name ial';

export type ThaidAuthorizationStart = {
  readonly url: URL;
  readonly state: string;
  readonly nonce: string;
  readonly pkceCodeVerifier: string | null;
};

export type ThaidAuthorizationChecks = {
  readonly state: string;
  readonly nonce: string;
  readonly pkceCodeVerifier: string | null;
};

export interface ThaidClient {
  startAuthorization(redirectUri: string): Promise<ThaidAuthorizationStart>;
  completeAuthorization(
    callbackUrl: URL,
    checks: ThaidAuthorizationChecks,
  ): Promise<ThaidIdentityClaims>;
}

export type OpenIdThaidClientOptions = {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

export class OpenIdThaidClient implements ThaidClient {
  private readonly options: OpenIdThaidClientOptions;
  private configuration: Promise<oidc.Configuration> | undefined;

  constructor(options: OpenIdThaidClientOptions) {
    this.options = options;
  }

  private config(): Promise<oidc.Configuration> {
    this.configuration ??= oidc.discovery(
      new URL(this.options.issuerUrl),
      this.options.clientId,
      undefined,
      oidc.ClientSecretPost(this.options.clientSecret),
    );
    return this.configuration;
  }

  async startAuthorization(redirectUri: string): Promise<ThaidAuthorizationStart> {
    const config = await this.config();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const parameters: Record<string, string> = {
      // biome-ignore lint/style/useNamingConvention: ชื่อพารามิเตอร์มาตรฐาน OAuth2
      redirect_uri: redirectUri,
      scope: THAID_SCOPE,
      state,
      nonce,
    };
    let pkceCodeVerifier: string | null = null;
    if (config.serverMetadata().supportsPKCE()) {
      pkceCodeVerifier = oidc.randomPKCECodeVerifier();
      parameters.code_challenge = await oidc.calculatePKCECodeChallenge(pkceCodeVerifier);
      parameters.code_challenge_method = 'S256';
    }
    return { url: oidc.buildAuthorizationUrl(config, parameters), state, nonce, pkceCodeVerifier };
  }

  async completeAuthorization(
    callbackUrl: URL,
    checks: ThaidAuthorizationChecks,
  ): Promise<ThaidIdentityClaims> {
    const config = await this.config();
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      ...(checks.pkceCodeVerifier ? { pkceCodeVerifier: checks.pkceCodeVerifier } : {}),
    });
    const claims = thaidIdentityClaimsSchema.parse(tokens.claims());
    // ไม่เก็บ access/refresh token: ยกเลิกทิ้งทันทีหลังอ่าน claims (ล้มเหลวได้โดยไม่กระทบการล็อกอิน)
    await oidc.tokenRevocation(config, tokens.access_token).catch(() => undefined);
    return claims;
  }
}
