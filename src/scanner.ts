import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Information about a React component
 */
export interface ComponentInfo {
    filePath: string;
    fileName: string;
    componentName: string;
    size: number;
    lastModified: Date;
}

/**
 * Options for scanning components
 */
export interface ScanOptions {
    excludePatterns?: string[];
    includePatterns?: string[];
}

// Global file content cache for performance
const fileContentCache = new Map<string, string>();

/**
 * Clears the file content cache
 */
export function clearCache(): void {
    fileContentCache.clear();
}

/**
 * Gets cached file content or reads from disk
 */
export async function getCachedContent(filePath: string): Promise<string> {
    if (fileContentCache.has(filePath)) {
        return fileContentCache.get(filePath)!;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        fileContentCache.set(filePath, content);
        return content;
    } catch {
        return '';
    }
}

/**
 * Converts a file name to PascalCase component name
 */
export function toPascalCase(fileName: string): string {
    const nameWithoutExt = path.parse(fileName).name;

    if (nameWithoutExt === 'index') {
        return 'Index';
    }

    const parts = nameWithoutExt
        .split(/[-_\s]+/)
        .flatMap(part => part.split(/(?=[A-Z])/))
        .filter(part => part.length > 0);

    return parts
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('');
}

/**
 * Checks if file content is a React component (sync version for batch processing)
 */
function isReactComponentContent(content: string): boolean {
    // Quick checks first (most common patterns)
    const hasReactImport = content.includes('from \'react\'') ||
                          content.includes('from "react"') ||
                          content.includes('from \'react/');

    const hasJSX = /<[A-Z]/.test(content) || /<\/[A-Z]/.test(content);

    if (!hasReactImport && !hasJSX) {
        return false;
    }

    // Check for component patterns
    const hasComponentPattern =
        /(function|const|class)\s+[A-Z][a-zA-Z0-9]*\s*[=\(]/.test(content) ||
        /export\s+(default\s+)?(function|const|class)\s+[A-Z][a-zA-Z0-9]*/.test(content);

    return (hasReactImport || hasJSX) && (hasJSX || hasComponentPattern);
}

/**
 * Gets file statistics synchronously for better performance
 */
function getFileStatsSync(filePath: string): { size: number; lastModified: Date } {
    try {
        const stats = fs.statSync(filePath);
        return {
            size: stats.size,
            lastModified: stats.mtime
        };
    } catch {
        return { size: 0, lastModified: new Date() };
    }
}

/**
 * Checks if a file should be excluded from scanning
 */
function shouldExcludeFile(filePath: string, options?: ScanOptions): boolean {
    if (filePath.includes('node_modules')) {
        return true;
    }

    // Skip common non-component files
    const fileName = path.basename(filePath).toLowerCase();
    const skipFiles = ['setuptest', 'reportwebvitals', 'serviceWorker', '.d.ts', '.test.', '.spec.'];
    if (skipFiles.some(skip => fileName.includes(skip.toLowerCase()))) {
        return true;
    }

    if (options?.excludePatterns) {
        for (const pattern of options.excludePatterns) {
            if (filePath.includes(pattern)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Process a batch of files in parallel
 */
async function processBatch(
    files: vscode.Uri[],
    options?: ScanOptions,
    batchSize: number = 50
): Promise<ComponentInfo[]> {
    const components: ComponentInfo[] = [];

    // Process files in batches
    for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);

        const batchResults = await Promise.all(
            batch.map(async (file) => {
                const filePath = file.fsPath;

                if (shouldExcludeFile(filePath, options)) {
                    return null;
                }

                try {
                    const content = await getCachedContent(filePath);

                    if (!content || !isReactComponentContent(content)) {
                        return null;
                    }

                    const fileName = path.basename(filePath);
                    const stats = getFileStatsSync(filePath);

                    return {
                        filePath,
                        fileName,
                        componentName: toPascalCase(fileName),
                        size: stats.size,
                        lastModified: stats.lastModified
                    };
                } catch {
                    return null;
                }
            })
        );

        // Filter out nulls and add to results
        components.push(...batchResults.filter((c): c is ComponentInfo => c !== null));
    }

    return components;
}

/**
 * Scans the workspace for React components with optimized parallel processing
 */
export async function scanReactComponents(
    options?: ScanOptions
): Promise<ComponentInfo[]> {
    // Clear cache for fresh scan
    clearCache();

    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('No workspace folder found');
            return [];
        }

        const patterns = options?.includePatterns || ['**/*.{js,jsx,ts,tsx}'];
        const allFiles: vscode.Uri[] = [];

        // Collect all files first (single findFiles call is faster)
        for (const workspaceFolder of workspaceFolders) {
            for (const pattern of patterns) {
                const files = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(workspaceFolder, pattern),
                    '**/node_modules/**',
                    10000
                );
                allFiles.push(...files);
            }
        }

        // Process all files in parallel batches
        const components = await processBatch(allFiles, options);

        // Sort by file path
        components.sort((a, b) => a.filePath.localeCompare(b.filePath));

        return components;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Error scanning React components: ${errorMessage}`);
        console.error('Error scanning React components:', error);
        return [];
    }
}

/**
 * Scans a specific directory for React components
 */
export async function scanDirectory(
    directoryPath: string,
    options?: ScanOptions
): Promise<ComponentInfo[]> {
    try {
        const pattern = new vscode.RelativePattern(
            directoryPath,
            '**/*.{js,jsx,ts,tsx}'
        );

        const files = await vscode.workspace.findFiles(
            pattern,
            '**/node_modules/**',
            10000
        );

        const components = await processBatch(files, options);
        components.sort((a, b) => a.filePath.localeCompare(b.filePath));

        return components;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Error scanning directory: ${errorMessage}`);
        console.error('Error scanning directory:', error);
        return [];
    }
}

/**
 * Export cache for use by other modules
 */
export { fileContentCache };
