import { GeminiService } from './gemini';
import { Renderer } from './renderer';
import * as api from './api';
import { AppState, ChangeOperation, CurrentUser, Indices, 任务, 时间轴数据, 评论, TopLevelIndices, ProjectMember, ProjectMemberRole, Attachment } from './types';

export class TimelineApp {
  public state: AppState = {
    currentUser: null,
    allUsers: [],
    projectsHistory: [],
    timeline: null,
    isLoading: false,
    loadingText: "初始化项目中...",
    currentView: 'vertical',
    authView: 'login',
    calendarDate: new Date(),
    isChatOpen: false,
    isChatLoading: false,
    chatHistory: [],
    lastUserChatPrompt: '',
    filters: {
      status: [],
      priority: [],
      assignee: [],
    },
    sortBy: 'default',
    ganttGranularity: 'days',
    ganttZoomLevel: 40,
    mindMapState: {
        collapsedNodes: new Set<string>(),
    },
    apiKey: null,
    saveStatus: 'idle',
    collapsedItems: new Set<string>(),
    chatAttachment: null,
    lastTimelineState: null,
    lastModificationId: null,
  };

  private ai: GeminiService;
  private renderer: Renderer;

  // DOM Elements
  public appContainer: HTMLElement;
  public authSection: HTMLElement;
  public loginForm: HTMLFormElement;
  public registerForm: HTMLFormElement;
  public showLoginBtn: HTMLButtonElement;
  public showRegisterBtn: HTMLButtonElement;
  public loginErrorEl: HTMLElement;
  public registerErrorEl: HTMLElement;

  public inputSection: HTMLElement;
  public timelineSection: HTMLElement;
  public projectInput: HTMLTextAreaElement;
  public generateBtn: HTMLButtonElement;
  public timelineContainer: HTMLElement;
  public projectNameEl: HTMLElement;
  public saveStatusEl: HTMLElement;
  public userDisplayEl: HTMLElement;
  public shareBtn: HTMLButtonElement;
  public clearBtn: HTMLButtonElement;
  public loadingOverlay: HTMLElement;
  public loadingTextEl: HTMLElement;
  public importBtn: HTMLButtonElement;
  public exportBtn: HTMLButtonElement;
  public importFileEl: HTMLInputElement;
  public viewSwitcherEl: HTMLElement;
  public viewSpecificControlsEl: HTMLElement | null = null;
  public filterSortControlsEl: HTMLElement;
  public reportBtnToggle: HTMLButtonElement;
  public reportDropdown: HTMLElement;
  // Home Screen Elements
  public historySectionEl: HTMLElement;
  public historyListEl: HTMLElement;
  public quickAddFormEl: HTMLFormElement;
  public quickAddBtn: HTMLButtonElement;
  // Chat Elements
  public chatPanelEl: HTMLElement;
  public chatBackdropEl: HTMLElement;
  public chatToggleBtn: HTMLButtonElement;
  public chatCloseBtn: HTMLButtonElement;
  public chatHistoryEl: HTMLElement;
  public chatFormEl: HTMLFormElement;
  public chatInputEl: HTMLTextAreaElement;
  public chatSendBtn: HTMLButtonElement;
  public chatAttachBtn: HTMLButtonElement;
  public chatFileInput: HTMLInputElement;
  public chatAttachmentPreviewEl: HTMLElement;
  // API Key Modal Elements
  public apiKeyModalOverlay: HTMLElement;
  public apiKeyForm: HTMLFormElement;
  public apiKeyInput: HTMLInputElement;
  public apiKeyErrorEl: HTMLElement;


  constructor() {
    this.cacheDOMElements();
    this.renderer = new Renderer(this);
    this.ai = new GeminiService(this.state.apiKey || '');
    this.addEventListeners();
    this.loadStateAndInitialize();
  }
  
