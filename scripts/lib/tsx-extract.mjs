// Generic TSX-AST -> Markdown prose extractor.
//
// This site's substantive content (blog posts, /about, /privacy-policy,
// /take-homes/weave, /spearfishing/fireworks-ai) is 100% hardcoded JSX, not
// CMS/markdown. To mirror it faithfully without hand-copying (which drifts),
// this module statically interprets each page's TSX: it resolves local
// helper components (P, Lead, Strong, SectionTitle, Callout, ...) by inlining
// their JSX, evaluates literal data (local const arrays/objects, imported
// .json files) that gets rendered via `.map()`, and formats the result as
// Markdown. Anything it cannot statically resolve (React state, hooks,
// imported UI widgets/icons) is safely dropped rather than guessed at, so
// nothing fabricated ever ends up in the output.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const UNRESOLVED = Symbol('unresolved');

// Plain-value JS built-ins the source calls to format a number/string for
// display (Math.round(score), String(value), ...). Anything not listed
// here stays UNRESOLVED rather than being guessed at.
const GLOBAL_FNS = { String, Number, Boolean };
const MATH_FNS = { round: Math.round, floor: Math.floor, ceil: Math.ceil, min: Math.min, max: Math.max, abs: Math.abs, pow: Math.pow, sqrt: Math.sqrt };
const NUMBER_STRING_METHODS = new Set(['toLocaleString', 'toFixed', 'toString', 'toUpperCase', 'toLowerCase', 'trim']);

// Silent content loss is worse than the documented "unresolved -> nothing"
// rule: that rule is for content we genuinely cannot know (runtime state,
// a fetch result). It must never cover content that WAS resolved (real
// children text/elements were passed in) and then vanished because of an
// engine bug — e.g. a <ul> filtering its children for <li> elements after
// they'd already been flattened to an opaque string one level up. Every
// component call whose children carried real text but whose rendered
// output came back empty is recorded here and surfaced loudly by the
// caller (see getDropWarnings / resetDropWarnings), instead of shipping
// silently truncated markdown.
let dropWarnings = [];
export function resetDropWarnings() { dropWarnings = []; }
export function getDropWarnings() { return dropWarnings; }
function recordDropWarning(componentName, lostText, file) {
  dropWarnings.push({ componentName, file, snippet: lostText.slice(0, 120) });
}

const BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'blockquote', 'pre',
  'div', 'section', 'article', 'header', 'footer', 'main', 'figure', 'table',
]);
const INLINE_FORMAT = {
  strong: (t) => `**${t}**`, b: (t) => `**${t}**`,
  em: (t) => `*${t}*`, i: (t) => `*${t}*`,
  code: (t) => `\`${t}\``,
  mark: (t) => `**${t}**`,
};
const PASSTHROUGH_INLINE = new Set(['span', 'small', 'sup', 'sub', 'label', 'time']);

// ---------- file cache ----------
const fileCache = new Map(); // absPath -> { sf, text, componentDefs: Map<name, node>, dataScope: Map<name, value>, imports: Map<name, {source, imported}> }

function loadFile(absPath) {
  if (fileCache.has(absPath)) return fileCache.get(absPath);
  const text = fs.readFileSync(absPath, 'utf8');
  const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const entry = { sf, text, componentDefs: new Map(), dataScope: new Map(), imports: new Map(), dir: path.dirname(absPath) };
  fileCache.set(absPath, entry);
  collectTopLevel(entry);
  return entry;
}

function collectTopLevel(entry) {
  const { sf } = entry;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const modSpec = stmt.moduleSpecifier.text;
      const clause = stmt.importClause;
      if (clause.name) registerImport(entry, clause.name.text, modSpec, 'default');
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          registerImport(entry, el.name.text, modSpec, (el.propertyName ?? el.name).text);
        }
      }
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const name = decl.name.text;
        const init = decl.initializer;
        if (isComponentLike(init)) {
          entry.componentDefs.set(name, init);
        } else {
          const val = evalExpr(init, moduleScope(entry));
          if (val !== UNRESOLVED) entry.dataScope.set(name, val);
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      entry.componentDefs.set(stmt.name.text, stmt);
    }
  }
}

function registerImport(entry, localName, modSpec, importedName) {
  if (modSpec.startsWith('.')) {
    let resolved = path.resolve(entry.dir, modSpec);
    if (!fs.existsSync(resolved)) {
      for (const ext of ['.tsx', '.ts', '.json']) {
        if (fs.existsSync(resolved + ext)) { resolved += ext; break; }
      }
    }
    entry.imports.set(localName, { resolved, importedName, external: false });
    if (resolved.endsWith('.json') && fs.existsSync(resolved)) {
      try { entry.dataScope.set(localName, JSON.parse(fs.readFileSync(resolved, 'utf8'))); } catch { /* ignore */ }
    }
  } else {
    entry.imports.set(localName, { source: modSpec, importedName, external: true });
  }
}

