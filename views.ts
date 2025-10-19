import { parseDate, getWeekStartDate } from './utils.js';
import type { ITimelineApp, 阶段, 任务, TopLevelIndices, Indices, CommentAttachment } from './types.js';
import { renderUI } from './ui.js';

const escapeHtml = (unsafe: any) => {
    if (typeof unsafe !== 'string') {
        try {
            const str = JSON.stringify(unsafe, null, 2);
            if (str && str.length > 50) return str.substring(0, 50) + '...';
            return str || '';
        } catch {
            return '';
        }
    }
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function renderVerticalTimeline(app: ITimelineApp, phases: 阶段[]): void {
    const isDiffView = !!app.state.pendingTimeline;
    const canEdit = app.canEditProject(); // This now correctly returns false in diff view

    phases.forEach((phase, phaseIndex) => {
        const phaseId = `phase-${phaseIndex}`;
        const isCollapsed = app.state.collapsedItems.has(phaseId);
        const phaseEl = document.createElement("div");
        phaseEl.className = "phase";
        const phaseHeader = document.createElement('div');
        phaseHeader.className = 'phase-header';
        phaseHeader.innerHTML = `<div class="phase-icon">${phaseIndex + 1}</div>`;
        phaseHeader.appendChild(renderUI.createEditableElement(app, 'h3', phase.阶段名称, { phaseIndex }, '阶段名称'));
        const toggleBtn = document.createElement('button');
        toggleBtn.className = `icon-btn toggle-collapse ${isCollapsed ? 'collapsed' : ''}`;
        toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
        toggleBtn.onclick = () => {
            const newSet = app.state.collapsedItems;
            if (newSet.has(phaseId)) newSet.delete(phaseId);
            else newSet.add(phaseId);
            app.setState({ collapsedItems: newSet });
        };
        phaseHeader.prepend(toggleBtn);
        phaseEl.appendChild(phaseHeader);
        const contentEl = document.createElement('div');
        contentEl.className = `phase-content ${isCollapsed ? 'collapsed' : ''}`;
        if (phase.项目) {
            phase.项目.forEach((project, projectIndex) => {
                const projectEl = document.createElement('div');
                projectEl.className = 'nested-project';
                projectEl.appendChild(renderUI.createEditableElement(app, 'h4', project.项目名称, { phaseIndex, projectIndex }, '项目名称'));
                if(project.备注) {
                    const notesEl = document.createElement('p');
                    notesEl.className = 'nested-project-notes';
                    notesEl.textContent = project.备注;
                    projectEl.appendChild(notesEl);
                }
                projectEl.appendChild(createTasksList(app, project.任务, { phaseIndex, projectIndex }, [], canEdit));
                contentEl.appendChild(projectEl);
            });
        }
        if (phase.任务) contentEl.appendChild(createTasksList(app, phase.任务, { phaseIndex }, [], canEdit));
        phaseEl.appendChild(contentEl);
        app.timelineContainer.appendChild(phaseEl);
    });
}

function triggerCompletionAnimation(taskElement: HTMLElement): void {
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
    }, 1000);
}

