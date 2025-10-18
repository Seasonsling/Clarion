import { GoogleGenAI, Type } from "@google/genai";
import { 
    时间轴数据, AppState, CurrentUser, Indices, 任务, 评论, TopLevelIndices, 
    ProjectMember, User, ITimelineApp, ProjectMemberRole 
} from './types.js';
import * as api from './api.js';
import { decodeJwtPayload } from './utils.js';
import { renderUI } from './ui.js';
import { renderView } from './views.js';

export class TimelineApp implements ITimelineApp {
  public state: AppState = {
    currentUser: null,
    allUsers: [],
    projectsHistory: [],
    timeline: null,
    isLoading: false,
    loadingText: "排兵布阵，军令生成中...",
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
  };

  public ai: GoogleGenAI;

  // DOM Elements (public for UI modules)
  public appContainer: HTMLElement;
  public appTopBar: HTMLElement;
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
  public historySectionEl: HTMLElement;
  public historyListEl: HTMLElement;
  public quickAddFormEl: HTMLFormElement;
  public quickAddBtn: HTMLButtonElement;
  public chatPanelEl: HTMLElement;
  public chatBackdropEl: HTMLElement;
  public chatToggleBtn: HTMLButtonElement;
  public chatCloseBtn: HTMLButtonElement;
  public chatHistoryEl: HTMLElement;
  public chatFormEl: HTMLFormElement;
  public chatInputEl: HTMLTextAreaElement;
  public chatSendBtn: HTMLButtonElement;
  public apiKeyModalOverlay: HTMLElement;
  public apiKeyForm: HTMLFormElement;
  public apiKeyInput: HTMLInputElement;
  public apiKeyErrorEl: HTMLElement;