function isComponentLike(init) {
  // Arrow/function expressions whose body looks like it returns JSX are components.
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
    const body = init.body;
    if (isJsxNode(unwrapParens(body))) return true;
    if (ts.isBlock(body)) {
      return findReturnJsx(body) !== null || bodyHasHook(body);
    }
  }
  return false;
}

function isJsxNode(node) {
  return node && (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node));
}

function unwrapParens(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isTypeAssertionExpression?.(node))) {
    node = node.expression;
  }
  return node;
}

function findReturnJsx(block) {
  let found = null;
  let count = 0;
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node !== block.parent) return; // don't descend into nested functions
    if (ts.isReturnStatement(node)) {
      count++;
      const arg = node.expression ? unwrapParens(node.expression) : null;
      if (isJsxNode(arg)) found = arg;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return count === 1 ? found : (count === 0 ? null : (found ?? 'multi'));
}

function bodyHasHook(block) {
  let has = false;
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const n = node.expression.text;
      if (n === 'useState' || n === 'useReducer') has = true;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(block, visit);
  return has;
}

// ---------- scope ----------
// A Scope is a simple chain: { vars: Map, parent }
function newScope(parent) { return { vars: new Map(), parent: parent ?? null }; }
function scopeGet(scope, name) {
  let s = scope;
  while (s) { if (s.vars.has(name)) return s.vars.get(name); s = s.parent; }
  return UNRESOLVED;
}
function scopeSet(scope, name, val) { scope.vars.set(name, val); }
function moduleScope(entry) {
  // Backed directly by entry.dataScope (not a snapshot copy) so declarations
  // added to it later in file order — collectTopLevel evaluates top-level
  // consts in source order, and later ones may reference earlier ones — are
  // visible to every scope chain rooted here, including ones already handed out.
  if (entry._moduleScope) return entry._moduleScope;
  entry._moduleScope = { vars: entry.dataScope, parent: null };
  return entry._moduleScope;
}

// ---------- literal expression evaluator ----------
function evalExpr(node, scope) {
  try {
    return evalExprInner(node, scope);
  } catch {
    return UNRESOLVED;
  }
}

