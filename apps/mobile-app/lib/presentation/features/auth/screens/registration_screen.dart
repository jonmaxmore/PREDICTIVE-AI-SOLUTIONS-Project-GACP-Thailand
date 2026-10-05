import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../providers/auth_provider.dart';
import '../../../../core/theme/app_theme.dart';

/// GACP Official Registration Screen
/// Multi-Account Type: Individual, Juristic, Community Enterprise
class RegistrationScreen extends ConsumerStatefulWidget {
  final int initialStep;

  const RegistrationScreen({super.key, this.initialStep = 0});

  @override
  ConsumerState<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends ConsumerState<RegistrationScreen> {
  final _formKey = GlobalKey<FormState>();

  // Account Type
  String _accountType = '';

  // Controllers - Common
  final _identifierController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  // Controllers - Individual
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();

  // Controllers - Juristic
  final _companyNameController = TextEditingController();
  final _representativeNameController = TextEditingController();

  // Controllers - Community
  final _communityNameController = TextEditingController();
  final _contactNameController = TextEditingController();

  // State
  bool _isPasswordVisible = false;
  bool _isConfirmPasswordVisible = false;
  bool _isLoading = false;
  bool _acceptTerms = false;
  late int _currentStep;

  @override
  void initState() {
    super.initState();
    _currentStep = widget.initialStep;
  }

  void _goToStep(int step) {
    setState(() => _currentStep = step);
    // URL update removed - only works on web platform
  }

  // Error message for identifier duplicate check

  /// Show error SnackBar for identifier validation
  void _showIdentifierError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            const Icon(Icons.error_outline, color: Colors.white),
            const SizedBox(width: 12),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: Colors.red.shade600,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        margin: const EdgeInsets.all(16),
        duration: const Duration(seconds: 4),
      ),
    );
  }

  /// Check if identifier is available (not already registered)
  Future<bool> _checkIdentifierAvailable() async {
    final cleanId = _identifierController.text.replaceAll('-', '');

    // Local format validation first
    if (_accountType != 'COMMUNITY_ENTERPRISE') {
      if (cleanId.length != 13) {
        _showIdentifierError('ต้องมี 13 หลัก');
        return false;
      }
      if (!RegExp(r'^\d+$').hasMatch(cleanId)) {
        _showIdentifierError('ต้องเป็นตัวเลขเท่านั้น');
        return false;
      }
    }

    setState(() => _isLoading = true);

    try {
      final dio = ref.read(dioClientProvider);
      final response = await dio.post(
        '/auth/health/check-identifier',
        data: {
          'identifier': cleanId,
          'accountType': _accountType,
        },
      );

      setState(() => _isLoading = false);

      if (response.statusCode == 200) {
        final data = response.data;
        if (data['available'] == true) {
          return true;
        } else {
          final errorMsg = data['error'] ?? 'หมายเลขนี้ถูกใช้งานแล้ว';
          _showIdentifierError(errorMsg);
          return false;
        }
      } else {
        final errorMsg = response.data['error'] ?? 'ตรวจสอบไม่ได้';
        _showIdentifierError(errorMsg);
        return false;
      }
    } catch (e) {
      setState(() => _isLoading = false);
      _showIdentifierError('ไม่สามารถตรวจสอบ ID ได้ กรุณาลองใหม่');
      return false;
    }
  }

  // Account Types — INDIVIDUAL ONLY (matches web: register-actions.ts
  // hardcodes accountType 'INDIVIDUAL'). Backend healthRegisterSchema requires
  // a Mod-11-valid NATIONAL ID + firstName/lastName for every registration, so
  // the old JURISTIC/COMMUNITY_ENTERPRISE tabs (tax-ID / reg-number as the
  // identifier) were guaranteed 400s. Entities are created later as
  // workspaces (นิติบุคคล/วิสาหกิจชุมชน สร้างเป็น workspace หลังเข้าสู่ระบบ).
  static const List<Map<String, dynamic>> _accountTypes = [
    {
      'type': 'INDIVIDUAL',
      'label': 'บุคคลธรรมดา',
      'subtitle': 'สมัครด้วยเลขบัตรประชาชน (นิติบุคคล/วิสาหกิจชุมชน เพิ่มภายหลัง)',
      'icon': Icons.person,
      'color': AppTheme.accountIndividual,
      'idLabel': 'เลขบัตรประชาชน 13 หลัก',
      'idHint': '1-2345-67890-12-3',
    },
  ];

  Map<String, dynamic> get _currentAccountConfig {
    return _accountTypes.firstWhere(
      (t) => t['type'] == _accountType,
      orElse: () => _accountTypes[0],
    );
  }

  // Step labels based on account type
  List<String> get _stepLabels => [
        'ประเภทบัญชี',
        'ยืนยันตัวตน',
        _accountType == 'INDIVIDUAL' ? 'ข้อมูลส่วนตัว' : 'ข้อมูลองค์กร',
        'ตั้งรหัสผ่าน',
      ];

  String? _validateIdentifier(String? value) {
    if (value == null || value.isEmpty) {
      return 'กรุณากรอก${_currentAccountConfig['idLabel']}';
    }
    String clean = value.replaceAll('-', '');
    if (_accountType != 'COMMUNITY_ENTERPRISE') {
      if (clean.length != 13) return 'ต้องมี 13 หลัก';
      if (!RegExp(r'^\d+$').hasMatch(clean)) return 'ต้องเป็นตัวเลขเท่านั้น';
    }
    return null;
  }

  String? _validateRequired(String? value, String fieldName) {
    if (value == null || value.isEmpty) return 'กรุณากรอก$fieldName';
    return null;
  }

  String? _validatePhone(String? value) {
    if (value == null || value.isEmpty) return 'กรุณากรอกเบอร์โทรศัพท์';
    if (value.length < 10) return 'เบอร์โทรศัพท์ไม่ถูกต้อง';
    return null;
  }

  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return 'กรุณากรอกรหัสผ่าน';
    if (value.length < 8) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
    if (!value.contains(RegExp(r'[0-9]'))) return 'รหัสผ่านต้องมีตัวเลข';
    return null;
  }

  String? _validateConfirmPassword(String? value) {
    if (value != _passwordController.text) return 'รหัสผ่านไม่ตรงกัน';
    return null;
  }

  bool _canProceedToNextStep() {
    switch (_currentStep) {
      case 0:
        return _accountType.isNotEmpty;
      case 1:
        return _validateIdentifier(_identifierController.text) == null;
      case 2:
        if (_accountType == 'INDIVIDUAL') {
          return _firstNameController.text.isNotEmpty &&
              _lastNameController.text.isNotEmpty &&
              _phoneController.text.length >= 10;
        } else if (_accountType == 'JURISTIC') {
          return _companyNameController.text.isNotEmpty &&
              _representativeNameController.text.isNotEmpty &&
              _phoneController.text.length >= 10;
        } else {
          return _communityNameController.text.isNotEmpty &&
              _contactNameController.text.isNotEmpty &&
              _phoneController.text.length >= 10;
        }
      case 3:
        return _validatePassword(_passwordController.text) == null &&
            _validateConfirmPassword(_confirmPasswordController.text) == null &&
            _acceptTerms;
      default:
        return false;
    }
  }

  Future<void> _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_acceptTerms) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('กรุณายอมรับเงื่อนไขการใช้งาน'),
          backgroundColor: Colors.red.shade600,
          behavior: SnackBarBehavior.floating,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          margin: const EdgeInsets.all(16),
        ),
      );
      return;
    }

    FocusScope.of(context).unfocus();
    setState(() => _isLoading = true);

    // Build registration data based on account type
    final Map<String, dynamic> registrationData = {
      'accountType': _accountType,
      'identifier': _identifierController.text.replaceAll('-', ''),
      'phoneNumber': _phoneController.text,
      'password': _passwordController.text,
      // Backend healthRegisterSchema REQUIRES both consents === true
      // (COMP-006 PDPA) — without them every registration 400s. The
      // _acceptTerms checkbox covers both statements affirmatively.
      'acceptedTermsOfService': _acceptTerms,
      'acceptedPrivacyPolicy': _acceptTerms,
    };
    // NOTE: never log registrationData — it contains the password and the
    // 13-digit national ID in plaintext.

    if (_accountType == 'INDIVIDUAL') {
      registrationData['firstName'] = _firstNameController.text;
      registrationData['lastName'] = _lastNameController.text;
      registrationData['idCard'] =
          _identifierController.text.replaceAll('-', '');
    } else if (_accountType == 'JURISTIC') {
      registrationData['companyName'] = _companyNameController.text;
      registrationData['representativeName'] =
          _representativeNameController.text;
      registrationData['taxId'] =
          _identifierController.text.replaceAll('-', '');
    } else {
      registrationData['communityName'] = _communityNameController.text;
      registrationData['representativeName'] = _contactNameController.text;
      registrationData['communityRegistrationNo'] = _identifierController.text;
    }

    try {
      // Call actual registration API
      final result = await ref
          .read(authProvider.notifier)
          .registerWithData(registrationData);

      if (mounted) {
        setState(() => _isLoading = false);

        if (result != null) {
          // Error occurred
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Row(
                children: [
                  const Icon(Icons.error_outline, color: Colors.white),
                  const SizedBox(width: 12),
                  Expanded(child: Text(result)),
                ],
              ),
              backgroundColor: Colors.red.shade600,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10)),
              margin: const EdgeInsets.all(16),
            ),
          );
        } else {
          // Success
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Row(
                children: [
                  Icon(Icons.check_circle, color: Colors.white),
                  SizedBox(width: 12),
                  Text('ลงทะเบียนสำเร็จ!'),
                ],
              ),
              backgroundColor: AppTheme.primaryGreenDark,
              behavior: SnackBarBehavior.floating,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10)),
              margin: const EdgeInsets.all(16),
            ),
          );
          context.go('/login');
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const Icon(Icons.error_outline, color: Colors.white),
                const SizedBox(width: 12),
                Expanded(child: Text('เกิดข้อผิดพลาด: ${e.toString()}')),
              ],
            ),
            backgroundColor: Colors.red.shade600,
            behavior: SnackBarBehavior.floating,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            margin: const EdgeInsets.all(16),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.bgLight,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios,
              color: AppTheme.primaryGreenDark),
          onPressed: () {
            if (_currentStep > 0) {
              _goToStep(_currentStep - 1);
            } else {
              context.go('/login');
            }
          },
        ),
        title: const Text(
          'ลงทะเบียนผู้ใช้ใหม่',
          // Sarabun is bundled (assets/fonts, declared in pubspec.yaml), not
          // fetched — see the note in login_screen.dart. Removed 2026-07-25.
          style: TextStyle(
            fontFamily: 'Sarabun',
            color: AppTheme.primaryGreenDark,
            fontWeight: FontWeight.bold,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          child: Form(
            key: _formKey,
            child: Column(
              children: [
                // Progress Indicator
                _buildProgressIndicator(),
                const SizedBox(height: 24),

                // Step Content
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  child: _buildCurrentStep(),
                ),

                const SizedBox(height: 24),

                // Navigation Buttons
                _buildNavigationButtons(),

                const SizedBox(height: 40),

                // Footer
                _buildFooter(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProgressIndicator() {
    return Row(
      children: List.generate(4, (index) {
        final isActive = index <= _currentStep;
        return Expanded(
          child: Container(
            margin: EdgeInsets.only(right: index < 3 ? 8 : 0),
            child: Column(
              children: [
                Container(
                  height: 4,
                  decoration: BoxDecoration(
                    color: isActive
                        ? AppTheme.primaryGreenDark
                        : Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  _stepLabels[index],
                  style: TextStyle(
                    fontSize: 10,
                    color: isActive ? AppTheme.primaryGreenDark : Colors.grey,
                    fontWeight: isActive ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
              ],
            ),
          ),
        );
      }),
    );
  }

  Widget _buildCurrentStep() {
    switch (_currentStep) {
      case 0:
        return _buildStep0AccountType();
      case 1:
        return _buildStep1Identifier();
      case 2:
        return _buildStep2Info();
      case 3:
        return _buildStep3Password();
      default:
        return const SizedBox();
    }
  }

  Widget _buildStep0AccountType() {
    return Container(
      key: const ValueKey('step0'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'เลือกประเภทผู้ใช้งาน',
            // Sarabun is bundled (assets/fonts, declared in pubspec.yaml), not
            // fetched — see the note in login_screen.dart. Removed 2026-07-25.
            // Not const: Colors.grey.shade800 is a runtime getter.
            style: TextStyle(
              fontFamily: 'Sarabun',
              fontSize: 22,
              fontWeight: FontWeight.bold,
              color: Colors.grey.shade800,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'กรุณาเลือกประเภทบัญชีที่ตรงกับท่าน',
            style: TextStyle(color: Colors.grey.shade600, fontSize: 14),
          ),
          const SizedBox(height: 24),
          ...List.generate(_accountTypes.length, (index) {
            final type = _accountTypes[index];
            final isSelected = _accountType == type['type'];
            return GestureDetector(
              onTap: () => setState(() => _accountType = type['type']),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.only(bottom: 16),
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: isSelected
                      ? (type['color'] as Color).withAlpha(20)
                      : Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: isSelected
                        ? type['color'] as Color
                        : Colors.grey.shade200,
                    width: isSelected ? 2 : 1,
                  ),
                  boxShadow: isSelected
                      ? [
                          BoxShadow(
                            color: (type['color'] as Color).withAlpha(51),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ]
                      : null,
                ),
                child: Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: (type['color'] as Color).withAlpha(26),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Icon(
                        type['icon'] as IconData,
                        color: type['color'] as Color,
                        size: 28,
                      ),
                    ),
                    const SizedBox(width: 16),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            type['label'] as String,
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: isSelected
                                  ? type['color'] as Color
                                  : Colors.grey.shade800,
                            ),
                          ),
                          Text(
                            type['subtitle'] as String,
                            style: TextStyle(
                              fontSize: 14,
                              color: Colors.grey.shade600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    if (isSelected)
                      Icon(Icons.check_circle,
                          color: type['color'] as Color, size: 28),
                  ],
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildStep1Identifier() {
    final config = _currentAccountConfig;
    return Container(
      key: const ValueKey('step1'),
      padding: const EdgeInsets.all(24),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: (config['color'] as Color).withAlpha(26),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.badge_outlined,
                    color: config['color'] as Color, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('ขั้นตอนที่ 2',
                        style: TextStyle(
                            color: Colors.grey.shade500, fontSize: 13)),
                    const Text('ยืนยันตัวตน',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: _identifierController,
            keyboardType: TextInputType.number,
            maxLength: 17,
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              _IdCardFormatter(),
            ],
            onChanged: (_) => setState(() {}), // Trigger button state rebuild
            style: const TextStyle(
                fontSize: 20, fontWeight: FontWeight.w600, letterSpacing: 2),
            decoration: _inputDecoration(
              label: config['idLabel'] as String,
              hint: config['idHint'] as String,
              icon: Icons.credit_card,
            ).copyWith(counterText: ''),
            validator: _validateIdentifier,
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.blue.shade50,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: Colors.blue.shade200),
            ),
            child: Row(
              children: [
                Icon(Icons.info_outline, color: Colors.blue.shade700, size: 20),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'หมายเลขนี้จะใช้เป็น Username ในการเข้าสู่ระบบ',
                    style: TextStyle(fontSize: 13, color: Colors.blue.shade800),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStep2Info() {
    return Container(
      key: const ValueKey('step2'),
      padding: const EdgeInsets.all(24),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.primaryGreenDark.withAlpha(26),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  _accountType == 'INDIVIDUAL'
                      ? Icons.person_outline
                      : Icons.business_center_outlined,
                  color: AppTheme.primaryGreenDark,
                  size: 28,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('ขั้นตอนที่ 3',
                        style: TextStyle(
                            color: Colors.grey.shade500, fontSize: 13)),
                    Text(
                      _accountType == 'INDIVIDUAL'
                          ? 'ข้อมูลส่วนตัว'
                          : 'ข้อมูลองค์กร',
                      style: const TextStyle(
                          fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          if (_accountType == 'INDIVIDUAL') ...[
            TextFormField(
              controller: _firstNameController,
              onChanged: (_) => setState(() {}),
              decoration: _inputDecoration(
                  label: 'ชื่อ', hint: 'สมชาย', icon: Icons.person),
              validator: (v) => _validateRequired(v, 'ชื่อ'),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _lastNameController,
              onChanged: (_) => setState(() {}),
              decoration: _inputDecoration(
                  label: 'นามสกุล', hint: 'ใจดี', icon: Icons.person_outline),
              validator: (v) => _validateRequired(v, 'นามสกุล'),
            ),
          ] else if (_accountType == 'JURISTIC') ...[
            TextFormField(
              controller: _companyNameController,
              onChanged: (_) => setState(() {}),
              decoration: _inputDecoration(
                  label: 'ชื่อบริษัท/นิติบุคคล',
                  hint: 'บริษัท ABC จำกัด',
                  icon: Icons.business),
              validator: (v) => _validateRequired(v, 'ชื่อบริษัท'),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _representativeNameController,
              onChanged: (_) => setState(() {}),
              decoration: _inputDecoration(
                  label: 'ชื่อผู้มีอำนาจ',
                  hint: 'นายสมชาย ใจดี',
                  icon: Icons.person),
              validator: (v) => _validateRequired(v, 'ชื่อผู้มีอำนาจ'),
            ),
          ] else ...[
            TextFormField(
              controller: _communityNameController,
              onChanged: (_) => setState(() {}),
              decoration: _inputDecoration(
                  label: 'ชื่อวิสาหกิจชุมชน',
                  hint: 'กลุ่มเกษตรกรบ้านป่า',
                  icon: Icons.groups),
              validator: (v) => _validateRequired(v, 'ชื่อวิสาหกิจชุมชน'),
            ),
            const SizedBox(height: 16),
            TextFormField(
              controller: _contactNameController,
              onChanged: (_) => setState(() {}),
              decoration: _inputDecoration(
                  label: 'ชื่อผู้ติดต่อ',
                  hint: 'นายสมชาย ใจดี',
                  icon: Icons.person),
              validator: (v) => _validateRequired(v, 'ชื่อผู้ติดต่อ'),
            ),
          ],
          const SizedBox(height: 16),
          TextFormField(
            controller: _phoneController,
            keyboardType: TextInputType.phone,
            maxLength: 10,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            onChanged: (_) => setState(() {}),
            decoration: _inputDecoration(
                    label: 'เบอร์โทรศัพท์',
                    hint: '0812345678',
                    icon: Icons.phone)
                .copyWith(counterText: ''),
            validator: _validatePhone,
          ),
        ],
      ),
    );
  }

  Widget _buildStep3Password() {
    return Container(
      key: const ValueKey('step3'),
      padding: const EdgeInsets.all(24),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppTheme.primaryGreenDark.withAlpha(26),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.lock_outline,
                    color: AppTheme.primaryGreenDark, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('ขั้นตอนที่ 4',
                        style: TextStyle(
                            color: Colors.grey.shade500, fontSize: 13)),
                    const Text('ตั้งรหัสผ่าน',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          TextFormField(
            controller: _passwordController,
            obscureText: !_isPasswordVisible,
            onChanged: (_) => setState(() {}),
            decoration: _inputDecoration(
                    label: 'รหัสผ่าน',
                    hint: 'อย่างน้อย 8 ตัวอักษร + ตัวเลข',
                    icon: Icons.lock)
                .copyWith(
              suffixIcon: IconButton(
                icon: Icon(
                    _isPasswordVisible
                        ? Icons.visibility
                        : Icons.visibility_off,
                    color: Colors.grey),
                onPressed: () =>
                    setState(() => _isPasswordVisible = !_isPasswordVisible),
              ),
            ),
            validator: _validatePassword,
          ),
          const SizedBox(height: 16),
          TextFormField(
            controller: _confirmPasswordController,
            obscureText: !_isConfirmPasswordVisible,
            onChanged: (_) => setState(() {}),
            decoration: _inputDecoration(
                    label: 'ยืนยันรหัสผ่าน',
                    hint: 'กรอกรหัสผ่านอีกครั้ง',
                    icon: Icons.lock_outline)
                .copyWith(
              suffixIcon: IconButton(
                icon: Icon(
                    _isConfirmPasswordVisible
                        ? Icons.visibility
                        : Icons.visibility_off,
                    color: Colors.grey),
                onPressed: () => setState(() =>
                    _isConfirmPasswordVisible = !_isConfirmPasswordVisible),
              ),
            ),
            validator: _validateConfirmPassword,
          ),
          const SizedBox(height: 20),
          Container(
            decoration: BoxDecoration(
              color: _acceptTerms ? Colors.green.shade50 : Colors.grey.shade50,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                  color: _acceptTerms
                      ? Colors.green.shade200
                      : Colors.grey.shade200),
            ),
            child: CheckboxListTile(
              value: _acceptTerms,
              onChanged: (v) => setState(() => _acceptTerms = v ?? false),
              title: const Text(
                  'ข้าพเจ้ายอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว',
                  style: TextStyle(fontSize: 13)),
              activeColor: AppTheme.primaryGreenDark,
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: const EdgeInsets.symmetric(horizontal: 8),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNavigationButtons() {
    return Row(
      children: [
        if (_currentStep > 0)
          Expanded(
            child: OutlinedButton(
              onPressed: () => _goToStep(_currentStep - 1),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppTheme.primaryGreenDark,
                side: const BorderSide(color: AppTheme.primaryGreenDark),
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12)),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.arrow_back, size: 18),
                  SizedBox(width: 8),
                  Text('ย้อนกลับ',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                ],
              ),
            ),
          ),
        if (_currentStep > 0) const SizedBox(width: 12),
        Expanded(
          child: ElevatedButton(
            onPressed: _isLoading || !_canProceedToNextStep()
                ? null
                : () async {
                    if (_currentStep < 3) {
                      // At Step 1 (identifier), check for duplicates before proceeding
                      if (_currentStep == 1) {
                        final isAvailable = await _checkIdentifierAvailable();
                        if (!isAvailable) {
                          // Show error message - validation failed or duplicate found
                          return;
                        }
                      }
                      _goToStep(_currentStep + 1);
                    } else {
                      _handleRegister();
                    }
                  },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppTheme.primaryGreenDark,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12)),
              elevation: 4,
              shadowColor: AppTheme.primaryGreenDark.withAlpha(102),
              disabledBackgroundColor: Colors.grey.shade300,
            ),
            child: _isLoading
                ? const SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                        color: Colors.white, strokeWidth: 2))
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_currentStep < 3 ? 'ถัดไป' : 'ลงทะเบียน',
                          style: const TextStyle(
                              fontWeight: FontWeight.bold, fontSize: 16)),
                      const SizedBox(width: 8),
                      Icon(_currentStep < 3 ? Icons.arrow_forward : Icons.check,
                          size: 18),
                    ],
                  ),
          ),
        ),
      ],
    );
  }

  Widget _buildFooter() {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.verified_user_outlined,
                size: 16, color: Colors.grey.shade500),
            const SizedBox(width: 6),
            Text('ข้อมูลของคุณจะถูกเก็บรักษาอย่างปลอดภัย',
                style: TextStyle(color: Colors.grey.shade500, fontSize: 12)),
          ],
        ),
        const SizedBox(height: 16),
        TextButton(
          onPressed: () => context.go('/login'),
          child: const Text('มีบัญชีแล้ว? เข้าสู่ระบบ',
              style: TextStyle(
                  color: AppTheme.primaryGreenDark,
                  fontWeight: FontWeight.bold)),
        ),
      ],
    );
  }

  BoxDecoration _cardDecoration() {
    return BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      boxShadow: [
        BoxShadow(
            color: Colors.black.withAlpha(13),
            blurRadius: 20,
            offset: const Offset(0, 8))
      ],
      border: Border.all(color: Colors.grey.shade100),
    );
  }

  InputDecoration _inputDecoration(
      {required String label, required String hint, required IconData icon}) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      prefixIcon: Icon(icon, color: AppTheme.primaryGreenDark),
      filled: true,
      fillColor: Colors.grey.shade50,
      contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 18),
      border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
      enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: Colors.grey.shade200)),
      focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide:
              const BorderSide(color: AppTheme.primaryGreenDark, width: 2)),
      errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Colors.red, width: 1.5)),
      labelStyle: TextStyle(color: Colors.grey.shade600),
      floatingLabelStyle: const TextStyle(
          color: AppTheme.primaryGreenDark, fontWeight: FontWeight.bold),
    );
  }

  @override
  void dispose() {
    _identifierController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    _companyNameController.dispose();
    _representativeNameController.dispose();
    _communityNameController.dispose();
    _contactNameController.dispose();
    super.dispose();
  }
}

// Thai ID Auto-Formatter
class _IdCardFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
      TextEditingValue oldValue, TextEditingValue newValue) {
    var text = newValue.text.replaceAll('-', '');
    if (newValue.selection.baseOffset == 0) return newValue;

    String newText = '';
    for (int i = 0; i < text.length; i++) {
      if (i == 1 || i == 5 || i == 10 || i == 12) {
        if (newText.isNotEmpty) newText += '-';
      }
      newText += text[i];
    }

    return TextEditingValue(
      text: newText,
      selection: TextSelection.collapsed(offset: newText.length),
    );
  }
}
