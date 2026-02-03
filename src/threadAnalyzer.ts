import * as vscode from 'vscode';
import Parser from 'tree-sitter';
import Cpp from 'tree-sitter-cpp';

// Interface for storing information about threads, synchronization, functions, and context
export interface ThreadInfo {
    threads: ThreadCreation[];
    synchronization: SynchronizationPrimitive[];
    functions: FunctionInfo[];
    contextualData: ContextualData;
}

// Interface for describing thread creation
export interface ThreadCreation {
    type: 'std::thread' | 'std::async' | 'pthread_create' | 'unknown';
    line: number;
    column: number;
    functionName?: string;
    parameters?: string[];
    context: string;
    creationContext: CreationContext;
}

// Interface for describing the thread creation context
export interface CreationContext {
    inLoop: boolean;
    loopType?: 'for' | 'while' | 'do-while';
    inConditional: boolean;
    conditionalType?: 'if' | 'switch' | 'ternary';
    nestingLevel: number;
    conditionalDepth: number;
    loopDepth: number;
    isInNestedConditional: boolean;
}

// Interface for describing synchronization primitives
export interface SynchronizationPrimitive {
    type: 'mutex' | 'lock_guard' | 'unique_lock' | 'condition_variable' | 'atomic' | 'shared_ptr';
    line: number;
    column: number;
    name?: string;
    context: string;
    scopeLevel: number;
    associatedThreads?: string[];
}

// Interface for describing functions in the code
export interface FunctionInfo {
    name: string;
    line: number;
    column: number;
    isThreadTarget: boolean;
    callsFromThreads: number;
    synchronizationUsed: string[];
}

// Interface for storing statistics on threads, synchronization, and shared resources
export interface ContextualData {
    totalLoopThreads: number;
    conditionalThreads: number;
    nestedSynchronization: SynchronizationPrimitive[];
    sharedResources: SharedResource[];
}

// Interface for describing shared resources
export interface SharedResource {
    name: string;
    type: string;
    line: number;
    accessedBy: string[];
    protectedBy?: string[];
}

// Internal interface for storing information about the node's context
interface ContextInfo {
    type: string;
    line: number;
    inLoop: boolean;
    loopType?: 'for' | 'while' | 'do-while';
    inConditional: boolean;
    conditionalType?: 'if' | 'switch' | 'ternary';
    nestingLevel: number;
    scopeId: string;
    conditionalDepth: number;
    loopDepth: number;
    parentConditionals: string[];
    parentLoops: string[];
}

// Internal interface for storing information about variable declarations
interface VariableDeclaration {
    name: string;
    type: string;
    line: number;
    scope: number;
}

// Class for analyzing threads in C++ code
export class ThreadAnalyzer {
    private parser: Parser;
    private declaredThreadVectors: Map<string, VariableDeclaration> = new Map();
    private variableDeclarations: Map<string, VariableDeclaration> = new Map();
    private currentScope: string[] = [];

    // The constructor initializes the parser for C++
    constructor() {
        this.parser = new Parser();
        this.parser.setLanguage(Cpp as any);
    }

    // The main method for analyzing a VSCode document
    async analyzeDocument(document: vscode.TextDocument): Promise<ThreadInfo> {
        const sourceCode = document.getText();
        const tree = this.parser.parse(sourceCode);

        this.declaredThreadVectors.clear();
        this.variableDeclarations.clear();
        this.currentScope = [];

        const threadInfo: ThreadInfo = {
            threads: [],
            synchronization: [],
            functions: [],
            contextualData: {
                totalLoopThreads: 0,
                conditionalThreads: 0,
                nestedSynchronization: [],
                sharedResources: []
            }
        };

        this.collectVariableDeclarations(tree.rootNode, sourceCode);
        this.walkTree(tree.rootNode, sourceCode, threadInfo, []);
        this.postProcessAnalysis(threadInfo);

        return threadInfo;
    }

