import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../providers/form_state_provider.dart';
import '../../models/gacp_application_models.dart';
import 'wizard_common.dart';
import '../../../../../core/strategies/plant_strategy.dart';

// Thai display labels for stored farm-input type values (display only).
const _farmInputTypeLabels = {
  'Organic Fertilizer': 'ปุ๋ยอินทรีย์',
  'Chemical Fertilizer': 'ปุ๋ยเคมี',
  'Bio Control': 'สารชีวภัณฑ์',
  'Hormone': 'ฮอร์โมน/อาหารเสริม',
};

class Step6Production extends ConsumerWidget {
  const Step6Production({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(applicationFormProvider);
    final notifier = ref.read(applicationFormProvider.notifier);

    // Adaptive Logic: Strategy Pattern
    final plantId = state.plantId ?? '';
    final strategy = PlantStrategyFactory.getStrategy(plantId);
    final isTreeUnit = strategy.usesTreeUnit;

    // We still need plantConfig for validation or we delegate validation to strategy later.
    // For now, keep plantConfig for validation compatibility if needed,
    // but prefer strategy for UI flags.
    final plantConfig = plantConfigs[plantId] ?? plantConfigs.values.first;

    return WizardScaffold(
      title: '6. ข้อมูลการผลิต (Production Plan)',
      onBack: () => context.go('/applications/create/step5'),
      onNext: () {
        if (FormValidator.validateStep6(state.production, plantConfig)) {
          context.go('/applications/create/step7');
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
                content: Text(
                    'กรุณากรอกข้อมูลให้ครบถ้วน รวมถึงการจัดการหลังเก็บเกี่ยว (Please fill all fields)')),
          );
        }
      },
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 1. Plant Parts
            const WizardSectionTitle(title: '1. ส่วนของพืชที่ใช้ (Plant Parts Used)'),
            _buildPlantPartsSelector(
                strategy, state.production.plantParts, notifier),

            const SizedBox(height: 24),

            // 2. Production Plan
            const WizardSectionTitle(title: '2. แผนการผลิต (Production Plan)'),
            if (isTreeUnit) ...[
              // `?? 0` (not tryParse alone): copyWith swallows null, so clearing
              // the field would silently keep the OLD number while the UI shows
              // empty. 0 = "not set" and fails validateStep6's > 0 gate.
              WizardTextInput(
                  'จำนวนต้นที่ปลูก (Tree Count)',
                  state.production.treeCount?.toString() ?? '',
                  (v) => notifier.updateProduction(
                      treeCount: int.tryParse(v) ?? 0),
                  keyboardType: TextInputType.number),
            ] else ...[
              Row(
                children: [
                  Expanded(
                      flex: 2,
                      child: WizardTextInput(
                          'ขนาดพื้นที่ (Area Size)',
                          state.production.areaSizeRai?.toString() ?? '',
                          (v) => notifier.updateProduction(
                              areaSizeRai: double.tryParse(v) ?? 0),
                          keyboardType: TextInputType.number)),
                  const SizedBox(width: 16),
                  Expanded(
                    flex: 1,
                    child: DropdownButtonFormField<String>(
                      initialValue: state.production.areaSizeUnit ?? 'Rai',
                      decoration: const InputDecoration(
                          labelText: 'หน่วย (Unit)',
                          border: OutlineInputBorder()),
                      items: const [
                        DropdownMenuItem(value: 'Rai', child: Text('ไร่')),
                        DropdownMenuItem(value: 'Ngan', child: Text('งาน')),
                        DropdownMenuItem(value: 'Wah', child: Text('ตร.วา')),
                      ],
                      onChanged: (v) =>
                          notifier.updateProduction(areaSizeUnit: v),
                    ),
                  )
                ],
              )
            ],

            const SizedBox(height: 12),
            WizardTextInput(
              strategy.getYieldLabel(),
              state.production.estimatedYield.toString() == '0.0'
                  ? ''
                  : state.production.estimatedYield.toString(),
              (v) => notifier.updateProduction(
                  estimatedYield: double.tryParse(v) ?? 0),
              keyboardType: TextInputType.number,
            ),
            WizardTextInput(
              'รอบการผลิต (Production Cycle - e.g. 3-4 months)',
              state.production.productionCycle,
              (v) => notifier.updateProduction(cycle: v),
            ),

            const SizedBox(height: 24),

            // 3. Traceability / Origin
            const WizardSectionTitle(
                title: '3. แหล่งที่มา (Seed/Source Origin)'),
            _buildOriginSource(state.production.sourceType,
                state.production.sourceDetail, notifier),

            const SizedBox(height: 24),

            // 4. Farm Inputs (New Module)
            _buildFarmInputs(context, state.production.farmInputs, notifier),

            const SizedBox(height: 24),

            // 5. Post Harvest (New Module)
            _buildPostHarvest(state.production.postHarvest, notifier),
          ],
        ),
      ),
    );
  }

  Widget _buildPlantPartsSelector(PlantStrategy strategy,
      List<String> currentSelected, ApplicationFormNotifier notifier) {
    final options = strategy.getPlantPartsOptions();

    return Wrap(
      spacing: 8.0,
      runSpacing: 4.0,
      children: options.map((option) {
        final isSelected = currentSelected.contains(option);
        return FilterChip(
          label: Text(option),
          selected: isSelected,
          onSelected: (selected) {
            final newList = List<String>.from(currentSelected);
            if (selected) {
              newList.add(option);
            } else {
              newList.remove(option);
            }
            notifier.updateProduction(plantParts: newList);
          },
          selectedColor: Colors.green.shade100,
          checkmarkColor: Colors.green,
        );
      }).toList(),
    );
  }

  Widget _buildOriginSource(String currentType, String currentDetail,
      ApplicationFormNotifier notifier) {
    return Column(
      children: [
        RadioListTile<String>(
          title: const Text('นำเข้า (Import)'),
          value: 'Import',
          groupValue: currentType,
          onChanged: (v) => notifier.updateProduction(sourceType: v),
        ),
        if (currentType == 'Import')
          Padding(
              padding: const EdgeInsets.only(left: 32, bottom: 8),
              child: WizardTextInput(
                  'เลขที่ใบอนุญาตนำเข้า (Import License No)',
                  currentDetail,
                  (v) => notifier.updateProduction(sourceDetail: v))),
        RadioListTile<String>(
          title: const Text('ซื้อจากผู้มีใบอนุญาต (Buy from Licensed Seller)'),
          value: 'Buy',
          groupValue: currentType,
          onChanged: (v) => notifier.updateProduction(sourceType: v),
        ),
        if (currentType == 'Buy')
          Padding(
              padding: const EdgeInsets.only(left: 32, bottom: 8),
              child: WizardTextInput(
                  'ชื่อผู้ขาย/เลขใบอนุญาต (Seller Name/License)',
                  currentDetail,
                  (v) => notifier.updateProduction(sourceDetail: v))),
        RadioListTile<String>(
          title: const Text('เก็บเมล็ด/หัวพันธุ์เอง (Self-Sourced)'),
          value: 'Self',
          groupValue: currentType,
          onChanged: (v) => notifier.updateProduction(sourceType: v),
        ),
        if (currentType == 'Self')
          Padding(
              padding: const EdgeInsets.only(left: 32, bottom: 8),
              child: WizardTextInput(
                  'เลข Lot เดิมที่อ้างอิง (Previous Lot No)',
                  currentDetail,
                  (v) => notifier.updateProduction(sourceDetail: v))),
      ],
    );
  }

  // 4. Farm Inputs Widget
  Widget _buildFarmInputs(BuildContext context, List<FarmInputItem> inputs,
      ApplicationFormNotifier notifier) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const WizardSectionTitle(title: '4. ปัจจัยการผลิต (Farm Inputs)'),
            IconButton(
              icon: const Icon(Icons.add_circle, color: Colors.green),
              onPressed: () => _showAddInputDialog(context, notifier),
            )
          ],
        ),
        const Text('ระบุปุ๋ย ยา หรือสารเคมีที่ใช้ (List fertilizers/chemicals)',
            style: TextStyle(color: Colors.grey)),
        const SizedBox(height: 8),
        if (inputs.isEmpty)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(8)),
            child: const Center(
                child: Text('ยังไม่มีข้อมูล (No entries)',
                    style: TextStyle(color: Colors.grey))),
          )
        else
          ...inputs.asMap().entries.map((entry) {
            final i = entry.key;
            final item = entry.value;
            return Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading:
                    const Icon(LucideIcons.flaskConical, color: Colors.orange),
                title: Text(item.name),
                subtitle: Text(
                    '${_farmInputTypeLabels[item.type] ?? item.type} เลขทะเบียน ${item.regNo}'),
                trailing: IconButton(
                  icon: const Icon(Icons.delete, color: Colors.red),
                  onPressed: () => notifier.removeFarmInput(i),
                ),
              ),
            );
          })
      ],
    );
  }

  void _showAddInputDialog(
      BuildContext context, ApplicationFormNotifier notifier) {
    String type = 'Organic Fertilizer';
    String name = '';
    String regNo = '';

    showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
              title: const Text('เพิ่มปัจจัยการผลิต (Add Input)'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: type,
                    items: const [
                      DropdownMenuItem(
                          value: 'Organic Fertilizer',
                          child: Text('ปุ๋ยอินทรีย์')),
                      DropdownMenuItem(
                          value: 'Chemical Fertilizer',
                          child: Text('ปุ๋ยเคมี')),
                      DropdownMenuItem(
                          value: 'Bio Control', child: Text('สารชีวภัณฑ์')),
                      DropdownMenuItem(
                          value: 'Hormone', child: Text('ฮอร์โมน/อาหารเสริม')),
                    ],
                    onChanged: (v) => type = v!,
                    decoration:
                        const InputDecoration(labelText: 'ประเภท (Type)'),
                  ),
                  TextField(
                    decoration: const InputDecoration(
                        labelText: 'ชื่อการค้า (Trade Name)'),
                    onChanged: (v) => name = v,
                  ),
                  TextField(
                    decoration:
                        const InputDecoration(labelText: 'เลขทะเบียน (Reg No)'),
                    onChanged: (v) => regNo = v,
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx),
                  child: const Text('ยกเลิก (Cancel)'),
                ),
                ElevatedButton(
                  onPressed: () {
                    if (name.isNotEmpty) {
                      notifier.addFarmInput(
                          FarmInputItem(type: type, name: name, regNo: regNo));
                      Navigator.pop(ctx);
                    }
                  },
                  child: const Text('เพิ่ม (Add)'),
                )
              ],
            ));
  }

  // 5. Post Harvest Widget
  Widget _buildPostHarvest(
      PostHarvestPlan plan, ApplicationFormNotifier notifier) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const WizardSectionTitle(
            title: '5. การจัดการหลังเก็บเกี่ยว (Post-Harvest)'),
        const Text('วิธีการเก็บเกี่ยว (Harvest Method):',
            style: TextStyle(fontWeight: FontWeight.bold)),
        RadioListTile<String>(
          title: const Text('เก็บด้วยมือ (Manual)'),
          value: 'Manual',
          groupValue: plan.harvestMethod,
          onChanged: (v) => notifier.updatePostHarvest(harvestMethod: v),
        ),
        RadioListTile<String>(
          title: const Text('ใช้เครื่องจักร (Machine)'),
          value: 'Machine',
          groupValue: plan.harvestMethod,
          onChanged: (v) => notifier.updatePostHarvest(harvestMethod: v),
        ),
        const SizedBox(height: 8),
        const Text('วิธีการลดความชื้น (Drying Method):',
            style: TextStyle(fontWeight: FontWeight.bold)),
        RadioListTile<String>(
          title: const Text('ตากแดดบนแคร่ (Sun Dry)'),
          value: 'Sun Dry',
          groupValue: plan.dryingMethod,
          onChanged: (v) => notifier.updatePostHarvest(drying: v),
        ),
        RadioListTile<String>(
          title: const Text('ตู้อบความร้อน (Hot Air Oven)'),
          value: 'Hot Air Oven',
          groupValue: plan.dryingMethod,
          onChanged: (v) => notifier.updatePostHarvest(drying: v),
        ),
        RadioListTile<String>(
          title: const Text('โรงเรือนพลังงานแสงอาทิตย์ (Solar Dome)'),
          value: 'Solar Dome',
          groupValue: plan.dryingMethod,
          onChanged: (v) => notifier.updatePostHarvest(drying: v),
        ),
        WizardTextInput('ภาชนะบรรจุ (Packaging)', plan.packaging,
            (v) => notifier.updatePostHarvest(packaging: v)),
        WizardTextInput('สถานที่เก็บรักษา (Storage)', plan.storage,
            (v) => notifier.updatePostHarvest(storage: v)),
      ],
    );
  }
}
