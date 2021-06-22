"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractFileVisitor = void 0;
const ts = require("typescript");
const plugin_constants_1 = require("../plugin-constants");
class AbstractFileVisitor {
    updateImports(sourceFile, factory) {
        var _a;
        const [major, minor] = (_a = ts.versionMajorMinor) === null || _a === void 0 ? void 0 : _a.split('.').map((x) => +x);
        if (!factory) {
            const importEqualsDeclaration = major == 4 && minor >= 2
                ? ts.createImportEqualsDeclaration(undefined, undefined, false, plugin_constants_1.OPENAPI_NAMESPACE, ts.createExternalModuleReference(ts.createLiteral(plugin_constants_1.OPENAPI_PACKAGE_NAME)))
                : ts.createImportEqualsDeclaration(undefined, undefined, plugin_constants_1.OPENAPI_NAMESPACE, ts.createExternalModuleReference(ts.createLiteral(plugin_constants_1.OPENAPI_PACKAGE_NAME)));
            return ts.updateSourceFileNode(sourceFile, [
                importEqualsDeclaration,
                ...sourceFile.statements
            ]);
        }
        const importEqualsDeclaration = major == 4 && minor >= 2
            ? factory.createImportEqualsDeclaration(undefined, undefined, false, plugin_constants_1.OPENAPI_NAMESPACE, factory.createExternalModuleReference(factory.createStringLiteral(plugin_constants_1.OPENAPI_PACKAGE_NAME)))
            : factory.createImportEqualsDeclaration(undefined, undefined, plugin_constants_1.OPENAPI_NAMESPACE, factory.createExternalModuleReference(factory.createStringLiteral(plugin_constants_1.OPENAPI_PACKAGE_NAME)));
        return factory.updateSourceFile(sourceFile, [
            importEqualsDeclaration,
            ...sourceFile.statements
        ]);
    }
}
exports.AbstractFileVisitor = AbstractFileVisitor;
