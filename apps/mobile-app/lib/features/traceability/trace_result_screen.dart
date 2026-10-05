import 'package:flutter/material.dart';

class TraceResultScreen extends StatelessWidget {
  const TraceResultScreen({
    super.key,
    required this.qrCode,
    required this.traceData,
  });

  final String qrCode;
  final dynamic traceData;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ผลการตรวจสอบย้อนกลับ'),
      ),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(
          children: [
            _InfoCard(
              title: 'QR Code',
              child: SelectableText(
                qrCode,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
            ),
            const SizedBox(height: 12),
            _InfoCard(
              title: 'ข้อมูลการตรวจสอบย้อนกลับ',
              child: SelectableText(
                _formatData(traceData),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontFamily: 'monospace',
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatData(dynamic data) {
    if (data == null) {
      return '-';
    }
    if (data is String) {
      return data;
    }
    if (data is Map || data is List) {
      return data.toString();
    }
    return '$data';
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.title,
    required this.child,
  });

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}
