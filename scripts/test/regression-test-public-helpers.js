function isoAfterHours(hours) {
  return new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString();
}

function createPublicHelpers({
  assert,
  authHeader,
  requestWithRetry,
  PUBLIC_BASE_URL,
  LOCAL_HOSTNAMES,
}) {
  async function scheduleAuditWithRetries(token, payload, maxAttempts = 180) {
    let baseDate = new Date(payload.scheduledDate);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const dayOffset = Math.floor(attempt / 8);
      const hourOffset = (attempt % 8) * 3;
      const minuteOffset = ((attempt * 11) + (Date.now() % 17)) % 60;
      const shiftedDate = new Date(
        baseDate.getTime()
        + (dayOffset * 24 * 60 * 60 * 1000)
        + (hourOffset * 60 * 60 * 1000)
        + (minuteOffset * 60 * 1000),
      ).toISOString();

      const result = await requestWithRetry('/provider/scheduler/audits/schedules', {
        method: 'POST',
        headers: authHeader(token),
        body: JSON.stringify({
          ...payload,
          scheduledDate: shiftedDate,
        }),
      }, { attempts: 4, delayMs: 700 });

      if (result.response.ok && result.body?.success) {
        return result;
      }
      if (result.response.status !== 409) {
        throw new Error(`Schedule failed: ${result.response.status} ${JSON.stringify(result.body)}`);
      }
      const conflictingAt = result.body?.data?.conflictingScheduledDate;
      if (conflictingAt) {
        const conflictDate = new Date(conflictingAt);
        if (!Number.isNaN(conflictDate.getTime())) {
          baseDate = new Date(conflictDate.getTime() + (3 * 60 * 60 * 1000));
        }
      }
    }

    throw new Error('Schedule failed with repeated auditor collisions');
  }

  function makeAbsolutePublicUrl(rawUrl) {
    const candidate = String(rawUrl || '').trim();
    if (!candidate) {
      return null;
    }
    const publicBase = new URL(PUBLIC_BASE_URL);
    try {
      const parsed = new URL(candidate);
      if (LOCAL_HOSTNAMES.has(parsed.hostname) && !parsed.port && publicBase.port) {
        parsed.port = publicBase.port;
        parsed.protocol = publicBase.protocol;
      }
      return parsed.toString();
    } catch (_error) {
      const normalized = candidate.startsWith('/') ? candidate : `/${candidate}`;
      return new URL(normalized, publicBase).toString();
    }
  }

  function assertHttpsOrLocal(urlString) {
    const parsed = new URL(urlString);
    const isLocal = LOCAL_HOSTNAMES.has(parsed.hostname);
    assert(
      parsed.protocol === 'https:' || isLocal,
      `Public QR URL must be https (or localhost in dev): ${urlString}`,
    );
  }

  async function fetchPublicUrl(urlString) {
    const response = await fetch(urlString, { method: 'GET' });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : await response.text();
    return { response, body };
  }

  function ensureNoSensitiveFields(payload, label) {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const forbidden = ['healthId', 'providerId', 'idCard', 'email', 'phoneNumber', 'password'];
    forbidden.forEach((term) => {
      assert(!serialized.includes(`"${term}"`), `${label} leaks sensitive field: ${term}`);
    });
  }

  return {
    isoAfterHours,
    scheduleAuditWithRetries,
    makeAbsolutePublicUrl,
    assertHttpsOrLocal,
    fetchPublicUrl,
    ensureNoSensitiveFields,
  };
}

module.exports = {
  createPublicHelpers,
};
