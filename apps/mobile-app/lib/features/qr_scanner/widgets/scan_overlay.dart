import 'package:flutter/material.dart';

/// Scan Overlay Widget
/// Creates a scanner frame with corner markers and animated scan line
class ScanOverlay extends StatelessWidget {
  final double scanAreaSize;
  final Color borderColor;
  final double borderWidth;

  const ScanOverlay({
    super.key,
    this.scanAreaSize = 280,
    this.borderColor = Colors.green,
    this.borderWidth = 3,
  });

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size.infinite,
      painter: _ScanOverlayPainter(
        scanAreaSize: scanAreaSize,
        borderColor: borderColor,
        borderWidth: borderWidth,
      ),
      child: Center(
        child: SizedBox(
          width: scanAreaSize,
          height: scanAreaSize,
          child: Stack(
            children: [
              // Corner markers
              Positioned(
                top: 0,
                left: 0,
                child: _CornerMarker(
                  color: borderColor,
                  size: 30,
                  borderWidth: borderWidth,
                  position: CornerPosition.topLeft,
                ),
              ),
              Positioned(
                top: 0,
                right: 0,
                child: _CornerMarker(
                  color: borderColor,
                  size: 30,
                  borderWidth: borderWidth,
                  position: CornerPosition.topRight,
                ),
              ),
              Positioned(
                bottom: 0,
                left: 0,
                child: _CornerMarker(
                  color: borderColor,
                  size: 30,
                  borderWidth: borderWidth,
                  position: CornerPosition.bottomLeft,
                ),
              ),
              Positioned(
                bottom: 0,
                right: 0,
                child: _CornerMarker(
                  color: borderColor,
                  size: 30,
                  borderWidth: borderWidth,
                  position: CornerPosition.bottomRight,
                ),
              ),
              
              // Animated scan line
              const Center(
                child: _AnimatedScanLine(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

enum CornerPosition {
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
}

class _CornerMarker extends StatelessWidget {
  final Color color;
  final double size;
  final double borderWidth;
  final CornerPosition position;

  const _CornerMarker({
    required this.color,
    required this.size,
    required this.borderWidth,
    required this.position,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _CornerPainter(
          color: color,
          borderWidth: borderWidth,
          position: position,
        ),
      ),
    );
  }
}

class _CornerPainter extends CustomPainter {
  final Color color;
  final double borderWidth;
  final CornerPosition position;

  _CornerPainter({
    required this.color,
    required this.borderWidth,
    required this.position,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = borderWidth
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round;

    final path = Path();
    final cornerSize = size.width * 0.6;

    switch (position) {
      case CornerPosition.topLeft:
        path
          ..moveTo(0, cornerSize)
          ..lineTo(0, 0)
          ..lineTo(cornerSize, 0);
        break;
      case CornerPosition.topRight:
        path
          ..moveTo(size.width - cornerSize, 0)
          ..lineTo(size.width, 0)
          ..lineTo(size.width, cornerSize);
        break;
      case CornerPosition.bottomLeft:
        path
          ..moveTo(0, size.height - cornerSize)
          ..lineTo(0, size.height)
          ..lineTo(cornerSize, size.height);
        break;
      case CornerPosition.bottomRight:
        path
          ..moveTo(size.width - cornerSize, size.height)
          ..lineTo(size.width, size.height)
          ..lineTo(size.width, size.height - cornerSize);
        break;
    }

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _AnimatedScanLine extends StatefulWidget {
  const _AnimatedScanLine();

  @override
  State<_AnimatedScanLine> createState() => _AnimatedScanLineState();
}

class _AnimatedScanLineState extends State<_AnimatedScanLine>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    );
    
    _animation = Tween<double>(begin: -1, end: 1).animate(
      CurvedAnimation(
        parent: _controller,
        curve: Curves.easeInOut,
      ),
    );
    
    _controller.repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Container(
          height: 2,
          width: double.infinity,
          margin: EdgeInsets.only(
            top: (_animation.value + 1) / 2 * 250,
          ),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                Colors.transparent,
                Colors.green.withValues(alpha: 0.8),
                Colors.green.withValues(alpha: 0.8),
                Colors.transparent,
              ],
              stops: const [0.0, 0.3, 0.7, 1.0],
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.green.withValues(alpha: 0.5),
                blurRadius: 10,
                spreadRadius: 2,
              ),
            ],
          ),
        );
      },
    );
  }
}

class _ScanOverlayPainter extends CustomPainter {
  final double scanAreaSize;
  final Color borderColor;
  final double borderWidth;

  _ScanOverlayPainter({
    required this.scanAreaSize,
    required this.borderColor,
    required this.borderWidth,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.black54
      ..style = PaintingStyle.fill;

    final scanArea = RRect.fromRectAndRadius(
      Rect.fromCenter(
        center: size.center(Offset.zero),
        width: scanAreaSize,
        height: scanAreaSize,
      ),
      const Radius.circular(12),
    );

    // Create path for darkened area outside scan zone
    final path = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height))
      ..addRRect(scanArea)
      ..fillType = PathFillType.evenOdd;

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
