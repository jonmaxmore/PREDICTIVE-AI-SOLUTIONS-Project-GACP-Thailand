import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'widgets/scan_overlay.dart';
import '../../core/services/api_service.dart';
import '../../core/providers/offline_provider.dart';
import '../traceability/trace_result_screen.dart';

/// QR Scanner Screen for GACP Certificate Verification
///
/// Features:
/// - Real-time QR code scanning
/// - Offline mode support (stores scans for later sync)
/// - Batch scanning for harvest operations
/// - Flashlight and camera controls
class QRScannerScreen extends ConsumerStatefulWidget {
  final QRScannerMode mode;
  final String? cycleId;

  const QRScannerScreen({
    super.key,
    this.mode = QRScannerMode.verify,
    this.cycleId,
  });

  @override
  ConsumerState<QRScannerScreen> createState() => _QRScannerScreenState();
}

enum QRScannerMode {
  verify, // Verify GACP certificate
  harvest, // Batch scan for harvest
  inventory, // Inventory check
}

class _QRScannerScreenState extends ConsumerState<QRScannerScreen> {
  MobileScannerController? _controller;
  bool _isProcessing = false;
  bool _torchEnabled = false;
  final List<String> _batchScans = [];

  @override
  void initState() {
    super.initState();
    _initializeCamera();
  }

  void _initializeCamera() {
    _controller = MobileScannerController(
      facing: CameraFacing.back,
      torchEnabled: false,
      formats: [BarcodeFormat.qrCode],
    );
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_isProcessing) return;

    final barcode = capture.barcodes.firstOrNull;
    if (barcode == null || barcode.rawValue == null) return;

    final qrCode = barcode.rawValue!;

    // Prevent duplicate scans in batch mode
    if (widget.mode == QRScannerMode.harvest && _batchScans.contains(qrCode)) {
      _showFeedback('สแกนรายการนี้แล้ว', Colors.orange);
      return;
    }

    setState(() => _isProcessing = true);

    try {
      // Check if offline
      final isOffline = ref.read(offlineModeProvider);

      if (isOffline) {
        // Store for later sync
        await _handleOfflineScan(qrCode);
      } else {
        // Process online
        await _handleOnlineScan(qrCode);
      }
    } finally {
      setState(() => _isProcessing = false);
    }
  }

  Future<void> _handleOfflineScan(String qrCode) async {
    final scanResult = ScanResult(
      qrCode: qrCode,
      scannedAt: DateTime.now(),
      gpsLocation: await _getCurrentLocation(),
      synced: false,
    );

    await ref.read(offlineStorageProvider.notifier).saveScan(
          PendingScan(
            id: scanResult.id,
            qrCode: scanResult.qrCode,
            scannedAt: scanResult.scannedAt,
            latitude: scanResult.gpsLocation?.latitude,
            longitude: scanResult.gpsLocation?.longitude,
            accuracy: scanResult.gpsLocation?.accuracy,
            cycleId: widget.cycleId,
          ),
        );

    if (widget.mode == QRScannerMode.harvest) {
      setState(() => _batchScans.add(qrCode));
      _showBatchFeedback();
    } else {
      _showFeedback('บันทึกแบบออฟไลน์แล้ว จะซิงค์เมื่อกลับมาออนไลน์', Colors.orange);
    }
  }

  Future<void> _handleOnlineScan(String qrCode) async {
    try {
      final apiService = ref.read(apiServiceProvider);
      final response = await apiService.get('/api/trace/$qrCode');

      if (response.success && response.data != null) {
        if (widget.mode == QRScannerMode.harvest) {
          setState(() => _batchScans.add(qrCode));
          _showBatchFeedback();
        } else {
          // Navigate to result
          if (mounted) {
            Navigator.push(
              context,
              MaterialPageRoute(
                builder: (_) => TraceResultScreen(
                  qrCode: qrCode,
                  traceData: response.data,
                ),
              ),
            );
          }
        }
      } else {
        _showFeedback(response.error ?? 'คิวอาร์โค้ดไม่ถูกต้อง', Colors.red);
      }
    } on NetworkException {
      // Switch to offline mode
      _handleOfflineScan(qrCode);
    } catch (e) {
      debugPrint('QR scan error: $e');
      _showFeedback('ไม่สามารถบันทึกการสแกนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง', Colors.red);
    }
  }

  Future<GPSLocation?> _getCurrentLocation() async {
    // TODO: Implement GPS location service
    return null;
  }

  void _showBatchFeedback() {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('เพิ่มเข้าชุดแล้ว (${_batchScans.length} รายการ)'),
        duration: const Duration(seconds: 1),
        action: SnackBarAction(
          label: 'เสร็จสิ้น',
          onPressed: _showBatchSummary,
        ),
      ),
    );
  }

  void _showFeedback(String message, Color color) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: color,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  void _showBatchSummary() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => _BatchSummaryModal(
        scans: _batchScans,
        onSubmit: _submitBatch,
        onClear: () {
          setState(() => _batchScans.clear());
          Navigator.pop(context);
        },
      ),
    );
  }

  Future<void> _submitBatch() async {
    if (_batchScans.isEmpty) return;

    setState(() => _isProcessing = true);

    try {
      final apiService = ref.read(apiServiceProvider);
      final gpsLocation = await _getCurrentLocation();

      final response = await apiService.post('/api/harvest-batches', {
        'cycleId': widget.cycleId,
        'scans': _batchScans
            .map((qrCode) => ({
                  'qrCode': qrCode,
                  'scannedAt': DateTime.now().toIso8601String(),
                  'gpsLatitude': gpsLocation?.latitude,
                  'gpsLongitude': gpsLocation?.longitude,
                }))
            .toList(),
      });

      if (response.success) {
        setState(() => _batchScans.clear());
        Navigator.pop(context);

        _showFeedback('ส่งข้อมูลชุดสำเร็จ', Colors.green);
      } else {
        throw Exception(response.error ?? 'ส่งข้อมูลไม่สำเร็จ');
      }
    } catch (e) {
      debugPrint('Batch submit error: $e');
      _showFeedback('ไม่สามารถส่งข้อมูลชุดได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง', Colors.red);
    } finally {
      setState(() => _isProcessing = false);
    }
  }

  void _toggleTorch() {
    setState(() => _torchEnabled = !_torchEnabled);
    _controller?.toggleTorch();
  }

  void _switchCamera() {
    _controller?.switchCamera();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // Camera Preview
          if (_controller != null)
            MobileScanner(
              controller: _controller!,
              onDetect: _onDetect,
            ),
          const Positioned.fill(child: ScanOverlay()),

          // Top Bar
          Positioned(
            top: MediaQuery.of(context).padding.top,
            left: 0,
            right: 0,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.7),
                    Colors.transparent,
                  ],
                ),
              ),
              child: SafeArea(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    IconButton(
                      icon: const Icon(Icons.arrow_back, color: Colors.white),
                      onPressed: () => Navigator.pop(context),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: _getModeColor().withValues(alpha: 0.8),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        _getModeLabel(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                    const SizedBox(width: 48),
                  ],
                ),
              ),
            ),
          ),

          // Bottom Controls
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.bottomCenter,
                  end: Alignment.topCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.8),
                    Colors.transparent,
                  ],
                ),
              ),
              child: SafeArea(
                child: Column(
                  children: [
                    Text(
                      _getInstructions(),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _ControlButton(
                          icon:
                              _torchEnabled ? Icons.flash_on : Icons.flash_off,
                          label: 'แฟลช',
                          onTap: _toggleTorch,
                        ),
                        if (widget.mode == QRScannerMode.harvest &&
                            _batchScans.isNotEmpty)
                          GestureDetector(
                            onTap: _showBatchSummary,
                            child: Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: Colors.green,
                                shape: BoxShape.circle,
                                border:
                                    Border.all(color: Colors.white, width: 3),
                              ),
                              child: Text(
                                '${_batchScans.length}',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 24,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ),
                        _ControlButton(
                          icon: Icons.flip_camera_ios,
                          label: 'สลับกล้อง',
                          onTap: _switchCamera,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),

          // Processing Indicator
          if (_isProcessing)
            Container(
              color: Colors.black54,
              child: const Center(
                child: CircularProgressIndicator(color: Colors.white),
              ),
            ),
        ],
      ),
    );
  }

  Color _getModeColor() {
    switch (widget.mode) {
      case QRScannerMode.verify:
        return Colors.blue;
      case QRScannerMode.harvest:
        return Colors.green;
      case QRScannerMode.inventory:
        return Colors.orange;
    }
  }

  String _getModeLabel() {
    switch (widget.mode) {
      case QRScannerMode.verify:
        return 'ตรวจสอบ';
      case QRScannerMode.harvest:
        return 'เก็บเกี่ยว';
      case QRScannerMode.inventory:
        return 'คลังสินค้า';
    }
  }

  String _getInstructions() {
    switch (widget.mode) {
      case QRScannerMode.verify:
        return 'เล็งคิวอาร์โค้ดให้อยู่ในกรอบเพื่อตรวจสอบใบรับรอง GACP';
      case QRScannerMode.harvest:
        return 'สแกนคิวอาร์โค้ดของต้นพืชแต่ละต้นเพื่อเพิ่มเข้าชุดเก็บเกี่ยว';
      case QRScannerMode.inventory:
        return 'สแกนสินค้าเพื่อตรวจสอบสถานะคลัง';
    }
  }
}

