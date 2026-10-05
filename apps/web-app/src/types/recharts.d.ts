/**
 * Ambient declaration shim for `recharts`.
 *
 * The workspace listed `recharts` in apps/web-app/package.json and resolved
 * it in pnpm-lock.yaml, but the local install (npm-based, no pnpm symlinks)
 * never materialised the package under apps/web-app/node_modules. Running
 * `pnpm install` is the proper fix and will replace this shim with the real
 * type defs from the `recharts` package. Until then, this shim unblocks
 * typecheck for components that only need the runtime shapes.
 *
 * Scope: keep this minimal and intentionally permissive — do not add new
 * type detail here; instead, install the dependency.
 */
declare module 'recharts' {
    import type { ComponentType, ReactNode } from 'react';
    // Use a permissive prop type so we don't have to enumerate every option.
    type AnyProps = Record<string, unknown> & { children?: ReactNode };

    export const LineChart: ComponentType<AnyProps>;
    export const Line: ComponentType<AnyProps>;
    export const BarChart: ComponentType<AnyProps>;
    export const Bar: ComponentType<AnyProps>;
    export const XAxis: ComponentType<AnyProps>;
    export const YAxis: ComponentType<AnyProps>;
    export const Tooltip: ComponentType<AnyProps>;
    export const Legend: ComponentType<AnyProps>;
    export const ResponsiveContainer: ComponentType<AnyProps>;
    export const CartesianGrid: ComponentType<AnyProps>;
    export const PieChart: ComponentType<AnyProps>;
    export const Pie: ComponentType<AnyProps>;
    export const Cell: ComponentType<AnyProps>;
    export const AreaChart: ComponentType<AnyProps>;
    export const Area: ComponentType<AnyProps>;
    export const RadialBarChart: ComponentType<AnyProps>;
    export const RadialBar: ComponentType<AnyProps>;
    export const ScatterChart: ComponentType<AnyProps>;
    export const Scatter: ComponentType<AnyProps>;
}
