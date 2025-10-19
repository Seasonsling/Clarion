import type { ITimelineApp } from './types.js';
import * as handlers from './handlers.js';
import { renderUI } from './ui.js';

export function cacheDOMElements(app: ITimelineApp): void {
    app.appContainer = document.getElementById("app-container")!;
    app.appTopBar = document.getElementById('app-top-bar')!;
    app.authSection = document.getElementById('auth-section')!;
    app.loginForm = document.getElementById('login-form') as HTMLFormElement;
    app.registerForm = document.getElementById('register-form') as HTMLFormElement;
    app.showLoginBtn = document.getElementById('show-login-btn') as HTMLButtonElement;
    app.showRegisterBtn = document.getElementById('show-register-btn') as HTMLButtonElement;
    app.loginErrorEl = document.getElementById('login-error')!;
    app.registerErrorEl = document.getElementById('register-error')!;
    app.inputSection = document.getElementById("input-section")!;
    app.timelineSection = document.getElementById("timeline-section")!;
    app.projectInput = document.getElementById("project-input") as HTMLTextAreaElement;
    app.generateBtn = document.getElementById("generate-btn") as HTMLButtonElement;
    app.timelineContainer = document.getElementById("timeline-container")!;
    app.projectNameEl = document.getElementById("project-name")!;
    app.saveStatusEl = document.getElementById('save-status-indicator')!;
    app.userDisplayEl = document.getElementById('user-display')!;
    app.aboutBtn = document.getElementById('about-btn') as HTMLButtonElement;
    app.shareBtn = document.getElementById('share-btn') as HTMLButtonElement;
    app.clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
    app.loadingOverlay = document.getElementById("loading-overlay")!;
    app.loadingTextEl = document.getElementById("loading-text")!;
    app.importBtn = document.getElementById("import-btn") as HTMLButtonElement;
    app.exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
    app.reportBtnToggle = document.getElementById("report-btn-toggle") as HTMLButtonElement;
    app.reportDropdown = document.getElementById("report-dropdown") as HTMLElement;
    app.importFileEl = document.getElementById("import-file") as HTMLInputElement;
    app.viewSwitcherEl = document.getElementById("view-switcher")!;
    app.viewSpecificControlsEl = document.getElementById("view-specific-controls");
    app.filterSortControlsEl = document.getElementById("filter-sort-controls")!;
    app.historySectionEl = document.getElementById("history-section")!;
    app.historyListEl = document.getElementById("history-list")!;
    app.quickAddFormEl = document.getElementById("quick-add-form") as HTMLFormElement;
    app.quickAddBtn = document.getElementById("quick-add-btn") as HTMLButtonElement;
    app.chatPanelEl = document.getElementById('chat-panel')!;
    app.chatBackdropEl = document.getElementById('chat-backdrop')!;
    app.chatToggleBtn = document.getElementById('chat-toggle-btn') as HTMLButtonElement;
    app.chatCloseBtn = document.getElementById('chat-close-btn') as HTMLButtonElement;
    app.chatHistoryEl = document.getElementById('chat-history')!;
    app.chatFormEl = document.getElementById('chat-form') as HTMLFormElement;
    app.chatInputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
    app.chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
    app.chatAttachmentBtn = document.getElementById('chat-attachment-btn') as HTMLButtonElement;
    app.chatAttachmentInput = document.getElementById('chat-attachment-input') as HTMLInputElement;
    app.chatAttachmentPreview = document.getElementById('chat-attachment-preview')!;
    app.chatModelSelectorContainer = document.getElementById('chat-model-selector-container')!;
    app.chatFormModelSelector = document.getElementById('chat-form-model-selector') as HTMLSelectElement;
    app.apiKeyModalOverlay = document.getElementById('api-key-modal-overlay')!;
    app.apiKeyForm = document.getElementById('api-key-form') as HTMLFormElement;
    app.apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
    app.apiKeyErrorEl = document.getElementById('api-key-error')!;
    app.projectCreationCard = document.getElementById('project-creation-card')!;
    app.uploadFilesBtn = document.getElementById('upload-files-btn') as HTMLButtonElement;
    app.projectFilesInput = document.getElementById('project-files-input') as HTMLInputElement;
    app.filePreviewContainer = document.getElementById('file-preview-container')!;
    app.aiChangesConfirmBar = document.getElementById('ai-changes-confirm-bar')!;
}

