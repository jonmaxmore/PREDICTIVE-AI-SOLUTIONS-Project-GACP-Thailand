/**
 * gacp/no-raw-color — Phase A5 §4.3 enforcement rule (advisory).
 *
 * Flags raw hex colors in places that should use design tokens or
 * Tailwind palette classes. Three patterns are flagged:
 *
 *   1. Tailwind arbitrary-value class with hex:
 * className="bg-[#0b1f3a]"flagged
 * className="text-[#1e3a8a]"flagged
 * className="bg-blue-700"allowed (palette token)
 *
 *   2. Inline style with hex:
 * style={{ color:'#FFF'}} flagged
 * style={{ color:'rgb(255 0 0)'}} allowed (rgb is fine for now)
 *
 *   3. String literal hex inside JSX text content (rare, mostly seen in
 *      sample / fallback strings):
 * <span>#FF0000</span> flagged
 *
 * The rule is `warn` by default so it doesn't break the build during the
 * Phase A5 step-7 ratchet period. Once the warning count reaches 0 in
 * main, step 8 flips it to `error`.
 *
 * Exemptions handled by the rule itself (no need for // eslint-disable):
 *   - <meta name="theme-color" content="#1B5E20" />  — required by browsers
 *   - <svg fill="#xxx" stroke="#xxx" />               — decorative SVGs
 *
 * For everything else, prefer Tailwind palette classes (text-blue-700 etc)
 * or design-system tokens (var(--primary)).
 */

'use strict';

const HEX_PATTERN = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const HEX_PATTERN_GLOBAL = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

