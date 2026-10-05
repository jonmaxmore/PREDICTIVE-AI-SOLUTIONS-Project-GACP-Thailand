const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { createLogger } = require('../shared/logger');
const logger = createLogger('security-compliance'); // uses bcryptjs
class EncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.keyLength = 32; // 256 bits
    this.ivLength = 12; // 96 bits — recommended for GCM (NIST SP 800-38D)
    this.tagLength = 16; // 128 bits
    this.saltRounds = 12; // bcrypt salt rounds
    this.masterKey = process.env.MASTER_ENCRYPTION_KEY || this.generateKey();
    this.hmacKey = process.env.HMAC_KEY || this.generateKey();
  }
  encryptSensitiveData(plaintext, context = '') {
    try {
      const iv = crypto.randomBytes(this.ivLength);
      const keyBuffer = Buffer.from(this.masterKey, 'hex').subarray(0, this.keyLength);
      const cipher = crypto.createCipheriv(this.algorithm, keyBuffer, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const tag = cipher.getAuthTag();
      return {
        encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        algorithm: this.algorithm,
        context,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }
  decryptSensitiveData(encryptedData) {
    try {
      const { encrypted, iv, tag, algorithm } = encryptedData;
      if (algorithm !== this.algorithm) {
        throw new Error('Unsupported encryption algorithm');
      }
      const keyBuffer = Buffer.from(this.masterKey, 'hex').subarray(0, this.keyLength);
      const decipher = crypto.createDecipheriv(algorithm, keyBuffer, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }
  async hashPassword(password) {
    return bcrypt.hash(password, this.saltRounds);
  }
  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }
  generateKey() {
    return crypto.randomBytes(this.keyLength).toString('hex');
  }
  generateHMAC(data) {
    return crypto.createHmac('sha256', this.hmacKey).update(JSON.stringify(data)).digest('hex');
  }
  verifyHMAC(data, hmac) {
    const computedHMAC = this.generateHMAC(data);
    return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(computedHMAC, 'hex'));
  }
}
class RBACService {
  constructor() {
    this.roles = new Map();
    this.permissions = new Map();
    this.resourceTypes = new Set();
    this.initializeDefaultRoles();
  }
  initializeDefaultRoles() {
    const permissions = {
      'user.create': 'Create new users',
      'user.read': 'View user information',
      'user.update': 'Update user information',
      'user.delete': 'Delete users',
      'user.list': 'List all users',
      'provider.create': 'Create provider accounts',
      'provider.update': 'Update provider information',
      'provider.list': 'List provider members',
      'team.manage': 'Manage teams and assignments',
      'team.view': 'View team information',
      'application.create': 'Submit new applications',
      'application.read': 'View applications',
      'application.update': 'Update applications',
      'application.delete': 'Delete applications',
      'application.review': 'Review applications',
      'application.assign': 'Assign officer/auditor to application',
      'application.approve': 'Approve applications',
      'application.reject': 'Reject applications',
      'certificate.issue': 'Issue certificates',
      'certificate.read': 'View certificates',
      'certificate.revoke': 'Revoke certificates',
      'certificate.renew': 'Renew certificates',
      'inspection.schedule': 'Schedule inspections',
      'inspection.conduct': 'Conduct inspections',
      'inspection.review': 'Review inspection results',
      'inspection.approve': 'Approve inspection reports',
      'inspection.reject': 'Reject inspection reports', // NEW
      'payment.process': 'Process payments',
      'payment.refund': 'Process refunds',
      'payment.view': 'View payment information',
      'quote.manage': 'Manage quotations',
      'invoice.manage': 'Manage invoices',
      'receipt.manage': 'Manage receipts',
      'document.update': 'Update document numbers',
      'system.admin': 'System administration',
      'system.config': 'System configuration',
      'config.manage': 'Manage system configuration',
      'workflow.manage': 'Manage workflows',
      'field.manage': 'Manage form fields',
      'audit.read': 'View audit logs',
      'audit.export': 'Export audit data',
      'kpi.manage': 'Manage KPI settings',
      'kpi.view': 'View KPI metrics',
      'report.generate': 'Generate reports',
      'report.export': 'Export reports',
      'dashboard.view': 'View dashboard',
      'dashboard.personal': 'View personal dashboard',
      'dashboard.accounting': 'View accounting dashboard',
    };
    Object.entries(permissions).forEach(([permission, description]) => {
      this.permissions.set(permission, { permission, description });
    });
    /**
     * ตารางสิทธิ์ของชั้นนี้ — key ด้วย "คำบทบาทปัจจุบัน" เท่านั้น
     *
     * ก่อน 2026-09-10 ตารางนี้ใช้คำศัพท์ยุคก่อนคนละชุดกับ canonical-rbac
     * (super_admin · officer · dtam_admin · reviewer_auditor · scheduler · accountant)
     * และ hasPermission() ค้นด้วย user.role ตรง ๆ ⇒ พอคำบทบาทเปลี่ยน `roles.get(...)`
     * จะได้ undefined แล้วปฏิเสธ 403 ทุกคนแบบ fail-closed โดยไม่มี error ให้เห็น
     *
     * สองบทบาทเดิมที่ไม่มีคู่ในโมเดลสามฝั่งถูกตัดออก: `auditor` (ผู้ดูรอยตรวจสอบอย่างเดียว)
     * และ `officer` (DTAM KYC) — ไม่มีใครถือคำเหล่านั้นอีกแล้ว
     */
    const roles = {
      health: {
        name: 'ผู้ขอรับรอง',
        description: 'ยื่นคำขอและดูข้อมูลของตัวเอง',
        permissions: [
          'application.create',
          'application.read',
          'application.update',
          'certificate.read',
          'payment.process',
          'dashboard.view',
        ],
        inheritFrom: [],
        resourceRestrictions: {
          application: 'own',
          certificate: 'own',
        },
      },
      document_reviewer: {
        name: 'ผู้ตรวจเอกสาร',
        description: 'ตรวจและดำเนินการกับคำขอ — ไม่ลงพื้นที่',
        permissions: [
          'application.read',
          'application.review',
          'application.approve',
          'application.reject',
          'certificate.read',
          'inspection.review',
          'dashboard.view',
          'dashboard.personal',
          'report.generate',
          'kpi.view',
        ],
        inheritFrom: [],
      },
      dispatcher: {
        name: 'ผู้จัดสรรงานและคิวตรวจ',
        description: 'จัดคิว มอบหมายงาน และดูภาระงานของทีม',
        permissions: [
          'inspection.schedule',
          'application.assign',
          'application.read',
          'team.manage',
          'team.view',
          'provider.list',
          'user.list',
          'dashboard.view',
          'dashboard.personal',
          'report.generate',
          'kpi.view',
        ],
        inheritFrom: [],
      },
      field_inspector: {
        name: 'ผู้ตรวจประเมินแปลง',
        description: 'ลงพื้นที่ตรวจแปลงและบันทึกผล',
        permissions: [
          'application.read',
          'inspection.schedule',
          'inspection.conduct',
          'inspection.approve',
          'inspection.reject',
          'certificate.read',
          'dashboard.view',
          'dashboard.personal',
          'kpi.view',
        ],
        inheritFrom: [],
      },
      certificate_approver: {
        name: 'ผู้อนุมัติใบรับรอง',
        description: 'ตัดสินให้การรับรอง (ISO/IEC 17065 §7.6)',
        permissions: [
          'application.read',
          'application.approve',
          'application.reject',
          'certificate.issue',
          'certificate.read',
          'dashboard.view',
          'dashboard.personal',
          'report.generate',
          'kpi.view',
        ],
        // ไม่มี inspection.conduct โดยเจตนา — ผู้ตัดสินต้องไม่ใช่ผู้ประเมิน
        inheritFrom: [],
      },
      finance_officer_dtam: {
        name: 'การเงินฝั่งกรม',
        // operator 2026-09-11 / 2026-09-27: sees every billing view finance_officer_platform
        // sees, holds no write ("กรมฯ ดูอย่างเดียว")
        description: 'ดูข้อมูลบัญชีและใบเสร็จชุดเดียวกับการเงินบริษัท — ดูอย่างเดียว',
        permissions: [
          'payment.view',
          'dashboard.view',
          'dashboard.personal',
          'dashboard.accounting',
          'report.generate',
          'kpi.view',
        ],
        inheritFrom: [],
      },
      finance_officer_platform: {
        name: 'การเงินฝั่งบริษัท',
        description: 'ค่าบริการแพลตฟอร์ม — ใบเสนอราคา ใบวางบิล ใบเสร็จ',
        permissions: [
          'payment.view',
          'payment.process',
          'quote.manage',
          'invoice.manage',
          'receipt.manage',
          'document.update',
          'dashboard.view',
          'dashboard.personal',
          'dashboard.accounting',
          'report.generate',
          'kpi.view',
        ],
        inheritFrom: [],
      },
      system_admin_dtam: {
        name: 'ผู้ดูแลระบบของกรม',
        description: 'ดูแลผู้ใช้และงานภายในองค์กรของตัวเอง',
        permissions: [
          'user.create',
          'user.read',
          'user.update',
          'user.delete',
          'user.list',
          'application.create',
          'application.read',
          'application.update',
          'application.delete',
          'application.review',
          'application.approve',
          'application.reject',
          'certificate.create',
          'certificate.issue',
          'certificate.read',
          'certificate.update',
          'certificate.delete',
          'certificate.revoke',
          'certificate.renew',
          'inspection.schedule',
          'inspection.review',
          'inspection.approve',
          'payment.view',
          'payment.process',
          'audit.read',
          'audit.export',
          'report.generate',
          'report.export',
          'dashboard.view',
          'system.manage',
        ],
        inheritFrom: [],
      },
      system_admin_platform: {
        name: 'ผู้ดูแลระบบของบริษัท',
        description: 'ผู้ดูแลข้ามองค์กร — สิทธิ์ทั้งหมดของระบบ',
        permissions: Array.from(this.permissions.keys()),
        inheritFrom: [],
      },
    };
    Object.entries(roles).forEach(([roleName, role]) => {
      this.roles.set(roleName, role);
    });
    this.resourceTypes = new Set([
      'user',
      'application',
      'certificate',
      'inspection',
      'payment',
      'audit',
      'report',
      'system',
    ]);
  }
  async hasPermission(user, action, resource = null, context = {}) {
    try {
      // ตารางข้างบน key ด้วยคำบทบาทปัจจุบันแล้ว จึงไม่ต้องมีตารางแปลคำของตัวเอง
      // (เดิมมี `{ health: 'applicant' }` ค้างไว้ตั้งแต่ยุคที่สองไฟล์พูดคนละคำ)
      const userRoleName = user.role ? user.role.toLowerCase() : '';
      const userRole = this.roles.get(userRoleName);
      if (!userRole) {
        return false;
      }
      if (!userRole.permissions.includes(action)) {
        return false;
      }
      if (resource && userRole.resourceRestrictions) {
        const restriction = userRole.resourceRestrictions[resource.type];
        if (restriction === 'own') {
          if (resource.ownerId !== user.id) {
            return false;
          }
        }
      }
      if (context.requiresApprovalWorkflow && action.includes('approve')) {
        if (!this.canApproveInWorkflow(user, resource, context)) {
          return false;
        }
      }
      return true;
    } catch (error) {
      logger.error('Permission check failed:', error);
      return false; // Fail closed
    }
  }
  getUserPermissions(userRole) {
    const role = this.roles.get(userRole);
    if (!role) {
      return [];
    }
    return role.permissions.map(permission => ({
      permission,
      description: this.permissions.get(permission)?.description || permission,
    }));
  }
  canApproveInWorkflow(user, resource, context) {
    if (resource.submitterId === user.id) {
      return false;
    }
    if (context.previousReviewers && context.previousReviewers.includes(user.id)) {
      return false;
    }
    return true;
  }
  rbacMiddleware(requiredPermission, resourceType = null, idParam = 'id') {
    return async (req, res, next) => {
      try {
        const user = req.user;
        if (!user) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        let resource = null;
        if (resourceType && req.params[idParam]) {
          resource = {
            type: resourceType,
            id: req.params[idParam],
            ownerId: req.resource?.ownerId || req.resource?.userId,
          };
        }
        const hasPermission = await this.hasPermission(user, requiredPermission, resource, {
          method: req.method,
          path: req.path,
          body: req.body,
        });
        if (!hasPermission) {
          return res.status(403).json({
            error: 'Insufficient permissions',
            required: requiredPermission,
            userRole: user.role,
          });
        }
        next();
      } catch (error) {
        logger.error('RBAC middleware error:', error);
        res.status(500).json({ error: 'Authorization check failed' });
      }
    };
  }
}
class DataClassificationService {
  constructor() {
    this.classifications = {
      PUBLIC: {
        level: 0,
        description: 'Information that can be shared publicly',
        encryptionRequired: false,
        auditLevel: 'BASIC',
      },
      INTERNAL: {
        level: 1,
        description: 'Internal business information',
        encryptionRequired: false,
        auditLevel: 'STANDARD',
      },
      CONFIDENTIAL: {
        level: 2,
        description: 'Sensitive business or personal information',
        encryptionRequired: true,
        auditLevel: 'DETAILED',
      },
      RESTRICTED: {
        level: 3,
        description: 'Highly sensitive information requiring special handling',
        encryptionRequired: true,
        auditLevel: 'COMPREHENSIVE',
      },
    };
  }
  classifyData(data, context = {}) {
    const piiPatterns = [
      /\b\d{13}\b/g, // Thai National ID
      /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g, // Credit card
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
      /\b\d{3}-\d{3}-\d{4}\b/g, // Phone number
    ];
    const dataString = JSON.stringify(data);
    const containsPII = piiPatterns.some(pattern => pattern.test(dataString));
    if (containsPII || context.containsHealthData) {
      return 'RESTRICTED';
    }
    if (context.businessCritical || context.financialData) {
      return 'CONFIDENTIAL';
    }
    if (context.internal) {
      return 'INTERNAL';
    }
    return 'PUBLIC';
  }
  getHandlingRequirements(classification) {
    return this.classifications[classification] || this.classifications['INTERNAL'];
  }
}
module.exports = {
  EncryptionService,
  RBACService,
  DataClassificationService,
};
