import type { ITimelineApp, 时间轴数据, CurrentUser, ChatMessage, 任务 } from './types.js';
import { GoogleGenAI, Type } from "@google/genai";
import * as api from './api.js';
import { renderUI } from './ui.js';
import { decodeJwtPayload, blobToBase64 } from './utils.js';

/**
 * Generates a specific and user-friendly error message for API-related failures.
 * @param error The error object caught.
 * @param context A string describing the action that failed (e.g., "同步周进度").
 * @returns A formatted, actionable error message string.
 */
function getApiErrorMessage(error: unknown, context: string): string {
    const baseMessage = `${context}失败`;
    if (error instanceof Error) {
        if (error.message.includes('API key')) {
            return `${baseMessage}：您的 API 密钥似乎无效或已过期。请在用户设置中检查并更新。`;
        }
        if (error.message.includes('timed out') || error.message.includes('network') || error.message.includes('fetch')) {
            return `${baseMessage}：网络连接或请求失败。这可能是由于项目数据过大或网络不稳定。请稍后重试。`;
        }
        if (error.message.includes('JSON')) {
             return `${baseMessage}：AI 返回了无效的数据格式。这可能是由于任务过于复杂或模型暂时不稳定。`;
        }
        // For other identifiable errors, return the specific message.
        return `${baseMessage}，发生了一个意外错误：${error.message}`;
    }
    // Fallback for non-Error objects or unknown errors
    return `${baseMessage}，发生了一个未知错误。请检查浏览器控制台获取更多技术信息。`;
}

export function handleAuthSwitch(this: ITimelineApp, view: 'login' | 'register'): void {
  this.setState({ authView: view });
}

