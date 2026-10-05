/**
 * gacp/no-thai-letterspacing — Thai typography enforcement rule.
 *
 * Brand rule (see src/styles/globals.css): NEVER apply positive
 * letter-spacing to Thai text — it detaches leading vowels / sara /
 * วรรณยุกต์ from their base glyph. Additionally, `font-black` (900) is
 * banned: Sukhumvit Set tops out at 700/Bold (the 800 @font-face maps to
 * the Bold file), so 900 forces the browser to synthesize a heavier
 * weight and distorts Thai glyphs. Use `font-bold` and no tracking-*
 * utility on anything that renders Thai.
 *
 * What is flagged — a JSX element is reported when BOTH hold:
 *
 *   1. Its `className` contains (in a string literal or template-literal
 *      quasi, including literals passed to cn()/clsx()/cva()) one of the
 *      banned utilities: `tracking-wide`, `tracking-wider`,
 *      `tracking-widest`, `font-black`.
 *
 *   2. The SAME element's direct children contain Thai characters
 *      (the [\u0E00-\u0E7F] block) — either as literal JSX text:
 *          <h2 className="tracking-wider">ช่องทาง</h2>       flagged
 *      or as a Thai string literal inside a child expression (the common
 *      i18n-fallback shape):
 *          <p className="font-black">{dict?.x || 'รอการตรวจ'}</p>  flagged
 *
 * Deliberately conservative (zero false positives on Latin-only labels):
 *   - no type info, no cross-file analysis, no dictionary resolution —
 *     Thai that only arrives at runtime (e.g. {status.label}) is NOT
 *     flagged;
 *   - nested elements are checked independently — a wrapper whose Thai
 *     text lives inside a child <span> is not flagged (the child is,
 *     if it carries the bad utility itself);
 *   - negative tracking (tracking-tight / tracking-tighter) is allowed.
 */

'use strict';

// tracking-wide must not also match tracking-wider/-widest twice — the
// alternation is ordered longest-first and bounded by \b.
const BAD_UTILITY = /\b(?:tracking-(?:widest|wider|wide)|font-black)\b/;
const BAD_UTILITY_GLOBAL = new RegExp(BAD_UTILITY.source, 'g');
const THAI_CHAR = /[\u0E00-\u0E7F]/;

// How deep to walk child/className expressions. Keeps the rule cheap and
// conservative on pathological trees.
const MAX_DEPTH = 8;

function getJsxAttrName(attrNode) {
  if (!attrNode || attrNode.type !== 'JSXAttribute') return null;
  const name = attrNode.name;
  if (!name) return null;
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXNamespacedName') return name.name?.name || null;
  return null;
}

/**
 * Collect { node, text } string chunks reachable from a className value
 * expression: plain literals, template quasis, and literals inside the
 * usual composition shapes (cn()/clsx()/cva() calls, ternaries, `&&`,
 * arrays, clsx object keys). Anything else (identifiers, member
 * expressions…) is skipped — conservative by design.
 */
function collectClassNameChunks(node, out, depth) {
  if (!node || depth > MAX_DEPTH) return;
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string') out.push({ node, text: node.value });
      break;
    case 'TemplateLiteral':
      for (const quasi of node.quasis) {
        if (quasi.value.cooked) out.push({ node: quasi, text: quasi.value.cooked });
      }
      for (const expr of node.expressions) collectClassNameChunks(expr, out, depth + 1);
      break;
    case 'CallExpression':
      for (const arg of node.arguments) collectClassNameChunks(arg, out, depth + 1);
      break;
    case 'ConditionalExpression':
      collectClassNameChunks(node.consequent, out, depth + 1);
      collectClassNameChunks(node.alternate, out, depth + 1);
      break;
    case 'LogicalExpression':
    case 'BinaryExpression':
      collectClassNameChunks(node.left, out, depth + 1);
      collectClassNameChunks(node.right, out, depth + 1);
      break;
    case 'ArrayExpression':
      for (const el of node.elements) collectClassNameChunks(el, out, depth + 1);
      break;
    case 'ObjectExpression':
      // clsx object form: { 'some-class': cond } — the KEYS are classes.
      for (const prop of node.properties) {
        if (prop.type === 'Property') collectClassNameChunks(prop.key, out, depth + 1);
      }
      break;
    default:
      break;
  }
}

