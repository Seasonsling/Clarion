import { GoogleGenAI, Type } from "@google/genai";
import type { ChangeOperation, 时间轴数据 } from "./types";

export class GeminiService {
  ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  updateApiKey(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
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

  async generateTimeline(projectDescription: string): Promise<any> {
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
    
    return JSON.parse(response.text);
  }

  async generateReport(timeline: 时间轴数据, period: 'weekly' | 'monthly'): Promise<string> {
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
${JSON.stringify(timeline, null, 2)}
---

Provide the report in a clean, readable format suitable for copying into an email or document. Use markdown for headers.`;

    const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
    });
    return response.text;
  }

  async quickAddTask(projectToUpdate: 时间轴数据, taskDescription: string, assignee: string, deadline: string): Promise<any> {
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
    return JSON.parse(response.text);
  }

  async processChatWithSearch(timeline: 时间轴数据 | null, userInput: string): Promise<{ text: string, sources: any[] }> {
    const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `请根据您的知识和网络搜索结果，用中文回答以下问题。如果问题与提供的项目计划有关，请结合上下文回答。
---
当前项目计划 (上下文参考):
${JSON.stringify(timeline)}
---
用户问题: "${userInput}"`,
        config: { tools: [{ googleSearch: {} }] },
    });
    
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const sources = groundingChunks?.map((chunk: any) => ({
        uri: chunk.web.uri,
        title: chunk.web.title,
    })) || [];

    return { text: response.text, sources };
  }

  async processChatWithModification(timeline: 时间轴数据, userInput: string): Promise<{ responseText: string, changes: ChangeOperation[] }> {
    const pathSchema = {
        type: Type.OBJECT,
        properties: {
            phaseIndex: { type: Type.INTEGER, description: "0-based index of the phase in the `阶段` array." },
            projectIndex: { type: Type.INTEGER, description: "Optional 0-based index for nested projects within a phase's `项目` array." },
            taskPath: { type: Type.ARRAY, items: { type: Type.INTEGER }, description: "0-based path of indices to the target task. For 'add', this path points to the parent task/project/phase." }
        },
        required: ["phaseIndex", "taskPath"]
    };

    const taskSchemaForChanges = this.createTimelineSchema().properties.阶段.items.properties.任务.items;

    const changeOperationSchema = {
        type: Type.OBJECT,
        properties: {
            op: { type: Type.STRING, enum: ["update", "add", "delete"], description: "The operation type." },
            path: pathSchema,
            value: { 
                type: Type.OBJECT, 
                description: "For 'update', a partial task object with fields to change. For 'add', a full new task object. Not used for 'delete'.",
                properties: taskSchemaForChanges.properties // Re-use the properties from the main task schema
            }
        },
        required: ["op", "path"]
    };

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            responseText: { type: Type.STRING, description: "用中文对用户的请求进行友好、确认性的回应。如果无法执行操作，请解释原因。" },
            changes: { type: Type.ARRAY, items: changeOperationSchema, description: "An array of change operations to apply to the timeline." }
        },
        required: ["responseText", "changes"],
    };
    const currentDateContext = this.getCurrentDateContext();

    const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `${currentDateContext} 作为一名高级项目管理AI助手，请根据用户的自然语言请求，智能地修改提供的项目计划JSON。
您的任务是 **生成一个操作指令列表**，而不是返回修改后的整个项目计划。

**输出格式**:
您必须返回一个JSON对象，包含两部分:
1.  \`responseText\`: 一个对用户操作的友好中文确认信息。
2.  \`changes\`: 一个操作指令数组，用于修改项目计划。

**操作指令 (ChangeOperation) 结构**:
每个指令是一个对象，包含:
- \`op\`: 操作类型，可选值为 "update", "add", "delete"。
- \`path\`: 一个指向目标位置的对象，包含:
    - \`phaseIndex\`: 目标所在的'阶段'的索引。
    - \`projectIndex\`: (可选) 如果目标在阶段的内嵌'项目'里，提供该项目的索引。
    - \`taskPath\`: 一个索引数组，指向目标任务。
- \`value\`: 操作所需的数据。

**操作指令详解**:
- **update**: 修改一个已存在的任务。
  - \`path\`: 必须精确指向要修改的任务。例如 \`"taskPath": [0, 1]\` 指向第一个任务的第二个子任务。
  - \`value\`: 一个 **部分任务对象**，只包含需要修改的字段。例如 \`{"状态": "已完成"}\`。
- **add**: 添加一个新任务。
  - \`path\`: 必须指向 **父级**。
    - 如果要添加为子任务，\`taskPath\` 指向父任务。
    - 如果要添加为顶层任务，\`taskPath\` 是一个空数组 \`[]\`。
  - \`value\`: 一个 **完整的、新的任务对象**，必须包含一个新的唯一 \`id\`。
- **delete**: 删除一个任务。
  - \`path\`: 必须精确指向要删除的任务。
  - \`value\`: 此字段不使用。

**重要规则**:
1.  **路径准确性**: 'path' 中的索引必须准确无误。
2.  **时间解析**: 当用户提到相对时间（如“推迟2天”、“明天中午12点”），你必须根据当前时间上下文计算出精确的“YYYY-MM-DD HH:mm”格式的时间，并在 \`value\` 中更新相应的“开始时间”或“截止日期”字段。
3.  **状态同步**: 当更新 \`状态\` 为 '已完成' 时，请同时在 \`value\` 中设置 \`"已完成": true\`。
4.  **查询处理**: 如果用户只是提问（例如，“EDC系统交付是什么时候？”），请在 \`responseText\` 中回答问题，并返回一个空的 \`changes\` 数组 \`[]\`。

---
当前项目计划:
${JSON.stringify(timeline)}
---
用户请求:
"${userInput}"
---`,
        config: { responseMimeType: "application/json", responseSchema: responseSchema },
    });

    const result = JSON.parse(response.text);
    return result;
  }
}