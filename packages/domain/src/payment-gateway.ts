import type { FeeStage } from '@gacp/contracts';
import type { Satang } from './money.ts';

// ประตูรับชำระเงินหนึ่งเดียวที่โดเมนรู้จัก การ implement ของ Stripe อยู่ในไฟล์เดียวของ apps/web
// ห้าม type ของผู้ให้บริการรั่วออกจาก adapter นั้น

export type CreatePaymentSessionInput = {
  readonly quotationId: string;
  readonly applicationReferenceNumber: string;
  readonly feeStage: FeeStage;
  readonly amountSatang: Satang;
  readonly currency: 'THB';
  readonly payerDisplayName: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
};

export type PaymentSession = {
  readonly gatewaySessionId: string;
  readonly redirectUrl: string;
  readonly expiresAt: Date;
};

export const PaymentSettlementStatus = {
  SETTLED: 'SETTLED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  PENDING: 'PENDING',
} as const;
export type PaymentSettlementStatus =
  (typeof PaymentSettlementStatus)[keyof typeof PaymentSettlementStatus];

export type PaymentGatewayEvent = {
  readonly eventId: string;
  readonly gatewaySessionId: string;
  readonly quotationId: string;
  readonly status: PaymentSettlementStatus;
  readonly amountSatang: Satang;
  readonly occurredAt: Date;
};

export type RefundInput = {
  readonly gatewaySessionId: string;
  readonly amountSatang: Satang;
  readonly reasonTh: string;
};

export type RefundResult = {
  readonly gatewayRefundId: string;
  readonly refundedAt: Date;
};

export interface PaymentGateway {
  readonly name: string;
  createPaymentSession(input: CreatePaymentSessionInput): Promise<PaymentSession>;
  parseWebhookEvent(rawBody: string, signatureHeader: string): Promise<PaymentGatewayEvent>;
  getSettlementStatus(gatewaySessionId: string): Promise<PaymentSettlementStatus>;
  refund(input: RefundInput): Promise<RefundResult>;
}
