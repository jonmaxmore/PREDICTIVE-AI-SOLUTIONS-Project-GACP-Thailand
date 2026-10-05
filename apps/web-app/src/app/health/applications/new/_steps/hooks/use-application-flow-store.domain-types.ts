// Re-export domain types from canonical location (new/hooks). After the
// 2026-04-29 rename of new-legacy/ → new/_steps/, this file lives at
// new/_steps/hooks/, so the canonical hooks dir is two levels up + into
// hooks/, not "../../new/hooks/" (which would resolve to new/new/hooks/).
export * from '../../hooks/domain-types';
