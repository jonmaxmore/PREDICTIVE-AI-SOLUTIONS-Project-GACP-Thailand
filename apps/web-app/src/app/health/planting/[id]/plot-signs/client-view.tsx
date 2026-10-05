'use client';

/**
 * Print the plot signs for a cycle.
 *
 * `?code=PLOT-XXXXX-XXXXX` prints one plot; no query prints every plot in the cycle. Both
 * come from the plots tab, so the farmer reaches paper in one press from where they already
 * manage plots.
 *
 * The QR encodes the PERMANENT plot URL (`/trace/plot-cycle/<plotCode>`), never the
 * per-cycle QR string the same endpoint also returns. That distinction is the entire point
 * of the layer: the per-cycle code is unique per (cycle, plot) and is reborn every season,
 * so a sign carrying it would go dead at the next planting while still hanging on the post.
 *
 * Error correction is level H (~30% recoverable) with a 4-module quiet zone. That is heavier
 * than a screen QR needs and it is deliberate: this one gets rained on, sun-bleached, and
 * scanned at an angle by a phone held in a muddy hand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';

import { Button } from '@/components/ui/primitives/button';
import { Icons } from '@/components/ui/icons';
import { Spinner } from '@/components/ui/spinner';
import { plantingService } from '@/lib/services/planting-service';

import { PlotSignSheet, type PlotSign } from './plot-sign-sheet';
import { toAbsoluteUrl } from '../planting-cycle-detail-page-config';

/** Same shape the plots tab reads; the permanent fields are optional for the same reason. */
type PlotQrRow = {
  cyclePlotId: string;
  plotName?: string | null;
  plotCode?: string | null;
  qrRevokedAt?: string | null;
};

export default function ClientView() {
  const params = useParams();
  const searchParams = useSearchParams();
  const cycleId = String(params?.id || '');
  const requestedCode = String(searchParams?.get('code') || '').trim().toUpperCase();

  const [loading, setLoading] = useState(true);
  const [farmName, setFarmName] = useState('');
  const [rows, setRows] = useState<PlotQrRow[]>([]);
  const [qrByCode, setQrByCode] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cycleId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      const [cycleResult, qrResult] = await Promise.all([
        plantingService.getCycleById(cycleId),
        plantingService.listPlotCycleQrs(cycleId),
      ]);
      if (cancelled) return;

      if (!cycleResult.success || !qrResult.success) {
        // Never claim the plot has no sign when the load is what failed — say the load
        // failed and offer the retry.
        setError('โหลดข้อมูลแปลงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        setLoading(false);
        return;
      }

      setError(null);
      setFarmName(String(cycleResult.data?.farm?.farmName || ''));
      setRows((qrResult.data || []) as unknown as PlotQrRow[]);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [cycleId]);

  const selectedRows = useMemo(() => {
    const withCode = rows.filter((row) => Boolean(row.plotCode));
    if (!requestedCode) return withCode;
    return withCode.filter((row) => String(row.plotCode).toUpperCase() === requestedCode);
  }, [requestedCode, rows]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const next: Record<string, string> = {};
      for (const row of selectedRows) {
        const code = String(row.plotCode);
        try {
          next[code] = await QRCode.toDataURL(toAbsoluteUrl(`/trace/plot-cycle/${code}`), {
            errorCorrectionLevel: 'H',
            margin: 4,
            width: 640,
            color: { dark: '#000000', light: '#ffffff' },
          });
        } catch {
          // The sign still prints; PlotSignSheet falls back to the readable code.
        }
      }
      if (!cancelled) setQrByCode(next);
    })();

    return () => { cancelled = true; };
  }, [selectedRows]);

  const signs: PlotSign[] = useMemo(
    () => selectedRows.map((row) => ({
      plotCode: String(row.plotCode),
      plotName: String(row.plotName || 'แปลงปลูก'),
      farmName,
      qrDataUrl: qrByCode[String(row.plotCode)] || null,
      revokedAt: row.qrRevokedAt || null,
    })),
    [farmName, qrByCode, selectedRows],
  );

  const handlePrint = useCallback(() => { window.print(); }, []);

  return (
    <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground">ป้ายรหัสแปลง</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            พิมพ์แล้วติดไว้ที่แปลง สแกนเพื่อบันทึกงานได้ทันที ป้ายนี้ใช้ได้ทุกรอบปลูก
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href={`/health/planting/${cycleId}?tab=plots`} size="sm" variant="subtle">
            กลับไปหน้ารอบปลูก
          </Button>
          <Button
            size="lg"
            onClick={handlePrint}
            disabled={signs.length === 0}
            leftSection={<Icons.Printer size={18} />}
          >
            พิมพ์
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="no-print flex items-center justify-center py-16">
          <Spinner color="primary" size="lg" />
        </div>
      ) : null}

      {!loading && error ? (
        <p className="no-print rounded-lg border border-border bg-card p-6 text-sm text-foreground" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error && signs.length === 0 ? (
        <p className="no-print rounded-lg border border-border bg-card p-6 text-sm text-foreground">
          {requestedCode
            ? 'ไม่พบรหัสแปลงนี้ในรอบปลูกนี้ กลับไปหน้ารอบปลูกแล้วเลือกแปลงอีกครั้ง'
            : 'ยังไม่มีแปลงที่มีรหัสแปลงในรอบนี้ กลับไปหน้ารอบปลูกแล้วกดสร้าง/รีเฟรช QR ก่อน'}
        </p>
      ) : null}

      {signs.length > 0 ? <PlotSignSheet signs={signs} /> : null}
    </div>
  );
}
