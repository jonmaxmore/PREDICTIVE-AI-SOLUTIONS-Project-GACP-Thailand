import {
  type MorphromHealthIdIdentity,
  type MorphromProviderProfile,
  morphromProviderProfileSchema,
} from '@gacp/contracts';
import { z } from 'zod';

// Health ID (OAuth2 ธรรมดา) + Provider ID (เครดิตเจ้าหน้าที่) ตามคู่มือ MOPH 1 ก.ค. 2567
// ชื่อ field ของ MOPH อยู่เฉพาะในไฟล์นี้ แปลงเป็นชื่อของเรา (glossary) ก่อนส่งออก

export type ProviderLookup =
  | { readonly kind: 'PROVIDER'; readonly profile: MorphromProviderProfile }
  | { readonly kind: 'NOT_PROVIDER' };

export interface MorphromClient {
  authorizationUrl(redirectUri: string, state: string): URL;
  exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ readonly accessToken: string; readonly identity: MorphromHealthIdIdentity }>;
  lookupProvider(healthIdAccessToken: string): Promise<ProviderLookup>;
}

export type HttpMorphromClientOptions = {
  readonly healthIdBaseUrl: string;
  readonly healthIdClientId: string;
  readonly healthIdClientSecret: string;
  readonly providerIdBaseUrl: string;
  readonly providerIdClientId: string;
  readonly providerIdSecretKey: string;
};

const tokenResponseSchema = z.object({
  data: z.object({
    // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
    access_token: z.string().min(1),
    // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
    account_id: z.string().min(1),
  }),
});

const providerTokenResponseSchema = z.object({
  // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
  data: z.object({ access_token: z.string().min(1) }),
});

// รูปตอบกลับของ profile ตามคู่มือ MOPH (organization = หน่วยงาน/สังกัด) glossary-allow field ของ MOPH
const rawProfileSchema = z.object({
  data: z.object({
    // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
    account_id: z.string().min(1),
    // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
    hash_cid: z.string().min(1).nullable().optional(),
    // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
    provider_id: z.string().min(1),
    // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
    name_th: z.string().min(1).nullable().optional(),
    organization: z // glossary-allow field ของ MOPH
      .array(
        z.object({
          // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
          business_id: z.string().min(1),
          hcode: z.string().min(1).nullable().optional(),
          // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
          hname_th: z.string().min(1).nullable().optional(),
          position: z.string().min(1).nullable().optional(),
          // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
          position_type: z.string().min(1).nullable().optional(),
          // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
          license_id: z.string().min(1).nullable().optional(),
        }),
      )
      .default([]),
  }),
});

export class MorphromRequestError extends Error {
  readonly status: number;

  constructor(step: string, status: number) {
    super(`MOPH ${step} ตอบ ${status}`);
    this.name = 'MorphromRequestError';
    this.status = status;
  }
}

export class HttpMorphromClient implements MorphromClient {
  private readonly options: HttpMorphromClientOptions;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: HttpMorphromClientOptions, fetchImplementation: typeof fetch = fetch) {
    this.options = options;
    this.fetchImplementation = fetchImplementation;
  }

  authorizationUrl(redirectUri: string, state: string): URL {
    const url = new URL('/oauth/redirect', this.options.healthIdBaseUrl);
    url.searchParams.set('client_id', this.options.healthIdClientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url;
  }

  async exchangeCode(code: string, redirectUri: string) {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', redirectUri);
    body.set('client_id', this.options.healthIdClientId);
    body.set('client_secret', this.options.healthIdClientSecret);
    const response = await this.fetchImplementation(
      new URL('/api/v1/token', this.options.healthIdBaseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      },
    );
    if (!response.ok) throw new MorphromRequestError('token', response.status);
    const parsed = tokenResponseSchema.parse(await response.json());
    return {
      accessToken: parsed.data.access_token,
      identity: { accountId: parsed.data.account_id, displayName: null, hashCid: null },
    };
  }

  async lookupProvider(healthIdAccessToken: string): Promise<ProviderLookup> {
    const tokenResponse = await this.fetchImplementation(
      new URL('/api/v1/services/token', this.options.providerIdBaseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
          client_id: this.options.providerIdClientId,
          // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
          secret_key: this.options.providerIdSecretKey,
          // biome-ignore lint/style/useNamingConvention: ชื่อ field ตามคู่มือ MOPH
          token_by: 'HealthID',
          token: healthIdAccessToken,
        }),
      },
    );
    if (tokenResponse.status === 400 || tokenResponse.status === 404) {
      return { kind: 'NOT_PROVIDER' };
    }
    if (!tokenResponse.ok) throw new MorphromRequestError('provider token', tokenResponse.status);
    const providerToken = providerTokenResponseSchema.parse(await tokenResponse.json()).data
      .access_token;

    const profileResponse = await this.fetchImplementation(
      new URL('/api/v1/services/profile', this.options.providerIdBaseUrl),
      {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${providerToken}`,
          'client-id': this.options.providerIdClientId,
          'secret-key': this.options.providerIdSecretKey,
        },
      },
    );
    if (profileResponse.status === 404) return { kind: 'NOT_PROVIDER' };
    if (!profileResponse.ok) {
      throw new MorphromRequestError('provider profile', profileResponse.status);
    }
    const raw = rawProfileSchema.parse(await profileResponse.json()).data;
    const profile = morphromProviderProfileSchema.parse({
      accountId: raw.account_id,
      hashCid: raw.hash_cid ?? null,
      providerId: raw.provider_id,
      nameTh: raw.name_th ?? null,
      affiliations: raw.organization.map((entry) => ({
        // glossary-allow field ของ MOPH
        businessId: entry.business_id,
        agencyCode: entry.hcode ?? null,
        agencyNameTh: entry.hname_th ?? null,
        position: entry.position ?? null,
        positionType: entry.position_type ?? null,
        licenseId: entry.license_id ?? null,
      })),
    });
    return { kind: 'PROVIDER', profile };
  }
}
