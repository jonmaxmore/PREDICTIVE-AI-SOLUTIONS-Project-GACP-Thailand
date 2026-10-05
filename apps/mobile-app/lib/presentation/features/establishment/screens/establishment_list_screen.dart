import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../../core/theme/app_theme.dart';
import '../../../../core/ui/responsive_layout.dart';
import '../providers/establishment_provider.dart';
import '../../../../domain/entities/establishment_entity.dart';

class EstablishmentListScreen extends ConsumerStatefulWidget {
  const EstablishmentListScreen({super.key});

  @override
  ConsumerState<EstablishmentListScreen> createState() =>
      _EstablishmentListScreenState();
}

class _EstablishmentListScreenState
    extends ConsumerState<EstablishmentListScreen> {
  @override
  void initState() {
    super.initState();
    // Ensure data is fetched when screen loads
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(establishmentProvider.notifier).loadEstablishments();
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(establishmentProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('แปลงปลูกของฉัน'),
        actions: [
          IconButton(
            icon: const Icon(LucideIcons.plus),
            onPressed: () {
              context.go('/establishments/new');
            },
          ),
        ],
      ),
      body: state.isLoading
          ? const Center(child: CircularProgressIndicator())
          : state.error != null
              ? Center(child: Text('เกิดข้อผิดพลาด: ${state.error}'))
              : ResponsiveLayout(
                  mobileBody: _MobileList(
                    establishments: state.establishments,
                    onDelete: (id) => _confirmDelete(context, ref, id),
                  ),
                  desktopBody: _DesktopTable(
                    establishments: state.establishments,
                    onDelete: (id) => _confirmDelete(context, ref, id),
                  ),
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.go('/establishments/new'),
        child: const Icon(LucideIcons.plus),
      ),
    );
  }

  Future<void> _confirmDelete(
      BuildContext context, WidgetRef ref, String id) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('ยืนยันการลบ'),
        content: const Text('คุณต้องการลบแปลงปลูกนี้ใช่หรือไม่?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('ยกเลิก'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('ลบ'),
          ),
        ],
      ),
    );

    if (confirm ?? false) {
      ref.read(establishmentProvider.notifier).deleteEstablishment(id);
    }
  }
}

class _MobileList extends StatelessWidget {
  final List<EstablishmentEntity> establishments;
  final Function(String) onDelete;

  const _MobileList({required this.establishments, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    if (establishments.isEmpty) {
      return const _CuteFarmEmptyState();
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: establishments.length,
      itemBuilder: (context, index) {
        final item = establishments[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: Colors.green.shade100,
              backgroundImage:
                  item.imageUrl != null ? NetworkImage(item.imageUrl!) : null,
              child: item.imageUrl == null
                  ? Icon(LucideIcons.sprout, color: Colors.green.shade800)
                  : null,
            ),
            title: Text(item.name),
            subtitle: Text(item.type),
            trailing: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _StatusBadge(item: item),
                IconButton(
                  icon: const Icon(LucideIcons.trash,
                      size: 18, color: Colors.red),
                  onPressed: () => onDelete(item.id),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _DesktopTable extends StatelessWidget {
  final List<EstablishmentEntity> establishments;
  final Function(String) onDelete;

  const _DesktopTable({required this.establishments, required this.onDelete});

  @override
  Widget build(BuildContext context) {
    if (establishments.isEmpty) {
      return const _CuteFarmEmptyState();
    }

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Card(
        child: SizedBox(
          width: double.infinity,
          child: DataTable(
            columnSpacing: 24, // Add spacing
            columns: const [
              DataColumn(label: Text('เลขที่ใบอนุญาต')), // New
              DataColumn(label: Text('ชื่อ')),
              DataColumn(label: Text('ประเภท')),
              DataColumn(label: Text('แก้ไขล่าสุด')), // New
              DataColumn(label: Text('สถานะ')),
              DataColumn(label: Text('จัดการ')),
            ],
            rows: establishments.map((item) {
              final updatedDate = item.updatedAt != null
                  ? '${item.updatedAt!.day}/${item.updatedAt!.month}/${item.updatedAt!.year}'
                  : '-';

              return DataRow(cells: [
                DataCell(Text(
                  item.licenseNumber ?? '-',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                )),
                DataCell(Text(item.name)),
                DataCell(Text(item.type)), // String, not Enum
                DataCell(Text(updatedDate)),
                DataCell(_StatusBadge(item: item)), // Pass whole item
                DataCell(Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    IconButton(
                        icon: const Icon(LucideIcons.pencil, size: 18),
                        onPressed: () {}),
                    IconButton(
                      icon: const Icon(LucideIcons.trash,
                          size: 18, color: Colors.red),
                      onPressed: () {
                        onDelete(item.id);
                      },
                    ),
                  ],
                )),
              ]);
            }).toList(),
          ),
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final EstablishmentEntity item; // Changed to accept entity
  const _StatusBadge({required this.item});

  @override
  Widget build(BuildContext context) {
    // Logic for status
    final bool isExpired = item.licenseExpiredAt != null &&
        item.licenseExpiredAt!.isBefore(DateTime.now());

    String label = 'ใช้งานปกติ';
    Color color = Colors.green;

    if (isExpired) {
      label = 'หมดอายุ';
      color = Colors.red;
    } else {
      label = 'ใช้งานปกติ';
      color = Colors.green;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            isExpired ? LucideIcons.alertCircle : LucideIcons.checkCircle2,
            size: 12,
            color: color,
          ),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }
}

class _CuteFarmEmptyState extends StatelessWidget {
  const _CuteFarmEmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: Colors.green.shade50,
              shape: BoxShape.circle,
            ),
            child: Icon(
              LucideIcons.sprout,
              size: 64,
              color: Colors.green.shade400,
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'แปลงปลูกของฉัน',
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: AppTheme.textEmerald, // Emerald 700
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'เริ่มต้นปลูกกัญชงคุณภาพได้ที่นี่',
            style: TextStyle(
              fontSize: 16,
              color: AppTheme.textMuted, // Slate 500
            ),
          ),
          const SizedBox(height: 32),
          ElevatedButton.icon(
            onPressed: () => context.go('/establishments/new'),
            icon: const Icon(LucideIcons.plus),
            label: const Text('เพิ่มแปลงปลูกใหม่'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primaryGreen, // Emerald 500
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(30),
              ),
              elevation: 4,
              shadowColor: AppTheme.primaryGreen.withValues(alpha: 0.4),
            ),
          ),
        ],
      ),
    );
  }
}
