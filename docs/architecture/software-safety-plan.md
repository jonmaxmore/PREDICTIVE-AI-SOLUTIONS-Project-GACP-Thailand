# GACP Software Safety Plan
## IEC 62304 Compliance Document

**Version:** 1.0.0  
**Date:** 2026-01-03  
**Classification:** Class B (May cause non-serious injury)

---

## 1. Purpose

This document defines the software development lifecycle processes and safety requirements for the GACP (Good Agricultural and Collection Practices) Certification System, in accordance with IEC 62304:2006/AMD1:2015.

---

## 2. System Overview

### 2.1 System Purpose
The GACP Certification System manages the certification process for medicinal plant production in Thailand, issued by the Department of Thai Traditional and Alternative Medicine (DTAM).

### 2.2 Safety Classification Rationale

| Factor | Assessment | Result |
|--------|------------|--------|
| Direct patient care | No | - |
| Diagnostic data | No | - |
| Certificate validity | Yes (consumer safety) | Risk |
| Data integrity | Critical (legal documents) | Risk |

**Conclusion:** Class B - Software whose failure could result in non-serious injury through improper certification of medicinal plants.

---

## 3. Risk Management

### 3.1 Software Hazards

| ID | Hazard | Severity | Probability | Risk Level |
|----|--------|----------|-------------|------------|
| H1 | Unauthorized certificate issuance | High | Low | Medium |
| H2 | Data breach of health PII | High | Medium | High |
| H3 | Incorrect checksum validation | Medium | Low | Low |
| H4 | Race condition in approval | Medium | Low | Low |

### 3.2 Risk Controls

| Hazard | Control Measure | Implementation |
|--------|-----------------|----------------|
| H1 | Role-based access control | ✅ Implemented |
| H1 | MFA for provider accounts | ✅ Implemented |
| H2 | Audit logging | ✅ Implemented |
| H2 | Data encryption | ✅ Implemented |
| H3 | Property-based testing | ✅ Implemented |
| H4 | Database transactions | ✅ Implemented |

---

## 4. Software Development Process

### 4.1 Architecture Requirements

- **Separation of concerns:** Frontend/Backend/Database
- **Security layers:** Authentication, Authorization, Audit
- **Data protection:** Encryption at rest and transit

### 4.2 Verification Activities

| Activity | Status | Evidence |
|----------|--------|----------|
| Code review | ✅ | Git history |
| Unit testing | ⚠️ Partial | Jest tests |
| Property-based testing | ✅ | fast-check tests |
| Security testing | ✅ | Rate limiting, MFA |
| Deployment verification | ✅ | PM2 health checks |

---

## 5. Configuration Management

### 5.1 Version Control
- **Repository:** GitHub
- **Branching:** Main branch protected
- **Commits:** Conventional commits format

### 5.2 Release Management
- **Staging:** Local development
- **Production:** DigitalOcean (gacpth.com)
- **Deployment:** PM2 process manager

---

## 6. Problem Resolution

### 6.1 Bug Tracking
- Issues tracked via GitHub Issues
- Severity classification: Critical, High, Medium, Low

### 6.2 Incident Response
- Audit logging captures all security events
- Critical events trigger immediate alerts

---

## 7. Maintenance

### 7.1 Planned Maintenance
- Database backups: Daily
- Security updates: Weekly review
- Dependency updates: Monthly

### 7.2 Change Control
- All changes require pull request
- Deployment via documented process

---

## 8. Compliance Matrix

| IEC 62304 Requirement | Class B Required | Status |
|----------------------|------------------|--------|
| Software development planning | Yes | ✅ |
| Software requirements analysis | Yes | ✅ |
| Software architectural design | Yes | ✅ |
| Software detailed design | No | - |
| Software unit implementation | Yes | ✅ |
| Software integration testing | Yes | ⚠️ |
| Software system testing | Yes | ⚠️ |
| Software release | Yes | ✅ |

---

## 9. Approvals

| Role | Name | Date |
|------|------|------|
| Development Lead | [Pending] | |
| QA Lead | [Pending] | |
| Project Manager | [Pending] | |

---

## Appendix A: Referenced Documents

1. IEC 62304:2006/AMD1:2015 - Medical device software lifecycle
2. ISO 27799:2016 - Health informatics security
3. พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 (PDPA)
