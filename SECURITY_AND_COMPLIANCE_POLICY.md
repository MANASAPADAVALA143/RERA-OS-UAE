# EstateCFO: Data Security & Privacy Policy
**Version 1.0** | Internal Use | For Enterprise/Professional Clients

---

## Executive Summary

EstateCFO employs **enterprise-grade security** across all data layers:
- End-to-end encryption (TLS 1.2+ in transit, AES-256 at rest)
- Multi-tenant data isolation
- AWS Bedrock for AI/analytics with **zero data retention** by default
- Compliant with GDPR, CCPA, and enterprise standards

**All data is YOUR data.** We do not retain, train on, or share customer data under any circumstances.

---

## 1. Data Storage & Encryption

### Database (PostgreSQL RDS)
- **Encryption at Rest:** AES-256 using AWS KMS customer-managed keys
- **Encryption in Transit:** SSL/TLS 1.2+ for all database connections
- **Access Control:** IAM-based authentication (no hardcoded passwords)
- **Backup:** Automated daily encrypted snapshots, 30-day retention

### File Storage (AWS S3)
- **Encryption:** SSE-KMS (Server-Side Encryption with customer-managed KMS keys)
- **Access:** Pre-signed URLs with 1-hour expiration (no long-lived public access)
- **Versioning:** Enabled for audit trail and disaster recovery

### Secrets Management
- **RDS Credentials:** Stored in AWS Secrets Manager, rotated automatically
- **API Keys:** Never in code; passed via secure environment variables
- **Principle:** Zero hardcoded secrets in production

---

## 2. AI/LLM Data Handling (AWS Bedrock)