function createTasksList(app: ITimelineApp, tasks: 任务[], baseIndices: TopLevelIndices, parentPath: number[], canEdit: boolean): HTMLElement {
    const listContainer = document.createElement('div');
    const tasksList = document.createElement("ul");
    tasksList.className = "tasks-list";
    
    const isDiffView = !!app.state.pendingTimeline;
    const diffMap = app.state.pendingTimeline?.diff;
    const isEditable = canEdit && !isDiffView;

    const processedTasks = app.processTaskArray(tasks);
    
    processedTasks.forEach((task) => {
        const currentPath = [...parentPath, task.originalIndex!];
        const fullIndices: Indices = { ...baseIndices, phaseIndex: baseIndices.phaseIndex!, taskPath: currentPath };
        const taskEl = document.createElement("li");
        
        const taskDiff = diffMap?.get(task.id);
        
        taskEl.className = "task-item";
        if (task.优先级) taskEl.dataset.priority = task.优先级;
        taskEl.classList.toggle("completed", task.已完成);
        taskEl.draggable = isEditable;

        if (taskDiff?.status === 'added') taskEl.classList.add('diff-added');
        if (taskDiff?.status === 'modified') taskEl.classList.add('diff-modified');

        if (isEditable) {
            taskEl.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                taskEl.classList.add('dragging');
                e.dataTransfer!.setData('application/json', JSON.stringify(fullIndices));
                e.dataTransfer!.effectAllowed = 'move';
            });
            taskEl.addEventListener('dragend', (e) => {
                e.stopPropagation();
                taskEl.classList.remove('dragging');
                document.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
            });
            taskEl.addEventListener('dragover', (e) => {
                e.preventDefault(); e.stopPropagation();
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
            taskEl.addEventListener('dragleave', (e) => { e.stopPropagation(); taskEl.classList.remove('drag-over-top', 'drag-over-bottom'); });
            taskEl.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation();
                const position = taskEl.classList.contains('drag-over-top') ? 'before' : 'after';
                taskEl.classList.remove('drag-over-top', 'drag-over-bottom');
                try {
                    const draggedIndices: Indices = JSON.parse(e.dataTransfer!.getData('application/json'));
                    (app as any).handleMoveTask(draggedIndices, fullIndices, position);
                } catch (err) { console.error("Drop failed:", err); }
            });
        }
        
        const taskHeader = document.createElement('div');
        taskHeader.className = 'task-header';
        const taskMain = document.createElement('div');
        taskMain.className = 'task-main';
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = task.已完成;
        checkbox.disabled = !isEditable;
        checkbox.addEventListener('change', (e) => {
            const isChecked = (e.target as HTMLInputElement).checked;
            app.handleToggleComplete(fullIndices, isChecked);
            if (isChecked) triggerCompletionAnimation(taskEl);
        });
        taskMain.appendChild(checkbox);
        
        const label = document.createElement('label');
        const nameChange = taskDiff?.changes?.['任务名称'];
        label.innerHTML = nameChange ? `<span class="field-changed" title="之前: ${escapeHtml(nameChange.from)}">${escapeHtml(task.任务名称)}</span>` : escapeHtml(task.任务名称);
        taskMain.appendChild(label);
        taskHeader.appendChild(taskMain);
        
        const taskActions = document.createElement('div');
        taskActions.className = 'task-actions';
        const statusMap: {[key: string]: string} = { '待办': 'todo', '进行中': 'inprogress', '已完成': 'completed'};
        const statusChange = taskDiff?.changes?.['状态'];
        const statusHTML = statusChange ? `<span class="field-changed" title="之前: ${escapeHtml(statusChange.from)}">${escapeHtml(task.状态)}</span>` : escapeHtml(task.状态);
        taskActions.innerHTML = `<span class="status-tag status-${statusMap[task.状态] || 'todo'}">${statusHTML}</span>`;
        
        if (isEditable) {
            const addSubtaskBtn = document.createElement('button');
            addSubtaskBtn.className = 'icon-btn';
            addSubtaskBtn.title = '添加子任务';
            addSubtaskBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
            addSubtaskBtn.onclick = () => app.handleAddTask(baseIndices, currentPath);
            taskActions.appendChild(addSubtaskBtn);
        }
        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn';
        editBtn.title = '编辑/查看任务';
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
        editBtn.onclick = () => app.showEditModal(fullIndices, task);
        taskActions.appendChild(editBtn);
        if (isEditable) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'icon-btn delete-btn';
            deleteBtn.title = '删除任务';
            deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
            deleteBtn.onclick = () => app.handleDeleteTask(fullIndices);
            taskActions.appendChild(deleteBtn);
        }
        taskHeader.appendChild(taskActions);
        taskEl.appendChild(taskHeader);

        const taskBody = document.createElement('div');
        taskBody.className = 'task-body';
        
        const renderField = (currentValue: any, fieldName: keyof 任务, element: 'p' | 'div', className: string, titlePrefix = '') => {
            if (!currentValue && typeof currentValue !== 'boolean') return null;
            const el = document.createElement(element);
            el.className = className;
            const change = taskDiff?.changes?.[fieldName];
            const escapedValue = escapeHtml(currentValue);
            const escapedOldValue = change ? escapeHtml(change.from) : '';
            
            let content = '';
            if (Array.isArray(currentValue)) {
                if (currentValue.length === 0) return null;
                if (fieldName === '负责人Ids') {
                    content = currentValue.map(id => renderUI.renderUserAvatar(app, id)).join('');
                    el.classList.add('assignee-avatars');
                } else {
                    content = currentValue.join(', ');
                }
            } else {
                content = escapedValue;
            }

            el.innerHTML = change
                ? `<span class="field-changed" title="之前: ${escapedOldValue}">${titlePrefix}${content}</span>`
                : `${titlePrefix}${content}`;

            return el;
        };
        
        const detailsEl = renderField(task.详情, '详情', 'p', 'task-details');
        if (detailsEl) taskBody.appendChild(detailsEl);
        
        const metaEl = document.createElement('div');
        metaEl.className = 'task-meta';

        let dateText = '';
        if (task.开始时间) dateText += `⏱️ ${task.开始时间}`;
        if (task.开始时间 && task.截止日期) dateText += ' → ';
        if (task.截止日期) dateText += `🏁 ${task.截止日期}`;
        
        if (dateText) {
            const dateSpan = document.createElement('span');
            const startTimeChange = taskDiff?.changes?.['开始时间'];
            const deadlineChange = taskDiff?.changes?.['截止日期'];
            if(startTimeChange || deadlineChange) {
                 const oldDateText = `之前: ${startTimeChange ? `⏱️ ${escapeHtml(startTimeChange.from)}` : `⏱️ ${escapeHtml(task.开始时间)}`} → ${deadlineChange ? `🏁 ${escapeHtml(deadlineChange.from)}` : `🏁 ${escapeHtml(task.截止日期)}`}`;
                 dateSpan.innerHTML = `<span class="field-changed" title="${oldDateText}">${dateText}</span>`;
            } else {
                dateSpan.textContent = dateText;
            }
            metaEl.appendChild(dateSpan);
        }

        const assigneesEl = renderField(task.负责人Ids, '负责人Ids', 'div', '');
        if (assigneesEl) metaEl.appendChild(assigneesEl);

        if (metaEl.hasChildNodes()) taskBody.appendChild(metaEl);
        
        const notesEl = renderField(task.备注, '备注', 'p', 'task-notes', '备注: ');
        if (notesEl) taskBody.appendChild(notesEl);
        
        if (taskBody.hasChildNodes()) taskEl.appendChild(taskBody);
        
        taskEl.appendChild(createDiscussionElement(app, task, fullIndices, isEditable));
        
        if (task.子任务 && task.子任务.length > 0) taskEl.appendChild(createTasksList(app, task.子任务, baseIndices, currentPath, canEdit));
        
        tasksList.appendChild(taskEl);
    });

    listContainer.appendChild(tasksList);
    if (isEditable) {
        const addBtn = document.createElement('button');
        addBtn.className = 'add-task-btn';
        addBtn.textContent = '+ 添加任务';
        addBtn.onclick = () => app.handleAddTask(baseIndices, parentPath);
        listContainer.appendChild(addBtn);
    }
    return listContainer;
}


