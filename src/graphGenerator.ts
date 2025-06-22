import { ThreadInfo, ThreadCreation, SynchronizationPrimitive } from './threadAnalyzer';

// Опис структури даних для графу потоків
export interface GraphData {
    nodes: GraphNode[]; // Вузли графу
    edges: GraphEdge[]; // Ребра графу
    contextInfo: ContextAnalysis; // Інформація про контекст створення потоків
}

// Вузол графу (потік, синхронізація, головний потік тощо)
export interface GraphNode {
    id: string;
    label: string;
    type: 'main' | 'thread' | 'sync' | 'condition';
    subtype?: string;
    line?: number;
    details?: any;
    x?: number;
    y?: number;
    context?: ThreadContext;
    color?: string;
    shape?: string;
}

// Ребро графу (зв'язок між вузлами)
export interface GraphEdge {
    from: string;
    to: string;
    type: 'creates' | 'calls' | 'synchronizes' | 'waits';
    weight?: number;
    color?: string;
    style?: string;
}

// Контекст створення потоку (чи в циклі/умові)
export interface ThreadContext {
    inLoop: boolean;
    inConditional: boolean;
    conditionalType?: string;
    loopType?: string;
    nesting: number;
}

// Інформація про потоки, створені в умовах/циклах
export interface ContextAnalysis {
    conditionalThreads: ThreadCreation[];
    loopThreads: ThreadCreation[];
}

// Клас для генерації графу потоків та його візуалізації
export class GraphGenerator {
    private readonly colors = {
        main: '#4A90E2',
        thread: {
            normal: '#7ED321',
            conditional: '#F4ED24',
            loop: '#24EDF4',
            both: '#FF8282'
        },
        sync: {
            mutex: '#C5EAE6',
            atomic: '#B388FF',
            condition: '#FFD180',
            shared_ptr: '#BCAAA4',
            lock_guard: '#F8BBD0',
            unique_lock: '#D1C4E9'
        },
        edge: {
            creates: '#2196F3',
            synchronizes: '#F44336',
            influences: '#FF9800',
            waits: '#9C27B0',
        }
    };

    // Генерує структуру графу потоків на основі ThreadInfo
    generateGraph(threadInfo: ThreadInfo): GraphData {
        const contextInfo = this.analyzeContext(threadInfo);
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        // Додаємо головний вузол (main thread)
        nodes.push({
            id: 'main',
            label: 'Main Thread',
            type: 'main',
            color: this.colors.main,
            shape: 'ellipse'
        });

        // Додаємо вузли потоків та синхронізації
        this.addThreadNodes(threadInfo, contextInfo, nodes, edges);
        this.addSyncNodes(threadInfo, nodes, edges);

        return {
            nodes,
            edges,
            contextInfo
        };
    }

    // Аналізує потоки на предмет створення в умовах та циклах
    private analyzeContext(threadInfo: ThreadInfo): ContextAnalysis {
        const conditionalThreads: ThreadCreation[] = [];
        const loopThreads: ThreadCreation[] = [];

        threadInfo.threads.forEach(thread => {
            if (this.isConditionalContext(thread)) conditionalThreads.push(thread);
            if (this.isLoopContext(thread)) loopThreads.push(thread);
        });

        return {
            conditionalThreads,
            loopThreads
        };
    }

    // Визначає, чи створено потік в умовному контексті (if, switch, ?)
    private isConditionalContext(thread: ThreadCreation): boolean {
        if ((thread as any).creationContext && typeof (thread as any).creationContext.inConditional === 'boolean') {
            return (thread as any).creationContext.inConditional;
        }
        return false;
    }

    // Визначає, чи створено потік у циклі (for, while, do)
    private isLoopContext(thread: ThreadCreation): boolean {
        if ((thread as any).creationContext && typeof (thread as any).creationContext.inLoop === 'boolean') {
            return (thread as any).creationContext.inLoop;
        }
        return false;
    }