function evalExprInner(node, scope) {
  if (!node) return UNRESOLVED;
  node = unwrapParens(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      const v = evalExpr(span.expression, scope);
      if (v === UNRESOLVED) return UNRESOLVED;
      out += String(v) + span.literal.text;
    }
    return out;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined') return undefined;
    return scopeGet(scope, node.text);
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    // A "render prop" (e.g. <Carousel renderItem={(p) => <Card project={p}/>} />)
    // is kept as a callable descriptor, closing over the scope where it was
    // written, so a later `renderItem(item)` call site can actually invoke it
    // and recover the real JSX instead of going unresolved.
    return { __isFn: true, node, closureScope: scope };
  }
  if (ts.isPropertyAccessExpression(node)) {
    const obj = evalExpr(node.expression, scope);
    if (obj === UNRESOLVED || obj === null || obj === undefined) return UNRESOLVED;
    const v = obj[node.name.text];
    return v === undefined ? UNRESOLVED : v;
  }
  if (ts.isElementAccessExpression(node)) {
    const obj = evalExpr(node.expression, scope);
    const idx = evalExpr(node.argumentExpression, scope);
    if (obj === UNRESOLVED || idx === UNRESOLVED || obj == null) return UNRESOLVED;
    const v = obj[idx];
    return v === undefined ? UNRESOLVED : v;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out = {};
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        const key = propName(prop.name);
        out[key] = evalExpr(prop.initializer, scope);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        out[prop.name.text] = scopeGet(scope, prop.name.text);
      } else if (ts.isSpreadAssignment(prop)) {
        const v = evalExpr(prop.expression, scope);
        if (v && typeof v === 'object') Object.assign(out, v);
      }
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const out = [];
    for (const el of node.elements) {
      if (ts.isSpreadElement(el)) {
        const v = evalExpr(el.expression, scope);
        if (Array.isArray(v)) out.push(...v);
      } else {
        out.push(evalExpr(el, scope));
      }
    }
    return out;
  }
  if (ts.isConditionalExpression(node)) {
    const cond = evalExpr(node.condition, scope);
    if (cond === UNRESOLVED) return UNRESOLVED;
    return cond ? evalExpr(node.whenTrue, scope) : evalExpr(node.whenFalse, scope);
  }
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken) {
      const l = evalExpr(node.left, scope);
      return (l === UNRESOLVED || l === null || l === undefined) ? evalExpr(node.right, scope) : l;
    }
    if (op === ts.SyntaxKind.BarBarToken) {
      const l = evalExpr(node.left, scope);
      return (l === UNRESOLVED || !l) ? evalExpr(node.right, scope) : l;
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const l = evalExpr(node.left, scope);
      if (l === UNRESOLVED) return UNRESOLVED;
      return l ? evalExpr(node.right, scope) : l;
    }
    const ARITH = {
      [ts.SyntaxKind.PlusToken]: (a, b) => a + b,
      [ts.SyntaxKind.MinusToken]: (a, b) => a - b,
      [ts.SyntaxKind.AsteriskToken]: (a, b) => a * b,
      [ts.SyntaxKind.SlashToken]: (a, b) => a / b,
      [ts.SyntaxKind.PercentToken]: (a, b) => a % b,
      [ts.SyntaxKind.LessThanToken]: (a, b) => a < b,
      [ts.SyntaxKind.GreaterThanToken]: (a, b) => a > b,
      [ts.SyntaxKind.LessThanEqualsToken]: (a, b) => a <= b,
      [ts.SyntaxKind.GreaterThanEqualsToken]: (a, b) => a >= b,
      [ts.SyntaxKind.EqualsEqualsToken]: (a, b) => a == b,
      [ts.SyntaxKind.EqualsEqualsEqualsToken]: (a, b) => a === b,
      [ts.SyntaxKind.ExclamationEqualsToken]: (a, b) => a != b,
      [ts.SyntaxKind.ExclamationEqualsEqualsToken]: (a, b) => a !== b,
    };
    if (ARITH[op]) {
      const l = evalExpr(node.left, scope), r = evalExpr(node.right, scope);
      if (l === UNRESOLVED || r === UNRESOLVED) return UNRESOLVED;
      return ARITH[op](l, r);
    }
    return UNRESOLVED;
  }
  if (ts.isPrefixUnaryExpression(node)) {
    const v = evalExpr(node.operand, scope);
    if (v === UNRESOLVED) return UNRESOLVED;
    if (node.operator === ts.SyntaxKind.ExclamationToken) return !v;
    if (node.operator === ts.SyntaxKind.MinusToken) return -v;
    if (node.operator === ts.SyntaxKind.PlusToken) return +v;
  }
  if (ts.isCallExpression(node)) {
    // A callable value bound anywhere reachable by evaluating the callee
    // expression — a bare name (renderItem(x)) or a dotted lookup on a
    // resolved object (meta.keyMetrics(m), where meta.keyMetrics is itself
    // an arrow function stored in a local const object literal) — gets
    // invoked for real rather than left unresolved just because the call
    // isn't a plain identifier call.
    if (ts.isIdentifier(node.expression) || ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression)) {
      const fnVal = evalExpr(node.expression, scope);
      if (fnVal && fnVal.__isFn) {
        const args = node.arguments.map((a) => evalExpr(a, scope));
        return invokeFnLiteral(fnVal, args);
      }
    }
    // JS built-ins commonly used to format a value for display.
    if (ts.isIdentifier(node.expression) && GLOBAL_FNS[node.expression.text] && scopeGet(scope, node.expression.text) === UNRESOLVED) {
      const args = node.arguments.map((a) => evalExpr(a, scope));
      if (args.some((a) => a === UNRESOLVED)) return UNRESOLVED;
      try { return GLOBAL_FNS[node.expression.text](...args); } catch { return UNRESOLVED; }
    }
    if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Math' && MATH_FNS[node.expression.name.text]) {
      const args = node.arguments.map((a) => evalExpr(a, scope));
      if (args.some((a) => a === UNRESOLVED)) return UNRESOLVED;
      try { return MATH_FNS[node.expression.name.text](...args); } catch { return UNRESOLVED; }
    }
    // Chained number/string formatting, e.g. Math.round(x).toLocaleString().
    if (ts.isPropertyAccessExpression(node.expression) && NUMBER_STRING_METHODS.has(node.expression.name.text)) {
      const receiver = evalExpr(node.expression.expression, scope);
      if ((typeof receiver === 'number' || typeof receiver === 'string') && typeof receiver[node.expression.name.text] === 'function') {
        const args = node.arguments.map((a) => evalExpr(a, scope));
        if (args.some((a) => a === UNRESOLVED)) return UNRESOLVED;
        try { return receiver[node.expression.name.text](...args); } catch { return UNRESOLVED; }
      }
    }
    // Object.entries / Object.keys / Object.values
    if (ts.isPropertyAccessExpression(node.expression)) {
      const obj = node.expression.expression;
      const meth = node.expression.name.text;
      if (ts.isIdentifier(obj) && obj.text === 'Object' && node.arguments.length === 1) {
        const target = evalExpr(node.arguments[0], scope);
        if (target === UNRESOLVED) return UNRESOLVED;
        if (meth === 'entries') return Object.entries(target);
        if (meth === 'keys') return Object.keys(target);
        if (meth === 'values') return Object.values(target);
      }
      // array.map/filter/slice on resolvable arrays with simple arrow bodies (non-JSX)
      const arr = evalExpr(node.expression.expression, scope);
      if (Array.isArray(arr)) {
        const cb = node.arguments[0];
        if (meth === 'slice') {
          const a = node.arguments[0] ? evalExpr(node.arguments[0], scope) : undefined;
          const b = node.arguments[1] ? evalExpr(node.arguments[1], scope) : undefined;
          return arr.slice(a, b);
        }
        if (meth === 'filter' && cb && ts.isIdentifier(cb) && cb.text === 'Boolean') {
          return arr.filter(Boolean);
        }
        if (cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) {
          if (meth === 'map') {
            return arr.map((item, i) => callFnLiteral(cb, [item, i], scope));
          }
          if (meth === 'filter') {
            return arr.filter((item, i) => callFnLiteral(cb, [item, i], scope));
          }
        }
      }
    }
  }
  return UNRESOLVED;
}

