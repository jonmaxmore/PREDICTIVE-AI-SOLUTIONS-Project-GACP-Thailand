const PHASE_SERVICE_TYPES = Object.freeze({
  PHASE_1: new Set(['PHASE_1_STATE_FEE', 'PHASE_1_PLATFORM_FEE', 'APPLICATION_FEE']),
  PHASE_2: new Set(['PHASE_2_STATE_FEE', 'PHASE_2_PLATFORM_FEE', 'AUDIT_FEE', 'PHASE_2_AUDIT', 'PHASE2_AUDIT']),
});

function normalizeUpper(value) {
  return String(value || '').trim().toUpperCase();
}

function isPaidInvoiceStatus(status) {
  return ['PAID', 'PAID_PENDING_RECEIPT', 'RECEIPT_ISSUED'].includes(normalizeUpper(status));
}

function isReceiptIssued(invoice) {
  const status = normalizeUpper(invoice?.erpStatus || invoice?.status);
  return status === 'RECEIPT_ISSUED' || Boolean(invoice?.receiptIssuedAt || invoice?.receiptNumber);
}

function rowKey(row) {
  const type = String(row.packagingType || row.packaging_type || '');
  const unitWeight = Number(row.unitWeight ?? row.unit_weight ?? 0);
  const unitCount = Number(row.unitCount ?? row.unit_count ?? 0);
  const totalWeight = Number(row.totalWeight ?? row.total_weight ?? (unitWeight * unitCount));
  return `${type}|${unitWeight}|${unitCount}|${totalWeight}`;
}

function createBillingHelpers({ assert, authHeader, request, requestWithRetry }) {
  async function listInvoicesForApplication(token, applicationId, limit = 300) {
    const result = await request(`/invoices?limit=${limit}`, {
      method: 'GET',
      headers: authHeader(token),
    });
    assert(result.response.ok && result.body?.success, `Invoice list failed: ${result.response.status}`);
    const invoices = result.body?.data?.invoices || [];
    return invoices.filter((invoice) => invoice.applicationId === applicationId);
  }

  async function listPhaseInvoices(token, applicationId, phase) {
    const normalizedPhase = normalizeUpper(phase || 'PHASE_1');
    const serviceTypes = PHASE_SERVICE_TYPES[normalizedPhase];
    assert(serviceTypes, `Unsupported phase for invoice listing: ${phase}`);
    const invoices = await listInvoicesForApplication(token, applicationId);
    return invoices.filter((invoice) => serviceTypes.has(normalizeUpper(invoice.serviceType)));
  }

  async function markPhaseInvoicesPaid(providerToken, applicationId, phase, transactionPrefix = 'MOCK') {
    const phaseInvoices = await listPhaseInvoices(providerToken, applicationId, phase);
    assert(phaseInvoices.length > 0, `No ${phase} invoices found for application ${applicationId}`);

    for (const invoice of phaseInvoices) {
      if (isPaidInvoiceStatus(invoice.erpStatus || invoice.status)) {
        continue;
      }
      const result = await requestWithRetry(`/invoices/${encodeURIComponent(invoice.id)}/pay`, {
        method: 'POST',
        headers: authHeader(providerToken),
        body: JSON.stringify({
          transactionId: `${transactionPrefix}-${Date.now()}-${invoice.id}`,
        }),
      }, { attempts: 4, delayMs: 700 });
      assert(
        result.response.ok && result.body?.success,
        `Mark ${phase} invoice paid failed (${invoice.id}): ${result.response.status} ${JSON.stringify(result.body)}`,
      );
    }

    return listPhaseInvoices(providerToken, applicationId, phase);
  }

  async function issuePhaseReceipts(providerToken, applicationId, phase, notes = 'Receipt issued by ERP script') {
    const phaseInvoices = await listPhaseInvoices(providerToken, applicationId, phase);
    assert(phaseInvoices.length > 0, `No ${phase} invoices found for receipt issuance ${applicationId}`);

    for (const invoice of phaseInvoices) {
      if (isReceiptIssued(invoice)) {
        continue;
      }
      const result = await requestWithRetry(`/invoices/${encodeURIComponent(invoice.id)}/receipt`, {
        method: 'POST',
        headers: authHeader(providerToken),
        body: JSON.stringify({
          paymentMethod: 'BANK_TRANSFER',
          notes,
        }),
      }, { attempts: 4, delayMs: 700 });
      assert(
        result.response.ok && result.body?.success,
        `Issue ${phase} receipt failed (${invoice.id}): ${result.response.status} ${JSON.stringify(result.body)}`,
      );
    }

    return listPhaseInvoices(providerToken, applicationId, phase);
  }

  async function findInvoiceForApplication(token, applicationId) {
    const result = await request('/invoices?limit=300', {
      method: 'GET',
      headers: authHeader(token),
    });
    assert(result.response.ok && result.body?.success, `Invoice list failed: ${result.response.status}`);
    const invoices = result.body?.data?.invoices || [];
    const candidates = invoices.filter((invoice) => invoice.applicationId === applicationId);
    const found = candidates.find((invoice) => ['PAID_PENDING_RECEIPT', 'PAID'].includes(String(invoice.erpStatus || invoice.status || '').toUpperCase()))
      || candidates.find((invoice) => ['PENDING_RECEIPT'].includes(String(invoice.erpStatus || invoice.status || '').toUpperCase()))
      || candidates[0];
    assert(found?.id, `Invoice not found for application ${applicationId}`);
    return found;
  }

  async function issueReceipt(accountToken, invoiceId, notes = 'Receipt issued by ERP script') {
    const result = await requestWithRetry(`/invoices/${encodeURIComponent(invoiceId)}/receipt`, {
      method: 'POST',
      headers: authHeader(accountToken),
      body: JSON.stringify({
        paymentMethod: 'BANK_TRANSFER',
        notes,
      }),
    }, { attempts: 4, delayMs: 700 });
    assert(
      result.response.ok && result.body?.success,
      `Issue receipt failed: ${result.response.status} ${JSON.stringify(result.body)}`,
    );
    return result.body;
  }

  async function listMyCertificates(healthToken) {
    const result = await request('/certificates/my', {
      method: 'GET',
      headers: authHeader(healthToken),
    });
    assert(result.response.ok && result.body?.success, `Fetch my certificates failed: ${result.response.status}`);
    return Array.isArray(result.body?.data) ? result.body.data : [];
  }

  return {
    listInvoicesForApplication,
    listPhaseInvoices,
    markPhaseInvoicesPaid,
    issuePhaseReceipts,
    findInvoiceForApplication,
    issueReceipt,
    listMyCertificates,
    rowKey,
  };
}

module.exports = {
  createBillingHelpers,
};
