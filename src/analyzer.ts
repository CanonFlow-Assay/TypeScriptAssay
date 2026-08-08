import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { sha256 } from './canonical.js';
import type { AnalysisResult, Finding, Policy, Severity } from './model.js';
import type { ResolvedScope } from './scope.js';

const normalized = (path: string): string => path.replaceAll('\\', '/');
const compareFindings = (left: Finding, right: Finding): number =>
  left.path.localeCompare(right.path) ||
  left.line - right.line ||
  left.column - right.column ||
  left.ruleId.localeCompare(right.ruleId);

const isExported = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false);

const isAssignmentOperator = (kind: ts.SyntaxKind): boolean =>
  kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;

const stringLiteralValue = (type: ts.Type, checker: ts.TypeChecker): string | null => {
  if ((type.flags & ts.TypeFlags.StringLiteral) === 0) return null;
  const rendered = checker.typeToString(type);
  return rendered.length >= 2 && rendered.startsWith('"') && rendered.endsWith('"')
    ? rendered.slice(1, -1)
    : null;
};

const nodeText = (node: ts.Node, sourceFile: ts.SourceFile): string => node.getText(sourceFile);

const hasGuard = (access: ts.ElementAccessExpression, sourceFile: ts.SourceFile): boolean => {
  const index = access.argumentExpression;
  if (index === undefined) return false;
  const objectText = nodeText(access.expression, sourceFile);
  const indexText = nodeText(index, sourceFile);
  let child: ts.Node = access;
  for (let parent = access.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isIfStatement(parent) && parent.thenStatement === child) {
      const condition = parent.expression;
      if (
        ts.isBinaryExpression(condition) &&
        condition.operatorToken.kind === ts.SyntaxKind.InKeyword &&
        nodeText(condition.left, sourceFile) === indexText &&
        nodeText(condition.right, sourceFile) === objectText
      ) {
        return true;
      }
      if (
        ts.isCallExpression(condition) &&
        ts.isPropertyAccessExpression(condition.expression) &&
        nodeText(condition.expression.expression, sourceFile) === 'Object' &&
        condition.expression.name.text === 'hasOwn' &&
        condition.arguments.length === 2 &&
        condition.arguments[0] !== undefined &&
        condition.arguments[1] !== undefined &&
        nodeText(condition.arguments[0], sourceFile) === objectText &&
        nodeText(condition.arguments[1], sourceFile) === indexText
      ) {
        return true;
      }
    }
    child = parent;
  }
  return false;
};

const importModule = (node: ts.ImportDeclaration): string | null =>
  ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;

const resolveImport = (
  moduleName: string,
  sourceFile: ts.SourceFile,
  options: ts.CompilerOptions
): string | null => {
  const result = ts.resolveModuleName(
    moduleName,
    sourceFile.fileName,
    options,
    ts.sys
  ).resolvedModule;
  return result === undefined ? null : resolve(result.resolvedFileName);
};

const publicFunction = (node: ts.SignatureDeclaration): boolean => {
  if (isExported(node)) return true;
  const parent = node.parent;
  return ts.isVariableDeclaration(parent) && isExported(parent.parent.parent);
};

const typeHasDomainDeclaration = (type: ts.Type, domainPaths: ReadonlySet<string>): boolean => {
  const symbol = type.aliasSymbol ?? type.getSymbol();
  return (symbol?.getDeclarations() ?? []).some((declaration) =>
    domainPaths.has(resolve(declaration.getSourceFile().fileName))
  );
};

const isMutableCollection = (node: ts.TypeNode): boolean => {
  if (ts.isArrayTypeNode(node)) return true;
  if (!ts.isTypeReferenceNode(node)) return false;
  const name = node.typeName.getText();
  return name === 'Array' || name === 'Map' || name === 'Set';
};

const typeReferenceName = (node: ts.TypeReferenceNode): string => {
  if (ts.isIdentifier(node.typeName)) return node.typeName.text;
  return node.typeName.right.text;
};

const knownEffectModules = new Set([
  'assert',
  'child_process',
  'cluster',
  'console',
  'crypto',
  'dgram',
  'dns',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'process',
  'readline',
  'stream',
  'timers',
  'tls',
  'tty',
  'worker_threads',
  'zlib'
]);

const effectModule = (moduleName: string): boolean =>
  knownEffectModules.has(moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName);

