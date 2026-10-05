# 🚨 GACP Platform Incident Response Playbook

## สารบัญ
1. [ระดับความรุนแรง](#ระดับความรุนแรง)
2. [ขั้นตอนตอบสนองทั่วไป](#ขั้นตอนตอบสนองทั่วไป)
3. [Playbook ตามประเภทเหตุการณ์](#playbook-ตามประเภทเหตุการณ์)
4. [การติดต่อฉุกเฉิน](#การติดต่อฉุกเฉิน)

---

## ระดับความรุนแรง

| Level | Name | คำอธิบาย | Response Time | Escalation |
|-------|------|---------|---------------|------------|
| P0 | Critical | ระบบล่มทั้งหมด / Data breach | < 15 นาที | ทันที |
| P1 | High | ฟีเจอร์หลักใช้ไม่ได้ | < 1 ชั่วโมง | 30 นาที |
| P2 | Medium | ฟีเจอร์รองมีปัญหา | < 4 ชั่วโมง | 2 ชั่วโมง |
| P3 | Low | UI bugs, minor issues | < 24 ชั่วโมง | ไม่ต้อง |

---

## ขั้นตอนตอบสนองทั่วไป

```
┌──────────────────┐
│  1. DETECT       │  Alert เข้ามา / User รายงาน
└────────┬─────────┘
         ▼
┌──────────────────┐
│  2. ASSESS       │  ประเมินความรุนแรง (P0-P3)
└────────┬─────────┘
         ▼
┌──────────────────┐
│  3. CONTAIN      │  หยุดความเสียหาย / Isolate
└────────┬─────────┘
         ▼
┌──────────────────┐
│  4. INVESTIGATE  │  หาสาเหตุต้นตอ
└────────┬─────────┘
         ▼
┌──────────────────┐
│  5. REMEDIATE    │  แก้ไขปัญหา
└────────┬─────────┘
         ▼
┌──────────────────┐
│  6. RECOVER      │  กู้คืนระบบ
└────────┬─────────┘
         ▼
┌──────────────────┐
│  7. REVIEW       │  Post-mortem / บันทึก lessons
└──────────────────┘
```

---

## Playbook ตามประเภทเหตุการณ์

### 🔴 INC-001: ระบบล่มทั้งหมด (Total Outage)

**Severity:** P0 Critical  
**Response Team:** On-call + Backend Lead + DevOps

#### ขั้นตอน:
1. **ตรวจสอบสถานะ services** (< 5 นาที)
   ```bash
   # Check all containers
   docker ps -a
   
   # Check logs
   docker logs gacp-backend --tail 100
   docker logs gacp-frontend --tail 100
   
   # Check health endpoints
   curl http://localhost:5000/api/v2/health
   ```

2. **พยายาม restart services** (< 10 นาที)
   ```bash
   docker-compose restart gacp-backend
   docker-compose restart gacp-frontend
   ```

3. **ถ้า restart ไม่สำเร็จ - rollback** (< 20 นาที)
   ```bash
   # Rollback to last stable version
   git checkout <last-stable-tag>
   docker-compose up -d --build
   ```

4. **แจ้ง Stakeholders**
   - Post to #incidents Slack channel
   - Update status page

5. **Post-mortem** (within 24 hours)
   - Document timeline
   - Root cause analysis
   - Action items

---

### 🔴 INC-002: Data Breach / Unauthorized Access

**Severity:** P0 Critical  
**Response Team:** Security Lead + Backend Lead + Legal

#### ขั้นตอน:
1. **Contain immediately** (< 5 นาที)
   ```bash
   # Block all external access
   docker exec traefik traefik healthcheck
   
   # Revoke compromised tokens
   redis-cli FLUSHDB
   
   # Rotate secrets
   # Update .env with new JWT_SECRET
   ```

2. **Preserve evidence** (< 15 นาที)
   ```bash
   # Backup current logs
   docker logs gacp-backend > incident_logs_$(date +%Y%m%d_%H%M%S).txt
   
   # Export database state
   pg_dump "$DATABASE_URL" -Fc -f incident_backup_$(date +%Y%m%d).dump
   ```

3. **Investigate**
   - Review access logs
   - Check for data exfiltration
   - Identify affected users/data

4. **Notify** (as required by PDPA)
   - Legal team
   - Affected users (if PII exposed)
   - Regulatory authorities (if required)

5. **Remediate**
   - Patch vulnerability
   - Add security tests
   - Update guardrails

---

### 🟡 INC-003: Database Performance Degradation

**Severity:** P1-P2  
**Response Team:** Backend Lead

#### ขั้นตอน:
1. **Check PostgreSQL status**
   ```bash
   psql "$DATABASE_URL" -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"
   psql "$DATABASE_URL" -c "SELECT pg_size_pretty(pg_database_size(current_database()));"
   ```

2. **Check slow queries**
   ```bash
   psql "$DATABASE_URL" -c "SELECT pid, now() - query_start AS runtime, query FROM pg_stat_activity WHERE state = 'active' AND now() - query_start > interval '5 seconds';"
   ```

3. **Cancel problematic queries** (if needed)
   ```bash
   psql "$DATABASE_URL" -c "SELECT pg_cancel_backend(<pid>);"
   ```

4. **Scale if needed**
   - Add read replicas
   - Increase resources
   - Add indexes

---

### 🟡 INC-004: AI Agent Catastrophic Action

**Severity:** P0-P1 (depending on impact)  
**Response Team:** Tech Lead + DevOps

#### ขั้นตอน:
1. **Stop AI agent immediately**
   - Cancel current operation
   - Review pending changes

2. **Assess damage**
   ```bash
   # Check git changes
   git status
   git diff
   
   # Check for deleted files
   git log --diff-filter=D --summary
   ```

3. **Rollback if needed**
   ```bash
   # Restore deleted files
   git checkout HEAD~1 -- <deleted-file>
   
   # Restore database
   pg_restore --clean --if-exists -d "$DATABASE_URL" ./backups/latest.dump
   ```

4. **Update guardrails**
   - Add pattern to forbidden_patterns
   - Tighten human_approval rules

---

### 🟢 INC-005: API Rate Limiting Triggered

**Severity:** P2-P3  
**Response Team:** Backend Developer

#### ขั้นตอน:
1. **Check rate limit logs**
   ```bash
   grep "429" /var/log/nginx/access.log | tail -50
   ```

2. **Identify source**
   - Legitimate traffic spike?
   - DDoS attempt?
   - Misconfigured client?

3. **Action**
   - If DDoS: Block IP at WAF level
   - If legitimate: Increase rate limits temporarily
   - If client bug: Contact client team

---

## การติดต่อฉุกเฉิน

| Role | Name | Phone | Escalation Level |
|------|------|-------|------------------|
| On-call Primary | TBD | xxx-xxx-xxxx | First response |
| Backend Lead | TBD | xxx-xxx-xxxx | P0-P1 |
| Security Lead | TBD | xxx-xxx-xxxx | Security incidents |
| DevOps Lead | TBD | xxx-xxx-xxxx | Infrastructure |
| Management | TBD | xxx-xxx-xxxx | P0 only |

---

## Checklist Templates

### Post-Incident Review Template

```markdown
# Incident Review: [INC-XXX]

## Summary
- **Date/Time:** 
- **Duration:** 
- **Severity:** 
- **Impact:** 

## Timeline
| Time | Event |
|------|-------|
| HH:MM | First alert |
| HH:MM | Team engaged |
| HH:MM | Issue identified |
| HH:MM | Fix deployed |
| HH:MM | Service restored |

## Root Cause
[Describe the root cause]

## What Went Well
- 

## What Went Wrong
- 

## Action Items
- [ ] 
- [ ] 
- [ ] 

## Lessons Learned
- 
```

---

*Last Updated: 2024-12-13*
*Version: 1.0*
