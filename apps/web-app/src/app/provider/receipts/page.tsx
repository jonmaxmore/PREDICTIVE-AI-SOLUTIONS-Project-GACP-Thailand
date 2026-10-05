'use client';


import { useState, useEffect } from 'react';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { IconReceipt, IconCheck, IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@/lib/notifications';
import { apiClient } from '@/lib/api/api-client';
import { useAuth } from '@/lib/services/auth-provider';
import { canIssueReceipts } from '@/lib/constants/canonical-roles';
import ProviderLayout from '../components/provider-layout';
import { formatThaiDate } from '@/lib/format/thai-date';

interface Invoice {
  id: string;
  invoiceNumber: string;
  applicationNumber: string;
  applicantName: string;
  totalAmount: number;
  paidAt: string;
  serviceType: string;
  receiptNumber?: string;
  receiptIssuedAt?: string;
}


interface _PendingReceiptsResponse {
  data?: {
    invoices?: Invoice[];
  };
}

interface _IssueReceiptResponse {
  data?: {
    receiptNumber?: string;
  };
}

export default function ReceiptsPage() {
  // Both finance roles see the same pending-receipt list (operator 2026-09-11 —
  // the per-side filter + banner were removed). Issuing a receipt is a write:
  // only roles holding RECEIPT_ISSUE on the backend get the button and modal
  // (operator 2026-09-27 "กรมฯ ดูอย่างเดียว").
  const { user } = useAuth();
  const canIssue = canIssueReceipts(user?.role);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('QR_CASH');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetchPendingReceipts();
  }, []);

  const fetchPendingReceipts = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ invoices?: Invoice[] }>('/invoices/receipts/pending');

      if (!response.success) throw new Error('Failed to fetch');

      setInvoices(response.data?.invoices || []);
    } catch (_error) {
      notifications.show({
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถโหลดรายการได้',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleIssueReceipt = async () => {
    if (!selectedInvoice) return;

    try {
      setIssuing(true);
      const response = await apiClient.post<{ receiptNumber?: string }>(`/invoices/${selectedInvoice.id}/receipt`, {
        paymentMethod,
        notes,
      });

      if (!response.success) throw new Error('Failed to issue receipt');

      notifications.show({
        title: 'สำเร็จ',
        message: `ออกใบเสร็จเลขที่ ${response.data?.receiptNumber || '-'} เรียบร้อยแล้ว`,
        color: 'green',
        icon: <IconCheck size={16} />,
      });

      setModalOpen(false);
      setSelectedInvoice(null);
      setPaymentMethod('QR_CASH');
      setNotes('');
      fetchPendingReceipts();
    } catch (_error) {
      notifications.show({
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถออกใบเสร็จได้',
        color: 'red',
      });
    } finally {
      setIssuing(false);
    }
  };

  const handleDownloadReceipt = async (invoiceId: string) => {
    try {
      const blob = await apiClient.getBlob(`/invoices/${invoiceId}/receipt/pdf`);

      if (!blob) throw new Error('Failed to download');

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      notifications.show({
        title: 'สำเร็จ',
        message: 'ดาวน์โหลดใบเสร็จเรียบร้อยแล้ว',
        color: 'green',
      });
    } catch (_error) {
      notifications.show({
        title: 'เกิดข้อผิดพลาด',
        message: 'ไม่สามารถดาวน์โหลดได้',
        color: 'red',
      });
    }
  };

  const openIssueModal = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setModalOpen(true);
  };

  return (
    // X2-FIX-B / H-9: Wrap in ProviderLayout so DR/accountants keep the
    // global sidebar, top nav, mobile bottom tabs, and footer chrome.
    // Previously rendered a bare `<div className="max-w-sm">` which
    // (a) lost role-aware navigation and (b) constrained a wide invoice
    // table to ~384px. Inner content now uses full width inherited from
    // DashboardLayout's `max-w-6xl` content wrapper.
    <ProviderLayout title="ออกใบเสร็จรับเงิน" subtitle="รายการที่ชำระเงินแล้ว รอออกใบเสร็จ">
      {/* X4-FIX-D H-12 — receipts page was the ONE ACCOUNT page with no <h1>
          (previously only an inline <h2>). Every other accounting page emits
          a single <h1> via PageToolbar. Upgrade the inline header to <h1> +
          keep the icon decorative (aria-hidden) so the accessible name is the
          single Thai page title. WCAG 2.4.6 Headings & Labels. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            <IconReceipt
              size={32}
              style={{ verticalAlign: 'middle', marginRight: 8 }}
              aria-hidden="true"
            />
            ออกใบเสร็จรับเงิน
          </h1>
          <p className="text-sm text-muted-foreground">
            รายการที่ชำระเงินแล้ว รอออกใบเสร็จ
          </p>
        </div>
        <Button onClick={fetchPendingReceipts} loading={loading}>
          รีเฟรช
        </Button>
      </div>

      {/* Wave E.2-D PR-3: replace inline <Table> with DataTable.
          Sortable invoice number / applicant / amount / paid-at + 25-row
          pages + URL state sync (?receipts_sort=... / ?receipts_page=N).
          Default sort = newest paidAt first.
          */}
      <DataTable<Invoice>
        data={invoices}
        rowKey="id"
        pageSize={25}
        urlStateKey="receipts"
        defaultSort={{ key: 'paidAt', dir: 'desc' }}
        emptyState="ไม่มีรายการที่รอออกใบเสร็จในขณะนี้"
        columns={[
          {
            key: 'invoiceNumber',
            header: 'เลขที่ใบวางบิล',
            sortable: true,
            render: (invoice) => <p className="font-medium">{invoice.invoiceNumber}</p>,
            getSortValue: (invoice) => invoice.invoiceNumber ?? '',
          },
          {
            key: 'applicationNumber',
            header: 'เลขที่คำขอ',
            sortable: true,
            render: (invoice) => invoice.applicationNumber || '-',
            getSortValue: (invoice) => invoice.applicationNumber ?? '',
          },
          {
            key: 'applicantName',
            header: 'ชื่อเกษตรกร',
            sortable: true,
            render: (invoice) => invoice.applicantName || '-',
            getSortValue: (invoice) => invoice.applicantName ?? '',
          },
          {
            key: 'serviceType',
            header: 'ประเภท',
            render: (invoice) => (
              <Badge color={invoice.serviceType === 'APPLICATION_FEE' ? 'blue' : 'green'}>
                {invoice.serviceType === 'APPLICATION_FEE' ? 'งวด 1' : 'งวด 2'}
              </Badge>
            ),
          },
          {
            key: 'totalAmount',
            header: 'จำนวนเงิน',
            sortable: true,
            numeric: true,
            // P1-4: totalAmount is typed number but deserialized from JSON — a
            // null/undefined value threw "Cannot read properties of undefined
            // (reading 'toLocaleString')" and white-screened the row. Coerce first.
            render: (invoice) => <p className="font-semibold">{(Number(invoice.totalAmount) || 0).toLocaleString()} ฿</p>,
            getSortValue: (invoice) => Number(invoice.totalAmount || 0),
          },
          {
            key: 'paidAt',
            header: 'วันที่ชำระ',
            sortable: true,
            // P1-3: paidAt is null for unpaid invoices → was rendering "1/1/2513".
            render: (invoice) =>
              formatThaiDate(invoice.paidAt, { year: 'numeric', month: 'short', day: 'numeric' }),
            getSortValue: (invoice) => invoice.paidAt ?? '',
          },
          {
            key: 'status',
            header: 'สถานะ',
            render: (invoice) =>
              invoice.receiptNumber ? (
                <Badge color="green">ออกแล้ว</Badge>
              ) : (
                <Badge color="yellow">รอออกใบเสร็จ</Badge>
              ),
          },
          {
            key: 'actions',
            header: 'การดำเนินการ',
            render: (invoice) => (
              <div className="flex flex-wrap items-center gap-2">
                {!invoice.receiptNumber ? (
                  canIssue ? (
                    <Button size="sm" onClick={() => openIssueModal(invoice)}>
                      ออกใบเสร็จ
                    </Button>
                  ) : (
                    <span data-role-notice className="text-xs text-muted-foreground">—</span>
                  )
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => handleDownloadReceipt(invoice.id)}>
                    ดาวน์โหลด
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <Dialog open={canIssue && modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>ออกใบเสร็จรับเงิน</DialogTitle></DialogHeader>

          <div className="flex flex-col gap-4">
            <Alert icon={<IconAlertCircle size={16} />} color="blue">
              <p className="text-sm font-medium">
                ใบวางบิล: {selectedInvoice?.invoiceNumber}
              </p>
              <p className="text-sm">
                จำนวนเงิน: {(Number(selectedInvoice?.totalAmount) || 0).toLocaleString()} บาท
              </p>
            </Alert>

            <Select
              label="วิธีการชำระเงิน"
              placeholder="เลือกวิธีการชำระ"
              value={paymentMethod}
              onChange={(value) => setPaymentMethod(value || 'QR_CASH')}
              data={[
                { value: 'QR_CASH', label: 'QR Code / เงินสด' },
                { value: 'BANK_TRANSFER', label: 'โอนเงินผ่านธนาคาร' },
                { value: 'CREDIT_CARD', label: 'บัตรเครดิต' },
              ]}
              required
            />

            <Textarea
              label="หมายเหตุ (ถ้ามี)"
              placeholder="ระบุหมายเหตุเพิ่มเติม"
              value={notes}
              onChange={(e) => setNotes(e.currentTarget.value)}
              rows={3}
            />

            <div className="mt-4 flex flex-wrap items-center">
              <Button variant="default" onClick={() => setModalOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                onClick={handleIssueReceipt}
                loading={issuing}
              >
                ออกใบเสร็จ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ProviderLayout>
  );
}
