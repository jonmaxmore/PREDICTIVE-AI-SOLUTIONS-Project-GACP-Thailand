import { dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { FlatCompat } from "@eslint/eslintrc";
import tailwindcss from "eslint-plugin-tailwindcss";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Phase A5 §4.3 — local plugin with `gacp/no-raw-color` rule.
// Loaded via createRequire because the rule files are CommonJS and the
// flat config is ESM. The rule starts at "warn" so the build doesn't
// break during the ratchet period; flip to "error" once main has 0
// violations (Phase A5 step 8).
const gacpPlugin = require("./eslint-rules/index.js");

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const restrictedImports = [
  { name: "@mantine/core", message: "Mantine is removed. Use '@/components/ui/primitives' (Tailwind + shadcn)." },
  { name: "@mantine/hooks", message: "Mantine is removed. Use React hooks or '@/hooks/*'." },
  { name: "@mantine/dates", message: "Mantine is removed. Use '@/components/ui/date-input'." },
  { name: "@mantine/notifications", message: "Mantine is removed. Use sonner via '@/lib/notifications'." },
  { name: "@mantine/form", message: "Mantine is removed. Use react-hook-form and '@/components/ui/primitives/form'." },
];

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    plugins: { tailwindcss, gacp: gacpPlugin },
    settings: { tailwindcss: { callees: ["cn", "cva", "clsx"] } },
    rules: {
      "tailwindcss/classnames-order": "warn",
      "tailwindcss/no-custom-classname": "off",
      // Phase A5 §4.3 — flag raw hex in className arbitrary values + inline
      // style. Step 8 ratchet (v3.5.3 — 2026-04-29): flipped from "warn" to
      // "error" after the 25-violation cleanup landed. Files that legitimately
      // need inline hex (DTAM print receipt, document layout) carry an
      // explicit `// eslint-disable-next-line gacp/no-raw-color` comment.
      "gacp/no-raw-color": "error",
      // Thai typography enforcement (quality remediation, 2026-07): never
      // positive letter-spacing (tracking-wide/wider/widest) or font-black
      // (synthesized 900 — Sukhumvit Set tops out at Bold) on elements whose
      // children contain Thai text. Conservative literal-only detection —
      // Thai arriving purely at runtime is a review concern, not lintable.
      "gacp/no-thai-letterspacing": "error",
      // R6-A (Iter R6) — flag any literal U+FEFF / U+200B / etc. byte
      // anywhere in source. Surfaces the issue R3-H1 caught manually with
      // xxd (admin/certificates/client-view.tsx literal BOM). All four
      // skip* flags off to enforce zero tolerance; the 2 pre-existing
      // BOM sites (admin/certificates/client-view.tsx + provider/
      // analytics/work/client-view.tsx) were converted to the 6-char
      // ASCII escape '\\uFEFF' per I-001 before this rule was enabled.
      "no-irregular-whitespace": ["error", {
        skipStrings: false,
        skipTemplates: false,
        skipComments: false,
        skipRegExps: false,
      }],
      // W3-A (Iter W3) — promote jsx-a11y from the 6-rule next/core-web-vitals
      // baseline (alt-text, aria-props, aria-proptypes, aria-unsupported-elements,
      // role-has-required-aria-props, role-supports-aria-props) to ~30 rules
      // covering WCAG 1.3.1, 2.4.x, 3.3.x, 4.1.x. Started at "warn" per I-006
      // ratchet pattern (mirrors gacp/no-raw-color's a5-warn → a5-error journey).
      // Promotion to "error" is scheduled for a future iter once outstanding
      // page-level warnings are triaged (see W3-A handoff "Ratchet plan").
      // Auto-fixable subset (aria-role, scope, no-redundant-roles, lang,
      // tabindex-no-positive) cleared by `eslint --fix` before this rule
      // block was committed; remaining warnings are listed in the handoff.
      "jsx-a11y/alt-text": ["warn", { elements: ["img"], img: ["Image"] }],
      "jsx-a11y/anchor-has-content": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/aria-activedescendant-has-tabindex": "warn",
      // aria-props / aria-proptypes / aria-role / aria-unsupported-elements /
      // role-has-required-aria-props / role-supports-aria-props are already
      // configured by next/core-web-vitals (see eslint-config-next/index.js
      // lines 67-78). Re-declaring keeps intent local AND lets W4 bump them
      // to "error" in one place.
      "jsx-a11y/aria-props": "warn",
      "jsx-a11y/aria-proptypes": "warn",
      "jsx-a11y/aria-role": "warn",
      "jsx-a11y/aria-unsupported-elements": "warn",
      "jsx-a11y/autocomplete-valid": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/heading-has-content": "warn",
      "jsx-a11y/html-has-lang": "warn",
      "jsx-a11y/iframe-has-title": "warn",
      "jsx-a11y/img-redundant-alt": "warn",
      "jsx-a11y/interactive-supports-focus": "warn",
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/media-has-caption": "warn",
      "jsx-a11y/mouse-events-have-key-events": "warn",
      "jsx-a11y/no-access-key": "warn",
      // no-autofocus deliberately stays "warn" only — the wizard intentionally
      // autofocuses the first field on /health/applications/new/step/4 per UX
      // research. Promotion to "error" blocked until UX revisits (per I-017).
      "jsx-a11y/no-autofocus": "warn",
      "jsx-a11y/no-distracting-elements": "warn",
      "jsx-a11y/no-interactive-element-to-noninteractive-role": "warn",
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "warn",
      "jsx-a11y/no-noninteractive-tabindex": "warn",
      "jsx-a11y/no-redundant-roles": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/role-has-required-aria-props": "warn",
      "jsx-a11y/role-supports-aria-props": "warn",
      "jsx-a11y/scope": "warn",
      "jsx-a11y/tabindex-no-positive": "warn",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      // The bundled v8 of @typescript-eslint/no-unused-expressions assumes
      // ESLint 9's flat-config schema and crashes when the project still uses
      // ESLint 8 ("Cannot read properties of undefined (reading
      // 'allowShortCircuit')"). Disable until we either bump the root eslint
      // pin to 9.x or downgrade the typescript-eslint plugin to 7.x.
      "@typescript-eslint/no-unused-expressions": "off",
      "react-hooks/exhaustive-deps": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // max-lines disabled — real-world codebases have files of varying lengths;
      // splitting only because of an arbitrary cap encourages premature
      // modularization. We rely on review + cohesion judgement instead.
      "max-lines": "off",
      "react/no-unescaped-entities": "warn",
      "no-restricted-imports": [
        "error",
        {
          paths: restrictedImports,
          patterns: [
            {
              group: ["@/lib/ui-kit", "@/lib/ui-kit/*"],
              message: "Migration complete. Use '@/components/ui/primitives' and '@/components/ui' instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // Local ESLint rule infrastructure: these files _implement_ + _test_ the
    // gacp/* rules. They legitimately use `require()` (the rules ship as
    // CommonJS) and embed raw-hex fixtures as input to the rule's own
    // RuleTester. Subjecting them to the rules they enforce is self-referential
    // noise that has been failing Frontend Lint Ratchet since the rule flipped
    // to error in PR #29.
    files: ["eslint-rules/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "gacp/no-raw-color": "off",
    },
  },
  {
    // Build-tool configs carrying the .cjs extension are CommonJS by
    // definition, so `require()` is the only way they can load a plugin —
    // `import` is a syntax error in a .cjs file. tailwind.config.cjs needs it
    // to register @tailwindcss/typography. Same reasoning as the
    // eslint-rules/**/*.js block above.
    files: ["*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // Standalone Node CLI scripts under playwright/ (e.g. the acceptance
    // evidence-capture walkthrough) legitimately print progress to stdout —
    // console output is their purpose, not app code. Scoped to .mjs so the
    // .spec.ts specs stay under the normal ratchet.
    files: ["playwright/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**", "public/sw.js"],
  },
];

export default eslintConfig;