    // Collecting variable declarations (including std::vector<std::thread>)
    // This method recursively traverses the syntax tree and collects variable declarations
    // for thread vectors and other variables that can be used in thread creation.
    // It also determines the scope of each variable for further analysis.
    private collectVariableDeclarations(node: Parser.SyntaxNode, sourceCode: string) {
        if (node.type === 'declaration') {
            const declText = sourceCode.slice(node.startIndex, node.endIndex);
            const threadVectorMatch = declText.match(/std::vector\s*<\s*std::thread\s*>\s+(\w+)/);
            if (threadVectorMatch) {
                const varName = threadVectorMatch[1];
                const declaration: VariableDeclaration = {
                    name: varName,
                    type: 'std::vector<std::thread>',
                    line: node.startPosition.row + 1,
                    scope: this.currentScope.length
                };
                this.declaredThreadVectors.set(varName, declaration);
                this.variableDeclarations.set(varName, declaration);
            }
            const varMatch = declText.match(/(\w+(?:::\w+)*(?:\s*<[^>]*>)?)\s+(\w+)/);
            if (varMatch && !threadVectorMatch) {
                const varType = varMatch[1];
                const varName = varMatch[2];
                const declaration: VariableDeclaration = {
                    name: varName,
                    type: varType,
                    line: node.startPosition.row + 1,
                    scope: this.currentScope.length
                };
                this.variableDeclarations.set(varName, declaration);
            }
        }
        for (const child of node.children) {
            if (this.isNewScope(child.type)) {
                this.currentScope.push(child.type);
                this.collectVariableDeclarations(child, sourceCode);
                this.currentScope.pop();
            } else {
                this.collectVariableDeclarations(child, sourceCode);
            }
        }
    }

    // We determine if this is a new scope
    private isNewScope(nodeType: string): boolean {
        return [
            'function_definition',
            'compound_statement',
            'for_statement',
            'while_statement',
            'if_statement',
            'switch_statement'
        ].includes(nodeType);
    }

    // Recursive traversal of the syntax tree
    private walkTree(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo,
        contextStack: ContextInfo[]
    ) {
        const currentContext = this.analyzeNodeContext(node, sourceCode, contextStack);
        const newContextStack = [...contextStack, currentContext];
        this.analyzeNode(node, sourceCode, threadInfo, newContextStack);
        for (const child of node.children) {
            this.walkTree(child, sourceCode, threadInfo, newContextStack);
        }
    }

    // We analyze the context of the node (whether it's in a loop or a conditional statement)
    private analyzeNodeContext(
        node: Parser.SyntaxNode,
        sourceCode: string,
        contextStack: ContextInfo[]
    ): ContextInfo {
        const nodeType = node.type;
        const line = node.startPosition.row + 1;
        // We filter the context to find loop ancestors and conditional ancestors
        const parentLoops = contextStack.filter(ctx => this.isLoopNode(ctx.type));
        const parentConditionals = contextStack.filter(ctx => this.isConditionalNode(ctx.type) || this.isWithinConditionalScope(ctx, contextStack));
        // We determine if the current node is a loop or a conditional statement
        const isCurrentLoop = this.isLoopNode(nodeType);
        const isCurrentConditional = this.isConditionalNode(nodeType) || this.isWithinConditionalScope({ type: nodeType, line } as ContextInfo, contextStack);
        // We determine if the current node is in a loop or a conditional statement
        const inLoop = isCurrentLoop || parentLoops.length > 0;
        const inConditional = isCurrentConditional || parentConditionals.length > 0 || this.isInConditionalBranch(node, sourceCode, contextStack);
        // We determine the nesting depth of loops and conditional statements
        const loopDepth = parentLoops.length + (isCurrentLoop ? 1 : 0);
        const conditionalDepth = parentConditionals.length + (isCurrentConditional ? 1 : 0) + (this.isInConditionalBranch(node, sourceCode, contextStack) ? 1 : 0);

        return {
            type: nodeType,
            line,
            inLoop,
            loopType: this.getLoopType(nodeType) || this.getLastAncestorLoopType(parentLoops),
            inConditional,
            conditionalType: this.getConditionalType(nodeType) || this.getLastAncestorConditionalType(parentConditionals),
            nestingLevel: contextStack.length,
            scopeId: this.generateScopeId(contextStack),
            conditionalDepth: Math.max(conditionalDepth, 0),
            loopDepth,
            parentConditionals: parentConditionals.map(ctx => `${ctx.type}:${ctx.line}`),
            parentLoops: parentLoops.map(ctx => `${ctx.type}:${ctx.line}`)
        };
    }

    // Generates a unique identifier for the current context stack
    private generateScopeId(contextStack: ContextInfo[]): string {
        return contextStack.map(ctx => `${ctx.type}:${ctx.line}`).join('|');
    }

