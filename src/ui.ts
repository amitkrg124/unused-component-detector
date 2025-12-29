import * as vscode from 'vscode';
import * as path from 'path';
import { ComponentInfo } from './scanner';
import { SafetyCheckResult } from './safety';

/**
 * Extended component info with safety status
 */
export interface UnusedComponentInfo extends ComponentInfo {
    isSafe?: boolean;
    safetyCheck?: SafetyCheckResult;
}

/**
 * Message types for webview communication
 */
interface WebviewMessage {
    type: 'delete' | 'refresh' | 'openFile' | 'checkSafety' | 'deleteSelected' | 'selectAll' | 'toggleSelect';
    componentPath?: string;
    componentPaths?: string[];
    selectAll?: boolean;
}

/**
 * UnusedComponentsPanel class for displaying unused components in VS Code sidebar
 */
export class UnusedComponentsPanel {
    private static currentPanel: UnusedComponentsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _unusedComponents: UnusedComponentInfo[] = [];

    private constructor(panel: vscode.WebviewPanel, _extensionUri: vscode.Uri) {
        this._panel = panel;

        // Set up message handler
        this._panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => {
                this.handleMessage(message);
            },
            null,
            this._disposables
        );

        // Handle panel disposal
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    /**
     * Shows the unused components panel
     */
    public static show(
        context: vscode.ExtensionContext,
        unusedComponents: UnusedComponentInfo[]
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If panel already exists, reveal it
        if (UnusedComponentsPanel.currentPanel) {
            UnusedComponentsPanel.currentPanel._panel.reveal(column);
            UnusedComponentsPanel.currentPanel.update(unusedComponents);
            return;
        }

        // Otherwise, create new panel
        const panel = vscode.window.createWebviewPanel(
            'unusedComponents',
            'Unused React Components',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'media')
                ],
                retainContextWhenHidden: true
            }
        );

        UnusedComponentsPanel.currentPanel = new UnusedComponentsPanel(
            panel,
            context.extensionUri
        );

        UnusedComponentsPanel.currentPanel.update(unusedComponents);
    }

    /**
     * Updates the panel with new component data
     */
    public update(unusedComponents: UnusedComponentInfo[]): void {
        this._unusedComponents = unusedComponents;
        this._panel.webview.html = this.getWebviewContent();
    }

    /**
     * Handles messages from the webview
     */
    private async handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'delete':
                if (message.componentPath) {
                    await this.handleDelete(message.componentPath);
                }
                break;

            case 'deleteSelected':
                if (message.componentPaths) {
                    await this.handleBulkDelete(message.componentPaths);
                }
                break;

            case 'openFile':
                if (message.componentPath) {
                    await this.handleOpenFile(message.componentPath);
                }
                break;

            case 'checkSafety':
                if (message.componentPath) {
                    await this.handleCheckSafety(message.componentPath);
                }
                break;

            case 'refresh':
                this._panel.webview.html = this.getWebviewContent();
                break;
        }
    }

    /**
     * Handles delete button click
     */
    private async handleDelete(componentPath: string): Promise<void> {
        const component = this._unusedComponents.find(
            c => c.filePath === componentPath
        );

        if (!component) {
            vscode.window.showErrorMessage('Component not found');
            return;
        }

        // Check safety if not already checked
        if (component.isSafe === undefined) {
            vscode.window.showInformationMessage(
                'Checking component safety before deletion...'
            );
            return;
        }

        // Show confirmation dialog
        const confirmMessage = component.isSafe
            ? `Are you sure you want to delete "${component.componentName}"?`
            : `Warning: "${component.componentName}" may have dependencies. Are you sure you want to delete it?`;

        const result = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (result === 'Delete') {
            try {
                // Delete the file
                await vscode.workspace.fs.delete(vscode.Uri.file(componentPath));
                
                // Remove from list
                this._unusedComponents = this._unusedComponents.filter(
                    c => c.filePath !== componentPath
                );

                // Update panel
                this.update(this._unusedComponents);

                vscode.window.showInformationMessage(
                    `Deleted component: ${component.componentName}`
                );
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(
                    `Failed to delete component: ${errorMessage}`
                );
            }
        }
    }

    /**
     * Handles bulk delete of selected components
     */
    private async handleBulkDelete(componentPaths: string[]): Promise<void> {
        if (componentPaths.length === 0) {
            vscode.window.showWarningMessage('No components selected');
            return;
        }

        // Calculate total size to be saved
        const totalSize = componentPaths.reduce((sum, path) => {
            const component = this._unusedComponents.find(c => c.filePath === path);
            return sum + (component?.size || 0);
        }, 0);

        // Show confirmation
        const confirm = await vscode.window.showWarningMessage(
            `Delete ${componentPaths.length} selected component(s)? This will free up ${this.formatFileSize(totalSize)}.`,
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirm !== 'Delete') {
            return;
        }

        let deletedCount = 0;
        let failedCount = 0;
        let totalSizeDeleted = 0;

        // Delete each component
        for (const componentPath of componentPaths) {
            try {
                const component = this._unusedComponents.find(c => c.filePath === componentPath);
                if (!component) continue;

                await vscode.workspace.fs.delete(vscode.Uri.file(componentPath));
                totalSizeDeleted += component.size;
                deletedCount++;

                // Remove from list
                this._unusedComponents = this._unusedComponents.filter(
                    c => c.filePath !== componentPath
                );
            } catch (error) {
                failedCount++;
                console.error(`Failed to delete ${componentPath}:`, error);
            }
        }

        // Update panel
        this.update(this._unusedComponents);

        // Show success message with statistics
        if (deletedCount > 0) {
            const sizeInKB = totalSizeDeleted / 1024;
            const performanceImpact = sizeInKB > 100 
                ? 'Significant performance improvement'
                : sizeInKB > 50 
                ? 'Good performance improvement'
                : 'Minor performance improvement';
            
            const message = `✅ Deleted ${deletedCount} component(s) | 💾 Saved ${this.formatFileSize(totalSizeDeleted)} | 🚀 ${performanceImpact}`;
            vscode.window.showInformationMessage(message);
        }

        if (failedCount > 0) {
            vscode.window.showWarningMessage(`Failed to delete ${failedCount} component(s)`);
        }
    }

    /**
     * Handles open file button click
     */
    private async handleOpenFile(componentPath: string): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(
                vscode.Uri.file(componentPath)
            );
            await vscode.window.showTextDocument(document);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(
                `Failed to open file: ${errorMessage}`
            );
        }
    }

    /**
     * Handles safety check request
     */
    private async handleCheckSafety(_componentPath: string): Promise<void> {
        vscode.window.showInformationMessage(
            'Safety check requested. This feature requires the safety module to be integrated.'
        );
        // TODO: Integrate with SafetyChecker when available
    }

    /**
     * Formats file size in human-readable format
     */
    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(2)} KB`;
        } else {
            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        }
    }

    /**
     * Gets the webview HTML content
     */
    private getWebviewContent(): string {
        const totalSize = this._unusedComponents.reduce(
            (sum, comp) => sum + comp.size,
            0
        );

        const safeCount = this._unusedComponents.filter(
            c => c.isSafe === true
        ).length;

        const unsafeCount = this._unusedComponents.filter(
            c => c.isSafe === false
        ).length;

        const unknownCount = this._unusedComponents.filter(
            c => c.isSafe === undefined
        ).length;

        const componentsHtml = this._unusedComponents
            .map((component, index) => this.getComponentHtml(component, index))
            .join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Unused React Components</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            line-height: 1.5;
        }

        .header {
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .header h1 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 12px;
            color: var(--vscode-foreground);
        }

        .summary-banner {
            background-color: var(--vscode-editor-background);
            border: 2px solid var(--vscode-panel-border);
            border-left: 4px solid var(--vscode-textLink-foreground);
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 20px;
        }

        .summary-text {
            font-size: 14px;
            color: var(--vscode-foreground);
            margin-bottom: 8px;
            line-height: 1.6;
        }

        .summary-highlight {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }

        .summary-highlight.safe {
            color: var(--vscode-testing-iconPassed);
        }

        .summary-highlight.unsafe {
            color: var(--vscode-testing-iconFailed);
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 12px;
            margin-bottom: 16px;
        }

        .stat-card {
            background-color: var(--vscode-editor-background);
            border: 2px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 16px;
            text-align: center;
            transition: all 0.2s;
            position: relative;
        }

        .stat-card:hover {
            border-color: var(--vscode-focusBorder);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        .stat-card.primary {
            border-color: var(--vscode-textLink-foreground);
            background-color: var(--vscode-editor-background);
        }

        .stat-icon {
            font-size: 20px;
            margin-bottom: 8px;
        }

        .stat-value {
            font-size: 32px;
            font-weight: 700;
            color: var(--vscode-textLink-foreground);
            margin-bottom: 6px;
            line-height: 1;
        }

        .stat-label {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            font-weight: 500;
            margin-bottom: 4px;
        }

        .stat-description {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
            margin-top: 4px;
        }

        .stat-card.safe {
            border-color: var(--vscode-testing-iconPassed);
            background-color: var(--vscode-editor-background);
        }

        .stat-card.safe .stat-value {
            color: var(--vscode-testing-iconPassed);
        }

        .stat-card.safe .stat-icon {
            color: var(--vscode-testing-iconPassed);
        }

        .stat-card.unsafe {
            border-color: var(--vscode-testing-iconFailed);
            background-color: var(--vscode-editor-background);
        }

        .stat-card.unsafe .stat-value {
            color: var(--vscode-testing-iconFailed);
        }

        .stat-card.unsafe .stat-icon {
            color: var(--vscode-testing-iconFailed);
        }

        .stat-card.unknown .stat-value {
            color: var(--vscode-descriptionForeground);
        }

        .toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
            flex-wrap: wrap;
            align-items: center;
        }

        .bulk-actions {
            display: flex;
            gap: 8px;
            align-items: center;
            margin-left: auto;
            padding: 8px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
        }

        .bulk-actions-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-right: 8px;
        }

        .checkbox-container {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
        }

        .component-checkbox {
            width: 18px;
            height: 18px;
            cursor: pointer;
            accent-color: var(--vscode-testing-iconPassed);
        }

        .component-checkbox:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border, transparent);
            border-radius: 2px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            cursor: pointer;
            font-size: 13px;
            font-family: var(--vscode-font-family);
            transition: opacity 0.2s;
        }

        .btn:hover {
            opacity: 0.8;
        }

        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }

        .btn-danger:disabled {
            background-color: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }

        .components-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .component-card {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 16px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        .component-card:hover {
            border-color: var(--vscode-focusBorder);
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .component-card.unsafe {
            border-left: 3px solid var(--vscode-testing-iconFailed);
        }

        .component-card.safe {
            border-left: 3px solid var(--vscode-testing-iconPassed);
        }

        .component-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }

        .component-name {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 4px;
        }

        .component-path {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-family: var(--vscode-editor-font-family);
            word-break: break-all;
            margin-bottom: 8px;
        }

        .component-meta {
            display: flex;
            gap: 16px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }

        .meta-item {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .meta-label {
            font-weight: 500;
        }

        .component-actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .safety-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .safety-badge.safe {
            background-color: var(--vscode-testing-iconPassed);
            color: var(--vscode-editor-background);
        }

        .safety-badge.unsafe {
            background-color: var(--vscode-testing-iconFailed);
            color: var(--vscode-editor-background);
        }

        .safety-badge.unknown {
            background-color: var(--vscode-descriptionForeground);
            color: var(--vscode-editor-background);
        }

        .empty-state {
            text-align: center;
            padding: 48px 24px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }

        .empty-state-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        .warning-message {
            background-color: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            border-radius: 4px;
            padding: 12px;
            margin-top: 12px;
            font-size: 12px;
            color: var(--vscode-inputValidation-warningForeground);
        }

        .warning-message ul {
            margin-left: 20px;
            margin-top: 8px;
        }

        .warning-message li {
            margin-bottom: 4px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Unused React Components</h1>
        
        <div class="summary-banner">
            <div class="summary-text">
                📊 Found <span class="summary-highlight">${this._unusedComponents.length} Unused Components</span> | 
                ✅ <span class="summary-highlight safe">${safeCount} Safe to Delete</span> | 
                ⚠️ <span class="summary-highlight unsafe">${unsafeCount} Need Review</span>
            </div>
        </div>

        <div class="stats">
            <div class="stat-card primary">
                <div class="stat-icon">📦</div>
                <div class="stat-value">${this._unusedComponents.length}</div>
                <div class="stat-label">Total Unused</div>
                <div class="stat-description">All unused components found</div>
            </div>
            <div class="stat-card safe">
                <div class="stat-icon">✅</div>
                <div class="stat-value">${safeCount}</div>
                <div class="stat-label">Safe to Delete</div>
                <div class="stat-description">Can delete without review</div>
            </div>
            <div class="stat-card unsafe">
                <div class="stat-icon">⚠️</div>
                <div class="stat-value">${unsafeCount}</div>
                <div class="stat-label">Need Review</div>
                <div class="stat-description">Check warnings before delete</div>
            </div>
            ${unknownCount > 0 ? `
            <div class="stat-card unknown">
                <div class="stat-icon">❓</div>
                <div class="stat-value">${unknownCount}</div>
                <div class="stat-label">Unknown</div>
                <div class="stat-description">Safety check not completed</div>
            </div>
            ` : ''}
            <div class="stat-card">
                <div class="stat-icon">💾</div>
                <div class="stat-value">${this.formatFileSize(totalSize)}</div>
                <div class="stat-label">Total Size</div>
                <div class="stat-description">Combined size of all components</div>
            </div>
        </div>
        <div class="toolbar">
            <button class="btn btn-secondary" onclick="refresh()">🔄 Refresh</button>
            ${safeCount > 0 ? `
            <div class="bulk-actions">
                <span class="bulk-actions-label">Bulk Actions:</span>
                <button class="btn btn-secondary" onclick="selectAllSafe()">✓ Select All Safe (${safeCount})</button>
                <button class="btn btn-danger" id="deleteSelectedBtn" onclick="deleteSelected()" disabled>
                    🗑️ Delete Selected (<span id="selectedCount">0</span>) - <span id="selectedSize">0 B</span>
                </button>
            </div>
            ` : ''}
        </div>
    </div>

    <div class="components-list">
        ${this._unusedComponents.length === 0 
            ? `<div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <div class="empty-state-title">No Unused Components</div>
                <div>All components are being used in your project.</div>
              </div>`
            : componentsHtml
        }
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function deleteComponent(componentPath) {
            vscode.postMessage({
                type: 'delete',
                componentPath: componentPath
            });
        }

        function openFile(componentPath) {
            vscode.postMessage({
                type: 'openFile',
                componentPath: componentPath
            });
        }

        function checkSafety(componentPath) {
            vscode.postMessage({
                type: 'checkSafety',
                componentPath: componentPath
            });
        }

        function refresh() {
            vscode.postMessage({
                type: 'refresh'
            });
        }

        function selectAllSafe() {
            const checkboxes = document.querySelectorAll('.component-checkbox');
            const allChecked = Array.from(checkboxes).every(cb => cb.checked);
            checkboxes.forEach(cb => {
                cb.checked = !allChecked;
            });
            updateSelectedCount();
        }

        function formatFileSize(bytes) {
            if (bytes < 1024) {
                return bytes + ' B';
            } else if (bytes < 1024 * 1024) {
                return (bytes / 1024).toFixed(2) + ' KB';
            } else {
                return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
            }
        }

        function updateSelectedCount() {
            const checkboxes = document.querySelectorAll('.component-checkbox:checked');
            const count = checkboxes.length;
            const countSpan = document.getElementById('selectedCount');
            const deleteBtn = document.getElementById('deleteSelectedBtn');
            const sizeSpan = document.getElementById('selectedSize');

            // Calculate total size of selected components
            let totalSize = 0;
            checkboxes.forEach(function(cb) {
                const size = parseInt(cb.getAttribute('data-size') || '0', 10);
                totalSize += size;
            });

            if (countSpan) {
                countSpan.textContent = count;
            }
            if (sizeSpan) {
                sizeSpan.textContent = formatFileSize(totalSize);
            }
            if (deleteBtn) {
                deleteBtn.disabled = count === 0;
            }
        }

        function deleteSelected() {
            const checkboxes = document.querySelectorAll('.component-checkbox:checked');
            const selectedPaths = [];

            checkboxes.forEach(function(cb) {
                const path = cb.getAttribute('data-path');
                if (path) {
                    selectedPaths.push(path);
                }
            });

            if (selectedPaths.length === 0) {
                return;
            }

            vscode.postMessage({
                type: 'deleteSelected',
                componentPaths: selectedPaths
            });
        }

        // Initialize selected count on load
        updateSelectedCount();
    </script>
</body>
</html>`;
    }

    /**
     * Gets HTML for a single component card
     */
    private getComponentHtml(component: UnusedComponentInfo, index: number): string {
        const isSafe = component.isSafe;
        const safetyClass = isSafe === true ? 'safe' : isSafe === false ? 'unsafe' : 'unknown';
        const safetyBadge = isSafe === true 
            ? '<span class="safety-badge safe">Safe</span>'
            : isSafe === false 
            ? '<span class="safety-badge unsafe">Unsafe</span>'
            : '<span class="safety-badge unknown">Unknown</span>';

        const relativePath = path.relative(
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
            component.filePath
        );

        const lastModified = component.lastModified
            ? new Date(component.lastModified).toLocaleDateString()
            : 'Unknown';

        const warningsHtml = component.safetyCheck && !component.safetyCheck.isSafe
            ? `<div class="warning-message">
                <strong>⚠️ Deletion Warning</strong>
                <ul>
                    ${component.safetyCheck.warnings.map(w => `<li>${this.escapeHtml(w)}</li>`).join('')}
                </ul>
            </div>`
            : '';

        const checkboxHtml = isSafe === true
            ? `<div class="checkbox-container">
                <input type="checkbox"
                       class="component-checkbox"
                       id="checkbox-${index}"
                       data-path="${this.escapeHtml(component.filePath)}"
                       data-size="${component.size}"
                       onchange="updateSelectedCount()">
                <label for="checkbox-${index}" style="cursor: pointer; font-size: 12px; color: var(--vscode-descriptionForeground);">
                    Select for bulk delete
                </label>
            </div>`
            : '';

        return `
        <div class="component-card ${safetyClass}" data-index="${index}">
            <div class="component-header">
                <div>
                    <div class="component-name">${this.escapeHtml(component.componentName)}</div>
                    <div class="component-path">${this.escapeHtml(relativePath)}</div>
                </div>
                ${safetyBadge}
            </div>
            <div class="component-meta">
                <div class="meta-item">
                    <span class="meta-label">Size:</span>
                    <span>${this.formatFileSize(component.size)}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Modified:</span>
                    <span>${lastModified}</span>
                </div>
            </div>
            ${checkboxHtml}
            ${warningsHtml}
            <div class="component-actions">
                <button class="btn btn-secondary" onclick="openFile('${this.escapeJs(component.filePath)}')">
                    Open File
                </button>
                <button 
                    class="btn btn-danger" 
                    onclick="deleteComponent('${this.escapeJs(component.filePath)}')"
                    ${isSafe === false ? 'disabled title="Component has dependencies. Check safety first."' : ''}
                >
                    ${isSafe === false ? '⚠️ Delete (Unsafe)' : 'Delete'}
                </button>
            </div>
        </div>`;
    }

    /**
     * Escapes HTML to prevent XSS
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Escapes JavaScript strings
     */
    private escapeJs(text: string): string {
        return text
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }

    /**
     * Disposes of the panel
     */
    public dispose(): void {
        UnusedComponentsPanel.currentPanel = undefined;

        // Clean up disposables
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

