import * as ts from 'typescript';
export declare class AbstractFileVisitor {
    updateImports(sourceFile: ts.SourceFile, factory: ts.NodeFactory | undefined): ts.SourceFile;
}
