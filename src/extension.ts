import * as vscode from 'vscode';
import { ThreadAnalyzer } from './threadAnalyzer';
import { GraphGenerator } from './graphGenerator';
import { CompilerValidator } from './compilerValidator';
import { ThreadGraphPanel } from './threadGraphPanel';

export function activate(context: vscode.ExtensionContext) {
	const threadAnalyzer = new ThreadAnalyzer();
	const graphGenerator = new GraphGenerator();
	const compilerValidator = new CompilerValidator();

	// Команда для аналізу потоків
	const analyzeCommand = vscode.commands.registerCommand(
		'multithread-inspector.analyzeThreads',
		async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor) {
				vscode.window.showErrorMessage('Немає активного редактора');
				return;
			}

			const document = editor.document;
			if (!['cpp', 'c'].includes(document.languageId)) {
				vscode.window.showErrorMessage('Підтримуються тільки C/C++ файли');
				return;
			}

			try {
				// Показуємо прогрес
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: "Аналіз потоків",
					cancellable: false
				}, async (progress) => {
					progress.report({ increment: 0, message: "Перевірка компіляції..." });

					// Перевіряємо компіляцію
					const isValid = await compilerValidator.validateFile(document.uri.fsPath);
					if (!isValid) {
						vscode.window.showWarningMessage('Файл містить помилки компіляції. Аналіз може бути неточним.');
					}

					progress.report({ increment: 50, message: "Аналіз коду..." });

					// Аналізуємо потоки
					const threadInfo = await threadAnalyzer.analyzeDocument(document);

					progress.report({ increment: 80, message: "Генерація графу..." });

					// Генеруємо граф
					const graphData = graphGenerator.generateGraph(threadInfo);

					progress.report({ increment: 100, message: "Завершено" });

					// Показуємо результати
					ThreadGraphPanel.createOrShow(context.extensionUri, threadInfo, graphData, document.uri.fsPath);

					// Також показуємо короткий звіт
					const message = `Знайдено ${threadInfo.threads.length} потоків та ${threadInfo.synchronization.length} синхронізаційних примітивів`;
					vscode.window.showInformationMessage(message);
				});

			} catch (error) {
				vscode.window.showErrorMessage(`Помилка аналізу: ${error}`);
				console.error('Помилка аналізу потоків:', error);
			}
		}
	);

	// Автоматичне оновлення панелі при збереженні C/C++ файлу
	vscode.workspace.onDidSaveTextDocument(async (document) => {
		// Оновлюємо лише якщо панель відкрита і це C/C++ файл
		if (
			ThreadGraphPanel.currentPanel &&
			['cpp', 'c'].includes(document.languageId)
		) {
			const threadInfo = await threadAnalyzer.analyzeDocument(document);
			const graphData = graphGenerator.generateGraph(threadInfo);
			ThreadGraphPanel.currentPanel['_update'](threadInfo, graphData, document.uri.fsPath);

			const message = `NEW: Знайдено ${threadInfo.threads.length} потоків та ${threadInfo.synchronization.length} синхронізаційних примітивів`;
			vscode.window.showInformationMessage(message);
		}
	});

	context.subscriptions.push(analyzeCommand);
}

export function deactivate() {
	console.log('C++ Thread Analyzer деактивовано');
}