interface ProgramLoad {
  readonly program: ts.Program;
  readonly errors: readonly string[];
}

const loadProgram = (root: string): ProgramLoad => {
  const config = ts.findConfigFile(root, (path) => ts.sys.fileExists(path), 'tsconfig.json');
  if (config === undefined) throw new Error(`No tsconfig.json found from ${root}`);
  const configRead = ts.readConfigFile(config, (path) => ts.sys.readFile(path));
  if (configRead.error !== undefined)
    throw new Error(ts.flattenDiagnosticMessageText(configRead.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(
    configRead.config,
    ts.sys,
    dirname(config),
    undefined,
    config
  );
  const errors = parsed.errors.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  );
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  return { program, errors };
};

export const analyze = (root: string, policy: Policy, scope: ResolvedScope): AnalysisResult => {
  const findings: Finding[] = [];
  const toolFailures: string[] = [];
  let program: ts.Program;
  try {
    const loaded = loadProgram(root);
    program = loaded.program;
    toolFailures.push(...loaded.errors);
  } catch (error) {
    return {
      findings: [],
      scope: scope.evidence,
      analysisLimitations: ['The TypeScript project could not be loaded.'],
      toolFailures: [error instanceof Error ? error.message : String(error)]
    };
  }
  const checker = program.getTypeChecker();
  const baseline = new Set(policy.baseline.map((entry) => entry.fingerprint));
  const addAt = (
    sourceFile: ts.SourceFile,
    position: number,
    ruleId: string,
    severity: Severity,
    message: string
  ): void => {
    const location = sourceFile.getLineAndCharacterOfPosition(position);
    const path = normalized(relative(root, sourceFile.fileName));
    const fingerprint = sha256(
      `${ruleId}\u0000${path}\u0000${location.line + 1}\u0000${location.character + 1}\u0000${message}`
    );
    findings.push({
      ruleId,
      severity,
      message,
      path,
      line: location.line + 1,
      column: location.character + 1,
      fingerprint,
      baseline: policy.profile === 'converge' && baseline.has(fingerprint)
    });
  };
  const add = (
    sourceFile: ts.SourceFile,
    node: ts.Node,
    ruleId: string,
    severity: Severity,
    message: string
  ): void => addAt(sourceFile, node.getStart(sourceFile), ruleId, severity, message);
  const hatches = policy.escapeHatches;
  const scopePaths = new Set(scope.evidence.scannedPaths.map((path) => resolve(root, path)));
  for (const sourceFile of program.getSourceFiles()) {
    const absolute = resolve(sourceFile.fileName);
    if (!scopePaths.has(absolute)) continue;
    const domain = scope.domainAbsolutePaths.has(absolute);
    const boundary = scope.boundaryAbsolutePaths.has(absolute);
    const sourceDiagnostics = program.getSyntacticDiagnostics(sourceFile);
    for (const diagnostic of sourceDiagnostics) {
      toolFailures.push(
        `${normalized(relative(root, sourceFile.fileName))}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
      );
    }
    for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
      if (
        [7005, 7006, 7008, 7019, 7034].includes(diagnostic.code) &&
        diagnostic.start !== undefined
      ) {
        addAt(
          sourceFile,
          diagnostic.start,
          'TSA-B02',
          'error',
          'Implicit any reported by the TypeScript compiler.'
        );
      }
    }
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      false,
      ts.LanguageVariant.Standard,
      sourceFile.text
    );
    for (
      let token = scanner.scan();
      token !== ts.SyntaxKind.EndOfFileToken;
      token = scanner.scan()
    ) {
      if (
        token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia
      ) {
        const text = scanner.getTokenText();
        if (text.includes('@ts-ignore') || text.includes('@ts-expect-error')) {
          const severity = hatches.directives === 'forbid' ? 'error' : 'warning';
          addAt(
            sourceFile,
            scanner.getTokenPos(),
            'TSA-B03',
            severity,
            'TypeScript suppression directive requires policy evidence.'
          );
        }
      }
    }
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword)
        add(sourceFile, node, 'TSA-B02', 'error', 'Explicit any is forbidden.');
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        add(
          sourceFile,
          node,
          'TSA-B03',
          hatches.assertions === 'forbid' ? 'error' : 'warning',
          'Type assertion requires explicit soundness-escape policy treatment.'
        );
      }
      if (ts.isNonNullExpression(node)) {
        add(
          sourceFile,
          node,
          'TSA-B03',
          hatches.nonNullAssertions === 'forbid' ? 'error' : 'warning',
          'Non-null assertion requires explicit soundness-escape policy treatment.'
        );
      }
      if (boundary && ts.isFunctionLike(node) && publicFunction(node)) {
        for (const parameter of node.parameters) {
          if (
            parameter.type !== undefined &&
            typeHasDomainDeclaration(
              checker.getTypeAtLocation(parameter),
              scope.domainAbsolutePaths
            )
          ) {
            add(
              sourceFile,
              parameter,
              'TSA-B01',
              'error',
              'Boundary parameter claims a trusted domain type; accept unknown then decode.'
            );
          }
        }
      }
      if (domain && ts.isThrowStatement(node))
        add(sourceFile, node, 'TSA-D01', 'error', 'Throw is forbidden in configured domain paths.');
      if (domain && ts.isSwitchStatement(node)) {
        const switched = checker.getTypeAtLocation(
          ts.isPropertyAccessExpression(node.expression)
            ? node.expression.expression
            : node.expression
        );
        if (switched.isUnion()) {
          for (const field of policy.discriminantFields) {
            const variants = new Set<string>();
            let discriminator = true;
            for (const part of switched.types) {
              const property = part.getProperty(field);
              if (property === undefined) {
                discriminator = false;
                break;
              }
              const literal = stringLiteralValue(
                checker.getTypeOfSymbolAtLocation(property, node.expression),
                checker
              );
              if (literal === null) {
                discriminator = false;
                break;
              }
              variants.add(literal);
            }
            if (!discriminator || variants.size === 0) continue;
            const handled = new Set<string>();
            for (const clause of node.caseBlock.clauses) {
              if (ts.isCaseClause(clause) && ts.isStringLiteral(clause.expression))
                handled.add(clause.expression.text);
            }
            const missing = [...variants]
              .filter((variant) => !handled.has(variant))
              .sort((a, b) => a.localeCompare(b));
            if (missing.length > 0) {
              add(
                sourceFile,
                node.expression,
                'TSA-D02',
                'error',
                `Discriminated union is missing ${field} case(s): ${missing.join(', ')}.`
              );
            }
            break;
          }
        }
      }
      if (domain && ts.isElementAccessExpression(node)) {
        const argument = node.argumentExpression;
        if (
          argument !== undefined &&
          !ts.isStringLiteral(argument) &&
          !ts.isNumericLiteral(argument) &&
          !hasGuard(node, sourceFile)
        ) {
          add(
            sourceFile,
            node,
            'TSA-D03',
            'error',
            'Dynamic indexed access is not refined by a recognized guard.'
          );
        }
      }
      if (
        domain &&
        (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
        isExported(node)
      ) {
        const inspectType = (typeNode: ts.TypeNode): void => {
          if (isMutableCollection(typeNode))
            add(
              sourceFile,
              typeNode,
              'TSA-I01',
              'error',
              'Public domain contract exposes a mutable collection type.'
            );
          if (ts.isTypeLiteralNode(typeNode)) {
            for (const member of typeNode.members) {
              if (
                ts.isPropertySignature(member) &&
                !member.modifiers?.some((item) => item.kind === ts.SyntaxKind.ReadonlyKeyword)
              ) {
                add(
                  sourceFile,
                  member,
                  'TSA-I01',
                  'error',
                  'Public domain object property is not readonly.'
                );
              }
              if (ts.isPropertySignature(member) && member.type !== undefined)
                inspectType(member.type);
            }
          }
          if (ts.isTypeReferenceNode(typeNode)) {
            for (const argument of typeNode.typeArguments ?? []) inspectType(argument);
          }
          if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
            for (const member of typeNode.types) inspectType(member);
          }
        };
        if (ts.isInterfaceDeclaration(node)) {
          for (const member of node.members) {
            if (
              ts.isPropertySignature(member) &&
              !member.modifiers?.some((item) => item.kind === ts.SyntaxKind.ReadonlyKeyword)
            ) {
              add(
                sourceFile,
                member,
                'TSA-I01',
                'error',
                'Public domain object property is not readonly.'
              );
            }
            if (ts.isPropertySignature(member) && member.type !== undefined)
              inspectType(member.type);
          }
        } else {
          inspectType(node.type);
        }
      }
      if (domain && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const mutators = new Set([
          'add',
          'clear',
          'copyWithin',
          'delete',
          'fill',
          'pop',
          'push',
          'reverse',
          'set',
          'shift',
          'sort',
          'splice',
          'unshift'
        ]);
        if (mutators.has(node.expression.name.text))
          add(
            sourceFile,
            node,
            'TSA-I02',
            'error',
            `Mutating operation ${node.expression.name.text} is forbidden in domain code.`
          );
      }
      if (
        domain &&
        ts.isBinaryExpression(node) &&
        isAssignmentOperator(node.operatorToken.kind) &&
        (ts.isPropertyAccessExpression(node.left) || ts.isElementAccessExpression(node.left))
      ) {
        add(
          sourceFile,
          node,
          'TSA-I02',
          'error',
          'Mutation through a property or index is forbidden in domain code.'
        );
      }
      if (
        domain &&
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        (ts.isPropertyAccessExpression(node.operand) || ts.isElementAccessExpression(node.operand))
      ) {
        add(
          sourceFile,
          node,
          'TSA-I02',
          'error',
          'Mutation through a property or index is forbidden in domain code.'
        );
      }
      if (domain && ts.isImportDeclaration(node)) {
        const moduleName = importModule(node);
        if (moduleName !== null && effectModule(moduleName))
          add(
            sourceFile,
            node,
            'TSA-E01',
            'error',
            `Effectful infrastructure module ${moduleName} is forbidden in domain code.`
          );
        if (moduleName !== null) {
          const imported = resolveImport(moduleName, sourceFile, program.getCompilerOptions());
          if (imported !== null && scope.boundaryAbsolutePaths.has(imported)) {
            add(
              sourceFile,
              node,
              'TSA-E02',
              'error',
              'Domain module imports a configured adapter/boundary module.'
            );
          }
        }
      }
      if (domain && ts.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          ['fetch', 'setInterval', 'setTimeout'].includes(node.expression.text)
        ) {
          add(
            sourceFile,
            node,
            'TSA-E01',
            'error',
            `Direct effect ${node.expression.text} is forbidden in domain code.`
          );
        }
        if (ts.isPropertyAccessExpression(node.expression)) {
          const owner = node.expression.expression;
          const member = node.expression.name.text;
          if (
            (ts.isIdentifier(owner) && owner.text === 'console') ||
            (ts.isIdentifier(owner) && owner.text === 'process') ||
            (ts.isIdentifier(owner) && owner.text === 'Math' && member === 'random') ||
            (ts.isIdentifier(owner) && owner.text === 'Date' && member === 'now')
          ) {
            add(
              sourceFile,
              node,
              'TSA-E01',
              'error',
              `Direct effect ${node.expression.getText(sourceFile)} is forbidden in domain code.`
            );
          }
        }
      }
      if (
        domain &&
        ts.isTypeReferenceNode(node) &&
        policy.transportTypeNames.includes(typeReferenceName(node))
      ) {
        add(
          sourceFile,
          node,
          'TSA-S01',
          'error',
          `Transport type ${typeReferenceName(node)} is used in domain code without an explicit decoding boundary.`
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const deduplicated = findings.filter(
    (finding, index, all) =>
      index ===
      all.findIndex(
        (other) =>
          other.ruleId === finding.ruleId &&
          other.path === finding.path &&
          other.line === finding.line &&
          other.column === finding.column &&
          other.message === finding.message
      )
  );
  return {
    findings: deduplicated.sort(compareFindings),
    scope: scope.evidence,
    analysisLimitations: [
      'Static observations are limited to selected TypeScript/TSX files and configured rules.',
      'Readonly evidence is compile-time surface evidence, not deep runtime immutability.',
      'No finding set proves business correctness, runtime validation completeness, security, or purity.'
    ],
    toolFailures
  };
};

export const sourceContentDigest = (root: string, paths: readonly string[]): string =>
  sha256(
    paths
      .slice()
      .sort((left, right) => left.localeCompare(right))
      .map((path) => `${path}\u0000${readFileSync(resolve(root, path), 'utf8')}`)
      .join('\u0000')
  );

export const packageLockDigest = (root: string): string | null => {
  let directory = resolve(root);
  for (;;) {
    const lock = resolve(directory, 'package-lock.json');
    if (existsSync(lock)) return sha256(readFileSync(lock));
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
};
