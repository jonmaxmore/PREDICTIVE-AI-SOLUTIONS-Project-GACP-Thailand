# Provider Evaluation Evidence

Date: 2026-03-08

## Scope

This evidence file supports the scored values in `docs/provider-evaluation-scorecard.csv`.

Scoring rule:

- provider capability scores are based on official provider documentation
- `team_familiarity` and `migration_complexity` are local inferences from this repository's current DigitalOcean deployment and scripts

## Provisional recommendation

1. AWS
2. GCP
3. Azure
4. DigitalOcean

Reason:

- AWS is the strongest fit for a future enterprise target because it combines multi-AZ primitives, strong managed stateful services, broad compliance coverage, and an actual Thailand region.
- GCP is close behind and strong on global edge, managed services, and provider-neutral Terraform workflows, but is weaker than AWS on Thailand-specific regional fit.
- Azure is operationally strong, but its fit is slightly lower here because the current repo offers no Microsoft-specific operating history and PostgreSQL/Redis HA evidence is good rather than clearly strongest-in-class for this workload.
- DigitalOcean remains acceptable as the current single-host baseline, but it is the weakest option for the future HA target because it lacks a native WAF story comparable to the hyperscalers and offers fewer failure-domain and managed control options.

## AWS rationale

- `managed_edge=5`, `dns_tls=5`
  - Application Load Balancer distributes traffic across targets in multiple Availability Zones and requires at least two Availability Zone subnets.
  - Source:
    - https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html
    - https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
- `waf_cdn=5`
  - AWS WAF protects Application Load Balancer and CloudFront is part of the standard edge stack.
  - Source:
    - https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html
- `multi_failure_domain_app=5`
  - AWS Regions have multiple Availability Zones and AWS guidance recommends multi-AZ distribution.
  - Source:
    - https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-availability-zones.html
    - https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-rebalancing.html
- `managed_postgres_ha=5`
  - RDS Multi-AZ maintains a synchronous standby replica in a different Availability Zone.
  - Source:
    - https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html
- `managed_redis_ha=5`
  - ElastiCache supports Multi-AZ with automatic failover.
  - Source:
    - https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/AutoFailover.html
- `object_storage=5`
  - S3 provides secure, durable, highly scalable object storage.
  - Source:
    - https://aws.amazon.com/documentation-overview/s3/
- `observability=5`
  - CloudWatch provides system-wide observability for application performance, operational health, and resource utilization.
  - Source:
    - https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/WhatIsCloudWatch.html
- `iac_support=5`, `rollout_and_rollback=5`
  - CloudFormation models infrastructure as templates and supports change management patterns.
  - Source:
    - https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html
    - https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/walkthroughs.html
- `identity_and_secrets=5`
  - Secrets Manager stores and rotates database credentials, API keys, and other secrets.
  - Source:
    - https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html
- `compliance_controls=5`
  - AWS publishes broad compliance programs and audit-friendly enablers.
  - Source:
    - https://aws.amazon.com/compliance/programs/
- `cost_visibility=4`
  - AWS Pricing Calculator is strong, but the commercial model is still more complex than DigitalOcean's simpler pricing posture.
  - Source:
    - https://docs.aws.amazon.com/cost-management/latest/userguide/pricing-calculator.html
    - https://aws.amazon.com/pricing/
- `team_familiarity=2`, `migration_complexity=3`
  - Local inference: the current repo and deploy scripts point to DigitalOcean, not AWS.
- `regional_fit=5`
  - AWS now has an Asia Pacific (Thailand) Region with three Availability Zones.
  - Source:
    - https://aws.amazon.com/blogs/aws/announcing-the-new-aws-asia-pacific-thailand-region/

## GCP rationale

- `managed_edge=5`, `waf_cdn=5`, `dns_tls=5`, `rollout_and_rollback=5`
  - Global external Application Load Balancer offers global Anycast IPs, multi-region backends, Cloud CDN, Cloud Armor, and traffic splitting.
  - Source:
    - https://cloud.google.com/load-balancing/docs/https/
    - https://cloud.google.com/load-balancing/docs/application-load-balancer
