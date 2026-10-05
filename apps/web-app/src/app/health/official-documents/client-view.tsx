'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Award, FileText, Receipt, Download, Eye,
  Calendar, Shield, QrCode,
} from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { SummaryHeader } from '@/components/feature';
import { apiClient as api } from '@/lib/api/api-client';
import { AuthService } from '@/lib/services/auth-service';
import { parseRowService } from '@/lib/pricing/fee-services';
import { invoiceIsCancelled, invoiceIsPaid } from '@/lib/services/payment-service';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';

/* ── Types ── */
interface CertificateDoc {
  id: string;
  certificateNumber: string;
  farmName: string;
  cropType: string;
  status: string;
  issuedDate: string;
  expiryDate: string;
  pdfUrl?: string;
  pdfGenerated: boolean;
}

interface InvoiceDoc {
  id: string;
  invoiceNumber: string;
  amount?: number;
  /** The register's own total (Decimal string) — what GET /invoices/my actually sends. */
  totalAmount?: number | string;
  /** round 5: the service the row bills (catalogue name, renewal-aware). */
  service?: unknown;
  /** The register's raw word — not normalised, and not one casing across databases. */
  status: string;
  /**
   * The accounting reading of the same row, derived and upper-cased by the backend
   * (invoice-service.js withDerivedStatus) and sent alongside `status`. It was arriving
   * all along and this type never declared it, so every reader here fell back to the raw
   * column. It leads whenever present — see invoiceIsPaid.
   */
  erpStatus?: string;
  phase: string;
  createdAt: string;
  paidAt?: string;
}

interface DocumentGroup {
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string | undefined }>;
  color: string;
  iconBg: string;
  documents: DocumentItem[];
}

interface DocumentItem {
  id: string;
  type: 'certificate' | 'invoice' | 'receipt';
  title: string;
  subtitle: string;
  date: string;
  status: string;
  statusColor: string;
  downloadUrl?: string | undefined;
  canDownload: boolean;
}

function formatThaiDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  const months = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`;
}

export default function OfficialDocumentsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [certificates, setCertificates] = useState<CertificateDoc[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDoc[]>([]);
  const [_error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadDocuments = async () => {
      const user = AuthService.getUser();
      if (!user) {
        router.replace('/auth/health/login');
        return;
      }

      try {
        const [certsRes, invoicesRes] = await Promise.all([
          api.get<CertificateDoc[]>('/api/certificates/my').catch(() => ({ data: null })),
          api.get<InvoiceDoc[]>('/api/invoices/my').catch(() => ({ data: null })),
        ]);

        // apiClient already unwraps one envelope level (api-client.ts:410),
        // and the backend returns a single-level `{ success, data: [...] }`
        // (certificates.js:144, invoices.js:82) — so `res.data` IS the array.
        if (Array.isArray(certsRes.data)) setCertificates(certsRes.data);
        if (Array.isArray(invoicesRes.data)) setInvoices(invoicesRes.data);
      } catch {
        setError('ไม่สามารถโหลดข้อมูลเอกสารได้');
      } finally {
        setLoading(false);
      }
    };

    void loadDocuments();
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }

  // Build document groups
  const documentGroups: DocumentGroup[] = [
    {
      id: 'certificates',
      title: 'ใบรับรอง GACP',
      icon: Award,
      color: 'text-leaf-700',
      iconBg: 'bg-leaf-soft',
      documents: certificates.map((cert) => ({
        id: cert.id,
        type: 'certificate' as const,
        title: `ใบรับรอง ${cert.certificateNumber}`,
        subtitle: `${cert.farmName} — ${cert.cropType}`,
        date: formatThaiDate(cert.issuedDate),
        status: cert.status === 'active' ? 'ใช้งานได้' :
          cert.status === 'expired' ? 'หมดอายุ' :
            cert.status === 'revoked' ? 'ถูกเพิกถอน' : cert.status,
        statusColor: cert.status === 'active' ? 'bg-leaf-soft text-leaf-onSoft' :
          cert.status === 'expired' ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700',
        downloadUrl: cert.pdfUrl || undefined,
        canDownload: cert.pdfGenerated,
      })),
    },
    {
      id: 'invoices',
      title: 'ใบแจ้งหนี้ / ใบเสร็จ',
      icon: Receipt,
      color: 'text-blue-700',
      iconBg: 'bg-blue-50',
      // This page fetches /api/invoices/my RAW, so the register's own status word
      // arrives unmapped. It used to be read with two literals — `=== 'PAID'` and
      // `=== 'PENDING'` — which miss a lower-case `pending` (28 rows on staging),
      // miss RECEIPT_ISSUED entirely (a settled receipt titled ใบแจ้งหนี้, download
      // refused), and miss CANCELLED (a dead bill drawn like any other). The reading
      // now comes from the one vocabulary the invoice mapper owns.
      documents: invoices.map((inv) => {
        const paid = invoiceIsPaid(inv);
        const cancelled = invoiceIsCancelled(inv);
        return {
          id: inv.id,
          type: (paid ? 'receipt' : 'invoice') as 'receipt' | 'invoice',
          title: paid
            ? `ใบเสร็จ ${inv.invoiceNumber}`
            : `ใบแจ้งหนี้ ${inv.invoiceNumber}`,
          // round 5: the service the server says the row bills (GET /invoices/my `service`,
          // renewal-aware). The raw row has no `phase`, so the old test always read งวดที่ 2.
          subtitle: `${parseRowService(inv.service)?.name ?? 'ค่าบริการ'} ฿${Number(inv.amount ?? inv.totalAmount ?? 0).toLocaleString()}`,
          date: inv.paidAt ? formatThaiDate(inv.paidAt) : formatThaiDate(inv.createdAt),
          status: cancelled ? 'ยกเลิก' : paid ? 'ชำระแล้ว' : 'รอชำระ',
          statusColor: cancelled ? 'bg-zinc-100 text-zinc-500' :
            paid ? 'bg-leaf-soft text-leaf-onSoft' :
              'bg-amber-100 text-amber-700',
          // A cancelled bill is not a document to collect against, and an unpaid one
          // has no receipt to hand over yet.
          canDownload: paid && !cancelled,
        };
      }),
    },
  ];

  const hasAnyDocuments = documentGroups.some(g => g.documents.length > 0);

  return (
    // Wave E.2-B: SummaryHeader replaces inline header (gutter from DashboardLayout).
    // Full-width (2026-06-10): owner directive — fill the screen on PC.
    <div className="w-full space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · เอกสารทางการ"
        title="เอกสารทางการ"
        description="ใบรับรอง ใบเสร็จ และเอกสารทางการที่ระบบออกให้"
      />

      {/* No documents */}
      {!hasAnyDocuments && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card py-12">
          <FileText className="h-12 w-12 text-muted-foreground/30" />
          <div className="text-center">
            <p className="text-sm font-bold text-foreground">ยังไม่มีเอกสารทางการ</p>
            <p className="mt-1 text-xs text-muted-foreground">
              เมื่อคุณได้รับใบรับรอง GACP หรือชำระค่าบริการ เอกสารจะแสดงที่นี่
            </p>
          </div>
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/health/applications/new">
              <Shield className="mr-2 h-4 w-4" />
              ยื่นคำขอ GACP
            </Link>
          </Button>
        </div>
      )}

      {/* Document groups */}
      {documentGroups.map((group, gIdx) => (
        group.documents.length > 0 && (
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: gIdx * 0.08 }}
            className="space-y-3"
          >
            {/* Group header */}
            <div className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${group.iconBg}`}>
                <group.icon className={`h-4 w-4 ${group.color}`} />
              </div>
              <h2 className="text-sm font-bold text-foreground">{group.title}</h2>
              <Badge className="rounded-full border-none bg-zinc-100 px-2 py-0 text-[10px] font-bold text-zinc-500">
                {group.documents.length}
              </Badge>
            </div>

            {/* Documents list */}
            <div className="space-y-2">
              {group.documents.map((doc, dIdx) => (
                <motion.div
                  key={doc.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: gIdx * 0.08 + dIdx * 0.04 }}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      doc.type === 'certificate' ? 'bg-leaf-soft text-leaf-onSoft' :
                        doc.type === 'receipt' ? 'bg-blue-50 text-blue-600' :
                          'bg-amber-50 text-amber-600'
                    }`}>
                      {doc.type === 'certificate' ? <Award className="h-4 w-4" /> :
                        doc.type === 'receipt' ? <Receipt className="h-4 w-4" /> :
                          <FileText className="h-4 w-4" />}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-foreground">{doc.title}</p>
                        <Badge className={`rounded-full border-none px-2 py-0 text-[10px] font-bold ${doc.statusColor}`}>
                          {doc.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{doc.subtitle}</p>
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {doc.date}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 gap-1">
                      {doc.type === 'certificate' && (
                        <Link href={`/health/certificates`}>
                          <Button size="sm" variant="ghost" className="h-8 w-8 rounded-full p-0">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}
                      {doc.canDownload && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 rounded-full p-0"
                          onClick={() => {
                            if (doc.downloadUrl) {
                              window.open(doc.downloadUrl, '_blank');
                            } else {
                              toast.info('กำลังเตรียมไฟล์ PDF...');
                            }
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )
      ))}

      {/* QR Verification Info */}
      {certificates.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-leaf-300 bg-leaf-soft/50 p-4">
          <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-leaf-700" />
          <div className="text-xs text-leaf-700">
            <p className="font-bold">ตรวจสอบใบรับรองด้วย QR Code</p>
            <p className="mt-1">
              ใบรับรอง GACP ทุกใบมี QR Code ให้ผู้ซื้อสแกนตรวจสอบความถูกต้องได้ทันที
              ข้อมูลจะเชื่อมโยงกับระบบ Traceability ของ GACP Thaiฯ
            </p>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
          <Link href="/health/certificates">
            <Award className="mr-1.5 h-3 w-3" />
            ใบรับรองทั้งหมด
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
          <Link href="/health/payments">
            <Receipt className="mr-1.5 h-3 w-3" />
            ใบแจ้งหนี้ทั้งหมด
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="rounded-full text-xs">
          <Link href="/health/reports">
            <FileText className="mr-1.5 h-3 w-3" />
            รายงานรายเดือน
          </Link>
        </Button>
      </div>
    </div>
  );
}