  constructor() {
    this.cacheDOMElements();
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
    this.ai = new GoogleGenAI({ apiKey: this.state.apiKey || '' });
    
    if (token) {
        try {
            const payload = decodeJwtPayload(token);
            if (payload && payload.exp * 1000 > Date.now()) {
                const currentUser: CurrentUser = {
                    id: payload.userId.toString(),
                    username: payload.username,
                    profile: payload.profile,
                    token: token,
                };
                this.state.currentUser = currentUser;
                this.render(); 
                await this.initializeApp(currentUser);
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
      this.handleUrlInvitation();
    } catch (error) {
      console.error('Initialization failed:', error);
      alert('无法从云端同步您的数据，请尝试重新登录。');
      this.setState({ currentUser: null });
    } finally {
      this.setState({ isLoading: false });
    }
  }
  
  private async handleUrlInvitation() {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('projectId');
      
      if (projectId && this.state.currentUser) {
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
          const newMember: ProjectMember = { userId: userId, role: 'Viewer' };
          project.members.push(newMember);
          
          this.setState({ isLoading: true, loadingText: "正在加入项目..."});
          try {
            await this.saveCurrentProject(project);
            alert(`成功加入项目 "${project.项目名称}"！您的默认角色是“观察员”。`);
            this.setState({
                timeline: project,
                currentView: 'vertical'
            });
          } catch(e) {
             alert("加入项目失败，请稍后重试。");
             project.members.pop();
          } finally {
            this.setState({ isLoading: false });
          }
      } else {
          this.setState({ timeline: project, currentView: 'vertical' });
      }
  }

  private cacheDOMElements(): void {
    this.appContainer = document.getElementById("app-container")!;
    this.appTopBar = document.getElementById('app-top-bar')!;
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
    this.historySectionEl = document.getElementById("history-section")!;
    this.historyListEl = document.getElementById("history-list")!;
    this.quickAddFormEl = document.getElementById("quick-add-form") as HTMLFormElement;
    this.quickAddBtn = document.getElementById("quick-add-btn") as HTMLButtonElement;
    this.chatPanelEl = document.getElementById('chat-panel')!;
    this.chatBackdropEl = document.getElementById('chat-backdrop')!;
    this.chatToggleBtn = document.getElementById('chat-toggle-btn') as HTMLButtonElement;
    this.chatCloseBtn = document.getElementById('chat-close-btn') as HTMLButtonElement;
    this.chatHistoryEl = document.getElementById('chat-history')!;
    this.chatFormEl = document.getElementById('chat-form') as HTMLFormElement;
    this.chatInputEl = document.getElementById('chat-input') as HTMLTextAreaElement;
    this.chatSendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement;
    this.apiKeyModalOverlay = document.getElementById('api-key-modal-overlay')!;
    this.apiKeyForm = document.getElementById('api-key-form') as HTMLFormElement;
    this.apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
    this.apiKeyErrorEl = document.getElementById('api-key-error')!;
  }

  private addEventListeners(): void {
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
    this.shareBtn.addEventListener('click', () => renderUI.showMembersModal(this));
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
    this.apiKeyForm.addEventListener('submit', this.handleApiKeySubmit.bind(this));
  }
  
  private handleAuthSwitch(view: 'login' | 'register'): void {
    this.setState({ authView: view });
  }

  private async handleLogin(event: Event): Promise<void> {
    event.preventDefault();
    this.loginErrorEl.textContent = '';
    const username = (this.loginForm.querySelector('input[name="username"]') as HTMLInputElement).value;
    const password = (this.loginForm.querySelector('input[name="password"]') as HTMLInputElement).value;
    
    this.setState({ isLoading: true, loadingText: "登录中..." });
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
        if (response.ok) {
            const { token } = data;
            const payload = decodeJwtPayload(token);
            if (!payload) throw new Error("Failed to parse token from server.");
            const currentUser: CurrentUser = {
                id: payload.userId.toString(),
                username: payload.username,
                profile: payload.profile,
                token: token,
            };
            this.setState({ currentUser: currentUser });
            await this.initializeApp(currentUser);
        } else {
            this.loginErrorEl.textContent = data.message || "用户名或密码无效。";
        }
    } catch (error) {
        this.loginErrorEl.textContent = "登录时发生网络错误。";
        console.error("Login fetch error:", error);
    } finally {
        this.setState({ isLoading: false });
    }
  }

  private async handleRegister(event: Event): Promise<void> {
    event.preventDefault();
    this.registerErrorEl.textContent = '';
    const username = (this.registerForm.querySelector('input[name="username"]') as HTMLInputElement).value;
    const password = (this.registerForm.querySelector('input[name="password"]') as HTMLInputElement).value;

    if (username.length < 3 || password.length < 4) {
        this.registerErrorEl.textContent = "用户名至少3个字符，密码至少4个字符。";
        return;
    }
    
    this.setState({ isLoading: true, loadingText: "注册中..." });
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
        if (response.ok) {
             this.loginForm.querySelector<HTMLInputElement>('input[name="username"]')!.value = username;
             this.loginForm.querySelector<HTMLInputElement>('input[name="password"]')!.value = password;
             await this.handleLogin(event);
        } else {
            this.registerErrorEl.textContent = data.message || "注册失败。";
        }
    } catch (error) {
        this.registerErrorEl.textContent = "注册时发生网络错误。";
        console.error("Register fetch error:", error);
    } finally {
        this.setState({ isLoading: false });
    }
  }

