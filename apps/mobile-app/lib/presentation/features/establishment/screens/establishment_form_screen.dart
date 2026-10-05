import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:image_picker/image_picker.dart';
import 'package:geolocator/geolocator.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../../../core/config/map_config.dart';
import '../providers/establishment_provider.dart';

class EstablishmentFormScreen extends ConsumerStatefulWidget {
  const EstablishmentFormScreen({super.key});

  @override
  ConsumerState<EstablishmentFormScreen> createState() =>
      _EstablishmentFormScreenState();
}

class _EstablishmentFormScreenState
    extends ConsumerState<EstablishmentFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _addressController = TextEditingController();
  final _titleDeedController = TextEditingController();
  final _securityController = TextEditingController();

  final Map<String, String> _typeMap = {
    'เพาะปลูก (Cultivation)': 'farm',
    'แปรรูป (Processing)': 'processing',
    'จำหน่าย (Distribution)': 'shop',
    'ส่งออก (Export)': 'export',
  };

  final List<String> _selectedTypes = [];
  final MapController _mapController = MapController();

  @override
  void dispose() {
    _nameController.dispose();
    _addressController.dispose();
    _titleDeedController.dispose();
    _securityController.dispose();
    super.dispose();
  }

  Future<void> _getCurrentLocation() async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          return;
        }
      }

      final Position position = await Geolocator.getCurrentPosition();
      ref.read(establishmentProvider.notifier).setLocation(
            LatLng(position.latitude, position.longitude),
          );
      // MapController move handled by ref.listen
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('เกิดข้อผิดพลาดในการดึงตำแหน่ง: $e')),
        );
      }
    }
  }

  Future<void> _pickImage(ImageSource source) async {
    final picker = ImagePicker();
    final pickedFile = await picker.pickImage(
        source: source, imageQuality: 80, maxWidth: 1024, maxHeight: 1024);
    if (pickedFile != null) {
      ref.read(establishmentProvider.notifier).setImage(pickedFile);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(establishmentProvider);
    final notifier = ref.read(establishmentProvider.notifier);

    // Listen for changes
    ref.listen(establishmentProvider, (previous, next) {
      // Success
      if (next.isSuccess) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('บันทึกข้อมูลแปลงปลูกสำเร็จ!')),
        );
        Navigator.pop(context);
        notifier.resetForm();
      }
      // Error
      if (next.error != null && !next.isLoading) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(next.error!), backgroundColor: Colors.red),
        );
      }
      // Map Move Logic
      if (previous?.selectedLocation != null &&
          next.selectedLocation != null &&
          next.selectedLocation != previous!.selectedLocation) {
        try {
          _mapController.move(next.selectedLocation!, 15);
        } catch (_) {}
      }
    });

    return Scaffold(
      appBar: AppBar(title: const Text('ลงทะเบียนแปลงปลูก')),
      body: state.isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextFormField(
                      controller: _nameController,
                      decoration: const InputDecoration(
                        labelText: 'ชื่อแปลงปลูก / สถานที่',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(LucideIcons.building),
                      ),
                      validator: (v) =>
                          v?.isEmpty ?? false ? 'กรุณาระบุข้อมูล' : null,
                    ),
                    const SizedBox(height: 16),
                    const Text('ประเภท (Type) - เลือกได้มากกว่า 1',
                        style: TextStyle(
                            fontSize: 14, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.grey.shade400),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Wrap(
                        spacing: 8.0,
                        runSpacing: 4.0,
                        children: _typeMap.entries.map((e) {
                          final isSelected = _selectedTypes.contains(e.value);
                          return FilterChip(
                            label: Text(e.key),
                            selected: isSelected,
                            onSelected: (bool selected) {
                              setState(() {
                                if (selected) {
                                  _selectedTypes.add(e.value);
                                } else {
                                  _selectedTypes.remove(e.value);
                                }
                              });
                            },
                          );
                        }).toList(),
                      ),
                    ),
                    if (_selectedTypes.isEmpty)
                      const Padding(
                        padding: EdgeInsets.only(top: 8.0),
                        child: Text(
                          'กรุณาเลือกอย่างน้อย 1 ประเภท',
                          style: TextStyle(color: Colors.red, fontSize: 12),
                        ),
                      ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _addressController,
                      decoration: const InputDecoration(
                        labelText: 'ที่อยู่',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(LucideIcons.mapPin),
                      ),
                      maxLines: 2,
                      validator: (v) =>
                          v?.isEmpty ?? false ? 'กรุณาระบุข้อมูล' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _titleDeedController,
                      decoration: const InputDecoration(
                        labelText: 'เลขที่โฉนด (Title Deed No.)',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(LucideIcons.fileText),
                      ),
                      validator: (v) =>
                          v?.isEmpty ?? false ? 'กรุณาระบุเลขโฉนด' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _securityController,
                      decoration: const InputDecoration(
                        labelText: 'ระบบความปลอดภัย (Security)',
                        hintText: 'e.g. รั้วลวดหนาม 2m, กล้อง CCTV 4 ตัว',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(LucideIcons.shield),
                      ),
                      maxLines: 2,
                      validator: (v) => v?.isEmpty ?? false
                          ? 'กรุณาระบุระบบรักษาความปลอดภัย'
                          : null,
                    ),
                    const SizedBox(height: 24),
                    const Text('ตำแหน่งพิกัด (ปักหมุด)',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    Container(
                      height: 300,
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.grey),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: state.selectedLocation == null
                          ? Center(
                              child: TextButton.icon(
                                onPressed: _getCurrentLocation,
                                icon: const Icon(LucideIcons.locate),
                                label: const Text('ค้นหาตำแหน่งปัจจุบัน'),
                              ),
                            )
                          : Stack(
                              children: [
                                // The tile source comes from MapConfig, which
                                // has no built-in default. This panel used to
                                // load tiles from tile.openstreetmap.org, so
                                // registering an establishment disclosed
                                // roughly where a Thai farm is to a foreign
                                // server. Without an in-country source the map
                                // is not drawn; the captured coordinates are
                                // shown as text instead so the applicant can
                                // still see and confirm what was recorded.
                                if (MapConfig.isConfigured)
                                  FlutterMap(
                                    mapController: _mapController,
                                    options: MapOptions(
                                      initialCenter: state.selectedLocation!,
                                      initialZoom: 15,
                                      onTap: (tapPosition, point) {
                                        ref
                                            .read(
                                                establishmentProvider.notifier)
                                            .setLocation(point);
                                      },
                                    ),
                                    children: [
                                      TileLayer(
                                        urlTemplate: MapConfig.tileUrl!,
                                        userAgentPackageName: 'com.gacp.app',
                                      ),
                                      MarkerLayer(
                                        markers: [
                                          Marker(
                                            point: state.selectedLocation!,
                                            width: 40,
                                            height: 40,
                                            child: const Icon(
                                                LucideIcons.mapPin,
                                                color: Colors.red,
                                                size: 40),
                                          ),
                                        ],
                                      ),
                                    ],
                                  )
                                else
                                  _CapturedCoordinates(
                                      location: state.selectedLocation!),
                                Positioned(
                                  right: 8,
                                  bottom: 8,
                                  child: FloatingActionButton.small(
                                    heroTag: 'locate_btn',
                                    tooltip: 'ใช้ตำแหน่งปัจจุบัน',
                                    onPressed: _getCurrentLocation,
                                    child: const Icon(LucideIcons.locate),
                                  ),
                                ),
                              ],
                            ),
                    ),
                    const SizedBox(height: 24),
                    const Text('รูปถ่ายประกอบ',
                        style: TextStyle(
                            fontSize: 16, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    if (state.selectedImage != null)
                      Stack(
                        children: [
                          SizedBox(
                            height: 200,
                            width: double.infinity,
                            child: kIsWeb
                                ? Image.network(
                                    state.selectedImage!.path,
                                    fit: BoxFit.cover,
                                  )
                                : Image.file(
                                    File(state.selectedImage!.path),
                                    fit: BoxFit.cover,
                                  ),
                          ),
                          Positioned(
                            right: 0,
                            top: 0,
                            child: IconButton(
                              icon: const Icon(Icons.close, color: Colors.red),
                              onPressed: () => notifier.setImage(null),
                            ),
                          ),
                        ],
                      )
                    else
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _pickImage(ImageSource.camera),
                              icon: const Icon(LucideIcons.camera),
                              label: const Text('กล้องถ่ายรูป'),
                              style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.all(16)),
                            ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => _pickImage(ImageSource.gallery),
                              icon: const Icon(LucideIcons.image),
                              label: const Text('อัลบั้มภาพ'),
                              style: OutlinedButton.styleFrom(
                                  padding: const EdgeInsets.all(16)),
                            ),
                          ),
                        ],
                      ),
                    const SizedBox(height: 32),
                    ElevatedButton(
                      onPressed: () {
                        if (_selectedTypes.isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                                content: Text(
                                    'กรุณาเลือกประเภทอย่างน้อย 1 รายการ (Please select at least 1 type)'),
                                backgroundColor: Colors.red),
                          );
                          return;
                        }

                        if (_formKey.currentState!.validate()) {
                          notifier.createEstablishment(
                            name: _nameController.text,
                            type: _selectedTypes.join(','),
                            address: _addressController.text,
                            titleDeedNo: _titleDeedController.text,
                            security: _securityController.text,
                          );
                        }
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.all(16),
                      ),
                      child: const Text('บันทึกข้อมูล'),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}

/// Shown in place of the map when no in-country tile source is configured.
///
/// The applicant has already captured a location (via the device's GPS or a
/// previous entry); what is missing is only the imagery to draw it on. Showing
/// the recorded coordinates plainly keeps the form honest — the alternative,
/// an empty grey panel, reads as a bug and invites the applicant to re-capture
/// a location that was recorded correctly the first time.
class _CapturedCoordinates extends StatelessWidget {
  const _CapturedCoordinates({required this.location});

  final LatLng location;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            LucideIcons.mapPinOff,
            size: 32,
            color: Theme.of(context).colorScheme.outline,
          ),
          const SizedBox(height: 12),
          const Text(
            'ยังไม่ได้ตั้งค่าแผนที่',
            style: TextStyle(fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'ระบบยังไม่ได้เชื่อมต่อบริการแผนที่ในประเทศ จึงยังไม่แสดงภาพแผนที่ '
            'พิกัดที่บันทึกไว้คือ',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              height: 1.5,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 8),
          SelectableText(
            '${location.latitude.toStringAsFixed(6)}, ${location.longitude.toStringAsFixed(6)}',
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }
}
