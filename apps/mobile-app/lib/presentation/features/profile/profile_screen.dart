import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/storage/secure_storage.dart';
import '../../../core/network/dio_client.dart';
import '../auth/providers/auth_provider.dart';

/// Profile Screen - Synchronized with Web version
/// Features: Personal Info, Security, Account Info, Logout
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _storage = kSecureStorage;
  late DioClient _dioClient;

  bool _isLoading = true;
  bool _isEditing = false;
  bool _isSaving = false;
  String? _message;
  bool _isError = false;

  // User data
  Map<String, dynamic> _user = {};

  // Form controllers
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _companyNameController = TextEditingController();

  // Original values for change detection
  Map<String, String> _originalValues = {};

  @override
  void initState() {
    super.initState();
    _dioClient = DioClient(_storage);
    _loadProfile();
  }

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _companyNameController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    try {
      final response = await _dioClient.get('/auth/health/me');
      if (response.statusCode == 200 && response.data['success'] == true) {
        final userData = response.data['data'] ?? response.data['user'] ?? {};
        setState(() {
          _user = userData;
          _firstNameController.text = userData['firstName'] ?? '';
          _lastNameController.text = userData['lastName'] ?? '';
          _emailController.text = userData['email'] ?? '';
          _phoneController.text = userData['phone'] ?? '';
          _companyNameController.text =
              userData['companyName'] ?? userData['communityName'] ?? '';

          _originalValues = {
            'firstName': _firstNameController.text,
            'lastName': _lastNameController.text,
            'email': _emailController.text,
            'phone': _phoneController.text,
            'companyName': _companyNameController.text,
          };

          _isLoading = false;
        });
      } else {
        setState(() {
          _message = 'ไม่สามารถโหลดข้อมูลได้';
          _isError = true;
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Profile load error: $e');
      setState(() {
        _message = 'ไม่สามารถโหลดข้อมูลโปรไฟล์ได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
        _isError = true;
        _isLoading = false;
      });
    }
  }

  bool get _hasChanges {
    if (!_isEditing) return false;
    return _firstNameController.text != _originalValues['firstName'] ||
        _lastNameController.text != _originalValues['lastName'] ||
        _emailController.text != _originalValues['email'] ||
        _phoneController.text != _originalValues['phone'] ||
        _companyNameController.text != _originalValues['companyName'];
  }

  // Validation - Same as Web version
  bool _validateEmail(String value) {
    return RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value);
  }

  bool _validatePhone(String value) {
    return RegExp(r'^0[689]\d{8}$').hasMatch(value);
  }

  Future<void> _saveProfile() async {
    // Validate before save - same logic as Web
    if (_emailController.text.isNotEmpty &&
        !_validateEmail(_emailController.text)) {
      setState(() {
        _message = 'รูปแบบอีเมลไม่ถูกต้อง';
        _isError = true;
      });
      return;
    }
    if (_phoneController.text.isNotEmpty &&
        !_validatePhone(_phoneController.text)) {
      setState(() {
        _message = 'เบอร์โทรศัพท์ต้องขึ้นต้นด้วย 06, 08, 09 และมี 10 หลัก';
        _isError = true;
      });
      return;
    }

    setState(() {
      _isSaving = true;
      _message = null;
    });

    try {
      final response = await _dioClient.patch('/auth/health/me', data: {
        'firstName': _firstNameController.text,
        'lastName': _lastNameController.text,
        'email': _emailController.text,
        'phone': _phoneController.text,
        'companyName': _companyNameController.text,
      });

      if (response.statusCode == 200 && response.data['success'] == true) {
        setState(() {
          _message = 'บันทึกข้อมูลเรียบร้อยแล้ว';
          _isError = false;
          _isEditing = false;
          _originalValues = {
            'firstName': _firstNameController.text,
            'lastName': _lastNameController.text,
            'email': _emailController.text,
            'phone': _phoneController.text,
            'companyName': _companyNameController.text,
          };
        });
      } else {
        setState(() {
          _message = response.data['message'] ?? 'บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
          _isError = true;
        });
      }
    } catch (e) {
      debugPrint('Profile save error: $e');
      setState(() {
        _message = 'ไม่สามารถบันทึกข้อมูลได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
        _isError = true;
      });
    } finally {
      setState(() => _isSaving = false);
    }
  }

  void _cancelEdit() {
    setState(() {
      _firstNameController.text = _originalValues['firstName'] ?? '';
      _lastNameController.text = _originalValues['lastName'] ?? '';
      _emailController.text = _originalValues['email'] ?? '';
      _phoneController.text = _originalValues['phone'] ?? '';
      _companyNameController.text = _originalValues['companyName'] ?? '';
      _isEditing = false;
      _message = null;
    });
  }

  Future<void> _logout() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ยืนยันออกจากระบบ'),
        content: const Text('คุณต้องการออกจากระบบหรือไม่?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('ยกเลิก'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child:
                const Text('ออกจากระบบ', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirm == true) {
      // Route through the single logout path: AuthNotifier.logout() resets
      // AuthState, WIPES the in-progress wizard state (PDPA — national ID /
      // address / phone must not survive on a shared device) and clears ALL
      // secure-storage keys. The old manual 2-key delete bypassed all of that.
      await ref.read(authProvider.notifier).logout();
      if (mounted) {
        context.go('/login');
      }
    }
  }

  String _getAccountTypeThai() {
    switch (_user['accountType']) {
      case 'INDIVIDUAL':
        return 'บุคคลธรรมดา';
      case 'JURISTIC':
        return 'นิติบุคคล';
      case 'COMMUNITY_ENTERPRISE':
        return 'วิสาหกิจชุมชน';
      default:
        return 'ผู้สมัคร';
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('ตั้งค่าบัญชี'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Subtitle
            Text(
              'จัดการข้อมูลส่วนตัวและการตั้งค่าบัญชี',
              style: TextStyle(color: Colors.grey[600], fontSize: 14),
            ),
            const SizedBox(height: 20),

            // Message banner
            if (_message != null)
              Container(
                padding: const EdgeInsets.all(14),
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: _isError
                      ? Colors.red.withValues(alpha: 0.1)
                      : Colors.green.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Icon(
                      _isError
                          ? Icons.error_outline
                          : Icons.check_circle_outline,
                      color: _isError ? Colors.red : Colors.green,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        _message!,
                        style: TextStyle(
                          color: _isError ? Colors.red : Colors.green,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

            // Personal Info Section
            _buildSection(
              icon: Icons.person_outline,
              title: 'ข้อมูลส่วนตัว',
              subtitle: 'อัปเดตข้อมูลโปรไฟล์และข้อมูลติดต่อ',
              child: Column(
                children: [
                  _buildTextField(
                    label: 'ชื่อ',
                    controller: _firstNameController,
                    enabled: _isEditing,
                  ),
                  _buildTextField(
                    label: 'นามสกุล',
                    controller: _lastNameController,
                    enabled: _isEditing,
                  ),
                  _buildTextField(
                    label: 'อีเมล',
                    controller: _emailController,
                    enabled: _isEditing,
                    keyboardType: TextInputType.emailAddress,
                  ),
                  _buildTextField(
                    label: 'เบอร์โทรศัพท์',
                    controller: _phoneController,
                    enabled: _isEditing,
                    keyboardType: TextInputType.phone,
                  ),
                  _buildTextField(
                    label: 'เลขบัตรประชาชน',
                    initialValue: _user['identifier'] ?? '',
                    enabled: false,
                  ),
                  if (_user['companyName'] != null ||
                      _user['communityName'] != null)
                    _buildTextField(
                      label: 'ชื่อองค์กร/บริษัท',
                      controller: _companyNameController,
                      enabled: _isEditing,
                    ),
                  const SizedBox(height: 16),

                  // Unsaved changes warning
                  if (_hasChanges)
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      margin: const EdgeInsets.only(bottom: 12),
                      decoration: BoxDecoration(
                        color: Colors.orange.withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Row(
                        children: [
                          Icon(Icons.warning_amber,
                              color: Colors.orange, size: 18),
                          SizedBox(width: 8),
                          Text(
                            'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก',
                            style:
                                TextStyle(color: Colors.orange, fontSize: 12),
                          ),
                        ],
                      ),
                    ),

                  // Action buttons
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      if (_isEditing) ...[
                        OutlinedButton(
                          onPressed: _cancelEdit,
                          child: const Text('ยกเลิก'),
                        ),
                        const SizedBox(width: 12),
                        ElevatedButton(
                          onPressed: _isSaving ? null : _saveProfile,
                          child: Text(
                              _isSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'),
                        ),
                      ] else
                        ElevatedButton.icon(
                          onPressed: () => setState(() => _isEditing = true),
                          icon: const Icon(Icons.edit),
                          label: const Text('แก้ไขข้อมูล'),
                        ),
                    ],
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),

            // Security Section
            _buildSection(
              icon: Icons.lock_outline,
              title: 'ความปลอดภัย',
              subtitle: 'จัดการรหัสผ่านและการตั้งค่าความปลอดภัย',
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('รหัสผ่าน'),
                subtitle: const Text('เปลี่ยนรหัสผ่านเพื่อความปลอดภัย'),
                trailing: OutlinedButton(
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                          content: Text('ฟีเจอร์นี้จะเปิดให้บริการเร็ว ๆ นี้')),
                    );
                  },
                  child: const Text('เปลี่ยนรหัสผ่าน'),
                ),
              ),
            ),

            const SizedBox(height: 16),

            // Account Info Section
            _buildSection(
              icon: Icons.info_outline,
              title: 'ข้อมูลบัญชี',
              subtitle: 'ข้อมูลบัญชีและสถานะการใช้งาน',
              child: Column(
                children: [
                  _buildInfoRow('บทบาท', _getAccountTypeThai()),
                  _buildInfoRow('สถานะบัญชี', 'ใช้งานได้', isSuccess: true),
                  _buildInfoRow(
                    'วันที่สร้างบัญชี',
                    _user['createdAt'] != null
                        ? _formatDate(_user['createdAt'])
                        : '-',
                  ),
                  _buildInfoRow(
                    'เข้าสู่ระบบล่าสุด',
                    _user['lastLogin'] != null
                        ? _formatDate(_user['lastLogin'])
                        : 'ไม่ระบุ',
                  ),
                ],
              ),
            ),

            const SizedBox(height: 24),

            // Logout Button
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: _logout,
                icon: const Icon(Icons.logout, color: Colors.red),
                label: const Text('ออกจากระบบ',
                    style: TextStyle(color: Colors.red)),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Colors.red),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
            ),

            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildSection({
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: Theme.of(context).primaryColor.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icon, color: Theme.of(context).primaryColor),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: const TextStyle(
                            fontSize: 16, fontWeight: FontWeight.w600)),
                    Text(subtitle,
                        style:
                            TextStyle(fontSize: 12, color: Colors.grey[600])),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          child,
        ],
      ),
    );
  }

  Widget _buildTextField({
    required String label,
    TextEditingController? controller,
    String? initialValue,
    bool enabled = true,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: controller,
        initialValue: controller == null ? initialValue : null,
        enabled: enabled,
        keyboardType: keyboardType,
        decoration: InputDecoration(
          labelText: label,
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          filled: !enabled,
          fillColor: enabled ? null : Colors.grey.withValues(alpha: 0.1),
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value, {bool isSuccess = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: TextStyle(color: Colors.grey[600], fontSize: 13)),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: isSuccess
                  ? Colors.green.withValues(alpha: 0.1)
                  : Colors.grey.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              value,
              style: TextStyle(
                color: isSuccess ? Colors.green : null,
                fontWeight: isSuccess ? FontWeight.w500 : null,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatDate(String dateStr) {
    try {
      final date = DateTime.parse(dateStr);
      return '${date.day}/${date.month}/${date.year}';
    } catch (e) {
      return dateStr;
    }
  }
}