  public setState(newState: Partial<AppState>, shouldRender: boolean = true): void {
    const oldUser = this.state.currentUser;
    this.state = { ...this.state, ...newState };
    
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

  private createTimelineSchema() {
      const commentSchema = {
          type: Type.OBJECT,
          properties: {
              发言人Id: { type: Type.STRING, description: "The ID of the user who made the comment" },
              内容: { type: Type.STRING },
              时间戳: { type: Type.STRING, description: "ISO 8601 format timestamp" }
          },
          required: ["发言人Id", "内容", "时间戳"]
      };

      const createTaskProperties = () => ({
          id: { type: Type.STRING, description: "A unique string identifier for the task (e.g., 'task-abc-123'). MUST be unique across the entire project." },
          任务名称: { type: Type.STRING },
          状态: { type: Type.STRING, enum: ['待办', '进行中', '已完成'] },
          优先级: { type: Type.STRING, enum: ['高', '中', '低'], description: "任务的优先级" },
          详情: { type: Type.STRING },
          开始时间: { type: Type.STRING, description: "格式 YYYY-MM-DD HH:mm" },
          截止日期: { type: Type.STRING, description: "格式 YYYY-MM-DD HH:mm" },
          负责人Ids: { type: Type.ARRAY, items: { type: Type.STRING }, description: "An array of user IDs for the assignees." },
          备注: { type: Type.STRING },
          讨论: { type: Type.ARRAY, items: commentSchema, description: "与任务相关的讨论记录" },
          dependencies: { type: Type.ARRAY, items: { type: Type.STRING }, description: "An array of task IDs that this task depends on." }
      });

      const createRecursiveTaskSchema = (depth: number): any => {
          const properties: any = createTaskProperties();
          const schema: any = { type: Type.OBJECT, properties, required: ["id", "任务名称", "状态"] };
          if (depth > 0) {
              properties.子任务 = { type: Type.ARRAY, items: createRecursiveTaskSchema(depth - 1) };
          }
          return schema;
      };
      
      const taskSchema = createRecursiveTaskSchema(4);
      const nestedProjectSchema = { type: Type.OBJECT, properties: { 项目名称: { type: Type.STRING }, 备注: { type: Type.STRING }, 任务: { type: Type.ARRAY, items: taskSchema } }, required: ["项目名称", "任务"] };
      const phaseSchema = { type: Type.OBJECT, properties: { 阶段名称: { type: Type.STRING }, 任务: { type: Type.ARRAY, items: taskSchema }, 项目: { type: Type.ARRAY, items: nestedProjectSchema } }, required: ["阶段名称"] };
      return { type: Type.OBJECT, properties: { 项目名称: { type: Type.STRING }, 阶段: { type: Type.ARRAY, items: phaseSchema } }, required: ["项目名称", "阶段"] };
  }

  private getCurrentDateContext(): string {
      const now = new Date().toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `请注意：当前日期和时间是 ${now}。请根据此时间解析任何相对时间表述（例如“明天下午”、“下周”）。所有输出的时间都应为“YYYY-MM-DD HH:mm”格式，精确到分钟。`;
  }

  private async handleGenerateClick(): Promise<void> {
    if (!this.state.apiKey) {
        renderUI.showApiKeyModal(this, true);
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
      const responseSchema = this.createTimelineSchema();
      const prompt = `${this.getCurrentDateContext()} 为以下项目描述，创建一份详尽的、分阶段的中文项目计划。计划应包含项目名称、阶段、任务及可嵌套的子任务。每个任务需包含：任务名称、状态（'待办'、'进行中'或'已完成'）、优先级（'高'、'中'或'低'）、详情、开始时间、截止日期（格式均为 YYYY-MM-DD HH:mm）、负责人和备注。如果描述中提到了负责人，请将他们的名字放入“负责人”字段。
**极其重要**:
1.  **唯一ID**: 你必须为每一个任务（包括子任务）生成一个在整个项目中唯一的字符串 'id'。
2.  **依赖关系**: 你必须识别任务间的依赖关系。例如，如果“任务B”必须在“任务A”完成后才能开始，你必须将“任务A”的 'id' 添加到“任务B”的 'dependencies' 数组中。
3.  **时间解析**: 如果项目描述中提到了任何日期或时间（例如“下周五截止”、“明天下午3点开始”），你必须基于当前时间上下文，将它们解析为精确的日期和时间，并填入相应的“开始时间”和“截止日期”字段。不要将时间信息遗漏在“详情”字段中。

项目描述如下：
---
${projectDescription}
---`;
      
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema: responseSchema },
      });
      
      const parsedData = JSON.parse(response.text);
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
  