    // Returns the loop type for the last loop ancestor in the stack
    private getLastAncestorLoopType(parentLoops: ContextInfo[]): 'for' | 'while' | 'do-while' | undefined {
        if (!parentLoops.length) return undefined;
        return this.getLoopType(parentLoops[parentLoops.length - 1].type);
    }

    // Returns the conditional operator type for the last conditional ancestor in the stack
    private getLastAncestorConditionalType(parentConditionals: ContextInfo[]): 'if' | 'switch' | 'ternary' | undefined {
        if (!parentConditionals.length) return undefined;
        return this.getConditionalType(parentConditionals[parentConditionals.length - 1].type);
    }

    // We analyze the node: threads, synchronization, functions, resources
    private analyzeNode(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo,
        contextStack: ContextInfo[]
    ) {
        const line = node.startPosition.row + 1;
        const column = node.startPosition.column + 1;

        if (node.type === 'call_expression') {
            this.analyzeThreadCreationWithContext(node, sourceCode, threadInfo, line, column, contextStack);
        }
        if (node.type === 'declaration' || node.type === 'init_declarator') {
            this.analyzeThreadDeclarationWithContext(node, sourceCode, threadInfo, line, column, contextStack);
        }
        if (node.type === 'declaration' || node.type === 'expression_statement') {
            this.analyzeAdvancedSynchronization(node, sourceCode, threadInfo, line, column, contextStack);
        }
        if (node.type === 'function_definition' || node.type === 'function_declarator') {
            this.analyzeFunctionWithContext(node, sourceCode, threadInfo, line, column, contextStack);
        }
        if (node.type === 'declaration' && sourceCode.slice(node.startIndex, node.endIndex).includes('shared_ptr')) {
            this.analyzeSharedResources(node, sourceCode, threadInfo, line, column);
        }
        if (node.type === 'assignment_expression') {
            this.analyzeThreadAssignmentWithContext(node, sourceCode, threadInfo, line, column, contextStack);
        }
    }