function propName(nameNode) {
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteral(nameNode)) return nameNode.text;
  if (ts.isComputedPropertyName(nameNode)) return String(evalExpr(nameNode.expression, moduleScope({ dataScope: new Map() })));
  return nameNode.getText();
}

function callFnLiteral(fn, args, scope) {
  const s = newScope(scope);
  bindParams(fn.parameters, args, s);
  let body = fn.body;
  if (ts.isBlock(body)) {
    // best effort: find single return
    const ret = findReturnJsx(body);
    return UNRESOLVED; // non-JSX block bodies with logic: not supported, treat unresolved
  }
  return evalExpr(body, s);
}

// Invoke a captured render-prop/callback value (see the ArrowFunction case in
// evalExprInner) for a plain (non-JSX) result, closing over where it was defined.
function invokeFnLiteral(fnVal, argValues) {
  const s = newScope(fnVal.closureScope);
  bindParams(fnVal.node.parameters, argValues, s);
  const body = fnVal.node.body;
  if (ts.isBlock(body)) return UNRESOLVED;
  return evalExpr(unwrapParens(body), s);
}

function bindParams(params, args, scope) {
  params.forEach((p, i) => {
    const val = args[i];
    if (ts.isIdentifier(p.name)) {
      scopeSet(scope, p.name.text, val === undefined && p.initializer ? evalExpr(p.initializer, scope) : val);
    } else if (ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const key = el.propertyName ? propName(el.propertyName) : el.name.text;
        let v = (val && typeof val === 'object') ? val[key] : undefined;
        if (v === undefined && el.initializer) v = evalExpr(el.initializer, scope);
        scopeSet(scope, el.name.text, v === undefined ? UNRESOLVED : v);
      }
    } else if (ts.isArrayBindingPattern(p.name)) {
      // e.g. const [key, value] = entry
      p.name.elements.forEach((el, idx) => {
        if (ts.isOmittedExpression(el) || !ts.isIdentifier(el.name)) return;
        const v = Array.isArray(val) ? val[idx] : UNRESOLVED;
        scopeSet(scope, el.name.text, v);
      });
    }
  });
}

// ---------- markdown rendering ----------
function textJoin(parts) { return parts.join(''); }

// JsxText nodes carry literal HTML entities verbatim (e.g. authors writing
// `${API_KEY}` as `$&#123;API_KEY&#125;` to dodge JSX's `{}` interpolation).
// Decode the common ones so the real characters survive into markdown.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body] ?? m;
  });
}

function normalizeInline(s) {
  return s.replace(/\s+/g, ' ').trim();
}


// A component's `children` prop is kept as a lazy, structured node list —
// not a pre-flattened string — so a callee that inspects its children's
// *structure* (e.g. <ul> filtering for <li> elements to build a markdown
// list) still sees real elements when it renders `{children}`, instead of
// one opaque string that gets discarded by that structural filter. Legacy
// call sites that coerce it (String(x), template interpolation) still get
// a sane flattened fallback via toString().
function makeNodeList(items) {
  return {
    __isNodeList: true,
    items,
    toString() {
      return items.map((it) => (it.kind === 'text' ? it.value : render(it.node, it.scope))).join('');
    },
  };
}

function block(s) {
  const t = s.trim();
  return t ? `\n\n${t}\n\n` : '';
}

// Renders a JSX node (element/fragment) to markdown text given a scope.
function render(node, scope, ctx = {}) {
  try {
    return renderInner(node, scope, ctx);
  } catch (e) {
    if (process.env.TSX_DEBUG) console.error('render error:', e.stack || e);
    return '';
  }
}

