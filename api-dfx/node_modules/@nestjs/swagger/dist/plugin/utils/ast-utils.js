"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDecoratorName = exports.getDecoratorArguments = exports.getMainCommentAndExamplesOfNode = exports.getDefaultTypeFormatFlags = exports.getText = exports.hasObjectFlag = exports.hasFlag = exports.isEnumLiteral = exports.isEnum = exports.isInterface = exports.isNumber = exports.isString = exports.isBoolean = exports.getTypeArguments = exports.isArray = void 0;
const typescript_1 = require("typescript");
const plugin_utils_1 = require("./plugin-utils");
function isArray(type) {
    const symbol = type.getSymbol();
    if (!symbol) {
        return false;
    }
    return symbol.getName() === 'Array' && getTypeArguments(type).length === 1;
}
exports.isArray = isArray;
function getTypeArguments(type) {
    return type.typeArguments || [];
}
exports.getTypeArguments = getTypeArguments;
function isBoolean(type) {
    return hasFlag(type, typescript_1.TypeFlags.Boolean);
}
exports.isBoolean = isBoolean;
function isString(type) {
    return hasFlag(type, typescript_1.TypeFlags.String);
}
exports.isString = isString;
function isNumber(type) {
    return hasFlag(type, typescript_1.TypeFlags.Number);
}
exports.isNumber = isNumber;
function isInterface(type) {
    return hasObjectFlag(type, typescript_1.ObjectFlags.Interface);
}
exports.isInterface = isInterface;
function isEnum(type) {
    const hasEnumFlag = hasFlag(type, typescript_1.TypeFlags.Enum);
    if (hasEnumFlag) {
        return true;
    }
    if (isEnumLiteral(type)) {
        return false;
    }
    const symbol = type.getSymbol();
    if (!symbol) {
        return false;
    }
    const valueDeclaration = symbol.valueDeclaration;
    if (!valueDeclaration) {
        return false;
    }
    return valueDeclaration.kind === typescript_1.SyntaxKind.EnumDeclaration;
}
exports.isEnum = isEnum;
function isEnumLiteral(type) {
    return hasFlag(type, typescript_1.TypeFlags.EnumLiteral) && !type.isUnion();
}
exports.isEnumLiteral = isEnumLiteral;
function hasFlag(type, flag) {
    return (type.flags & flag) === flag;
}
exports.hasFlag = hasFlag;
function hasObjectFlag(type, flag) {
    return (type.objectFlags & flag) === flag;
}
exports.hasObjectFlag = hasObjectFlag;
function getText(type, typeChecker, enclosingNode, typeFormatFlags) {
    if (!typeFormatFlags) {
        typeFormatFlags = getDefaultTypeFormatFlags(enclosingNode);
    }
    const compilerNode = !enclosingNode ? undefined : enclosingNode;
    return typeChecker.typeToString(type, compilerNode, typeFormatFlags);
}
exports.getText = getText;
function getDefaultTypeFormatFlags(enclosingNode) {
    let formatFlags = typescript_1.TypeFormatFlags.UseTypeOfFunction |
        typescript_1.TypeFormatFlags.NoTruncation |
        typescript_1.TypeFormatFlags.UseFullyQualifiedType |
        typescript_1.TypeFormatFlags.WriteTypeArgumentsOfSignature;
    if (enclosingNode && enclosingNode.kind === typescript_1.SyntaxKind.TypeAliasDeclaration)
        formatFlags |= typescript_1.TypeFormatFlags.InTypeAlias;
    return formatFlags;
}
exports.getDefaultTypeFormatFlags = getDefaultTypeFormatFlags;
function getMainCommentAndExamplesOfNode(node, sourceFile, typeChecker, includeExamples) {
    const sourceText = sourceFile.getFullText();
    const replaceRegex = /^ *\** *@.*$|^ *\/\*+ *|^ *\/\/+.*|^ *\/+ *|^ *\*+ *| +$| *\**\/ *$/gim;
    const commentResult = [];
    const examplesResult = [];
    const introspectCommentsAndExamples = (comments) => comments === null || comments === void 0 ? void 0 : comments.forEach((comment) => {
        var _a, _b, _c, _d, _e;
        const commentSource = sourceText.substring(comment.pos, comment.end);
        const oneComment = commentSource.replace(replaceRegex, '').trim();
        if (oneComment) {
            commentResult.push(oneComment);
        }
        if (includeExamples) {
            const regexOfExample = /@example *((['"](?<exampleAsString>.+?)['"])|(?<exampleAsBooleanOrNumber>[^ ]+?)|(?<exampleAsArray>(\[.+?\]))) *$/gim;
            let execResult;
            while ((execResult = regexOfExample.exec(commentSource)) &&
                execResult.length > 1) {
                const example = (_d = (_b = (_a = execResult.groups) === null || _a === void 0 ? void 0 : _a.exampleAsString) !== null && _b !== void 0 ? _b : (_c = execResult.groups) === null || _c === void 0 ? void 0 : _c.exampleAsBooleanOrNumber) !== null && _d !== void 0 ? _d : (((_e = execResult.groups) === null || _e === void 0 ? void 0 : _e.exampleAsArray) &&
                    execResult.groups.exampleAsArray.replace(/'/g, '"'));
                const type = typeChecker.getTypeAtLocation(node);
                if (type && isString(type)) {
                    examplesResult.push(example);
                }
                else {
                    try {
                        examplesResult.push(JSON.parse(example));
                    }
                    catch (_f) {
                        examplesResult.push(example);
                    }
                }
            }
        }
    });
    const leadingCommentRanges = typescript_1.getLeadingCommentRanges(sourceText, node.getFullStart());
    introspectCommentsAndExamples(leadingCommentRanges);
    if (!commentResult.length) {
        const trailingCommentRanges = typescript_1.getTrailingCommentRanges(sourceText, node.getFullStart());
        introspectCommentsAndExamples(trailingCommentRanges);
    }
    return [commentResult.join('\n'), examplesResult];
}
exports.getMainCommentAndExamplesOfNode = getMainCommentAndExamplesOfNode;
function getDecoratorArguments(decorator) {
    const callExpression = decorator.expression;
    return (callExpression && callExpression.arguments) || [];
}
exports.getDecoratorArguments = getDecoratorArguments;
function getDecoratorName(decorator) {
    const isDecoratorFactory = decorator.expression.kind === typescript_1.SyntaxKind.CallExpression;
    if (isDecoratorFactory) {
        const callExpression = decorator.expression;
        const identifier = callExpression
            .expression;
        if (plugin_utils_1.isDynamicallyAdded(identifier)) {
            return undefined;
        }
        return getIdentifierFromName(callExpression.expression).getText();
    }
    return getIdentifierFromName(decorator.expression).getText();
}
exports.getDecoratorName = getDecoratorName;
function getIdentifierFromName(expression) {
    const identifier = getNameFromExpression(expression);
    if (expression && expression.kind !== typescript_1.SyntaxKind.Identifier) {
        throw new Error();
    }
    return identifier;
}
function getNameFromExpression(expression) {
    if (expression && expression.kind === typescript_1.SyntaxKind.PropertyAccessExpression) {
        return expression.name;
    }
    return expression;
}
