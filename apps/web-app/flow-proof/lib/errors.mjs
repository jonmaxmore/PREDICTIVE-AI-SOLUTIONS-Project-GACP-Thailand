/** A step throws this to report BLOCKED (environment/dependency unavailable) — anything else thrown is treated as FAIL (a real, unexpected app/script error). */
export class Blocked extends Error {}