function renderInner(node, scope, ctx) {
  if (ts.isJsxFragment(node)) {
    return renderChildrenGeneric(node.children, scope, ctx);
  }
  const isSelfClosing = ts.isJsxSelfClosingElement(node);
  const tagNameNode = isSelfClosing ? node.tagName : node.openingElement.tagName;
  const attrs = isSelfClosing ? node.attributes : node.openingElement.attributes;
  const children = isSelfClosing ? [] : node.children;

  const tagInfo = resolveTag(tagNameNode, scope, ctx);

  if (tagInfo.kind === 'html') {
    const name = tagInfo.name;
    if (name === 'br') return ' ';
    if (name === 'style' || name === 'script' || name === 'svg' || name === 'path') return '';
    if (name === 'a') {
      const href = getAttrLiteral(attrs, 'href', scope) ?? getAttrLiteral(attrs, 'to', scope);
      const inner = normalizeInline(renderChildrenGeneric(children, scope, ctx));
      if (!inner) return '';
      return typeof href === 'string' ? `[${inner}](${href})` : inner;
    }
    if (name === 'img') return '';
    if (INLINE_FORMAT[name]) {
      const inner = normalizeInline(renderChildrenGeneric(children, scope, ctx));
      return inner ? INLINE_FORMAT[name](inner) : '';
    }
    if (PASSTHROUGH_INLINE.has(name)) {
      return renderChildrenGeneric(children, scope, ctx);
    }
    if (name === 'pre') {
      const raw = rawText(children, scope);
      const t = raw.trim();
      return t ? block('```\n' + t + '\n```') : '';
    }
    if (/^h[1-6]$/.test(name)) {
      const inner = normalizeInline(renderChildrenGeneric(children, scope, ctx));
      return inner ? block('#'.repeat(Number(name[1])) + ' ' + inner) : '';
    }
    if (name === 'p') {
      const inner = normalizeInline(renderChildrenGeneric(children, scope, ctx));
      return inner ? block(inner) : '';
    }
    if (name === 'blockquote') {
      const inner = renderChildrenGeneric(children, scope, ctx).trim();
      if (!inner) return '';
      const quoted = inner.split('\n').map((l) => '> ' + l).join('\n');
      return block(quoted);
    }
    if (name === 'ul' || name === 'ol') {
      const items = expand(children, scope, ctx).filter((it) => it.kind === 'el');
      const lines = [];
      let i = 0;
      for (const it of items) {
        const tn = resolveTag(getTagNameNode(it.node), it.scope, ctx);
        const isLi = tn.kind === 'html' && tn.name === 'li';
        const innerNodes = ts.isJsxSelfClosingElement(it.node) ? [] : it.node.children;
        const text = normalizeInline(renderChildrenGeneric(innerNodes, it.scope, ctx));
        if (!text) continue;
        if (isLi) {
          i++;
          lines.push(name === 'ol' ? `${i}. ${text}` : `- ${text}`);
        }
      }
      return lines.length ? block(lines.join('\n')) : '';
    }
    if (name === 'li') {
      // stray li not inside ul/ol handling path
      const inner = normalizeInline(renderChildrenGeneric(children, scope, ctx));
      return inner ? `- ${inner}\n` : '';
    }
    if (name === 'table') {
      const rows = collectTableRows(children, scope, ctx);
      if (!rows.length) return '';
      const parsed = rows.map((r) => collectRowCells(r, ctx));
      const headerIdx = parsed.findIndex((r) => r.isHeader);
      const header = headerIdx !== -1 ? parsed[headerIdx].cells : parsed[0].cells;
      const bodyRows = parsed
        .filter((_, i) => i !== (headerIdx !== -1 ? headerIdx : 0))
        .map((r) => r.cells)
        .filter((cells) => cells.some((c) => c));
      const colCount = Math.max(header.length, ...parsed.map((r) => r.cells.length), 1);
      const pad = (arr) => {
        const a = arr.slice(0, colCount);
        while (a.length < colCount) a.push('');
        return a;
      };
      const esc = (s) => (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const lines = [
        '| ' + pad(header).map(esc).join(' | ') + ' |',
        '| ' + pad(header).map(() => '---').join(' | ') + ' |',
        ...bodyRows.map((row) => '| ' + pad(row).map(esc).join(' | ') + ' |'),
      ];
      return block(lines.join('\n'));
    }
    // generic block container: div/section/article/header/footer/main/figure
    return renderChildrenGeneric(children, scope, ctx);
  }

  if (tagInfo.kind === 'link') {
    const inner = normalizeInline(renderChildrenGeneric(children, scope, ctx));
    if (!inner) return '';
    const href = getAttrLiteral(attrs, 'to', scope);
    return typeof href === 'string' ? `[${inner}](${href})` : inner;
  }

  if (tagInfo.kind === 'component') {
    const childrenValue = makeNodeList(expand(children, scope, ctx));
    const calleeScope = newScope(moduleScope(tagInfo.entry));
    bindComponentProps(tagInfo.params, attrs, scope, calleeScope, childrenValue, ctx);
    fillLocalConsts(tagInfo.bodyBlock, calleeScope);
    const returnNode = tagInfo.returnNode;
    if (!returnNode || returnNode === 'multi') return '';
    const output = render(returnNode, calleeScope, { ...ctx, entry: tagInfo.entry });
    const childrenPreview = childrenValue.toString().trim();
    if (childrenPreview.length > 3 && output.trim().length === 0) {
      recordDropWarning(tagInfo.name, childrenPreview, ctx.entry && ctx.entry.sf.fileName);
    }
    return output;
  }

  // passthrough (unresolved import, unknown component)
  return renderChildrenGeneric(children, scope, ctx);
}

function getTagNameNode(node) {
  return ts.isJsxSelfClosingElement(node) ? node.tagName : node.openingElement.tagName;
}

// Walks table children (possibly through <thead>/<tbody>/<tfoot> wrappers) to
// find the real <tr> rows in document order, so a table renders as a real
// markdown table instead of every header/cell run together on one line.
function collectTableRows(childrenNodes, scope, ctx) {
  const rows = [];
  const items = expand(childrenNodes, scope, ctx).filter((it) => it.kind === 'el');
  for (const it of items) {
    const tn = resolveTag(getTagNameNode(it.node), it.scope, ctx);
    if (tn.kind !== 'html') continue;
    if (tn.name === 'tr') {
      rows.push(it);
    } else if (tn.name === 'thead' || tn.name === 'tbody' || tn.name === 'tfoot') {
      const inner = ts.isJsxSelfClosingElement(it.node) ? [] : it.node.children;
      rows.push(...collectTableRows(inner, it.scope, ctx));
    }
  }
  return rows;
}

function collectRowCells(rowItem, ctx) {
  const innerChildren = ts.isJsxSelfClosingElement(rowItem.node) ? [] : rowItem.node.children;
  const items = expand(innerChildren, rowItem.scope, ctx).filter((it) => it.kind === 'el');
  const cells = [];
  let isHeader = false;
  for (const it of items) {
    const tn = resolveTag(getTagNameNode(it.node), it.scope, ctx);
    if (tn.kind !== 'html' || (tn.name !== 'td' && tn.name !== 'th')) continue;
    if (tn.name === 'th') isHeader = true;
    const cellChildren = ts.isJsxSelfClosingElement(it.node) ? [] : it.node.children;
    cells.push(normalizeInline(renderChildrenGeneric(cellChildren, it.scope, ctx)));
  }
  return { cells, isHeader };
}

function rawText(children, scope) {
  let out = '';
  for (const c of children) {
    if (ts.isJsxText(c)) out += decodeEntities(c.text);
    else if (ts.isJsxExpression(c) && c.expression) {
      const v = evalExpr(c.expression, scope);
      if (v !== UNRESOLVED && (typeof v === 'string' || typeof v === 'number' || (v && v.__isNodeList))) out += String(v);
    } else if (isJsxNode(c)) {
      out += render(c, scope);
    }
  }
  return out;
}

function getAttrLiteral(attrs, name, scope) {
  for (const attr of attrs.properties) {
    if (!ts.isJsxAttribute(attr)) continue;
    if (attr.name.getText() !== name) continue;
    if (!attr.initializer) return true;
    if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
    if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
      const v = evalExpr(attr.initializer.expression, scope);
      return v === UNRESOLVED ? undefined : v;
    }
  }
  return undefined;
}

