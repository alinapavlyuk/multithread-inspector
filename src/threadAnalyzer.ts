import * as vscode from 'vscode';
import Parser from 'tree-sitter';
import Cpp from 'tree-sitter-cpp';

// Інтерфейс для зберігання інформації про потоки, синхронізацію, функції та контекст
export interface ThreadInfo {
    threads: ThreadCreation[];
    synchronization: SynchronizationPrimitive[];
    functions: FunctionInfo[];
    contextualData: ContextualData;
}

// Інтерфейс для опису створення потоку
export interface ThreadCreation {
    type: 'std::thread' | 'std::async' | 'pthread_create' | 'unknown';
    line: number;
    column: number;
    functionName?: string;
    parameters?: string[];
    context: string;
    creationContext: CreationContext;
}

// Інтерфейс для опису контексту створення потоку
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

// Інтерфейс для опису примітивів синхронізації
export interface SynchronizationPrimitive {
    type: 'mutex' | 'lock_guard' | 'unique_lock' | 'condition_variable' | 'atomic' | 'shared_ptr';
    line: number;
    column: number;
    name?: string;
    context: string;
    scopeLevel: number;
    associatedThreads?: string[];
}

// Інтерфейс для опису функцій у коді
export interface FunctionInfo {
    name: string;
    line: number;
    column: number;
    isThreadTarget: boolean;
    callsFromThreads: number;
    synchronizationUsed: string[];
}

// Інтерфейс для зберігання статистики по потоках, синхронізації та спільних ресурсах
export interface ContextualData {
    totalLoopThreads: number;
    conditionalThreads: number;
    nestedSynchronization: SynchronizationPrimitive[];
    sharedResources: SharedResource[];
}

// Інтерфейс для опису спільних ресурсів
export interface SharedResource {
    name: string;
    type: string;
    line: number;
    accessedBy: string[];
    protectedBy?: string[];
}

// Внутрішній інтерфейс для зберігання інформації про контекст вузла
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

// Внутрішній інтерфейс для зберігання інформації про оголошення змінних
interface VariableDeclaration {
    name: string;
    type: string;
    line: number;
    scope: number;
}

// Клас для аналізу потоків у C++ коді
export class ThreadAnalyzer {
    private parser: Parser;
    private declaredThreadVectors: Map<string, VariableDeclaration> = new Map();
    private variableDeclarations: Map<string, VariableDeclaration> = new Map();
    private currentScope: string[] = [];

    // Конструктор ініціалізує парсер для C++
    constructor() {
        this.parser = new Parser();
        this.parser.setLanguage(Cpp as any);
    }

    // Основний метод для аналізу документа VSCode
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

    // Збір оголошень змінних (включаючи std::vector<std::thread>)
    // Цей метод рекурсивно обходить дерево синтаксису та збирає оголошення змінних
    // для векторів потоків та інших змінних, які можуть бути використані у створенні потоків.
    // Він також визначає область видимості кожної змінної для подальшого аналізу.
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

    // Визначаємо чи це нова область видимості
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

    // Рекурсивний обхід дерева синтаксису
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