    // Додаємо вузли потоків
    private addThreadNodes(
        threadInfo: ThreadInfo,
        contextInfo: ContextAnalysis,
        nodes: GraphNode[],
        edges: GraphEdge[]
    ): void {
        const threadGroups = this.groupThreadsByContext(threadInfo.threads, contextInfo);

        Object.entries(threadGroups).forEach(([_, threads], index) => {
            const threadId = `thread_group_${index}`;
            const isConditional = contextInfo.conditionalThreads.some(ct =>
                threads.some(t => t.line === ct.line));
            const isLoop = contextInfo.loopThreads.some(lt =>
                threads.some(t => t.line === lt.line));

            let color = this.colors.thread.normal;
            let subtype: string | undefined;

            if (isConditional && isLoop) {
                color = this.colors.thread.both;
                subtype = 'loop + cond';
            } else if (isConditional) {
                color = this.colors.thread.conditional;
                subtype = 'conditional';
            } else if (isLoop) {
                color = this.colors.thread.loop;
                subtype = 'loop';
            }

            const count = threads.length;
            const funcName = threads[0].functionName || 'anonymous';
            let label = `${count}x Threads\n${funcName}`;

            if (subtype) label += `\n[${subtype.toUpperCase()}]`;
            label += `\nLines: ${threads.map(t => t.line).join(',')}`;

            nodes.push({
                id: threadId,
                label,
                type: 'thread',
                subtype,
                details: threads,
                color,
                shape: 'box'
            });

            edges.push({
                from: 'main',
                to: threadId,
                type: 'creates',
                color: this.colors.edge.creates,
                weight: threads.length
            });
        });
    }

    // Додаємо вузли синхронізації
    private addSyncNodes(
        threadInfo: ThreadInfo,
        nodes: GraphNode[],
        edges: GraphEdge[]
    ): void {
        const syncGroups = this.groupSyncByType(threadInfo.synchronization);

        Object.entries(syncGroups).forEach(([syncType, syncs], index) => {
            const syncId = `sync_group_${index}`;
            const count = syncs.length;

            let color = this.colors.sync.mutex;
            let shape = 'diamond';

            switch (syncType) {
                case 'mutex':
                    color = this.colors.sync.mutex;
                    break;
                case 'atomic':
                    color = this.colors.sync.atomic;
                    shape = 'hexagon';
                    break;
                case 'condition_variable':
                    color = this.colors.sync.condition;
                    shape = 'parallelogram';
                    break;
                case 'shared_ptr':
                    color = this.colors.sync.shared_ptr;
                    shape = 'house';
                    break;
                case 'lock_guard':
                    color = this.colors.sync.lock_guard;
                    break;
                case 'unique_lock':
                    color = this.colors.sync.unique_lock;
                    break;
            }

            const label = `${count}x ${syncType.replace('_', ' ')}\nLines: ${syncs.map(s => s.line).join(',')}`;

            nodes.push({
                id: syncId,
                label,
                type: 'sync',
                subtype: syncType,
                details: syncs,
                color,
                shape
            });

            let edgeType: GraphEdge['type'] = 'synchronizes';
            let edgeColor = this.colors.edge.synchronizes;

            if (syncType === 'condition_variable') {
                edgeType = 'waits';
                edgeColor = this.colors.edge.waits;
            }

            // Знаходимо пов'язані потоки для синхронізації
            const relatedThreads = new Set<string>();
            syncs.forEach(sync => {
                if (sync.associatedThreads && sync.associatedThreads.length > 0) {
                    sync.associatedThreads.forEach(fn => {
                        nodes
                            .filter(n =>
                                n.type === 'thread' &&
                                n.details &&
                                n.details.some((t: any) => t.functionName === fn)
                            )
                            .forEach(threadNode => {
                                relatedThreads.add(threadNode.id);
                            });
                    });
                }
            });

            if (relatedThreads.size === 0) {
                edges.push({
                    from: 'main',
                    to: syncId,
                    type: edgeType,
                    color: edgeColor
                });
            } else {
                relatedThreads.forEach(threadNodeId => {
                    edges.push({
                        from: threadNodeId,
                        to: syncId,
                        type: edgeType,
                        color: edgeColor
                    });
                });
            }
        });
    }

