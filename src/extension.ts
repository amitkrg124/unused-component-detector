import * as vscode from 'vscode';
import * as path from 'path';
import { scanReactComponents } from './scanner';
import { DependencyAnalyzer } from './analyzer';
import { SafetyChecker } from './safety';
import { UnusedComponentsPanel, UnusedComponentInfo } from './ui';

/**
 * Extension state
 */
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

/**
 * This method is called when the extension is activated
 */
export function activate(context: vscode.ExtensionContext): void {
    console.log('Unused Component Detector extension is now active');

    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('Unused Component Detector');
    outputChannel.appendLine('Unused Component Detector extension activated');

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'unused-component-detector.scan';
    statusBarItem.text = '$(search) Scan Unused Components';
    statusBarItem.tooltip = 'Scan for unused React components';
    statusBarItem.show();

    // Register scan command
    const scanCommand = vscode.commands.registerCommand(
        'unused-component-detector.scan',
        async () => {
            await scanForUnusedComponents(context);
        }
    );

    // Register delete command
    const deleteCommand = vscode.commands.registerCommand(
        'unused-component-detector.delete',
        async (componentPath: string) => {
            await deleteComponent(componentPath);
        }
    );

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand(
        'unused-component-detector.refresh',
        async () => {
            await scanForUnusedComponents(context);
        }
    );

    // Add to subscriptions
    context.subscriptions.push(
        statusBarItem,
        outputChannel,
        scanCommand,
        deleteCommand,
        refreshCommand
    );
}

/**
 * This method is called when the extension is deactivated
 */
export function deactivate(): void {
    outputChannel.appendLine('Unused Component Detector extension deactivated');
    if (statusBarItem) {
        statusBarItem.dispose();
    }
    if (outputChannel) {
        outputChannel.dispose();
    }
}

/**
 * Main scan function that orchestrates all phases
 */
