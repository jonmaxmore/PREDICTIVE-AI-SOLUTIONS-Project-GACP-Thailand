import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';

/// Provider Profile Screen - Placeholder
class PROVIDERProfileScreen extends StatelessWidget {
  const PROVIDERProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('โปรไฟล์'),
        backgroundColor: AppTheme.primary,
        foregroundColor: Colors.white,
      ),
      body: const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(LucideIcons.user, size: 64, color: Colors.grey),
            SizedBox(height: 16),
            Text('โปรไฟล์เจ้าหน้าที่',
                style: TextStyle(fontSize: 18, color: Colors.grey)),
            SizedBox(height: 8),
            Text('เร็ว ๆ นี้', style: TextStyle(color: Colors.grey)),
          ],
        ),
      ),
    );
  }
}