function createDiscussionElement(app: ITimelineApp, task: 任务, indices: Indices, isEditable: boolean): HTMLElement {
    const discussionContainer = document.createElement('div');
    discussionContainer.className = 'task-discussion';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'task-discussion-toggle active';
    toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> <span>${task.讨论?.length || 0} 条讨论</span>`;

    const discussionArea = document.createElement('div');
    discussionArea.className = 'task-discussion-area';
    discussionArea.id = `discussion-area-${task.id}`;

    renderDiscussionContent(app, discussionArea, task, indices, isEditable);

    toggleBtn.onclick = () => {
        discussionArea.classList.toggle('hidden');
        toggleBtn.classList.toggle('active');
    };

    discussionContainer.appendChild(toggleBtn);
    discussionContainer.appendChild(discussionArea);
    return discussionContainer;
}

function renderDiscussionContent(app: ITimelineApp, container: HTMLElement, task: 任务, indices: Indices, isEditable: boolean) {
    container.innerHTML = ''; // Clear previous content

    // 1. Render existing comments
    const commentsList = document.createElement('ul');
    commentsList.className = 'comments-list';
    (task.讨论 || []).forEach(comment => {
        commentsList.appendChild(createCommentItem(app, comment, indices, isEditable));
    });
    container.appendChild(commentsList);

    // 2. Render new comment form
    container.appendChild(createNewCommentForm(app, task, indices, isEditable));
}

function createCommentItem(app: ITimelineApp, comment: any, indices: Indices, isEditable: boolean): HTMLLIElement {
    const user = app.state.allUsers.find(u => u.id === comment.发言人Id);
    const commentItem = document.createElement('li');
    commentItem.className = 'comment-item';
    const isOwner = app.state.currentUser?.id === comment.发言人Id;

    const commentHeader = document.createElement('div');
    commentHeader.className = 'comment-header';
    commentHeader.innerHTML = `${renderUI.renderUserAvatar(app, comment.发言人Id)}<strong class="comment-author">${escapeHtml(user?.profile.displayName || '未知用户')}</strong><span class="comment-timestamp">${new Date(comment.时间戳).toLocaleString()}</span>`;

    const commentBody = document.createElement('div');
    commentBody.className = 'comment-body';

    const renderBodyContent = () => {
        commentBody.innerHTML = ''; // Clear for redraw
        const commentContent = document.createElement('div');
        commentContent.className = 'comment-content';
        const formattedContent = escapeHtml(comment.内容)
            .replace(/@([^\s@]+)/g, '<span class="mention">@$1</span>');
        commentContent.innerHTML = formattedContent;
        commentBody.appendChild(commentContent);

        if (comment.attachments && comment.attachments.length > 0) {
            const attachmentsContainer = document.createElement('div');
            attachmentsContainer.className = 'comment-attachments';
            comment.attachments.forEach((att: CommentAttachment) => {
                const isImage = att.mimeType.startsWith('image/');
                const attEl = document.createElement('a');
                attEl.href = att.url;
                attEl.target = '_blank';
                attEl.rel = 'noopener noreferrer';
                attEl.className = `attachment-item ${isImage ? 'image-attachment' : ''}`;
                attEl.title = escapeHtml(att.name);
                attEl.innerHTML = `
                    ${isImage ? `<img src="${att.url}" alt="Attachment thumbnail">` : `<svg class="file-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`}
                    <span>${escapeHtml(att.name)}</span>
                `;
                attachmentsContainer.appendChild(attEl);
            });
            commentBody.appendChild(attachmentsContainer);
        }
    };

    renderBodyContent();

    if (isOwner && isEditable) {
        const actions = document.createElement('div');
        actions.className = 'comment-actions';
        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn edit-comment-btn';
        editBtn.title = '编辑';
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
        actions.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn delete-comment-btn';
        deleteBtn.title = '删除';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
        actions.appendChild(deleteBtn);

        deleteBtn.onclick = () => app.handleDeleteComment(indices, comment.id);

        editBtn.onclick = () => {
            commentBody.classList.add('hidden');
            actions.classList.add('hidden');
            
            const editForm = document.createElement('form');
            editForm.className = 'comment-edit-form';
            const textarea = document.createElement('textarea');
            textarea.value = comment.内容;
            
            const editActions = document.createElement('div');
            editActions.className = 'comment-edit-actions';
            
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'secondary-btn';
            cancelBtn.textContent = '取消';
            
            const saveBtn = document.createElement('button');
            saveBtn.type = 'submit';
            saveBtn.className = 'primary-btn';
            saveBtn.textContent = '保存';
            
            editActions.append(cancelBtn, saveBtn);
            editForm.append(textarea, editActions);
            commentItem.appendChild(editForm);
            textarea.focus();

            cancelBtn.onclick = () => {
                editForm.remove();
                commentBody.classList.remove('hidden');
                actions.classList.remove('hidden');
            };

            editForm.onsubmit = (e) => {
                e.preventDefault();
                const newContent = textarea.value.trim();
                if (newContent) {
                    app.handleEditComment(indices, comment.id, newContent);
                }
                // The re-render from setState will handle removing the form
            };
        };

        commentHeader.appendChild(actions);
    }
    
    commentItem.append(commentHeader, commentBody);
    return commentItem;
}

function createNewCommentForm(app: ITimelineApp, task: 任务, indices: Indices, isEditable: boolean): HTMLFormElement {
    const newCommentForm = document.createElement('form');
    newCommentForm.className = 'new-comment-form';
    newCommentForm.innerHTML = renderUI.renderUserAvatar(app, app.state.currentUser!.id);

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'comment-input-wrapper';
    
    const attachmentsPreview = document.createElement('div');
    attachmentsPreview.className = 'comment-attachments-preview';

    const renderPreviews = () => {
        attachmentsPreview.innerHTML = '';
        const files = app.commentAttachments.get(task.id) || [];
        if (files.length > 0) {
            files.forEach((file, index) => {
                const item = document.createElement('div');
                item.className = 'attachment-preview-item';
                item.innerHTML = `<span>${escapeHtml(file.name)}</span><button type="button" class="remove-preview-btn">&times;</button>`;
                item.querySelector('.remove-preview-btn')!.addEventListener('click', () => {
                    files.splice(index, 1);
                    app.commentAttachments.set(task.id, files);
                    renderPreviews();
                });
                attachmentsPreview.appendChild(item);
            });
        }
    };

    const textarea = document.createElement('textarea');
    textarea.placeholder = '添加评论... (@提及成员)';
    textarea.rows = 1;
    textarea.addEventListener('input', function() { this.style.height = 'auto'; this.style.height = this.scrollHeight + 'px'; });

    const formActions = document.createElement('div');
    formActions.className = 'comment-form-actions';
    const attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'icon-btn';
    attachBtn.title = 'Attach file';
    attachBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.className = 'hidden';
    attachBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => {
        if (fileInput.files) {
            const currentFiles = app.commentAttachments.get(task.id) || [];
            app.commentAttachments.set(task.id, [...currentFiles, ...Array.from(fileInput.files)]);
            renderPreviews();
        }
        fileInput.value = ''; // Reset for next selection
    };

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'primary-btn';
    submitBtn.textContent = '发布';
    
    formActions.append(attachBtn, fileInput, submitBtn);
    inputWrapper.append(attachmentsPreview, textarea, formActions);
    newCommentForm.appendChild(inputWrapper);

    if (!isEditable) {
        textarea.disabled = true;
        submitBtn.disabled = true;
        attachBtn.disabled = true;
    }

    newCommentForm.onsubmit = (e) => {
        e.preventDefault();
        const content = textarea.value;
        const attachments = app.commentAttachments.get(task.id) || [];
        if (content.trim() || attachments.length > 0) {
            app.handleAddComment(indices, content);
            textarea.value = '';
            textarea.style.height = 'auto';
            // The re-render will clear the previews.
        }
    };

    return newCommentForm;
}

function renderGanttChart(app: ITimelineApp): void {
    app.timelineContainer.onwheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
            e.preventDefault();
            const newZoom = app.state.ganttZoomLevel + (e.deltaY > 0 ? -10 : 10);
            app.setState({ ganttZoomLevel: Math.max(10, Math.min(200, newZoom)) });
        }
    };

    const tasksWithDates = app.getProcessedTasks().filter(t => t.task.开始时间);
    if (tasksWithDates.length === 0) {
        app.timelineContainer.innerHTML = `<p>没有符合筛选条件或带有开始日期的任务可供显示。</p>`;
        return;
    }

    const dates = tasksWithDates.flatMap(t => [parseDate(t.task.开始时间), parseDate(t.task.截止日期)]).filter((d): d is Date => d !== null);
    if (dates.length === 0) {
        app.timelineContainer.innerHTML = `<p>没有带日期的任务可供显示。</p>`;
        return;
    }

    const { ganttGranularity: granularity, ganttZoomLevel } = app.state;
    
    // Determine the timeline boundaries
    let minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    let maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

    // Timeline headers
    const mainHeaderUnits: { label: string, span: number }[] = [];
    const subHeaderUnits: { label: string, isWeekend?: boolean }[] = [];
    
    const timeDiff = (d1: Date, d2: Date, unit: 'day' | 'week' | 'month') => {
        const d1UTC = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
        const d2UTC = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
        if (unit === 'day') return Math.floor((d1UTC - d2UTC) / 86400000);
        if (unit === 'week') return Math.floor((d1UTC - d2UTC) / (86400000 * 7));
        return (d1.getFullYear() - d2.getFullYear()) * 12 + d1.getMonth() - d2.getMonth();
    };

    if (granularity === 'days') {
        minDate.setDate(minDate.getDate() - 3);
        maxDate.setDate(maxDate.getDate() + 5);
        let currentMonth = '';
        for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 1)) {
            const monthLabel = `${d.getFullYear()}年 ${d.getMonth() + 1}月`;
            if (monthLabel !== currentMonth) {
                mainHeaderUnits.push({ label: monthLabel, span: 1 });
                currentMonth = monthLabel;
            } else {
                mainHeaderUnits[mainHeaderUnits.length - 1].span++;
            }
            subHeaderUnits.push({ label: `${d.getDate()}`, isWeekend: d.getDay() === 0 || d.getDay() === 6 });
        }
    } else if (granularity === 'weeks') {
        minDate = getWeekStartDate(minDate);
        minDate.setDate(minDate.getDate() - 7);
        maxDate.setDate(maxDate.getDate() + 14);
        let currentYear = '';
        for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 7)) {
            const yearLabel = `${d.getFullYear()}年`;
            if(yearLabel !== currentYear) {
                mainHeaderUnits.push({label: yearLabel, span: 1});
                currentYear = yearLabel;
            } else {
                mainHeaderUnits[mainHeaderUnits.length - 1].span++;
            }
            subHeaderUnits.push({ label: `${d.getMonth() + 1}/${d.getDate()}` });
        }
    } else { // months
        minDate.setDate(1); minDate.setMonth(minDate.getMonth() - 1);
        maxDate.setMonth(maxDate.getMonth() + 2); maxDate.setDate(1);
        let currentYear = '';
         for (let d = new Date(minDate); d < maxDate; d.setMonth(d.getMonth() + 1)) {
            const yearLabel = `${d.getFullYear()}年`;
            if (yearLabel !== currentYear) {
                mainHeaderUnits.push({ label: yearLabel, span: 1 });
                currentYear = yearLabel;
            } else {
                mainHeaderUnits[mainHeaderUnits.length - 1].span++;
            }
            subHeaderUnits.push({ label: `${d.getMonth() + 1}月` });
        }
    }
    
    const totalUnits = subHeaderUnits.length;
    if (totalUnits > 1500) { app.timelineContainer.innerHTML = `<p>日期范围过大，请尝试使用更粗的时间粒度（周/月）。</p>`; return; }
    
    const gridColWidth = `${Math.max(ganttZoomLevel, 10)}px`;
    const container = document.createElement('div');
    container.className = 'gantt-container';
    container.style.gridTemplateColumns = `minmax(250px, 1.5fr) minmax(${totalUnits * ganttZoomLevel}px, 5fr)`;
    
    const header = document.createElement('div');
    header.className = 'gantt-header';
    header.innerHTML = `<div class="gantt-header-title">任务层级</div><div class="gantt-header-timeline" style="grid-template-columns: repeat(${totalUnits}, ${gridColWidth});"><div class="gantt-header-months">${mainHeaderUnits.map(u => `<div style="grid-column: span ${u.span}">${u.label}</div>`).join('')}</div><div class="gantt-header-days">${subHeaderUnits.map(u => `<div class="${u.isWeekend ? 'weekend' : ''}">${u.label}</div>`).join('')}</div></div>`;
    
    const body = document.createElement('div');
    body.className = 'gantt-body';
    const taskListContainer = document.createElement('div');
    taskListContainer.className = 'gantt-body-tasks';
    const barsContainer = document.createElement('div');
    barsContainer.className = 'gantt-body-bars';
    barsContainer.style.gridTemplateColumns = `repeat(${totalUnits}, ${gridColWidth})`;
    
    tasksWithDates.forEach(({ task, indices }) => {
        const titleEl = document.createElement('div');
        titleEl.className = 'gantt-task-title';
        titleEl.textContent = task.任务名称;
        titleEl.style.paddingLeft = `${1 + (indices.taskPath.length - 1) * 1.5}rem`;
        taskListContainer.appendChild(titleEl);
        
        const start = parseDate(task.开始时间);
        if (start) {
            const endOrDefault = parseDate(task.截止日期) || new Date(start.getTime() + (granularity === 'days' ? 86400000 : 0));
            
            let startUnit = 0, endUnit = 0;

            if (granularity === 'days') {
                startUnit = timeDiff(start, minDate, 'day');
                endUnit = timeDiff(endOrDefault, minDate, 'day');
            } else if (granularity === 'weeks') {
                startUnit = timeDiff(getWeekStartDate(start), minDate, 'week');
                endUnit = timeDiff(getWeekStartDate(endOrDefault), minDate, 'week');
            } else { // months
                startUnit = timeDiff(start, minDate, 'month');
                endUnit = timeDiff(endOrDefault, minDate, 'month');
            }
            const duration = Math.max(1, endUnit - startUnit);

            if (startUnit < totalUnits && startUnit + duration > 0) {
                 const statusClass = { '待办': 'todo', '进行中': 'inprogress', '已完成': 'completed' }[task.状态] || 'todo';
                 const bar = document.createElement('div');
                 bar.className = `gantt-bar gantt-bar-${statusClass}`;
                 bar.style.gridColumn = `${Math.max(1, startUnit + 1)} / span ${duration}`;
                 bar.title = `${task.任务名称} (${task.状态})`;
                 bar.innerHTML = `<span>${task.任务名称}</span>`;
                 bar.addEventListener('click', () => {
                     const taskData = app.getTaskFromPath(indices)?.task;
                     if (taskData) app.showEditModal(indices, taskData);
                 });
                 barsContainer.appendChild(bar);
            } else {
                 barsContainer.appendChild(document.createElement('div'));
            }
        } else {
            barsContainer.appendChild(document.createElement('div'));
        }
    });

    body.appendChild(taskListContainer);
    body.appendChild(barsContainer);
    container.appendChild(header);
    container.appendChild(body);
    app.timelineContainer.innerHTML = '';
    app.timelineContainer.appendChild(container);
}

function renderKanban(app: ITimelineApp): void {
    const statuses: ['待办', '进行中', '已完成'] = ['待办', '进行中', '已完成'];
    const board = document.createElement('div');
    board.className = 'kanban-board';
    const tasksByStatus: Record<string, any[]> = { '待办': [], '进行中': [], '已完成': [] };
    for (const item of app.getProcessedTasks()) tasksByStatus[item.task.状态].push(item);
    statuses.forEach(status => {
        const column = document.createElement('div');
        column.className = 'kanban-column';
        column.dataset.status = status;
        column.innerHTML = `<div class="kanban-column-header"><h3>${status}</h3><span class="task-count">${tasksByStatus[status].length}</span></div>`;
        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'kanban-cards';
        tasksByStatus[status].forEach(({task, indices, path}) => {
            const card = document.createElement('div');
            card.className = 'kanban-card';
            card.classList.toggle('completed', task.已完成);
            let assigneesHTML = '';
            if (task.负责人Ids && task.负责人Ids.length > 0) {
                assigneesHTML = `<div class="assignee-avatars">${task.负责人Ids.map((id: string) => renderUI.renderUserAvatar(app, id)).join('')}</div>`;
            }
            card.innerHTML = `<div class="kanban-card-path">${path.join(' > ')}</div><h4>${task.任务名称}</h4><div class="kanban-card-footer">${task.截止日期 ? `<span class="kanban-card-meta">🏁 ${task.截止日期}</span>` : ''}${assigneesHTML}</div>`;
            card.onclick = () => app.showEditModal(indices, task);
            cardsContainer.appendChild(card);
        });
        column.appendChild(cardsContainer);
        board.appendChild(column);
    });
    app.timelineContainer.appendChild(board);
}

function createCalendarEvent(app: ITimelineApp, task: 任务, indices: Indices, type: 'start' | 'end'): HTMLElement {
    const eventEl = document.createElement('div');
    eventEl.className = `calendar-event calendar-event-${type}`;
    eventEl.textContent = task.任务名称;
    eventEl.title = task.任务名称;
    eventEl.onclick = () => app.showEditModal(indices, task);
    return eventEl;
}

function renderCalendar(app: ITimelineApp): void {
    const { calendarDate: date } = app.state;
    const year = date.getFullYear(), month = date.getMonth();
    const container = document.createElement('div');
    container.className = 'calendar-view';
    container.innerHTML = `<div class="calendar-header"><button id="prev-month" class="secondary-btn"><</button><h3>${year}年 ${month + 1}月</h3><button id="next-month" class="secondary-btn">></button></div>`;
    container.querySelector('#prev-month')!.addEventListener('click', () => app.setState({ calendarDate: new Date(year, month - 1, 1) }));
    container.querySelector('#next-month')!.addEventListener('click', () => app.setState({ calendarDate: new Date(year, month + 1, 1) }));
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    ['日', '一', '二', '三', '四', '五', '六'].forEach(day => grid.innerHTML += `<div class="calendar-weekday">${day}</div>`);
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const isToday = (d: Date) => d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    const tasksWithDates = app.getProcessedTasks().filter(t => t.task.开始时间 || t.task.截止日期);
    for (let i = 0; i < firstDay; i++) grid.innerHTML += `<div class="calendar-day other-month"></div>`;
    for (let i = 1; i <= daysInMonth; i++) {
        const dayCell = document.createElement('div');
        const currentDate = new Date(year, month, i);
        dayCell.className = 'calendar-day';
        if(isToday(currentDate)) dayCell.classList.add('today');
        dayCell.innerHTML = `<div class="day-number">${i}</div><div class="calendar-events"></div>`;
        const eventsContainer = dayCell.querySelector('.calendar-events')!;
        tasksWithDates.forEach(({ task, indices }) => {
            const start = parseDate(task.开始时间), end = parseDate(task.截止日期);
            if (start?.toDateString() === currentDate.toDateString()) eventsContainer.appendChild(createCalendarEvent(app, task, indices, 'start'));
            if (end?.toDateString() === currentDate.toDateString() && start?.toDateString() !== end?.toDateString()) eventsContainer.appendChild(createCalendarEvent(app, task, indices, 'end'));
        });
        grid.appendChild(dayCell);
    }
    container.appendChild(grid);
    app.timelineContainer.appendChild(container);
}

function renderWorkloadView(app: ITimelineApp): void {
    const tasks = Array.from(app.flattenTasks()).filter(t => t.task.负责人Ids && t.task.开始时间);
    if (tasks.length === 0) {
        app.timelineContainer.innerHTML = `<p>没有可供分析的任务。请确保任务已分配负责人并设置了开始时间。</p>`;
        return;
    }

    const workloadData: Record<string, Record<string, { count: number, tasks: 任务[] }>> = {};
    const allWeeks = new Set<number>();
    
    const allDates = tasks.flatMap(t => [parseDate(t.task.开始时间), parseDate(t.task.截止日期)]).filter((d): d is Date => d !== null);
    if (allDates.length === 0) {
        app.timelineContainer.innerHTML = `<p>任务没有有效的日期信息。</p>`;
        return;
    }
    const minDate = getWeekStartDate(new Date(Math.min(...allDates.map(d=>d.getTime()))));
    const maxDate = new Date(Math.max(...allDates.map(d=>d.getTime())));

    for (let d = new Date(minDate); d <= maxDate; d.setDate(d.getDate() + 7)) {
        allWeeks.add(getWeekStartDate(d).getTime());
    }
    
    tasks.forEach(({ task }) => {
        const assignees = task.负责人Ids || [];
        if (assignees.length === 0) return;
        const startDate = parseDate(task.开始时间);
        if (!startDate) return;
        const endDate = parseDate(task.截止日期) || startDate;

        let currentWeekStart = getWeekStartDate(startDate);
        while (currentWeekStart <= endDate) {
            const weekTime = currentWeekStart.getTime();
            
            assignees.forEach(assigneeId => {
                if (!workloadData[assigneeId]) workloadData[assigneeId] = {};
                if (!workloadData[assigneeId][weekTime]) workloadData[assigneeId][weekTime] = { count: 0, tasks: [] };
                workloadData[assigneeId][weekTime].count++;
                workloadData[assigneeId][weekTime].tasks.push(task);
            });
            currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        }
    });

    const allAssigneeIds = Object.keys(workloadData).sort((a,b) => (app.state.allUsers.find(u=>u.id === a)?.username || '').localeCompare(app.state.allUsers.find(u=>u.id === b)?.username || ''));
    const sortedWeeks = Array.from(allWeeks).sort();
    let maxWorkload = 1;
    Object.values(workloadData).forEach(d => Object.values(d).forEach(data => { if (data.count > maxWorkload) maxWorkload = data.count; }));
    
    const table = document.createElement('div');
    table.className = 'workload-table';
    table.style.gridTemplateColumns = `150px repeat(${sortedWeeks.length}, 1fr)`;

    table.innerHTML += `<div class="workload-header-cell">负责人</div>`;
    sortedWeeks.forEach(weekTime => { const d = new Date(weekTime); table.innerHTML += `<div class="workload-header-cell">${d.getMonth()+1}/${d.getDate()} 周</div>`; });
    
    allAssigneeIds.forEach(assigneeId => {
        const user = app.state.allUsers.find(u => u.id === assigneeId);
        table.innerHTML += `<div class="workload-person-cell">${user?.profile.displayName || '未知用户'}</div>`;
        sortedWeeks.forEach(weekTime => {
            const data = workloadData[assigneeId]?.[weekTime];
            const cell = document.createElement('div');
            cell.className = 'workload-week-cell';
            if(data?.count > 0) {
                let workloadClass = 'low';
                if (data.count > maxWorkload * 0.75 || data.count > 5) workloadClass = 'high';
                else if (data.count > maxWorkload * 0.4 || data.count > 2) workloadClass = 'medium';
                const bar = document.createElement('div');
                bar.className = `workload-bar ${workloadClass}`;
                bar.style.height = `${Math.min(100, (data.count / maxWorkload) * 100)}%`;
                bar.textContent = `${data.count}`;
                cell.appendChild(bar);
                bar.addEventListener('mouseenter', (e) => {
                    const tooltip = document.createElement('div');
                    tooltip.className = 'workload-tooltip';
                    tooltip.innerHTML = `<h5>${user?.profile.displayName} - ${new Date(weekTime).toLocaleDateString()}</h5><ul>${data.tasks.map(t => `<li>${t.任务名称}</li>`).join('')}</ul>`;
                    document.body.appendChild(tooltip);
                    const rect = bar.getBoundingClientRect();
                    tooltip.style.left = `${e.clientX + 10}px`;
                    tooltip.style.top = `${e.clientY - tooltip.offsetHeight - 5}px`;
                });
                bar.addEventListener('mouseleave', () => document.querySelector('.workload-tooltip')?.remove());
            }
            table.appendChild(cell);
        });
    });
    
    app.timelineContainer.appendChild(table);
}

function renderDependencyMap(app: ITimelineApp): void {
    document.getElementById('dep-map-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'dep-map-overlay';
    overlay.className = 'modal-overlay visible';
    overlay.innerHTML = `<div class="modal-content dependency-map-modal"><div class="modal-header"><h2>依赖关系图</h2><button class="modal-close-btn">&times;</button></div><div class="dependency-map-viewport"><div class="dependency-map-container"></div></div></div>`;
    document.body.appendChild(overlay);
    const closeModal = () => { overlay.remove(); document.removeEventListener('keydown', escapeListener); };
    const escapeListener = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    overlay.querySelector('.modal-close-btn')!.addEventListener('click', closeModal);
    document.addEventListener('keydown', escapeListener);
    const viewport = overlay.querySelector('.dependency-map-viewport') as HTMLElement;
    const container = overlay.querySelector('.dependency-map-container') as HTMLElement;
    const flatTasks = Array.from(app.flattenTasks());
    if (flatTasks.length === 0) { container.innerHTML = `<p>沒有任務可供展示。</p>`; return; }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'dep-graph-svg');
    svg.innerHTML = `<defs><marker id="arrowhead" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" /></marker></defs>`;
    container.appendChild(svg);
    const taskMap = new Map(flatTasks.map(item => [item.task.id, item]));
    const adj: Record<string, string[]> = {}, revAdj: Record<string, string[]> = {};
    flatTasks.forEach(({ task }) => { adj[task.id] = []; revAdj[task.id] = []; });
    flatTasks.forEach(({ task }) => (task.dependencies || []).forEach(depId => { if (taskMap.has(depId)) { adj[depId].push(task.id); revAdj[task.id].push(depId); }}));
    const columns: string[][] = [];
    let currentQueue = flatTasks.filter(t => (revAdj[t.task.id] || []).length === 0).map(t => t.task.id);
    const processed = new Set<string>();
    while (currentQueue.length > 0) {
        columns.push(currentQueue);
        currentQueue.forEach(id => processed.add(id));
        const nextQueue = new Set<string>();
        currentQueue.forEach(u => (adj[u] || []).forEach(v => { if (!processed.has(v) && (revAdj[v] || []).every(p => processed.has(p))) nextQueue.add(v); }));
        currentQueue = Array.from(nextQueue);
    }
    const nodeElements: Record<string, HTMLElement> = {};
    let maxWidth = 0, maxHeight = 0;
    columns.forEach((col, colIndex) => {
        col.forEach((taskId, rowIndex) => {
            const item = taskMap.get(taskId);
            if (!item) return;
            const { task, indices } = item;
            const assigneeName = task.负责人Ids?.[0] ? app.state.allUsers.find(u => u.id === task.负责人Ids![0])?.profile.displayName || '未分配' : '未分配';
            const node = document.createElement('div');
            node.className = 'dep-node';
            node.dataset.status = task.状态;
            node.innerHTML = `<strong>${task.任务名称}</strong><span>${assigneeName}</span>`;
            const x = colIndex * 250 + 50, y = rowIndex * 120 + 50;
            node.style.left = `${x}px`; node.style.top = `${y}px`;
            node.onclick = () => app.showEditModal(indices, task);
            container.appendChild(node);
            nodeElements[taskId] = node;
            maxWidth = Math.max(maxWidth, x + 200); maxHeight = Math.max(maxHeight, y + 60);
        });
    });
    container.style.width = `${maxWidth}px`; container.style.height = `${maxHeight}px`;
    setTimeout(() => {
        flatTasks.forEach(({ task }) => (task.dependencies || []).forEach(depId => {
            const source = nodeElements[depId], target = nodeElements[task.id];
            if (source && target) {
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', `${source.offsetLeft + source.offsetWidth}`);
                line.setAttribute('y1', `${source.offsetTop + source.offsetHeight / 2}`);
                line.setAttribute('x2', `${target.offsetLeft}`);
                line.setAttribute('y2', `${target.offsetTop + target.offsetHeight / 2}`);
                line.setAttribute('class', 'dep-edge');
                svg.appendChild(line);
            }
        }));
    }, 0);
    let isPanning = false, startX = 0, startY = 0, transX = 0, transY = 0, scale = 1;
    const updateTransform = () => { container.style.transform = `translate(${transX}px, ${transY}px) scale(${scale})`; };
    viewport.addEventListener('mousedown', (e) => { isPanning = true; startX = e.clientX - transX; startY = e.clientY - transY; viewport.style.cursor = 'grabbing'; });
    viewport.addEventListener('mousemove', (e) => { if (isPanning) { transX = e.clientX - startX; transY = e.clientY - startY; updateTransform(); } });
    const stopPanning = () => { isPanning = false; viewport.style.cursor = 'grab'; };
    viewport.addEventListener('mouseup', stopPanning);
    viewport.addEventListener('mouseleave', stopPanning);
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect(), mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top, scaleAmount = -e.deltaY * 0.001;
        const newScale = Math.max(0.2, Math.min(3, scale + scaleAmount));
        transX -= (mouseX - transX) * (newScale - scale) / scale;
        transY -= (mouseY - transY) * (newScale - scale) / scale;
        scale = newScale;
        updateTransform();
    });
}