    // Аналізуємо контекст вузла (чи в циклі, чи в умовному операторі)
    private analyzeNodeContext(
        node: Parser.SyntaxNode,
        sourceCode: string,
        contextStack: ContextInfo[]
    ): ContextInfo {
        const nodeType = node.type;
        const line = node.startPosition.row + 1;
        // Фільтруємо контекст, щоб знайти предків-цикли та предків-умови
        const parentLoops = contextStack.filter(ctx => this.isLoopNode(ctx.type));
        const parentConditionals = contextStack.filter(ctx => this.isConditionalNode(ctx.type) || this.isWithinConditionalScope(ctx, contextStack));
        // Визначаємо, чи є поточний вузол циклом або умовним оператором
        const isCurrentLoop = this.isLoopNode(nodeType);
        const isCurrentConditional = this.isConditionalNode(nodeType) || this.isWithinConditionalScope({ type: nodeType, line } as ContextInfo, contextStack);
        // Визначаємо, чи є поточний вузол в циклі або умовному операторі
        const inLoop = isCurrentLoop || parentLoops.length > 0;
        const inConditional = isCurrentConditional || parentConditionals.length > 0 || this.isInConditionalBranch(node, sourceCode, contextStack);
        // Визначаємо глибину вкладеності циклів та умовних операторів
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

    // Генерує унікальний ідентифікатор для поточного стеку контексту
    private generateScopeId(contextStack: ContextInfo[]): string {
        return contextStack.map(ctx => `${ctx.type}:${ctx.line}`).join('|');
    }

    // Повертає тип циклу для останнього предка-циклу у стеку
    private getLastAncestorLoopType(parentLoops: ContextInfo[]): 'for' | 'while' | 'do-while' | undefined {
        if (!parentLoops.length) return undefined;
        return this.getLoopType(parentLoops[parentLoops.length - 1].type);
    }

    // Повертає тип умовного оператора для останнього предка-умови у стеку
    private getLastAncestorConditionalType(parentConditionals: ContextInfo[]): 'if' | 'switch' | 'ternary' | undefined {
        if (!parentConditionals.length) return undefined;
        return this.getConditionalType(parentConditionals[parentConditionals.length - 1].type);
    }

    // Аналізуємо вузол: потоки, синхронізація, функції, ресурси
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

    // Аналіз створення потоків (async, pthread, emplace_back)
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

    // Витягуємо ім'я вектора для emplace_back
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

    // Рекурсивно шукає перший дочірній вузол з заданим типом
    private findChildOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
        for (const child of node.children) {
            if (child.type === type) return child;
            const found = this.findChildOfType(child, type);
            if (found) return found;
        }
        return null;
    }

    // Аналіз оголошення std::thread
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

    // Формуємо контекст створення потоку
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

    // Оновлюємо статистику по потоках
    private updateContextualStats(threadInfo: ThreadInfo, context: CreationContext) {
        if (context.inLoop) threadInfo.contextualData.totalLoopThreads++;
        if (context.inConditional || context.isInNestedConditional || context.conditionalDepth > 0) {
            threadInfo.contextualData.conditionalThreads++;
        }
    }

    // Аналіз синхронізації (mutex, atomic, condition_variable, shared_ptr)
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

    // Додаємо до nestedSynchronization якщо вкладеність > 2
    private checkNestedSynchronization(
        sync: SynchronizationPrimitive,
        threadInfo: ThreadInfo,
        scopeLevel: number
    ) {
        if (scopeLevel > 2) {
            threadInfo.contextualData.nestedSynchronization.push(sync);
        }
    }

    // Аналіз оголошення shared_ptr
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

    // Аналіз функцій
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

    // Аналіз синхронізації у довільному тілі функції/лямбди
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

