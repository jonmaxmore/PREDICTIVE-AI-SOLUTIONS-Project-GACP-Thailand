import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../core/providers/core_providers.dart';
import 'application_service.dart' show SubmitException;

/// Applicant payment read model — ONE service fee (operator 2026-09-11, re-ruled
/// 2026-10-03): ค่าบริการ + ภาษีมูลค่าเพิ่ม = ยอดรวม, never a DTAM part and a
/// platform part.
///
/// Every word and every figure comes from the server:
///  - GET  /applications/:id/quotations → `platform` (the one quotation row:
///         its instalments, frozen at acceptance in `acceptedSnapshot`) and
///         `copy.services` (the catalogue name + coverage of each instalment for
///         THIS application; a renewal sends PHASE_1 null and PHASE_2 = the
///         renewal service; `VAT.name` carries the served rate).
///  - POST /applications/:id/quotations/PLATFORM/accept
///  - GET  /invoices/my → the checkout invoice of this phase
///         (serviceType CERTIFICATION_CHECKOUT_M1 / _M2).
///
/// The retired slip / bank-account / two-quotation endpoints this file used to
/// call (/payments/slip/*, /payments/bank-accounts/active) no longer exist on
/// the backend. Payment is taken on the system's payment page; the receipt is
/// issued automatically when it settles.

num _asNum(dynamic v) {
  if (v == null) return 0;
  if (v is num) return v;
  return num.tryParse(v.toString()) ?? 0;
}

num? _asNumOrNull(dynamic v) {
  if (v == null) return null;
  if (v is num) return v;
  return num.tryParse(v.toString());
}

/// One line of the catalogue, as served.
class ServiceLine {
  final String name;
  final String coverage;
  const ServiceLine({required this.name, required this.coverage});

  static ServiceLine? fromMap(dynamic m) {
    if (m is! Map) return null;
    final name = m['name']?.toString() ?? '';
    if (name.trim().isEmpty) return null;
    return ServiceLine(name: name, coverage: m['coverage']?.toString() ?? '');
  }
}

/// What one instalment costs, as the quotation row states it.
class PhaseMoney {
  final num serviceFee;
  final num vat;
  final num total;
  const PhaseMoney(
      {required this.serviceFee, required this.vat, required this.total});
}

class QuotationView {
  final String quotationNumber;
  final String status; // DRAFT/SENT/PENDING/ACCEPTED/INVOICED/...
  final Map<String, PhaseMoney> phases; // PHASE_1 / PHASE_2
  final Map<String, ServiceLine?> services; // PHASE_1 (null = renewal) / PHASE_2
  final String? vatName;

  const QuotationView({
    required this.quotationNumber,
    required this.status,
    required this.phases,
    required this.services,
    this.vatName,
  });

  bool get isAccepted => status == 'ACCEPTED' || status == 'INVOICED';
  bool get isRenewal =>
      services.containsKey('PHASE_1') && services['PHASE_1'] == null;

  /// The GET /applications/:id/quotations `data` object. Null when no
  /// quotation has been issued yet.
  static QuotationView? fromApi(Map<String, dynamic> data) {
    final row = data['platform'];
    if (row is! Map) return null;
    final snapshot = row['acceptedSnapshot'];
    final List source = (snapshot is Map && snapshot['installments'] is List)
        ? snapshot['installments'] as List
        : (row['installments'] is List ? row['installments'] as List : const []);
    final phases = <String, PhaseMoney>{};
    for (final it in source.whereType<Map>()) {
      final phase = it['phase']?.toString() ?? '';
      final fee = _asNumOrNull(it['serviceFeeAmount']);
      final vat = _asNumOrNull(it['vatAmount']);
      final total = _asNumOrNull(it['phaseTotal']) ?? _asNum(it['amount']);
      if (phase.isEmpty || fee == null || vat == null) continue;
      phases[phase] = PhaseMoney(serviceFee: fee, vat: vat, total: total);
    }
    final copy = data['copy'];
    final Map served = (copy is Map && copy['services'] is Map)
        ? copy['services'] as Map
        : const {};
    final services = <String, ServiceLine?>{};
    if (served.containsKey('PHASE_1')) {
      services['PHASE_1'] = ServiceLine.fromMap(served['PHASE_1']);
    }
    if (served.containsKey('PHASE_2')) {
      services['PHASE_2'] = ServiceLine.fromMap(served['PHASE_2']);
    }
    final vat = served['VAT'];
    return QuotationView(
      quotationNumber: row['quotationNumber']?.toString() ?? '',
      status: row['status']?.toString() ?? '',
      phases: phases,
      services: services,
      vatName: vat is Map ? vat['name']?.toString() : null,
    );
  }
}