    // Групування потоків за контекстом
    private groupThreadsByContext(
        threads: ThreadCreation[],
        contextInfo: ContextAnalysis
    ): { [key: string]: ThreadCreation[] } {
        const groups: { [key: string]: ThreadCreation[] } = {};

        threads.forEach(thread => {
            const creationContext = (thread as any).creationContext || {};
            const isConditional = typeof creationContext.inConditional === 'boolean' ? creationContext.inConditional : false;
            const isLoop = typeof creationContext.inLoop === 'boolean' ? creationContext.inLoop : false;

            let contextSuffix = '';
            if (isConditional && isLoop) {
                contextSuffix = '_conditional_loop';
            } else if (isConditional) {
                contextSuffix = '_conditional';
            } else if (isLoop) {
                contextSuffix = '_loop';
            }

            let groupingAnchor = '';
            if (creationContext.parentLoops && creationContext.parentLoops.length > 0) {
                groupingAnchor = '_loop_' + creationContext.parentLoops[creationContext.parentLoops.length - 1];
            } else if (creationContext.parentConditionals && creationContext.parentConditionals.length > 0) {
                groupingAnchor = '_cond_' + creationContext.parentConditionals[creationContext.parentConditionals.length - 1];
            } else if (creationContext.conditionalType === 'switch' && typeof creationContext.nestingLevel === 'number') {
                groupingAnchor = '_switch_' + creationContext.nestingLevel;
            }

            const key = (thread.functionName || 'anonymous') + contextSuffix + groupingAnchor;

            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(thread);
        });

        return groups;
    }

    // Групування синхронізації за типом
    private groupSyncByType(syncs: SynchronizationPrimitive[]): { [key: string]: SynchronizationPrimitive[] } {
        const groups: { [key: string]: SynchronizationPrimitive[] } = {};

        syncs.forEach(sync => {
            let key = sync.type;

            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(sync);
        });

        return groups;
    }

