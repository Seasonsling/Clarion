import { GoogleGenAI, Type } from "@google/genai";

// --- Data Interfaces for Users and Collaboration ---
interface UserProfile {
  displayName: string;
  avatarUrl?: string;
  // A color derived from username for UI consistency
  color: string; 
}

// User object, password is no longer stored on the client
interface User {
  id: string; // This will come from the database ID
  username: string;
  profile: UserProfile;
}

// A new interface for the currently logged-in user, including their auth token
interface CurrentUser extends User {
    token: string;
}

type ProjectMemberRole = 'Admin' | 'Editor' | 'Viewer';

interface ProjectMember {
  userId: string;
  role: ProjectMemberRole;
}

// --- Data Interfaces for the timeline (in Chinese) ---
interface 评论 {
  发言人Id: string; // Changed from string to userId
  内容: string;
  时间戳: string;
}

type TaskStatus = '待办' | '进行中' | '已完成';
type TaskPriority = '高' | '中' | '低';

interface 任务 {
  id: string; // Unique ID for the task
  任务名称: string;
  状态: TaskStatus;
  优先级?: TaskPriority;
  详情?: string;
  开始时间?: string;
  截止日期?: string;
  负责人Ids?: string[]; // Changed from string to array of userIds
  备注?: string;
  已完成: boolean;
  子任务?: 任务[];
  讨论?: 评论[];
  dependencies?: string[]; // IDs of tasks this one depends on
}

interface 内嵌项目 {
  项目名称: string;
  备注?: string;
  任务: 任务[];
}

interface 阶段 {
  阶段名称: string;
  任务?: 任务[];
  项目?: 内嵌项目[];
}

interface 时间轴数据 {
  id: string; // Unique project ID
  项目名称: string;
  阶段: 阶段[];
  ownerId: string;
  members: ProjectMember[];
}

type ViewType = 'vertical' | 'gantt' | 'kanban' | 'calendar' | 'workload' | 'dependencies' | 'mindmap';
type ChatRole = 'user' | 'model';
type GanttGranularity = 'days' | 'weeks' | 'months';

interface ChatMessage {
    role: ChatRole;
    text: string;
    sources?: { uri: string; title: string }[];
}

interface AppState {
  currentUser: CurrentUser | null;
  // allUsers is kept for now to support avatar lookups for existing local projects.
  // This will be replaced when projects are moved to the backend.
  allUsers: User[]; 
  projectsHistory: 时间轴数据[];
  timeline: 时间轴数据 | null;
  isLoading: boolean;
  loadingText: string;
  currentView: ViewType;
  authView: 'login' | 'register';
  calendarDate: Date;
  isChatOpen: boolean;
  isChatLoading: boolean;
  chatHistory: ChatMessage[];
  lastUserChatPrompt: string;
  filters: {
    status: TaskStatus[];
    priority: TaskPriority[];
    assignee: string[];
  };
  sortBy: 'default' | 'deadline' | 'priority' | 'name';
  ganttGranularity: GanttGranularity;
  ganttZoomLevel: number;
  mindMapState: {
    collapsedNodes: Set<string>;
  };
  apiKey: string | null;
}

interface Indices {
  phaseIndex: number;
  projectIndex?: number;
  taskPath: number[];
}

interface TopLevelIndices {
    phaseIndex?: number;
    projectIndex?: number;
}


class TimelineApp {
  private state: AppState = {
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
  };

  private ai: GoogleGenAI;

  // DOM Elements
  private appContainer: HTMLElement;
  private authSection: HTMLElement;
  private loginForm: HTMLFormElement;
  private registerForm: HTMLFormElement;
  private showLoginBtn: HTMLButtonElement;
  private showRegisterBtn: HTMLButtonElement;
  private loginErrorEl: HTMLElement;
  private registerErrorEl: HTMLElement;

  private inputSection: HTMLElement;
  private timelineSection: HTMLElement;
  private projectInput: HTMLTextAreaElement;
  private generateBtn: HTMLButtonElement;
  private timelineContainer: HTMLElement;
  private projectNameEl: HTMLElement;
  private userDisplayEl: HTMLElement;
  private shareBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;
  private loadingOverlay: HTMLElement;
  private loadingTextEl: HTMLElement;
  private importBtn: HTMLButtonElement;
  private exportBtn: HTMLButtonElement;
  private importFileEl: HTMLInputElement;
  private viewSwitcherEl: HTMLElement;
  private viewSpecificControlsEl: HTMLElement | null = null;
  private filterSortControlsEl: HTMLElement;
  private reportBtnToggle: HTMLButtonElement;
  private reportDropdown: HTMLElement;
  // Home Screen Elements
  private historySectionEl: HTMLElement;
  private historyListEl: HTMLElement;
  private quickAddFormEl: HTMLFormElement;
  private quickAddBtn: HTMLButtonElement;
  // Chat Elements
  private chatPanelEl: HTMLElement;
  private chatBackdropEl: HTMLElement;
  private chatToggleBtn: HTMLButtonElement;
  private chatCloseBtn: HTMLButtonElement;
  private chatHistoryEl: HTMLElement;
  private chatFormEl: HTMLFormElement;
  private chatInputEl: HTMLTextAreaElement;
  private chatSendBtn: HTMLButtonElement;
  // API Key Modal Elements
  private apiKeyModalOverlay: HTMLElement;
  private apiKeyForm: HTMLFormElement;
  private apiKeyInput: HTMLInputElement;
  private apiKeyErrorEl: HTMLElement;


  constructor() {
    this.loadState();
    this.ai = new GoogleGenAI({ apiKey: this.state.apiKey || '' });
    this.cacheDOMElements();
    this.addEventListeners();
    this.handleUrlInvitation(); // Check for invites on load
    this.render();
  }
  
  private handleUrlInvitation() {
      const urlParams = new URLSearchParams(window.location.search);
      const projectId = urlParams.get('projectId');
      
      if (projectId && this.state.currentUser) {
          this.joinProject(projectId, this.state.currentUser.id);
          // Clean up URL
          window.history.replaceState({}, document.title, window.location.pathname);
      }
  }
  