function bindComponentProps(params, attrs, callerScope, calleeScope, childrenValue, ctx) {
  const propsObj = {};
  if (attrs) {
    for (const attr of attrs.properties) {
      if (!ts.isJsxAttribute(attr)) continue;
      const name = attr.name.getText();
      let val = true;
      if (attr.initializer) {
        if (ts.isStringLiteral(attr.initializer)) val = attr.initializer.text;
        else if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
          val = evalExpr(attr.initializer.expression, callerScope);
        }
      }
      propsObj[name] = val;
    }
  }
  propsObj.children = childrenValue;
  if (!params || params.length === 0) return;
  const p = params[0];
  if (ts.isIdentifier(p.name)) {
    scopeSet(calleeScope, p.name.text, propsObj);
  } else if (ts.isObjectBindingPattern(p.name)) {
    for (const el of p.name.elements) {
      if (!ts.isIdentifier(el.name)) continue;
      const key = el.propertyName ? propName(el.propertyName) : el.name.text;
      let v = propsObj[key];
      if ((v === undefined || v === UNRESOLVED) && el.initializer) v = evalExpr(el.initializer, calleeScope);
      scopeSet(calleeScope, el.name.text, v === undefined ? UNRESOLVED : v);
    }
  }
}

function fillLocalConsts(bodyBlock, scope) {
  if (!bodyBlock || !ts.isBlock(bodyBlock)) return;
  for (const stmt of bodyBlock.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!decl.initializer) continue;
      if (ts.isIdentifier(decl.name)) {
        const v = evalExpr(decl.initializer, scope);
        if (v !== UNRESOLVED) scopeSet(scope, decl.name.text, v);
      } else if (ts.isArrayBindingPattern(decl.name)) {
        // const [x, setX] = useState(initial) — bind x to the real initial
        // value React would render on first mount. This is the page's actual
        // default rendered state, not a guess: it's the literal argument the
        // author passed to useState.
        const init = decl.initializer;
        if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'useState') {
          const first = decl.name.elements[0];
          if (first && !ts.isOmittedExpression(first) && ts.isIdentifier(first.name)) {
            const v = init.arguments[0] ? evalExpr(init.arguments[0], scope) : undefined;
            scopeSet(scope, first.name.text, v === undefined ? UNRESOLVED : v);
          }
        }
      }
    }
  }
}