export async function handleLogin(this: ITimelineApp, event: Event): Promise<void> {
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
          await (this as any).initializeApp(currentUser);
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

export async function handleRegister(this: ITimelineApp, event: Event): Promise<void> {
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
           await handleLogin.call(this, event);
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

export function handleProjectFiles(this: ITimelineApp, files: FileList): void {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    const newFiles = Array.from(files).filter(file => {
        if (allowedTypes.includes(file.type)) {
            return true;
        }
        console.warn(`Skipping unsupported file type: ${file.type}`);
        return false;
    });

    this.projectCreationFiles.push(...newFiles);
    (this as any).renderFilePreviews();
}

export function handlePaste(this: ITimelineApp, event: ClipboardEvent): void {
    const files = event.clipboardData?.files;
    if (files && files.length > 0) {
        handleProjectFiles.call(this, files);
    }
}

export async function handleGenerateClick(this: ITimelineApp): Promise<void> {
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
    if (!projectDescription && this.projectCreationFiles.length === 0) {
      alert("请先阐明您的战略目标或上传相关文件。");
      return;
    }

    this.setState({ isLoading: true, loadingText: "排兵布阵，军令生成中..." });

    try {
      const responseSchema = (this as any).createTimelineSchema();
      const prompt = `${(this as any).getCurrentDateContext()} 为以下项目描述${this.projectCreationFiles.length > 0 ? "和附加文件" : ""}，创建一份详尽的、分阶段的中文项目计划。计划应包含项目名称、阶段、任务及可嵌套的子任务。每个任务需包含：任务名称、状态（'待办'、'进行中'或'已完成'）、优先级（'高'、'中'或'低'）、详情、开始时间、截止日期（格式均为 YYYY-MM-DD HH:mm）、负责人和备注。如果描述或文件中提到了负责人，请将他们的名字放入“负责人”字段。
**极其重要**:
1.  **唯一ID**: 你必须为每一个任务（包括子任务）生成一个在整个项目中唯一的字符串 'id'。
2.  **依赖关系**: 你必须识别任务间的依赖关系。例如，如果“任务B”必须在“任务A”完成后才能开始，你必须将“任务A”的 'id' 添加到“任务B”的 'dependencies' 数组中。
3.  **时间解析**: 如果项目描述或文件中提到了任何日期或时间（例如“下周五截止”、“明天下午3点开始”），你必须基于当前时间上下文，将它们解析为精确的日期和时间，并填入相应的“开始时间”和“截止日期”字段。不要将时间信息遗漏在“详情”字段中。
4.  **文件内容**: 如果提供了文件，你必须仔细分析其内容（图片或文字），并将相关信息提取并整合到项目计划中。

项目描述如下：
---
${projectDescription || "（无文字描述，请主要参考附加文件）"}
---`;
      
      const parts: any[] = [];

      for (const file of this.projectCreationFiles) {
          const base64Data = await blobToBase64(file);
          parts.push({
              inlineData: {
                  mimeType: file.type,
                  data: base64Data
              }
          });
      }

      parts.push({ text: prompt });
      
      const modelName = this.state.chatModel === 'gemini-flash' ? 'gemini-flash-latest' : 'gemini-2.5-pro';

      const response = await this.ai.models.generateContent({
        model: modelName,
        contents: { parts },
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
      
      this.projectCreationFiles = [];
      (this as any).renderFilePreviews();
      
      this.setState({ timeline: savedProject, projectsHistory: newHistory, currentView: 'vertical', chatHistory: [], isChatOpen: false });
    } catch (error) {
      console.error("生成或保存计划时出错：", error);
      alert(getApiErrorMessage(error, "计划生成或保存"));
    } finally {
      this.setState({ isLoading: false });
    }
}

export async function handleRefineProject(this: ITimelineApp): Promise<void> {
    if (!this.state.apiKey) {
        renderUI.showApiKeyModal(this, true);
        alert("请先提供您的 API 密钥。");
        return;
    }
    if (!this.state.timeline) return;

    this.setState({ isLoading: true, loadingText: "AI 正在深度优化项目计划..." });

    try {
        const membersInfo = this.state.allUsers
            .filter(u => this.state.timeline!.members.some(m => m.userId === u.id))
            .map(u => `- ${u.profile.displayName} (ID: ${u.id})`)
            .join('\n');

        const prompt = `
        ${(this as any).getCurrentDateContext()}
        作为一名专家级项目管理AI，你的任务是细致地审查并完善以下项目计划JSON。你的目标是智能地补全所有任务和子任务中缺失或模糊的信息，使计划更完整、更具可执行性。

        可供分配的项目成员:
        ${membersInfo || '无可用成员信息。'}

        **核心指令:**
        1.  **遍历所有任务**: 仔细检查计划中的每一个任务和子任务。
        2.  **智能填补**: 对每个任务，如果某个字段为空、内容宽泛（如“新任务”、“待定”），或缺失，请利用项目的整体上下文、任务依赖和成员列表来推断并补全以下信息：
            *   \`详情\`: 如果为空，请撰写一段简明扼要的任务目标描述。
            *   \`开始时间\` 和 \`截止日期\`: 根据依赖关系和项目整体流程，估算出现实的起止时间，格式为 "YYYY-MM-DD HH:mm"。
            *   \`负责人Ids\`: 根据任务名称和详情，从成员列表中分配合适的成员。请使用他们的用户ID。
            *   \`优先级\`: 根据任务的重要性及其依赖关系，设置“高”、“中”或“低”的优先级。
            *   \`dependencies\`: 重新审视计划，并添加任何你发现的、被遗漏的逻辑依赖关系。
        3.  **保留现有数据**: 这是关键。**不要**更改已经明确、具体定义的数据。你的角色是增强，而不是覆盖。
        4.  **保持结构完整**: **不要**创建新任务、删除现有任务或更改任何已有的任务 \`id\`。项目结构必须保持不变。
        5.  **返回完整计划**: 完成分析后，以指定的JSON格式返回完整、优化后的项目计划。

        以下是需要优化的项目计划:
        ---
        ${JSON.stringify(this.state.timeline)}
        ---`;

        const responseSchema = (this as any).createTimelineSchema();
        const modelName = this.state.chatModel === 'gemini-flash' ? 'gemini-flash-latest' : 'gemini-2.5-pro';
        
        const response = await this.ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema: responseSchema },
        });

        const refinedTimelineData = JSON.parse(response.text);
        
        refinedTimelineData.id = this.state.timeline.id;
        refinedTimelineData.ownerId = this.state.timeline.ownerId;
        refinedTimelineData.members = this.state.timeline.members;

        const finalRefinedTimeline = this.postProcessTimelineData(refinedTimelineData);
        const diff = (this as any).computeTimelineDiff(this.state.timeline!, finalRefinedTimeline);

        if (diff.size > 0) {
            this.setState({
                previousTimelineState: JSON.parse(JSON.stringify(this.state.timeline)), 
            }, false); // Set previous state for potential undo, don't re-render yet
            
            const newHistory = [...this.state.chatHistory, {
                role: 'model' as const,
                text: '我已根据项目全局信息，对计划进行了深度优化。请您审核修改。',
                isProposal: true,
                isModification: true
            }];

            this.setState({
                pendingTimeline: { data: finalRefinedTimeline, diff },
                chatHistory: newHistory,
                isChatOpen: true
            });
        } else {
            alert("AI分析后未发现可优化的内容。");
        }

    } catch (error) {
        console.error("深度优化项目时出错:", error);
        alert(getApiErrorMessage(error, "项目优化"));
    } finally {
        this.setState({ isLoading: false });
    }
}

export async function handleSyncWeeklyProgress(this: ITimelineApp): Promise<void> {
    if (!this.state.apiKey) {
        renderUI.showApiKeyModal(this, true);
        alert("请先提供您的 API 密钥。");
        return;
    }
    if (!this.state.timeline) return;

    const tasksWithComments: { task: 任务; path: string[] }[] = [];
    for (const item of this.flattenTasks()) {
        if (item.task.讨论 && item.task.讨论.length > 0) {
            const taskCopy = JSON.parse(JSON.stringify(item.task));
            if (taskCopy.讨论) {
                taskCopy.讨论.forEach((c: any) => delete c.attachments);
            }
            tasksWithComments.push({ task: taskCopy, path: item.path });
        }
    }

    if (tasksWithComments.length === 0) {
        alert("没有找到需要同步进度的评论。");
        return;
    }

    this.setState({ isLoading: true, loadingText: "正在整合周进度汇报..." });

    try {
        const today = new Date();
        const updateSchema = {
            type: Type.OBJECT,
            properties: {
                状态: { type: Type.STRING, enum: ['待办', '进行中', '已完成'], description: "The new status of the task." },
                详情: { type: Type.STRING, description: "The full, updated details of the task, appending the new progress." },
                截止日期: { type: Type.STRING, description: "The new deadline in 'YYYY-MM-DD HH:mm' format." },
            },
        };

        const changeSchema = {
            type: Type.OBJECT,
            properties: {
                taskId: { type: Type.STRING, description: "The unique ID of the task to be updated." },
                updates: { ...updateSchema, description: "An object containing the fields to update." },
                commentIdsToDelete: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "An array of comment IDs that were identified as progress reports and should be deleted."
                }
            },
            required: ["taskId"],
        };

        const responseSchema = {
            type: Type.OBJECT,
            properties: {
                changes: {
                    type: Type.ARRAY,
                    items: changeSchema
                }
            },
            required: ["changes"]
        };

        const prompt = `
        ${(this as any).getCurrentDateContext()}
        As an expert project management AI, your task is to process weekly progress reports from comments and intelligently update the associated tasks. I will provide you with a JSON array of tasks that contain discussion comments.

        **The Goal:**
        Transform the task's '详情' (details) field into a structured, clear, and actionable summary. Instead of just appending text, you will rewrite the '详情' to maintain distinct sections for the task's core objective, completed work, and future plans.

        **Core Instructions:**
        1.  **Analyze Comments**: For each task, review its '讨论' (discussion) array to identify comments that are progress reports (e.g., containing "progress report," "summary," "completed," "update," etc.).
        2.  **Structure the '详情' Field**: You must rewrite the entire '详情' field for each updated task to follow this specific Markdown format:
            ---
            **[原始任务目标 - This should be a concise summary of the original task goal, preserved from the existing details]**

            ---
            **✅ 已完成事项:**
            *   [List of completed items. Move items from the old '下一步计划' here if the comments indicate they are done.]
            *   [Summarize any newly completed items from the comments here.]

            **下一步计划:**
            *   [List of remaining to-do items from the old '下一步计划'.]
            *   [Add any new action items or next steps identified from the comments here.]
            ---

        3.  **Determine Updates based on Comments**:
            *   **Status Update**: If a report indicates the entire task is finished, the new status should be '已完成'. Otherwise, if work has been done, it should be '进行中'.
            *   **Details Rewrite**: Analyze both the existing '详情' and the new comments.
                *   Preserve the original task objective.
                *   Identify completed work from the comments and the old '下一步计划'. Move/add these to the '✅ 已完成事项' list.
                *   Identify remaining or new action items. List them under '下一步计划'.
                *   Return the *entire*, rewritten '详情' field in the structured Markdown format above.
            *   **Deadline Update**: If a report mentions a new deadline, parse it based on the current time context and update the '截止日期' (deadline) to 'YYYY-MM-DD HH:mm' format.
        4.  **Identify Comments for Deletion**: List the IDs of only the comments you processed as progress reports. Do not delete normal questions or discussions.
        5.  **Format Response**: Respond with a single JSON object containing a "changes" array. Each element should correspond to a task that needs updates, specifying the \`taskId\`, the \`updates\` object, and the \`commentIdsToDelete\` array. If a task requires no changes, do not include it.

        Here are the tasks and their comments to analyze:
        ---
        ${JSON.stringify(tasksWithComments, null, 2)}
        ---
        `;
        
        const modelName = 'gemini-2.5-pro';

        const response = await this.ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: { responseMimeType: "application/json", responseSchema },
        });
        
        const result = JSON.parse(response.text);
        if (result.changes && Array.isArray(result.changes)) {
            const updatedTimeline = JSON.parse(JSON.stringify(this.state.timeline));
            const allTasksMap = new Map();
            const flattenForUpdate = (tasks: 任务[]) => {
                if (!tasks) return;
                tasks.forEach(task => {
                    allTasksMap.set(task.id, task);
                    if (task.子任务) flattenForUpdate(task.子任务);
                });
            };
            updatedTimeline.阶段.forEach((phase: any) => {
                if(phase.任务) flattenForUpdate(phase.任务);
                if(phase.项目) phase.项目.forEach((proj: any) => flattenForUpdate(proj.任务));
            });

            let changesApplied = false;
            for (const change of result.changes) {
                const taskToUpdate = allTasksMap.get(change.taskId);
                if (taskToUpdate) {
                    changesApplied = true;
                    if (change.updates) {
                        Object.assign(taskToUpdate, change.updates);
                        if (change.updates.状态 === '已完成') {
                            taskToUpdate.已完成 = true;
                        }
                    }
                    if (change.commentIdsToDelete && taskToUpdate.讨论) {
                        taskToUpdate.讨论 = taskToUpdate.讨论.filter((c: any) => !change.commentIdsToDelete.includes(c.id));
                    }
                }
            }

            if (changesApplied) {
                this.setState({ timeline: updatedTimeline });
                await this.saveCurrentProject(updatedTimeline);
            } else {
                alert("AI分析完成，未发现可同步的进度更新。");
            }
        }

    } catch (error) {
        console.error("同步周进度时出错:", error);
        alert(getApiErrorMessage(error, "同步周进度"));
        throw error;
    } finally {
        this.setState({ isLoading: false });
    }
}