class InvoiceInfo {
  final String id;
  final String invoiceNumber;
  final String? applicationId;
  final String serviceType; // CERTIFICATION_CHECKOUT_M1 / _M2
  final num subtotal;
  final num vat;
  final num totalAmount;
  final String status;

  const InvoiceInfo({
    required this.id,
    required this.invoiceNumber,
    required this.applicationId,
    required this.serviceType,
    required this.subtotal,
    required this.vat,
    required this.totalAmount,
    required this.status,
  });

  bool get isPaid => const {
        'PAID',
        'PAID_PENDING_RECEIPT',
        'RECEIPT_ISSUED',
        'APPROVED'
      }.contains(status.toUpperCase());

  factory InvoiceInfo.fromMap(Map<String, dynamic> m) => InvoiceInfo(
        id: m['id']?.toString() ?? '',
        invoiceNumber:
            (m['invoiceNumber'] ?? m['documentNumber'])?.toString() ?? '',
        applicationId: (m['applicationId'] ??
                (m['application'] is Map ? m['application']['id'] : null))
            ?.toString(),
        serviceType: m['serviceType']?.toString() ?? '',
        subtotal: _asNum(m['subtotal']),
        vat: _asNum(m['vat']),
        totalAmount: _asNum(m['totalAmount'] ?? m['amount']),
        status: m['status']?.toString() ?? '',
      );
}

/// PHASE_1 → M1, PHASE_2 → M2 (the checkout milestone a phase is billed on).
String milestoneOfPhase(String phase) => phase == 'PHASE_2' ? 'M2' : 'M1';

class PaymentService {
  final DioClient _client;
  PaymentService(this._client);

  Future<QuotationView?> getQuotation(String applicationId) async {
    try {
      final res = await _client.get('/applications/$applicationId/quotations');
      return QuotationView.fromApi(_unwrap(res));
    } on DioException catch (e) {
      throw _err(e, 'โหลดใบเสนอราคาไม่สำเร็จ');
    }
  }

  /// Accept the one quotation. Idempotent on ACCEPTED.
  Future<void> acceptQuotation(String applicationId) async {
    try {
      await _client
          .post('/applications/$applicationId/quotations/PLATFORM/accept');
    } on DioException catch (e) {
      throw _err(e, 'ยอมรับใบเสนอราคาไม่สำเร็จ');
    }
  }

  /// This application's checkout invoice for the phase, if one was issued.
  Future<InvoiceInfo?> getPhaseInvoice(
      String applicationId, String phase) async {
    try {
      final res = await _client.get('/invoices/my');
      final body = res.data;
      final list = (body is Map ? body['data'] : null);
      if (list is! List) return null;
      final want = 'CERTIFICATION_CHECKOUT_${milestoneOfPhase(phase)}';
      for (final m in list.whereType<Map>()) {
        final inv = InvoiceInfo.fromMap(Map<String, dynamic>.from(m));
        if (inv.applicationId == applicationId &&
            inv.serviceType.toUpperCase() == want) {
          return inv;
        }
      }
      return null;
    } on DioException catch (e) {
      throw _err(e, 'โหลดใบแจ้งหนี้ไม่สำเร็จ');
    }
  }

  Map<String, dynamic> _unwrap(Response res) {
    final body = res.data;
    if (body is Map && body['data'] is Map) {
      return Map<String, dynamic>.from(body['data'] as Map);
    }
    if (body is Map) return Map<String, dynamic>.from(body);
    return <String, dynamic>{};
  }

  SubmitException _err(DioException e, String fallback) {
    final data = e.response?.data;
    String message = fallback;
    if (data is Map) {
      final m = data['messageTh'] ?? data['message'] ?? data['error'];
      if (m is String && m.trim().isNotEmpty) message = m;
    }
    return SubmitException(message, statusCode: e.response?.statusCode);
  }
}

final paymentServiceProvider = Provider<PaymentService>((ref) {
  return PaymentService(ref.read(dioClientProvider));
});
