import 'package:flutter/material.dart';
import '../../../../domain/entities/establishment_entity.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

class FarmStatusCard extends StatelessWidget {
  final EstablishmentEntity establishment;
  final VoidCallback onTap;

  const FarmStatusCard({
    super.key,
    required this.establishment,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    Color statusColor;
    String statusText;

    // Simulate some logic
    const statusLabels = {
      'CERTIFIED': 'ได้รับการรับรอง',
      'Pending': 'รอตรวจประเมิน',
      'ACTIVE': 'ใช้งานอยู่',
      'Active': 'ใช้งานอยู่',
      'DRAFT': 'ฉบับร่าง',
      'INACTIVE': 'ไม่ได้ใช้งาน',
    };
    if (establishment.status == 'CERTIFIED') {
      statusColor = Colors.green;
      statusText = 'ได้รับการรับรอง';
    } else if (establishment.status == 'Pending') {
      statusColor = Colors.orange;
      statusText = 'รอตรวจประเมิน';
    } else {
      statusColor = Colors.grey;
      statusText = statusLabels[establishment.status] ?? establishment.status;
    }

    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 280,
        margin: const EdgeInsets.only(right: 16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Image Section
            Container(
              height: 120,
              decoration: BoxDecoration(
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(16)),
                color: Colors.grey[200],
                image: establishment.imageUrl != null
                    ? DecorationImage(
                        image: NetworkImage(establishment.imageUrl!),
                        fit: BoxFit.cover,
                      )
                    : null,
              ),
              child: establishment.imageUrl == null
                  ? const Center(
                      child:
                          Icon(LucideIcons.image, size: 40, color: Colors.grey))
                  : null,
            ),
            // Content
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          establishment.name,
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          statusText,
                          style: TextStyle(
                            color: statusColor,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(LucideIcons.mapPin,
                          size: 14, color: Colors.grey[600]),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          establishment.address,
                          style:
                              TextStyle(color: Colors.grey[600], fontSize: 12),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
