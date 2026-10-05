import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../providers/form_state_provider.dart';
import '../../models/gacp_application_models.dart';
import '../../../../../core/theme/app_theme.dart';

class Step0PlantSelection extends ConsumerStatefulWidget {
  const Step0PlantSelection({super.key});

  @override
  ConsumerState<Step0PlantSelection> createState() =>
      _Step0PlantSelectionState();
}

class _Step0PlantSelectionState extends ConsumerState<Step0PlantSelection> {
  String _searchQuery = '';
  String _filterGroup = 'all'; // 'all', 'high', 'general'

  @override
  Widget build(BuildContext context) {
    final notifier = ref.read(applicationFormProvider.notifier);

    // Master Spec: 6 Plants
    final allPlants = plantConfigs.values.toList();

    // Apply search and filter
    final filteredPlants = allPlants.where((plant) {
      // Search filter
      final matchesSearch = _searchQuery.isEmpty ||
          plant.nameTH.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          plant.nameEN.toLowerCase().contains(_searchQuery.toLowerCase());

      // Group filter
      final matchesGroup = _filterGroup == 'all' ||
          (_filterGroup == 'high' && plant.group == PlantGroup.highControl) ||
          (_filterGroup == 'general' && plant.group == PlantGroup.generalHerb);

      return matchesSearch && matchesGroup;
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('เลือกพืชที่ขอรับรอง'),
        backgroundColor: AppTheme.primaryGreenDark,
        foregroundColor: Colors.white,
      ),
      backgroundColor: AppTheme.bgLight,
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            // Search & Filter Section
            _buildSearchFilter(),

            const SizedBox(height: 16),

            // Plant Grid
            Expanded(
              child: filteredPlants.isEmpty
                  ? _buildEmptyState()
                  : GridView.builder(
                      gridDelegate:
                          const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 2,
                        childAspectRatio: 0.75,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                      ),
                      itemCount: filteredPlants.length,
                      itemBuilder: (context, index) {
                        final plant = filteredPlants[index];
                        return _PlantCard(
                          plant: plant,
                          onTap: () =>
                              _showPlantDetailSheet(context, plant, notifier),
                        );
                      },
                    ),
            ),

            // Document Preparation Tips
            const SizedBox(height: 12),
            _buildPreparationTips(),
          ],
        ),
      ),
    );
  }

  /// Search and Filter Widget
  Widget _buildSearchFilter() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withAlpha(13),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        children: [
          // Search Bar
          TextField(
            onChanged: (value) => setState(() => _searchQuery = value),
            decoration: InputDecoration(
              hintText: 'ค้นหาพืช... (เช่น กัญชา, ขิง)',
              prefixIcon: const Icon(Icons.search, color: Colors.grey),
              filled: true,
              fillColor: Colors.grey.shade100,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            ),
          ),
          const SizedBox(height: 12),

          // Filter Chips
          Row(
            children: [
              const Text('กรอง: ',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              _buildFilterChip('ทั้งหมด', 'all'),
              const SizedBox(width: 8),
              _buildFilterChip('ควบคุมพิเศษ', 'high'),
              const SizedBox(width: 8),
              _buildFilterChip('ทั่วไป', 'general'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _filterGroup == value;
    return GestureDetector(
      onTap: () => setState(() => _filterGroup = value),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? AppTheme.primaryGreenDark : Colors.grey.shade200,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.white : Colors.grey.shade700,
            fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            fontSize: 12,
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.search_off, size: 64, color: Colors.grey.shade400),
          const SizedBox(height: 16),
          Text(
            'ไม่พบพืชที่ค้นหา',
            style: TextStyle(fontSize: 16, color: Colors.grey.shade600),
          ),
        ],
      ),
    );
  }

  /// Show bottom sheet with plant details
  void _showPlantDetailSheet(BuildContext context, PlantConfig plant,
      ApplicationFormNotifier notifier) {
    final isHighControl = plant.group == PlantGroup.highControl;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => Container(
        height: MediaQuery.of(context).size.height * 0.7,
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            // Handle bar
            Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),

            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Plant Header
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 40,
                          backgroundColor: isHighControl
                              ? AppTheme.primaryGreen.withAlpha(51)
                              : Colors.orange.withAlpha(51),
                          child: Icon(
                            isHighControl ? Icons.security : Icons.spa,
                            size: 40,
                            color: isHighControl
                                ? AppTheme.primaryGreen
                                : Colors.orange,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                plant.nameTH,
                                style: const TextStyle(
                                  fontSize: 24,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              Text(
                                plant.nameEN,
                                style: TextStyle(
                                  fontSize: 16,
                                  color: Colors.grey.shade600,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 10, vertical: 4),
                                decoration: BoxDecoration(
                                  color: isHighControl
                                      ? Colors.red.shade100
                                      : Colors.green.shade100,
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  isHighControl
                                      ? 'ควบคุมพิเศษ'
                                      : 'สมุนไพรทั่วไป',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.bold,
                                    color: isHighControl
                                        ? Colors.red.shade800
                                        : Colors.green.shade800,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: 24),
                    const Divider(),
                    const SizedBox(height: 16),

                    // Required Documents Section
                    const Text(
                      'เอกสารที่ต้องใช้',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Common docs
                    _buildDocItem('สำเนาบัตรประชาชน', true),
                    _buildDocItem('สำเนาทะเบียนบ้าน', true),
                    _buildDocItem('ผลตรวจประวัติอาชญากรรม', true),
                    _buildDocItem('เอกสารสิทธิ์ที่ดิน', true),
                    _buildDocItem('รูปถ่ายสถานที่ 4 มุม', true),

                    // Group-specific docs
                    if (isHighControl) ...[
                      const SizedBox(height: 12),
                      const Text('เอกสารเพิ่มเติม (ควบคุมพิเศษ):',
                          style: TextStyle(
                              fontWeight: FontWeight.w600, color: Colors.red)),
                      _buildDocItem('ใบอนุญาต/ใบรับจดแจ้ง', true),
                      _buildDocItem('ผังกล้องวงจรปิด', true),
                      _buildDocItem('แผนรักษาความปลอดภัย', true),
                    ],

                    const SizedBox(height: 24),

                    // Time estimate
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.blue.shade50,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.blue.shade200),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.timer, color: Colors.blue.shade700),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              isHighControl
                                  ? 'ระยะเวลาพิจารณา: ~120 วัน\nค่าบริการ: ตามใบเสนอราคาของคำขอ'
                                  : 'ระยะเวลาพิจารณา: ~60 วัน\nค่าบริการ: ตามใบเสนอราคาของคำขอ',
                              style: TextStyle(
                                fontSize: 13,
                                color: Colors.blue.shade800,
                                height: 1.5,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 24),

                    // Select Button
                    SizedBox(
                      width: double.infinity,
                      height: 56,
                      child: ElevatedButton(
                        onPressed: () {
                          Navigator.pop(ctx);
                          notifier.setPlant(plant.id);
                          context.go('/applications/create/step1');
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppTheme.primaryGreenDark,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                          ),
                          elevation: 4,
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Text(
                              'เลือกพืชนี้',
                              style: TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                            const SizedBox(width: 8),
                            const Icon(Icons.arrow_forward_rounded),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDocItem(String text, bool isRequired) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(
            isRequired ? Icons.check_circle : Icons.radio_button_unchecked,
            size: 18,
            color: isRequired ? Colors.green : Colors.grey,
          ),
          const SizedBox(width: 8),
          Text(text, style: const TextStyle(fontSize: 14)),
        ],
      ),
    );
  }

  Widget _buildPreparationTips() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.amber.shade50,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.amber.shade300),
      ),
      child: Row(
        children: [
          Icon(Icons.lightbulb, color: Colors.amber.shade700, size: 24),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'กดที่การ์ดพืชเพื่อดูรายละเอียดเอกสารที่ต้องใช้',
              style: TextStyle(
                fontSize: 13,
                color: Colors.amber.shade900,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PlantCard extends StatelessWidget {
  final PlantConfig plant;
  final VoidCallback onTap;

  const _PlantCard({required this.plant, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isHighControl = plant.group == PlantGroup.highControl;
    final color = isHighControl ? AppTheme.primaryGreen : Colors.orange;

    return Card(
      elevation: 4,
      shadowColor: color.withAlpha(77),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Colors.white,
                color.withAlpha(13),
              ],
            ),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircleAvatar(
                radius: 35,
                backgroundColor: color.withAlpha(38),
                child: Icon(
                  isHighControl ? Icons.security : Icons.spa,
                  color: color,
                  size: 35,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                plant.nameTH,
                style:
                    const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
              ),
              Text(
                plant.nameEN,
                style: TextStyle(color: Colors.grey.shade600, fontSize: 12),
              ),
              const SizedBox(height: 8),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: isHighControl
                      ? Colors.red.shade100
                      : Colors.green.shade100,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  isHighControl ? 'ควบคุม' : 'ทั่วไป',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: isHighControl
                        ? Colors.red.shade800
                        : Colors.green.shade800,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'แตะเพื่อดูรายละเอียด →',
                style: TextStyle(
                  fontSize: 10,
                  color: Colors.grey.shade500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
