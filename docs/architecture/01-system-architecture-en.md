# GACP Certification System: Architecture Overview

## 1. Executive Summary
The **GACP Certification System** is a platform designed to digitalize the Good Agricultural and Collection Practices (GACP) certification process. It connects **HEALTH_USERs** (Applicants) and **DTAM Provider** (Regulators) through a seamless, automated workflow encompassing Registration, Verification, Auditing, and Traceability.

---

## 2. Technology Stack

### Frontend Application (Web App)
*   **Framework**: Next.js 14 (App Router)
*   **Language**: TypeScript
*   **Styling**: Tailwind CSS + Lucide Icons
*   **State Management**: Zustand
*   **Key Features**:
    *   Responsive Design (Mobile-First for HEALTH_USERs)
    *   Dynamic Form Wizard (8-Step Application)
    *   Real-time Status Dashboard

### Backend Services (API)
*   **Runtime**: Node.js
*   **Framework**: Express.js
*   **Architecture**: Modular Monolith (Routes -> Controllers -> Services)
*   **Database ORM**: Prisma (PostgreSQL)
*   **Key Features**:
    *   RESTful API Design
    *   JWT Authentication & Role-Based Access Control (RBAC)
    *   Automated PDF Generation (Puppeteer)
    *   QR Code Generation Engine

### Database & Infrastructure
*   **Database**: PostgreSQL
*   **Storage**: Local/Cloud File Storage (for Documents)
*   **Hosting**: supports Docker / PM2 deployment

---

## 3. System Architecture (C4 Model)

### Level 1: System Context Diagram
Shows how the system interacts with external entities.

```mermaid
graph TD
    User_HEALTH_USER[Health] -->|Submits Application| GACP_System
    User_PROVIDER[DTAM Provider] -->|Reviews & Audits| GACP_System
    Consumer[Public Consumer] -->|Scans QR Code| GACP_System
    
    GACP_System[("GACP System")] 
    
    GACP_System -->|Sends Emails| Email_Gateway[Email Service]
    GACP_System -->|Updates Payment| Payment_Gateway[Payment Gateway (Ksher)]
```

### Level 2: Container Diagram
Shows the high-level software containers and their interactions.

```mermaid
graph TB
    subgraph "GACP Platform"
        Web_App[("Web Application\n(Next.js)")]
        API[("Backend API\n(Nodejs/Express)")]
        DB[("Database\n(PostgreSQL)")]
        FileStore[("File Storage")]
    end

    User_HEALTH_USER -->|HTTPS| Web_App
    User_PROVIDER -->|HTTPS| Web_App
    
    Web_App -->|JSON/REST| API
    API -->|Read/Write| DB
    API -->|Upload/Download| FileStore
```

---

## 4. Key Domain Models (ER Diagram - High Level)

```mermaid
erDiagram
    USER ||--o{ FARM : owns
    FARM ||--|{ PLOT : contains
    FARM ||--o{ CERTIFICATE : holds
    
    APPLICATION ||--|| USER : submits
    APPLICATION ||--|| INVOICE : generates
    
    PLOT ||--o{ PLANTING_CYCLE : hosts
    PLANTING_CYCLE ||--o{ HARVEST_BATCH : yields
    HARVEST_BATCH ||--o{ LOT : packs
    LOT ||--|| QR_CODE : identifies
```

### Core Entities:
1.  **User**: Central identity (Health or Provider).
2.  **Application**: The lifecycle of a request (Draft -> Submitted -> Paid -> Approved).
3.  **Certificate**: The digital asset granted upon approval.
4.  **Traceability Chain**: Plot -> Cycle -> Batch -> Lot.