class _ControlButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _ControlButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white24,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: Colors.white, size: 28),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(color: Colors.white, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

/// Scan Result Model
class ScanResult {
  final String id;
  final String qrCode;
  final DateTime scannedAt;
  final GPSLocation? gpsLocation;
  final bool synced;
  final Map<String, dynamic>? traceData;

  ScanResult({
    String? id,
    required this.qrCode,
    required this.scannedAt,
    this.gpsLocation,
    this.synced = false,
    this.traceData,
  }) : id = id ?? DateTime.now().millisecondsSinceEpoch.toString();

  Map<String, dynamic> toJson() => {
        'id': id,
        'qrCode': qrCode,
        'scannedAt': scannedAt.toIso8601String(),
        'gpsLocation': gpsLocation?.toJson(),
        'synced': synced,
        'traceData': traceData,
      };
}

class GPSLocation {
  final double latitude;
  final double longitude;
  final double? accuracy;

  GPSLocation({
    required this.latitude,
    required this.longitude,
    this.accuracy,
  });

  Map<String, dynamic> toJson() => {
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
      };
}

class _BatchSummaryModal extends StatelessWidget {
  final List<String> scans;
  final VoidCallback onSubmit;
  final VoidCallback onClear;

  const _BatchSummaryModal({
    required this.scans,
    required this.onSubmit,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'สรุปชุดสแกน (${scans.length} รายการ)',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 16),
          Container(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.4,
            ),
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: scans.length,
              itemBuilder: (context, index) {
                return ListTile(
                  leading: CircleAvatar(
                    child: Text('${index + 1}'),
                  ),
                  title: Text(
                    scans[index],
                    style: const TextStyle(fontFamily: 'monospace'),
                  ),
                  dense: true,
                );
              },
            ),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: onClear,
                  child: const Text('ล้างทั้งหมด'),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: ElevatedButton(
                  onPressed: onSubmit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.green,
                    foregroundColor: Colors.white,
                  ),
                  child: const Text('ส่งข้อมูลชุด'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