  private async loadStateAndInitialize(): Promise<void> {
    const savedDataJSON = localStorage.getItem("timelineAppData");
    let token: string | null = null;
    let apiKey: string | null = null;
    
    if (savedDataJSON) {
        try {
            const savedData = JSON.parse(savedDataJSON);
            token = savedData.authToken || null;
            apiKey = savedData.apiKey || null;
        } catch(e) {
            console.error("Failed to parse saved data, clearing.", e);
            localStorage.removeItem("timelineAppData");
        }
    }
    
    this.state.apiKey = apiKey;
    this.ai.updateApiKey(this.state.apiKey || '');
    
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            if (payload.exp * 1000 > Date.now()) {
                const currentUser: CurrentUser = {
                    id: payload.userId.toString(),
                    username: payload.username,
                    profile: payload.profile,
                    token: token,
                };
                // Set current user synchronously to avoid UI flicker
                this.state.currentUser = currentUser;
                this.render(); // Render with user logged in
                await this.initializeApp(currentUser); // Then fetch data
            } else {
                 this.setState({ currentUser: null });
            }
        } catch (e) {
            console.error("Invalid token found:", e);
            this.setState({ currentUser: null });
        }
    } else {
        this.render();
    }
  }
  
  private async initializeApp(user: CurrentUser): Promise<void> {
    this.setState({ isLoading: true, loadingText: '正在同步您的云端数据...' });
    try {
      const [projects, allUsers] = await Promise.all([
        api.fetchProjects(user.token),
        api.fetchAllUsers(user.token),
      ]);
      this.setState({ projectsHistory: projects, allUsers: allUsers });
      this.handleUrlInvitation(); // Check for invites after data is loaded
    } catch (error) {
      console.error('Initialization failed:', error);
      alert('无法从云端同步您的数据，请尝试重新登录。');
      // Log out the user if the token is invalid or network fails
      this.setState({ currentUser: null });
    } finally {
      this.setState({ isLoading: false });
    }
  }
  
  private async handleUrlInvitation() {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('projectId');
      
      if (projectId && this.state.currentUser) {
          // Clean up URL immediately
          window.history.replaceState({}, document.title, window.location.pathname);
          await this.joinProject(projectId, this.state.currentUser.id);
      }
  }
  
  private async joinProject(projectId: string, userId: string) {
      const project = this.state.projectsHistory.find(p => p.id === projectId);
      if (!project) {
          alert("邀请链接无效或项目已不存在。");
          return;
      }
      
      const isAlreadyMember = project.members.some(m => m.userId === userId);

      if (!isAlreadyMember) {
          const newMember: ProjectMember = { userId: userId, role: 'Viewer' }; // Default role
          project.members.push(newMember);
          
          this.setState({ isLoading: true, loadingText: "正在加入项目..."});
          try {
            await this.saveCurrentProject(project);
            alert(`成功加入项目 "${project.项目名称}"！您的默认角色是“观察员”。`);
            this.setState({
                timeline: project, // Automatically load the project
                currentView: 'vertical'
            });
          } catch(e) {
             alert("加入项目失败，请稍后重试。");
             // Revert local change if save fails
             project.members.pop();
          } finally {
            this.setState({ isLoading: false });
          }
      } else {
          // If already a member, just load the project
          this.setState({ timeline: project, currentView: 'vertical' });
      }
  }

  private cacheDOMElements(): void {
    this.appContainer = document.getElementById("app-container")!;
    // Auth
    this.authSection = document.getElementById('auth-section')!;
    this.loginForm = document.getElementById('login-form') as HTMLFormElement;
    this.registerForm = document.getElementById('register-form') as HTMLFormElement;
    this.showLoginBtn = document.getElementById('show-login-btn') as HTMLButtonElement;
    this.showRegisterBtn = document.getElementById('show-register-btn') as HTMLButtonElement;
    this.loginErrorEl = document.getElementById('login-error')!;
    this.registerErrorEl = document.getElementById('register-error')!;

    this.inputSection = document.getElementById("input-section")!;
    this.timelineSection = document.getElementById("timeline-section")!;
    this.projectInput = document.getElementById("project-input") as HTMLTextAreaElement;
    this.generateBtn = document.getElementById("generate-btn") as HTMLButtonElement;
    this.timelineContainer = document.getElementById("timeline-container")!;
    this.projectNameEl = document.getElementById("project-name")!;
    this.saveStatusEl = document.getElementById('save-status-indicator')!;
    this.userDisplayEl = document.getElementById('user-display')!;
    this.shareBtn = document.getElementById('share-btn') as HTMLButtonElement;
    this.clearBtn = document.getElementById("clear-btn") as HTMLButtonElement;
    this.loadingOverlay = document.getElementById("loading-overlay")!;
    this.loadingTextEl = document.getElementById("loading-text")!;
    this.importBtn = document.getElementById("import-btn") as HTMLButtonElement;
    this.exportBtn = document.getElementById("export-btn") as HTMLButtonElement;
    this.reportBtnToggle = document.getElementById("report-btn-toggle") as HTMLButtonElement;
    this.reportDropdown = document.getElementById("report-dropdown") as HTMLElement;
    this.importFileEl = document.getElementById("import-file") as HTMLInputElement;
    this.viewSwitcherEl = document.getElementById("view-switcher")!;
    this.viewSpecificControlsEl = document.getElementById("view-specific-controls");
    this.filterSortControlsEl = document.getElementById("filter-sort-controls")!;
    // Home Screen
    this.historySectionEl = document.getElementById("history-section")!;
    this.historyListEl = document.getElementById("history-list")!;
    this.quickAddFormEl = document.getElementById("quick-add-form") as HTMLFormElement;
    this.quickAddBtn = document.getElementById("quick-add-btn") as HTMLButtonElement;
    // Chat
    this.chatPanelEl = document.getElementById('chat-panel')!;
    this.chatBackdropEl = document.getElementById('chat-backdrop')!;
    this.chatToggleBtn = document.getElementById('chat-toggle-btn') as HTMLButtonElement;
    this.chatCloseBtn = document.getElementById('chat-close-btn') as HTMLButtonElement;
    this.chatHistoryEl = document.getElementById('chat-history')!;
    this.chatFormEl = document.getElementById('chat-form') as HTMLFormElement;
    this.chatInputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
    this.chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
    this.chatAttachBtn = document.getElementById('chat-attach-btn') as HTMLButtonElement;
    this.chatFileInput = document.getElementById('chat-file-input') as HTMLInputElement;
    this.chatAttachmentPreviewEl = document.getElementById('chat-attachment-preview')!;
    // API Key Modal
    this.apiKeyModalOverlay = document.getElementById('api-key-modal-overlay')!;
    this.apiKeyForm = document.getElementById('api-key-form') as HTMLFormElement;
    this.apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
    this.apiKeyErrorEl = document.getElementById('api-key-error')!;
  }

  private addEventListeners(): void {
    // Auth
    this.showLoginBtn.addEventListener('click', () => this.handleAuthSwitch('login'));
    this.showRegisterBtn.addEventListener('click', () => this.handleAuthSwitch('register'));
    this.loginForm.addEventListener('submit', this.handleLogin.bind(this));
    this.registerForm.addEventListener('submit', this.handleRegister.bind(this));

    this.generateBtn.addEventListener("click", this.handleGenerateClick.bind(this));
    this.clearBtn.addEventListener("click", this.handleClearClick.bind(this));
    this.exportBtn.addEventListener("click", this.handleExportClick.bind(this));
    this.importBtn.addEventListener("click", () => this.importFileEl.click());
    this.importFileEl.addEventListener("change", this.handleImport.bind(this));
    this.quickAddFormEl.addEventListener('submit', this.handleQuickAddTask.bind(this));
    this.shareBtn.addEventListener('click', () => this.renderer.showMembersModal());
    
    // Report Dropdown Listeners
    this.reportBtnToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.reportDropdown.classList.toggle('hidden');
    });

    this.reportDropdown.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('button[data-period]');
        if (button) {
            const period = button.getAttribute('data-period') as 'weekly' | 'monthly';
            this.handleGenerateReportClick(period);
            this.reportDropdown.classList.add('hidden');
        }
    });

    document.addEventListener('click', (e) => {
        if (!this.reportBtnToggle.contains(e.target as Node) && !this.reportDropdown.contains(e.target as Node)) {
            if (!this.reportDropdown.classList.contains('hidden')) {
                this.reportDropdown.classList.add('hidden');
            }
        }
    });

    // Chat Listeners
    this.chatToggleBtn.addEventListener('click', () => this.toggleChat(true));
    this.chatCloseBtn.addEventListener('click', () => this.toggleChat(false));
    this.chatBackdropEl.addEventListener('click', () => this.toggleChat(false));
    this.chatFormEl.addEventListener('submit', this.handleChatSubmit.bind(this));
    this.chatInputEl.addEventListener('input', this.autoResizeChatInput.bind(this));
    this.chatInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.chatFormEl.requestSubmit();
        }
    });
    this.chatAttachBtn.addEventListener('click', () => this.chatFileInput.click());
    this.chatFileInput.addEventListener('change', this.handleFileSelect.bind(this));

    // API Key Modal Listener
    this.apiKeyForm.addEventListener('submit', this.handleApiKeySubmit.bind(this));
  }

  // --- AUTH & USER MGMT ---
  private handleAuthSwitch(view: 'login' | 'register'): void {
    this.setState({ authView: view });
  }

  private async _performLoginAndInitialize(username, password) {
    // 1. Set global loading state
    this.setState({ isLoading: true, loadingText: "登录中..." });
    
    // 2. Perform login API call
    const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    const loginData = await loginResponse.json();
    if (!loginResponse.ok) {
        throw new Error(loginData.message || "用户名或密码无效。");
    }
    
    // 3. Create user object
    const { token } = loginData;
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentUser: CurrentUser = {
        id: payload.userId.toString(),
        username: payload.username,
        profile: payload.profile,
        token: token,
    };

    // 4. Fetch initial data
    this.setState({ loadingText: '正在同步您的云端数据...' });
    const [projects, allUsers] = await Promise.all([
        api.fetchProjects(currentUser.token),
        api.fetchAllUsers(currentUser.token),
    ]);
    
    // 5. Set final state and turn off loading
    this.setState({
        currentUser: currentUser,
        projectsHistory: projects,
        allUsers: allUsers,
        isLoading: false
    });
    
    this.handleUrlInvitation();
  }

  private async handleLogin(event: Event): Promise<void> {
    event.preventDefault();
    this.loginErrorEl.textContent = '';
    const username = (this.loginForm.querySelector('input[name="username"]') as HTMLInputElement).value;
    const password = (this.loginForm.querySelector('input[name="password"]') as HTMLInputElement).value;

    try {
        await this._performLoginAndInitialize(username, password);
    } catch (error: any) {
        this.loginErrorEl.textContent = error.message || "登录时发生网络错误。";
        this.setState({ isLoading: false });
        console.error("Login Error:", error);
    }
  }

  private async handleRegister(event: Event): Promise<void> {
    event.preventDefault();
    this.registerErrorEl.textContent = '';
    const usernameInput = (this.registerForm.querySelector('input[name="username"]') as HTMLInputElement);
    const passwordInput = (this.registerForm.querySelector('input[name="password"]') as HTMLInputElement);
    const username = usernameInput.value;
    const password = passwordInput.value;

    if (username.length < 2 || password.length < 4) {
        this.registerErrorEl.textContent = "用户名至少2个字符，密码至少4个字符。";
        return;
    }
    
    this.setState({ isLoading: true, loadingText: "注册中..." });
    try {
        const regResponse = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });

        const regData = await regResponse.json();
        if (!regResponse.ok) {
            throw new Error(regData.message || "注册失败。");
        }
        
        await this._performLoginAndInitialize(username, password);

    } catch (error: any) {
        this.registerErrorEl.textContent = error.message || "注册或登录时发生网络错误。";
        this.setState({ isLoading: false });
        console.error("Register/Login Error:", error);
    }
  }

  public setState(newState: Partial<AppState>, shouldRender: boolean = true): void {
    const oldUser = this.state.currentUser;
    const oldApiKey = this.state.apiKey;

    this.state = { ...this.state, ...newState };
    
    if (newState.apiKey !== undefined && newState.apiKey !== oldApiKey) {
        this.ai.updateApiKey(newState.apiKey || '');
    }

    if (shouldRender) {
      this.render();
    }
    
    if (newState.currentUser !== undefined || newState.apiKey !== undefined) {
      if ((newState.currentUser && !oldUser) || (!newState.currentUser && oldUser) || (newState.apiKey !== this.state.apiKey)) {
        this.saveState();
      }
    }
  }

  private saveState(): void {
    const appData = {
        authToken: this.state.currentUser?.token,
        apiKey: this.state.apiKey,
    };
    localStorage.setItem("timelineAppData", JSON.stringify(appData));
  }
  
  private handleClearClick(): void {
    this.setState({ timeline: null, chatHistory: [], isChatOpen: false, collapsedItems: new Set() });
  }

  private handleExportClick(): void {
    if (!this.state.timeline) return;
    const dataStr = JSON.stringify(this.state.timeline, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${this.state.timeline.项目名称.replace(/\s+/g, '_')}_timeline.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private handleImport(event: Event): void {
    if (!this.state.currentUser) return;
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const result = e.target?.result as string;
            const data = JSON.parse(result);
            if (data.项目名称 && Array.isArray(data.阶段)) {
                data.id = `proj-${Date.now()}`;
                data.ownerId = this.state.currentUser!.id;
                data.members = [{ userId: this.state.currentUser!.id, role: 'Admin' }];
                const newProject = this.postProcessTimelineData(data);

                this.setState({ isLoading: true, loadingText: "正在上传项目..." });
                const savedProject = await api.createProject(newProject, this.state.currentUser!.token);
                const newHistory = [...this.state.projectsHistory, savedProject];
                this.setState({ timeline: savedProject, projectsHistory: newHistory });

            } else {
                alert("导入失败。文件格式无效或不兼容。");
            }
        } catch (error) {
            alert("文件读取或上传错误，请检查文件是否损坏或网络连接。");
            console.error("导入错误：", error);
        } finally {
            this.setState({ isLoading: false });
        }
    };
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = ''; 
  }

  private async handleGenerateClick(): Promise<void> {
    if (!this.state.apiKey) {
        this.renderer.showApiKeyModal(true);
        alert("请先提供您的 API 密钥。");
        return;
    }
    if (!this.state.currentUser) {
        alert("请先登录。");
        return;
    }
    const projectDescription = this.projectInput.value.trim();
    if (!projectDescription) {
      alert("请先阐明您的战略目标。");
      return;
    }

    this.setState({ isLoading: true, loadingText: "排兵布阵，军令生成中..." });

    try {
      const parsedData = await this.ai.generateTimeline(projectDescription);
      
      const timelineData: 时间轴数据 = {
        ...parsedData,
        id: `proj-${Date.now()}`,
        ownerId: this.state.currentUser.id,
        members: [{ userId: this.state.currentUser.id, role: 'Admin' }],
      };

      const processedData = this.postProcessTimelineData(timelineData);
      
      this.setState({ isLoading: true, loadingText: '正在保存新项目...'});
      const savedProject = await api.createProject(processedData, this.state.currentUser.token);
      const newHistory = [...this.state.projectsHistory, savedProject];
      this.setState({ timeline: savedProject, projectsHistory: newHistory, currentView: 'vertical', chatHistory: [], isChatOpen: false });
    } catch (error) {
      console.error("生成或保存计划时出错：", error);
      alert("计划生成或保存失败，请稍后重试。");
    } finally {
      this.setState({ isLoading: false });
    }
  }
  
  public handleApiKeySubmit(event: Event): void {
      event.preventDefault();
      const apiKey = this.apiKeyInput.value.trim();
      if (!apiKey) {
          this.apiKeyErrorEl.textContent = 'API 密钥不能为空。';
          this.apiKeyErrorEl.classList.remove('hidden');
          return;
      }
      this.apiKeyErrorEl.textContent = '';
      this.apiKeyErrorEl.classList.add('hidden');
      
      this.setState({ apiKey });
      this.renderer.showApiKeyModal(false);
  }

  private postProcessTimelineData(data: 时间轴数据): 时间轴数据 {
      let taskCounter = 0;
      const assignedIds = new Set<string>();

      const processTasksRecursively = (tasks: 任务[]) => {
          tasks.forEach(task => {
              if (!task.id || assignedIds.has(task.id)) {
                  task.id = `task-${Date.now()}-${taskCounter++}`;
              }
              assignedIds.add(task.id);
              task.已完成 = task.状态 === '已完成';
              if (task.子任务) {
                  processTasksRecursively(task.子任务);
              }
          });
      };

      data.阶段.forEach(phase => {
          if (phase.任务) processTasksRecursively(phase.任务);
          if (phase.项目) {
              phase.项目.forEach(proj => processTasksRecursively(proj.任务));
          }
      });
      return data;
  }

  // --- State Update Methods ---
    public getTaskFromPath(indices: Indices): { parent: 任务[], task: 任务, taskIndex: number } | null {
        if (!this.state.timeline) return null;
        const { phaseIndex, projectIndex, taskPath } = indices;

        const phase = this.state.timeline.阶段[phaseIndex];
        if (!phase) return null;
        
        const taskListOwner = typeof projectIndex === 'number' ? phase.项目![projectIndex] : phase;
        if (!taskListOwner) return null;

        let parent: any = taskListOwner;
        let tasks = parent.任务 || [];
        let task: 任务 | null = null;
        
        for (let i = 0; i < taskPath.length; i++) {
            const index = taskPath[i];
            task = tasks[index];
            if (!task) return null;

            if (i < taskPath.length - 1) {
                parent = task;
                tasks = task.子任务 || [];
            }
        }
        
        if (!task) return null;
        const taskList = parent.子任务 ? parent.子任务 : parent.任务;
        if (!Array.isArray(taskList)) return null;

        return { parent: taskList, task, taskIndex: taskPath[taskPath.length-1] };
    }

    public async handleToggleComplete(indices: Indices, isChecked: boolean): Promise<void> {
        const result = this.getTaskFromPath(indices);
        if (result && this.state.timeline) {
            const completeTaskRecursively = (task: 任务) => {
                task.已完成 = true;
                task.状态 = '已完成';
                if (task.子任务) {
                    task.子任务.forEach(completeTaskRecursively);
                }
            };

            if (isChecked) {
                completeTaskRecursively(result.task);
            } else {
                result.task.已完成 = false;
                result.task.状态 = '进行中';
            }
            
            await this.saveCurrentProject(this.state.timeline);
        }
    }

    public async handleUpdateTask(indices: Indices, updatedTask: 任务): Promise<void> {
        const result = this.getTaskFromPath(indices);
        if(result && this.state.timeline) {
            const currentTask = result.parent[result.taskIndex];
            result.parent[result.taskIndex] = { ...currentTask, ...updatedTask };
            await this.saveCurrentProject(this.state.timeline);
        }
    }

    public async handleAddTask(indices: TopLevelIndices, parentTaskPath?: number[]): Promise<void> {
        if (!this.state.timeline) return;
        const { phaseIndex, projectIndex } = indices;
        if(phaseIndex === undefined) return;

        const newTask: 任务 = { id: `task-${Date.now()}`, 任务名称: "新任务", 状态: '待办', 已完成: false, 优先级: '中' };
        const phase = this.state.timeline.阶段[phaseIndex];
        const taskListOwner = typeof projectIndex === 'number' ? phase.项目![projectIndex] : phase;

        if (parentTaskPath && parentTaskPath.length > 0) {
            const parentTaskResult = this.getTaskFromPath({ phaseIndex, projectIndex, taskPath: parentTaskPath });
            if (parentTaskResult) {
                const parentTask = parentTaskResult.task;
                if (!parentTask.子任务) parentTask.子任务 = [];
                parentTask.子任务.push(newTask);
            }
        } else {
             if (!taskListOwner.任务) taskListOwner.任务 = [];
             taskListOwner.任务.push(newTask);
        }
        
        await this.saveCurrentProject(this.state.timeline);
    }

    public async handleDeleteTask(indices: Indices): Promise<void> {
        if (!confirm("确定要从此计划中移除此任务吗？")) return;
        const result = this.getTaskFromPath(indices);
        if(result && this.state.timeline) {
            result.parent.splice(result.taskIndex, 1);
            await this.saveCurrentProject(this.state.timeline);
        }
    }
    
    public async handleAddComment(indices: Indices, content: string, file?: File): Promise<void> {
        if (!content.trim() && !file) return;
        if (!this.state.currentUser) return;
    
        const result = this.getTaskFromPath(indices);
        if (result && this.state.timeline) {
            const task = result.task;
            if (!task.讨论) task.讨论 = [];
    
            const newComment: 评论 = {
                发言人Id: this.state.currentUser.id,
                内容: content,
                时间戳: new Date().toISOString(),
            };
    
            if (file) {
                // In a real application, you would upload the file to your storage (like the NAS)
                // via a backend endpoint and get a real URL.
                // Here, we simulate this by creating a placeholder URL.
                const simulatedUrl = `nas://company-files/${this.state.timeline.id}/${task.id}/${file.name}`;
                const attachment: Attachment = {
                    name: file.name,
                    url: simulatedUrl,
                };
                newComment.附件 = [attachment];
            }
    
            task.讨论.push(newComment);
            await this.saveCurrentProject(this.state.timeline);
        }
    }

    public async handleMoveTask(draggedIndices: Indices, dropIndices: Indices, position: 'before' | 'after'): Promise<void> {
        if (!this.state.timeline) return;
        if (JSON.stringify(draggedIndices) === JSON.stringify(dropIndices)) return;

        const dragResult = this.getTaskFromPath(draggedIndices);
        const dropResult = this.getTaskFromPath(dropIndices);
        if (!dragResult || !dropResult) return;

        const { parent: dragParent, taskIndex: dragIndex } = dragResult;
        let { parent: dropParent, taskIndex: dropIndex } = dropResult;
        
        const dragPathStr = JSON.stringify(draggedIndices.taskPath);
        const dropPathStr = JSON.stringify(dropIndices.taskPath);
        if (dropPathStr.startsWith(dragPathStr.slice(0, -1)) && dragPathStr.length < dropPathStr.length) {
            console.warn("Cannot move a parent task into one of its own children.");
            return;
        }
        
        const [movedTask] = dragParent.splice(dragIndex, 1);
        if (dragParent === dropParent && dragIndex < dropIndex) {
            dropIndex--;
        }

        const insertIndex = position === 'before' ? dropIndex : dropIndex + 1;
        dropParent.splice(insertIndex, 0, movedTask);

        await this.saveCurrentProject(this.state.timeline);
    }

    public async saveCurrentProject(updatedTimeline: 时间轴数据) {
        if (!this.state.currentUser) return;
        const projectIndex = this.state.projectsHistory.findIndex(p => p.id === updatedTimeline.id);
        const newHistory = [...this.state.projectsHistory];
        if (projectIndex !== -1) {
            newHistory[projectIndex] = updatedTimeline;
        } else {
             newHistory.push(updatedTimeline);
        }
        this.setState({ timeline: { ...updatedTimeline }, projectsHistory: newHistory, saveStatus: 'saving' });

        try {
            await api.updateProject(updatedTimeline, this.state.currentUser.token);
            this.setState({ saveStatus: 'saved' });
            setTimeout(() => this.setState({ saveStatus: 'idle'}), 2000);
        } catch (error) {
            console.error("Failed to save project:", error);
            this.setState({ saveStatus: 'error' });
            alert("项目保存失败，您的更改可能不会被保留。请检查您的网络连接并重试。");
        }
    }

  // --- Home Screen Methods ---
    public handleLoadProject(project: 时间轴数据): void {
        if(project) {
            this.setState({ timeline: project, currentView: 'vertical', chatHistory: [], isChatOpen: false, collapsedItems: new Set() });
        }
    }

    public async handleDeleteProject(projectToDelete: 时间轴数据): Promise<void> {
        if (!this.state.currentUser || projectToDelete.ownerId !== this.state.currentUser.id) {
            alert("只有项目所有者才能删除项目。");
            return;
        }
        if (!confirm(`确定要永久废止此征程 “${projectToDelete.项目名称}” 吗？此操作不可撤销。`)) return;
        
        this.setState({ isLoading: true, loadingText: "正在删除项目..."});
        try {
            await api.deleteProject(projectToDelete.id, this.state.currentUser.token);
            const newHistory = this.state.projectsHistory.filter(p => p.id !== projectToDelete.id);
            this.setState({ projectsHistory: newHistory, timeline: null });
        } catch(e) {
            alert("删除项目失败，请稍后重试。");
        } finally {
            this.setState({ isLoading: false });
        }
    }

    public async handleQuickAddTask(event: Event): Promise<void> {
        event.preventDefault();
        if (!this.state.apiKey) {
            this.renderer.showApiKeyModal(true);
            alert("请先提供您的 API 密钥。");
            return;
        }
        if (!this.state.currentUser) return;
        const form = event.currentTarget as HTMLFormElement;
        const projectSelect = form.querySelector('#project-select') as HTMLSelectElement;
        const taskInput = form.querySelector('#quick-add-input') as HTMLTextAreaElement;
        const assigneeInput = form.querySelector('#quick-add-assignee') as HTMLInputElement;
        const deadlineInput = form.querySelector('#quick-add-deadline') as HTMLInputElement;
        const projectId = projectSelect.value;
        const taskDescription = taskInput.value.trim();
        const assignee = assigneeInput.value.trim();
        const deadline = deadlineInput.value.trim().replace('T', ' ');

        if (!projectId || !taskDescription) {
            alert("请选择一个项目并填写任务描述。");
            return;
        }
        const projectToUpdate = this.state.projectsHistory.find(p => p.id === projectId);
        if (!projectToUpdate) return;
        
        this.setState({ isLoading: true, loadingText: "分析中，请稍候..." });
        try {
            const parsedData = await this.ai.quickAddTask(projectToUpdate, taskDescription, assignee, deadline);
            const updatedTimeline = this.postProcessTimelineData({ ...projectToUpdate, ...parsedData });
            await this.saveCurrentProject(updatedTimeline);
            taskInput.value = ''; assigneeInput.value = ''; deadlineInput.value = '';
        } catch (error) {
            console.error("快速追加任务时出错:", error);
            alert("任务追加失败，请稍后重试。这可能是由于 API 密钥无效或网络问题导致。");
        } finally {
            this.setState({ isLoading: false });
        }
    }
  
    public async handleUpdateField(indices: TopLevelIndices, field: string, value: string): Promise<void> {
        if (!this.state.timeline) return;
        const { phaseIndex, projectIndex } = indices;

        if (field === '项目名称' && phaseIndex === undefined) {
            this.state.timeline.项目名称 = value;
        } else if (typeof phaseIndex === 'number') {
            const phase = this.state.timeline.阶段[phaseIndex];
            if (typeof projectIndex === 'number' && field === '项目名称') {
                phase.项目![projectIndex].项目名称 = value;
            } else if (projectIndex === undefined && field === '阶段名称'){
                phase.阶段名称 = value;
            }
        }
        await this.saveCurrentProject(this.state.timeline);
    }
  
    // --- Report Methods ---
    private async handleGenerateReportClick(period: 'weekly' | 'monthly'): Promise<void> {
        if (!this.state.apiKey) {
            this.renderer.showApiKeyModal(true);
            alert("请先提供您的 API 密钥。");
            return;
        }
        if (!this.state.timeline) return;
        this.renderer.showReportModal(true); // Show loading state

        try {
            const reportText = await this.ai.generateReport(this.state.timeline, period);
            this.renderer.showReportModal(false, reportText); // Show result
        } catch (error) {
            console.error("生成报告时出错:", error);
            this.renderer.showReportModal(false, "抱歉，生成报告时发生错误。这可能是由于 API 密钥无效或网络问题导致，请稍后重试。"); // Show error
        }
    }

    // --- Chat Methods ---
    public toggleChat(open: boolean): void {
        this.setState({ isChatOpen: open }, false);
        this.chatPanelEl.classList.toggle('open', open);
        this.chatBackdropEl.classList.toggle('hidden', !open);
        if (open) this.chatInputEl.focus();
    }

    private autoResizeChatInput(): void {
        this.chatInputEl.style.height = 'auto';
        this.chatInputEl.style.height = `${this.chatInputEl.scrollHeight}px`;
    }
    
    private async handleChatSubmit(e: Event): Promise<void> {
        e.preventDefault();
        const userInput = this.chatInputEl.value.trim();
        const attachment = this.state.chatAttachment;
        if (!userInput && !attachment) return;

        this.chatInputEl.value = '';
        this.autoResizeChatInput();
        this.setState({ chatAttachment: null });
        await this.submitChat(userInput, attachment);
    }
    
    public async handleRegenerateClick(): Promise<void> {
        if (this.state.isChatLoading || !this.state.lastUserChatPrompt) return;
        const lastMessage = this.state.chatHistory[this.state.chatHistory.length - 1];
        if (lastMessage && lastMessage.role === 'model') {
            const historyWithoutLastResponse = this.state.chatHistory.slice(0, -1);
            this.setState({ chatHistory: historyWithoutLastResponse }, false);
        }
        // Note: Regeneration doesn't re-use the attachment.
        await this.submitChat(this.state.lastUserChatPrompt, null);
    }

    private applyChanges(changes: ChangeOperation[]): void {
        if (!this.state.timeline) return;
        
        // Before applying, store the current state for undo
        const modificationId = `mod-${Date.now()}`;
        this.setState({
            lastTimelineState: JSON.parse(JSON.stringify(this.state.timeline)),
            lastModificationId: modificationId
        }, false);

        const updatesAndAdds = changes.filter(c => c.op !== 'delete');
        const deletes = changes.filter(c => c.op === 'delete');

        deletes.sort((a, b) => {
            const pathA = a.path.taskPath;
            const pathB = b.path.taskPath;
            if (pathA.length !== pathB.length) return pathB.length - pathA.length;
            for (let i = 0; i < pathA.length; i++) {
                if (pathA[i] !== pathB[i]) return pathB[i] - pathA[i];
            }
            return 0;
        });
    
        for (const change of [...updatesAndAdds, ...deletes]) {
            try {
                switch (change.op) {
                    case 'update': {
                        const result = this.getTaskFromPath(change.path as Indices);
                        if (result && change.value) {
                            Object.assign(result.task, change.value);
                            if ('状态' in change.value) {
                                result.task.已完成 = result.task.状态 === '已完成';
                            }
                        }
                        break;
                    }
                    case 'add': {
                        const { phaseIndex, projectIndex, taskPath } = change.path;
                        if (taskPath.length === 0) {
                            const phase = this.state.timeline.阶段[phaseIndex];
                            if (phase) {
                                const owner = typeof projectIndex === 'number' ? phase.项目![projectIndex] : phase;
                                if (!owner.任务) owner.任务 = [];
                                owner.任务.push(change.value as 任务);
                            }
                        } else {
                            const parentResult = this.getTaskFromPath(change.path as Indices);
                            if (parentResult) {
                                const parentTask = parentResult.task;
                                if (!parentTask.子任务) parentTask.子任务 = [];
                                parentTask.子任务.push(change.value as 任务);
                            }
                        }
                        break;
                    }
                    case 'delete': {
                        const result = this.getTaskFromPath(change.path as Indices);
                        if (result) {
                            result.parent.splice(result.taskIndex, 1);
                        }
                        break;
                    }
                }
            } catch(e) {
                console.error("Failed to apply change:", change, e);
            }
        }
    }

    private async submitChat(userInput: string, attachment: { file: File, data: string } | null): Promise<void> {
        if (!this.state.apiKey) {
            this.renderer.showApiKeyModal(true);
            alert("请先提供您的 API 密钥。");
            return;
        }
        if (this.state.isChatLoading) return;
        
        const attachmentData = attachment ? { name: attachment.file.name, type: attachment.file.type, data: attachment.data } : undefined;

        this.setState({
            isChatLoading: true,
            lastUserChatPrompt: userInput,
            chatHistory: [...this.state.chatHistory, { role: 'user', text: userInput, attachment: attachmentData }],
        });

        try {
            if (attachment) {
                 if (!this.canEditProject()) {
                    this.setState({ chatHistory: [...this.state.chatHistory, { role: 'model', text: "抱歉，您没有修改此项目的权限。" }] });
                    return;
                }
                if (!this.state.timeline) return;

                const { responseText, changes } = await this.ai.processChatWithAttachment(this.state.timeline, userInput, attachmentData!);
                if (changes && changes.length > 0) {
                    this.applyChanges(changes);
                    await this.saveCurrentProject(this.state.timeline);
                }
                this.setState({ chatHistory: [...this.state.chatHistory, { role: 'model', text: responseText, modificationId: this.state.lastModificationId || undefined }] });

            } else {
                const isQuestion = /^(谁|什么|哪里|何时|为何|如何|是|做|能)\b/i.test(userInput) || userInput.endsWith('？') || userInput.endsWith('?');
                if (isQuestion) {
                    const { text, sources } = await this.ai.processChatWithSearch(this.state.timeline, userInput);
                    this.setState({ chatHistory: [...this.state.chatHistory, { role: 'model', text, sources }] });
                } else {
                    if (!this.canEditProject()) {
                        this.setState({ chatHistory: [...this.state.chatHistory, { role: 'model', text: "抱歉，您没有修改此项目的权限。" }] });
                        return;
                    }
                    if (!this.state.timeline) return;
                    
                    const { responseText, changes } = await this.ai.processChatWithModification(this.state.timeline, userInput);
                    
                    if (changes && changes.length > 0) {
                        this.applyChanges(changes);
                        await this.saveCurrentProject(this.state.timeline);
                    }
                    
                    this.setState({ chatHistory: [...this.state.chatHistory, { role: 'model', text: responseText, modificationId: this.state.lastModificationId || undefined }] });
                }
            }
        } catch (error) {
            console.error("智能助理出错:", error);
            this.setState({ chatHistory: [...this.state.chatHistory, { role: 'model', text: "抱歉，理解您的指令时遇到了些问题，请您换一种方式描述，或者稍后再试。这可能是由于 API 密钥无效或网络问题导致。" }] });
        } finally {
            this.setState({ isChatLoading: false, lastModificationId: this.state.lastModificationId || null });
        }
    }

    public getUserRole(): ProjectMemberRole | null {
        if (!this.state.currentUser || !this.state.timeline) return null;
        if (this.state.timeline.ownerId === this.state.currentUser.id) return 'Admin';
        const member = this.state.timeline.members.find(m => m.userId === this.state.currentUser!.id);
        return member ? member.role : null;
    }

    public canEditProject(): boolean {
        const role = this.getUserRole();
        return role === 'Admin' || role === 'Editor';
    }

    public *flattenTasks(): Generator<{ task: 任务; indices: Indices; path: string[] }> {
        if (!this.state.timeline) return;
        for (const [phaseIndex, phase] of this.state.timeline.阶段.entries()) {
            if (phase.项目) {
                for (const [projectIndex, project] of phase.项目.entries()) {
                    const taskIterator = this._taskIterator(project.任务, { phaseIndex, projectIndex }, [phase.阶段名称, project.项目名称]);
                    for (const item of taskIterator) yield item;
                }
            }
            if (phase.任务) {
                const taskIterator = this._taskIterator(phase.任务, { phaseIndex }, [phase.阶段名称]);
                for (const item of taskIterator) yield item;
            }
        }
    }
    private *_taskIterator(tasks: 任务[], baseIndices: TopLevelIndices, path: string[], parentPath: number[] = []): Generator<{ task: 任务; indices: Indices; path: string[] }> {
        for (const [taskIndex, task] of tasks.entries()) {
            const currentTaskPath = [...parentPath, taskIndex];
            yield { task, indices: { ...baseIndices, phaseIndex: baseIndices.phaseIndex!, taskPath: currentTaskPath }, path };
            if (task.子任务) {
                const subTaskIterator = this._taskIterator(task.子任务, baseIndices, path, currentTaskPath);
                for (const item of subTaskIterator) yield item;
            }
        }
    }

    public getProcessedTasks(): { task: 任务; indices: Indices; path: string[] }[] {
      let tasks = Array.from(this.flattenTasks());
      const { status, priority, assignee } = this.state.filters;
      const { sortBy } = this.state;

      if (status.length > 0) tasks = tasks.filter(t => status.includes(t.task.状态));
      if (priority.length > 0) tasks = tasks.filter(t => t.task.优先级 && priority.includes(t.task.优先级));
      if (assignee.length > 0) tasks = tasks.filter(t => t.task.负责人Ids && assignee.some(a => t.task.负责人Ids!.includes(a)));
      
      if (sortBy !== 'default') {
        const priorityMap = { '高': 3, '中': 2, '低': 1 };
        tasks.sort((a, b) => {
            switch (sortBy) {
                case 'deadline':
                    const dateA = a.task.截止日期 ? new Date(a.task.截止日期).getTime() : Infinity;
                    const dateB = b.task.截止日期 ? new Date(b.task.截止日期).getTime() : Infinity;
                    return dateA - dateB;
                case 'priority':
                    const priorityA = priorityMap[a.task.优先级 || '中'] || 0;
                    const priorityB = priorityMap[b.task.优先级 || '中'] || 0;
                    return priorityB - priorityA;
                case 'name':
                    return a.task.任务名称.localeCompare(b.task.任务名称);
                default: return 0;
            }
        });
      }
      return tasks;
    }

    public processTaskArray(tasks: 任务[]): (任务 & { originalIndex?: number })[] {
        if (!tasks) return [];
        let taskCopy: (任务 & { originalIndex?: number })[] = JSON.parse(JSON.stringify(tasks));
        taskCopy.forEach((t, i) => t.originalIndex = i);

        const { status, priority, assignee } = this.state.filters;
        const { sortBy } = this.state;
    
        const filterRecursively = (taskList: (任务 & { originalIndex?: number })[]): (任务 & { originalIndex?: number })[] => {
            return taskList.filter(task => {
                const selfMatches = (status.length === 0 || status.includes(task.状态)) &&
                                  (priority.length === 0 || (task.优先级 && priority.includes(task.优先级))) &&
                                  (assignee.length === 0 || (task.负责人Ids && assignee.some(a => task.负责人Ids!.includes(a))));
                
                if (task.子任务) task.子任务 = filterRecursively(task.子任务 as any);
                return selfMatches || (task.子任务 && task.子任务.length > 0);
            });
        };
        taskCopy = filterRecursively(taskCopy);

        const sortRecursively = (taskList: 任务[]) => {
            if (sortBy !== 'default') {
                const priorityMap = { '高': 3, '中': 2, '低': 1 };
                taskList.sort((a, b) => {
                     switch (sortBy) {
                        case 'deadline':
                            const dateA = a.截止日期 ? new Date(a.截止日期).getTime() : Infinity;
                            const dateB = b.截止日期 ? new Date(b.截止日期).getTime() : Infinity;
                            return dateA - dateB;
                        case 'priority':
                            const priorityA = priorityMap[a.优先级 || '中'] || 0;
                            const priorityB = priorityMap[b.优先级 || '中'] || 0;
                            return priorityB - priorityA;
                        case 'name':
                            return a.任务名称.localeCompare(b.任务名称);
                        default: return 0;
                    }
                });
            }
            taskList.forEach(task => {
                if (task.子任务) sortRecursively(task.子任务);
            });
        };
        sortRecursively(taskCopy);
        return taskCopy;
    }

    public render(): void {
        this.renderer.render();
    }
    
    private handleFileSelect(event: Event): void {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) {
            this.setState({ chatAttachment: null });
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target?.result as string;
            this.setState({ chatAttachment: { file, data: dataUrl } });
        };
        reader.readAsDataURL(file);
    }
    
    public async handleUndoLastAction(): Promise<void> {
        if (this.state.lastTimelineState) {
            this.setState({
                timeline: this.state.lastTimelineState,
                lastTimelineState: null,
                lastModificationId: null
            });
            await this.saveCurrentProject(this.state.timeline!);
        }
    }
}
