import * as vscode from 'vscode';
import { PortProvider, PortItem } from './portProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('XPort 插件已激活');
    
    // Initialize context key
    vscode.commands.executeCommand('setContext', 'xport:hasFilter', false);

    const portProvider = new PortProvider();

    // Register TreeDataProvider
    vscode.window.registerTreeDataProvider('xport-ports', portProvider);

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('xport.refresh', () => {
            portProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xport.kill', async (item: PortItem) => {
            if (!item) {
                // If command triggered from command palette without selection, maybe show list?
                // For now, just return. 
                // Or we could ask user to input PID?
                // Let's stick to context menu usage primarily.
                vscode.window.showInformationMessage('请在列表中右键点击要停止的端口进程');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `确定要停止进程 ${item.portInfo.processName} (PID: ${item.portInfo.pid}) 吗？`,
                { modal: true },
                '确定'
            );

            if (confirm === '确定') {
                await portProvider.killPort(item);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xport.search', async () => {
            const value = await vscode.window.showInputBox({
                placeHolder: '搜索端口号、进程名或 PID...',
                prompt: '输入关键词过滤端口列表'
            });

            if (value !== undefined) {
                portProvider.setFilter(value);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('xport.clearSearch', () => {
            portProvider.clearFilter();
        })
    );
}

export function deactivate() {}