function renderMindMap(app: ITimelineApp): void {
    const timelineData = app.state.pendingTimeline ? app.state.pendingTimeline.data : app.state.timeline;
    if (!timelineData) return;
    interface MindMapNode { id: string; name: string; type: string; data: any; indices?: Indices; children: MindMapNode[]; parent?: MindMapNode; x: number; y: number; subtreeHeight: number; }
    const NODE_WIDTH = 220, NODE_HEIGHT = 50, HORIZONTAL_GAP = 80, VERTICAL_GAP = 20;
    const root: MindMapNode = { id: 'root', name: timelineData.项目名称, type: 'project', data: timelineData, children: [], x: 0, y: 0, subtreeHeight: 0 };
    timelineData.阶段.forEach((phase, phaseIndex) => {
        const phaseNode: MindMapNode = { id: `phase-${phaseIndex}`, name: phase.阶段名称, type: 'phase', data: phase, children: [], parent: root, x: 0, y: 0, subtreeHeight: 0 };
        root.children.push(phaseNode);
        const processTasks = (tasks: 任务[], baseIndices: TopLevelIndices, parentNode: MindMapNode, parentPath: number[]) => {
            (tasks || []).forEach((task, taskIndex) => {
                const currentPath = [...parentPath, taskIndex];
                const taskNode: MindMapNode = { id: task.id, name: task.任务名称, type: 'task', data: task, indices: { ...baseIndices, phaseIndex: baseIndices.phaseIndex!, taskPath: currentPath }, children: [], parent: parentNode, x: 0, y: 0, subtreeHeight: 0 };
                parentNode.children.push(taskNode);
                if (task.子任务) processTasks(task.子任务, baseIndices, taskNode, currentPath);
            });
        };
        (phase.任务 || []).forEach((task, taskIndex) => {
            const taskNode: MindMapNode = { id: task.id, name: task.任务名称, type: 'task', data: task, indices: { phaseIndex, taskPath: [taskIndex] }, children: [], parent: phaseNode, x: 0, y: 0, subtreeHeight: 0 };
            phaseNode.children.push(taskNode);
            if (task.子任务) processTasks(task.子任务, { phaseIndex }, taskNode, [taskIndex]);
        });
        (phase.项目 || []).forEach((proj, projectIndex) => {
            const projNode: MindMapNode = { id: `phase-${phaseIndex}-proj-${projectIndex}`, name: proj.项目名称, type: 'nested-project', data: proj, children: [], parent: phaseNode, x: 0, y: 0, subtreeHeight: 0 };
            phaseNode.children.push(projNode);
            processTasks(proj.任务, { phaseIndex, projectIndex }, projNode, []);
        });
    });
    const calculateLayout = (node: MindMapNode, depth = 0) => {
        node.x = depth * (NODE_WIDTH + HORIZONTAL_GAP);
        if (app.state.mindMapState.collapsedNodes.has(node.id) || node.children.length === 0) { node.subtreeHeight = NODE_HEIGHT; return; }
        let childrenSubtreeHeight = 0;
        node.children.forEach((child, i) => { calculateLayout(child, depth + 1); childrenSubtreeHeight += child.subtreeHeight + (i > 0 ? VERTICAL_GAP : 0); });
        node.subtreeHeight = Math.max(NODE_HEIGHT, childrenSubtreeHeight);
    };
    const assignCoordinates = (node: MindMapNode, y: number) => {
        node.y = y + (node.subtreeHeight - NODE_HEIGHT) / 2;
        if (!app.state.mindMapState.collapsedNodes.has(node.id) && node.children.length > 0) {
            let currentY = y;
            node.children.forEach(child => { assignCoordinates(child, currentY); currentY += child.subtreeHeight + VERTICAL_GAP; });
        }
    };
    calculateLayout(root); assignCoordinates(root, 0);
    app.timelineContainer.innerHTML = ''; app.timelineContainer.className = 'mindmap-view';
    const viewport = document.createElement('div'); viewport.className = 'mindmap-viewport';
    const container = document.createElement('div'); container.className = 'mindmap-container';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'mindmap-connectors');
    container.appendChild(svg); viewport.appendChild(container);
    const allNodes: MindMapNode[] = [];
    (function traverse(node: MindMapNode){ allNodes.push(node); if (!app.state.mindMapState.collapsedNodes.has(node.id)) node.children.forEach(traverse); })(root);
    allNodes.forEach(node => {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'mindmap-node';
        nodeEl.dataset.type = node.type;
        nodeEl.style.left = `${node.x}px`; nodeEl.style.top = `${node.y}px`;
        if (node.type === 'task') { nodeEl.dataset.status = node.data.状态; nodeEl.onclick = () => app.showEditModal(node.indices!, node.data); }
        nodeEl.innerHTML = `<div class="mindmap-node-name">${node.name}</div>`;
        if (node.children.length > 0) {
            const isCollapsed = app.state.mindMapState.collapsedNodes.has(node.id);
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'node-toggle';
            toggleBtn.textContent = isCollapsed ? '+' : '-';
            nodeEl.appendChild(toggleBtn);
            nodeEl.classList.toggle('collapsed', isCollapsed);
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                const newSet = app.state.mindMapState.collapsedNodes;
                newSet.has(node.id) ? newSet.delete(node.id) : newSet.add(node.id);
                app.setState({ mindMapState: { collapsedNodes: newSet } });
            };
        }
        container.appendChild(nodeEl);
        if (node.parent) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const [startX, startY, endX, endY] = [node.parent.x + NODE_WIDTH, node.parent.y + NODE_HEIGHT / 2, node.x, node.y + NODE_HEIGHT / 2];
            path.setAttribute('d', `M ${startX} ${startY} C ${startX + HORIZONTAL_GAP / 2} ${startY}, ${endX - HORIZONTAL_GAP / 2} ${endY}, ${endX} ${endY}`);
            path.setAttribute('class', 'mindmap-connector');
            svg.appendChild(path);
        }
    });
    let scale = 1, panX = 0, panY = 0, isPanning = false, startX = 0, startY = 0;
    const updateTransform = () => container.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    viewport.onmousedown = (e) => { isPanning = true; startX = e.clientX - panX; startY = e.clientY - panY; viewport.style.cursor = 'grabbing'; };
    viewport.onmousemove = (e) => { if (isPanning) { panX = e.clientX - startX; panY = e.clientY - startY; updateTransform(); } };
    const stopPan = () => { isPanning = false; viewport.style.cursor = 'grab'; };
    viewport.onmouseup = viewport.onmouseleave = stopPan;
    viewport.onwheel = (e) => {
        e.preventDefault();
        const rect = viewport.getBoundingClientRect(), mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top, scaleFactor = 1 - e.deltaY * 0.001;
        panX = mouseX - (mouseX - panX) * scaleFactor;
        panY = mouseY - (mouseY - panY) * scaleFactor;
        scale = Math.max(0.2, Math.min(3, scale * scaleFactor));
        updateTransform();
    };
    const controls = document.createElement('div');
    controls.className = 'mindmap-controls';
    controls.innerHTML = `<button data-action="zoom-in" title="放大">+</button><button data-action="zoom-out" title="缩小">-</button><button data-action="fit" title="适应屏幕"><svg viewBox="0 0 24 24"><path d="M15 3h6v6h-2V5h-4V3zM9 21H3v-6h2v4h4v2zm6-18v2h4v4h2V3h-6zM3 9V3h6v2H5v4H3z"/></svg></button>`;
    controls.onclick = (e) => {
        const action = (e.target as HTMLElement).closest('button')?.dataset.action;
        if (action === 'zoom-in') scale = Math.min(3, scale * 1.2);
        if (action === 'zoom-out') scale = Math.max(0.2, scale / 1.2);
        if (action === 'fit') {
            const bounds = container.getBoundingClientRect(), viewportBounds = viewport.getBoundingClientRect();
            scale = Math.min(viewportBounds.width / bounds.width, viewportBounds.height / bounds.height) * 0.9;
            panX = (viewportBounds.width - bounds.width * scale) / 2 - bounds.left * scale;
            panY = (viewportBounds.height - bounds.height * scale) / 2 - bounds.top * scale;
        }
        updateTransform();
    };
    app.timelineContainer.appendChild(viewport);
    app.timelineContainer.appendChild(controls);
    setTimeout(() => controls.querySelector<HTMLButtonElement>('button[data-action="fit"]')?.click(), 100);
}

export function renderView(app: ITimelineApp) {
    app.timelineContainer.onwheel = null;
    if (app.state.currentView !== 'dependencies') {
        app.timelineContainer.innerHTML = "";
        app.timelineContainer.className = `${app.state.currentView}-view`;
    }
    
    const timelineData = app.state.pendingTimeline ? app.state.pendingTimeline.data : app.state.timeline;
    if (!timelineData) {
        if (app.state.currentView !== 'dependencies') {
            app.timelineContainer.innerHTML = "";
        }
        return;
    }
    
    switch(app.state.currentView) {
      case 'vertical': renderVerticalTimeline(app, timelineData.阶段); break;
      case 'gantt': renderGanttChart(app); break;
      case 'kanban': renderKanban(app); break;
      case 'calendar': renderCalendar(app); break;
      case 'workload': renderWorkloadView(app); break;
      case 'dependencies': renderDependencyMap(app); break;
      case 'mindmap': renderMindMap(app); break;
    }
}
