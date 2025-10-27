import { GoogleGenAI, Type } from "@google/genai";
import { 
    时间轴数据, AppState, CurrentUser, Indices, 任务, 评论, TopLevelIndices, 
    ProjectMember, User, ITimelineApp, ProjectMemberRole, ChatMessage, TaskDiff, ChatModel, CommentAttachment 
} from './types.js';
import * as api from './api.js';
import { decodeJwtPayload, simpleMarkdownToHtml } from './utils.js';
import { renderUI } from './ui.js';
import { renderView } from './views.js';
import { cacheDOMElements, addEventListeners } from './setup.js';
import * as handlers from './handlers.js';


export class TimelineApp implements ITimelineApp {
  public state: AppState = {
    currentUser: null,
    allUsers: [],
    projectsHistory: [],
    timeline: null,
    previousTimelineState: null,
    pendingTimeline: null,
    isLoading: false,
    loadingText: "项目初始化中...",
    currentView: 'vertical',
    authView: 'login',
    calendarDate: new Date(),
    isChatOpen: false,
    isChatLoading: false,
    chatHistory: [],
    lastUserMessage: null,
    chatAttachment: null,
    chatModel: 'gemini-2.5-pro',
    editingMessageIndex: null,
    filters: {
      status: [],
      priority: [],
      assignee: [],
    },
    sortBy: 'default',
    mindMapState: {
        collapsedNodes: new Set<string>(),
    },
    apiKey: null,
    saveStatus: 'idle',
    collapsedItems: new Set<string>(),
  };
  
  public projectCreationFiles: File[] = [];
  public commentAttachments = new Map<string, File[]>();

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
  public aboutBtn: HTMLButtonElement;
  public optimizeBtnToggle: HTMLButtonElement;
  public optimizeDropdown: HTMLElement;
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
  public chatAttachmentBtn: HTMLButtonElement;
  public chatAttachmentInput: HTMLInputElement;
  public chatAttachmentPreview: HTMLElement;
  public chatModelSelectorContainer: HTMLElement;
  public chatFormModelSelector: HTMLSelectElement;
  public apiKeyModalOverlay: HTMLElement;
  public apiKeyForm: HTMLFormElement;
  public apiKeyInput: HTMLInputElement;
  public apiKeyErrorEl: HTMLElement;
  public projectCreationCard: HTMLElement;
  public uploadFilesBtn: HTMLButtonElement;
  public projectFilesInput: HTMLInputElement;
  public filePreviewContainer: HTMLElement;
  public aiChangesConfirmBar: HTMLElement;


  constructor() {
    cacheDOMElements(this);
    addEventListeners(this);
    this.loadStateAndInitialize();
  }
  
