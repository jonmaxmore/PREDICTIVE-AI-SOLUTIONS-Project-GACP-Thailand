import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../services/application_service.dart' show SubmitException;
import '../services/payment_service.dart';

/// Payment screen for one instalment (or a renewal's one charge).
///
/// ONE service fee (operator 2026-09-11, re-ruled 2026-10-03): the screen shows
/// ค่าบริการ, ภาษีมูลค่าเพิ่ม and ยอดรวม for the instalment, named and described
/// by the server's catalogue (`copy.services`). It never shows a DTAM part or a
/// platform part — the two-quotation / two-invoice / slip-upload flow this screen
/// used to draw was retired on the backend and its endpoints no longer exist.
/// Payment is made on the system's payment page; the receipt is automatic.
class PaymentScreen extends ConsumerStatefulWidget {
  final String applicationId;

  /// 'PHASE_1' or 'PHASE_2' (a renewal's one charge is billed on PHASE_2).
  final String phase;
  const PaymentScreen(
      {super.key, required this.applicationId, this.phase = 'PHASE_1'});

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  bool _loading = true;
  bool _accepting = false;
  String? _error;
  QuotationView? _quotation;
  InvoiceInfo? _invoice;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (widget.applicationId.isEmpty) {
      setState(() {
        _loading = false;
        _error = 'ไม่พบเลขคำขอ เปิดหน้านี้จากรายการคำขอของคุณ';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    final service = ref.read(paymentServiceProvider);
    try {
      final quotation = await service.getQuotation(widget.applicationId);
      final invoice =
          await service.getPhaseInvoice(widget.applicationId, widget.phase);
      if (!mounted) return;
      setState(() {
        _quotation = quotation;
        _invoice = invoice;
        _loading = false;
      });
    } on SubmitException catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'โหลดข้อมูลไม่สำเร็จ ดึงหน้าจอลงเพื่อลองใหม่';
      });
    }
  }

  Future<void> _accept() async {
    setState(() => _accepting = true);
    try {
      await ref.read(paymentServiceProvider).acceptQuotation(widget.applicationId);
      await _load();
    } on SubmitException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _accepting = false);
    }
  }

  /// The served name of this instalment for THIS application (a renewal's
  /// PHASE_2 is the renewal service). Empty until the server answers.
  ServiceLine? get _service => _quotation?.services[widget.phase];

  String _baht(num v) {
    final fixed = v.toStringAsFixed(2);
    final parts = fixed.split('.');
    final whole = parts[0].replaceAllMapped(
        RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');
    return '$whole.${parts[1]} บาท';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_service?.name ?? 'ค่าบริการ',
            style: const TextStyle(fontSize: 16)),
        centerTitle: true,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _buildError()
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _buildQuotationCard(),
                      const SizedBox(height: 12),
                      if (_invoice != null) _buildInvoiceCard(_invoice!),
                      const SizedBox(height: 12),
                      _buildPayNote(),
                      const SizedBox(height: 40),
                    ],
                  ),
                ),
    );
  }

  Widget _buildError() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(LucideIcons.alertTriangle, color: Colors.amber, size: 40),
            const SizedBox(height: 12),
            Text(_error!, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(onPressed: _load, child: const Text('ลองใหม่')),
          ],
        ),
      ),
    );
  }

  Widget _row(String label, String value, {bool bold = false}) {
    final style = TextStyle(
        fontSize: bold ? 16 : 14,
        fontWeight: bold ? FontWeight.bold : FontWeight.normal);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: style)),
          const SizedBox(width: 12),
          Text(value, style: style),
        ],
      ),
    );
  }

  Widget _buildQuotationCard() {
    final q = _quotation;
    if (q == null) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Text('ระบบกำลังออกใบเสนอราคา ดึงหน้าจอลงเพื่อรีเฟรช'),
        ),
      );
    }
    final money = q.phases[widget.phase];
    final service = _service;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('ใบเสนอราคาเลขที่ ${q.quotationNumber}',
                style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 8),
            if (service != null) ...[
              Text(service.name,
                  style: const TextStyle(
                      fontWeight: FontWeight.bold, fontSize: 15)),
              const SizedBox(height: 4),
              Text(service.coverage,
                  style: TextStyle(
                      fontSize: 12,
                      color: Theme.of(context).colorScheme.onSurfaceVariant)),
              const Divider(height: 20),
            ],
            if (money == null)
              const Text('ใบเสนอราคานี้ไม่มีรายการของงวดนี้')
            else ...[
              _row('ค่าบริการ', _baht(money.serviceFee)),
              _row(q.vatName ?? 'ภาษีมูลค่าเพิ่ม', _baht(money.vat)),
              const Divider(height: 16),
              _row('ยอดรวม', _baht(money.total), bold: true),
            ],
            const SizedBox(height: 10),
            if (q.isAccepted)
              const Text('ยอมรับใบเสนอราคาแล้ว',
                  style: TextStyle(color: Colors.green))
            else
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _accepting ? null : _accept,
                  child: Text(_accepting ? 'กำลังยอมรับ…' : 'ยอมรับใบเสนอราคา'),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildInvoiceCard(InvoiceInfo inv) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('ใบแจ้งหนี้เลขที่ ${inv.invoiceNumber}',
                style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            _row('ค่าบริการ', _baht(inv.subtotal)),
            _row(_quotation?.vatName ?? 'ภาษีมูลค่าเพิ่ม', _baht(inv.vat)),
            const Divider(height: 16),
            _row('ยอดที่ต้องชำระ', _baht(inv.totalAmount), bold: true),
            const SizedBox(height: 6),
            Text(inv.isPaid ? 'ชำระแล้ว' : 'รอชำระ',
                style: TextStyle(
                    color: inv.isPaid ? Colors.green : Colors.orange)),
          ],
        ),
      ),
    );
  }

  Widget _buildPayNote() {
    return Text(
      'ชำระเงินได้ที่หน้าชำระเงินของคำขอในระบบ ใบเสร็จรับเงินออกให้อัตโนมัติเมื่อชำระเงินสำเร็จ',
      style: TextStyle(
          fontSize: 13, color: Theme.of(context).colorScheme.onSurfaceVariant),
    );
  }
}
