# idCard Column Deprecation Plan

## Background

The `User.idCardNumber` column is deprecated in favor of the more specific
`User.providerId` (for providers) and Thai ID fields managed via the
`authType` system. The column still exists in the database for backward
compatibility but should NOT be used for new features.

## Current Usage

| Location | Usage | Action |
|----------|-------|--------|
| Prisma schema | `idCardNumber String?` | Mark `@deprecated` in comment |
| KYC routes | Identity verification reads | Migrate to `providerId` + `authType` |
| PDF templates | Display in application summary | Read from `providerId` fallback |
| Seed scripts | Test data population | Remove references |

## Migration Strategy

### Phase 1 — Soft Deprecation (Current)
- [x] Add `/// @deprecated Use providerId + authType instead` comment in Prisma schema
- [x] Document in deprecation register (`docs/architecture/deprecation-register.md`)
- [ ] Add runtime warning log when `idCardNumber` is written to

### Phase 2 — Code Migration (Next Sprint)
- [ ] Audit all code paths that read/write `idCardNumber`
- [ ] Replace reads with `providerId` lookup
- [ ] Replace writes with `providerId` setter
- [ ] Add DB migration to copy remaining `idCardNumber` → `providerId` (where null)

### Phase 3 — Column Removal (Future)
- [ ] Create Prisma migration to drop `idCardNumber` column
- [ ] Remove from all select/include queries
- [ ] Update API documentation

## Risk Assessment

- **Low risk**: Only ~5 code paths still reference `idCardNumber`
- **No breaking changes**: `providerId` already covers all use cases
- **Data preservation**: Existing data migrated via Phase 2 copy

## Timeline

| Phase | Target | Status |
|-------|--------|--------|
| Phase 1 | Current session | ✅ Done |
| Phase 2 | Next sprint | Planned |
| Phase 3 | After Phase 2 validation | Planned |
