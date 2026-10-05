import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mobile_app/presentation/features/application/services/form_config_service.dart';

class HerbTypeSelector extends StatelessWidget {
  final String? value;
  final ValueChanged<String?> onChanged;

  const HerbTypeSelector({
    super.key,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: value,
      decoration: const InputDecoration(
        labelText: 'ชนิดพืชสมุนไพร (Herb Type)',
        border: OutlineInputBorder(),
        helperText: 'เลือกพืชที่ต้องการขอการรับรอง',
        prefixIcon: Icon(LucideIcons.sprout),
      ),
      items: FormConfigService.herbTypeLabels.entries.map((entry) {
        return DropdownMenuItem(
          value: entry.key,
          child: Text(entry.value),
        );
      }).toList(),
      onChanged: onChanged,
      validator: (v) =>
          v == null ? 'กรุณาเลือกชนิดพืช (Please select herb type)' : null,
    );
  }
}