    // Генерація HTML-візуалізації графу (без інтерактивності)
    generateHTMLVisualization(threadInfo: ThreadInfo, sourceFilePath?: string): string {
        const graphData = this.generateGraph(threadInfo);
        const positionedNodes = this.calculateNodePositions(graphData.nodes, graphData.edges);

        const svgWidth = 1400;
        const svgHeight = 800;

        let html = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
            min-height: 90vh;
        }
        .thread-graph {
            background-color: white;
            border-radius: 15px;
            padding: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            max-width: 100%;
            overflow-x: auto;
        }
        .header {
            text-align: center;
            margin-bottom: 30px;
            color: #333;
        }
        .summary {
            background: linear-gradient(135deg, #e8f4fd 0%, #f0f8ff 100%);
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 25px;
            border-left: 5px solid #2196F3;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .stat-item {
            background: rgba(255,255,255,0.8);
            padding: 15px;
            border-radius: 8px;
            text-align: center;
            border: 2px solid transparent;
            transition: all 0.3s ease;
        }
        .stat-item:hover {
            border-color: #2196F3;
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: #2196F3;
        }
        .graph-container {
            text-align: center;
            margin: 25px 0;
            position: relative;
        }
        .controls {
            margin-bottom: 20px;
            text-align: center;
        }
        .zoom-btn {
            background: #2196F3;
            color: white;
            border: none;
            padding: 10px 20px;
            margin: 0 5px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.3s ease;
        }
        .zoom-btn:hover {
            background: #1976D2;
            transform: translateY(-1px);
        }
        .svg-container {
            border: 2px solid #ddd;
            border-radius: 10px;
            overflow: hidden;
            background: #fafafa;
            position: relative;
            width: 100%;
            max-width: 100vw;
            height: 600px;
        }
        .node-text {
            font-size: 11px;
            text-anchor: middle;
            dominant-baseline: central;
            font-weight: 600;
            text-shadow: 1px 1px 2px rgba(255,255,255,0.8);
        }
        .edge-text {
            font-size: 9px;
            text-anchor: middle;
            fill: #444;
            font-weight: bold;
            text-shadow: 1px 1px 2px rgba(255,255,255,0.9);
        }
        .legend-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-top: 25px;
        }
        .legend {
            padding: 20px;
            background: #f9f9f9;
            border-radius: 10px;
            border: 1px solid #e0e0e0;
        }
        .legend h4 {
            margin-top: 0;
            color: #333;
            border-bottom: 2px solid #2196F3;
            padding-bottom: 10px;
        }
        .legend-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px;
            background: white;
            border-radius: 5px;
            transition: all 0.3s ease;
        }
        .legend-item:hover {
            transform: translateX(5px);
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .legend-color {
            width: 24px;
            height: 24px;
            border-radius: 4px;
            border: 2px solid #333;
            flex-shrink: 0;
        }
        .connections-info {
            margin-top: 15px;
        }
        .connection-type {
            margin: 8px 0;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px;
            background: white;
            border-radius: 5px;
        }
        .connection-line {
            width: 40px;
            height: 3px;
            border-radius: 2px;
        }
        .pattern-item {
            background: white;
            padding: 12px;
            margin: 8px 0;
            border-radius: 5px;
            border-left: 4px solid #4CAF50;
        }
        .pattern-confidence {
            float: right;
            background: #4CAF50;
            color: white;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 0.8em;
        }
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.05); }
            100% { transform: scale(1); }
        }
        .interactive-node {
            cursor: pointer;
            transition: all 0.3s ease;
        }
        .interactive-node:hover {
            animation: pulse 0.6s infinite;
        }
    </style>