  private handleApiKeySubmit(event: Event): void {
      event.preventDefault();
      const apiKey = this.apiKeyInput.value.trim();
      if (!apiKey) {
          this.apiKeyErrorEl.textContent = 'API 密钥不能为空。';
          this.apiKeyErrorEl.classList.remove('hidden');
          return;
      }
      this.apiKeyErrorEl.textContent = '';
      this.apiKeyErrorEl.classList.add('hidden');
      this.ai = new GoogleGenAI({ apiKey });
      this.setState({ apiKey });
      renderUI.showApiKeyModal(this, false);
  }

  public postProcessTimelineData(data: 时间轴数据): 时间轴数据 {
      let taskCounter = 0;
      const assignedIds = new Set<string>();
      const processTasksRecursively = (tasks: 任务[]) => {
          tasks.forEach(task => {
              if (!task.id || assignedIds.has(task.id)) {
                  task.id = `task-${Date.now()}-${taskCounter++}`;
              }
              assignedIds.add(task.id);
              task.已完成 = task.状态 === '已完成';
              if (task.子任务) processTasksRecursively(task.子任务);
          });
      };
      data.阶段.forEach(phase => {
          if (phase.任务) processTasksRecursively(phase.任务);
          if (phase.项目) phase.项目.forEach(proj => processTasksRecursively(proj.任务));
      });
      return data;
  }

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
                if (task.子任务) task.子任务.forEach(completeTaskRecursively);
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
    
    public async handleAddComment(indices: Indices, content: string): Promise<void> {
        if (!content.trim() || !this.state.currentUser) return;
        const result = this.getTaskFromPath(indices);
        if (result && this.state.timeline) {
            const task = result.task;
            if (!task.讨论) task.讨论 = [];
            const newComment: 评论 = {
                发言人Id: this.state.currentUser.id,
                内容: content,
                时间戳: new Date().toISOString(),
            };
            task.讨论.push(newComment);
            await this.saveCurrentProject(this.state.timeline);
        }
    }

    private async handleMoveTask(draggedIndices: Indices, dropIndices: Indices, position: 'before' | 'after'): Promise<void> {
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
        const projectIndex = this.state.projectsHistory.findIndex(p => p.id === updatedTimeline.id);
        const newHistory = [...this.state.projectsHistory];
        if (projectIndex !== -1) {
            newHistory[projectIndex] = updatedTimeline;
        } else {
             newHistory.push(updatedTimeline);
        }
        this.setState({ timeline: { ...updatedTimeline }, projectsHistory: newHistory, saveStatus: 'saving' });
        try {
            await api.updateProject(updatedTimeline, this.state.currentUser!.token);
            this.setState({ saveStatus: 'saved' });
        } catch (error) {
            console.error("Failed to save project:", error);
            this.setState({ saveStatus: 'error' });
            alert("项目保存失败，您的更改可能不会被保留。请检查您的网络连接并重试。");
        }
    }

    public handleLoadProject(project: 时间轴数据): void {
        if(project) {
            this.setState({ timeline: project, currentView: 'vertical', chatHistory: [], isChatOpen: false, collapsedItems: new Set() });
        }
    }