async function scanForUnusedComponents(
    context: vscode.ExtensionContext
): Promise<void> {
    try {
        // Get workspace root
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage(
                'No workspace folder found. Please open a folder first.'
            );
            return;
        }

        const projectRoot = workspaceFolders[0].uri.fsPath;
        log(`Starting scan in: ${projectRoot}`);

        // Run scan with progress indicator
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Scanning for Unused Components',
                cancellable: false
            },
            async (progress) => {
                try {
                    // Phase 1: Scan for components
                    progress.report({
                        increment: 0,
                        message: 'Phase 1/4: Scanning for React components...'
                    });
                    log('Phase 1: Scanning for React components');

                    const allComponents = await scanReactComponents();
                    log(`Found ${allComponents.length} React components`);

                    if (allComponents.length === 0) {
                        vscode.window.showInformationMessage(
                            'No React components found in the workspace.'
                        );
                        return;
                    }

                    // Phase 2: Analyze dependencies
                    progress.report({
                        increment: 25,
                        message: 'Phase 2/4: Analyzing dependencies...'
                    });
                    log('Phase 2: Analyzing dependencies');

                    const componentPaths = allComponents.map(c => c.filePath);
                    const analyzer = new DependencyAnalyzer(projectRoot);
                    const dependencyGraph = await analyzer.analyzeImports(
                        componentPaths,
                        projectRoot
                    );

                    log(`Analyzed dependencies for ${Object.keys(dependencyGraph).length} components`);

                    // Phase 3: Find unused components
                    progress.report({
                        increment: 25,
                        message: 'Phase 3/4: Finding unused components...'
                    });
                    log('Phase 3: Finding unused components');

                    const unusedPaths = analyzer.findUnused(componentPaths);
                    log(`Found ${unusedPaths.length} unused components`);

                    if (unusedPaths.length === 0) {
                        vscode.window.showInformationMessage(
                            'Great! All components are being used. No unused components found.'
                        );
                        return;
                    }

                    // Map unused paths to component info
                    const unusedComponents = allComponents.filter(c =>
                        unusedPaths.includes(c.filePath)
                    );

                    // Phase 4: Run safety checks
                    progress.report({
                        increment: 25,
                        message: 'Phase 4/4: Running safety checks...'
                    });
                    log('Phase 4: Running safety checks');

                    // Load file contents for performance
                    const allContent = await loadFileContents(
                        unusedComponents.map(c => c.filePath)
                    );

                    const safetyChecker = new SafetyChecker(projectRoot);
                    const unusedComponentsWithSafety: UnusedComponentInfo[] = [];

                    const totalChecks = unusedComponents.length;
                    const safetyCheckIncrement = 25 / Math.max(totalChecks, 1);
                    
                    for (let i = 0; i < unusedComponents.length; i++) {
                        const component = unusedComponents[i];

                        progress.report({
                            increment: safetyCheckIncrement,
                            message: `Phase 4/4: Checking safety (${i + 1}/${totalChecks})...`
                        });

                        try {
                            const safetyCheck = await safetyChecker.checkSafeDeletion(
                                component.filePath,
                                dependencyGraph,
                                allContent
                            );

                            unusedComponentsWithSafety.push({
                                ...component,
                                isSafe: safetyCheck.isSafe,
                                safetyCheck: safetyCheck
                            });

                            log(
                                `Safety check for ${component.componentName}: ${
                                    safetyCheck.isSafe ? 'SAFE' : 'UNSAFE'
                                }`
                            );
                        } catch (error) {
                            log(
                                `Error checking safety for ${component.componentName}: ${
                                    error instanceof Error ? error.message : 'Unknown error'
                                }`
                            );
                            // Add component with unknown safety status
                            unusedComponentsWithSafety.push({
                                ...component,
                                isSafe: undefined
                            });
                        }
                    }

                    // Display results
                    log(`Scan complete. Found ${unusedComponentsWithSafety.length} unused components`);
                    UnusedComponentsPanel.show(context, unusedComponentsWithSafety);

                    // Show summary notification
                    const safeCount = unusedComponentsWithSafety.filter(
                        c => c.isSafe === true
                    ).length;
                    const unsafeCount = unusedComponentsWithSafety.filter(
                        c => c.isSafe === false
                    ).length;

                    const message = `Found ${unusedComponentsWithSafety.length} unused component(s): ${safeCount} safe, ${unsafeCount} unsafe`;
                    vscode.window.showInformationMessage(message);
                } catch (error) {
                    const errorMessage =
                        error instanceof Error ? error.message : 'Unknown error';
                    log(`Error during scan: ${errorMessage}`);
                    vscode.window.showErrorMessage(
                        `Failed to scan for unused components: ${errorMessage}`
                    );
                    throw error;
                }
            }
        );
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log(`Fatal error: ${errorMessage}`);
        vscode.window.showErrorMessage(
            `Extension error: ${errorMessage}`
        );
    }
}

/**
 * Loads file contents for performance optimization
 */
async function loadFileContents(
    filePaths: string[]
): Promise<Map<string, string>> {
    const contentMap = new Map<string, string>();

    for (const filePath of filePaths) {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            contentMap.set(filePath, document.getText());
        } catch (error) {
            log(`Error loading file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return contentMap;
}

/**
 * Deletes a component file
 */
async function deleteComponent(componentPath: string): Promise<void> {
    try {
        const uri = vscode.Uri.file(componentPath);
        const fileName = path.basename(componentPath);

        // Show confirmation
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${fileName}"?`,
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirm !== 'Delete') {
            return;
        }

        // Delete the file
        await vscode.workspace.fs.delete(uri);
        log(`Deleted component: ${componentPath}`);

        vscode.window.showInformationMessage(`Deleted: ${fileName}`);

        // Refresh the panel if it exists
        // The panel will handle refresh through its own message handler
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log(`Error deleting component: ${errorMessage}`);
        vscode.window.showErrorMessage(
            `Failed to delete component: ${errorMessage}`
        );
    }
}

/**
 * Logs a message to the output channel
 */
function log(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
    console.log(`[UnusedComponentDetector] ${message}`);
}