function resolveTag(tagNameNode, scope, ctx) {
  // dotted tags like motion.div, motion.section -> treat as underlying html tag
  if (ts.isPropertyAccessExpression(tagNameNode)) {
    return { kind: 'html', name: tagNameNode.name.text.toLowerCase() };
  }
  const name = tagNameNode.getText();
  if (/^[a-z]/.test(name)) return { kind: 'html', name };

  // react-router-dom Link special case
  const entry = ctx.entry;
  if (name === 'Link' && entry) {
    const imp = entry.imports.get('Link');
    if (imp && imp.external && imp.source === 'react-router-dom') {
      return { kind: 'link', href: undefined }; // href resolved by caller via attrs; simplified below
    }
  }
  if (name === 'Fragment') return { kind: 'html', name: 'fragment-passthrough', passthrough: true };

  if (entry) {
    if (entry.componentDefs.has(name)) {
      return buildComponentTagInfo(entry, name);
    }
    const imp = entry.imports.get(name);
    if (imp && !imp.external && imp.resolved && /\.(tsx|ts)$/.test(imp.resolved) && fs.existsSync(imp.resolved)) {
      const otherEntry = loadFile(imp.resolved);
      const exportName = imp.importedName === 'default' ? findDefaultExportName(otherEntry) : imp.importedName;
      if (exportName && otherEntry.componentDefs.has(exportName)) {
        return buildComponentTagInfo(otherEntry, exportName);
      }
    }
  }
  return { kind: 'passthrough' };
}

function findDefaultExportName(entry) {
  for (const stmt of entry.sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals && ts.isIdentifier(stmt.expression)) {
      return stmt.expression.text;
    }
  }
  // fallback: single component def
  if (entry.componentDefs.size === 1) return [...entry.componentDefs.keys()][0];
  return null;
}

function buildComponentTagInfo(entry, name) {
  const def = entry.componentDefs.get(name);
  const fn = def;
  const params = fn.parameters;
  let bodyBlock = null, returnNode = null;
  const body = fn.body;
  if (ts.isBlock(body)) {
    bodyBlock = body;
    // useState/useReducer initial values are bound as real data by
    // fillLocalConsts, so a component using hooks still renders its true
    // first-paint output (e.g. a click-to-advance diagram shows frame 0)
    // rather than being blanket-skipped. Content gated on state we truly
    // cannot know (an async fetch result, an event handler's side effect)
    // stays unresolved and is dropped by the same rule as everywhere else.
    returnNode = findReturnJsx(body);
  } else {
    const expr = unwrapParens(body);
    returnNode = isJsxNode(expr) ? expr : null;
  }
  return { kind: 'component', entry, params, bodyBlock, returnNode, name };
}

// expand(): flatten a JSX children list into {kind:'text',value} | {kind:'el', node, scope} items,
// resolving `.map()` calls, `&&`/ternary gates, and array literals of JSX.
function expand(children, scope, ctx) {
  const out = [];
  for (const c of children) {
    if (ts.isJsxText(c)) {
      if (c.text.trim()) out.push({ kind: 'text', value: decodeEntities(c.text) });
      continue;
    }
    if (isJsxNode(c)) {
      out.push({ kind: 'el', node: c, scope });
      continue;
    }
    if (ts.isJsxExpression(c) && c.expression) {
      out.push(...expandExpr(c.expression, scope, ctx));
    }
  }
  return out;
}

