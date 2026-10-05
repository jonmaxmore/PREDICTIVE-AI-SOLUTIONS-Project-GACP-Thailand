import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../providers/application_provider.dart';

// Simple Notification Provider
final notificationListProvider =
    FutureProvider.autoDispose<List<dynamic>>((ref) async {
  final dio = ref.watch(applicationProvider.notifier).dio;
  try {
    final response = await dio.get('/v2/notifications');
    return response.data['data'] ?? [];
  } catch (e) {
    return []; // Fail gracefully
  }
});

class NotificationScreen extends ConsumerWidget {
  const NotificationScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificationsAsync = ref.watch(notificationListProvider);

    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('การแจ้งเตือน (Notifications)'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'ทั้งหมด'),
              Tab(text: 'ต้องทำทันที'),
              Tab(text: 'ข่าวสาร'),
            ],
          ),
        ),
        body: notificationsAsync.when(
          data: (notifications) {
            if (notifications.isEmpty) {
              return const Center(child: Text('ไม่มีการแจ้งเตือน'));
            }

            // Filter Logic (Mocked based on keywords or status)
            final actionItems = notifications
                .where((n) =>
                    (n['title'] ?? '').toString().contains('Action') ||
                    (n['title'] ?? '').toString().contains('ชำระ') ||
                    (n['title'] ?? '').toString().contains('แก้ไข'))
                .toList();

            final infoItems =
                notifications.where((n) => !actionItems.contains(n)).toList();

            return TabBarView(
              children: [
                _buildNotificationList(notifications),
                _buildNotificationList(actionItems,
                    emptyMessage: 'ไม่มีรายการที่ต้องทำ'),
                _buildNotificationList(infoItems,
                    emptyMessage: 'ไม่มีข่าวสารใหม่'),
              ],
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (err, stack) {
            debugPrint('Notification load error: $err');
            return const Center(
                child: Text(
                    'ไม่สามารถโหลดการแจ้งเตือนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'));
          },
        ),
      ),
    );
  }

  Widget _buildNotificationList(List<dynamic> items, {String? emptyMessage}) {
    if (items.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(LucideIcons.inbox, size: 48, color: Colors.grey[300]),
            const SizedBox(height: 16),
            Text(emptyMessage ?? 'ไม่มีข้อมูล',
                style: TextStyle(color: Colors.grey[500])),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final note = items[index];
        final isRead = note['isRead'] ?? false;
        final title = note['title'] ?? 'ข้อความจากระบบ';

        // Determine Type/Color
        Color typeColor = Colors.blue;
        IconData typeIcon = LucideIcons.info;

        if (title.contains('อนุมัติ') || title.contains('Approved')) {
          typeColor = Colors.green;
          typeIcon = LucideIcons.checkCircle;
        } else if (title.contains('แก้ไข') ||
            title.contains('ชำระ') ||
            title.contains('Rejected')) {
          typeColor = Colors.red;
          typeIcon = LucideIcons.alertCircle;
        }

        return Container(
          margin: const EdgeInsets.only(bottom: 12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.05),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: IntrinsicHeight(
              child: Row(
                children: [
                  // Color Strip
                  Container(width: 6, color: typeColor),

                  // Content
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(typeIcon, size: 20, color: typeColor),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  title,
                                  style: TextStyle(
                                    fontWeight: isRead
                                        ? FontWeight.normal
                                        : FontWeight.bold,
                                    fontSize: 16,
                                  ),
                                ),
                              ),
                              if (!isRead)
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Colors.red[50],
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: const Text('ใหม่',
                                      style: TextStyle(
                                          fontSize: 10,
                                          color: Colors.red,
                                          fontWeight: FontWeight.bold)),
                                ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Text(
                            note['message'] ?? '',
                            style:
                                TextStyle(color: Colors.grey[700], height: 1.4),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            note['createdAt'] != null
                                ? note['createdAt'].toString().substring(0, 10)
                                : 'เมื่อเร็ว ๆ นี้',
                            style: TextStyle(
                                fontSize: 12, color: Colors.grey[400]),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
