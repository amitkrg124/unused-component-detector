import * as vscode from 'vscode';
import * as path from 'path';
import { DependencyGraph } from './analyzer';
import { getCachedContent } from './scanner';

/**
 * Result of a safety check for component deletion
 */
export interface SafetyCheckResult {
    isSafe: boolean;
    warnings: string[];
    dependents: string[];
    recommendations: string[];
}

/**
 * Options for safety checking
 */
export interface SafetyCheckOptions {
    checkStringReferences?: boolean;
    checkTestFiles?: boolean;
    ignorePatterns?: string[];
}

/**
 * SafetyChecker class for verifying component deletion safety
 * Optimized with caching and reduced file operations
 */
export class SafetyChecker {
    private projectRoot: string;
    private cachedFiles: Map<string, string[]> = new Map();
    private cachedIndexFiles: string[] | null = null;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /**
     * Checks if it's safe to delete a component
     * Optimized with caching and parallel processing
     */
    async checkSafeDeletion(
        componentPath: string,
        dependencyGraph: DependencyGraph,
        _allContent?: Map<string, string>,
        _options?: SafetyCheckOptions
    ): Promise<SafetyCheckResult> {
        const warnings: string[] = [];
        const dependents: string[] = [];
        const recommendations: string[] = [];

        try {
            const componentName = this.extractComponentName(componentPath);
            const directDependents = dependencyGraph[componentPath] || [];
            dependents.push(...directDependents);

            if (directDependents.length > 0) {
                const testFiles = directDependents.filter(file => this.isTestFile(file));
                const nonTestFiles = directDependents.filter(file => !this.isTestFile(file));

                if (nonTestFiles.length > 0) {
                    warnings.push(
                        `Component "${componentName}" is directly imported by ${nonTestFiles.length} file(s):`
                    );
                    nonTestFiles.slice(0, 5).forEach(file => {
                        warnings.push(`  - ${this.getRelativePath(file)}`);
                    });
                    if (nonTestFiles.length > 5) {
                        warnings.push(`  ... and ${nonTestFiles.length - 5} more`);
                    }
                    recommendations.push(
                        `Remove imports from ${nonTestFiles.length} file(s) before deleting`
                    );
                }

                if (testFiles.length > 0) {
                    warnings.push(
                        `Component has ${testFiles.length} test file(s) that import it`
                    );
                    recommendations.push(
                        `Consider updating or removing ${testFiles.length} test file(s)`
                    );
                }
            }

            // Check index exports (quick check using cached content)
            const indexExports = await this.checkIndexExportsFast(componentPath, componentName);
            if (indexExports.length > 0) {
                warnings.push(
                    `Component is exported from ${indexExports.length} index file(s)`
                );
                recommendations.push('Remove exports from index files before deleting');
            }

            // Determine if deletion is safe
            const isSafe = directDependents.length === 0 && indexExports.length === 0;

            if (!isSafe) {
                recommendations.unshift('Review all warnings before deleting this component');
            } else {
                recommendations.push('Component appears safe to delete');
            }

            return {
                isSafe,
                warnings,
                dependents: [...new Set(dependents)],
                recommendations
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            warnings.push(`Error during safety check: ${errorMessage}`);
            recommendations.push('Review the error and try again');

            return {
                isSafe: false,
                warnings,
                dependents,
                recommendations
            };
        }
    }

    /**
     * Fast check for index exports using cached content
     */
    private async checkIndexExportsFast(
        componentPath: string,
        componentName: string
    ): Promise<string[]> {
        const indexFiles: string[] = [];
        const fileName = path.basename(componentPath, path.extname(componentPath));

        // Get cached index files or find them once
        if (!this.cachedIndexFiles) {
            this.cachedIndexFiles = await this.findIndexFiles();
        }

        const searchPatterns = [componentName, fileName];

        for (const indexFile of this.cachedIndexFiles) {
            // Skip if index file is in same directory as component
            if (path.dirname(indexFile) === path.dirname(componentPath)) {
                continue;
            }

            try {
                const content = await getCachedContent(indexFile);
                if (!content) continue;

                // Quick string check before regex
                let hasMatch = false;
                for (const pattern of searchPatterns) {
                    if (content.includes(pattern)) {
                        hasMatch = true;
                        break;
                    }
                }

                if (hasMatch) {
                    // Verify with regex for export statements
                    for (const pattern of searchPatterns) {
                        const exportRegex = new RegExp(
                            `export\\s+.*\\b${this.escapeRegex(pattern)}\\b`,
                            'i'
                        );
                        if (exportRegex.test(content)) {
                            indexFiles.push(indexFile);
                            break;
                        }
                    }
                }
            } catch {
                continue;
            }
        }

        return indexFiles;
    }

    /**
     * Find all index files once and cache them
     */
    private async findIndexFiles(): Promise<string[]> {
        const files: string[] = [];

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return files;

            for (const workspaceFolder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(
                    workspaceFolder,
                    '**/index.{js,jsx,ts,tsx}'
                );

                const foundFiles = await vscode.workspace.findFiles(
                    pattern,
                    '**/node_modules/**',
                    500
                );

                files.push(...foundFiles.map(f => f.fsPath));
            }
        } catch (error) {
            console.error('Error finding index files:', error);
        }

        return files;
    }

    /**
     * Extracts component name from file path
     */
    private extractComponentName(componentPath: string): string {
        const fileName = path.basename(componentPath, path.extname(componentPath));

        if (fileName === 'index') {
            const parentDir = path.basename(path.dirname(componentPath));
            return this.toPascalCase(parentDir);
        }

        return this.toPascalCase(fileName);
    }

    /**
     * Converts a string to PascalCase
     */
    private toPascalCase(str: string): string {
        const parts = str
            .split(/[-_\s]+/)
            .flatMap(part => part.split(/(?=[A-Z])/))
            .filter(part => part.length > 0);

        return parts
            .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join('');
    }

    /**
     * Checks if a file is a test file
     */
    private isTestFile(filePath: string): boolean {
        const fileName = path.basename(filePath).toLowerCase();
        const dirPath = path.dirname(filePath).toLowerCase();

        return dirPath.includes('test') ||
               dirPath.includes('__tests__') ||
               dirPath.includes('spec') ||
               fileName.includes('.test.') ||
               fileName.includes('.spec.');
    }

    /**
     * Gets relative path from project root
     */
    private getRelativePath(filePath: string): string {
        try {
            return path.relative(this.projectRoot, filePath);
        } catch {
            return filePath;
        }
    }

    /**
     * Escapes special regex characters
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Clear cached data
     */
    clearCache(): void {
        this.cachedFiles.clear();
        this.cachedIndexFiles = null;
    }
}