/**
 * Does this child expression contain a Thai string literal / template
 * quasi? Walks the i18n-fallback shapes (`dict?.x || 'ไทย'`, ternaries,
 * template literals, call arguments) but deliberately does NOT descend
 * into nested JSXElement/JSXFragment — those are audited as their own
 * elements.
 */
function expressionContainsThai(node, depth) {
  if (!node || depth > MAX_DEPTH) return false;
  switch (node.type) {
    case 'Literal':
      return typeof node.value === 'string' && THAI_CHAR.test(node.value);
    case 'TemplateLiteral':
      return (
        node.quasis.some((q) => q.value.cooked && THAI_CHAR.test(q.value.cooked)) ||
        node.expressions.some((e) => expressionContainsThai(e, depth + 1))
      );
    case 'LogicalExpression':
    case 'BinaryExpression':
      return (
        expressionContainsThai(node.left, depth + 1) ||
        expressionContainsThai(node.right, depth + 1)
      );
    case 'ConditionalExpression':
      return (
        expressionContainsThai(node.consequent, depth + 1) ||
        expressionContainsThai(node.alternate, depth + 1)
      );
    case 'CallExpression':
      return node.arguments.some((a) => expressionContainsThai(a, depth + 1));
    case 'ArrayExpression':
      return node.elements.some((e) => expressionContainsThai(e, depth + 1));
    case 'ChainExpression':
      return expressionContainsThai(node.expression, depth + 1);
    default:
      return false;
  }
}

function directChildrenContainThai(jsxElement) {
  for (const child of jsxElement.children || []) {
    if (child.type === 'JSXText' && THAI_CHAR.test(child.value)) return true;
    if (
      child.type === 'JSXExpressionContainer' &&
      expressionContainsThai(child.expression, 0)
    ) {
      return true;
    }
  }
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow positive letter-spacing utilities (tracking-wide/wider/widest) ' +
        'and font-black (synthesized 900) on JSX elements that render Thai text.',
      category: 'Stylistic Issues',
      recommended: false,
    },
    schema: [],
    messages: {
      thaiLetterspacing:
        '`{{utility}}` is applied to an element that renders Thai text. Positive ' +
        'letter-spacing detaches Thai leading vowels/tone marks — remove the ' +
        'tracking-* utility (brand rule, see src/styles/globals.css).',
      thaiFontBlack:
        '`font-black` (900) on Thai text forces a synthesized weight — Sukhumvit ' +
        'Set tops out at Bold. Use `font-bold` instead.',
    },
  },

  create(context) {
    // File-level fast path: a report needs a banned utility AND Thai text in
    // the same file. Two linear source scans skip all per-node work for the
    // overwhelming majority of files (standard core-rule pre-check pattern).
    const sourceText = context.sourceCode.text;
    if (!BAD_UTILITY.test(sourceText) || !THAI_CHAR.test(sourceText)) return {};

    return {
      JSXElement(node) {
        const opening = node.openingElement;
        if (!opening || opening.selfClosing) return;

        const classAttr = (opening.attributes || []).find((attr) => {
          const name = getJsxAttrName(attr);
          return name === 'className' || name === 'class';
        });
        if (!classAttr || !classAttr.value) return;

        const chunks = [];
        if (classAttr.value.type === 'Literal') {
          collectClassNameChunks(classAttr.value, chunks, 0);
        } else if (classAttr.value.type === 'JSXExpressionContainer') {
          collectClassNameChunks(classAttr.value.expression, chunks, 0);
        }
        if (chunks.length === 0) return;

        // Cheap pre-filter before walking children.
        if (!chunks.some((c) => BAD_UTILITY.test(c.text))) return;

        if (!directChildrenContainThai(node)) return;

        for (const chunk of chunks) {
          // Set dedupes to one report per utility per chunk.
          for (const utility of new Set(chunk.text.match(BAD_UTILITY_GLOBAL) ?? [])) {
            context.report({
              node: chunk.node,
              messageId: utility === 'font-black' ? 'thaiFontBlack' : 'thaiLetterspacing',
              data: { utility },
            });
          }
        }
      },
    };
  },
};