    // Пост-обробка: встановлення зв'язків між потоками, функціями, синхронізацією
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
                // 1. Якщо функція явно використовує ім'я цієї примітиви (наприклад, print_mutex)
                if (sync.name && func.synchronizationUsed && func.synchronizationUsed.includes(sync.name)) return true;
                // 2. Якщо функція використовує тип примітиви (mutex, atomic, ...) і це глобальна змінна
                if (func.synchronizationUsed && func.synchronizationUsed.includes(sync.type)) {
                    // Додатково перевіряємо, чи ім'я примітиви згадується у тілі функції
                    if (sync.name && this.functionBodyMentions(sync.name, func, threadInfo)) return true;
                }
                return false;
            });
            sync.associatedThreads = Array.from(new Set(relatedThreads.map(t => t.functionName || 'anonymous')));
        });

        this.analyzeSharedResourceAccess(threadInfo);
        (threadInfo as any).threadSyncReport = this.generateThreadSyncReport(threadInfo);
    }

    // Перевіряє, чи тіло функції містить ім'я примітиви 
    private functionBodyMentions(syncName: string, func: FunctionInfo, threadInfo: ThreadInfo): boolean {
        return func.synchronizationUsed.includes(syncName);
    }

    // Визначаємо які потоки використовують спільні ресурси
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

    // Допоміжні методи для визначення типу вузла
    private isLoopNode(nodeType: string): boolean {
        return ['for_statement', 'while_statement', 'do_statement'].includes(nodeType);
    }

    private isConditionalNode(nodeType: string): boolean {
        return ['if_statement', 'switch_statement', 'conditional_expression', 'else_clause'].includes(nodeType);
    }

    // Повертає тип циклу за типом вузла
    private getLoopType(nodeType: string): 'for' | 'while' | 'do-while' | undefined {
        switch (nodeType) {
            case 'for_statement': return 'for';
            case 'while_statement': return 'while';
            case 'do_statement': return 'do-while';
            default: return undefined;
        }
    }

    // Повертає тип умовного оператора за типом вузла
    private getConditionalType(nodeType: string): 'if' | 'switch' | 'ternary' | undefined {
        switch (nodeType) {
            case 'if_statement': return 'if';
            case 'switch_statement': return 'switch';
            case 'conditional_expression': return 'ternary';
            case 'else_clause': return 'if';
            default: return undefined;
        }
    }

    // Повертає тип циклу для найближчого предка у стеку контексту
    private getCurrentLoopType(contextStack: ContextInfo[]): 'for' | 'while' | 'do-while' | undefined {
        for (let i = contextStack.length - 1; i >= 0; i--) {
            if (contextStack[i].loopType) return contextStack[i].loopType;
        }
        return undefined;
    }

    // Повертає тип умовного оператора для найближчого предка у стеку контексту
    private getCurrentConditionalType(contextStack: ContextInfo[]): 'if' | 'switch' | 'ternary' | undefined {
        for (let i = contextStack.length - 1; i >= 0; i--) {
            if (contextStack[i].conditionalType) return contextStack[i].conditionalType;
        }
        return undefined;
    }

    // Пошук синхронізації у функції
    private findSynchronizationInFunction(
        node: Parser.SyntaxNode,
        sourceCode: string,
        threadInfo: ThreadInfo
    ): string[] {
        const functionBody = sourceCode.slice(node.startIndex, node.endIndex);
        return this.findSynchronizationInFunctionBody(functionBody, threadInfo);
    }

    // Витягуємо ім'я функції
    private extractFunctionName(node: Parser.SyntaxNode, sourceCode: string): string | undefined {
        for (const child of node.children) {
            if (child.type === 'identifier') return sourceCode.slice(child.startIndex, child.endIndex);
            if (child.type === 'function_declarator') return this.extractFunctionName(child, sourceCode);
        }
        return undefined;
    }

    // Перевірка патерну
    private matchesPattern(text: string, pattern: RegExp): boolean {
        return pattern.test(text);
    }

    // Витягуємо контекст навколо вузла
    private getContext(node: Parser.SyntaxNode, sourceCode: string, maxLength: number = 100): string {
        const context = sourceCode.slice(
            Math.max(0, node.startIndex - 50),
            Math.min(sourceCode.length, node.endIndex + 50)
        );
        return context.length > maxLength ? context.substring(0, maxLength) + '...' : context;
    }

    // Витягуємо ім'я змінної з оголошення
    private extractVariableName(text: string): string | undefined {
        const match = text.match(/(\w+)\s*[;\(=]/);
        return match ? match[1] : undefined;
    }

    // Витягуємо ім'я функції для std::thread
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

    // Витягуємо ціль потоку з виклику emplace_back або push_back
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

    // Витягуємо ім'я функції для std::async
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

    // Витягуємо ім'я функції для pthread_create
    private extractPthreadFunction(callText: string): string | undefined {
        const match = callText.match(/pthread_create\s*\([^,]*,[^,]*,\s*([^,\)]+)/);
        return match ? match[1].trim() : undefined;
    }

    // Чи вузол знаходиться в умовній гілці (if/else)
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

    // Чи контекст є умовним (для вкладених структур)
    private isWithinConditionalScope(ctx: ContextInfo, contextStack: ContextInfo[]): boolean {
        for (let i = contextStack.length - 1; i >= Math.max(0, contextStack.length - 3); i--) {
            const parentCtx = contextStack[i];
            if (this.isConditionalNode(parentCtx.type)) return true;
        }
        return false;
    }

    // Генерує звіт про використання потоками примітивів синхронізації
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