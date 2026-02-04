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
            console.error('Compilation validation error:', error);
            return false;
        }
    }

    async compileFile(filePath: string): Promise<CompilationResult> {
        // Check if the file exists
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        // Select the compiler
        if (!this.selectedCompiler) {
            this.selectedCompiler = await this.findAvailableCompiler();
        }

        if (!this.selectedCompiler) {
            throw new Error('No C++ compiler found');
        }

        // Generate a temporary name for the output file
        const outputPath = this.getTempOutputPath(filePath);

        // Form the compilation command
        const compileCommand = this.buildCompileCommand(
            this.selectedCompiler,
            filePath,
            outputPath
        );

        try {
            console.log(`Executing command: ${compileCommand}`);

            const { stdout, stderr } = await execAsync(compileCommand);

            // Check if the output file was created
            const success = fs.existsSync(outputPath);

            // Delete the temporary output file
            this.cleanupTempFile(outputPath);

            return {
                success,
                stdout,
                stderr,
                exitCode: 0
            };
        } catch (error: any) {
            // Delete the temporary file in case of an error
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
                console.log(`Found compiler: ${compiler}`);
                return compiler;
            } catch (error) {
                // Compiler is not available, continue searching
                continue;
            }
        }
        return undefined;
    }

    private getTempOutputPath(inputPath: string): string {
        const parsedPath = path.parse(inputPath);
        const tempDir = os.tmpdir();
        const tempName = `${parsedPath.name}_${Date.now()}`;

        // Add extension depending on the platform
        const extension = os.platform() === 'win32' ? '.exe' : '';

        return path.join(tempDir, `${tempName}${extension}`);
    }

    private buildCompileCommand(compiler: string, inputPath: string, outputPath: string): string {
        if (compiler === 'cl') {
            // MSVC syntax
            return `${compiler} /std:c++17 /W3 "${inputPath}" /Fe:"${outputPath}"`;
        } else {
            // GCC/Clang syntax
            return `${compiler} -std=c++17 -Wall "${inputPath}" -o "${outputPath}"`;
        }
    }

    private cleanupTempFile(filePath: string): void {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                // console.log(`Temporary file deleted: ${filePath}`);
            }
        } catch (error) {
            // console.warn(`Failed to delete temporary file ${filePath}:`, error);
        }
    }

    getSelectedCompiler(): string | undefined {
        return this.selectedCompiler;
    }

    setCompiler(compiler: string): void {
        if (this.compilers.includes(compiler)) {
            this.selectedCompiler = compiler;
        } else {
            throw new Error(`Unsupported compiler: ${compiler}`);
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