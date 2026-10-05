'use client';
import { FormEvent, useMemo, useState } from 'react';
import type {
  TrustVerificationResponse,
  RevocationFeedItem,
  TrustRegistryItem,
  SignatureVerifyResponse,
  TraceEventsResponse,
} from '@/types/interoperability';
import { ENTITY_TYPES } from '@/types/interoperability';
import { apiClient } from '@/lib/api/api-client';
import { useLanguage } from '@/lib/i18n/language-context';
import { LanguageToggle } from '@/components/feature/LanguageToggle';

function toJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  return JSON.parse(trimmed);
}

function toShortDate(value?: string | null): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function TrustVerifierPortal() {
  const { dict } = useLanguage();
  const c = dict.verifier;

  // ทะเบียน · รายการเพิกถอน · เหตุการณ์ตรวจสอบย้อนกลับ ถูกเฝ้าด้วย partner API key ที่ฝั่ง
  // เซิร์ฟเวอร์ (interoperability.js) หน้านี้เป็นหน้าสาธารณะจึงไม่มีกุญแจ และได้ 401 เสมอ
  // เดิมข้อความที่ผู้เข้าชมเห็นคือคำปฏิเสธภาษาอังกฤษของเซิร์ฟเวอร์บนหน้าไทย — บอกไปตรง ๆ
  // ว่าส่วนนี้เปิดให้เฉพาะหน่วยงานคู่เชื่อม ดีกว่าทำเป็นว่าระบบล่ม
  const refusalCopy = (response: { code?: string; error?: string }, fallback: string): string =>
    response.code === 'PARTNER_KEY_MISSING' ? c.partnerKeyOnly : (response.error || fallback);
  const [certificateNumber, setCertificateNumber] = useState('');
  const [verificationResult, setVerificationResult] = useState<TrustVerificationResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [verifyingCertificate, setVerifyingCertificate] = useState(false);

  const [revocationFeed, setRevocationFeed] = useState<RevocationFeedItem[]>([]);
  const [loadingRevocations, setLoadingRevocations] = useState(false);
  const [revocationError, setRevocationError] = useState<string | null>(null);
  const [trustRegistry, setTrustRegistry] = useState<TrustRegistryItem[]>([]);
  const [loadingRegistry, setLoadingRegistry] = useState(false);
  const [registryError, setRegistryError] = useState<string | null>(null);

  const [payloadInput, setPayloadInput] = useState('{\n  "certificateNumber": "CERT-XXXX"\n}');
  const [payloadHashInput, setPayloadHashInput] = useState('');
  const [signatureInput, setSignatureInput] = useState('');
  const [publicKeyInput, setPublicKeyInput] = useState('');
  const [signatureResult, setSignatureResult] = useState<SignatureVerifyResponse | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);
  const [checkingSignature, setCheckingSignature] = useState(false);

  const [traceEntityType, setTraceEntityType] = useState<(typeof ENTITY_TYPES)[number]>('CERTIFICATE');
  const [traceEntityId, setTraceEntityId] = useState('');
  const [traceEventsResult, setTraceEventsResult] = useState<TraceEventsResponse | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [loadingTraceEvents, setLoadingTraceEvents] = useState(false);

  const trustTone = useMemo(() => {
    const status = verificationResult?.trustStatus;
    if (status === 'ACTIVE') {
      return 'text-leaf-700';
    }
    if (status === 'REVOKED') {
      return 'text-red-700';
    }
    if (status === 'EXPIRED') {
      return 'text-amber-700';
    }
    return 'text-slate-700';
  }, [verificationResult?.trustStatus]);

  const handleCertificateVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setVerifyingCertificate(true);
    setVerificationError(null);

    try {
      const normalized = certificateNumber.trim();
      if (!normalized) {
        throw new Error(c.certificate.missingNumber);
      }

      const response = await apiClient.get<TrustVerificationResponse>(
        `/api/interoperability/v1/verification?certificateNumber=${encodeURIComponent(normalized)}`,
        { skipAuth: true },
      );

      if (!response.success) {
        throw new Error(response.error || c.certificate.failed);
      }

      // F-VERIFY-PORTAL-SHAPE-MISMATCH (Phase 0 walk-2 2026-08-19, C15):
      // apiClient UNWRAPS the server's `.data` (so response.data is the inner
      // certificate payload) and harvests the envelope siblings — valid /
      // trustStatus — into `.meta` (api-client.ts:449-454). The old cast
      // pretended response.data was still the full envelope, so `valid` and
      // `data.*` were undefined and a VALID certificate rendered as
      // "ผลการตรวจสอบ: ไม่ผ่าน" with every field dashed on the public trust
      // surface. Rebuild the envelope the template reads from meta + data.
      setVerificationResult({
        ...((response.meta ?? {}) as Partial<TrustVerificationResponse>),
        data: response.data,
      } as TrustVerificationResponse);
    } catch (error) {
      setVerificationResult(null);
      setVerificationError(error instanceof Error ? error.message : c.certificate.unexpected);
    } finally {
      setVerifyingCertificate(false);
    }
  };

  const loadRevocationFeed = async () => {
    setLoadingRevocations(true);
    setRevocationError(null);
    try {
      const response = await apiClient.get<RevocationFeedItem[]>(
        '/api/interoperability/v1/trust/revocations?limit=10',
        { skipAuth: true },
      );

      if (!response.success) {
        throw new Error(refusalCopy(response, c.registry.revocationFailed));
      }

      setRevocationFeed(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setRevocationFeed([]);
      setRevocationError(error instanceof Error ? error.message : c.registry.revocationUnexpected);
    } finally {
      setLoadingRevocations(false);
    }
  };

  const loadTrustRegistry = async () => {
    setLoadingRegistry(true);
    setRegistryError(null);
    try {
      const response = await apiClient.get<TrustRegistryItem[]>(
        '/api/interoperability/v1/trust/registry?limit=10',
        { skipAuth: true },
      );

      if (!response.success) {
        throw new Error(refusalCopy(response, c.registry.registryFailed));
      }

      setTrustRegistry(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setTrustRegistry([]);
      setRegistryError(error instanceof Error ? error.message : c.registry.registryUnexpected);
    } finally {
      setLoadingRegistry(false);
    }
  };

  const handleSignatureVerify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCheckingSignature(true);
    setSignatureError(null);

    try {
      const payload = toJsonPayload(payloadInput);
      if (!signatureInput.trim()) {
        throw new Error(c.signature.missingSignature);
      }

      const response = await apiClient.post<SignatureVerifyResponse>(
        '/api/interoperability/v1/signatures/verify',
        {
          payload,
          payloadHash: payloadHashInput.trim() || undefined,
          signature: signatureInput.trim(),
          publicKey: publicKeyInput.trim() || undefined,
        },
        { skipAuth: true },
      );

      if (!response.success) {
        throw new Error(c.signature.failed);
      }

      // Same F-VERIFY-PORTAL-SHAPE-MISMATCH class as handleVerify above (review
      // 2026-08-19 confirmed it live here too): apiClient unwraps `.data` and
      // harvests the sibling `valid` into `.meta`, so the old cast rendered
      // every VALID signature as failed with hash '-'. Rebuild from meta + data.
      setSignatureResult({
        ...((response.meta ?? {}) as Partial<SignatureVerifyResponse>),
        data: response.data,
      } as SignatureVerifyResponse);
    } catch (error) {
      setSignatureResult(null);
      setSignatureError(error instanceof Error ? error.message : c.signature.unexpected);
    } finally {
      setCheckingSignature(false);
    }
  };

  const handleTraceLoad = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoadingTraceEvents(true);
    setTraceError(null);

    try {
      const normalizedEntityId = traceEntityId.trim();
      if (!normalizedEntityId) {
        throw new Error(c.trace.missingEntityId);
      }

      const response = await apiClient.get<TraceEventsResponse>(
        `/api/interoperability/v1/trace/events/${encodeURIComponent(traceEntityType)}/${encodeURIComponent(normalizedEntityId)}`,
        { skipAuth: true },
      );

      if (!response.success) {
        throw new Error(refusalCopy(response, c.trace.failed));
      }

      // Same envelope rebuild as the two handlers above.
      setTraceEventsResult({
        ...((response.meta ?? {}) as Partial<TraceEventsResponse>),
        data: response.data as unknown as TraceEventsResponse['data'],
      } as TraceEventsResponse);
    } catch (error) {
      setTraceEventsResult(null);
      setTraceError(error instanceof Error ? error.message : c.trace.unexpected);
    } finally {
      setLoadingTraceEvents(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold text-slate-500">{c.eyebrow}</p>
            {/* The public trust surface is the one overseas buyers scan into,
                so it needs the toggle the authenticated shells already have. */}
            <LanguageToggle />
          </div>
          <h1 className="mt-2 text-xl font-semibold text-slate-900 sm:text-2xl lg:text-3xl">{c.title}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            {c.subtitle}
          </p>
        </header>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{c.certificate.title}</h2>
            <form className="mt-4 space-y-3" onSubmit={handleCertificateVerify}>
              <label htmlFor="certificate-number" className="block text-sm font-medium text-slate-700">
                {c.certificate.numberLabel}
              </label>
              <input
                id="certificate-number"
                value={certificateNumber}
                onChange={(event) => setCertificateNumber(event.target.value)}
                placeholder={c.certificate.numberPlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm text-slate-900 outline-none ring-0 transition focus:border-leaf-700"
              />
              <button
                type="submit"
                disabled={verifyingCertificate}
                className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-leaf-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {verifyingCertificate ? c.certificate.submitting : c.certificate.submit}
              </button>
            </form>

            {verificationError && <p className="mt-3 text-sm font-medium text-red-700">{verificationError}</p>}

            {verificationResult && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className={`font-semibold ${trustTone}`}>{c.certificate.trustStatus}: {verificationResult.trustStatus || '-'}</p>
                <p className="mt-1 text-slate-700">{c.certificate.outcome}: {verificationResult.valid ? c.certificate.pass : c.certificate.fail}</p>
                <p className="mt-2 text-slate-700">{c.certificate.number}: {verificationResult.data?.certificateNumber || '-'}</p>
                <p className="text-slate-700">{c.certificate.issuedDate}: {toShortDate(verificationResult.data?.issuedDate)}</p>
                <p className="text-slate-700">{c.certificate.expiryDate}: {toShortDate(verificationResult.data?.expiryDate)}</p>
                <p className="text-slate-700">{c.certificate.location}: {verificationResult.data?.farm?.district || '-'} / {verificationResult.data?.farm?.province || '-'}</p>
                <p className="text-slate-700">{c.certificate.revokedReason}: {verificationResult.data?.revokedReason || '-'}</p>
              </div>
            )}
          </article>

          <article className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{c.registry.title}</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={loadTrustRegistry}
                  disabled={loadingRegistry}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loadingRegistry ? c.registry.loading : c.registry.loadRegistry}
                </button>
                <button
                  type="button"
                  onClick={loadRevocationFeed}
                  disabled={loadingRevocations}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loadingRevocations ? c.registry.loading : c.registry.loadRevocations}
                </button>
              </div>
            </div>

            {registryError && <p className="mt-3 text-sm font-medium text-red-700">{registryError}</p>}
            {revocationError && <p className="mt-3 text-sm font-medium text-red-700">{revocationError}</p>}

            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500">{c.registry.registryHeading}</p>
              {trustRegistry.length === 0 ? (
                <p className="text-sm text-slate-600">{c.registry.registryEmpty}</p>
              ) : (
                trustRegistry.map((item) => (
                  <div key={item.certificateNumber} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-900">{item.certificateNumber}</p>
                    <p className="text-slate-700">{c.registry.trustStatus}: {item.trustStatus}</p>
                    <p className="text-slate-700">{c.registry.farm}: {item.farm?.name || '-'} ({item.farm?.province || '-'})</p>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500">{c.registry.revocationHeading}</p>
              {revocationFeed.length === 0 ? (
                <p className="text-sm text-slate-600">{c.registry.revocationEmpty}</p>
              ) : (
                revocationFeed.map((item) => (
                  <div key={`${item.certificateNumber}-${item.revokedAt}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-900">{item.certificateNumber}</p>
                    <p className="text-slate-700">{c.registry.revokedAt}: {toShortDate(item.revokedAt)}</p>
                    <p className="text-slate-700">{c.registry.reason}: {item.revokedReason || '-'}</p>
                    <p className="text-slate-700">{c.registry.farm}: {item.farmName || '-'} ({item.district || '-'}, {item.province || '-'})</p>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{c.signature.title}</h2>
            <form className="mt-4 space-y-3" onSubmit={handleSignatureVerify}>
              <label className="block text-sm font-medium text-slate-700" htmlFor="payload-input">
                {c.signature.payloadLabel}
              </label>
              <textarea
                id="payload-input"
                rows={5}
                value={payloadInput}
                onChange={(event) => setPayloadInput(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 font-mono text-xs text-slate-900 outline-none transition focus:border-leaf-700"
              />

              <label className="block text-sm font-medium text-slate-700" htmlFor="payload-hash-input">
                {c.signature.hashLabel}
              </label>
              <input
                id="payload-hash-input"
                value={payloadHashInput}
                onChange={(event) => setPayloadHashInput(event.target.value)}
                placeholder={c.signature.hashPlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 font-mono text-xs text-slate-900 outline-none transition focus:border-leaf-700"
              />

              <label className="block text-sm font-medium text-slate-700" htmlFor="signature-input">
                {c.signature.signatureLabel}
              </label>
              <textarea
                id="signature-input"
                rows={3}
                value={signatureInput}
                onChange={(event) => setSignatureInput(event.target.value)}
                placeholder={c.signature.signaturePlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 font-mono text-xs text-slate-900 outline-none transition focus:border-leaf-700"
              />

              <label className="block text-sm font-medium text-slate-700" htmlFor="public-key-input">
                {c.signature.publicKeyLabel}
              </label>
              <textarea
                id="public-key-input"
                rows={3}
                value={publicKeyInput}
                onChange={(event) => setPublicKeyInput(event.target.value)}
                placeholder={c.signature.publicKeyPlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 font-mono text-xs text-slate-900 outline-none transition focus:border-leaf-700"
              />

              <button
                type="submit"
                disabled={checkingSignature}
                className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-leaf-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {checkingSignature ? c.signature.submitting : c.signature.submit}
              </button>
            </form>

            {signatureError && <p className="mt-3 text-sm font-medium text-red-700">{signatureError}</p>}

            {signatureResult && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className={`font-semibold ${signatureResult.valid ? 'text-leaf-700' : 'text-red-700'}`}>
                  {c.signature.outcome}: {signatureResult.valid ? c.signature.pass : c.signature.fail}
                </p>
                <p className="mt-1 text-slate-700">{c.signature.algorithm}: {signatureResult.data?.signatureAlgorithm || 'RSA-SHA256'}</p>
                <p className="break-all text-slate-700">{c.signature.hash}: {signatureResult.data?.hash || '-'}</p>
              </div>
            )}
          </article>

          <article className="rounded-xl border border-slate-200 bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-6">
            <h2 className="text-base font-semibold text-slate-900 sm:text-lg">{c.trace.title}</h2>
            <form className="mt-4 space-y-3" onSubmit={handleTraceLoad}>
              <label className="block text-sm font-medium text-slate-700" htmlFor="trace-entity-type">
                {c.trace.entityTypeLabel}
              </label>
              <select
                id="trace-entity-type"
                value={traceEntityType}
                onChange={(event) => setTraceEntityType(event.target.value as (typeof ENTITY_TYPES)[number])}
                className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-leaf-700"
              >
                {ENTITY_TYPES.map((entityType) => (
                  <option key={entityType} value={entityType}>
                    {entityType}
                  </option>
                ))}
              </select>

              <label className="block text-sm font-medium text-slate-700" htmlFor="trace-entity-id">
                {c.trace.entityIdLabel}
              </label>
              <input
                id="trace-entity-id"
                value={traceEntityId}
                onChange={(event) => setTraceEntityId(event.target.value)}
                placeholder={c.trace.entityIdPlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-card px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-leaf-700"
              />

              <button
                type="submit"
                disabled={loadingTraceEvents}
                className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-leaf-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loadingTraceEvents ? c.trace.submitting : c.trace.submit}
              </button>
            </form>

            {traceError && <p className="mt-3 text-sm font-medium text-red-700">{traceError}</p>}

            {traceEventsResult?.data && (
              <div className="mt-4 max-h-64 space-y-2 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                {traceEventsResult.data.events.length === 0 ? (
                  <p className="text-slate-600">{c.trace.empty}</p>
                ) : (
                  traceEventsResult.data.events.map((event) => (
                    <div key={event.eventId} className="rounded-md border border-slate-200 bg-card p-2">
                      <p className="font-semibold text-slate-900">{event.eventType}</p>
                      <p className="text-slate-600">{toShortDate(event.occurredAt)}</p>
                      <p className="text-slate-600">{c.trace.actor}: {event.actorType}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}