- `multi_failure_domain_app=5`
  - Google Cloud exposes broad global regions and zones with a global network and multi-region edge model.
  - Source:
    - https://cloud.google.com/about/locations
- `managed_postgres_ha=5`
  - Cloud SQL HA uses a primary and standby across zones in a region.
  - Source:
    - https://cloud.google.com/sql/docs/mysql/high-availability
- `managed_redis_ha=5`
  - Memorystore Standard Tier replicates across zones with automatic failover.
  - Source:
    - https://cloud.google.com/memorystore/docs/redis/memorystore-for-redis-overview
- `object_storage=5`
  - Cloud Storage is Google's object storage service.
  - Source:
    - https://docs.cloud.google.com/storage/docs/introduction
- `observability=5`
  - Cloud Monitoring provides metrics, alerts, uptime monitoring, and SLO support.
  - Source:
    - https://docs.cloud.google.com/monitoring/docs/monitoring-overview
- `iac_support=5`
  - Google documents Terraform on Google Cloud as the primary IaC path.
  - Source:
    - https://docs.cloud.google.com/docs/terraform/terraform-overview
- `identity_and_secrets=5`
  - Secret Manager offers managed secrets with IAM, replication, auditability, and rotation.
  - Source:
    - https://docs.cloud.google.com/secret-manager/docs/overview
- `compliance_controls=5`
  - Google Cloud Trust Center points to a broad compliance resource center including ISO, SOC, PCI DSS, FedRAMP, GDPR, and HIPAA.
  - Source:
    - https://cloud.google.com/trust-center
- `cost_visibility=4`
  - Google provides both a pricing calculator and downloadable SKU pricing reports.
  - Source:
    - https://cloud.google.com/products/calculator
    - https://docs.cloud.google.com/billing/docs/how-to/pricing-table
- `team_familiarity=2`, `migration_complexity=3`
  - Local inference from the current DigitalOcean baseline.
- `regional_fit=4`
  - Strong APAC footprint and global network, but no Thailand region was used as evidence in this review.
  - Source:
    - https://cloud.google.com/about/locations

## Azure rationale

- `managed_edge=5`, `waf_cdn=5`, `dns_tls=5`
  - Azure Front Door is a global edge/CDN service with global load balancing, SSL offload, and WAF in Premium.
  - Source:
    - https://azure.microsoft.com/pricing/details/frontdoor/
    - https://learn.microsoft.com/en-us/training/modules/intro-to-azure-front-door/
- `multi_failure_domain_app=4`
  - Azure regions can use availability zones, but not every region supports the same zonal posture.
  - Source:
    - https://learn.microsoft.com/en-us/azure/availability-zones/az-overview
- `managed_postgres_ha=4`
  - Azure Database for PostgreSQL Flexible Server supports automatic failover and zone-redundant HA only in certain regions.
  - Source:
    - https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-high-availability
    - https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/how-to-configure-high-availability
- `managed_redis_ha=4`
  - Azure Cache for Redis supports high availability and zone redundancy in supported regions.
  - Source:
    - https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-high-availability
- `object_storage=5`
  - Azure Blob Storage is Microsoft's object storage service with Entra ID, RBAC, and encryption.
  - Source:
    - https://azure.microsoft.com/en-us/products/storage/blobs
- `observability=5`
  - Azure Monitor provides metrics, logs, alerting, and integrated monitoring workflows.
  - Source:
    - https://learn.microsoft.com/en-us/azure/azure-monitor/overview
- `iac_support=5`
  - Bicep is Microsoft's declarative IaC language for Azure resources.
  - Source:
    - https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/learn-bicep
- `rollout_and_rollback=4`
  - Strong declarative IaC and edge routing controls, but the current evidence set is less directly rollout-oriented than AWS/GCP.
- `identity_and_secrets=5`
  - Key Vault provides secrets, keys, certificates, RBAC, and high-availability replication behavior.
  - Source:
    - https://learn.microsoft.com/en-us/azure/key-vault/general/overview