### Data Retention Policy
**Official Reference:** [AWS Bedrock Data Protection](https://docs.aws.amazon.com/bedrock/latest/userguide/data-protection.html)

- **Default Behavior:** Customer prompts and outputs are NOT retained by AWS beyond the duration necessary to process the request
- **No Training on Your Data:** AWS does NOT use customer data to train AWS foundation models or third-party models
- **Model Improvement (Opt-In Only):** A model improvement program exists, but is OFF by default. Customers must explicitly enable it
- **Immediate Deletion:** Processed data is deleted from Bedrock logs after request completion

### EstateCFO LLM Usage
- **Model:** Claude 3.5 Sonnet via Bedrock (capable, compliant, cost-effective)
- **Use Cases:** 
  - Financial analysis and insights generation
  - Deal narrative/summary creation
  - Rental portfolio analytics
- **Prompts Never Contain:** Raw customer names, account numbers, or external identifiers
- **Data Context:** Only anonymized/aggregated financial metrics passed to the model

---

## 3. Data Isolation & Multi-Tenancy

### Tenant Segregation
- **Database:** Row-level security enforced — each tenant's data queried only by their own connections
- **S3:** Folder structure by tenant_id; cross-tenant access forbidden at IAM level
- **Logging:** All data access logged to AWS CloudTrail with tenant_id and user_id

### No Cross-Contamination
- Queries are scoped to `WHERE tenant_id = current_user.tenant_id`
- Backup/restore operations are single-tenant only
- Third-party APIs receive only the tenant's data, never a union

---

## 4. Data Retention & Deletion

### Retention Schedules
| Data Type | Retention Period | Reason |
|-----------|-----------------|--------|
| Financial Records | 7 years | Tax/audit compliance |
| Transactional Logs | 2 years | Incident investigation |
| System Access Logs | 1 year | Security audit |
| File Uploads (S3) | As specified by tenant | User-defined lifecycle |
| Bedrock AI Requests | 0 days (see §2) | Immediately deleted |

### Deletion Process
1. **Soft Delete:** Mark records as deleted (retain for audit)
2. **Hard Delete:** Physical removal after retention period expires
3. **Encryption Key Destruction:** When a tenant offboards, KMS keys are scheduled for deletion

### Customer Right to Delete
- Tenants can request full data deletion at any time
- All data (except legal holds) deleted within 30 days
- Proof of deletion provided via AWS API reports

---

## 5. Compliance & Certifications

### Standards Supported
- ✅ **GDPR:** Data residency in US-East-1; subject to DPA
- ✅ **CCPA:** Consumer data rights fully honored
- ✅ **SOC 2 Type II:** AWS Bedrock is SOC 2 compliant
- ✅ **HIPAA:** Can be configured for health data (if required)

### Access Controls
- **Authentication:** SAML/Supabase for multi-factor identity
- **Authorization:** Role-based access control (RBAC) per user
- **Audit Logging:** All API calls logged to CloudTrail with user_id, timestamp, resource

---

## 6. Incident Response

### Breach Notification
- **Internal Alert:** Real-time CloudWatch notifications on unauthorized access attempts
- **Customer Notification:** Within 24 hours of confirmed breach, via email + dashboard alert
- **Authorities:** Notification to regulators within 72 hours (GDPR requirement)

### Disaster Recovery
- **RTO (Recovery Time Objective):** 4 hours
- **RPO (Recovery Point Objective):** 24 hours
- **Backup Location:** Cross-region S3 replicas
- **Testing:** Monthly DR drills to validate recovery procedures

---

## 7. Third-Party & Vendor Risk

### AWS Services Used
- **Bedrock:** Claude LLM inference — no data training, zero retention (documented above)
- **RDS:** Managed PostgreSQL — AWS-operated, we control encryption keys
- **S3:** File storage — AWS-operated, we control encryption keys
- **Secrets Manager:** Credential storage — AWS-operated, IAM-locked

### No Data Sharing
- EstateCFO does NOT integrate with third-party analytics, CRM, or BI tools unless you explicitly request and authorize
- Any integrations are subject to a separate Data Processing Agreement

---

## 8. Security Updates & Penetration Testing

### Patching
- **OS/Database:** Automated monthly security patches (Tuesday 2–4 AM UTC, no downtime)
- **Application:** Hot-patches for critical CVEs within 24 hours
- **Dependencies:** Weekly automated dependency scanning via GitHub/pip audits

### Penetration Testing
- **Annual Schedule:** Q2 and Q4 third-party pen testing
- **Scope:** Network, application, API, data exfiltration
- **Results:** Available upon request (NDA required for detailed report)

---

## 9. Your Responsibilities (Shared Security Model)

As a tenant, you are responsible for:
- ✅ Keeping passwords strong (12+ chars, unique)
- ✅ Enabling 2FA on your account
- ✅ Not sharing credentials between users
- ✅ Reporting suspicious activity immediately
- ✅ Complying with your own regulatory obligations (e.g., data accuracy, GAAP)

We are responsible for:
- ✅ Infrastructure security (encryption, access, patching)
- ✅ Data isolation and multi-tenancy integrity
- ✅ Incident response and recovery
- ✅ Compliance with industry standards

---

## 10. Questions & Support

**Data Privacy Questions?**
- Email: security@estatecfo.io
- Response SLA: 24 hours

**Report a Security Issue?**
- Email: security@estatecfo.io (mark CONFIDENTIAL)
- Do NOT open a public issue on GitHub

**Request Proof of Compliance?**
- SOC 2 Report: Available under NDA
- Pen Test Report: Available under NDA
- DPA / BAA: Available upon request

---

## Appendix: AWS Bedrock Data Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Your EstateCFO Instance (Our VPC)                       │
│  ├─ Your Financial Data (encrypted at rest)             │
│  ├─ Your Loan Data (encrypted at rest)                  │
│  └─ Your Tenant ID (row-level security)                 │
└─────────────────────────────────────────────────────────┘
                       ↓ (HTTPS/TLS 1.2+)
┌─────────────────────────────────────────────────────────┐
│ AWS Bedrock (Claude 3.5 Sonnet)                         │
│  ├─ Receives: Aggregated metrics only (NO PII)          │
│  ├─ Process: Generates narrative/insight                │
│  ├─ Return: Text response                               │
│  └─ Retention: ZERO (deleted immediately after response)│
└─────────────────────────────────────────────────────────┘
                       ↓ (HTTPS/TLS 1.2+)
┌─────────────────────────────────────────────────────────┐
│ Your Browser                                             │
│  ├─ Receives insight/report                             │
│  └─ Displays to authorized user                         │
└─────────────────────────────────────────────────────────┘
```

**Key Point:** Bedrock never sees your raw data — only anonymized metrics. Bedrock never retains any data.

---

**Last Updated:** 2026-06-30  
**Policy Owner:** CTO / Security Lead  
**Review Cadence:** Annually or after security incident
