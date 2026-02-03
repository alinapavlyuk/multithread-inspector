import * as vscode from 'vscode';
import { ThreadAnalyzer } from './threadAnalyzer';
import { GraphGenerator } from './graphGenerator';
import { CompilerValidator } from './compilerValidator';
import { ThreadGraphPanel } from './threadGraphPanel';

export function activate(context: vscode.ExtensionContext) {
	const threadAnalyzer = new ThreadAnalyzer();
	const graphGenerator = new GraphGenerator();
	const compilerValidator = new CompilerValidator();

	// Command for thread analysis
	const analyzeCommand = vscode.commands.registerCommand(
		'multithread-inspector.analyzeThreads',
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('No active editor');
				return;
			}

			const document = editor.document;
			if (!['cpp', 'c'].includes(document.languageId)) {
				vscode.window.showErrorMessage('Only C/C++ files are supported');
				return;
			}

			try {
				// Show progress
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: "Analyzing threads",
					cancellable: false
				}, async (progress) => {
					progress.report({ increment: 0, message: "Checking compilation..." });

					// Check compilation
					const isValid = await compilerValidator.validateFile(document.uri.fsPath);
					if (!isValid) {
						vscode.window.showWarningMessage('The file contains compilation errors. Analysis may be inaccurate.');
					}

					progress.report({ increment: 50, message: "Analyzing code..." });

					// Analyze threads
					const threadInfo = await threadAnalyzer.analyzeDocument(document);

					progress.report({ increment: 80, message: "Generating graph..." });

					// Generate graph
					const graphData = graphGenerator.generateGraph(threadInfo);

					progress.report({ increment: 100, message: "Completed" });

					// Show results
					ThreadGraphPanel.createOrShow(context.extensionUri, threadInfo, graphData, document.uri.fsPath);

					// Also show a brief report
					const message = `Found ${threadInfo.threads.length} threads and ${threadInfo.synchronization.length} synchronization primitives`;
					vscode.window.showInformationMessage(message);
				});

			} catch (error) {
				vscode.window.showErrorMessage(`Analysis error: ${error}`);
				console.error('Thread analysis error:', error);
			}
		}
	);

	// Automatic panel update on saving a C/C++ file
	vscode.workspace.onDidSaveTextDocument(async (document) => {
		// Update only if the panel is open and it's a C/C++ file
		if (
			ThreadGraphPanel.currentPanel &&
			['cpp', 'c'].includes(document.languageId)
		) {
			const threadInfo = await threadAnalyzer.analyzeDocument(document);
			const graphData = graphGenerator.generateGraph(threadInfo);
			ThreadGraphPanel.currentPanel['_update'](threadInfo, graphData, document.uri.fsPath);

			const message = `NEW: Found ${threadInfo.threads.length} threads and ${threadInfo.synchronization.length} synchronization primitives`;
			vscode.window.showInformationMessage(message);
		}
	});

	context.subscriptions.push(analyzeCommand);
}

export function deactivate() {
	console.log('C++ Thread Analyzer deactivated');
}