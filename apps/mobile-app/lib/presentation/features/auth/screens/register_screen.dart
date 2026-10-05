import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../auth/providers/auth_provider.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();

  // Controllers (V2 Standard)
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneNumberController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _idCardController = TextEditingController();
  final _laserCodeController = TextEditingController();

  XFile? _idCardImage;
  bool _isLoading = false;
  bool _obscurePassword = true; // Password visibility toggle
  bool _obscureConfirmPassword = true;
  final ImagePicker _picker = ImagePicker();

  Future<void> _pickImage() async {
    final XFile? image = await _picker.pickImage(
        source: ImageSource.gallery,
        imageQuality: 80,
        maxWidth: 1024,
        maxHeight: 1024);
    if (image != null) {
      setState(() => _idCardImage = image);
    }
  }

  void _handleRegister() async {
    if (!_formKey.currentState!.validate()) return;

    // Optional Image Check
    if (_idCardImage == null) {
      // For V2, we might want to allow without image or enforce it.
      // Current Schema says optional, but logic says strict. Let's warn but allow?
      // No, UI should probably enforce it for "KYC" feel.
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('กรุณาอัปโหลดรูปบัตรประชาชน')),
      );
      return;
    }

    setState(() => _isLoading = true);

    // V2 Data Payload - Matches Backend Schema Strictly
    final data = {
      'firstName': _firstNameController.text.trim(),
      'lastName': _lastNameController.text.trim(),
      'email': _emailController.text.trim(),
      'phoneNumber': _phoneNumberController.text.trim(),
      'password': _passwordController.text.trim(),
      'idCard': _idCardController.text.trim(),
      'laserCode': _laserCodeController.text.trim(),
      'ApplicantType': 'INDIVIDUAL' // Default
    };

    try {
      await ref.read(authProvider.notifier).register(data, _idCardImage!);

      if (!mounted) return;
      setState(() => _isLoading = false);

      final authState = ref.read(authProvider);

      if (authState.error != null) {
        // Show EXACT error from backend
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(authState.error!), backgroundColor: Colors.red));
      } else {
        await showDialog(
          context: context,
          barrierDismissible: false,
          builder: (ctx) => AlertDialog(
            title: const Text('ลงทะเบียนสำเร็จ'),
            content:
                const Text('สร้างบัญชีของคุณแล้ว กรุณาเข้าสู่ระบบ'),
            actions: [
              TextButton(
                onPressed: () {
                  Navigator.of(ctx).pop(); // Close Dialog
                  context.pop(); // Back to Login
                },
                child: const Text('ตกลง'),
              )
            ],
          ),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _isLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: const Text('ระบบขัดข้อง ไม่สามารถลงทะเบียนได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง'),
          backgroundColor: Colors.red));
      debugPrint('Register error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ลงทะเบียนผู้ยื่นคำขอ')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('สร้างบัญชีใหม่',
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center),
                const SizedBox(height: 24),

                // Name
                Row(
                  children: [
                    Expanded(
                        child: TextFormField(
                            controller: _firstNameController,
                            decoration: const InputDecoration(
                                labelText: 'ชื่อ',
                                prefixIcon: Icon(LucideIcons.user)),
                            validator: (v) => v!.isEmpty ? 'จำเป็นต้องกรอก' : null)),
                    const SizedBox(width: 16),
                    Expanded(
                        child: TextFormField(
                            controller: _lastNameController,
                            decoration: const InputDecoration(
                                labelText: 'นามสกุล',
                                prefixIcon: Icon(LucideIcons.user)),
                            validator: (v) => v!.isEmpty ? 'จำเป็นต้องกรอก' : null)),
                  ],
                ),
                const SizedBox(height: 16),

                // Contact
                TextFormField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress, // Apple QA Fix
                    decoration: const InputDecoration(
                        labelText: 'อีเมล', prefixIcon: Icon(LucideIcons.mail)),
                    validator: (v) =>
                        v!.contains('@') ? null : 'อีเมลไม่ถูกต้อง'),
                const SizedBox(height: 16),
                TextFormField(
                    controller: _phoneNumberController,
                    keyboardType: TextInputType.phone, // Apple QA Fix
                    decoration: const InputDecoration(
                        labelText: 'เบอร์โทรศัพท์มือถือ',
                        prefixIcon: Icon(LucideIcons.phone)),
                    validator: (v) =>
                        v!.length >= 10 ? null : 'เบอร์โทรไม่ถูกต้อง'),
                const SizedBox(height: 16),

                // Security
                TextFormField(
                    controller: _passwordController,
                    obscureText: _obscurePassword,
                    decoration: InputDecoration(
                        labelText: 'รหัสผ่าน',
                        prefixIcon: const Icon(LucideIcons.lock),
                        suffixIcon: IconButton(
                          // Apple QA: Password visibility
                          icon: Icon(_obscurePassword
                              ? LucideIcons.eyeOff
                              : LucideIcons.eye),
                          onPressed: () => setState(
                              () => _obscurePassword = !_obscurePassword),
                        )),
                    validator: (v) => v!.length >= 6 ? null : 'อย่างน้อย 6 ตัวอักษร'),
                const SizedBox(height: 16),
                TextFormField(
                    controller: _confirmPasswordController,
                    obscureText: _obscureConfirmPassword,
                    decoration: InputDecoration(
                        labelText: 'ยืนยันรหัสผ่าน',
                        prefixIcon: const Icon(LucideIcons.lock),
                        suffixIcon: IconButton(
                          icon: Icon(_obscureConfirmPassword
                              ? LucideIcons.eyeOff
                              : LucideIcons.eye),
                          onPressed: () => setState(() =>
                              _obscureConfirmPassword =
                                  !_obscureConfirmPassword),
                        )),
                    validator: (v) =>
                        v == _passwordController.text ? null : 'รหัสผ่านไม่ตรงกัน'),
                const SizedBox(height: 16),

                // Identity (Strict)
                TextFormField(
                    controller: _idCardController,
                    maxLength: 13,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                        labelText: 'เลขบัตรประชาชน (13 หลัก)',
                        prefixIcon: const Icon(LucideIcons.creditCard),
                        suffixIcon: IconButton(
                          icon: const Icon(LucideIcons.scan),
                          onPressed: () => ScaffoldMessenger.of(context)
                              .showSnackBar(const SnackBar(
                                  content: Text('สแกน OCR จะเปิดใช้เร็ว ๆ นี้'))),
                        ),
                        counterText: ''),
                    validator: (v) =>
                        v!.length == 13 ? null : 'ต้องมี 13 หลัก'),
                const SizedBox(height: 16),
                TextFormField(
                    controller: _laserCodeController,
                    decoration: InputDecoration(
                        labelText: 'เลเซอร์โค้ดหลังบัตร',
                        prefixIcon: const Icon(LucideIcons.scanLine),
                        suffixIcon: IconButton(
                          icon: const Icon(LucideIcons.helpCircle),
                          onPressed: () => showDialog(
                            context: context,
                            builder: (c) => const AlertDialog(
                              title: Text('เลเซอร์โค้ด'),
                              content: Text(
                                  'รหัสด้านหลังบัตรประชาชนของคุณ (เช่น ME0-xxxxxxx-xx)'),
                            ),
                          ),
                        )),
                    validator: (v) => v!.isEmpty ? 'จำเป็นต้องกรอก' : null),
                const SizedBox(height: 24),

                // Upload
                GestureDetector(
                  onTap: _pickImage,
                  child: Container(
                    height: 150,
                    decoration: BoxDecoration(
                        color: Colors.grey.shade200,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.grey)),
                    child: _idCardImage == null
                        ? const Center(
                            child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                Icon(LucideIcons.upload),
                                Text('อัปโหลดรูปบัตรประชาชน')
                              ]))
                        : kIsWeb
                            ? Image.network(_idCardImage!.path)
                            : Image.file(File(_idCardImage!.path)),
                  ),
                ),
                const SizedBox(height: 32),

                ElevatedButton(
                  onPressed: _isLoading ? null : _handleRegister,
                  style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      backgroundColor: Colors.green.shade700,
                      foregroundColor: Colors.white),
                  child: _isLoading
                      ? const CircularProgressIndicator(color: Colors.white)
                      : const Text('ลงทะเบียน'),
                )
              ],
            ),
          ),
        ),
      ),
    );
  }
}