    private async handleDeleteProject(projectToDelete: 时间轴数据): Promise<void> {
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

    private async handleQuickAddTask(event: Event): Promise<void> {
        event.preventDefault();
        if (!this.state.apiKey) {
            renderUI.showApiKeyModal(this, true);
            alert("请先提供您的 API 密钥。");
            return;
        }
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
        this.setState({ isLoading: true, loadingText: "智能分析中，请稍候..." });
        try {
            const responseSchema = this.createTimelineSchema();
            let additionalInfo = '';
            if (assignee) additionalInfo += `任务的“负责人”应为“${assignee}”。`;
            if (deadline) additionalInfo += `任务的“截止日期”应为“${deadline}”。`;
            const prompt = `${this.getCurrentDateContext()} 作为一名智能项目管理助手，请分析以下项目计划JSON。用户想要添加一个新任务，描述如下：“${taskDescription}”。
${additionalInfo ? `此外，用户还提供了以下信息：${additionalInfo}` : ''}
你的任务是：
1.  **智能定位**：判断这个新任务最应该属于哪个阶段（以及哪个内嵌项目，如果适用）。
2.  **创建任务**：为这个新任务创建一个合理的“任务名称”，并将其“状态”设置为“待办”。你必须为新任务生成一个唯一的 'id'。
3.  **推断依赖**：分析任务描述，看它是否依赖于计划中已有的其他任务。如果是，请在 'dependencies' 数组中添加相应任务的 'id'。
4.  **提取信息**：从任务描述中智能提取任务的“详情”、“开始时间”、“截止日期”和“优先级”。你必须将解析出的时间信息放入对应的字段。
5.  **使用补充信息**：如果用户提供了负责人或截止日期，请优先使用它们。如果描述和补充信息中的截止日期冲突，以补充信息为准。
6.  **添加任务**：将新创建的任务对象添加到项目计划中正确的位置。
7.  **返回结果**：返回完整的、更新后的项目计划JSON。
---
当前项目计划:
${JSON.stringify(projectToUpdate)}
---`;
            const response = await this.ai.models.generateContent({
                model: "gemini-2.5-pro",
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema },
            });
            const parsedData = JSON.parse(response.text);
            const updatedTimeline = this.postProcessTimelineData({ ...projectToUpdate, ...parsedData });
            await this.saveCurrentProject(updatedTimeline);
            taskInput.value = '';
            assigneeInput.value = '';
            deadlineInput.value = '';
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
  
    public showEditModal(indices: Indices, task: 任务): void {
        renderUI.showEditModal(this, indices, task);
    }

    private async handleGenerateReportClick(period: 'weekly' | 'monthly'): Promise<void> {
        if (!this.state.apiKey) {
            renderUI.showApiKeyModal(this, true);
            alert("请先提供您的 API 密钥。");
            return;
        }
        renderUI.showReportModal(this, true);
        try {
            const currentDate = new Date().toLocaleDateString('en-CA');
            const periodText = period === 'weekly' ? '过去7天' : '过去30天';
            const nextPeriodText = period === 'weekly' ? '未来7天' : '未来30天';
            const reportTitle = period === 'weekly' ? '周报' : '月报';
            const prompt = `As a professional project manager AI, analyze the following project plan JSON. Based on the data, generate a concise and structured project status report in Chinese. The report is a **${reportTitle}** reflecting activities in the **${periodText}**. The current date is ${currentDate}.
The report must follow this structure, including the markdown-style headers:
### 1. 本期总体进度 (Overall Progress This Period)
Briefly summarize the project's health. Focus on progress made in the **${periodText}**. Mention key milestones achieved or shifts in timeline.
### 2. 本期关键成果 (Key Accomplishments This Period)
List important tasks that were marked as '已完成' during the **${periodText}**.
### 3. 延期、阻碍与风险 (Delays, Obstacles & Risks)
Identify any tasks that are past their '截止日期' but not yet '已完成'. Based on task descriptions, comments, and statuses, infer and briefly state the potential **reasons for the delay**. Highlight any **obstacles** encountered during this period and potential upcoming **risks** that might impede future progress.
### 4. 下期工作计划 (Next Period's Plan)
List the key tasks that are scheduled to start or are due within the **${nextPeriodText}**.
Here is the project data:
---
${JSON.stringify(this.state.timeline, null, 2)}
---
Provide the report in a clean, readable format suitable for copying into an email or document. Use markdown for headers.`;

            const response = await this.ai.models.generateContent({
                model: "gemini-2.5-pro",
                contents: prompt,
            });
            renderUI.showReportModal(this, false, response.text);
        } catch (error) {
            console.error("生成报告时出错:", error);
            renderUI.showReportModal(this, false, "抱歉，生成报告时发生错误。这可能是由于 API 密钥无效或网络问题导致，请稍后重试。");
        }
    }

    private toggleChat(open: boolean): void {
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
        if (!userInput) return;
        this.chatInputEl.value = '';
        this.autoResizeChatInput();
        await this.submitChat(userInput);
    }
    
    public async handleRegenerateClick(): Promise<void> {
        if (this.state.isChatLoading || !this.state.lastUserChatPrompt) return;
        const lastMessage = this.state.chatHistory[this.state.chatHistory.length - 1];
        if (lastMessage && lastMessage.role === 'model') {
            const historyWithoutLastResponse = this.state.chatHistory.slice(0, -1);
            this.setState({ chatHistory: historyWithoutLastResponse }, false);
        }
        await this.submitChat(this.state.lastUserChatPrompt);
    }

    private async submitChat(userInput: string): Promise<void> {
        if (!this.state.apiKey) {
            renderUI.showApiKeyModal(this, true);
            alert("请先提供您的 API 密钥。");
            return;
        }
        if (this.state.isChatLoading) return;
        // FIX: Use 'as const' to ensure the role is not widened to a generic string type.
        const newHistory = [...this.state.chatHistory, { role: 'user' as const, text: userInput }];
        this.setState({ isChatLoading: true, lastUserChatPrompt: userInput, chatHistory: newHistory });
        try {
            const isQuestion = /^(谁|什么|哪里|何时|为何|如何|是|做|能)\b/i.test(userInput) || userInput.endsWith('？') || userInput.endsWith('?');
            if (isQuestion) {
                const response = await this.ai.models.generateContent({
                    model: "gemini-2.5-pro",
                    contents: `请根据您的知识和网络搜索结果，用中文回答以下问题。如果问题与提供的项目计划有关，请结合上下文回答。
---
当前项目计划 (上下文参考):
${JSON.stringify(this.state.timeline)}
---
用户问题: "${userInput}"`,
                    config: { tools: [{ googleSearch: {} }] },
                });
                const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
                const sources = groundingChunks?.map((chunk: any) => ({ uri: chunk.web.uri, title: chunk.web.title })) || [];
                // FIX: Use 'as const' to ensure the role is not widened to a generic string type.
                const finalHistory = [...this.state.chatHistory, { role: 'model' as const, text: response.text, sources }];
                this.setState({ chatHistory: finalHistory });
            } else {
                if (!this.canEditProject()) {
                    // FIX: Use 'as const' to ensure the role is not widened to a generic string type.
                    const errorHistory = [...this.state.chatHistory, { role: 'model' as const, text: "抱歉，您没有修改此项目的权限。" }];
                    this.setState({ chatHistory: errorHistory });
                    return;
                }
                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        responseText: { type: Type.STRING, description: "用中文对用户的请求进行友好、确认性的回应。如果无法执行操作，请解释原因。" },
                        updatedTimeline: this.createTimelineSchema(),
                    },
                    required: ["responseText", "updatedTimeline"],
                };
                const response = await this.ai.models.generateContent({
                    model: "gemini-2.5-pro",
                    contents: `${this.getCurrentDateContext()} 作为一名高级项目管理AI助手，请根据用户的自然语言请求，智能地修改提供的项目计划JSON。
您的任务是：
1.  **解析意图**：深入理解用户的请求，这可能包括任务的新增、查询、状态更新（例如，“我做完了方案设计”），日期调整（“把EDC系统交付推迟2天”），甚至是删除（“取消那个市场调研任务”）。
2.  **精确时间**：当用户提到相对时间（如“推迟2天”、“明天中午12点”），你必须根据当前时间上下文计算出精确的“YYYY-MM-DD HH:mm”格式的时间，并更新相应的“开始时间”或“截止日期”字段。
3.  **智能操作**：
    - **更新**: 根据请求修改任务的字段。
    - **完成**: 当用户表示任务完成时，请将其 '状态' 字段更新为 '已完成'，并设置 '已完成' 字段为 true。如果一个任务的所有子任务都已完成，请考虑将其父任务也标记为 '已完成'。
    - **删除**: 如果用户要求删除任务，请从计划中移除对应的任务对象。
    - **查询**: 如果用户只是提问（例如，“EDC系统交付是什么时候？”），请在 responseText 中回答问题，并返回未经修改的原始项目计划。
4.  **返回结果**：返回一个包含两部分的JSON对象：一个是对用户操作的友好中文确认信息（responseText），另一个是完整更新后的项目计划（updatedTimeline）。请确保整个项目计划被完整返回，而不仅仅是修改的部分。如果无法执行操作，请在responseText中说明原因，并返回原始的updatedTimeline。
---
当前项目计划:
${JSON.stringify(this.state.timeline)}
---
用户请求:
"${userInput}"
---`,
                    config: { responseMimeType: "application/json", responseSchema: responseSchema },
                });
                const result = JSON.parse(response.text);
                const updatedTimeline = this.postProcessTimelineData({ ...this.state.timeline, ...result.updatedTimeline });
                // FIX: Use 'as const' to ensure the role is not widened to a generic string type.
                const finalHistory = [...this.state.chatHistory, { role: 'model' as const, text: result.responseText }];
                await this.saveCurrentProject(updatedTimeline);
                this.setState({ chatHistory: finalHistory });
            }
        } catch (error) {
            console.error("智能助理出错:", error);
            // FIX: Use 'as const' to ensure the role is not widened to a generic string type.
            const errorHistory = [...this.state.chatHistory, { role: 'model' as const, text: "抱歉，理解您的指令时遇到了些问题，请您换一种方式描述，或者稍后再试。这可能是由于 API 密钥无效或网络问题导致。" }];
            this.setState({ chatHistory: errorHistory });
        } finally {
            this.setState({ isChatLoading: false });
        }
    }

