import 'package:flutter/material.dart';

// Common Widgets for Wizard Steps

class WizardScaffold extends StatelessWidget {
  final Widget child;
  final String? title;
  final VoidCallback? onBack;
  final VoidCallback? onNext;
  final String nextLabel;
  final bool isNextEnabled;

  const WizardScaffold(
      {super.key,
      required this.child,
      this.title,
      this.onBack,
      this.onNext,
      this.nextLabel = 'ถัดไป',
      this.isNextEnabled = true});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: title != null
          ? AppBar(
              title: Text(title!, style: const TextStyle(fontSize: 16)),
              centerTitle: true)
          : null,
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            child,
            const SizedBox(height: 30),
            Row(
              children: [
                if (onBack != null)
                  Expanded(
                      child: OutlinedButton(
                          onPressed: onBack, child: const Text('ย้อนกลับ'))),
                if (onBack != null && onNext != null) const SizedBox(width: 16),
                if (onNext != null)
                  Expanded(
                      child: FilledButton(
                          onPressed: isNextEnabled ? onNext : null,
                          child: Text(nextLabel))),
              ],
            ),
            const SizedBox(height: 50),
          ],
        ),
      ),
    );
  }
}

class WizardSectionTitle extends StatelessWidget {
  final String title;
  const WizardSectionTitle({super.key, required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16.0),
      child: Text(title,
          style: const TextStyle(
              fontSize: 16, fontWeight: FontWeight.bold, color: Colors.green)),
    );
  }
}

class WizardTextInput extends StatelessWidget {
  final String label;
  final String? value;
  final Function(String) onChanged;
  final int maxLines;
  final TextInputType? keyboardType;

  const WizardTextInput(this.label, this.value, this.onChanged,
      {super.key, this.maxLines = 1, this.keyboardType});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        initialValue: value,
        maxLines: maxLines,
        keyboardType: keyboardType,
        decoration: InputDecoration(
            labelText: label, border: const OutlineInputBorder()),
        onChanged: onChanged,
      ),
    );
  }
}

class WizardRadioTile extends StatelessWidget {
  final String title;
  final String value;
  final String? groupValue;
  final Function(String) onChanged;

  const WizardRadioTile(this.title, this.value, this.groupValue, this.onChanged,
      {super.key});

  @override
  Widget build(BuildContext context) {
    return RadioListTile<String>(
      title: Text(title),
      value: value,
      groupValue: groupValue,
      onChanged: (String? v) {
        if (v != null) onChanged(v);
      },
      dense: true,
      contentPadding: EdgeInsets.zero,
    );
  }
}

// Updated to use Map<String, dynamic> or check strict models?
// For now Step 7 uses its own UI logic, this helps legacy steps or mixed usage.
class WizardDocTile extends StatelessWidget {
  final String title;
  final bool isUploaded;
  final VoidCallback onTap;

  const WizardDocTile(
      {super.key,
      required this.title,
      required this.isUploaded,
      required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(isUploaded ? Icons.check_circle : Icons.cloud_upload,
            color: isUploaded ? Colors.green : Colors.grey),
        title: Text(title, style: const TextStyle(fontSize: 14)),
        subtitle: isUploaded
            ? const Text('แนบแล้ว (Uploaded)',
                style: TextStyle(color: Colors.green))
            : const Text('แตะเพื่ออัพโหลด (Tap to Upload)',
                style: TextStyle(color: Colors.grey)),
        onTap: onTap,
      ),
    );
  }
}

class WizardSummaryRow extends StatelessWidget {
  final String label;
  final String? value;
  const WizardSummaryRow(this.label, this.value, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
              flex: 2,
              child: Text(label, style: const TextStyle(color: Colors.grey))),
          Expanded(
              flex: 3,
              child: Text(value ?? '-',
                  textAlign: TextAlign.right,
                  style: const TextStyle(fontWeight: FontWeight.bold))),
        ],
      ),
    );
  }
}
