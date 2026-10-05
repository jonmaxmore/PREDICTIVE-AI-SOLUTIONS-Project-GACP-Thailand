import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../../../core/config/map_config.dart';

/// Plot-location picker.
///
/// Data sovereignty: the tile source comes from [MapConfig], which has no
/// built-in default. This screen used to point straight at
/// `tile.openstreetmap.org`, so every applicant pinning their plot told a
/// foreign server roughly where a Thai farm is, along with their IP.
///
/// With no in-country tile source configured the screen does not fall back
/// abroad — it says so and switches to direct coordinate entry, so an
/// applicant can still complete their application either by typing the
/// coordinates or by using the device's own GPS.
class MapPickerScreen extends StatefulWidget {
  final LatLng? initialCenter;

  const MapPickerScreen({super.key, this.initialCenter});

  @override
  State<MapPickerScreen> createState() => _MapPickerScreenState();
}

class _MapPickerScreenState extends State<MapPickerScreen> {
  late final MapController _mapController;
  late LatLng _currentCenter;

  // Only used when no map can be drawn.
  late final TextEditingController _latController;
  late final TextEditingController _lngController;
  String? _manualEntryError;

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
    // Default to Thailand (approx center) if no initial value
    _currentCenter = widget.initialCenter ?? const LatLng(13.7563, 100.5018);
    _latController = TextEditingController(
        text: _currentCenter.latitude.toStringAsFixed(6));
    _lngController = TextEditingController(
        text: _currentCenter.longitude.toStringAsFixed(6));
  }

  @override
  void dispose() {
    _latController.dispose();
    _lngController.dispose();
    super.dispose();
  }

  /// Thailand's land extent, roughly. Keeps an obvious typo (a swapped pair,
  /// a missing minus) from being submitted as a farm location.
  static const double _minLat = 5.0;
  static const double _maxLat = 21.0;
  static const double _minLng = 97.0;
  static const double _maxLng = 106.0;

  LatLng? _readManualEntry() {
    final lat = double.tryParse(_latController.text.trim());
    final lng = double.tryParse(_lngController.text.trim());
    if (lat == null || lng == null) {
      setState(() => _manualEntryError = 'กรุณากรอกพิกัดเป็นตัวเลข');
      return null;
    }
    if (lat < _minLat || lat > _maxLat || lng < _minLng || lng > _maxLng) {
      setState(() =>
          _manualEntryError = 'พิกัดอยู่นอกขอบเขตประเทศไทย กรุณาตรวจสอบอีกครั้ง');
      return null;
    }
    setState(() => _manualEntryError = null);
    return LatLng(lat, lng);
  }

  void _confirm() {
    if (MapConfig.isConfigured) {
      Navigator.of(context).pop(_currentCenter);
      return;
    }
    final manual = _readManualEntry();
    if (manual != null) {
      Navigator.of(context).pop(manual);
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasMap = MapConfig.isConfigured;

    return Scaffold(
      appBar: AppBar(
        title: const Text('เลือกพิกัดที่ตั้ง'),
        actions: [
          IconButton(
            icon: const Icon(Icons.check),
            tooltip: 'ยืนยันพิกัด',
            onPressed: _confirm,
          )
        ],
      ),
      body: Stack(
        children: [
          if (hasMap)
            FlutterMap(
              mapController: _mapController,
              options: MapOptions(
                initialCenter: _currentCenter,
                initialZoom: 15.0,
                onPositionChanged: (position, hasGesture) {
                  if (position.center != null) {
                    setState(() {
                      _currentCenter = position.center!;
                    });
                  }
                },
              ),
              children: [
                TileLayer(
                  urlTemplate: MapConfig.tileUrl!,
                  userAgentPackageName: 'com.gacp.app',
                ),
                if (MapConfig.attribution.isNotEmpty)
                  Align(
                    alignment: Alignment.bottomRight,
                    child: Container(
                      color: Colors.white70,
                      padding:
                          const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      child: Text(
                        MapConfig.attribution,
                        style: const TextStyle(fontSize: 10),
                      ),
                    ),
                  ),
              ],
            )
          else
            const _MapUnavailableNotice(),
          if (hasMap)
            const Center(
              child: Icon(
                LucideIcons.mapPin,
                color: Colors.red,
                size: 40,
              ),
            ),
          Positioned(
            bottom: 30,
            left: 20,
            right: 20,
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text('พิกัด (ละติจูด / ลองจิจูด)',
                        style: TextStyle(fontWeight: FontWeight.bold)),
                    const SizedBox(height: 8),
                    if (hasMap)
                      Text(
                        '${_currentCenter.latitude.toStringAsFixed(6)}, ${_currentCenter.longitude.toStringAsFixed(6)}',
                        textAlign: TextAlign.center,
                      )
                    else ...[
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _latController,
                              keyboardType: const TextInputType.numberWithOptions(
                                  decimal: true, signed: true),
                              inputFormatters: [
                                FilteringTextInputFormatter.allow(
                                    RegExp(r'[0-9.\-]')),
                              ],
                              decoration: const InputDecoration(
                                labelText: 'ละติจูด',
                                hintText: '13.756300',
                                border: OutlineInputBorder(),
                                isDense: true,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: TextField(
                              controller: _lngController,
                              keyboardType: const TextInputType.numberWithOptions(
                                  decimal: true, signed: true),
                              inputFormatters: [
                                FilteringTextInputFormatter.allow(
                                    RegExp(r'[0-9.\-]')),
                              ],
                              decoration: const InputDecoration(
                                labelText: 'ลองจิจูด',
                                hintText: '100.501800',
                                border: OutlineInputBorder(),
                                isDense: true,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (_manualEntryError != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          _manualEntryError!,
                          style: TextStyle(
                            fontSize: 12,
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ],
                    ],
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: _confirm,
                      child: const Text('ยืนยันพิกัด'),
                    ),
                  ],
                ),
              ),
            ),
          )
        ],
      ),
    );
  }
}

/// Shown in place of the map when no in-country tile source is configured.
///
/// It states the reason rather than showing an empty grey panel: an applicant
/// who cannot see a map should know the feature is switched off, not assume
/// the app is broken or that their connection failed.
class _MapUnavailableNotice extends StatelessWidget {
  const _MapUnavailableNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      alignment: Alignment.topCenter,
      padding: const EdgeInsets.fromLTRB(24, 48, 24, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            LucideIcons.mapPinOff,
            size: 40,
            color: Theme.of(context).colorScheme.outline,
          ),
          const SizedBox(height: 12),
          const Text(
            'ยังไม่ได้ตั้งค่าแผนที่',
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
          ),
          const SizedBox(height: 8),
          Text(
            'ระบบยังไม่ได้เชื่อมต่อบริการแผนที่ในประเทศ จึงยังไม่แสดงภาพแผนที่ '
            'คุณสามารถกรอกพิกัดด้านล่างได้ตามปกติ',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 13,
              height: 1.5,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
