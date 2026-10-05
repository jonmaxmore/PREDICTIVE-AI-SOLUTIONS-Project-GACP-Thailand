# DTAM Scheduler Team Training — 2026-05-16

**Audience**: DTAM Scheduler staff who manage audit assignments and capacity
**Prerequisites**: SCHEDULER role, Scheduler Console access
**Estimated reading**: 40 minutes
**Hands-on lab**: 60 minutes

> Schedulers are the bridge between applicants ready for audit (status PAID_PHASE_2) and auditors. Your job is to keep the queue moving while respecting capacity and conflict rules.

---

## 1. SCHEDULER role and responsibilities

The SCHEDULER scope:

- View all applications in QUEUED status (Phase-2 paid, awaiting audit)
- View all AUDITOR accounts and their availability
- Assign audit to an auditor (creates ASSIGNED audit)
- Resolve reschedule requests (from auditor or applicant)
- Manage capacity (target queue lead-time ≤ 14 days)
- View team performance dashboard

**NOT allowed**:
- Approve/reject payments
- Edit application data
- Edit audit results
- Issue certificates

---

## 2. Queue management

[FIG-01: Scheduler Console > Audit Queue]

### 2.1 Queue dashboard

Two main panels:
- **Pending Queue**: applications awaiting assignment, FIFO by Phase-2 payment date
- **Assigned Audits**: scheduled audits with status (UPCOMING, IN_PROGRESS, COMPLETED, RESCHEDULED)

Filters: region, audit type (new/renewal), priority flag, lead time.

### 2.2 Assignment SLA

| Metric | Target | Escalation if |
|--------|--------|----------------|
| Time to assign | 48h after PAID_PHASE_2 | > 72h |
| Audit lead time | ≤ 14 days from assignment | > 21 days |
| First audit attempt success rate | > 90% | < 80% |

### 2.3 Priority handling

Applications can be flagged PRIORITY by Admin (rare):
- Pilot farms in DTAM strategic regions
- Renewal applications with expiring cert (≤ 30 days)
- Audit-redo requests already paid

PRIORITY applications jump queue. Treat as next-up.

---

## 3. Auditor assignment + conflict detection

[FIG-02: Auditor assignment dialog]

### 3.1 Picking an auditor

Criteria (in order):
1. **Geographic proximity**: auditor based in same/adjacent province
2. **Availability**: has open slots in next 14 days
3. **Specialization match**: organic/conventional crop expertise
4. **Workload balance**: fewer current assignments preferred
5. **No conflict of interest**

System auto-suggests top 3 candidates. You can override.

### 3.2 Conflict detection (automatic)

System blocks assignment if:
- Auditor has previously audited this farm within last 24 months (rotation rule)
- Auditor is from same family/region (declared CoI)
- Auditor's existing schedule overlaps proposed date
- Auditor on leave (HR system integration)

[FIG-03: Conflict warning dialog]

If you bypass a soft warning (e.g. rotation rule waiver for low-supply region), document reason in audit log.

### 3.3 Assignment notification

After assignment:
- Auditor gets app notification + email
- Applicant gets email with auditor name, audit window (3-day window: applicant picks exact day)
- Field app downloads case file (encrypted)

---

## 4. Reschedule resolution

[FIG-04: Reschedule inbox]

### 4.1 Sources

- AUDITOR-initiated (auditor cannot make it)
- APPLICANT-initiated (applicant requests delay; max 2 reschedules per audit)
- SYSTEM-flagged (e.g. weather warning for region)

### 4.2 Process

1. Review reason and evidence
2. Decide: APPROVE / REJECT
3. If APPROVE:
   - Propose new date (within 14 days unless force majeure)
   - Re-confirm with both parties
   - System auto-updates field app
4. If REJECT:
   - Provide reason (e.g. "third reschedule, please complete")
   - Applicant may escalate to Admin

### 4.3 Repeat reschedule policy

- Applicant 1st reschedule: free
- Applicant 2nd reschedule: warning email
- Applicant 3rd reschedule attempt: blocked; must escalate to Admin
- Auditor 1st reschedule: no penalty
- Auditor 2nd reschedule on same case: flag for senior auditor review (workload? competency?)

---

## 5. Capacity planning

[FIG-05: Capacity heatmap by region and week]

### 5.1 Weekly capacity review (every Monday)

1. Open Capacity Dashboard
2. Review next 4 weeks
3. Identify overload (queue > 14 days for any region)
4. Identify underload (auditor with < 2 audits/week)
5. Take action:
   - Reassign auditors to overloaded regions (travel comp via Finance)
   - Flag to Admin if structural shortage (need new auditor hire)

### 5.2 Monthly forecast

End of each month:
- Review historical conversion rate (PAID_PHASE_2 → completed audit)
- Forecast next month's queue based on Phase-1 cohort
- Send forecast to Auditor Lead + Admin

### 5.3 Quarterly capacity review

Joint with Auditor Lead + Product + Admin:
- New auditor onboarding count
- Auditor attrition
- Regional shifts in demand
- Travel cost optimization

---

## 6. KPIs you own

- Average lead time (assignment → audit) ≤ 14 days
- Reschedule rate ≤ 15%
- Conflict-error rate < 1% (assignment errors caught by audit later)
- Auditor utilization 70–85% (not too low, not burned out)

---

## 7. Common scenarios

### 7.1 Auditor cancels day-of
- Find replacement from same region's standby roster
- If none available: contact applicant immediately, reschedule within 7 days
- Document in incident log

### 7.2 Applicant unreachable
- Send 3 reminders (D-7, D-3, D-1) automated
- If still unreachable on audit day: mark "applicant no-show"
- Apply no-show fee (5,000 THB) per policy
- After 30 days unresponsive: application status SUSPENDED

### 7.3 Auditor reports CoI mid-audit
- Auditor must stop audit and tag CoI
- Reassign to different auditor
- Original audit voided, applicant not charged again

---

## 8. Quick reference

- Auditor roster: Scheduler > Auditors > Active Roster
- Reschedule inbox: Scheduler > Reschedules > Open
- Capacity heatmap: Scheduler > Capacity
- Helpdesk: ext. 4200, scheduling@dtam.go.th
- After-hours escalation: on-call PM
