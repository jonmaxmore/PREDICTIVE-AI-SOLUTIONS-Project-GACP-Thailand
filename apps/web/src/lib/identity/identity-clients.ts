import 'server-only';
import { RuntimeEnvironment, readEnv } from '@gacp/contracts';
import { HttpMorphromClient, type MorphromClient } from './morphrom-client.ts';
import { OpenIdThaidClient, type ThaidClient } from './thaid-client.ts';

// จุดเดียวที่สร้าง client ของผู้ให้บริการยืนยันตัวตนจาก env (singleton ต่อ process) ใน test แทนด้วย fake ได้

export type IdentityClients = { readonly thaid: ThaidClient; readonly morphrom: MorphromClient };

const globalStore = globalThis as unknown as { gacpIdentityClients?: IdentityClients };

export class IdentityProviderNotConfiguredError extends Error {
  constructor() {
    super(
      'ยังไม่ได้ตั้งค่า ThaID / Health ID / Provider ID ใน .env.local (ใช้ dev login ระหว่างรอ client จากหน่วยงาน)',
    );
    this.name = 'IdentityProviderNotConfiguredError';
  }
}

export function identityProvidersConfigured(): boolean {
  const env = readEnv();
  return Boolean(
    env.GACP_THAID_ISSUER_URL &&
      env.GACP_THAID_CLIENT_ID &&
      env.GACP_THAID_CLIENT_SECRET &&
      env.GACP_MORPHROM_HEALTH_ID_BASE_URL &&
      env.GACP_MORPHROM_HEALTH_ID_CLIENT_ID &&
      env.GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET &&
      env.GACP_MORPHROM_PROVIDER_ID_BASE_URL &&
      env.GACP_MORPHROM_PROVIDER_ID_CLIENT_ID &&
      env.GACP_MORPHROM_PROVIDER_ID_SECRET_KEY,
  );
}

function fromEnv(): IdentityClients {
  const env = readEnv();
  if (
    !env.GACP_THAID_ISSUER_URL ||
    !env.GACP_THAID_CLIENT_ID ||
    !env.GACP_THAID_CLIENT_SECRET ||
    !env.GACP_MORPHROM_HEALTH_ID_BASE_URL ||
    !env.GACP_MORPHROM_HEALTH_ID_CLIENT_ID ||
    !env.GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET ||
    !env.GACP_MORPHROM_PROVIDER_ID_BASE_URL ||
    !env.GACP_MORPHROM_PROVIDER_ID_CLIENT_ID ||
    !env.GACP_MORPHROM_PROVIDER_ID_SECRET_KEY
  ) {
    throw new IdentityProviderNotConfiguredError();
  }
  return {
    thaid: new OpenIdThaidClient({
      issuerUrl: env.GACP_THAID_ISSUER_URL,
      clientId: env.GACP_THAID_CLIENT_ID,
      clientSecret: env.GACP_THAID_CLIENT_SECRET,
    }),
    morphrom: new HttpMorphromClient({
      healthIdBaseUrl: env.GACP_MORPHROM_HEALTH_ID_BASE_URL,
      healthIdClientId: env.GACP_MORPHROM_HEALTH_ID_CLIENT_ID,
      healthIdClientSecret: env.GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET,
      providerIdBaseUrl: env.GACP_MORPHROM_PROVIDER_ID_BASE_URL,
      providerIdClientId: env.GACP_MORPHROM_PROVIDER_ID_CLIENT_ID,
      providerIdSecretKey: env.GACP_MORPHROM_PROVIDER_ID_SECRET_KEY,
    }),
  };
}

export function identityClients(): IdentityClients {
  globalStore.gacpIdentityClients ??= fromEnv();
  return globalStore.gacpIdentityClients;
}

// test เท่านั้น: แทน client จริงด้วย fake
export function setIdentityClientsForTest(clients: IdentityClients): void {
  if (readEnv().GACP_ENV !== RuntimeEnvironment.TEST) {
    throw new Error('setIdentityClientsForTest ใช้ได้เฉพาะ GACP_ENV=test');
  }
  globalStore.gacpIdentityClients = clients;
}
