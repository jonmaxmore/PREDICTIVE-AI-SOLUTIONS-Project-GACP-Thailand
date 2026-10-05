#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const checks = [];

function pass(message) {
  checks.push({ ok: true, message });
}

function fail(message) {
  checks.push({ ok: false, message });
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

function expect(condition, successMessage, failureMessage) {
  if (condition) {
    pass(successMessage);
  } else {
    fail(failureMessage);
  }
}

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

function summarizeScorecard(scorecardRows) {
  const [header, ...dataRows] = scorecardRows;
  const providers = header.slice(4, header.length - 1);
  const summaries = Object.fromEntries(
    providers.map((provider) => [
      provider,
      {
        provider,
        weightedScore: 0,
        weightedMax: 0,
        missing: 0
      }
    ])
  );

  for (const row of dataRows) {
    const weight = Number(row[2]);
    providers.forEach((provider, index) => {
      const value = row[index + 4];
      const summary = summaries[provider];
      summary.weightedMax += weight * 5;
      if (value === '') {
        summary.missing += 1;
        return;
      }
      summary.weightedScore += weight * Number(value);
    });
  }

  return providers.map((provider) => summaries[provider]);
}

try {
  const requiredFiles = [
    'infra/README.md',
    'infra/contracts/service-contracts.json',
    'infra/environments/production/current-baseline.json',
    'infra/environments/production/target-platform-neutral.json',
    'infra/providers/provider-map.json',
    'infra/modules/README.md',
    'infra/live/README.md',
    'docs/deployment/provider-evaluation-scorecard.csv',
    'docs/deployment/provider-evaluation-evidence-2026-03-08.md'
  ];

  for (const relPath of requiredFiles) {
    expect(
      exists(relPath),
      `required infra artifact exists: ${relPath}`,
      `missing infra artifact: ${relPath}`
    );
  }

  const serviceContracts = readJson('infra/contracts/service-contracts.json');
  const currentBaseline = readJson('infra/environments/production/current-baseline.json');
  const targetPlatformNeutral = readJson('infra/environments/production/target-platform-neutral.json');
  const providerMap = readJson('infra/providers/provider-map.json');
  const scorecard = parseCsv(read('docs/deployment/provider-evaluation-scorecard.csv'));
  const [header] = scorecard;
  const scorecardProviders = header.slice(4, header.length - 1);
  const expectedServices = [
    'edge',
    'app_runtime',
    'postgres',
    'redis',
    'object_storage',
    'observability',
    'dns',
    'secrets'
  ];

  expect(
    serviceContracts.schemaVersion === '2026-03-08',
    'service contracts schema version is pinned',
    'service contracts schema version is missing or unexpected'
  );
  expect(
    serviceContracts.stableInterfaceContracts.frontendHttpPort === 3000,
    'service contracts preserve frontend port 3000',
    'service contracts must preserve frontend port 3000'
  );
  expect(
    serviceContracts.stableInterfaceContracts.backendHttpPort === 8000,
    'service contracts preserve backend port 8000',
    'service contracts must preserve backend port 8000'
  );
  expect(
    ['/nginx-health', '/health', '/api/health'].every((healthPath) =>
      serviceContracts.stableInterfaceContracts.healthPaths.includes(healthPath)
    ),
    'service contracts preserve canonical health paths',
    'service contracts must include /nginx-health, /health, and /api/health'
  );
  expect(
    ['/', '/api/'].every((routePrefix) =>
      serviceContracts.stableInterfaceContracts.routePrefixes.includes(routePrefix)
    ),
    'service contracts preserve canonical route prefixes',
    'service contracts must include / and /api/'
  );
  expect(
    serviceContracts.stableInterfaceContracts.dataProtocols.database === 'postgresql' &&
      serviceContracts.stableInterfaceContracts.dataProtocols.cache === 'redis' &&
      serviceContracts.stableInterfaceContracts.dataProtocols.objectStorage ===
        's3_compatible_or_adapter',
    'service contracts preserve provider-neutral data protocols',
    'service contracts must preserve PostgreSQL, Redis, and S3-compatible object storage boundaries'
  );
  expect(
    expectedServices.every(
      (serviceName) =>
        serviceContracts.services[serviceName] &&
        serviceContracts.services[serviceName].required === true &&
        Array.isArray(serviceContracts.services[serviceName].requiredBehaviors) &&
        serviceContracts.services[serviceName].requiredBehaviors.length > 0
    ),
    'service contracts cover all required infrastructure services',
    'service contracts are missing one or more required services or behaviors'
  );

  expect(
    currentBaseline.environment === 'production' &&
      currentBaseline.provider === 'digitalocean' &&
      currentBaseline.deploymentModel === 'single_host_docker',
    'current baseline manifest matches the approved production baseline',
    'current baseline manifest must remain DigitalOcean single-host docker until production runtime changes'
  );
  expect(
    currentBaseline.topology === 'cloud_firewall_to_host_nginx_to_docker_nginx' &&
      JSON.stringify(currentBaseline.ingressChain) ===
        JSON.stringify(['do_cloud_firewall', 'host_nginx', 'docker_nginx', 'frontend_backend']),
    'current baseline manifest captures the approved ingress chain',
    'current baseline manifest must record host_nginx -> docker_nginx -> frontend/backend'
  );
  expect(
    currentBaseline.publicEdge.upstream === '127.0.0.1:8080',
    'current baseline manifest records the host nginx upstream correctly',
    'current baseline manifest must record 127.0.0.1:8080 as the docker nginx upstream'
  );
  expect(
    currentBaseline.constraints.failureDomains === 1 &&
      currentBaseline.constraints.automaticFailover === false,
    'current baseline manifest records single-host risk explicitly',
    'current baseline manifest must record single failure domain and no automatic failover'
  );

  expect(
    targetPlatformNeutral.environment === 'production' &&
      targetPlatformNeutral.provider === 'provider-neutral',
    'target manifest remains provider-neutral',
    'target manifest must remain provider-neutral until a future platform is selected'
  );
  expect(
    targetPlatformNeutral.minimumFailureDomains >= 2,
    'target manifest requires at least two failure domains',
    'target manifest must require at least two failure domains'
  );
  expect(
    targetPlatformNeutral.publicEdge.type === 'managed_edge' &&
      targetPlatformNeutral.publicEdge.tlsTermination === true &&
      targetPlatformNeutral.publicEdge.waf === true &&
      targetPlatformNeutral.publicEdge.healthChecks === true,
    'target manifest requires managed edge controls',
    'target manifest must require managed edge with TLS, WAF, and health checks'
  );
  expect(
    targetPlatformNeutral.appRuntime.frontendReplicasMin >= 2 &&
      targetPlatformNeutral.appRuntime.backendReplicasMin >= 2,
    'target manifest requires frontend and backend redundancy',
    'target manifest must require at least two frontend and two backend replicas'
  );
  expect(
    targetPlatformNeutral.statefulDependencies.postgres.managed === true &&
      targetPlatformNeutral.statefulDependencies.postgres.ha === true &&
      targetPlatformNeutral.statefulDependencies.redis.managed === true &&
      targetPlatformNeutral.statefulDependencies.redis.ha === true &&
      targetPlatformNeutral.statefulDependencies.objectStorage.external === true,
    'target manifest requires managed HA stateful services',
    'target manifest must require managed HA Postgres, managed HA Redis, and external object storage'
  );
  expect(
    targetPlatformNeutral.portabilityContracts.database === 'postgresql' &&
      targetPlatformNeutral.portabilityContracts.cache === 'redis' &&
      targetPlatformNeutral.portabilityContracts.objectStorage ===
        's3_compatible_or_adapter',
    'target manifest preserves portability contracts',
    'target manifest must preserve PostgreSQL, Redis, and S3-compatible portability contracts'
  );

  expect(
    providerMap.currentRuntimeProvider === currentBaseline.provider,
    'provider map matches the current runtime provider',
    'provider map current runtime provider must match the current baseline manifest'
  );
  expect(
    ['evaluation_complete_provider_unselected', 'selected'].includes(providerMap.selectionStatus),
    'provider map selection status is valid',
    'provider map selection status must be evaluation_complete_provider_unselected or selected'
  );
  expect(
    providerMap.selectionStatus === 'selected'
      ? typeof providerMap.selectedProvider === 'string' &&
          providerMap.selectedProvider.length > 0
      : providerMap.selectedProvider === null,
    'provider map selectedProvider matches the current decision status',
    'provider map selectedProvider does not match the current decision status'
  );
  expect(
    exists(providerMap.evaluationEvidence),
    'provider map points to an existing evaluation evidence file',
    'provider map evaluationEvidence must point to an existing file'
  );
  expect(
    providerMap.scorecardPath === 'docs/deployment/provider-evaluation-scorecard.csv' &&
      exists(providerMap.scorecardPath),
    'provider map points to the canonical scorecard',
    'provider map must point to docs/deployment/provider-evaluation-scorecard.csv'
  );

  expect(
    scorecardProviders.every((provider) => providerMap.providers[provider]),
    'provider map includes all providers present in the scorecard',
    'provider map is missing one or more providers from the scorecard'
  );
  expect(
    Object.keys(providerMap.providers).length === scorecardProviders.length,
    'provider map and scorecard have the same provider count',
    'provider map includes providers not present in the scorecard'
  );

  const providerCapabilityKeys = [
    'edge',
    'appRuntime',
    'postgres',
    'redis',
    'objectStorage',
    'observability',
    'dns',
    'secrets'
  ];
  expect(
    scorecardProviders.every((provider) =>
      providerCapabilityKeys.every(
        (key) =>
          Array.isArray(providerMap.providers[provider][key]) &&
          providerMap.providers[provider][key].length > 0
      )
    ),
    'provider map includes capability aliases for every provider',
    'provider map is missing one or more capability aliases'
  );

  const providerSummaries = summarizeScorecard(scorecard);
  const hasMissingScores = providerSummaries.some((summary) => summary.missing > 0);
  expect(
    hasMissingScores === false,
    'scorecard is complete for all providers',
    'scorecard must be complete before infra contracts can be considered canonical'
  );

  const expectedOrder = [...providerSummaries]
    .sort((a, b) => {
      if (b.weightedScore !== a.weightedScore) {
        return b.weightedScore - a.weightedScore;
      }
      return a.provider.localeCompare(b.provider);
    })
    .map((summary) => summary.provider);

  expect(
    JSON.stringify(providerMap.candidateOrder) === JSON.stringify(expectedOrder),
    'provider map candidate order matches the weighted score ranking',
    'provider map candidate order must match the weighted score ranking from the scorecard'
  );

  const liveEntries = fs
    .readdirSync(path.join(root, 'infra', 'live'))
    .filter((entry) => entry !== 'README.md');

  expect(
    providerMap.selectionStatus === 'evaluation_complete_provider_unselected'
      ? liveEntries.length === 0
      : liveEntries.length >= 0,
    'live infra directory respects the current provider decision status',
    'infra/live must stay empty until the provider decision is signed off'
  );

  const failures = checks.filter((check) => !check.ok);
  const reporter = failures.length > 0 ? console.error : console.log;

  reporter('Infrastructure contract validation');
  for (const check of checks) {
    reporter(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`);
  }

  if (failures.length > 0) {
    process.exit(1);
  }
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