  private async loadStateAndInitialize(): Promise<void> {
    const savedDataJSON = localStorage.getItem("timelineAppData");
    let token: string | null = null;
    let apiKey: string | null = null;
    let chatModel: ChatModel | null = null;
    
    if (savedDataJSON) {
        try {
            const savedData = JSON.parse(savedDataJSON);
            token = savedData.authToken || null;
            apiKey = savedData.apiKey || null;
            chatModel = savedData.chatModel || null;
        } catch(e) {
            console.error("Failed to parse saved data, clearing.", e);
            localStorage.removeItem("timelineAppData");
        }
    }
    
    this.state.apiKey = apiKey;
    if (chatModel) this.state.chatModel = chatModel;
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
            this.handleLoadProject(project);
          } catch(e) {
             alert("加入项目失败，请稍后重试。");
             project.members.pop();
          } finally {
            this.setState({ isLoading: false });
          }
      } else {
          this.handleLoadProject(project);
      }
  }

  public setState(newState: Partial<AppState>, shouldRender: boolean = true): void {
    this.state = { ...this.state, ...newState };
    
    if (shouldRender) {
      this.render();
    }
    
    // If any of the persisted properties are present in the update, save the state.
    if ('currentUser' in newState || 'apiKey' in newState || 'chatModel' in newState) {
      this.saveState();
    }
  }

  private saveState(): void {
    const appData = {
        authToken: this.state.currentUser?.token,
        apiKey: this.state.apiKey,
        chatModel: this.state.chatModel,
    };
    localStorage.setItem("timelineAppData", JSON.stringify(appData));
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
      
      const taskSchema = createRecursiveTaskSchema(3);
      const nestedProjectSchema = { type: Type.OBJECT, properties: { 项目名称: { type: Type.STRING }, 备注: { type: Type.STRING }, 任务: { type: Type.ARRAY, items: taskSchema } }, required: ["项目名称", "任务"] };
      const phaseSchema = { type: Type.OBJECT, properties: { 阶段名称: { type: Type.STRING }, 任务: { type: Type.ARRAY, items: taskSchema }, 项目: { type: Type.ARRAY, items: nestedProjectSchema } }, required: ["阶段名称"] };
      return { type: Type.OBJECT, properties: { 项目名称: { type: Type.STRING }, 阶段: { type: Type.ARRAY, items: phaseSchema } }, required: ["项目名称", "阶段"] };
  }

  private getCurrentDateContext(): string {
      const now = new Date().toLocaleString('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return `请注意：当前日期和时间是 ${now}。请根据此时间解析任何相对时间表述（例如“明天下午”、“下周”）。所有输出的时间都应为“YYYY-MM-DD HH:mm”格式，精确到分钟。`;
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
    
    public clearUndoState(): void {
        if (this.state.previousTimelineState) {
            this.setState({ previousTimelineState: null }, false);
        }
    }

    public async handleToggleComplete(indices: Indices, isChecked: boolean): Promise<void> {
        this.clearUndoState();
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
            this.render(); // Optimistic UI update
            await this.saveCurrentProject(this.state.timeline);
        }
    }

    public async handleUpdateTask(indices: Indices, updatedTask: 任务): Promise<void> {
        this.clearUndoState();
        const result = this.getTaskFromPath(indices);
        if(result && this.state.timeline) {
            const currentTask = result.parent[result.taskIndex];
            result.parent[result.taskIndex] = { ...currentTask, ...updatedTask };
            this.render(); // Optimistic UI update
            await this.saveCurrentProject(this.state.timeline);
        }
    }

    public async handleAddTask(indices: TopLevelIndices, parentTaskPath?: number[]): Promise<void> {
        this.clearUndoState();
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
        this.render(); // Optimistic UI update
        await this.saveCurrentProject(this.state.timeline);
    }

    public async handleDeleteTask(indices: Indices): Promise<void> {
        this.clearUndoState();
        if (!confirm("确定要从此计划中移除此任务吗？")) return;
        const result = this.getTaskFromPath(indices);
        if(result && this.state.timeline) {
            result.parent.splice(result.taskIndex, 1);
            this.render(); // Optimistic UI update
            await this.saveCurrentProject(this.state.timeline);
        }
    }
    
    public async handleAddComment(indices: Indices, content: string): Promise<void> {
        this.clearUndoState();
        const result = this.getTaskFromPath(indices);
        const pendingFiles = result ? this.commentAttachments.get(result.task.id) || [] : [];
        if ((!content.trim() && pendingFiles.length === 0) || !this.state.currentUser) return;
    
        if (result && this.state.timeline) {
            const task = result.task;
            if (!task.讨论) task.讨论 = [];
    
            const newComment: 评论 = {
                id: `comment-${Date.now()}`,
                发言人Id: this.state.currentUser.id,
                内容: content,
                时间戳: new Date().toISOString(),
                attachments: []
            };
    
            for (const file of pendingFiles) {
                let url = '#'; // Placeholder URL
                if (file.type.startsWith('image/')) {
                    url = await new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onload = e => resolve(e.target!.result as string);
                        reader.readAsDataURL(file);
                    });
                }
                newComment.attachments!.push({
                    name: file.name,
                    url: url,
                    mimeType: file.type,
                });
            }
    
            task.讨论.push(newComment);
            this.commentAttachments.delete(task.id); 
            this.render(); // Optimistic UI update
            await this.saveCurrentProject(this.state.timeline);
        }
    }
    
    public async handleDeleteComment(indices: Indices, commentId: string): Promise<void> {
        this.clearUndoState();
        if (!confirm("确定要删除这条评论吗？")) return;
        const result = this.getTaskFromPath(indices);
        if (result && this.state.timeline && result.task.讨论) {
            const commentIndex = result.task.讨论.findIndex(c => c.id === commentId);
            if (commentIndex > -1) {
                result.task.讨论.splice(commentIndex, 1);
                this.render(); // Optimistic UI update
                await this.saveCurrentProject(this.state.timeline);
            }
        }
    }

    public async handleEditComment(indices: Indices, commentId: string, newContent: string): Promise<void> {
        this.clearUndoState();
        const result = this.getTaskFromPath(indices);
        if (result && this.state.timeline && result.task.讨论) {
            const comment = result.task.讨论.find(c => c.id === commentId);
            if (comment && comment.内容 !== newContent) {
                comment.内容 = newContent;
                this.render(); // Optimistic UI update
                await this.saveCurrentProject(this.state.timeline);
            } else {
                this.render(); // Re-render to hide edit form if content is unchanged
            }
        }
    }


    private async handleMoveTask(draggedIndices: Indices, dropIndices: Indices, position: 'before' | 'after'): Promise<void> {
        this.clearUndoState();
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
        this.render(); // Optimistic UI update
        await this.saveCurrentProject(this.state.timeline);
    }

    public async saveCurrentProject(updatedTimeline: 时间轴数据) {
        if (!this.state.currentUser) return; // Should not happen if called from a handler
        const projectIndex = this.state.projectsHistory.findIndex(p => p.id === updatedTimeline.id);
        const newHistory = [...this.state.projectsHistory];
        if (projectIndex !== -1) {
            newHistory[projectIndex] = updatedTimeline;
        } else {
             newHistory.push(updatedTimeline);
        }
        
        // Update state but do not trigger a full render here.
        // The handler that called this function is responsible for the optimistic UI update.
        this.setState({
            projectsHistory: newHistory, 
            saveStatus: 'saving' 
        }, false);
        renderUI.renderSaveStatusIndicator(this);
        
        try {
            // Because the handler already did an optimistic update, we pass a fresh copy to the API
            await api.updateProject(JSON.parse(JSON.stringify(updatedTimeline)), this.state.currentUser.token);
            this.setState({ saveStatus: 'saved' }, false);
            renderUI.renderSaveStatusIndicator(this);
        } catch (error) {
            console.error("Failed to save project:", error);
            this.setState({ saveStatus: 'error' }, false);
            renderUI.renderSaveStatusIndicator(this);
            alert("项目保存失败，您的更改可能不会被保留。请检查您的网络连接并重试。");
        }
    }

    public handleLoadProject(project: 时间轴数据): void {
        if(project && this.state.currentUser) {
            this.setState({ 
                timeline: project, 
                currentView: 'vertical', 
                chatHistory: [], 
                isChatOpen: false, 
                collapsedItems: new Set(), 
                previousTimelineState: null, 
                pendingTimeline: null,
                filters: {
                    status: [],
                    priority: [],
                    assignee: [this.state.currentUser.id],
                },
                sortBy: 'default',
            });
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
  
    public async handleUpdateField(indices: TopLevelIndices, field: string, value: string): Promise<void> {
        this.clearUndoState();
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
        this.render(); // Optimistic UI update
        await this.saveCurrentProject(this.state.timeline);
    }
  
    public showEditModal(indices: Indices, task: 任务): void {
        renderUI.showEditModal(this, indices, task);
    }
    
    public async handleRegenerateClick(this: ITimelineApp, modelMessageIndex: number): Promise<void> {
        if (this.state.isChatLoading) return;
    
        const userMessageToResend = this.state.chatHistory[modelMessageIndex - 1];
        if (!userMessageToResend || userMessageToResend.role !== 'user') {
            console.error("Cannot regenerate: preceding user message not found.");
            return;
        }
    
        // If we are regenerating, exit any editing state
        if (this.state.editingMessageIndex !== null) {
            this.setState({ editingMessageIndex: null }, false); 
        }

        const historyForResubmission = this.state.chatHistory.slice(0, modelMessageIndex);
        this.setState({
            isChatLoading: true,
            chatHistory: historyForResubmission,
            lastUserMessage: userMessageToResend,
            previousTimelineState: null,
            pendingTimeline: null,
        });
    
        await handlers.submitChat.call(this, userMessageToResend, historyForResubmission);
    }

    public handleEditChatMessage(messageIndex: number): void {
        this.setState({ editingMessageIndex: messageIndex });
    }

    public async handleSaveChatEdit(messageIndex: number, newText: string): Promise<void> {
        const history = [...this.state.chatHistory];
        const userMessageToEdit = history[messageIndex];
    
        if (!userMessageToEdit || userMessageToEdit.role !== 'user' || userMessageToEdit.text === newText) {
            this.setState({ editingMessageIndex: null });
            return; // No change, or not a user message, so just exit editing.
        }
    
        // Update the message text
        userMessageToEdit.text = newText;
    
        // The AI's response is now invalid, so we truncate the history right after the edited message.
        const historyForResubmission = history.slice(0, messageIndex + 1);
        
        this.setState({ 
            editingMessageIndex: null,
            isChatLoading: true,
            chatHistory: historyForResubmission,
            lastUserMessage: userMessageToEdit,
            previousTimelineState: null,
            pendingTimeline: null,
        });
    
        await handlers.submitChat.call(this, userMessageToEdit, historyForResubmission);
    }

    public handleDeleteChatMessage(messageIndex: number): void {
        if (!confirm("确定要删除此对话回合吗？")) return;
    
        const newHistory = [...this.state.chatHistory];
        // A "turn" consists of a user message and potentially a model response.
        // We delete the user message (at messageIndex) and the following model message.
        if (newHistory[messageIndex]?.role === 'user' && newHistory[messageIndex + 1]?.role === 'model') {
            newHistory.splice(messageIndex, 2);
        } else {
            // If it's just a user message or something unexpected, only delete that one message.
            newHistory.splice(messageIndex, 1);
        }
    
        this.setState({ 
            chatHistory: newHistory,
            // If we were editing the message we just deleted, exit editing mode.
            editingMessageIndex: this.state.editingMessageIndex === messageIndex ? null : this.state.editingMessageIndex 
        });
    }

    public async handleUndo(): Promise<void> {
        if (!this.state.previousTimelineState) {
            console.warn("No previous state to undo to.");
            return;
        }

        const timelineToRestore = this.state.previousTimelineState;
        
        // Use the existing save logic, but first, update the UI optimistically.
        this.setState({
            timeline: timelineToRestore,
            previousTimelineState: null, // Clear undo state
        });
        
        await this.saveCurrentProject(timelineToRestore);

        const newHistory = [...this.state.chatHistory, {
            role: 'model' as const,
            text: "操作已撤销。"
        }];

        this.setState({ chatHistory: newHistory });
    }
    
    public handleRemoveAttachment(): void {
        this.setState({ chatAttachment: null });
    }

    public handleRemoveProjectFile(index: number): void {
        this.projectCreationFiles.splice(index, 1);
        this.renderFilePreviews();
    }

    public renderFilePreviews(): void {
        this.filePreviewContainer.innerHTML = '';
        this.projectCreationFiles.forEach((file, index) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'file-preview-item';

            let previewContent = '';
            if (file.type.startsWith('image/')) {
                previewContent = `<img src="${URL.createObjectURL(file)}" class="preview-image" alt="${file.name}">`;
            } else {
                previewContent = `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
            }
            
            itemEl.innerHTML = `
                ${previewContent}
                <div class="file-info" title="${file.name}">${file.name}</div>
                <button class="remove-file-btn" title="Remove file">&times;</button>
            `;

            itemEl.querySelector('.remove-file-btn')!.addEventListener('click', () => {
                const img = itemEl.querySelector('img');
                if (img) {
                    URL.revokeObjectURL(img.src);
                }
                this.handleRemoveProjectFile(index);
            });

            this.filePreviewContainer.appendChild(itemEl);
        });
    }

    private computeTimelineDiff(oldTimeline: 时间轴数据, newTimeline: 时间轴数据): Map<string, TaskDiff> {
        const diff = new Map<string, TaskDiff>();
        const oldTasks = new Map<string, { task: 任务, parentPath: string }>();
        const newTasks = new Map<string, { task: 任务, parentPath: string }>();
    
        const flatten = (timeline: 时间轴数据, map: Map<string, { task: 任务, parentPath: string }>) => {
            const traverse = (tasks: 任务[], path: string[]) => {
                if (!tasks) return;
                tasks.forEach(task => {
                    map.set(task.id, { task, parentPath: path.join(' > ') });
                    if (task.子任务) traverse(task.子任务, [...path, task.任务名称]);
                });
            };
            timeline.阶段.forEach(phase => {
                const phasePath = [phase.阶段名称];
                if (phase.任务) traverse(phase.任务, phasePath);
                if (phase.项目) {
                    phase.项目.forEach(proj => {
                        const projPath = [...phasePath, proj.项目名称];
                        if (proj.任务) traverse(proj.任务, projPath);
                    });
                }
            });
        };
    
        flatten(oldTimeline, oldTasks);
        flatten(newTimeline, newTasks);
    
        for (const [id, oldData] of oldTasks.entries()) {
            const newData = newTasks.get(id);
            if (!newData) {
                diff.set(id, { status: 'deleted', oldTask: oldData.task, parentPath: oldData.parentPath });
            } else {
                const changes: { [key in keyof 任务]?: { from: any, to: any } } = {};
                let modified = false;
                // A limited set of keys to check for simplicity and relevance.
                const keysToCheck: (keyof 任务)[] = ['任务名称', '状态', '优先级', '详情', '开始时间', '截止日期', '负责人Ids', '备注', 'dependencies'];
                for (const key of keysToCheck) {
                    const oldVal = JSON.stringify(oldData.task[key]);
                    const newVal = JSON.stringify(newData.task[key]);
                    if (oldVal !== newVal) {
                        modified = true;
                        changes[key] = { from: oldData.task[key] || '', to: newData.task[key] || '' };
                    }
                }
                if (modified) {
                    diff.set(id, { status: 'modified', oldTask: oldData.task, newTask: newData.task, changes, parentPath: newData.parentPath });
                }
            }
        }
    
        for (const [id, newData] of newTasks.entries()) {
            if (!oldTasks.has(id)) {
                diff.set(id, { status: 'added', newTask: newData.task, parentPath: newData.parentPath });
            }
        }
    
        return diff;
    }

    public async handleAcceptAiChanges(): Promise<void> {
        if (!this.state.pendingTimeline) return;
        const timelineToSave = this.state.pendingTimeline.data;
        this.clearUndoState();
        
        // Optimistically update the main timeline state and render
        this.setState({
            timeline: timelineToSave,
            pendingTimeline: null,
        });
        
        // Save the accepted changes in the background
        await this.saveCurrentProject(timelineToSave);
    }

    public handleRejectAiChanges(): void {
        if (!this.state.pendingTimeline) return;
        this.setState({ pendingTimeline: null });
    }

    private async showAboutModal(): Promise<void> {
        document.getElementById('about-modal-overlay')?.remove();

        let aboutMarkdown = '正在加载...';
        try {
            const response = await fetch('./README.md');
            if (response.ok) {
                aboutMarkdown = await response.text();
            } else {
                aboutMarkdown = '无法加载项目信息。';
            }
        } catch (e) {
            aboutMarkdown = '加载项目信息时出错。';
        }

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'about-modal-overlay';
        modalOverlay.className = 'modal-overlay';
        
        const aboutHtml = simpleMarkdownToHtml(aboutMarkdown);
        const contentContainer = `<div class="modal-body about-content">${aboutHtml}</div>`;
        modalOverlay.innerHTML = `<div class="modal-content report-modal"><div class="modal-header"><h2>关于 “吹角”</h2><button class="modal-close-btn close-btn">&times;</button></div>${contentContainer}<div class="modal-footer"><button type="button" class="primary-btn close-btn">关闭</button></div></div>`;
        
        document.body.appendChild(modalOverlay);
    
        const close = () => modalOverlay.remove();
        modalOverlay.querySelectorAll('.close-btn').forEach(btn => btn.addEventListener('click', close));
        modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) close(); });
        
        setTimeout(() => modalOverlay.classList.add('visible'), 10);
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
        renderUI.renderSaveStatusIndicator(this); // Ensure save status is rendered

        const timelineData = this.state.pendingTimeline ? this.state.pendingTimeline.data : this.state.timeline;

        if (timelineData) {
            this.inputSection.classList.add("hidden");
            this.timelineSection.classList.remove("hidden");
            setTimeout(() => this.timelineSection.classList.add('visible'), 10);
            const userRole = this.getUserRole();
            const readOnly = userRole === 'Viewer' || !!this.state.pendingTimeline;
            const isOwner = timelineData.ownerId === this.state.currentUser!.id;
            
            this.projectNameEl.innerHTML = '';
            this.projectNameEl.appendChild(renderUI.createEditableElement(this, 'h2', timelineData.项目名称, {}, '项目名称'));
            if (readOnly) {
                const badge = document.createElement('span');
                badge.className = 'readonly-badge';
                badge.textContent = !!this.state.pendingTimeline ? '审核模式' : '只读模式';
                this.projectNameEl.appendChild(badge);
            }
            
            this.shareBtn.style.display = userRole === 'Viewer' ? 'none' : 'inline-flex';
            (this.optimizeBtnToggle.parentElement as HTMLElement).style.display = isOwner ? 'inline-block' : 'none';
            this.chatToggleBtn.style.display = isOwner ? 'inline-flex' : 'none';
            this.optimizeBtnToggle.disabled = readOnly;

            this.aiChangesConfirmBar.classList.toggle('hidden', !this.state.pendingTimeline);
            renderUI.renderViewSwitcher(this);
            renderUI.renderViewSpecificControls(this);
            renderUI.renderFilterSortControls(this);
            renderUI.renderChat(this);
            renderUI.renderChatAttachmentPreview(this);
            renderView(this);
        } else {
            this.inputSection.classList.remove("hidden");
            this.timelineSection.classList.add("hidden");
            this.timelineSection.classList.remove('visible');
            this.aiChangesConfirmBar.classList.add('hidden');
            renderUI.renderHomeScreen(this);
        }
    }

    public getUserProjects(): 时间轴数据[] {
        if (!this.state.currentUser) return [];
        return this.state.projectsHistory.filter(p => p.members.some(m => m.userId === this.state.currentUser!.id));
    }

    public getUserRole(): ProjectMemberRole | null {
        const currentTimeline = this.state.pendingTimeline ? this.state.pendingTimeline.data : this.state.timeline;
        if (!this.state.currentUser || !currentTimeline) return null;
        if (currentTimeline.ownerId === this.state.currentUser.id) return 'Admin';
        const member = currentTimeline.members.find(m => m.userId === this.state.currentUser!.id);
        return member ? member.role : null;
    }

    public canEditProject(): boolean {
        if (this.state.pendingTimeline) return false;
        const role = this.getUserRole();
        return role === 'Admin' || role === 'Editor';
    }

    public *flattenTasks(): Generator<{ task: 任务; indices: Indices; path: string[] }> {
        const timelineData = this.state.pendingTimeline ? this.state.pendingTimeline.data : this.state.timeline;
        if (!timelineData) return;
        for (const [phaseIndex, phase] of timelineData.阶段.entries()) {
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
