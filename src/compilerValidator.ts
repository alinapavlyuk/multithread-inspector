import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const execAsync = promisify(exec);

export interface CompilationResult {
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
}

export class CompilerValidator {
    private readonly compilers = ['g++', 'clang++', 'cl'];
    private selectedCompiler?: string;

    async validateFile(filePath: string): Promise<boolean> {
        try {
            const result = await this.compileFile(filePath);
            return result.success;
        } catch (error) {
            console.error('Помилка валідації компіляції:', error);
            return false;
        }
    }

    async compileFile(filePath: string): Promise<CompilationResult> {
        // Перевіряємо, чи існує файл
        if (!fs.existsSync(filePath)) {
            throw new Error(`Файл не знайдено: ${filePath}`);
        }

        // Вибираємо компілятор
        if (!this.selectedCompiler) {
            this.selectedCompiler = await this.findAvailableCompiler();
        }

        if (!this.selectedCompiler) {
            throw new Error('Не знайдено жодного C++ компілятора');
        }

        // Генеруємо тимчасове ім'я для вихідного файла
        const outputPath = this.getTempOutputPath(filePath);

        // Формуємо команду компіляції
        const compileCommand = this.buildCompileCommand(
            this.selectedCompiler,
            filePath,
            outputPath
        );

        try {
            console.log(`Виконуємо команду: ${compileCommand}`);

            const { stdout, stderr } = await execAsync(compileCommand);

            // Перевіряємо, чи створився вихідний файл
            const success = fs.existsSync(outputPath);

            // Видаляємо тимчасовий вихідний файл
            this.cleanupTempFile(outputPath);

            return {
                success,
                stdout,
                stderr,
                exitCode: 0
            };
        } catch (error: any) {
            // Видаляємо тимчасовий файл у разі помилки
            this.cleanupTempFile(outputPath);

            return {
                success: false,
                stdout: error.stdout || '',
                stderr: error.stderr || error.message,
                exitCode: error.code || 1
            };
        }
    }

    private async findAvailableCompiler(): Promise<string | undefined> {
        for (const compiler of this.compilers) {
            try {
                await execAsync(`${compiler} --version`);
                console.log(`Знайдено компілятор: ${compiler}`);
                return compiler;
            } catch (error) {
                // Компілятор недоступний, продовжуємо пошук
                continue;
            }
        }
        return undefined;
    }

    private getTempOutputPath(inputPath: string): string {
        const parsedPath = path.parse(inputPath);
        const tempDir = os.tmpdir();
        const tempName = `${parsedPath.name}_${Date.now()}`;

        // Додаємо розширення залежно від платформи
        const extension = os.platform() === 'win32' ? '.exe' : '';

        return path.join(tempDir, `${tempName}${extension}`);
    }

    private buildCompileCommand(compiler: string, inputPath: string, outputPath: string): string {
        if (compiler === 'cl') {
            // MSVC синтаксис
            return `${compiler} /std:c++17 /W3 "${inputPath}" /Fe:"${outputPath}"`;
        } else {
            // GCC/Clang синтаксис
            return `${compiler} -std=c++17 -Wall "${inputPath}" -o "${outputPath}"`;
        }
    }

    private cleanupTempFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                // console.log(`Тимчасовий файл видалено: ${filePath}`);
            }
        } catch (error) {
            // console.warn(`Не вдалося видалити тимчасовий файл ${filePath}:`, error);
        }
    }

    getSelectedCompiler(): string | undefined {
        return this.selectedCompiler;
    }

    setCompiler(compiler: string): void {
        if (this.compilers.includes(compiler)) {
            this.selectedCompiler = compiler;
        } else {
            throw new Error(`Непідтримуваний компілятор: ${compiler}`);
        }
    }

    async isCompilerAvailable(compiler: string): Promise<boolean> {
        try {
            await execAsync(`${compiler} --version`);
            return true;
        } catch (error) {
            return false;
        }
    }
}