    public render(): void {
        this.loadingOverlay.classList.toggle("hidden", !this.state.isLoading);
        this.loadingTextEl.textContent = this.state.loadingText;
        if (!this.state.currentUser) {
            renderUI.renderAuth(this);
            this.appTopBar.classList.add('hidden');
            return;
        }

        this.appTopBar.classList.remove('hidden');
        this.authSection.classList.add('hidden');
        this.generateBtn.disabled = this.state.isLoading;
        if (this.generateBtn.querySelector('span')) {
            this.generateBtn.querySelector('span')!.textContent = this.state.isLoading ? "生成中..." : "开始生成";
        }
        this.chatSendBtn.disabled = this.state.isChatLoading;
        renderUI.renderUserDisplay(this);
        if (this.state.timeline) {
            this.inputSection.classList.add("hidden");
            this.timelineSection.classList.remove("hidden");
            setTimeout(() => this.timelineSection.classList.add('visible'), 10);
            const userRole = this.getUserRole();
            const readOnly = userRole === 'Viewer';
            this.projectNameEl.innerHTML = '';
            this.projectNameEl.appendChild(renderUI.createEditableElement(this, 'h2', this.state.timeline.项目名称, {}, '项目名称'));
            if (readOnly) {
                const badge = document.createElement('span');
                badge.className = 'readonly-badge';
                badge.textContent = '只读模式';
                this.projectNameEl.appendChild(badge);
            }
            renderUI.renderSaveStatusIndicator(this);
            this.shareBtn.style.display = userRole === 'Viewer' ? 'none' : 'inline-flex';
            renderUI.renderViewSwitcher(this);
            renderUI.renderViewSpecificControls(this);
            renderUI.renderFilterSortControls(this);
            renderUI.renderChat(this);
            renderView(this);
        } else {
            this.inputSection.classList.remove("hidden");
            this.timelineSection.classList.add("hidden");
            this.timelineSection.classList.remove('visible');
            renderUI.renderHomeScreen(this);
        }
    }

    public getUserProjects(): 时间轴数据[] {
        if (!this.state.currentUser) return [];
        return this.state.projectsHistory.filter(p => p.members.some(m => m.userId === this.state.currentUser!.id));
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
            taskList.forEach(task => { if (task.子任务) sortRecursively(task.子任务); });
        };
        sortRecursively(taskCopy);
        return taskCopy;
    }
}

document.addEventListener("DOMContentLoaded", () => {
  new TimelineApp();
});