// Tailwind arbitrary-value class with hex inside square brackets, e.g.
// `bg-[#0b1f3a]` `text-[#1e3a8a]/50` `ring-[#fff]`.
const TW_ARBITRARY_HEX = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|caret|accent|placeholder|divide|shadow)-\[#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})(?:\/\d+)?\]/g;

// Attribute names where raw hex is legitimate (browser/framework requires).
// Reserved for future use (currently only EXEMPT_ELEMENTS is consulted).
const _EXEMPT_ATTRS = new Set([
  'content',   // <meta name="theme-color" content="#xxx" />
  'fill',      // SVG fill
  'stroke',    // SVG stroke
  'stopColor', // SVG gradient stops
  'floodColor',
  'lightingColor',
]);

// JSX element names where raw hex is legitimate (decorative SVG primitives).
const EXEMPT_ELEMENTS = new Set([
  'svg', 'path', 'rect', 'circle', 'line', 'polygon', 'polyline',
  'ellipse', 'stop', 'feFlood', 'feColorMatrix',
]);

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow raw hex colors in className / style / JSX text. ' +
        'Prefer Tailwind palette tokens or CSS variables.',
      category: 'Stylistic Issues',
      recommended: false,
    },
    schema: [],
    messages: {
      tailwindArbitrary:
        'Avoid raw hex in Tailwind arbitrary value `{{value}}`. Use a palette token (e.g. `bg-blue-700`) or extend `tailwind.config.js` with a named gov-* token.',
      inlineStyle:
        'Avoid raw hex `{{value}}` in inline style. Use a Tailwind palette class on `className` or a CSS variable.',
      jsxText:
        'Hex literal `{{value}}` rendered as visible text. Confirm intentional; otherwise use a palette token or a documented constant.',
    },
  },

  create(context) {
    // Helper reserved for future template-literal scanning.
    function _reportInString(node, raw, _getLocOffset) {
      // Pattern 1: Tailwind arbitrary-value class
      let match;
      while ((match = TW_ARBITRARY_HEX.exec(raw)) !== null) {
        context.report({
          node,
          messageId: 'tailwindArbitrary',
          data: { value: match[0] },
        });
      }
    }

    function reportHexInLiteral(node, raw) {
      // Generic hex anywhere in the string (only used for inline style values
      // and JSX text — caller controls which messageId).
      // CRITICAL: reset lastIndex on the shared global regex before exec —
      // otherwise stale state from a previous call makes exec resume mid-string
      // and miss matches.
      HEX_PATTERN_GLOBAL.lastIndex = 0;
      const match = HEX_PATTERN_GLOBAL.exec(raw);
      return match ? match[0] : null;
    }

    function getJsxAttrName(attrNode) {
      if (!attrNode || attrNode.type !== 'JSXAttribute') return null;
      const name = attrNode.name;
      if (!name) return null;
      if (name.type === 'JSXIdentifier') return name.name;
      if (name.type === 'JSXNamespacedName') return name.name?.name || null;
      return null;
    }

    function getEnclosingElementName(node) {
      let cur = node;
      while (cur && cur.type !== 'JSXOpeningElement') {
        cur = cur.parent;
      }
      if (!cur) return null;
      const name = cur.name;
      if (!name) return null;
      if (name.type === 'JSXIdentifier') return name.name;
      if (name.type === 'JSXMemberExpression') {
        let ref = name;
        while (ref.type === 'JSXMemberExpression') ref = ref.object;
        return ref.name;
      }
      return null;
    }

    return {
      // Plain string literals — covers className="..." attribute values
      Literal(node) {
        if (typeof node.value !== 'string') return;
        // Reset RegExp lastIndex (global regex)
        TW_ARBITRARY_HEX.lastIndex = 0;
        if (!TW_ARBITRARY_HEX.test(node.value)) return;
        TW_ARBITRARY_HEX.lastIndex = 0;
        let match;
        while ((match = TW_ARBITRARY_HEX.exec(node.value)) !== null) {
          context.report({
            node,
            messageId: 'tailwindArbitrary',
            data: { value: match[0] },
          });
        }
      },

      // Template literals (e.g. cn(`bg-[#xxx]`))
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          const raw = quasi.value.cooked;
          if (!raw) continue;
          TW_ARBITRARY_HEX.lastIndex = 0;
          let match;
          while ((match = TW_ARBITRARY_HEX.exec(raw)) !== null) {
            context.report({
              node,
              messageId: 'tailwindArbitrary',
              data: { value: match[0] },
            });
          }
        }
      },

      // Inline style: <div style={{ color: '#FFF' }} />
      JSXAttribute(node) {
        const attrName = getJsxAttrName(node);
        if (attrName !== 'style') return;
        const enclosingEl = getEnclosingElementName(node);
        if (enclosingEl && EXEMPT_ELEMENTS.has(enclosingEl)) return;
        const expr = node.value && node.value.expression;
        if (!expr || expr.type !== 'ObjectExpression') return;
        for (const prop of expr.properties) {
          if (prop.type !== 'Property') continue;
          const valueNode = prop.value;
          if (valueNode.type === 'Literal' && typeof valueNode.value === 'string') {
            const found = reportHexInLiteral(valueNode, valueNode.value);
            if (found) {
              context.report({
                node: valueNode,
                messageId: 'inlineStyle',
                data: { value: found },
              });
            }
          }
        }
      },

      // JSX attribute string values OTHER than className (e.g. <meta content="#xxx">)
      JSXText(node) {
        const txt = node.value;
        if (!txt || !HEX_PATTERN.test(txt)) return;
        // Trim — JSX whitespace
        const trimmed = txt.trim();
        if (!HEX_PATTERN.test(trimmed)) return;
        const enclosingEl = getEnclosingElementName(node);
        if (enclosingEl && EXEMPT_ELEMENTS.has(enclosingEl)) return;
        let match;
        HEX_PATTERN_GLOBAL.lastIndex = 0;
        while ((match = HEX_PATTERN_GLOBAL.exec(trimmed)) !== null) {
          context.report({
            node,
            messageId: 'jsxText',
            data: { value: match[0] },
          });
        }
      },
    };
  },
};