export function addEventListeners(app: ITimelineApp): void {
    app.showLoginBtn.addEventListener('click', () => handlers.handleAuthSwitch.call(app, 'login'));
    app.showRegisterBtn.addEventListener('click', () => handlers.handleAuthSwitch.call(app, 'register'));
    app.loginForm.addEventListener('submit', handlers.handleLogin.bind(app));
    app.registerForm.addEventListener('submit', handlers.handleRegister.bind(app));
    app.aboutBtn.addEventListener('click', (app as any).showAboutModal.bind(app));
    app.generateBtn.addEventListener("click", handlers.handleGenerateClick.bind(app));
    app.clearBtn.addEventListener("click", handlers.handleClearClick.bind(app));
    app.exportBtn.addEventListener("click", handlers.handleExportClick.bind(app));
    app.importBtn.addEventListener("click", () => app.importFileEl.click());
    app.importFileEl.addEventListener("change", handlers.handleImport.bind(app));
    app.quickAddFormEl.addEventListener('submit', handlers.handleQuickAddTask.bind(app));
    app.shareBtn.addEventListener('click', () => renderUI.showMembersModal(app));
    app.reportBtnToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        app.reportDropdown.classList.toggle('hidden');
    });
    app.reportDropdown.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('button[data-period]');
        if (button) {
            const period = button.getAttribute('data-period') as 'weekly' | 'monthly';
            handlers.handleGenerateReportClick.call(app, period);
            app.reportDropdown.classList.add('hidden');
        }
    });
    document.addEventListener('click', (e) => {
        if (!app.reportBtnToggle.contains(e.target as Node) && !app.reportDropdown.contains(e.target as Node)) {
            if (!app.reportDropdown.classList.contains('hidden')) {
                app.reportDropdown.classList.add('hidden');
            }
        }
    });
    
    app.uploadFilesBtn.addEventListener('click', () => app.projectFilesInput.click());
    app.projectFilesInput.addEventListener('change', (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files) {
            handlers.handleProjectFiles.call(app, files);
        }
        (e.target as HTMLInputElement).value = ''; 
    });

    const dropZone = app.projectCreationCard;
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer?.files;
        if (files) {
            handlers.handleProjectFiles.call(app, files);
        }
    });

    app.projectInput.addEventListener('paste', handlers.handlePaste.bind(app));
    app.chatInputEl.addEventListener('paste', handlers.handleChatPaste.bind(app));

    app.chatToggleBtn.addEventListener('click', () => handlers.toggleChat.call(app, true));
    app.chatCloseBtn.addEventListener('click', () => handlers.toggleChat.call(app, false));
    app.chatBackdropEl.addEventListener('click', () => handlers.toggleChat.call(app, false));
    app.chatFormEl.addEventListener('submit', handlers.handleChatSubmit.bind(app));
    app.chatInputEl.addEventListener('input', handlers.autoResizeChatInput.bind(app));
    app.chatAttachmentBtn.addEventListener('click', () => app.chatAttachmentInput.click());
    app.chatAttachmentInput.addEventListener('change', handlers.handleFileAttachmentChange.bind(app));
    app.chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            app.chatFormEl.requestSubmit();
        }
    });
    app.apiKeyForm.addEventListener('submit', handlers.handleApiKeySubmit.bind(app));

    // AI Changes Confirmation Bar Listeners
    app.aiChangesConfirmBar.querySelector('#ai-accept-btn')!.addEventListener('click', () => app.handleAcceptAiChanges());
    app.aiChangesConfirmBar.querySelector('#ai-reject-btn')!.addEventListener('click', () => app.handleRejectAiChanges());
}