export function handleClearClick(this: ITimelineApp): void {
    this.setState({ timeline: null, chatHistory: [], isChatOpen: false, collapsedItems: new Set(), previousTimelineState: null, pendingTimeline: null });
}

export function handleExportClick(this: ITimelineApp): void {
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

export function handleImport(this: ITimelineApp, event: Event): void {
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
    // FIX: Corrected typo from readText to readAsText.
    reader.readAsText(file);
    (event.target as HTMLInputElement).value = ''; 
}

export async function handleQuickAddTask(this: ITimelineApp, event: Event): Promise<void> {
    event.preventDefault();
    this.clearUndoState();
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
        const responseSchema = (this as any).createTimelineSchema();
        let additionalInfo = '';
        if (assignee) additionalInfo += `任务的“负责人”应为“${assignee}”。`;
        if (deadline) additionalInfo += `任务的“截止日期”应为“${deadline}”。`;
        const prompt = `${(this as any).getCurrentDateContext()} 作为一名智能项目管理助手，请分析以下项目计划JSON。用户想要添加一个新任务，描述如下：“${taskDescription}”。
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
        const modelName = this.state.chatModel === 'gemini-flash' ? 'gemini-flash-latest' : 'gemini-2.5-pro';
        const response = await this.ai.models.generateContent({
            model: modelName,
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
        alert(getApiErrorMessage(error, "任务追加"));
    } finally {
        this.setState({ isLoading: false });
    }
}

export function handleApiKeySubmit(this: ITimelineApp, event: Event): void {
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

export async function handleGenerateReportClick(this: ITimelineApp, period: 'weekly' | 'monthly', startDate: string, endDate: string): Promise<void> {
    if (!this.state.apiKey) {
        renderUI.showApiKeyModal(this, true);
        alert("请先提供您的 API 密钥。");
        return;
    }
    const reportTitle = period === 'weekly' ? '周报' : '月报';
    renderUI.showReportModal(this, true, '', reportTitle);
    try {
        const periodText = `从 ${startDate} 到 ${endDate}`;
        const nextPeriodText = `未来一周`;
        
        const isOwner = this.state.timeline?.ownerId === this.state.currentUser?.id;
        const currentUser = this.state.currentUser;

        const membersMap = new Map(this.state.allUsers.map(u => [u.id, u.profile.displayName]));
        const membersList = this.state.timeline?.members.map(m => `- ${membersMap.get(m.userId) || '未知成员'} (ID: ${m.userId})`).join('\n') || '无';

        let userContextPrompt = '';
        if (!isOwner && currentUser) {
            userContextPrompt = `\n**CRITICAL**: This report is for a specific team member: ${currentUser.profile.displayName} (ID: ${currentUser.id}). The entire report (progress, accomplishments, risks, next steps) MUST focus exclusively on tasks assigned to this user.\n`;
        }
        
        const prompt = `As a professional project manager AI, analyze the following project plan JSON to generate a concise, structured Chinese project status report for the period **from ${startDate} to ${endDate}**.

**CRITICAL INSTRUCTION ON PERSONNEL IDENTIFICATION:**
You are provided with a list of project members mapping their user ID to their display name. This is the ground truth. In your entire generated report, whenever you refer to a person (e.g., a task assignee), you **MUST** use their display name from this list. It is strictly forbidden to output a raw user ID (e.g., "3", "user-123"). For example, if a task has \`"负责人Ids": ["3"]\` and the list shows ID "3" is "张三", you must write "负责人: 张三".

**Project Members List (ID to Name mapping):**
${membersList}
${userContextPrompt}
The report must follow this structure, including the markdown-style headers:
### 1. 本期总体进度 (Overall Progress This Period)
Summarize the project's health and progress in the period **${periodText}**.
### 2. 本期关键成果 (Key Accomplishments This Period)
List important tasks marked '已完成' during the period **${periodText}**.
### 3. 延期、阻碍与风险 (Delays, Obstacles & Risks)
Identify tasks with a '截止日期' within the period **${periodText}** that are not yet '已完成'. Infer reasons for delay. Highlight obstacles and risks.
### 4. 下期工作计划 (Next Period's Plan)
List key tasks scheduled or due within the **${nextPeriodText}**.

Project data:
---
${JSON.stringify(this.state.timeline, null, 2)}
---
Provide the report in clean, readable markdown format.`;

        const modelName = this.state.chatModel === 'gemini-flash' ? 'gemini-flash-latest' : 'gemini-2.5-pro';
        const response = await this.ai.models.generateContent({
            model: modelName,
            contents: prompt,
        });
        renderUI.showReportModal(this, false, response.text, reportTitle);
    } catch (error) {
        console.error("生成报告时出错:", error);
        const reportTitle = period === 'weekly' ? '周报' : '月报';
        renderUI.showReportModal(this, false, getApiErrorMessage(error, "报告生成"), reportTitle);
    }
}