  private joinProject(projectId: string, userId: string) {
      // NOTE: This logic is still client-side. It will be moved to the backend
      // when project data is migrated.
      const projectIndex = this.state.projectsHistory.findIndex(p => p.id === projectId);
      if (projectIndex === -1) {
          alert("邀请链接无效或项目已不存在。");
          return;
      }
      
      const project = this.state.projectsHistory[projectIndex];
      const isAlreadyMember = project.members.some(m => m.userId === userId);

      if (!isAlreadyMember) {
          const newMember: ProjectMember = { userId: userId, role: 'Viewer' }; // Default role
          project.members.push(newMember);
          
          const newHistory = [...this.state.projectsHistory];
          newHistory[projectIndex] = project;
          
          this.setState({
              projectsHistory: newHistory,
              timeline: project, // Automatically load the project
              currentView: 'vertical'
          });
          
          alert(`成功加入项目 "${project.项目名称}"！您的默认角色是“观察员”。`);
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
    this.shareBtn.addEventListener('click', () => this.showMembersModal());
    
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

    // API Key Modal Listener
    this.apiKeyForm.addEventListener('submit', this.handleApiKeySubmit.bind(this));
    
    // Pseudo real-time sync listener (for projects only now)
    window.addEventListener('storage', (e) => {
        if (e.key === 'timelineAppData' && e.newValue) {
            const oldData = JSON.parse(e.oldValue || '{}');
            const newData = JSON.parse(e.newValue);
            
            // Only reload if project data changed. User auth is handled by token.
            if(JSON.stringify(oldData.projects) !== JSON.stringify(newData.projects)) {
                this.loadState();
                
                if (this.state.timeline) {
                    const updatedTimeline = this.state.projectsHistory.find(p => p.id === this.state.timeline?.id);
                    this.setState({ timeline: updatedTimeline || null }, true);
                } else {
                    this.render(); 
                }
            }
        }
    });
  }

  // --- UTILITIES ---
  private stringToColor(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    let color = '#';
    for (let i = 0; i < 3; i++) {
      const value = (hash >> (i * 8)) & 0xFF;
      color += ('00' + value.toString(16)).substr(-2);
    }
    return color;
  }
  
  private renderUserAvatar(userId: string): string {
      const user = this.state.allUsers.find(u => u.id === userId) || (this.state.currentUser?.id === userId ? this.state.currentUser : null);
      if (!user) {
          return `<div class="avatar" style="background-color: #ccc;">?</div>`;
      }
      
      if (user.profile.avatarUrl) {
          return `<img src="${user.profile.avatarUrl}" alt="${user.profile.displayName}" class="avatar">`;
      }
      
      const initials = user.profile.displayName.substring(0, 2).toUpperCase();
      return `<div class="avatar" style="background-color: ${user.profile.color}; color: #fff;" title="${user.profile.displayName}">${initials}</div>`;
  }
  
  // --- AUTH & USER MGMT ---
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

        if (response.ok) {
            const { token } = await response.json();
            // Decode token to get user info
            const payload = JSON.parse(atob(token.split('.')[1]));
            const currentUser: CurrentUser = {
                id: payload.userId.toString(), // Ensure ID is a string
                username: payload.username,
                profile: payload.profile,
                token: token,
            };
            this.setState({ currentUser: currentUser });
            this.handleUrlInvitation();
            if (!this.state.apiKey) {
                this.showApiKeyModal(true);
            }
        } else {
            const error = await response.json();
            this.loginErrorEl.textContent = error.message || "用户名或密码无效。";
        }
    } catch (error) {
        this.loginErrorEl.textContent = "登录时发生网络错误。";
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

        if (response.ok) {
             // Automatically log in after successful registration
            await this.handleLogin(event);
        } else {
            const error = await response.json();
            this.registerErrorEl.textContent = error.message || "注册失败。";
        }
    } catch (error) {
        this.registerErrorEl.textContent = "注册时发生网络错误。";
    } finally {
        this.setState({ isLoading: false });
    }
  }

  private setState(newState: Partial<AppState>, shouldRender: boolean = true): void {
    const oldUser = this.state.currentUser;
    this.state = { ...this.state, ...newState };
    
    if (shouldRender) {
      this.render();
    }
    
    // Handle saving state to localStorage
    if (newState.currentUser !== undefined) {
      if (newState.currentUser) {
        // Just logged in
        this.saveState();
      } else if (oldUser && !newState.currentUser) {
        // Just logged out
        localStorage.removeItem('timelineAppData');
      }
    } else if (newState.projectsHistory !== undefined || newState.apiKey !== undefined || newState.allUsers !== undefined) {
      this.saveState();
    }
  }

  private saveState(): void {
    // Now only saves token, API key, and client-side project data.
    const appData = {
        authToken: this.state.currentUser?.token,
        apiKey: this.state.apiKey,
        projects: this.state.projectsHistory,
        // Kept for backward compatibility for avatar lookups. To be removed.
        users: this.state.allUsers,
    };
    localStorage.setItem("timelineAppData", JSON.stringify(appData));
  }

  private loadState(): void {
    const savedDataJSON = localStorage.getItem("timelineAppData");
    if (savedDataJSON) {
        try {
            const savedData = JSON.parse(savedDataJSON);
            const token = savedData.authToken;
            let currentUser: CurrentUser | null = null;
            
            if (token) {
                const payload = JSON.parse(atob(token.split('.')[1]));
                // Check if token is expired
                if (payload.exp * 1000 > Date.now()) {
                    currentUser = {
                        id: payload.userId.toString(),
                        username: payload.username,
                        profile: payload.profile,
                        token: token,
                    };
                }
            }
            
            // `allUsers` and `projectsHistory` are still loaded from local storage
            // until they are migrated to the backend.
            const allUsers = Array.isArray(savedData.users) ? savedData.users : [];
            const projectsHistory = Array.isArray(savedData.projects) ? savedData.projects : [];
            const apiKey = savedData.apiKey || null;
            
            this.state = {
                ...this.state,
                currentUser,
                apiKey,
                allUsers,
                projectsHistory,
            };
        } catch(e) {
            console.error("Failed to load state, starting fresh.", e);
            localStorage.removeItem("timelineAppData");
            this.state = { ...this.state, currentUser: null, projectsHistory: [], allUsers: [], apiKey: null };
        }
    }
  }
  
  private handleClearClick(): void {
    this.setState({ timeline: null, chatHistory: [], isChatOpen: false });
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
    reader.onload = (e) => {
        try {
            const result = e.target?.result as string;
            const data = JSON.parse(result);
            if (data.项目名称 && Array.isArray(data.阶段)) {
                // Assign ownership to current user upon import
                data.id = `proj-${Date.now()}`;
                data.ownerId = this.state.currentUser!.id;
                data.members = [{ userId: this.state.currentUser!.id, role: 'Admin' }];
                const newProject = this.postProcessTimelineData(data);
                
                // Add current user to `allUsers` if not present, for avatar lookup.
                const userExists = this.state.allUsers.some(u => u.id === this.state.currentUser!.id);
                const newAllUsers = !userExists
                    ? [...this.state.allUsers, {id: this.state.currentUser!.id, username: this.state.currentUser!.username, profile: this.state.currentUser!.profile}]
                    : this.state.allUsers;

                const newHistory = [...this.state.projectsHistory, newProject];
                this.setState({ timeline: newProject, projectsHistory: newHistory, allUsers: newAllUsers });
            } else {
                alert("导入失败。文件格式无效或不兼容。");
            }
        } catch (error) {
            alert("文件读取错误，请检查文件是否损坏。");
            console.error("导入错误：", error);
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
        this.showApiKeyModal(true);
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
      const currentDateContext = this.getCurrentDateContext();
      const prompt = `${currentDateContext} 为以下项目描述，创建一份详尽的、分阶段的中文项目计划。计划应包含项目名称、阶段、任务及可嵌套的子任务。每个任务需包含：任务名称、状态（'待办'、'进行中'或'已完成'）、优先级（'高'、'中'或'低'）、详情、开始时间、截止日期（格式均为 YYYY-MM-DD HH:mm）、负责人和备注。如果描述中提到了负责人，请将他们的名字放入“负责人”字段。
**极其重要**:
1.  **唯一ID**: 你必须为每一个任务（包括子任务）生成一个在整个项目中唯一的字符串 'id'。
2.  **依赖关系**: 你必须识别任务间的依赖关系。例如，如果“任务B”必须在“任务A”完成后才能开始，你必须将“任务A”的 'id' 添加到“任务B”的 'dependencies' 数组中。
3.  **时间解析**: 如果项目描述中提到了任何日期或时间（例如“下周五截止”、“明天下午3点开始”），你必须基于当前时间上下文，将它们解析为精确的日期和时间，并填入相应的“开始时间”和“截止日期”字段。不要将时间信息遗漏在“详情”字段中。

项目描述如下：
---
${projectDescription}
---`;
      
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
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
      
      const userExists = this.state.allUsers.some(u => u.id === this.state.currentUser!.id);
      const newAllUsers = !userExists
          ? [...this.state.allUsers, {id: this.state.currentUser!.id, username: this.state.currentUser!.username, profile: this.state.currentUser!.profile}]
          : this.state.allUsers;

      const processedData = this.postProcessTimelineData(timelineData);
      const newHistory = [...this.state.projectsHistory, processedData];
      this.setState({ timeline: processedData, projectsHistory: newHistory, allUsers: newAllUsers, currentView: 'vertical', chatHistory: [], isChatOpen: false });
    } catch (error) {
      console.error("生成计划时出错：", error);
      alert("计划生成失败，请稍后重试。这可能是由于 API 密钥无效或网络问题导致。");
    } finally {
      this.setState({ isLoading: false });
    }
  }
  
  private showApiKeyModal(show: boolean): void {
      this.apiKeyErrorEl.classList.add('hidden');
      this.apiKeyErrorEl.textContent = '';
      this.apiKeyModalOverlay.classList.toggle('hidden', !show);
      this.apiKeyModalOverlay.classList.toggle('visible', show);
      if (show) {
          this.apiKeyInput.focus();
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
      this.showApiKeyModal(false);
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
    private getTaskFromPath(indices: Indices): { parent: 任务[], task: 任务, taskIndex: number } | null {
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

    private handleToggleComplete(indices: Indices, isChecked: boolean): void {
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
            
            this.updateActiveProjectInHistory(this.state.timeline);
        }
    }

    private handleUpdateTask(indices: Indices, updatedTask: 任务): void {
        const result = this.getTaskFromPath(indices);
        if(result && this.state.timeline) {
            const currentTask = result.parent[result.taskIndex];
            result.parent[result.taskIndex] = { ...currentTask, ...updatedTask };
            this.updateActiveProjectInHistory(this.state.timeline);
        }
    }

    private handleAddTask(indices: TopLevelIndices, parentTaskPath?: number[]): void {
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
        
        this.updateActiveProjectInHistory(this.state.timeline);
    }

    private handleDeleteTask(indices: Indices): void {
        if (!confirm("确定要从此计划中移除此任务吗？")) return;
        const result = this.getTaskFromPath(indices);
        if(result && this.state.timeline) {
            result.parent.splice(result.taskIndex, 1);
            this.updateActiveProjectInHistory(this.state.timeline);
        }
    }
    
    private handleAddComment(indices: Indices, content: string): void {
        if (!content.trim() || !this.state.currentUser) return;
        const result = this.getTaskFromPath(indices);
        if (result && this.state.timeline) {
            const task = result.task;
            if (!task.讨论) {
                task.讨论 = [];
            }
            const newComment: 评论 = {
                发言人Id: this.state.currentUser.id,
                内容: content,
                时间戳: new Date().toISOString(),
            };
            task.讨论.push(newComment);
            this.updateActiveProjectInHistory(this.state.timeline);
        }
    }

    private handleMoveTask(draggedIndices: Indices, dropIndices: Indices, position: 'before' | 'after'): void {
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

        this.updateActiveProjectInHistory(this.state.timeline);
    }

    private updateActiveProjectInHistory(updatedTimeline: 时间轴数据) {
        const projectIndex = this.state.projectsHistory.findIndex(p => p.id === updatedTimeline.id);
        
        const newHistory = [...this.state.projectsHistory];
        if (projectIndex !== -1) {
            newHistory[projectIndex] = updatedTimeline;
        } else {
             newHistory.push(updatedTimeline);
        }
        this.setState({ timeline: updatedTimeline, projectsHistory: newHistory });
    }

  // --- Home Screen Methods ---
    private handleLoadProject(project: 时间轴数据): void {
        if(project) {
            this.setState({ timeline: project, currentView: 'vertical', chatHistory: [], isChatOpen: false });
        }
    }

    private handleDeleteProject(projectToDelete: 时间轴数据): void {
        if (!this.state.currentUser || projectToDelete.ownerId !== this.state.currentUser.id) {
            alert("只有项目所有者才能删除项目。");
            return;
        }

        if (!confirm(`确定要永久废止此征程 “${projectToDelete.项目名称}” 吗？此操作不可撤销。`)) return;
        
        const newHistory = this.state.projectsHistory.filter(p => p.id !== projectToDelete.id);
        this.setState({ projectsHistory: newHistory, timeline: null });
    }

    private async handleQuickAddTask(event: Event): Promise<void> {
        event.preventDefault();

        if (!this.state.apiKey) {
            this.showApiKeyModal(true);
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
        
        const globalProjectIndex = this.state.projectsHistory.indexOf(projectToUpdate);

        this.setState({ isLoading: true, loadingText: "智能分析中，请稍候..." });

        try {
            const responseSchema = this.createTimelineSchema();
            
            let additionalInfo = '';
            if (assignee) additionalInfo += `任务的“负责人”应为“${assignee}”。`;
            if (deadline) additionalInfo += `任务的“截止日期”应为“${deadline}”。`;

            const currentDateContext = this.getCurrentDateContext();

            const prompt = `${currentDateContext} 作为一名智能项目管理助手，请分析以下项目计划JSON。用户想要添加一个新任务，描述如下：“${taskDescription}”。
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
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json", responseSchema },
            });

            const parsedData = JSON.parse(response.text);
            const updatedTimeline = this.postProcessTimelineData({ ...projectToUpdate, ...parsedData });

            const newHistory = [...this.state.projectsHistory];
            newHistory[globalProjectIndex] = updatedTimeline;

            this.setState({
                timeline: this.state.timeline?.id === updatedTimeline.id ? updatedTimeline : this.state.timeline,
                projectsHistory: newHistory,
            });
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
  
    private handleUpdateField(indices: TopLevelIndices, field: string, value: string): void {
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
        this.updateActiveProjectInHistory(this.state.timeline);
    }
  
    private createEditableElement(
        tag: 'h2' | 'h3' | 'h4', text: string,
        indices: TopLevelIndices, field: '项目名称' | '阶段名称'
    ): HTMLElement {
        const el = document.createElement(tag);
        el.textContent = text;

        if (!this.canEditProject()) {
            return el;
        }

        el.className = 'editable';
        if (tag === 'h2' && field === '项目名称' && indices.phaseIndex === undefined) {
            el.id = 'project-name';
        }

        el.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = text;
            input.className = 'inline-edit';
            el.replaceWith(input);
            input.focus();
            
            const save = () => {
                this.handleUpdateField(indices, field, input.value);
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') input.blur();
                if (e.key === 'Escape') {
                    input.removeEventListener('blur', save);
                    input.blur();
                    this.render();
                }
            });
        });
        return el;
    }

    private showEditModal(indices: Indices, task: 任务): void {
        let existingModal = document.getElementById('edit-modal-overlay');
        if (existingModal) existingModal.remove();

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'edit-modal-overlay';
        modalOverlay.className = 'modal-overlay';
        
        const formatToDateTimeLocalValue = (d?: string): string => {
            if (!d) return '';
            const value = d.includes(' ') ? d.replace(' ', 'T') : `${d}T00:00`;
            return value.slice(0, 16);
        };
        
        const flatTasks = Array.from(this.flattenTasks()).map(i => i.task);
        const dependencyOptions = flatTasks
            .filter(t => t.id !== task.id)
            .map(t => `<option value="${t.id}" ${task.dependencies?.includes(t.id) ? 'selected' : ''}>${t.任务名称}</option>`)
            .join('');

        const projectMembers = this.state.timeline?.members.map(m => this.state.allUsers.find(u => u.id === m.userId)).filter(Boolean) as User[];
        const assigneeOptions = projectMembers.map(user => 
            `<option value="${user.id}" ${task.负责人Ids?.includes(user.id) ? 'selected' : ''}>${user.profile.displayName}</option>`
        ).join('');

        modalOverlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>编辑任务</h2>
                    <button class="modal-close-btn">&times;</button>
                </div>
                <form class="modal-form">
                    <div class="form-group full-width">
                        <label for="taskName">任务名称</label>
                        <input type="text" id="taskName" value="${task.任务名称}" required>
                    </div>
                    <div class="form-group full-width">
                        <label for="details">详情</label>
                        <textarea id="details">${task.详情 || ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label for="status">状态</label>
                        <select id="status">
                            <option value="待办" ${task.状态 === '待办' ? 'selected' : ''}>待办</option>
                            <option value="进行中" ${task.状态 === '进行中' ? 'selected' : ''}>进行中</option>
                            <option value="已完成" ${task.状态 === '已完成' ? 'selected' : ''}>已完成</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="priority">优先级</label>
                        <select id="priority">
                            <option value="高" ${task.优先级 === '高' ? 'selected' : ''}>高</option>
                            <option value="中" ${!task.优先级 || task.优先级 === '中' ? 'selected' : ''}>中</option>
                            <option value="低" ${task.优先级 === '低' ? 'selected' : ''}>低</option>
                        </select>
                    </div>
                    <div class="form-group full-width">
                        <label for="assignee">负责人 (可多选)</label>
                        <select id="assignee" multiple>${assigneeOptions}</select>
                    </div>
                    <div class="form-group">
                        <label for="startTime">开始时间</label>
                        <input type="datetime-local" id="startTime" value="${formatToDateTimeLocalValue(task.开始时间)}">
                    </div>
                    <div class="form-group">
                        <label for="deadline">截止日期</label>
                        <input type="datetime-local" id="deadline" value="${formatToDateTimeLocalValue(task.截止日期)}">
                    </div>
                     <div class="form-group full-width">
                        <label for="dependencies">依赖于 (可多选)</label>
                        <select id="dependencies" multiple>${dependencyOptions}</select>
                    </div>
                    <div class="form-group full-width">
                        <label for="notes">备注</label>
                        <textarea id="notes">${task.备注 || ''}</textarea>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="secondary-btn cancel-btn">取消</button>
                        <button type="submit" class="primary-btn">保存</button>
                    </div>
                </form>
            </div>
        `;
        document.body.appendChild(modalOverlay);

        const form = modalOverlay.querySelector('form')!;
        if (!this.canEditProject()) {
            form.querySelectorAll('input, textarea, select, button').forEach(el => (el as any).disabled = true);
            form.querySelector<HTMLButtonElement>('.cancel-btn')!.disabled = false;
        }

        const close = () => modalOverlay.remove();
        
        const formatFromDateTimeLocalValue = (val: string): string => val ? val.replace('T', ' ') : '';

        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) close();
        });
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const dependenciesSelect = form.querySelector('#dependencies') as HTMLSelectElement;
            const assigneeSelect = form.querySelector('#assignee') as HTMLSelectElement;

            const selectedDependencies = Array.from(dependenciesSelect.selectedOptions).map(option => option.value);
            const selectedAssignees = Array.from(assigneeSelect.selectedOptions).map(option => option.value);

            const updatedTask: 任务 = {
                ...task,
                任务名称: (form.querySelector('#taskName') as HTMLInputElement).value,
                详情: (form.querySelector('#details') as HTMLTextAreaElement).value,
                状态: (form.querySelector('#status') as HTMLSelectElement).value as '待办' | '进行中' | '已完成',
                优先级: (form.querySelector('#priority') as HTMLSelectElement).value as '高' | '中' | '低',
                负责人Ids: selectedAssignees,
                开始时间: formatFromDateTimeLocalValue((form.querySelector('#startTime') as HTMLInputElement).value),
                截止日期: formatFromDateTimeLocalValue((form.querySelector('#deadline') as HTMLInputElement).value),
                备注: (form.querySelector('#notes') as HTMLTextAreaElement).value,
                dependencies: selectedDependencies,
            };
            updatedTask.已完成 = updatedTask.状态 === '已完成';
            this.handleUpdateTask(indices, updatedTask);
            close();
        });

        modalOverlay.querySelector('.modal-close-btn')!.addEventListener('click', close);
        modalOverlay.querySelector('.cancel-btn')!.addEventListener('click', close);

        setTimeout(() => modalOverlay.classList.add('visible'), 10);
    }
  
    private showMembersModal(): void {
        if (!this.state.timeline || !this.state.currentUser) return;
        const userRole = this.getUserRole();
        const canManage = userRole === 'Admin';

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'members-modal-overlay';
        modalOverlay.className = 'modal-overlay';

        const renderMembersList = () => {
            const owner = this.state.allUsers.find(u => u.id === this.state.timeline!.ownerId);
            return this.state.timeline!.members.map(member => {
                const user = this.state.allUsers.find(u => u.id === member.userId);
                if (!user) return '';
                const isOwner = user.id === owner?.id;
                
                const roleSelector = canManage && !isOwner
                    ? `<select class="role-selector" data-user-id="${user.id}">
                        <option value="Admin" ${member.role === 'Admin' ? 'selected' : ''}>Admin</option>
                        <option value="Editor" ${member.role === 'Editor' ? 'selected' : ''}>Editor</option>
                        <option value="Viewer" ${member.role === 'Viewer' ? 'selected' : ''}>Viewer</option>
                      </select>`
                    : `<span>${isOwner ? '所有者' : member.role}</span>`;

                return `
                    <div class="member-item">
                        <div class="member-info">
                           ${this.renderUserAvatar(user.id)}
                           <span>${user.profile.displayName}</span>
                        </div>
                        <div class="member-actions">
                          ${roleSelector}
                          ${canManage && !isOwner ? `
                              <button class="icon-btn remove-member-btn" data-user-id="${user.id}" title="移除成员">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                              </button>
                          ` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        };

        const nonMemberOptions = () => {
            return this.state.allUsers
                .filter(u => !this.state.timeline!.members.some(m => m.userId === u.id))
                .map(u => `<option value="${u.id}">${u.profile.displayName}</option>`)
                .join('');
        };
        
        const inviteLink = `${window.location.origin}${window.location.pathname}?projectId=${this.state.timeline.id}`;

        modalOverlay.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>项目协作</h2>
                    <button class="modal-close-btn">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="members-list">
                        ${renderMembersList()}
                    </div>
                    ${canManage ? `
                    <div class="invite-section">
                      <form class="add-member-form">
                          <h5>邀请成员</h5>
                          <div class="form-group-inline">
                              <select id="add-user-select" required>${nonMemberOptions()}</select>
                              <select id="add-user-role">
                                  <option value="Editor">Editor</option>
                                  <option value="Viewer">Viewer</option>
                                  <option value="Admin">Admin</option>
                              </select>
                              <button type="submit" class="primary-btn">添加</button>
                          </div>
                      </form>
                      <div class="share-link-section">
                          <h5>或分享链接邀请</h5>
                          <div class="form-group-inline">
                            <input type="text" readonly value="${inviteLink}">
                            <button id="copy-link-btn" class="secondary-btn">复制</button>
                          </div>
                      </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        `;

        document.body.appendChild(modalOverlay);
        
        const close = () => modalOverlay.remove();
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) close();
        });
        modalOverlay.querySelector('.modal-close-btn')!.addEventListener('click', close);
        
        if (canManage) {
            modalOverlay.querySelectorAll('.remove-member-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const userId = (e.currentTarget as HTMLElement).dataset.userId;
                    if (userId && this.state.timeline) {
                        this.state.timeline.members = this.state.timeline.members.filter(m => m.userId !== userId);
                        this.updateActiveProjectInHistory(this.state.timeline);
                        close();
                        this.showMembersModal();
                    }
                });
            });

            modalOverlay.querySelectorAll('.role-selector').forEach(select => {
                select.addEventListener('change', (e) => {
                    const target = e.currentTarget as HTMLSelectElement;
                    const userId = target.dataset.userId;
                    const newRole = target.value as ProjectMemberRole;
                    if(userId && this.state.timeline) {
                        const member = this.state.timeline.members.find(m => m.userId === userId);
                        if (member) {
                            member.role = newRole;
                            this.updateActiveProjectInHistory(this.state.timeline);
                        }
                    }
                });
            });

            const addForm = modalOverlay.querySelector('.add-member-form');
            if (addForm) {
                addForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    const userId = (modalOverlay.querySelector('#add-user-select') as HTMLSelectElement).value;
                    const role = (modalOverlay.querySelector('#add-user-role') as HTMLSelectElement).value as ProjectMemberRole;
                    if (userId && role && this.state.timeline) {
                         this.state.timeline.members.push({ userId, role });
                        this.updateActiveProjectInHistory(this.state.timeline);
                        close();
                        this.showMembersModal();
                    }
                });
            }
            
            modalOverlay.querySelector('#copy-link-btn')?.addEventListener('click', (e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                navigator.clipboard.writeText(inviteLink).then(() => {
                    btn.textContent = '已复制!';
                    setTimeout(() => { btn.textContent = '复制'; }, 2000);
                });
            });
        }
        
        setTimeout(() => modalOverlay.classList.add('visible'), 10);
    }

    // --- Report Methods ---
    private async handleGenerateReportClick(period: 'weekly' | 'monthly'): Promise<void> {
        if (!this.state.apiKey) {
            this.showApiKeyModal(true);
            alert("请先提供您的 API 密钥。");
            return;
        }
        this.showReportModal(true); // Show loading state

        try {
            const currentDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD format
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
                model: "gemini-2.5-flash",
                contents: prompt,
            });

            this.showReportModal(false, response.text); // Show result
        } catch (error) {
            console.error("生成报告时出错:", error);
            this.showReportModal(false, "抱歉，生成报告时发生错误。这可能是由于 API 密钥无效或网络问题导致，请稍后重试。"); // Show error
        }
    }

    private showReportModal(isLoading: boolean, reportText: string = ''): void {
        document.getElementById('report-modal-overlay')?.remove();

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'report-modal-overlay';
        modalOverlay.className = 'modal-overlay';
        
        const safeReportText = reportText.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const contentHTML = isLoading
            ? `<div class="modal-body loading-state"><div class="spinner"></div><p>报告生成中，请稍候...</p></div>`
            : `<div class="modal-body"><pre class="report-content">${safeReportText}</pre></div>
               <div class="modal-footer">
                   <button type="button" class="secondary-btn copy-btn">复制内容</button>
                   <button type="button" class="primary-btn close-btn">关闭</button>
               </div>`;

        modalOverlay.innerHTML = `
            <div class="modal-content report-modal">
                <div class="modal-header">
                    <h2>项目状态报告</h2>
                    <button class="modal-close-btn close-btn">&times;</button>
                </div>
                ${contentHTML}
            </div>
        `;
        document.body.appendChild(modalOverlay);

        const close = () => modalOverlay.remove();
        modalOverlay.querySelectorAll('.close-btn').forEach(btn => btn.addEventListener('click', close));
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) close();
        });

        if (!isLoading) {
            const copyBtn = modalOverlay.querySelector('.copy-btn') as HTMLButtonElement;
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(reportText).then(() => {
                    copyBtn.textContent = '已复制!';
                    setTimeout(() => { copyBtn.textContent = '复制内容'; }, 2000);
                });
            });
        }

        setTimeout(() => modalOverlay.classList.add('visible'), 10);
    }


    // --- Chat Methods ---
    private toggleChat(open: boolean): void {
        this.setState({ isChatOpen: open }, false); // Don't re-render the whole app
        this.chatPanelEl.classList.toggle('open', open);
        this.chatBackdropEl.classList.toggle('hidden', !open);
        if (open) {
            this.chatInputEl.focus();
        }
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
    
    private async handleRegenerateClick(): Promise<void> {
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
            this.showApiKeyModal(true);
            alert("请先提供您的 API 密钥。");
            return;
        }
        if (this.state.isChatLoading) return;

        const newHistory: ChatMessage[] = [...this.state.chatHistory, { role: 'user', text: userInput }];
        this.setState({
            isChatLoading: true,
            lastUserChatPrompt: userInput,
            chatHistory: newHistory,
        });

        try {
            const isQuestion = /^(谁|什么|哪里|何时|为何|如何|是|做|能)\b/i.test(userInput) ||
                               userInput.endsWith('？') || userInput.endsWith('?');

            if (isQuestion) {
                const response = await this.ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: `请根据您的知识和网络搜索结果，用中文回答以下问题。如果问题与提供的项目计划有关，请结合上下文回答。
---
当前项目计划 (上下文参考):
${JSON.stringify(this.state.timeline)}
---
用户问题: "${userInput}"`,
                    config: { tools: [{ googleSearch: {} }] },
                });
                
                const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
                const sources = groundingChunks?.map((chunk: any) => ({
                    uri: chunk.web.uri,
                    title: chunk.web.title,
                })) || [];

                const finalHistory: ChatMessage[] = [...this.state.chatHistory, { role: 'model', text: response.text, sources }];
                this.setState({ chatHistory: finalHistory });

            } else {
                if (!this.canEditProject()) {
                    const errorHistory: ChatMessage[] = [...this.state.chatHistory, { role: 'model', text: "抱歉，您没有修改此项目的权限。" }];
                    this.setState({ chatHistory: errorHistory });
                    return;
                }
                const timelineSchema = this.createTimelineSchema();
                const responseSchema = {
                    type: Type.OBJECT,
                    properties: {
                        responseText: { type: Type.STRING, description: "用中文对用户的请求进行友好、确认性的回应。如果无法执行操作，请解释原因。" },
                        updatedTimeline: timelineSchema,
                    },
                    required: ["responseText", "updatedTimeline"],
                };

                const currentDateContext = this.getCurrentDateContext();

                const response = await this.ai.models.generateContent({
                    model: "gemini-2.5-flash",
                    contents: `${currentDateContext} 作为一名高级项目管理AI助手，请根据用户的自然语言请求，智能地修改提供的项目计划JSON。
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

                const finalHistory: ChatMessage[] = [...this.state.chatHistory, { role: 'model', text: result.responseText }];
                
                this.updateActiveProjectInHistory(updatedTimeline);
                this.setState({ chatHistory: finalHistory });
            }

        } catch (error) {
            console.error("智能助理出错:", error);
            const errorHistory: ChatMessage[] = [...this.state.chatHistory, { role: 'model', text: "抱歉，理解您的指令时遇到了些问题，请您换一种方式描述，或者稍后再试。这可能是由于 API 密钥无效或网络问题导致。" }];
            this.setState({ chatHistory: errorHistory });
        } finally {
            this.setState({ isChatLoading: false });
        }
    }


    // --- RENDER ---
    private renderAuth(): void {
        this.authSection.classList.remove('hidden');
        this.inputSection.classList.add('hidden');
        this.timelineSection.classList.add('hidden');
        
        if (this.state.authView === 'login') {
            this.loginForm.classList.remove('hidden');
            this.registerForm.classList.add('hidden');
        } else {
            this.loginForm.classList.add('hidden');
            this.registerForm.classList.remove('hidden');
        }
    }
    
    private renderUserDisplay(): void {
        if (this.state.currentUser) {
            this.userDisplayEl.innerHTML = `
                <div class="user-info">
                  ${this.renderUserAvatar(this.state.currentUser.id)}
                  <span>欢迎, <strong>${this.state.currentUser.profile.displayName}</strong></span>
                </div>
                <div class="user-actions">
                  <button id="api-key-change-btn" class="secondary-btn">API 密钥</button>
                  <button id="logout-btn" class="secondary-btn">登出</button>
                </div>
            `;
            this.userDisplayEl.querySelector('#api-key-change-btn')!.addEventListener('click', () => {
                this.apiKeyInput.value = this.state.apiKey || '';
                this.showApiKeyModal(true);
            });
            this.userDisplayEl.querySelector('#logout-btn')!.addEventListener('click', () => {
                this.setState({ currentUser: null, timeline: null });
            });
        } else {
            this.userDisplayEl.innerHTML = '';
        }
    }
  private render(): void {
    this.loadingOverlay.classList.toggle("hidden", !this.state.isLoading);
    this.loadingTextEl.textContent = this.state.loadingText;
    
    if (!this.state.currentUser) {
        this.renderAuth();
        return;
    }

    // --- Logged-in view ---
    this.authSection.classList.add('hidden');
    this.generateBtn.disabled = this.state.isLoading;
    if (this.generateBtn.querySelector('span')) {
        this.generateBtn.querySelector('span')!.textContent = this.state.isLoading ? "生成中..." : "开始生成";
    }
    this.chatSendBtn.disabled = this.state.isChatLoading;
    
    this.renderUserDisplay();

    if (this.state.timeline) {
      this.inputSection.classList.add("hidden");
      this.timelineSection.classList.remove("hidden");
      setTimeout(() => this.timelineSection.classList.add('visible'), 10);
      
      const userRole = this.getUserRole();
      const readOnly = userRole === 'Viewer';
      
      let projectNameHTML = this.state.timeline.项目名称;
      if (readOnly) {
        projectNameHTML += ` <span class="readonly-badge">只读模式</span>`;
      }
      this.projectNameEl.innerHTML = projectNameHTML;
      
      this.shareBtn.style.display = userRole === 'Viewer' ? 'none' : 'inline-flex';
      
      this.renderViewSwitcher();
      this.renderViewSpecificControls();
      this.renderFilterSortControls();
      this.renderChat();
      
      if (this.state.currentView !== 'dependencies') {
          this.timelineContainer.innerHTML = "";
          this.timelineContainer.className = `${this.state.currentView}-view`;
      }
      
      switch(this.state.currentView) {
        case 'vertical': this.renderVerticalTimeline(this.state.timeline.阶段); break;
        case 'gantt': this.renderGanttChart(); break;
        case 'kanban': this.renderKanban(); break;
        case 'calendar': this.renderCalendar(); break;
        case 'workload': this.renderWorkloadView(); break;
        case 'dependencies': this.renderDependencyMap(); break;
        case 'mindmap': this.renderMindMap(); break;
      }

    } else {
      this.inputSection.classList.remove("hidden");
      this.timelineSection.classList.add("hidden");
      this.timelineSection.classList.remove('visible');
      this.renderHomeScreen();
    }
  }

    private getUserProjects(): 时间轴数据[] {
        if (!this.state.currentUser) return [];
        return this.state.projectsHistory.filter(p => 
            p.members.some(m => m.userId === this.state.currentUser!.id)
        );
    }

    private renderHomeScreen(): void {
        this.projectInput.value = "";
        const userProjects = this.getUserProjects();
        const hasHistory = userProjects.length > 0;

        this.historySectionEl.classList.toggle('hidden', !hasHistory);
        this.quickAddFormEl.classList.toggle('hidden', !hasHistory);

        if (hasHistory) {
            this.historyListEl.innerHTML = '';
            const projectSelect = this.quickAddFormEl.querySelector('#project-select') as HTMLSelectElement;
            projectSelect.innerHTML = '';

            userProjects.forEach((project) => {
                const isOwner = project.ownerId === this.state.currentUser?.id;
                const member = project.members.find(m => m.userId === this.state.currentUser?.id);
                const role = isOwner ? '所有者' : member?.role;

                const itemEl = document.createElement('div');
                itemEl.className = 'history-item';
                itemEl.innerHTML = `
                    <div class="history-item-info">
                      <span class="history-item-name">${project.项目名称}</span>
                      <span class="role-badge">${role}</span>
                    </div>
                    <div class="history-item-actions">
                        <button class="secondary-btn load-btn">载入</button>
                        ${isOwner ? `<button class="icon-btn delete-btn" title="删除项目">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>` : ''}
                    </div>
                `;
                itemEl.querySelector('.load-btn')!.addEventListener('click', () => this.handleLoadProject(project));
                if (isOwner) {
                    itemEl.querySelector('.delete-btn')!.addEventListener('click', () => this.handleDeleteProject(project));
                }
                this.historyListEl.appendChild(itemEl);

                // Populate select dropdown
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.项目名称;
                projectSelect.appendChild(option);
            });
        }
    }

    private renderChat(): void {
        this.chatHistoryEl.innerHTML = '';
        this.state.chatHistory.forEach(msg => {
            const msgEl = document.createElement('div');
            msgEl.className = `chat-message-container`;

            const messageCore = document.createElement('div');
            messageCore.className = `chat-message ${msg.role}-message`;
            messageCore.innerHTML = `
                ${msg.role === 'model' ? 
                  `<div class="avatar" style="background-color: var(--accent-color-light); color: var(--text-primary);">助</div>` :
                  this.renderUserAvatar(this.state.currentUser!.id)
                }
                <div class="message-content"><p>${msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p></div>
            `;

            msgEl.appendChild(messageCore);

            if (msg.role === 'model') {
                 if (msg.sources && msg.sources.length > 0) {
                    const sourcesEl = document.createElement('div');
                    sourcesEl.className = 'chat-message-sources';
                    let sourcesHTML = '<h5>参考来源:</h5><ul>';
                    msg.sources.forEach(source => {
                        sourcesHTML += `<li><a href="${source.uri}" target="_blank" rel="noopener noreferrer">${source.title || source.uri}</a></li>`;
                    });
                    sourcesHTML += '</ul>';
                    sourcesEl.innerHTML = sourcesHTML;
                    msgEl.appendChild(sourcesEl);
                }

                const actions = document.createElement('div');
                actions.className = 'chat-message-actions';
                
                const copyBtn = document.createElement('button');
                copyBtn.className = 'icon-btn';
                copyBtn.title = '复制';
                copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                copyBtn.onclick = () => {
                    navigator.clipboard.writeText(msg.text);
                    copyBtn.innerHTML = `✓`;
                    setTimeout(() => { copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`; }, 1500);
                };
                
                const regenBtn = document.createElement('button');
                regenBtn.className = 'icon-btn';
                regenBtn.title = '重新生成';
                regenBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><polyline points="23 20 23 14 17 14"></polyline><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path></svg>`;
                regenBtn.onclick = () => this.handleRegenerateClick();

                actions.appendChild(copyBtn);
                actions.appendChild(regenBtn);
                msgEl.appendChild(actions);
            }
            this.chatHistoryEl.appendChild(msgEl);
        });

        if (this.state.isChatLoading) {
            const thinkingEl = document.createElement('div');
            thinkingEl.className = 'chat-message model-message thinking';
            thinkingEl.innerHTML = `
                <div class="avatar" style="background-color: var(--accent-color-light); color: var(--text-primary);">助</div>
                <div class="message-content">
                    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                </div>
            `;
            this.chatHistoryEl.appendChild(thinkingEl);
        }

        this.chatHistoryEl.scrollTop = this.chatHistoryEl.scrollHeight;
    }
  
  private renderViewSwitcher(): void {
    this.viewSwitcherEl.innerHTML = '';
    const views: { id: ViewType, name: string }[] = [
      { id: 'vertical', name: '纵览' },
      { id: 'gantt', name: '甘特图' },
      { id: 'kanban', name: '看板' },
      { id: 'calendar', name: '行事历' },
      { id: 'workload', name: '工作负载' },
      { id: 'dependencies', name: '依赖图' },
      { id: 'mindmap', name: '思维导图' },
    ];
    views.forEach(view => {
      const btn = document.createElement('button');
      btn.textContent = view.name;
      btn.className = this.state.currentView === view.id ? 'active' : '';
      btn.onclick = () => this.setState({ currentView: view.id });
      this.viewSwitcherEl.appendChild(btn);
    });
  }

  private renderViewSpecificControls(): void {
    if (!this.viewSpecificControlsEl) return;
    this.viewSpecificControlsEl.innerHTML = '';

    if (this.state.currentView === 'gantt') {
        this.viewSpecificControlsEl.classList.add('gantt-view-controls');
        const granularities: { id: GanttGranularity, name: string }[] = [
            { id: 'days', name: '日' },
            { id: 'weeks', name: '周' },
            { id: 'months', name: '月' },
        ];
        granularities.forEach(gran => {
            const btn = document.createElement('button');
            btn.textContent = gran.name;
            btn.className = this.state.ganttGranularity === gran.id ? 'active' : '';
            btn.onclick = () => this.setState({ ganttGranularity: gran.id });
            this.viewSpecificControlsEl!.appendChild(btn);
        });
    } else {
        this.viewSpecificControlsEl.classList.remove('gantt-view-controls');
    }
  }

  private renderFilterSortControls(): void {
    this.filterSortControlsEl.innerHTML = ''; // Clear previous controls

    const allAssignees = [...new Set(this.state.timeline?.members.map(m => m.userId) || [])];
    
    this.filterSortControlsEl.appendChild(this.createMultiSelectDropdown('status', '状态', ['待办', '进行中', '已完成'], this.state.filters.status));
    this.filterSortControlsEl.appendChild(this.createMultiSelectDropdown('priority', '优先级', ['高', '中', '低'], this.state.filters.priority));
    this.filterSortControlsEl.appendChild(this.createMultiSelectDropdown('assignee', '负责人', allAssignees, this.state.filters.assignee));

    const sortGroup = document.createElement('div');
    sortGroup.className = 'sort-group';
    sortGroup.innerHTML = `
        <label for="sort-by">排序:</label>
        <select id="sort-by">
            <option value="default">默认</option>
            <option value="deadline">截止日期</option>
            <option value="priority">优先级</option>
            <option value="name">任务名称</option>
        </select>
    `;
    const sortSelect = sortGroup.querySelector('#sort-by') as HTMLSelectElement;
    sortSelect.value = this.state.sortBy;
    sortSelect.addEventListener('change', (e) => this.setState({ sortBy: (e.target as HTMLSelectElement).value as any }));
    this.filterSortControlsEl.appendChild(sortGroup);
  }
  
  private createMultiSelectDropdown(id: 'status' | 'priority' | 'assignee', labelText: string, options: string[], selectedOptions: string[]): HTMLElement {
    const container = document.createElement('div');
    container.className = 'filter-group multi-select-filter';

    const button = document.createElement('button');
    button.className = 'multi-select-button';
    const updateButtonText = () => {
        button.innerHTML = `${labelText} ${selectedOptions.length > 0 ? `<span>${selectedOptions.length}</span>` : ''}`;
        button.classList.toggle('active', selectedOptions.length > 0);
    };
    
    const dropdown = document.createElement('div');
    dropdown.className = 'multi-select-dropdown hidden';
    
    options.forEach(optionValue => {
        const optionEl = document.createElement('label');
        optionEl.className = 'multi-select-option';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = optionValue;
        checkbox.checked = selectedOptions.includes(optionValue);

        checkbox.addEventListener('change', () => {
            const newSelection = checkbox.checked 
                ? [...selectedOptions, optionValue]
                : selectedOptions.filter(item => item !== optionValue);
            this.setState({ filters: { ...this.state.filters, [id]: newSelection } });
        });
        
        let optionLabel = optionValue;
        if (id === 'assignee') {
            const user = this.state.allUsers.find(u => u.id === optionValue);
            optionLabel = user ? user.profile.displayName : '未知用户';
        }

        optionEl.appendChild(checkbox);
        optionEl.append(document.createTextNode(optionLabel));
        dropdown.appendChild(optionEl);
    });
    
    if(options.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.textContent = '清空';
      clearBtn.className = 'multi-select-clear';
      clearBtn.onclick = (e) => {
          e.preventDefault();
          this.setState({ filters: { ...this.state.filters, [id]: [] } });
      };
      dropdown.appendChild(clearBtn);
    } else {
        dropdown.innerHTML = `<div class="multi-select-empty">无可用选项</div>`;
    }

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.multi-select-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.add('hidden');
        });
        dropdown.classList.toggle('hidden');
    });

    updateButtonText();
    container.appendChild(button);
    container.appendChild(dropdown);

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target as Node)) {
            dropdown.classList.add('hidden');
        }
    });

    return container;
  }

  // --- VERTICAL TIMELINE ---
  private renderVerticalTimeline(phases: 阶段[]): void {
    const canEdit = this.canEditProject();
    phases.forEach((phase, phaseIndex) => {
      const phaseEl = document.createElement("div");
      phaseEl.className = "phase";
      
      const phaseHeader = document.createElement('div');
      phaseHeader.className = 'phase-header';
      phaseHeader.innerHTML = `<div class="phase-icon">${phaseIndex + 1}</div>`;
      phaseHeader.appendChild(this.createEditableElement('h3', phase.阶段名称, { phaseIndex }, '阶段名称'));
      phaseEl.appendChild(phaseHeader);

      if (phase.项目) {
          phase.项目.forEach((project, projectIndex) => {
              const projectEl = document.createElement('div');
              projectEl.className = 'nested-project';
              projectEl.appendChild(this.createEditableElement('h4', project.项目名称, { phaseIndex, projectIndex }, '项目名称'));
              if(project.备注) {
                const notesEl = document.createElement('p');
                notesEl.className = 'nested-project-notes';
                notesEl.textContent = project.备注;
                projectEl.appendChild(notesEl);
              }
              projectEl.appendChild(this.createTasksList(project.任务, { phaseIndex, projectIndex }, [], canEdit));
              phaseEl.appendChild(projectEl);
          });
      }

      if (phase.任务) {
          phaseEl.appendChild(this.createTasksList(phase.任务, { phaseIndex }, [], canEdit));
      }

      this.timelineContainer.appendChild(phaseEl);
    });
  }

    private triggerCompletionAnimation(taskElement: HTMLElement): void {
        const confettiContainer = document.createElement('div');
        confettiContainer.className = 'confetti-container';
        
        taskElement.style.position = 'relative'; 
        taskElement.appendChild(confettiContainer);

        const colors = ['#C84B31', '#D4B483', '#5A8B43', '#3B82F6', '#707070'];
        for (let i = 0; i < 30; i++) {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            
            const angle = Math.random() * 2 * Math.PI;
            const distance = Math.random() * 40 + 20;
            
            confetti.style.setProperty('--x-end', `${Math.cos(angle) * distance}px`);
            confetti.style.setProperty('--y-end', `${Math.sin(angle) * distance}px`);
            confetti.style.setProperty('--rotation-start', `${Math.random() * 360}deg`);
            confetti.style.setProperty('--rotation-end', `${Math.random() * 360 + Math.random() * 720}deg`);

            confettiContainer.appendChild(confetti);
        }

        setTimeout(() => {
            confettiContainer.remove();
            taskElement.style.position = ''; 
        }, 1000); // Animation duration should match CSS
    }

    private createTasksList(tasks: 任务[], baseIndices: TopLevelIndices, parentPath: number[], canEdit: boolean): HTMLElement {
        const listContainer = document.createElement('div');
        const tasksList = document.createElement("ul");
        tasksList.className = "tasks-list";

        const processedTasks = this.processTaskArray(tasks);

        processedTasks.forEach((task, taskIndex) => {
            const currentPath = [...parentPath, task.originalIndex!]; // Use original index for correct path
            const fullIndices: Indices = { ...baseIndices, phaseIndex: baseIndices.phaseIndex!, taskPath: currentPath };

            const taskEl = document.createElement("li");
            taskEl.className = "task-item";
            if (task.优先级) taskEl.dataset.priority = task.优先级;
            taskEl.classList.toggle("completed", task.已完成);
            taskEl.draggable = canEdit;

            if (canEdit) {
                taskEl.addEventListener('dragstart', (e) => {
                    e.stopPropagation();
                    taskEl.classList.add('dragging');
                    e.dataTransfer!.setData('application/json', JSON.stringify(fullIndices));
                    e.dataTransfer!.effectAllowed = 'move';
                });

                taskEl.addEventListener('dragend', (e) => {
                    e.stopPropagation();
                    taskEl.classList.remove('dragging');
                    document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
                        el.classList.remove('drag-over-top', 'drag-over-bottom');
                    });
                });

                taskEl.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (taskEl.classList.contains('dragging')) return;
                    
                    const rect = taskEl.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    if (e.clientY < midpoint) {
                        taskEl.classList.add('drag-over-top');
                        taskEl.classList.remove('drag-over-bottom');
                    } else {
                        taskEl.classList.add('drag-over-bottom');
                        taskEl.classList.remove('drag-over-top');
                    }
                });

                taskEl.addEventListener('dragleave', (e) => {
                    e.stopPropagation();
                    taskEl.classList.remove('drag-over-top', 'drag-over-bottom');
                });

                taskEl.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const position = taskEl.classList.contains('drag-over-top') ? 'before' : 'after';
                    taskEl.classList.remove('drag-over-top', 'drag-over-bottom');

                    try {
                        const draggedIndices: Indices = JSON.parse(e.dataTransfer!.getData('application/json'));
                        const dropIndices: Indices = fullIndices;
                        this.handleMoveTask(draggedIndices, dropIndices, position);
                    } catch (err) {
                        console.error("Drop failed:", err);
                    }
                });
            }


            const taskHeader = document.createElement('div');
            taskHeader.className = 'task-header';

            const taskMain = document.createElement('div');
            taskMain.className = 'task-main';
            
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = task.已完成;
            checkbox.disabled = !canEdit;
            checkbox.addEventListener('change', (e) => {
                const isChecked = (e.target as HTMLInputElement).checked;
                this.handleToggleComplete(fullIndices, isChecked);
                if (isChecked) {
                    this.triggerCompletionAnimation(taskEl);
                }
            });
            taskMain.appendChild(checkbox);

            const label = document.createElement('label');
            label.textContent = task.任务名称;
            taskMain.appendChild(label);
            
            taskHeader.appendChild(taskMain);
            
            const taskActions = document.createElement('div');
            taskActions.className = 'task-actions';
            
            const statusMap: {[key: string]: string} = { '待办': 'todo', '进行中': 'inprogress', '已完成': 'completed'};
            const statusClass = statusMap[task.状态] || 'todo';
            taskActions.innerHTML = `<span class="status-tag status-${statusClass}">${task.状态}</span>`;

            if (canEdit) {
                const addSubtaskBtn = document.createElement('button');
                addSubtaskBtn.className = 'icon-btn';
                addSubtaskBtn.title = '添加子任务';
                addSubtaskBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                addSubtaskBtn.onclick = () => this.handleAddTask(baseIndices, currentPath);
                taskActions.appendChild(addSubtaskBtn);
            }

            const editBtn = document.createElement('button');
            editBtn.className = 'icon-btn';
            editBtn.title = '编辑任务';
            editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
            editBtn.onclick = () => this.showEditModal(fullIndices, task);
            taskActions.appendChild(editBtn);

            if (canEdit) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'icon-btn delete-btn';
                deleteBtn.title = '删除任务';
                deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
                deleteBtn.onclick = () => this.handleDeleteTask(fullIndices);
                taskActions.appendChild(deleteBtn);
            }
            
            taskHeader.appendChild(taskActions);
            taskEl.appendChild(taskHeader);

            const taskBody = document.createElement('div');
            taskBody.className = 'task-body';
            
            if (task.详情) {
                const detailsEl = document.createElement('p');
                detailsEl.className = 'task-details';
                detailsEl.textContent = task.详情;
                taskBody.appendChild(detailsEl);
            }

            const metaEl = document.createElement('div');
            metaEl.className = 'task-meta';
            if (task.开始时间 || task.截止日期) {
                let dateText = '';
                if (task.开始时间) dateText += `⏱️ ${task.开始时间}`;
                if (task.开始时间 && task.截止日期) dateText += ' → ';
                if (task.截止日期) dateText += `🏁 ${task.截止日期}`;
                const dateSpan = document.createElement('span');
                dateSpan.textContent = dateText;
                metaEl.appendChild(dateSpan);
            }
            if (task.负责人Ids && task.负责人Ids.length > 0) {
                const assigneeSpan = document.createElement('div');
                assigneeSpan.className = 'assignee-avatars';
                task.负责人Ids.forEach(id => assigneeSpan.innerHTML += this.renderUserAvatar(id));
                metaEl.appendChild(assigneeSpan);
            }
            if (metaEl.hasChildNodes()) taskBody.appendChild(metaEl);

            if (task.备注) {
                const notesEl = document.createElement('p');
                notesEl.className = 'task-notes';
                notesEl.textContent = `备注: ${task.备注}`;
                taskBody.appendChild(notesEl);
            }

            if (taskBody.hasChildNodes()) {
                taskEl.appendChild(taskBody);
            }
            
            const discussionContainer = document.createElement('div');
            discussionContainer.className = 'task-discussion';
            
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'task-discussion-toggle';
            const commentCount = task.讨论?.length || 0;
            toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> <span>${commentCount} 条讨论</span>`;

            const discussionArea = document.createElement('div');
            discussionArea.className = 'task-discussion-area hidden';
            
            const commentsList = document.createElement('ul');
            commentsList.className = 'comments-list';
            if (task.讨论) {
                task.讨论.forEach(comment => {
                    const user = this.state.allUsers.find(u => u.id === comment.发言人Id);
                    const commentEl = document.createElement('li');
                    commentEl.className = 'comment-item';
                    const timestamp = new Date(comment.时间戳).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });
                    commentEl.innerHTML = `
                        <div class="comment-header">
                            ${this.renderUserAvatar(comment.发言人Id)}
                            <strong class="comment-author">${user?.profile.displayName || '未知用户'}</strong>
                            <span class="comment-timestamp">${timestamp}</span>
                        </div>
                        <p class="comment-content">${comment.内容}</p>
                    `;
                    commentsList.appendChild(commentEl);
                });
            }
            
            const newCommentForm = document.createElement('form');
            newCommentForm.className = 'new-comment-form';
            newCommentForm.innerHTML = `
                ${this.renderUserAvatar(this.state.currentUser!.id)}
                <textarea placeholder="添加评论..." rows="1" required></textarea>
                <button type="submit" class="primary-btn">发布</button>
            `;
            if (!canEdit) {
                newCommentForm.querySelector('textarea')!.disabled = true;
                newCommentForm.querySelector('button')!.disabled = true;
            }
            newCommentForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const textarea = newCommentForm.querySelector('textarea')!;
                this.handleAddComment(fullIndices, textarea.value);
                textarea.value = '';
            });
            newCommentForm.querySelector('textarea')?.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = this.scrollHeight + 'px';
            });
            
            discussionArea.appendChild(commentsList);
            discussionArea.appendChild(newCommentForm);

            toggleBtn.onclick = () => {
                discussionArea.classList.toggle('hidden');
                toggleBtn.classList.toggle('active');
            };

            discussionContainer.appendChild(toggleBtn);
            discussionContainer.appendChild(discussionArea);
            taskEl.appendChild(discussionContainer);


            if (task.子任务 && task.子任务.length > 0) {
                taskEl.appendChild(this.createTasksList(task.子任务, baseIndices, currentPath, canEdit));
            }

            tasksList.appendChild(taskEl);
        });

        listContainer.appendChild(tasksList);
        if (canEdit) {
            const addBtn = document.createElement('button');
            addBtn.className = 'add-task-btn';
            addBtn.textContent = '+ 添加任务';
            addBtn.onclick = () => this.handleAddTask(baseIndices, parentPath);
            listContainer.appendChild(addBtn);
        }

        return listContainer;
    }

    private getUserRole(): ProjectMemberRole | null {
        if (!this.state.currentUser || !this.state.timeline) return null;
        if (this.state.timeline.ownerId === this.state.currentUser.id) return 'Admin';
        const member = this.state.timeline.members.find(m => m.userId === this.state.currentUser!.id);
        return member ? member.role : null;
    }

    private canEditProject(): boolean {
        const role = this.getUserRole();
        return role === 'Admin' || role === 'Editor';
    }

    private *flattenTasks(): Generator<{ task: 任务; indices: Indices; path: string[] }> {
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

    private getProcessedTasks(): { task: 任务; indices: Indices; path: string[] }[] {
      let tasks = Array.from(this.flattenTasks());
      const { status, priority, assignee } = this.state.filters;
      const { sortBy } = this.state;

      if (status.length > 0) {
        tasks = tasks.filter(t => status.includes(t.task.状态));
      }
      if (priority.length > 0) {
        tasks = tasks.filter(t => t.task.优先级 && priority.includes(t.task.优先级));
      }
      if (assignee.length > 0) {
        tasks = tasks.filter(t => t.task.负责人Ids && assignee.some(a => t.task.负责人Ids!.includes(a)));
      }
      
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
                default:
                    return 0;
            }
        });
      }

      return tasks;
    }

    private processTaskArray(tasks: 任务[]): (任务 & { originalIndex?: number })[] {
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
                
                if (task.子任务) {
                    task.子任务 = filterRecursively(task.子任务 as any);
                }
                
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
                if (task.子任务) {
                    sortRecursively(task.子任务);
                }
            });
        };
        sortRecursively(taskCopy);

        return taskCopy;
    }
    
    private parseDate(dateString: string | undefined): Date | null {
        if (!dateString) return null;
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? null : date;
    }
    
    // --- GANTT CHART VIEW ---
    private renderGanttChart(): void {
        const handleWheel = (e: WheelEvent) => {
            e.preventDefault();
            const newZoom = this.state.ganttZoomLevel - e.deltaY * 0.1;
            this.setState({ ganttZoomLevel: Math.max(10, Math.min(200, newZoom)) });
        };
        this.timelineContainer.onwheel = handleWheel;
    
        const tasksWithDates = this.getProcessedTasks().filter(t => t.task.开始时间);
        if (tasksWithDates.length === 0) {
            this.timelineContainer.innerHTML = `<p>沒有符合篩選條件的任務，或任務未設置開始時間。</p>`;
            return;
        }
    
        const dates = tasksWithDates.flatMap(t => [this.parseDate(t.task.开始时间), this.parseDate(t.task.截止日期)])
                                   .filter((d): d is Date => d !== null);
        if (dates.length === 0) {
            this.timelineContainer.innerHTML = `<p>沒有帶日期的任務可供顯示。</p>`;
            return;
        }
        
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    
        const { ganttGranularity: granularity, ganttZoomLevel } = this.state;
        
        let headerUnits: { label: string, span: number }[] = [];
        let subHeaderUnits: { label: string, isWeekend?: boolean }[] = [];
        let totalUnits = 0;
    
        if (granularity === 'days') {
            minDate.setDate(minDate.getDate() - 2);
            maxDate.setDate(maxDate.getDate() + 2);
            totalUnits = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
            let currentMonth = -1;
            for (let i = 0; i < totalUnits; i++) {
                const day = new Date(minDate);
                day.setDate(minDate.getDate() + i);
                if (day.getMonth() !== currentMonth) {
                    if (headerUnits.length > 0) headerUnits[headerUnits.length-1].span = i - subHeaderUnits.length + headerUnits[headerUnits.length-1].span;
                    headerUnits.push({ label: `${day.getFullYear()}年 ${day.getMonth() + 1}月`, span: 1 });
                    currentMonth = day.getMonth();
                } else if (i === 0) {
                     headerUnits.push({ label: `${day.getFullYear()}年 ${day.getMonth() + 1}月`, span: 0 });
                }
                subHeaderUnits.push({ label: `${day.getDate()}`, isWeekend: day.getDay() === 0 || day.getDay() === 6 });
            }
             headerUnits[headerUnits.length - 1].span = totalUnits - (subHeaderUnits.length - headerUnits[headerUnits.length - 1].span);
        } else if (granularity === 'weeks') {
            minDate.setDate(minDate.getDate() - 7);
            maxDate.setDate(maxDate.getDate() + 7);
            totalUnits = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
            let currentMonth = -1;
            for (let i = 0; i < totalUnits; i++) {
                const weekStart = new Date(minDate);
                weekStart.setDate(minDate.getDate() + i * 7);
                if (weekStart.getMonth() !== currentMonth) {
                    if (headerUnits.length > 0) headerUnits[headerUnits.length-1].span = i - subHeaderUnits.length + headerUnits[headerUnits.length-1].span;
                    headerUnits.push({ label: `${weekStart.getFullYear()}年 ${weekStart.getMonth() + 1}月`, span: 1 });
                    currentMonth = weekStart.getMonth();
                } else if (i === 0) {
                     headerUnits.push({ label: `${weekStart.getFullYear()}年 ${weekStart.getMonth() + 1}月`, span: 0 });
                }
                subHeaderUnits.push({ label: `W${i + 1}` });
            }
             headerUnits[headerUnits.length - 1].span = totalUnits - (subHeaderUnits.length - headerUnits[headerUnits.length - 1].span);
        } else { // months
            minDate.setMonth(minDate.getMonth() - 1);
            maxDate.setMonth(maxDate.getMonth() + 1);
            totalUnits = (maxDate.getFullYear() - minDate.getFullYear()) * 12 + (maxDate.getMonth() - minDate.getMonth());
            let currentYear = -1;
            for (let i = 0; i < totalUnits; i++) {
                const monthDate = new Date(minDate);
                monthDate.setMonth(minDate.getMonth() + i);
                if (monthDate.getFullYear() !== currentYear) {
                     if (headerUnits.length > 0) headerUnits[headerUnits.length-1].span = i - subHeaderUnits.length + headerUnits[headerUnits.length-1].span;
                    headerUnits.push({ label: `${monthDate.getFullYear()}年`, span: 1 });
                    currentYear = monthDate.getFullYear();
                } else if (i === 0) {
                    headerUnits.push({ label: `${monthDate.getFullYear()}年`, span: 0 });
                }
                subHeaderUnits.push({ label: `${monthDate.getMonth() + 1}月` });
            }
             headerUnits[headerUnits.length - 1].span = totalUnits - (subHeaderUnits.length - headerUnits[headerUnits.length - 1].span);
        }
        
        if (totalUnits > 1500) {
            this.timelineContainer.innerHTML = `<p>日期范围过大，请尝试使用更粗的时间粒度（周/月）。</p>`;
            return;
        }
    
        const gridColWidth = `${Math.max(ganttZoomLevel, 10)}px`;
    
        const container = document.createElement('div');
        container.className = 'gantt-container';
        container.style.gridTemplateColumns = `300px minmax(${totalUnits * ganttZoomLevel}px, 1fr)`;
    
        const header = document.createElement('div');
        header.className = 'gantt-header';
        header.innerHTML = `
            <div class="gantt-header-title">任务层级</div>
            <div class="gantt-header-timeline" style="grid-template-columns: repeat(${totalUnits}, ${gridColWidth});">
                <div class="gantt-header-months">${headerUnits.map(u => `<div style="grid-column: span ${u.span}">${u.label}</div>`).join('')}</div>
                <div class="gantt-header-days">${subHeaderUnits.map(u => `<div class="${u.isWeekend ? 'weekend' : ''}">${u.label}</div>`).join('')}</div>
            </div>
        `;
        container.appendChild(header);
    
        const body = document.createElement('div');
        body.className = 'gantt-body';
        const taskListContainer = document.createElement('div');
        taskListContainer.className = 'gantt-body-tasks';
        const barsContainer = document.createElement('div');
        barsContainer.className = 'gantt-body-bars';
        barsContainer.style.gridTemplateColumns = `repeat(${totalUnits}, ${gridColWidth})`;
    
        tasksWithDates.forEach(({ task, indices }) => {
            const level = indices.taskPath.length;
            const titleEl = document.createElement('div');
            titleEl.className = 'gantt-task-title';
            titleEl.textContent = task.任务名称;
            titleEl.style.paddingLeft = `${1 + (level - 1) * 1.5}rem`;
            taskListContainer.appendChild(titleEl);
    
            const start = this.parseDate(task.开始时间);
            if (start) {
                const endOrDefault = this.parseDate(task.截止日期) || new Date(start.getTime() + 86400000);
                let startUnit = 0, duration = 0;
                
                if (granularity === 'days') {
                    startUnit = Math.floor((start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
                    duration = Math.ceil((endOrDefault.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) || 1;
                } else if (granularity === 'weeks') {
                    startUnit = Math.floor((start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
                    duration = Math.ceil((endOrDefault.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7)) || 1;
                } else { // months
                    startUnit = (start.getFullYear() - minDate.getFullYear()) * 12 + (start.getMonth() - minDate.getMonth());
                    duration = Math.ceil(((endOrDefault.getFullYear() - start.getFullYear()) * 12 + (endOrDefault.getMonth() - start.getMonth())) - 
                                         ((start.getFullYear() - minDate.getFullYear()) * 12 + (start.getMonth() - minDate.getMonth()))) || 1;
                }

                const statusClass = { '待办': 'todo', '进行中': 'inprogress', '已完成': 'completed' }[task.状态] || 'todo';
    
                const bar = document.createElement('div');
                bar.className = `gantt-bar gantt-bar-${statusClass}`;
                bar.style.gridColumn = `${startUnit + 1} / span ${duration}`;
                bar.title = `${task.任务名称} (${task.状态})`;
                bar.innerHTML = `<span>${task.任务名称}</span>`;
    
                bar.addEventListener('click', () => {
                    const taskData = this.getTaskFromPath(indices)?.task;
                    if (taskData) this.showEditModal(indices, taskData);
                });
                barsContainer.appendChild(bar);
            } else {
                barsContainer.appendChild(document.createElement('div')); // Placeholder
            }
        });
    
        body.appendChild(taskListContainer);
        body.appendChild(barsContainer);
        container.appendChild(body);
        this.timelineContainer.innerHTML = '';
        this.timelineContainer.appendChild(container);
    }
    
    // --- KANBAN VIEW ---
    private renderKanban(): void {
        const statuses: TaskStatus[] = ['待办', '进行中', '已完成'];
        const board = document.createElement('div');
        board.className = 'kanban-board';

        const tasksByStatus: Record<string, any[]> = { '待办': [], '进行中': [], '已完成': [] };
        
        for (const item of this.getProcessedTasks()) {
            tasksByStatus[item.task.状态].push(item);
        }

        statuses.forEach(status => {
            const column = document.createElement('div');
            column.className = 'kanban-column';
            column.dataset.status = status;

            const header = document.createElement('div');
            header.className = 'kanban-column-header';
            header.innerHTML = `<h3>${status}</h3><span class="task-count">${tasksByStatus[status].length}</span>`;
            column.appendChild(header);

            const cardsContainer = document.createElement('div');
            cardsContainer.className = 'kanban-cards';
            tasksByStatus[status].forEach(({task, indices, path}) => {
                const card = document.createElement('div');
                card.className = 'kanban-card';
                card.classList.toggle('completed', task.已完成);
                
                let assigneesHTML = '';
                if (task.负责人Ids && task.负责人Ids.length > 0) {
                    assigneesHTML = `<div class="assignee-avatars">`;
                    task.负责人Ids.forEach((id: string) => assigneesHTML += this.renderUserAvatar(id));
                    assigneesHTML += `</div>`;
                }

                card.innerHTML = `
                    <div class="kanban-card-path">${path.join(' > ')}</div>
                    <h4>${task.任务名称}</h4>
                    <div class="kanban-card-footer">
                        ${task.截止日期 ? `<span class="kanban-card-meta">🏁 ${task.截止日期}</span>` : ''}
                        ${assigneesHTML}
                    </div>
                `;
                card.onclick = () => this.showEditModal(indices, task);
                cardsContainer.appendChild(card);
            });
            column.appendChild(cardsContainer);
            board.appendChild(column);
        });
        this.timelineContainer.appendChild(board);
    }

    // --- CALENDAR VIEW ---
    private renderCalendar(): void {
        const date = this.state.calendarDate;
        const year = date.getFullYear();
        const month = date.getMonth();

        const container = document.createElement('div');
        container.className = 'calendar-view';
        
        const header = document.createElement('div');
        header.className = 'calendar-header';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'secondary-btn';
        prevBtn.textContent = '<';
        prevBtn.onclick = () => this.setState({ calendarDate: new Date(year, month - 1, 1) });
        const nextBtn = document.createElement('button');
        nextBtn.className = 'secondary-btn';
        nextBtn.textContent = '>';
        nextBtn.onclick = () => this.setState({ calendarDate: new Date(year, month + 1, 1) });
        const title = document.createElement('h3');
        title.textContent = `${year}年 ${month + 1}月`;
        header.appendChild(prevBtn);
        header.appendChild(title);
        header.appendChild(nextBtn);
        container.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'calendar-grid';
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        weekdays.forEach(day => {
            const dayEl = document.createElement('div');
            dayEl.className = 'calendar-weekday';
            dayEl.textContent = day;
            grid.appendChild(dayEl);
        });
        
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const isToday = (d: Date) => d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();

        const tasksWithDates = this.getProcessedTasks().filter(t => t.task.开始时间 || t.task.截止日期);

        for (let i = 0; i < firstDay; i++) {
            const emptyCell = document.createElement('div');
            emptyCell.className = 'calendar-day other-month';
            grid.appendChild(emptyCell);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const dayCell = document.createElement('div');
            const currentDate = new Date(year, month, i);
            dayCell.className = 'calendar-day';
            if(isToday(currentDate)) dayCell.classList.add('today');

            dayCell.innerHTML = `<div class="day-number">${i}</div><div class="calendar-events"></div>`;
            const eventsContainer = dayCell.querySelector('.calendar-events')!;

            tasksWithDates.forEach(({ task, indices }) => {
                const start = this.parseDate(task.开始时间);
                const end = this.parseDate(task.截止日期);
                if (start?.toDateString() === currentDate.toDateString()) {
                    const eventEl = this.createCalendarEvent(task, indices, 'start');
                    eventsContainer.appendChild(eventEl);
                }
                if (end?.toDateString() === currentDate.toDateString() && start?.toDateString() !== end?.toDateString()) {
                    const eventEl = this.createCalendarEvent(task, indices, 'end');
                    eventsContainer.appendChild(eventEl);
                }
            });
            grid.appendChild(dayCell);
        }
        
        container.appendChild(grid);
        this.timelineContainer.appendChild(container);
    }

    private createCalendarEvent(task: 任务, indices: Indices, type: 'start' | 'end'): HTMLElement {
        const eventEl = document.createElement('div');
        eventEl.className = `calendar-event calendar-event-${type}`;
        eventEl.textContent = task.任务名称;
        eventEl.title = task.任务名称;
        eventEl.onclick = () => this.showEditModal(indices, task);
        return eventEl;
    }

    // --- WORKLOAD VIEW ---
    private getWeekStartDate(d: Date): Date {
        const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.setDate(diff));
    }

    private renderWorkloadView(): void {
        const tasks = Array.from(this.flattenTasks()).filter(t => t.task.负责人Ids && t.task.开始时间);
        if (tasks.length === 0) {
            this.timelineContainer.innerHTML = `<p>沒有可供分析的任務。請確保任務已分配負責人並設置了開始時間。</p>`;
            return;
        }
    
        const workloadData: Record<string, Record<string, { count: number, tasks: 任务[] }>> = {};
        const weekStarts = new Set<number>();
    
        tasks.forEach(({ task }) => {
            const assignees = task.负责人Ids || [];
            if (assignees.length === 0) return;
    
            const startDate = this.parseDate(task.开始时间);
            if (!startDate) return;
    
            const weekStart = this.getWeekStartDate(startDate).getTime();
            weekStarts.add(weekStart);
    
            assignees.forEach(assigneeId => {
                if (!workloadData[assigneeId]) workloadData[assigneeId] = {};
                if (!workloadData[assigneeId][weekStart]) {
                    workloadData[assigneeId][weekStart] = { count: 0, tasks: [] };
                }
                workloadData[assigneeId][weekStart].count++;
                workloadData[assigneeId][weekStart].tasks.push(task);
            });
        });
        
        const allAssigneeIds = Object.keys(workloadData).sort((a,b) => {
            const userA = this.state.allUsers.find(u=>u.id === a);
            const userB = this.state.allUsers.find(u=>u.id === b);
            return (userA?.username || '').localeCompare(userB?.username || '');
        });
        const sortedWeeks = Array.from(weekStarts).sort();
        let maxWorkload = 1;
        Object.values(workloadData).forEach(assigneeData => {
            Object.values(assigneeData).forEach(data => {
                if (data.count > maxWorkload) maxWorkload = data.count;
            });
        });
    
        const table = document.createElement('div');
        table.className = 'workload-table';
        
        table.innerHTML += `<div class="workload-header-cell">负责人</div>`;
        sortedWeeks.forEach(weekTime => {
            const d = new Date(weekTime);
            table.innerHTML += `<div class="workload-header-cell">${d.getMonth()+1}/${d.getDate()} 周</div>`;
        });
    
        allAssigneeIds.forEach(assigneeId => {
            const user = this.state.allUsers.find(u => u.id === assigneeId);
            table.innerHTML += `<div class="workload-person-cell">${user?.profile.displayName || '未知用户'}</div>`;
            sortedWeeks.forEach(weekTime => {
                const data = workloadData[assigneeId]?.[weekTime];
                const count = data?.count || 0;
                
                const cell = document.createElement('div');
                cell.className = 'workload-week-cell';
                
                if(count > 0) {
                    let workloadClass = 'low';
                    if (count > maxWorkload * 0.75 || count > 5) workloadClass = 'high';
                    else if (count > maxWorkload * 0.4 || count > 2) workloadClass = 'medium';

                    const bar = document.createElement('div');
                    bar.className = `workload-bar ${workloadClass}`;
                    bar.style.height = `${(count / maxWorkload) * 100}%`;
                    bar.textContent = `${count}`;
                    cell.appendChild(bar);

                    bar.addEventListener('mouseenter', (e) => {
                        const tooltip = document.createElement('div');
                        tooltip.className = 'workload-tooltip';
                        tooltip.innerHTML = `<h5>${user?.profile.displayName} - ${new Date(weekTime).toLocaleDateString()}</h5><ul>` + 
                            data.tasks.map(t => `<li>${t.任务名称}</li>`).join('') + 
                            '</ul>';
                        document.body.appendChild(tooltip);
                        
                        const rect = bar.getBoundingClientRect();
                        tooltip.style.left = `${rect.left + window.scrollX}px`;
                        tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight - 5}px`;
                    });
                    bar.addEventListener('mouseleave', () => {
                        document.querySelector('.workload-tooltip')?.remove();
                    });
                }
                table.appendChild(cell);
            });
        });
    
        table.style.gridTemplateColumns = `150px repeat(${sortedWeeks.length}, 1fr)`;
        this.timelineContainer.appendChild(table);
    }
    
    
    // --- DEPENDENCY MAP VIEW ---
    private renderDependencyMap(): void {
        document.getElementById('dep-map-overlay')?.remove();
        
        const overlay = document.createElement('div');
        overlay.id = 'dep-map-overlay';
        overlay.className = 'modal-overlay visible';
        overlay.innerHTML = `
            <div class="modal-content dependency-map-modal">
                <div class="modal-header">
                    <h2>依赖关系图</h2>
                    <button class="modal-close-btn">&times;</button>
                </div>
                <div class="dependency-map-viewport">
                    <div class="dependency-map-container"></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const closeModal = () => {
            overlay.remove();
            document.removeEventListener('keydown', escapeListener);
        };
        const escapeListener = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeModal();
        };
        overlay.querySelector('.modal-close-btn')!.addEventListener('click', closeModal);
        document.addEventListener('keydown', escapeListener);
        
        const viewport = overlay.querySelector('.dependency-map-viewport') as HTMLElement;
        const container = overlay.querySelector('.dependency-map-container') as HTMLElement;

        const flatTasks = Array.from(this.flattenTasks());
        if (flatTasks.length === 0) {
            container.innerHTML = `<p>沒有任務可供展示。</p>`;
            return;
        }

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'dep-graph-svg');
        svg.innerHTML = `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" /></marker></defs>`;
        container.appendChild(svg);
        
        const taskMap = new Map(flatTasks.map(item => [item.task.id, item]));
        const adj: Record<string, string[]> = {};
        const revAdj: Record<string, string[]> = {};
        flatTasks.forEach(({ task }) => { adj[task.id] = []; revAdj[task.id] = []; });
        flatTasks.forEach(({ task }) => {
            (task.dependencies || []).forEach(depId => {
                if (taskMap.has(depId)) {
                    adj[depId].push(task.id);
                    revAdj[task.id].push(depId);
                }
            });
        });

        const columns: string[][] = [];
        let currentQueue = flatTasks.filter(t => (revAdj[t.task.id] || []).length === 0).map(t => t.task.id);
        const processed = new Set<string>();
        
        while (currentQueue.length > 0) {
            columns.push(currentQueue);
            currentQueue.forEach(id => processed.add(id));
            const nextQueue = new Set<string>();
            currentQueue.forEach(u => {
                (adj[u] || []).forEach(v => {
                    if (!processed.has(v) && (revAdj[v] || []).every(p => processed.has(p))) {
                        nextQueue.add(v);
                    }
                });
            });
            currentQueue = Array.from(nextQueue);
        }

        const nodeElements: Record<string, HTMLElement> = {};
        const colWidth = 250;
        const rowHeight = 120;
        let maxWidth = 0;
        let maxHeight = 0;

        columns.forEach((col, colIndex) => {
            col.forEach((taskId, rowIndex) => {
                const item = taskMap.get(taskId);
                if (!item) return;
                const { task, indices } = item;
                
                const assigneeName = task.负责人Ids && task.负责人Ids.length > 0
                    ? this.state.allUsers.find(u => u.id === task.负责人Ids![0])?.profile.displayName || '未分配'
                    : '未分配';

                const node = document.createElement('div');
                node.className = 'dep-node';
                node.dataset.status = task.状态;
                node.innerHTML = `<strong>${task.任务名称}</strong><span>${assigneeName}</span>`;
                
                const x = colIndex * colWidth + 50;
                const y = rowIndex * rowHeight + 50;
                node.style.left = `${x}px`;
                node.style.top = `${y}px`;
                
                node.onclick = () => this.showEditModal(indices, task);
                
                container.appendChild(node);
                nodeElements[taskId] = node;
                
                maxWidth = Math.max(maxWidth, x + 200);
                maxHeight = Math.max(maxHeight, y + 60);
            });
        });

        container.style.width = `${maxWidth}px`;
        container.style.height = `${maxHeight}px`;

        setTimeout(() => {
            flatTasks.forEach(({ task }) => {
                (task.dependencies || []).forEach(depId => {
                    const sourceNode = nodeElements[depId];
                    const targetNode = nodeElements[task.id];
                    if (sourceNode && targetNode) {
                        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                        line.setAttribute('x1', `${sourceNode.offsetLeft + sourceNode.offsetWidth}`);
                        line.setAttribute('y1', `${sourceNode.offsetTop + sourceNode.offsetHeight / 2}`);
                        line.setAttribute('x2', `${targetNode.offsetLeft}`);
                        line.setAttribute('y2', `${targetNode.offsetTop + targetNode.offsetHeight / 2}`);
                        line.setAttribute('class', 'dep-edge');
                        svg.appendChild(line);
                    }
                });
            });
        }, 0);

        let isPanning = false;
        let startX = 0, startY = 0;
        let transX = 0, transY = 0;
        let scale = 1;

        const updateTransform = () => {
            container.style.transform = `translate(${transX}px, ${transY}px) scale(${scale})`;
        };
        viewport.addEventListener('mousedown', (e) => {
            isPanning = true;
            startX = e.clientX - transX;
            startY = e.clientY - transY;
            viewport.style.cursor = 'grabbing';
        });
        viewport.addEventListener('mousemove', (e) => {
            if (!isPanning) return;
            transX = e.clientX - startX;
            transY = e.clientY - startY;
            updateTransform();
        });
        viewport.addEventListener('mouseup', () => {
            isPanning = false;
            viewport.style.cursor = 'grab';
        });
        viewport.addEventListener('mouseleave', () => {
            isPanning = false;
            viewport.style.cursor = 'grab';
        });
        viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            const scaleAmount = -e.deltaY * 0.001;
            const newScale = Math.max(0.2, Math.min(3, scale + scaleAmount));
            
            transX -= (mouseX - transX) * (newScale - scale) / scale;
            transY -= (mouseY - transY) * (newScale - scale) / scale;

            scale = newScale;
            updateTransform();
        });
    }

    // --- MIND MAP VIEW ---
    private renderMindMap(): void {
        if (!this.state.timeline) return;

        interface MindMapNode {
            id: string;
            name: string;
            type: 'project' | 'phase' | 'nested-project' | 'task';
            data: any;
            indices?: Indices;
            children: MindMapNode[];
            parent?: MindMapNode;
            x: number;
            y: number;
            subtreeHeight: number;
        }

        const NODE_WIDTH = 220;
        const NODE_HEIGHT = 50;
        const HORIZONTAL_GAP = 80;
        const VERTICAL_GAP = 20;

        const buildTree = (): MindMapNode => {
            const root: MindMapNode = {
                id: 'root',
                name: this.state.timeline!.项目名称,
                type: 'project',
                data: this.state.timeline,
                children: [],
                x: 0, y: 0, subtreeHeight: 0,
            };

            this.state.timeline!.阶段.forEach((phase, phaseIndex) => {
                const phaseNode: MindMapNode = {
                    id: `phase-${phaseIndex}`,
                    name: phase.阶段名称,
                    type: 'phase',
                    data: phase,
                    children: [],
                    parent: root,
                    x: 0, y: 0, subtreeHeight: 0,
                };
                root.children.push(phaseNode);

                const processTasks = (tasks: 任务[], baseIndices: TopLevelIndices, parentNode: MindMapNode, parentPath: number[]) => {
                    (tasks || []).forEach((task, taskIndex) => {
                        const currentPath = [...parentPath, taskIndex];
                        const taskNode: MindMapNode = {
                            id: task.id,
                            name: task.任务名称,
                            type: 'task',
                            data: task,
                            indices: { ...baseIndices, phaseIndex: baseIndices.phaseIndex!, taskPath: currentPath },
                            children: [],
                            parent: parentNode,
                            x: 0, y: 0, subtreeHeight: 0,
                        };
                        parentNode.children.push(taskNode);
                        if (task.子任务) {
                            processTasks(task.子任务, baseIndices, taskNode, currentPath);
                        }
                    });
                };
                
                (phase.任务 || []).forEach((task, taskIndex) => {
                    const taskNode: MindMapNode = {
                        id: task.id,
                        name: task.任务名称,
                        type: 'task',
                        data: task,
                        indices: { phaseIndex, taskPath: [taskIndex] },
                        children: [],
                        parent: phaseNode,
                        x: 0, y: 0, subtreeHeight: 0,
                    };
                    phaseNode.children.push(taskNode);
                    if (task.子任务) {
                        processTasks(task.子任务, { phaseIndex }, taskNode, [taskIndex]);
                    }
                });

                (phase.项目 || []).forEach((proj, projectIndex) => {
                    const projNode: MindMapNode = {
                        id: `phase-${phaseIndex}-proj-${projectIndex}`,
                        name: proj.项目名称,
                        type: 'nested-project',
                        data: proj,
                        children: [],
                        parent: phaseNode,
                        x: 0, y: 0, subtreeHeight: 0,
                    };
                    phaseNode.children.push(projNode);
                    processTasks(proj.任务, { phaseIndex, projectIndex }, projNode, []);
                });
            });
            return root;
        };

        const calculateLayout = (node: MindMapNode, depth = 0) => {
            node.x = depth * (NODE_WIDTH + HORIZONTAL_GAP);
            const isCollapsed = this.state.mindMapState.collapsedNodes.has(node.id);

            if (isCollapsed || node.children.length === 0) {
                node.subtreeHeight = NODE_HEIGHT;
                return;
            }

            let childrenSubtreeHeight = 0;
            node.children.forEach((child, index) => {
                calculateLayout(child, depth + 1);
                childrenSubtreeHeight += child.subtreeHeight;
                if (index > 0) {
                    childrenSubtreeHeight += VERTICAL_GAP;
                }
            });
            node.subtreeHeight = Math.max(NODE_HEIGHT, childrenSubtreeHeight);
        };

        const assignCoordinates = (node: MindMapNode, y: number) => {
            node.y = y + (node.subtreeHeight - NODE_HEIGHT) / 2;
            const isCollapsed = this.state.mindMapState.collapsedNodes.has(node.id);

            if (!isCollapsed && node.children.length > 0) {
                let currentY = y;
                node.children.forEach(child => {
                    assignCoordinates(child, currentY);
                    currentY += child.subtreeHeight + VERTICAL_GAP;
                });
            }
        };

        const root = buildTree();
        calculateLayout(root);
        assignCoordinates(root, 0);

        this.timelineContainer.innerHTML = '';
        this.timelineContainer.className = 'mindmap-view';
        
        const viewport = document.createElement('div');
        viewport.className = 'mindmap-viewport';
        const container = document.createElement('div');
        container.className = 'mindmap-container';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'mindmap-connectors');
        
        container.appendChild(svg);
        viewport.appendChild(container);

        const allNodes: MindMapNode[] = [];
        const traverse = (node: MindMapNode) => {
            allNodes.push(node);
            const isCollapsed = this.state.mindMapState.collapsedNodes.has(node.id);
            if (!isCollapsed) {
                node.children.forEach(traverse);
            }
        };
        traverse(root);

        allNodes.forEach(node => {
            const nodeEl = document.createElement('div');
            nodeEl.className = 'mindmap-node';
            nodeEl.dataset.type = node.type;
            nodeEl.style.left = `${node.x}px`;
            nodeEl.style.top = `${node.y}px`;

            if (node.type === 'task') {
                nodeEl.dataset.status = node.data.状态;
                nodeEl.onclick = () => this.showEditModal(node.indices!, node.data);
            }
            
            const nameEl = document.createElement('div');
            nameEl.className = 'mindmap-node-name';
            nameEl.textContent = node.name;
            nodeEl.appendChild(nameEl);
            
            if (node.children.length > 0) {
                const toggleBtn = document.createElement('button');
                toggleBtn.className = 'node-toggle';
                const isCollapsed = this.state.mindMapState.collapsedNodes.has(node.id);
                toggleBtn.textContent = isCollapsed ? '+' : '-';
                nodeEl.appendChild(toggleBtn);
                nodeEl.classList.toggle('collapsed', isCollapsed);
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    const newSet = this.state.mindMapState.collapsedNodes;
                    if (newSet.has(node.id)) {
                        newSet.delete(node.id);
                    } else {
                        newSet.add(node.id);
                    }
                    this.setState({ mindMapState: { collapsedNodes: newSet } });
                };
            }

            container.appendChild(nodeEl);
            
            if (node.parent) {
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                const startX = node.parent.x + NODE_WIDTH;
                const startY = node.parent.y + NODE_HEIGHT / 2;
                const endX = node.x;
                const endY = node.y + NODE_HEIGHT / 2;
                const c1X = startX + HORIZONTAL_GAP / 2;
                const c1Y = startY;
                const c2X = endX - HORIZONTAL_GAP / 2;
                const c2Y = endY;
                path.setAttribute('d', `M ${startX} ${startY} C ${c1X} ${c1Y}, ${c2X} ${c2Y}, ${endX} ${endY}`);
                path.setAttribute('class', 'mindmap-connector');
                svg.appendChild(path);
            }
        });

        let scale = 1, panX = 0, panY = 0;
        let isPanning = false, startX = 0, startY = 0;

        const updateTransform = () => {
            container.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
        };

        viewport.onmousedown = (e) => {
            isPanning = true;
            startX = e.clientX - panX;
            startY = e.clientY - panY;
            viewport.style.cursor = 'grabbing';
        };
        viewport.onmousemove = (e) => {
            if (!isPanning) return;
            panX = e.clientX - startX;
            panY = e.clientY - startY;
            updateTransform();
        };
        viewport.onmouseup = viewport.onmouseleave = () => {
            isPanning = false;
            viewport.style.cursor = 'grab';
        };
        viewport.onwheel = (e) => {
            e.preventDefault();
            const rect = viewport.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const scaleFactor = 1 - e.deltaY * 0.001;
            
            panX = mouseX - (mouseX - panX) * scaleFactor;
            panY = mouseY - (mouseY - panY) * scaleFactor;
            scale *= scaleFactor;
            scale = Math.max(0.2, Math.min(3, scale));
            updateTransform();
        };
        
        const controls = document.createElement('div');
        controls.className = 'mindmap-controls';
        controls.innerHTML = `
            <button data-action="zoom-in" title="放大">+</button>
            <button data-action="zoom-out" title="缩小">-</button>
            <button data-action="fit" title="适应屏幕">
                <svg viewBox="0 0 24 24"><path d="M15 3h6v6h-2V5h-4V3zM9 21H3v-6h2v4h4v2zm6-18v2h4v4h2V3h-6zM3 9V3h6v2H5v4H3z"/></svg>
            </button>
        `;
        controls.onclick = (e) => {
            const action = (e.target as HTMLElement).closest('button')?.dataset.action;
            if (action === 'zoom-in') scale = Math.min(3, scale * 1.2);
            if (action === 'zoom-out') scale = Math.max(0.2, scale / 1.2);
            if (action === 'fit') {
                const bounds = container.getBoundingClientRect();
                const viewportBounds = viewport.getBoundingClientRect();
                const scaleX = viewportBounds.width / bounds.width;
                const scaleY = viewportBounds.height / bounds.height;
                scale = Math.min(scaleX, scaleY) * 0.9;
                panX = (viewportBounds.width - bounds.width * scale) / 2 - bounds.left * scale;
                panY = (viewportBounds.height - bounds.height * scale) / 2 - bounds.top * scale;
            }
            updateTransform();
        };

        this.timelineContainer.appendChild(viewport);
        this.timelineContainer.appendChild(controls);

        setTimeout(() => controls.querySelector<HTMLButtonElement>('button[data-action="fit"]')?.click(), 100);
    }
}

document.addEventListener("DOMContentLoaded", () => {
  new TimelineApp();
});