function expandExpr(expr, scope, ctx) {
  expr = unwrapParens(expr);
  if (isJsxNode(expr)) return [{ kind: 'el', node: expr, scope }];
  if (ts.isJsxFragment(expr)) return expand(expr.children, scope, ctx);
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const cond = evalExpr(expr.left, scope);
      if (cond === UNRESOLVED || !cond) return [];
      return expandExpr(expr.right, scope, ctx);
    }
  }
  if (ts.isConditionalExpression(expr)) {
    const cond = evalExpr(expr.condition, scope);
    if (cond === UNRESOLVED) return [];
    return expandExpr(cond ? expr.whenTrue : expr.whenFalse, scope, ctx);
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const out = [];
    for (const el of expr.elements) out.push(...expandExpr(el, scope, ctx));
    return out;
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    const fnVal = evalExpr(expr.expression, scope);
    if (fnVal && fnVal.__isFn) {
      const argValues = expr.arguments.map((a) => evalExpr(a, scope));
      const s = newScope(fnVal.closureScope);
      bindParams(fnVal.node.parameters, argValues, s);
      let bodyExpr;
      if (ts.isBlock(fnVal.node.body)) {
        const rj = findReturnJsx(fnVal.node.body);
        bodyExpr = rj === 'multi' ? null : rj;
      } else {
        bodyExpr = unwrapParens(fnVal.node.body);
      }
      return bodyExpr ? expandExpr(bodyExpr, s, ctx) : [];
    }
  }
  if (ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === 'map') {
    const arrExpr = expr.expression.expression;
    let arr = evalExpr(arrExpr, scope);
    if (arr === UNRESOLVED) return [];
    if (!Array.isArray(arr)) return [];
    const cb = expr.arguments[0];
    if (!cb || !(ts.isArrowFunction(cb) || ts.isFunctionExpression(cb))) return [];
    const out = [];
    arr.forEach((item, i) => {
      const s = newScope(scope);
      bindParams(cb.parameters, [item, i], s);
      let bodyExpr;
      if (ts.isBlock(cb.body)) {
        const rj = findReturnJsx(cb.body);
        bodyExpr = rj === 'multi' ? null : rj;
      } else {
        bodyExpr = unwrapParens(cb.body);
      }
      if (bodyExpr) out.push(...expandExpr(bodyExpr, s, ctx));
    });
    return out;
  }
  // plain literal/text-producing expression
  const v = evalExpr(expr, scope);
  if (v === UNRESOLVED || v === null || v === undefined) return [];
  if (v && v.__isNodeList) return v.items;
  if (typeof v === 'string' || typeof v === 'number') return [{ kind: 'text', value: String(v) }];
  return [];
}

function renderChildrenGeneric(children, scope, ctx) {
  const items = expand(children, scope, ctx);
  let out = '';
  let prevWasEl = false;
  for (const it of items) {
    const piece = it.kind === 'text' ? it.value : render(it.node, it.scope, ctx);
    if (!piece) continue;
    // Sibling elements with no JsxText between them (e.g. mapped chips, an icon
    // span next to a label span) render with no source whitespace at all; add a
    // single separating space so words don't run together. normalizeInline()
    // collapses this back down wherever it isn't wanted.
    if (prevWasEl && it.kind === 'el' && out && !/\s$/.test(out) && !/^\s/.test(piece)) {
      out += ' ';
    }
    out += piece;
    prevWasEl = it.kind === 'el';
  }
  return out;
}

// ---------- normalization ----------
function finalizeMarkdown(raw) {
  const blocks = raw
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.join('\n\n');
}

/**
 * Extract markdown for a page component's default export.
 * @param {string} absFilePath
 */
export function extractPageMarkdown(absFilePath) {
  const entry = loadFile(absFilePath);
  const exportName = findDefaultExportName(entry);
  if (!exportName || !entry.componentDefs.has(exportName)) {
    throw new Error(`No default-exported component found in ${absFilePath}`);
  }
  const info = buildComponentTagInfo(entry, exportName);
  if (!info.returnNode || info.returnNode === 'multi') {
    throw new Error(`Could not statically resolve return JSX for ${absFilePath}`);
  }
  const scope = newScope(moduleScope(entry));
  fillLocalConsts(info.bodyBlock, scope);
  const raw = render(info.returnNode, scope, { entry });
  return finalizeMarkdown(raw);
}

/** Extract markdown for a named (non-default) component export, used for cross-file pieces like Writeup. */
export function extractComponentMarkdown(absFilePath, componentName, propsLiteral = {}) {
  const entry = loadFile(absFilePath);
  if (!entry.componentDefs.has(componentName)) {
    throw new Error(`Component ${componentName} not found in ${absFilePath}`);
  }
  const info = buildComponentTagInfo(entry, componentName);
  if (!info.returnNode || info.returnNode === 'multi') {
    throw new Error(`Could not statically resolve return JSX for ${componentName} in ${absFilePath}`);
  }
  const scope = newScope(moduleScope(entry));
  // bind simple literal props if a plain-identifier param
  if (info.params.length && ts.isObjectBindingPattern(info.params[0].name)) {
    for (const el of info.params[0].name.elements) {
      if (!ts.isIdentifier(el.name)) continue;
      const key = el.propertyName ? propName(el.propertyName) : el.name.text;
      const v = propsLiteral[key];
      scopeSet(scope, el.name.text, v === undefined ? UNRESOLVED : v);
    }
  }
  fillLocalConsts(info.bodyBlock, scope);
  const raw = render(info.returnNode, scope, { entry });
  return finalizeMarkdown(raw);
}
