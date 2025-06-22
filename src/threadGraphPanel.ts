import * as vscode from 'vscode';
import { ThreadInfo } from './threadAnalyzer';
import { GraphData, GraphGenerator } from './graphGenerator';

// Клас для відображення панелі з графом потоків у VSCode
export class ThreadGraphPanel {
    // Зберігаємо поточну відкриту панель (щоб не створювати дублікати)
    public static currentPanel: ThreadGraphPanel | undefined;
    public static readonly viewType = 'threadGraphView';

    // Зберігаємо посилання на панель, URI розширення та масив для підписок
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    // Створюємо або показуємо панель з графом потоків
    public static createOrShow(extensionUri: vscode.Uri, threadInfo?: ThreadInfo, graphData?: GraphData, filePath?: string) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Якщо панель вже відкрита — просто оновлюємо її
        if (ThreadGraphPanel.currentPanel) {
            ThreadGraphPanel.currentPanel._panel.reveal(column);
            if (threadInfo && graphData) {
                ThreadGraphPanel.currentPanel._update(threadInfo, graphData, filePath);
            }
            return;
        }

        // Створюємо нову панель
        const panel = vscode.window.createWebviewPanel(
            ThreadGraphPanel.viewType,
            'C++ Thread Flow Graph',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'media'),
                    vscode.Uri.joinPath(extensionUri, 'out')
                ]
            }
        );

        ThreadGraphPanel.currentPanel = new ThreadGraphPanel(panel, extensionUri);

        // Оновлюємо панель з даними
        if (threadInfo && graphData) {
            ThreadGraphPanel.currentPanel._update(threadInfo, graphData, filePath);
        }
    }

    // Конструктор ініціалізує панель та підписки на події
    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Підписуємося на закриття панелі
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Обробляємо повідомлення з webview (наприклад, відкриття файлу)
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'alert':
                        vscode.window.showInformationMessage(message.text);
                        return;
                    case 'openFile':
                        this._openFileAtLine(message.file, message.line);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    // Оновлюємо панель з новими даними про потоки та граф
    private _update(threadInfo: ThreadInfo, graphData: GraphData, filePath?: string) {
        const webview = this._panel.webview;
        this._panel.title = "C++ Thread Flow Graph";
        this._panel.webview.html = this._getHtmlForWebview(webview, threadInfo, graphData, filePath);
    }

    // Генеруємо HTML для панелі з графом потоків та текстовим звітом
    private _getHtmlForWebview(webview: vscode.Webview, threadInfo: ThreadInfo, graphData: GraphData, filePath?: string): string {
        const graphGenerator = new GraphGenerator();
        const htmlVisualization = graphGenerator.generateHTMLVisualization(threadInfo, filePath);
        const textReport = graphGenerator.generateSimpleTextReport(threadInfo);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thread Flow Graph</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-bottom: 20px;
        }
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border: none;
            background: var(--vscode-tab-inactiveBackground);
            color: var(--vscode-tab-inactiveForeground);
        }
        .tab.active {
            background: var(--vscode-tab-activeBackground);
            color: var(--vscode-tab-activeForeground);
            border-bottom: 2px solid var(--vscode-focusBorder);
        }
        .tab-content {
            display: none;
        }
        .tab-content.active {
            display: block;
        }
        .graph-container {
            border: 1px solid var(--vscode-panel-border);
            padding: 20px;
            border-radius: 5px;
            background-color: var(--vscode-editor-background);
        }
        .summary {
            background-color: var(--vscode-textBlockQuote-background);
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .node {
            display: inline-block;
            padding: 10px;
            margin: 5px;
            border: 2px solid var(--vscode-panel-border);
            border-radius: 5px;
            text-align: center;
            min-width: 120px;
            cursor: pointer;
        }
        .main-thread { 
            background-color: var(--vscode-debugTokenExpression-name); 
            color: var(--vscode-editor-background);
        }
        .thread { 
            background-color: var(--vscode-debugTokenExpression-string); 
            color: var(--vscode-editor-background);
        }
        .function { 
            background-color: var(--vscode-debugTokenExpression-number); 
            color: var(--vscode-editor-background);
        }
        .sync { 
            background-color: var(--vscode-debugTokenExpression-error); 
            color: var(--vscode-editor-background);
        }
        .connections {
            margin: 10px 0;
            font-style: italic;
            color: var(--vscode-descriptionForeground);
        }
        pre {
            background-color: var(--vscode-textPreformat-background);
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
            white-space: pre-wrap;
        }
        .clickable {
            cursor: pointer;
            text-decoration: underline;
        }
        .dot-source {
            font-family: 'Courier New', monospace;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <h1>C++ Thread Flow Analysis Results</h1>
    
    <div class="tabs">
        <button class="tab active" onclick="showTab('visual')">Visual Graph</button>
        <button class="tab" onclick="showTab('report')">Text Report</button>
    </div>

    <div id="visual" class="tab-content active">
        <div class="graph-container">
            ${htmlVisualization.split('<body>')[1].split('</body>')[0]}
        </div>
    </div>

    <div id="report" class="tab-content">
        <pre>${textReport}</pre>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        function showTab(tabName) {
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            document.getElementById(tabName).classList.add('active');
            event.target.classList.add('active');
        }
        function openFileAtLine(line) {
            vscode.postMessage({
                command: 'openFile',
                line: line
            });
        }

        // Use only data-line and global file variable
        const graphNodes = document.querySelectorAll('.node');
        console.log('Nodes found:', graphNodes.length);
        graphNodes.forEach(node => {
            node.addEventListener('click', function() {
                const line = this.getAttribute('data-line');
                const file = window.THREAD_ANALYZER_FILE;
                console.log('Opening file:', file, 'at line:', line);
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
    }

    // Відкриваємо файл у редакторі VSCode та переходимо до вказаного рядка
    private async _openFileAtLine(fileName: string, line: number): Promise<void> {
        try {
            const doc = await vscode.workspace.openTextDocument(fileName);
            const editor = await vscode.window.showTextDocument(doc, { preview: false });
            const position = new vscode.Position(Math.max(0, line - 1), 0);
            const selection = new vscode.Selection(position, position);
            editor.selection = selection;
            editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
        } catch (error) {
            vscode.window.showErrorMessage(`Не вдалося перейти до рядка ${line}: ${error}`);
        }
    }

    // Очищуємо ресурси та закриваємо панель
    public dispose() {
        ThreadGraphPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}