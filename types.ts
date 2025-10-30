import type { TimelineApp } from './index.js';

// --- Data Interfaces for Users and Collaboration ---
export interface UserProfile {
  displayName: string;
  avatarUrl?: string;
  // A color derived from username for UI consistency
  color: string; 
}

// User object, password is no longer stored on the client
export interface User {
  id: string; // This will come from the database ID
  username: string;
  profile: UserProfile;
}

// A new interface for the currently logged-in user, including their auth token
export interface CurrentUser extends User {
    token: string;
}

export type ProjectMemberRole = 'Admin' | 'Editor' | 'Viewer';

export interface ProjectMember {
  userId: string;
  role: ProjectMemberRole;
}

// --- Data Interfaces for the timeline (in Chinese) ---
export interface CommentAttachment {
  name: string;
  url: string; // For images, this will be a data URL. For others, a placeholder.
  mimeType: string;
}

export interface 评论 {
  id: string; // Unique ID for each comment
  发言人Id: string; // Changed from string to userId
  内容: string;
  时间戳: string;
  attachments?: CommentAttachment[]; // Support for file attachments
}

export type TaskStatus = '待办' | '进行中' | '已完成';
export type TaskPriority = '高' | '中' | '低';

export interface 任务 {
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

export interface 内嵌项目 {
  项目名称: string;
  备注?: string;
  任务: 任务[];
}

export interface 阶段 {
  阶段名称: string;
  任务?: 任务[];
  项目?: 内嵌项目[];
}

export interface Report {
  id: string;
  type: 'plan' | 'weekly' | 'monthly';
  title: string;
  content: string;
  createdAt: string; // ISO string
  createdBy: string; // userId
  startDate?: string;
  endDate?: string;
}

export interface 时间轴数据 {
  id: string; // Unique project ID
  项目名称: string;
  阶段: 阶段[];
  ownerId: string;
  members: ProjectMember[];
  reports?: Report[];
}

export type ViewType = 'vertical' | 'kanban' | 'calendar' | 'dependencies' | 'mindmap';
export type ChatRole = 'user' | 'model';
export type ChatModel = 'gemini-2.5-pro' | 'gemini-flash';

export interface ChatMessage {
    role: ChatRole;
    text: string;
    sources?: { uri: string; title: string }[];
    attachment?: {
        dataUrl: string;
        mimeType: string;
    },
    isModification?: boolean;
    isProposal?: boolean;
}

export interface TaskDiff {
  status: 'added' | 'deleted' | 'modified';
  oldTask?: 任务; // Present for deleted and modified
  newTask?: 任务; // Present for added and modified
  changes?: { [key in keyof 任务]?: { from: any, to: any } }; // Present for modified
  parentPath: string;
}

export interface AppState {
  currentUser: CurrentUser | null;
  allUsers: User[]; 
  projectsHistory: 时间轴数据[];
  timeline: 时间轴数据 | null;
  previousTimelineState: 时间轴数据 | null; // For the undo feature
  pendingTimeline: {
    data: 时间轴数据;
    diff: Map<string, TaskDiff>;
  } | null;
  isLoading: boolean;
  loadingText: string;
  currentView: ViewType;
  authView: 'login' | 'register';
  calendarDate: Date;
  isChatOpen: boolean;
  isChatLoading: boolean;
  chatHistory: ChatMessage[];
  lastUserMessage: ChatMessage | null;
  chatAttachment: {
      file: File;
      dataUrl: string;
      mimeType: string;
  } | null;
  chatModel: ChatModel;
  editingMessageIndex: number | null;
  filters: {
    status: TaskStatus[];
    priority: TaskPriority[];
    assignee: string[];
  };
  sortBy: 'default' | 'deadline' | 'priority' | 'name';
  mindMapState: {
    collapsedNodes: Set<string>;
  };
  apiKey: string | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  collapsedItems: Set<string>; // For vertical view
}

export interface Indices {
  phaseIndex: number;
  projectIndex?: number;
  taskPath: number[];
}

export interface TopLevelIndices {
    phaseIndex?: number;
    projectIndex?: number;
}

// Interface for TimelineApp to avoid circular dependencies
export type ITimelineApp = TimelineApp;