export function handleGeneratePlanClick(this: ITimelineApp): void {
    if (!this.state.apiKey) {
        renderUI.showApiKeyModal(this, true);
        alert("请先提供您的 API 密钥。");
        return;
    }
    renderUI.showWeeklyPlanAssistantModal(this);
}

export async function executeGeneratePlan(this: ITimelineApp, newTasksText: string, selectedMemberIds: string[], startDate: string, endDate: string): Promise<void> {
    const title = '周度计划';
    this.setState({ isLoading: true, loadingText: "正在为您规划下周的作战部署..." });
    try {
        const allUsersMap = new Map(this.state.allUsers.map(u => [u.id, u.profile.displayName]));
        const selectedMembersInfo = selectedMemberIds.map(id => `- ${allUsersMap.get(id) || `ID: ${id}`}`).join('\n');
        const allMembersListForPrompt = this.state.timeline?.members.map(m => `- ${allUsersMap.get(m.userId) || '未知成员'} (ID: ${m.userId})`).join('\n') || '无';

        const newTasksPromptSection = newTasksText
            ? `**重要新增指令:**
用户为本周提供了以下新的任务和目标。你必须将这些信息智能地整合到生成的计划中，创建新任务条目并分配给合适的负责人。
---
${newTasksText}
---`
            : '';

        const prompt = `
作为一名专家级的项目管理AI，你的任务是根据给定的项目JSON数据，为指定的计划周期（从 ${startDate} 到 ${endDate}）生成一份清晰、可执行的中文周度计划。

**CRITICAL INSTRUCTION ON PERSONNEL IDENTIFICATION:**
You are provided with a list of project members mapping their user ID to their display name. This is your ground truth. In your entire generated plan, whenever you refer to a person, you **MUST** use their display name. It is strictly forbidden to output a raw user ID. For example, if a task has \`"负责人Ids": ["3"]\` and the list shows ID "3" is "张三", you must write "负责人: 张三".

**核心指令:**
1.  **严格筛选负责人**: 这是最重要的指令。生成的计划 **必须只包含** 为以下选定成员分配的任务。计划的主要分组也必须围绕这些成员。
    **选定成员列表:**
    ${selectedMembersInfo}
2.  **处理新增任务**: ${newTasksPromptSection || '（本周无新增任务指令）'}
3.  **聚焦时间范围**: 只分析状态为“待办”或“进行中”，且“开始时间”或“截止日期”在 **${startDate} 和 ${endDate}** 之间的任务。
4.  **使用显示名称**: 再次强调，**绝对不能使用用户 ID**，必须使用显示名称。参考列表如下：
    **项目所有成员参考 (ID to Name mapping):**
    ${allMembersListForPrompt}
5.  **提炼核心目标和具体任务**: 为每个负责人/团队提炼核心目标，并在其下罗列具体任务。
6.  **丰富任务细节**: 在每个具体任务下，用 '■' 补充说明和预期产出。
7.  **强调优先级和截止日期**: 对高优任务标记“(T0级任务)”并注明截止日期。
8.  **严格遵循格式**: 严格模仿示例格式。

**当前项目数据:**
---
${JSON.stringify(this.state.timeline, null, 2)}
---
**【输出格式示例】**
---
${startDate} ~ ${endDate}
A. 邱一波 & 孟源馨 (国赛冲刺与设计团队)
1. 国赛PPT最终冲刺 (T0级任务，10月15日前必须完成)
    ○ 任务1.1 (一波): 全力完成国赛PPT的最终精细打磨。
        ■ 产出: 一份高质量的、已提交的国赛PPT终稿。
B. 张之润 (核心技术攻坚)
1. 采集卡问题进一步研究
    ○ 任务2.1: 对接设计公司。
        ■ 产出: 外部依赖事项的进展更新。
---
请立即开始生成周度计划。`;

        const modelName = this.state.chatModel === 'gemini-flash' ? 'gemini-flash-latest' : 'gemini-2.5-pro';
        const response = await this.ai.models.generateContent({
            model: modelName,
            contents: prompt,
        });
        renderUI.showReportModal(this, false, response.text, title);
    } catch (error) {
        console.error("生成周计划时出错:", error);
        renderUI.showReportModal(this, false, getApiErrorMessage(error, "周计划生成"), title);
    } finally {
        this.setState({ isLoading: false });
    }
}