    // Analysis of thread creation (async, pthread, emplace_back)
    private analyzeThreadCreationWithContext(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo,
        line: number,
        column: number,
        contextStack: ContextInfo[]
    ) {
        const callText = sourceCode.slice(node.startIndex, node.endIndex);
        const context = this.buildCreationContext(contextStack);

        if (this.matchesPattern(callText, /std::async\s*\(/)) {
            threadInfo.threads.push({
                type: 'std::async',
                line,
                column,
                context: this.getContext(node, sourceCode),
                functionName: this.extractAsyncFunction(callText),
                creationContext: context
            });
            this.updateContextualStats(threadInfo, context);
        } else if (this.matchesPattern(callText, /pthread_create\s*\(/)) {
            threadInfo.threads.push({
                type: 'pthread_create',
                line,
                column,
                context: this.getContext(node, sourceCode),
                functionName: this.extractPthreadFunction(callText),
                creationContext: context
            });
            this.updateContextualStats(threadInfo, context);
        } else if (this.matchesPattern(callText, /emplace_back\s*\(/)) {
            const vectorName = this.extractVectorNameFromEmplaceBack(node, sourceCode);
            if (vectorName && this.declaredThreadVectors.has(vectorName)) {
                threadInfo.threads.push({
                    type: 'std::thread',
                    line,
                    column,
                    context: this.getContext(node, sourceCode),
                    functionName: this.extractThreadTargetFromContainerCall(callText, 'emplace_back'),
                    creationContext: context
                });
                this.updateContextualStats(threadInfo, context);
            }
        } else if (this.matchesPattern(callText, /push_back\s*\(/)) {
            const vectorName = this.extractVectorNameFromEmplaceBack(node, sourceCode);
            if (vectorName && this.declaredThreadVectors.has(vectorName)) {
                threadInfo.threads.push({
                    type: 'std::thread',
                    line,
                    column,
                    context: this.getContext(node, sourceCode),
                    functionName: this.extractThreadTargetFromContainerCall(callText, 'push_back'),
                    creationContext: context
                });
                this.updateContextualStats(threadInfo, context);
            }
        }
    }

    // We extract the vector name for emplace_back
    private extractVectorNameFromEmplaceBack(node: Parser.SyntaxNode, sourceCode: string): string | null {
        const fieldExpr = this.findChildOfType(node, 'field_expression');
        if (fieldExpr) {
            const objectNode = fieldExpr.children[0];
            if (objectNode) {
                return sourceCode.slice(objectNode.startIndex, objectNode.endIndex);
            }
        }
        return null;
    }

    // Recursively searches for the first child node of the specified type
    private findChildOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        for (const child of node.children) {
            if (child.type === type) return child;
            const found = this.findChildOfType(child, type);
            if (found) return found;
        }
        return null;
    }

    // Analysis of std::thread declaration
    private analyzeThreadDeclarationWithContext(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo,
        line: number,
        column: number,
        contextStack: ContextInfo[]
    ) {
        const nodeText = sourceCode.slice(node.startIndex, node.endIndex);
        const context = this.buildCreationContext(contextStack);

        if (this.matchesPattern(nodeText, /std::thread\s+\w+/)) {
            threadInfo.threads.push({
                type: 'std::thread',
                line,
                column,
                context: this.getContext(node, sourceCode),
                functionName: this.extractThreadFunctionFromDeclaration(nodeText),
                creationContext: context
            });
            this.updateContextualStats(threadInfo, context);
        }
    }

    // We form the context of thread creation
    private buildCreationContext(contextStack: ContextInfo[]): CreationContext {
        const inLoop = contextStack.some(ctx => ctx.inLoop || this.isLoopNode(ctx.type));
        const directConditional = contextStack.some(ctx => ctx.inConditional || this.isConditionalNode(ctx.type));
        const hasIfInStack = contextStack.some(ctx => ctx.type === 'if_statement');
        const hasCompoundInIfContext = contextStack.some((ctx, index) => ctx.type === 'compound_statement' && index > 0 && contextStack[index - 1].type === 'if_statement');
        const inConditional = directConditional || hasIfInStack || hasCompoundInIfContext;
        const loopDepth = Math.max(...contextStack.map(ctx => ctx.loopDepth || 0), 0);
        const conditionalDepth = Math.max(...contextStack.map(ctx => ctx.conditionalDepth || 0), 0);
        const isInNestedConditional = conditionalDepth > 0 && (loopDepth > 0 || conditionalDepth > 1);

        return {
            inLoop,
            loopType: this.getCurrentLoopType(contextStack),
            inConditional,
            conditionalType: this.getCurrentConditionalType(contextStack),
            nestingLevel: contextStack.length,
            conditionalDepth: Math.max(conditionalDepth, inConditional ? 1 : 0),
            loopDepth,
            isInNestedConditional
        };
    }

    // We update the statistics on threads
    private updateContextualStats(threadInfo: ThreadInfo, context: CreationContext) {
        if (context.inLoop) threadInfo.contextualData.totalLoopThreads++;
        if (context.inConditional || context.isInNestedConditional || context.conditionalDepth > 0) {
            threadInfo.contextualData.conditionalThreads++;
        }
    }

    // Analysis of synchronization (mutex, atomic, condition_variable, shared_ptr)
    private analyzeAdvancedSynchronization(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo,
        line: number,
        column: number,
        contextStack: ContextInfo[]
    ) {
        const nodeText = sourceCode.slice(node.startIndex, node.endIndex);
        const scopeLevel = contextStack.length;
        const syncTypes = [
            { pattern: /std::(mutex|recursive_mutex|timed_mutex|shared_mutex)/, type: 'mutex' },
            { pattern: /std::lock_guard/, type: 'lock_guard' },
            { pattern: /std::unique_lock/, type: 'unique_lock' },
            { pattern: /std::condition_variable/, type: 'condition_variable' },
            { pattern: /std::atomic/, type: 'atomic' },
            { pattern: /std::shared_ptr/, type: 'shared_ptr' }
        ];

        if (node.type === 'declaration') {
            for (const { pattern, type } of syncTypes) {
                if (
                    (type === 'mutex' || type === 'atomic' || type === 'condition_variable' || type === 'shared_ptr') &&
                    this.matchesPattern(nodeText, pattern)
                ) {
                    const declMatch = nodeText.match(new RegExp(`^\\s*std::${type}`));
                    if (declMatch) {
                        let varName = this.extractVariableName(nodeText);
                        if (!varName) {
                            const nameMatch = nodeText.match(/std::\w+(?:<[^>]+>)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
                            if (nameMatch) varName = nameMatch[1];
                        }
                        threadInfo.synchronization.push({
                            type: type as any,
                            line,
                            column,
                            context: this.getContext(node, sourceCode),
                            name: varName,
                            scopeLevel,
                            associatedThreads: []
                        });
                        this.checkNestedSynchronization(threadInfo.synchronization[threadInfo.synchronization.length - 1], threadInfo, scopeLevel);
                        break;
                    }
                }
            }
        }
    }

    // We add to nestedSynchronization if the nesting is > 2
    private checkNestedSynchronization(
        sync: SynchronizationPrimitive,
        threadInfo: ThreadInfo,
        scopeLevel: number
    ) {
        if (scopeLevel > 2) {
            threadInfo.contextualData.nestedSynchronization.push(sync);
        }
    }

    // Analysis of shared_ptr declaration
    private analyzeSharedResources(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo,
        line: number,
        column: number
    ) {
        const nodeText = sourceCode.slice(node.startIndex, node.endIndex);
        const resourceName = this.extractVariableName(nodeText);

        if (resourceName) {
            threadInfo.contextualData.sharedResources.push({
                name: resourceName,
                type: 'shared_ptr',
                line,
                accessedBy: [],
                protectedBy: []
            });
        }
    }

    // Analysis of functions
    private analyzeFunctionWithContext(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo,
        line: number,
        column: number,
        contextStack: ContextInfo[]
    ) {
        const functionName = this.extractFunctionName(node, sourceCode);
        if (functionName) {
            threadInfo.functions.push({
                name: functionName,
                line,
                column,
                isThreadTarget: false,
                callsFromThreads: 0,
                synchronizationUsed: this.findSynchronizationInFunction(node, sourceCode, threadInfo)
            });
        }
    }

    // Analysis of synchronization in an arbitrary function/lambda body
    private findSynchronizationInFunctionBody(
        functionBody: string,
        threadInfo: ThreadInfo
    ): string[] {
        const syncNames: string[] = [];
        threadInfo.synchronization.forEach(sync => {
            if (sync.name) {
                const regex = new RegExp(`\\b${sync.name}\\b`);
                if (regex.test(functionBody)) {
                    syncNames.push(sync.name);
                }
            }
        });
        return Array.from(new Set(syncNames));
    }

    private analyzeThreadAssignmentWithContext(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo,
        line: number,
        column: number,
        contextStack: ContextInfo[]
    ) {
        const assignmentText = sourceCode.slice(node.startIndex, node.endIndex);
        if (/=\s*std::thread\s*\(/.test(assignmentText)) {
            threadInfo.threads.push({
                type: 'std::thread',
                line,
                column,
                context: this.getContext(node, sourceCode),
                functionName: this.extractThreadFunctionFromDeclaration(assignmentText),
                creationContext: this.buildCreationContext(contextStack)
            });
            this.updateContextualStats(threadInfo, this.buildCreationContext(contextStack));
        }
    }

    // Post-processing: establishing connections between threads, functions, synchronization
    private postProcessAnalysis(threadInfo: ThreadInfo) {
        threadInfo.functions.forEach(func => {
            const threadUsage = threadInfo.threads.filter(t => t.functionName === func.name).length;
            func.callsFromThreads = threadUsage;
            func.isThreadTarget = threadUsage > 0;
        });

        threadInfo.synchronization.forEach(sync => {
            const relatedThreads = threadInfo.threads.filter(t => {
                if (!t.functionName) return false;
                const func = threadInfo.functions.find(f => f.name === t.functionName);
                if (!func) return false;
                // 1. If the function explicitly uses the name of this primitive (e.g., print_mutex)
                if (sync.name && func.synchronizationUsed && func.synchronizationUsed.includes(sync.name)) return true;
                // 2. If the function uses the primitive type (mutex, atomic, ...) and it is a global variable
                if (func.synchronizationUsed && func.synchronizationUsed.includes(sync.type)) {
                    // Additionally, we check if the primitive's name is mentioned in the function body
                    if (sync.name && this.functionBodyMentions(sync.name, func, threadInfo)) return true;
                }
                return false;
            });
            sync.associatedThreads = Array.from(new Set(relatedThreads.map(t => t.functionName || 'anonymous')));
        });

        this.analyzeSharedResourceAccess(threadInfo);
        (threadInfo as any).threadSyncReport = this.generateThreadSyncReport(threadInfo);
    }

    // Checks if the function body contains the name of the primitive
    private functionBodyMentions(syncName: string, func: FunctionInfo, threadInfo: ThreadInfo): boolean {
        return func.synchronizationUsed.includes(syncName);
    }

    // We determine which threads use shared resources
    private analyzeSharedResourceAccess(threadInfo: ThreadInfo) {
        threadInfo.contextualData.sharedResources.forEach(resource => {
            const associatedThreads = threadInfo.threads.filter(t =>
                t.context.includes(resource.name)
            );
            resource.accessedBy = associatedThreads.map(t => t.functionName || 'anonymous');
            const protectiveSyncs = threadInfo.synchronization.filter(s =>
                Math.abs(s.line - resource.line) < 5
            );
            resource.protectedBy = protectiveSyncs.map(s => s.name || s.type);
        });
    }

    // Helper methods for determining the node type
    private isLoopNode(nodeType: string): boolean {
        return ['for_statement', 'while_statement', 'do_statement'].includes(nodeType);
    }

    private isConditionalNode(nodeType: string): boolean {
        return ['if_statement', 'switch_statement', 'conditional_expression', 'else_clause'].includes(nodeType);
    }

    // Returns the loop type by the node type
    private getLoopType(nodeType: string): 'for' | 'while' | 'do-while' | undefined {
        switch (nodeType) {
            case 'for_statement': return 'for';
            case 'while_statement': return 'while';
            case 'do_statement': return 'do-while';
            default: return undefined;
        }
    }

    // Returns the conditional operator type by the node type
    private getConditionalType(nodeType: string): 'if' | 'switch' | 'ternary' | undefined {
        switch (nodeType) {
            case 'if_statement': return 'if';
            case 'switch_statement': return 'switch';
            case 'conditional_expression': return 'ternary';
            case 'else_clause': return 'if';
            default: return undefined;
        }
    }

    // Returns the loop type for the nearest ancestor in the context stack
    private getCurrentLoopType(contextStack: ContextInfo[]): 'for' | 'while' | 'do-while' | undefined {
        for (let i = contextStack.length - 1; i >= 0; i--) {
            if (contextStack[i].loopType) return contextStack[i].loopType;
        }
        return undefined;
    }

    // Returns the conditional operator type for the nearest ancestor in the context stack
    private getCurrentConditionalType(contextStack: ContextInfo[]): 'if' | 'switch' | 'ternary' | undefined {
        for (let i = contextStack.length - 1; i >= 0; i--) {
            if (contextStack[i].conditionalType) return contextStack[i].conditionalType;
        }
        return undefined;
    }

    // Search for synchronization in a function
    private findSynchronizationInFunction(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo
    ): string[] {
        const functionBody = sourceCode.slice(node.startIndex, node.endIndex);
        return this.findSynchronizationInFunctionBody(functionBody, threadInfo);
    }

    // We extract the function name
    private extractFunctionName(node: Parser.SyntaxNode, sourceCode: string): string | undefined {
        for (const child of node.children) {
            if (child.type === 'identifier') return sourceCode.slice(child.startIndex, child.endIndex);
            if (child.type === 'function_declarator') return this.extractFunctionName(child, sourceCode);
        }
        return undefined;
    }

    // Pattern check
    private matchesPattern(text: string, pattern: RegExp): boolean {
        return pattern.test(text);
    }

    // We extract the context around the node
    private getContext(node: Parser.SyntaxNode, sourceCode: string, maxLength: number = 100): string {
        const context = sourceCode.slice(
            Math.max(0, node.startIndex - 50),
            Math.min(sourceCode.length, node.endIndex + 50)
        );
        return context.length > maxLength ? context.substring(0, maxLength) + '...' : context;
    }

    // We extract the variable name from the declaration
    private extractVariableName(text: string): string | undefined {
        const match = text.match(/(\w+)\s*[;\(=]/);
        return match ? match[1] : undefined;
    }

    // We extract the function name for std::thread
    private extractThreadFunctionFromDeclaration(declarationText: string): string | undefined {
        // Try to match std::thread t(...);
        let match = declarationText.match(/std::thread\s+\w+\s*\(\s*([^,\)]+)/);
        if (match) {
            const arg = match[1].trim();
            if (arg.startsWith('[') || arg.startsWith('{') || arg === '') return undefined;
            return arg;
        }
        // Try to match assignment: threads[i] = std::thread(...);
        match = declarationText.match(/=\s*std::thread\s*\(\s*([^,\)]+)/);
        if (match) {
            const arg = match[1].trim();
            if (arg.startsWith('[') || arg.startsWith('{') || arg === '') return undefined;
            return arg;
        }
        return undefined;
    }

    // We extract the thread target from the emplace_back or push_back call
    private extractThreadTargetFromContainerCall(callText: string, method: 'emplace_back' | 'push_back'): string | undefined {
        let match: RegExpMatchArray | null = null;
        if (method === 'emplace_back') {
            match = callText.match(/emplace_back\s*\(\s*([^,\)]+)/);
        } else if (method === 'push_back') {
            match = callText.match(/push_back\s*\(\s*(?:std::thread\s*\(\s*)?([^,\)]+)/);
        }
        if (match) {
            const arg = match[1].trim();
            if (arg.startsWith('[') || arg.startsWith('{') || arg === '') return undefined;
            return arg;
        }
        return undefined;
    }

    // We extract the function name for std::async
    private extractAsyncFunction(callText: string): string | undefined {
        const match = callText.match(/std::async\s*\([^,]*,\s*([^,\)]+)/) ||
            callText.match(/std::async\s*\(\s*([^,\)]+)/);
        if (match) {
            const arg = match[1].trim();
            if (
                arg.startsWith('[') ||
                arg.startsWith('{') ||
                arg === '[]' ||
                arg === '[]()'
            ) {
                return undefined;
            }
            return arg;
        }
        return undefined;
    }

    // We extract the function name for pthread_create
    private extractPthreadFunction(callText: string): string | undefined {
        const match = callText.match(/pthread_create\s*\([^,]*,[^,]*,\s*([^,\)]+)/);
        return match ? match[1].trim() : undefined;
    }

    // Whether the node is in a conditional branch (if/else)
    private isInConditionalBranch(node: Parser.SyntaxNode, sourceCode: string, contextStack: ContextInfo[]): boolean {
        const hasIfParent = contextStack.some(ctx => ctx.type === 'if_statement');
        if (node.parent) {
            let current: Parser.SyntaxNode | null = node.parent;
            while (current && current.type !== 'function_definition') {
                if (current.type === 'if_statement') return true;
                if (current.type === 'compound_statement' && current.parent?.type === 'if_statement') return true;
                if (current.type === 'compound_statement' && current.parent) {
                    const parent = current.parent;
                    if (parent.type === 'if_statement') {
                        const children = parent.children;
                        const currentIndex = children.findIndex(child => child.id === current!.id);
                        if (currentIndex > 0) {
                            for (let i = currentIndex - 1; i >= 0; i--) {
                                if (children[i].type === 'compound_statement' ||
                                    (children[i].type && children[i].text === 'else')) {
                                    return true;
                                }
                            }
                        }
                        const siblings = parent.children;
                        const hasElseKeyword = siblings.some(sibling =>
                            sibling.type === 'else' ||
                            (sibling.text && sibling.text.includes('else'))
                        );
                        if (hasElseKeyword) {
                            const elseIndex = siblings.findIndex(s =>
                                s.type === 'else' || (s.text && s.text.includes('else'))
                            );
                            const currentIndex2 = siblings.findIndex(s => s.id === current!.id);
                            if (currentIndex2 > elseIndex) return true;
                        }
                    }
                }
                current = current.parent;
            }
        }
        return hasIfParent;
    }

    // Whether the context is conditional (for nested structures)
    private isWithinConditionalScope(ctx: ContextInfo, contextStack: ContextInfo[]): boolean {
        for (let i = contextStack.length - 1; i >= Math.max(0, contextStack.length - 3); i--) {
            const parentCtx = contextStack[i];
            if (this.isConditionalNode(parentCtx.type)) return true;
        }
        return false;
    }

    // Generates a report on the use of synchronization primitives by threads
    private generateThreadSyncReport(threadInfo: ThreadInfo): string {
        let report = 'Thread to Synchronization Primitives Usage:\n';
        for (const thread of threadInfo.threads) {
            const threadName = thread.functionName || 'anonymous';

            const func = threadInfo.functions.find(f => f.name === thread.functionName);
            if (!func) continue;

            const usedSyncs = threadInfo.synchronization
                .filter(sync => func.synchronizationUsed.includes(sync.name || ''))
                .map(sync => sync.name)
                .filter(Boolean);
            report += `- Thread "${threadName}" uses sync primitives: ${usedSyncs.length > 0 ? usedSyncs.join(', ') : 'none'}\n`;
        }
        return report;
    }
}