- `compliance_controls=5`
  - Azure compliance documentation lists broad global and government compliance offerings.
  - Source:
    - https://learn.microsoft.com/en-us/azure/compliance/
- `cost_visibility=4`
  - Azure provides a pricing calculator and pricing guidance, but the model is still less simple than DigitalOcean.
  - Source:
    - https://azure.microsoft.com/en-us/pricing/calculator/
    - https://azure.microsoft.com/en-us/pricing/
- `team_familiarity=2`, `migration_complexity=2`
  - Local inference from the current DigitalOcean-centric repo and workflow.
- `regional_fit=4`
  - Broad regional presence, but no Thailand region was used as evidence in this review.
  - Source:
    - https://azure.microsoft.com/en-us/global-infrastructure/geographies/
    - https://learn.microsoft.com/en-us/azure/virtual-machines/regions

## DigitalOcean rationale

- `managed_edge=4`, `dns_tls=4`
  - DigitalOcean offers managed regional and global load balancers and load balancer TLS/Let's Encrypt features.
  - Source:
    - https://docs.digitalocean.com/products/networking/load-balancers/index.html
    - https://www.digitalocean.com/products/load-balancers
- `waf_cdn=2`
  - DigitalOcean provides Cloud Firewalls and Spaces CDN, but no first-party WAF equivalent was used as evidence.
  - Source:
    - https://docs.digitalocean.com/docs/networking/firewalls
    - https://docs.digitalocean.com/products/spaces/how-to/enable-cdn/
- `multi_failure_domain_app=2`
  - The regional footprint is materially smaller and this review did not find an AZ-style failure-domain model equivalent to the hyperscalers.
  - Source:
    - https://docs.digitalocean.com/platform/regional-availability/
- `managed_postgres_ha=4`
  - Managed Databases include standby nodes for high availability and PITR.
  - Source:
    - https://docs.digitalocean.com/products/databases/
- `managed_redis_ha=3`
  - DigitalOcean's Redis-compatible answer is Managed Valkey with one standby node and automatic promotion, but the old managed caching service is being discontinued.
  - Source:
    - https://docs.digitalocean.com/products/databases/
    - https://docs.digitalocean.com/products/databases/valkey/how-to/add-standby-nodes/
- `object_storage=4`
  - Spaces is S3-compatible object storage with built-in CDN.
  - Source:
    - https://docs.digitalocean.com/products/spaces
- `observability=3`
  - Monitoring and alerts exist, but the platform evidence is lighter than the hyperscalers' integrated observability stacks.
  - Source:
    - https://docs.digitalocean.com/products/monitoring/how-to/manage-alerts/
- `iac_support=4`
  - DigitalOcean documents Terraform support directly.
  - Source:
    - https://docs.digitalocean.com/reference/terraform/index.html
- `rollout_and_rollback=3`
  - The building blocks exist, but the current evidence is weaker for enterprise-grade release orchestration.
- `identity_and_secrets=2`
  - No first-party general secret-management service equivalent to AWS Secrets Manager, Google Secret Manager, or Azure Key Vault was used as evidence.
- `compliance_controls=3`
  - DigitalOcean trust material shows meaningful certifications, but the breadth is still narrower than the hyperscalers.
  - Source:
    - https://www.digitalocean.com/trust
    - https://www.digitalocean.com/trust/certification-reports
- `cost_visibility=5`
  - DigitalOcean pricing remains simple and calculator-driven.
  - Source:
    - https://www.digitalocean.com/pricing/calculator
    - https://www.digitalocean.com/pricing/load-balancers
- `team_familiarity=4`, `migration_complexity=5`
  - Local inference: the current repo, scripts, and production baseline are explicitly DigitalOcean-based.
- `regional_fit=3`
  - DigitalOcean has nine regions and a smaller regional footprint than the hyperscalers.
  - Source:
    - https://docs.digitalocean.com/platform/regional-availability/