export function toggleChat(this: ITimelineApp, open: boolean): void {
    this.setState({ isChatOpen: open, editingMessageIndex: null }, false);
    this.chatPanelEl.classList.toggle('open', open);
    this.chatBackdropEl.classList.toggle('hidden', !open);
    if (open) this.chatInputEl.focus();
}

export function autoResizeChatInput(this: ITimelineApp): void {
    this.chatInputEl.style.height = 'auto';
    this.chatInputEl.style.height = `${this.chatInputEl.scrollHeight}px`;
}

export async function handleChatSubmit(this: ITimelineApp, e: Event): Promise<void> {
    e.preventDefault();
    const userInput = this.chatInputEl.value.trim();
    const attachment = this.state.chatAttachment;
    if (!userInput && !attachment) return;

    this.chatInputEl.value = '';
    autoResizeChatInput.call(this);

    const newUserMessage: ChatMessage = {
        role: 'user',
        text: userInput,
        attachment: attachment ? { dataUrl: attachment.dataUrl, mimeType: attachment.mimeType } : undefined
    };
    
    const newHistory = [...this.state.chatHistory, newUserMessage];
    this.setState({ 
        isChatLoading: true, 
        lastUserMessage: newUserMessage, 
        chatHistory: newHistory,
        chatAttachment: null 
    });
    
    await submitChat.call(this, newUserMessage, newHistory);
}