</head>
<body>
    <div class="thread-graph">
        <div class="summary">
            <h2>Analysis Summary</h2>
            <div class="stats-grid">
                <div class="stat-item">
                    <div>Total Threads: ${threadInfo.threads.length}</div>
                </div>
                <div class="stat-item">
                    <div>Conditional Threads: ${graphData.contextInfo.conditionalThreads.length}</div>
                </div>
                <div class="stat-item">
                    <div>Loop Threads: ${graphData.contextInfo.loopThreads.length}</div>
                </div>
                <div class="stat-item">
                    <div>Sync Primitives: ${threadInfo.synchronization.length}</div>
                </div>
            </div>
        </div>
        <div class="graph-container">
            <h3>🔍 Interactive Thread Flow Visualization</h3>
            <div class="controls">
                <button class="zoom-btn" id="zoomInBtn">🔍 Zoom In</button>
                <button class="zoom-btn" id="zoomOutBtn">🔍 Zoom Out</button>
                <button class="zoom-btn" id="resetZoomBtn">🔄 Reset</button>
            </div>
            <div class="svg-container" style="width: 100%; max-width: 100vw; height: 600px;">
                <svg id="mainSvg" 
                     width="100%" height="100%" 
                     viewBox="0 0 ${svgWidth} ${svgHeight}" 
                     preserveAspectRatio="xMidYMid meet"
                     style="cursor: grab; display: block;">
                    <defs>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                            <feMerge> 
                                <feMergeNode in="coloredBlur"/>
                                <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                        </filter>
                        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                            <feDropShadow dx="2" dy="2" stdDeviation="2" flood-opacity="0.3"/>
                        </filter>
                    </defs>
                    <g id="graphGroup" transform="translate(0,0) scale(1)">`;

        // Відмальовуємо ребра графу (без підписів)
        graphData.edges.forEach((edge) => {
            const fromNode = positionedNodes.find(n => n.id === edge.from);
            const toNode = positionedNodes.find(n => n.id === edge.to);

            if (fromNode && toNode) {
                const color = edge.color || '#666';
                const strokeWidth = (edge.weight || 1) + 1;
                const strokeDasharray = this.getEdgeStrokeDashArray(edge.type);

                html += `
                        <line x1="${fromNode.x}" y1="${fromNode.y}" 
                              x2="${toNode.x}" y2="${toNode.y}" 
                              stroke="${color}" stroke-width="${strokeWidth}" 
                              stroke-dasharray="${strokeDasharray}"
                              filter="url(#shadow)"
                              class="interactive-edge"
                              style="transition: all 0.3s ease;">
                            <animate attributeName="stroke-opacity" 
                                     values="0.7;1;0.7" 
                                     dur="2s" 
                                     repeatCount="indefinite"/>
                        </line>`;
            }
        });

        // Відмальовуємо вузли графу
        positionedNodes.forEach(node => {
            const nodeWidth = this.getNodeWidth(node);
            const nodeHeight = this.getNodeHeight(node);
            const color = node.color || '#FFFFFF';

            let nodeClass = 'interactive-node';
            let dataLine = '';

            // Додаємо клас для вузлів з умовами/циклами
            if (node.type === 'thread' && node.details && Array.isArray(node.details) && node.details.length > 0) {
                const t = node.details[0];
                if (t.line !== undefined) dataLine = `data-line="${t.line}"`;
                nodeClass += ' node';
            } else if (node.type === 'sync' && node.details && Array.isArray(node.details) && node.details.length > 0) {
                const s = node.details[0];
                if (s.line !== undefined) dataLine = `data-line="${s.line}"`;
                nodeClass += ' node';
            }

            html += `
                    <g class="${nodeClass}" ${dataLine} data-node='${JSON.stringify(node).replace(/'/g, "&apos;")}'>`;

            if (node.shape === 'diamond' || node.type === 'sync') {
                const points = [
                    [node.x!, node.y! - nodeHeight / 2],
                    [node.x! + nodeWidth / 2, node.y!],
                    [node.x!, node.y! + nodeHeight / 2],
                    [node.x! - nodeWidth / 2, node.y!]
                ].map(p => p.join(',')).join(' ');

                html += `
                        <polygon points="${points}" 
                                 fill="${color}" 
                                 stroke="#333" stroke-width="2" 
                                 filter="url(#shadow)"
                                 style="transition: all 0.3s ease;">
                            <animate attributeName="fill-opacity" 
                                     values="0.8;1;0.8" 
                                     dur="3s" 
                                     repeatCount="indefinite"/>
                        </polygon>`;
            } else if (node.shape === 'ellipse' || node.type === 'main') {
                // Еліпс для головного потоку та змінних
                html += `
                        <ellipse cx="${node.x}" cy="${node.y}" 
                                 rx="${nodeWidth / 2}" ry="${nodeHeight / 2}" 
                                 fill="${color}" 
                                 stroke="#333" stroke-width="${node.type === 'main' ? '3' : '2'}" 
                                 filter="url(#shadow)"
                                 style="transition: all 0.3s ease;">
                            <animate attributeName="fill-opacity" 
                                     values="0.8;1;0.8" 
                                     dur="3s" 
                                     repeatCount="indefinite"/>
                        </ellipse>`;
            } else {
                // Прямокутник для потоків
                const rx = node.type === 'main' as GraphNode['type'] ? '25' : '8';
                let strokeDasharray = 'none';

                if (node.subtype === 'conditional') {
                    strokeDasharray = '8,4';
                } else if (node.subtype === 'loop') {
                    strokeDasharray = '4,4';
                }

                html += `
                        <rect x="${node.x! - nodeWidth / 2}" y="${node.y! - nodeHeight / 2}" 
                              width="${nodeWidth}" height="${nodeHeight}" 
                              fill="${color}" 
                              stroke="#333" stroke-width="2" rx="${rx}" 
                              stroke-dasharray="${strokeDasharray}"
                              filter="url(#shadow)"
                              style="transition: all 0.3s ease;">
                            <animate attributeName="fill-opacity" 
                                     values="0.8;1;0.8" 
                                     dur="3s" 
                                     repeatCount="indefinite"/>
                        </rect>`;
            }

            // Форматування тексту у вузлі
            const lines = node.label.replace(/\\n/g, '\n').split('\n');
            const maxLength = this.getMaxTextLength(node);

            const processedLines = lines.map(line => {
                return line.length > maxLength ? line.substring(0, maxLength - 3) + '...' : line;
            });

            processedLines.forEach((line, i) => {
                const yOffset = (i - (processedLines.length - 1) / 2) * 14;
                let textColor = '#333';
                let fontWeight = 'normal';

                // Виділення для різних типів рядків
                if (line.includes('[') && line.includes(']')) {
                    textColor = '#b20c0c';
                    fontWeight = 'bold';
                } else if (line.includes('x ') && (line.includes('Thread') || line.includes('mutex') || line.includes('atomic'))) {
                    fontWeight = 'bold';
                }

                html += `
                        <text x="${node.x! - (nodeWidth / 4)}" y="${node.y! + yOffset}" 
                              class="node-text" fill="${textColor}" 
                              font-weight="${fontWeight}"
                              filter="url(#shadow)">${line}</text>`;
            });

            html += `
                    </g>`;
        });

        html += `
                    </g>
                </svg>
            </div>
        </div>
        
        <div class="legend-container">
            <div class="legend">                
                <div class="connections-info">
                    <h4>🔗 Connection Types</h4>
                    <div class="connection-type">
                        <div class="connection-line" style="background-color: ${this.colors.edge.creates};"></div>
                        <span>Creates (solid)</span>
                    </div>
                    <div class="connection-type">
                        <div class="connection-line" style="background-color: ${this.colors.edge.synchronizes}; background-image: repeating-linear-gradient(90deg, transparent, transparent 2px, white 2px, white 4px);"></div>
                        <span>Synchronizes (dotted)</span>
                    </div>
                    <div class="connection-type">
                        <div class="connection-line" style="background-color: ${this.colors.edge.influences}; background-image: repeating-linear-gradient(90deg, transparent, transparent 3px, white 3px, white 6px);"></div>
                        <span>Influences (dashed)</span>
                    </div>
                    <div class="connection-type">
                        <div class="connection-line" style="background-color: ${this.colors.edge.waits};"></div>
                        <span>Waits (solid, purple)</span>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <script>
        console.log("sourceFilePath:", ${JSON.stringify(sourceFilePath || '')});
        window.THREAD_ANALYZER_FILE = ${JSON.stringify(sourceFilePath || '')};
    </script>
    <script>
        let currentZoom = 1;
        let currentTranslate = { x: 0, y: 0 };

        const svg = document.getElementById('mainSvg');
        const graphGroup = document.getElementById('graphGroup');
        const zoomInBtn = document.getElementById('zoomInBtn');
        const zoomOutBtn = document.getElementById('zoomOutBtn');
        const resetZoomBtn = document.getElementById('resetZoomBtn');

        let isDragging = false;
        let dragStart = { x: 0, y: 0 };
        let dragOrigin = { x: 0, y: 0 };

        svg.addEventListener('mousedown', (e) => {
            isDragging = true;
            svg.style.cursor = 'grabbing';
            dragStart = getSvgPoint(e);
            dragOrigin = { ...currentTranslate };
        });

        svg.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const pt = getSvgPoint(e);
            currentTranslate.x = dragOrigin.x + (pt.x - dragStart.x);
            currentTranslate.y = dragOrigin.y + (pt.y - dragStart.y);
            updateTransform();
        });

        svg.addEventListener('mouseup', () => {
            isDragging = false;
            svg.style.cursor = 'grab';
        });
        svg.addEventListener('mouseleave', () => {
            isDragging = false;
            svg.style.cursor = 'grab';
        });

        function getSvgPoint(evt) {
            const rect = svg.getBoundingClientRect();
            // координати у viewBox
            const x = (evt.clientX - rect.left) * (${svgWidth} / rect.width);
            const y = (evt.clientY - rect.top) * (${svgHeight} / rect.height);
            return { x, y };
        }

        function zoomAt(factor, centerX, centerY) {
            const prevZoom = currentZoom;
            currentZoom = Math.max(0.3, Math.min(3, currentZoom * factor));
            // Центруємо zoom навколо точки centerX, centerY
            currentTranslate.x = (currentTranslate.x - centerX) * (currentZoom / prevZoom) + centerX;
            currentTranslate.y = (currentTranslate.y - centerY) * (currentZoom / prevZoom) + centerY;
            updateTransform();
        }

        function zoomIn() {
            zoomAt(1.2, ${svgWidth}/2, ${svgHeight}/2);
        }

        function zoomOut() {
            zoomAt(1/1.2, ${svgWidth}/2, ${svgHeight}/2);
        }

        function resetZoom() {
            currentZoom = 1;
            currentTranslate = { x: 0, y: 0 };
            updateTransform();
        }

        function updateTransform() {
            graphGroup.setAttribute('transform', 
                \`translate(\${currentTranslate.x}, \${currentTranslate.y}) scale(\${currentZoom})\`);
        }

        zoomInBtn.onclick = zoomIn;
        zoomOutBtn.onclick = zoomOut;
        resetZoomBtn.onclick = resetZoom;

        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            // Zoom до точки під курсором
            const pt = getSvgPoint(e);
            const factor = e.deltaY < 0 ? 1.2 : 1/1.2;
            zoomAt(factor, pt.x, pt.y);
        });

        const nodes = document.querySelectorAll('.node[data-line]');
        nodes.forEach(node => {
            node.addEventListener('click', function() {
                const line = this.getAttribute('data-line');
                const file = window.THREAD_ANALYZER_FILE;
                if (line && file) {
                    vscode.postMessage({
                        command: 'openFile',
                        file: file,
                        line: parseInt(line)
                    });
                }
            });
        });
    </script>
</body>
</html>`;
        return html;
    }

    // Визначає ширину вузла в залежності від типу
    private getNodeWidth(node: GraphNode): number {
        switch (node.type) {
            case 'main': return 120;
            case 'thread': return 180;
            case 'sync': return 160;
            default: return 140;
        }
    }

    // Визначає висоту вузла в залежності від типу
    private getNodeHeight(node: GraphNode): number {
        switch (node.type) {
            case 'main': return 60;
            case 'thread': return 90;
            case 'sync': return 80;
            default: return 70;
        }
    }

    // Максимальна довжина тексту в одному рядку вузла
    private getMaxTextLength(node: GraphNode): number {
        switch (node.type) {
            case 'sync': return 12;
            case 'main': return 15;
            default: return 18;
        }
    }

    // Визначає стиль лінії для ребра в залежності від типу зв'язку
    private getEdgeStrokeDashArray(edgeType: GraphEdge['type']): string {
        switch (edgeType) {
            case 'creates': return 'none';
            case 'synchronizes': return '4,4';
            case 'waits': return 'none';
            default: return 'none';
        }
    }

    // Розрахунок позицій вузлів для графу
    private calculateNodePositions(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[] {
        const positionedNodes = [...nodes];
        const nodeWidth = 200;
        const levelHeight = 150;
        const nodeSpacing = 220;
        const startY = 100;
        const svgWidth = 1400;

        const mainNodes = positionedNodes.filter(n => n.type === 'main');
        const threadNodes = positionedNodes.filter(n => n.type === 'thread');
        const syncNodes = positionedNodes.filter(n => n.type === 'sync');

        if (mainNodes.length > 0) {
            mainNodes[0].x = svgWidth / 2;
            mainNodes[0].y = startY;
        }
        if (threadNodes.length > 0) {
            const totalWidth = Math.min(threadNodes.length * nodeSpacing, svgWidth - 100);
            const startX = (svgWidth - totalWidth) / 2 + nodeSpacing / 2;
            threadNodes.forEach((node, index) => {
                if (threadNodes.length === 1) {
                    node.x = svgWidth / 2 + 120;
                } else {
                    node.x = startX + (index * totalWidth / Math.max(threadNodes.length - 1, 1));
                }
                node.y = startY + levelHeight;
            });
        }
        if (syncNodes.length > 0) {
            const totalWidth = Math.min(syncNodes.length * nodeSpacing, svgWidth - 100);
            const startX = (svgWidth - totalWidth) / 2 + nodeSpacing / 2;
            syncNodes.forEach((node, index) => {
                node.x = startX + (index * totalWidth / Math.max(syncNodes.length - 1, 1));
                node.y = startY + levelHeight * 2;
            });
        }
        return positionedNodes;
    }

    // Генерація текстового звіту
    generateSimpleTextReport(threadInfo: ThreadInfo): string {
        const graphData = this.generateGraph(threadInfo);
        let report = '=== C++ Thread Analysis Report ===\n\n';

        report += `📊 SUMMARY:\n`;
        report += `Total Threads: ${threadInfo.threads.length}\n`;
        report += `Conditional Threads: ${graphData.contextInfo.conditionalThreads.length}\n`;
        report += `Loop Threads: ${graphData.contextInfo.loopThreads.length}\n`;
        report += `Synchronization Primitives: ${threadInfo.synchronization.length}\n`;

        report += `🧵 THREAD ANALYSIS:\n`;
        threadInfo.threads.forEach((thread, index) => {
            report += `  ${index + 1}. ${thread.type} at line ${thread.line}`;
            if (thread.functionName) {
                report += ` -> ${thread.functionName}`;
            }
            const isConditional = graphData.contextInfo.conditionalThreads.includes(thread);
            const isLoop = graphData.contextInfo.loopThreads.includes(thread);
            if (isConditional || isLoop) {
                report += ' [';
                if (isConditional) report += 'CONDITIONAL';
                if (isConditional && isLoop) report += ', ';
                if (isLoop) report += 'LOOP';
                report += ']';
            }
            report += '\n';
        });

        report += `\n🔗 THREAD TO SYNC PRIMITIVES USAGE:\n`;
        for (const thread of threadInfo.threads) {
            const threadName = thread.functionName || 'anonymous';
            const func = threadInfo.functions.find(f => f.name === thread.functionName);
            if (!func) continue;
            const usedSyncs = threadInfo.synchronization
                .filter(sync => func.synchronizationUsed.includes(sync.name || ''))
                .map(sync => sync.name)
                .filter(Boolean);
            report += `  - Thread "${threadName}" uses sync primitives: ${usedSyncs.length > 0 ? usedSyncs.join(', ') : 'none'}\n`;
        }

        if (threadInfo.synchronization.length > 0) {
            report += `\n🔒 SYNCHRONIZATION ANALYSIS:\n`;

            const syncGroups = this.groupSyncByType(threadInfo.synchronization);
            Object.entries(syncGroups).forEach(([type, syncs]) => {
                report += `  ${type.toUpperCase()}: ${syncs.length} instance(s)\n`;
                syncs.forEach((sync, index) => {
                    report += `    ${index + 1}. `;
                    if (sync.name) report += `${sync.name} `;
                    report += `at line ${sync.line}\n`;
                });
            });
        }

        return report;
    }
}