export async function submitChat(this: ITimelineApp, userMessage: ChatMessage, currentChatHistory: ChatMessage[]): Promise<void> {
    if (!this.state.apiKey) {
        renderUI.showApiKeyModal(this, true);
        alert("请先提供您的 API 密钥。");
        this.setState({ isChatLoading: false });
        return;
    }
    
    try {
        const { text: userInput, attachment } = userMessage;
        const isQuestion = /^(谁|什么|哪里|何时|为何|如何|是|做|能)\b/i.test(userInput) || userInput.endsWith('？') || userInput.endsWith('?');
        const modelName = this.state.chatModel === 'gemini-flash' ? 'gemini-flash-latest' : 'gemini-2.5-pro';
        
        if (isQuestion && !attachment) { // Simple Q&A, no attachment
            const response = await this.ai.models.generateContent({
                model: modelName,
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
            const finalHistory = [...currentChatHistory, { role: 'model' as const, text: response.text, sources }];
            this.setState({ chatHistory: finalHistory });

        } else { // It's a command, a question with an attachment, or a statement with an attachment
            if (!this.canEditProject()) {
                const errorHistory = [...currentChatHistory, { role: 'model' as const, text: "抱歉，您没有修改此项目的权限。" }];
                this.setState({ chatHistory: errorHistory });
                return;
            }
            const responseSchema = {
                type: Type.OBJECT,
                properties: {
                    responseText: { type: Type.STRING, description: "用中文对用户的请求进行友好、确认性的回应。如果无法执行操作，请解释原因。" },
                    didModify: { type: Type.BOOLEAN, description: "如果你对项目计划进行了任何修改（增、删、改），则设为 true。如果你只是回答问题而未作修改，则设为 false。" },
                    updatedTimeline: (this as any).createTimelineSchema(),
                },
                required: ["responseText", "didModify", "updatedTimeline"],
            };

            const promptText = `${(this as any).getCurrentDateContext()} 作为一名高级项目管理AI助手，请根据用户的自然语言请求${attachment ? "和附加文件" : ""}，智能地修改提供的项目计划JSON。
**重要原则**: 请在保留原始计划所有结构、ID和未更改内容的基础上，只进行最小化、最精准的修改。不要重新生成或改变与用户请求不相关的任务或ID。
您的任务是：
1.  **解析意图**：深入理解用户的请求，这可能包括任务的新增、查询、状态更新（例如，“我做完了方案设计”），日期调整（“把EDC系统交付推迟2天”），甚至是删除（“取消那个市场调研任务”）。
2.  **精确时间**：当用户提到相对时间（如“推迟2天”、“明天中午12点”），你必须根据当前时间上下文计算出精确的“YYYY-MM-DD HH:mm”格式的时间，并更新相应的“开始时间”或“截止日期”字段。
3.  **智能操作**：
    - **更新**: 根据请求修改任务的字段。
    - **完成**: 当用户表示任务完成时，请将其 '状态' 字段更新为 '已完成'，并设置 '已完成' 字段为 true。如果一个任务的所有子任务都已完成，请考虑将其父任务也标记为 '已完成'。
    - **删除**: 如果用户要求删除任务，请从计划中移除对应的任务对象。
    - **查询**: 如果用户只是提问（例如，“EDC系统交付是什么时候？”），请在 responseText 中回答问题，将 didModify 设为 false，并返回未经修改的原始项目计划。
4.  **返回结果**：返回一个包含三部分的JSON对象：一个是对用户操作的友好中文确认信息（responseText），一个布尔值表明你是否修改了计划（didModify），以及完整更新后的项目计划（updatedTimeline）。请确保整个项目计划被完整返回，而不仅仅是修改的部分。
---
当前项目计划:
${JSON.stringify(this.state.timeline)}
---
用户请求:
"${userInput}"
---`;
            const contents = [];
            if (attachment) {
                contents.push({
                    inlineData: {
                        mimeType: attachment.mimeType,
                        data: attachment.dataUrl.split(',')[1]
                    }
                });
            }
            contents.push({ text: promptText });

            const response = await this.ai.models.generateContent({
                model: modelName,
                contents: { parts: contents },
                config: { responseMimeType: "application/json", responseSchema: responseSchema },
            });

            const result = JSON.parse(response.text);

            if (result.didModify && result.updatedTimeline) {
                const updatedTimelineDataFromAI = result.updatedTimeline;
                updatedTimelineDataFromAI.id = this.state.timeline!.id;
                updatedTimelineDataFromAI.ownerId = this.state.timeline!.ownerId;
                updatedTimelineDataFromAI.members = this.state.timeline!.members;
                const finalUpdatedTimeline = this.postProcessTimelineData(updatedTimelineDataFromAI);

                const diff = (this as any).computeTimelineDiff(this.state.timeline!, finalUpdatedTimeline);

                if (diff.size > 0) {
                    const finalHistory = [...currentChatHistory, { role: 'model' as const, text: result.responseText, isProposal: true }];
                    this.setState({ pendingTimeline: { data: finalUpdatedTimeline, diff }, chatHistory: finalHistory });
                } else {
                    const finalHistory = [...currentChatHistory, { role: 'model' as const, text: result.responseText }];
                    this.setState({ chatHistory: finalHistory });
                }
            } else {
                 const finalHistory = [...currentChatHistory, { role: 'model' as const, text: result.responseText }];
                 this.setState({ chatHistory: finalHistory });
            }
        }
    } catch (error) {
        console.error("智能助理出错:", error);
        const errorHistory = [...currentChatHistory, { role: 'model' as const, text: getApiErrorMessage(error, "智能助理指令处理") }];
        this.setState({ chatHistory: errorHistory });
    } finally {
        this.setState({ isChatLoading: false });
    }
}

function setChatAttachmentFromFile(this: ITimelineApp, file: File): void {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
        alert('不支持的文件类型。请上传图片 (JPG, PNG, WEBP) 或 PDF。');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        this.setState({ chatAttachment: { file, dataUrl, mimeType: file.type } });
    };
    reader.readAsDataURL(file);
}

export function handleFileAttachmentChange(this: ITimelineApp, event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setChatAttachmentFromFile.call(this, file);
    (event.target as HTMLInputElement).value = ''; // Reset input
}

export function handleChatPaste(this: ITimelineApp, event: ClipboardEvent): void {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    const validFile = Array.from(files).find(file => allowedTypes.includes(file.type));

    if (validFile) {
        event.preventDefault(); 
        setChatAttachmentFromFile.call(this, validFile);
    }
}
