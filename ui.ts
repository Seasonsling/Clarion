import { getInitials, stringToColor } from './utils.js';
// FIX: Import ViewType and GanttGranularity to correctly type UI control data.
import type { ITimelineApp, Indices, 任务, TopLevelIndices, ProjectMemberRole, User, ViewType, GanttGranularity } from './types.js';

function renderAuth(app: ITimelineApp): void {
    app.authSection.classList.remove('hidden');
    app.inputSection.classList.add('hidden');
    app.timelineSection.classList.add('hidden');
    
    if (app.state.authView === 'login') {
        app.loginForm.classList.remove('hidden');
        app.registerForm.classList.add('hidden');
        app.showLoginBtn.classList.add('active');
        app.showRegisterBtn.classList.remove('active');
    } else {
        app.loginForm.classList.add('hidden');
        app.registerForm.classList.remove('hidden');
        app.showLoginBtn.classList.remove('active');
        app.showRegisterBtn.classList.add('active');
    }
}

function renderUserAvatar(app: ITimelineApp, userIdOrName: string): string {
    const user = app.state.allUsers.find(u => u.id === userIdOrName) || (app.state.currentUser?.id === userIdOrName ? app.state.currentUser : null);
    if (user) {
        if (user.profile.avatarUrl) {
            return `<img src="${user.profile.avatarUrl}" alt="${user.profile.displayName}" class="avatar">`;
        }
        const initials = getInitials(user.profile.displayName);
        return `<div class="avatar" style="background-color: ${user.profile.color}; color: #fff;" title="${user.profile.displayName}">${initials}</div>`;
    } else {
        const name = userIdOrName;
        const initials = getInitials(name);
        const color = stringToColor(name);
        return `<div class="avatar" style="background-color: ${color}; color: #fff;" title="${name}">${initials}</div>`;
    }
}

function renderUserDisplay(app: ITimelineApp): void {
    if (app.state.currentUser) {
        app.userDisplayEl.innerHTML = `
            <div class="user-info">
              ${renderUserAvatar(app, app.state.currentUser.id)}
              <span>欢迎, <strong>${app.state.currentUser.profile.displayName}</strong></span>
            </div>
            <div class="user-actions">
              <button id="api-key-change-btn" class="secondary-btn">API 密钥</button>
              <button id="logout-btn" class="secondary-btn">登出</button>
            </div>
        `;
        app.userDisplayEl.querySelector('#api-key-change-btn')!.addEventListener('click', () => {
            app.apiKeyInput.value = app.state.apiKey || '';
            showApiKeyModal(app, true);
        });
        app.userDisplayEl.querySelector('#logout-btn')!.addEventListener('click', () => {
            app.setState({ currentUser: null, timeline: null, projectsHistory: [], allUsers: [] });
        });
    } else {
        app.userDisplayEl.innerHTML = '';
    }
}

function renderSaveStatusIndicator(app: ITimelineApp): void {
  switch (app.state.saveStatus) {
    case 'saving':
      app.saveStatusEl.innerHTML = `<div class="spinner"></div> 正在同步...`;
      break;
    case 'saved':
      app.saveStatusEl.innerHTML = `✓ 已同步至云端`;
      break;
    case 'error':
      app.saveStatusEl.innerHTML = `✗ 同步失败`;
      break;
    case 'idle':
    default:
      app.saveStatusEl.innerHTML = '';
      break;
  }
}

function renderHomeScreen(app: ITimelineApp): void {
    app.projectInput.value = "";
    const userProjects = app.getUserProjects();
    const hasHistory = userProjects.length > 0;

    app.historySectionEl.classList.toggle('hidden', !hasHistory);
    app.quickAddFormEl.classList.toggle('hidden', !hasHistory);

    if (hasHistory) {
        app.historyListEl.innerHTML = '';
        const projectSelect = app.quickAddFormEl.querySelector('#project-select') as HTMLSelectElement;
        projectSelect.innerHTML = '';

        userProjects.forEach((project) => {
            const isOwner = project.ownerId === app.state.currentUser?.id;
            const member = project.members.find(m => m.userId === app.state.currentUser?.id);
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
            itemEl.querySelector('.load-btn')!.addEventListener('click', () => app.handleLoadProject(project));
            if (isOwner) {
                itemEl.querySelector('.delete-btn')!.addEventListener('click', () => (app as any).handleDeleteProject(project));
            }
            app.historyListEl.appendChild(itemEl);

            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.项目名称;
            projectSelect.appendChild(option);
        });
    }
}

function renderChat(app: ITimelineApp): void {
    app.chatHistoryEl.innerHTML = '';
    app.state.chatHistory.forEach(msg => {
        const msgEl = document.createElement('div');
        msgEl.className = `chat-message-container`;
        const messageCore = document.createElement('div');
        messageCore.className = `chat-message ${msg.role}-message`;
        messageCore.innerHTML = `
            ${msg.role === 'model' ? 
              `<div class="avatar" style="background-color: var(--accent-color-light); color: var(--text-primary);">助</div>` :
              renderUserAvatar(app, app.state.currentUser!.id)
            }
            <div class="message-content"><p>${msg.text.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p></div>
        `;
        msgEl.appendChild(messageCore);
        if (msg.role === 'model') {
             if (msg.sources && msg.sources.length > 0) {
                const sourcesEl = document.createElement('div');
                sourcesEl.className = 'chat-message-sources';
                sourcesEl.innerHTML = `<h5>参考来源:</h5><ul>${msg.sources.map(s => `<li><a href="${s.uri}" target="_blank" rel="noopener noreferrer">${s.title || s.uri}</a></li>`).join('')}</ul>`;
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
            regenBtn.onclick = () => app.handleRegenerateClick();
            actions.appendChild(copyBtn);
            actions.appendChild(regenBtn);
            msgEl.appendChild(actions);
        }
        app.chatHistoryEl.appendChild(msgEl);
    });

    if (app.state.isChatLoading) {
        const thinkingEl = document.createElement('div');
        thinkingEl.className = 'chat-message model-message thinking';
        thinkingEl.innerHTML = `
            <div class="avatar" style="background-color: var(--accent-color-light); color: var(--text-primary);">助</div>
            <div class="message-content"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        `;
        app.chatHistoryEl.appendChild(thinkingEl);
    }
    app.chatHistoryEl.scrollTop = app.chatHistoryEl.scrollHeight;
}

function renderViewSwitcher(app: ITimelineApp): void {
    // FIX: Explicitly type the views array to ensure view.id has the correct 'ViewType'.
    const views: { id: ViewType, name: string }[] = [
      { id: 'vertical', name: '纵览' }, { id: 'gantt', name: '甘特图' }, { id: 'kanban', name: '看板' },
      { id: 'calendar', name: '行事历' }, { id: 'workload', name: '工作负载' }, { id: 'dependencies', name: '依赖图' },
      { id: 'mindmap', name: '思维导图' },
    ];
    app.viewSwitcherEl.innerHTML = '';
    views.forEach(view => {
      const btn = document.createElement('button');
      btn.textContent = view.name;
      btn.className = app.state.currentView === view.id ? 'active' : '';
      btn.onclick = () => app.setState({ currentView: view.id });
      app.viewSwitcherEl.appendChild(btn);
    });
}

function renderViewSpecificControls(app: ITimelineApp): void {
    if (!app.viewSpecificControlsEl) return;
    app.viewSpecificControlsEl.innerHTML = '';
    if (app.state.currentView === 'gantt') {
        app.viewSpecificControlsEl.classList.add('gantt-view-controls');
        // FIX: Explicitly type the granularities array to ensure gran.id has the correct 'GanttGranularity' type.
        const granularities: { id: GanttGranularity, name: string }[] = [{ id: 'days', name: '日' }, { id: 'weeks', name: '周' }, { id: 'months', name: '月' }];
        granularities.forEach(gran => {
            const btn = document.createElement('button');
            btn.textContent = gran.name;
            btn.className = app.state.ganttGranularity === gran.id ? 'active' : '';
            btn.onclick = () => app.setState({ ganttGranularity: gran.id });
            app.viewSpecificControlsEl!.appendChild(btn);
        });
    } else {
        app.viewSpecificControlsEl.classList.remove('gantt-view-controls');
    }
}

function createMultiSelectDropdown(app: ITimelineApp, id: 'status' | 'priority' | 'assignee', labelText: string, options: string[], selectedOptions: string[]): HTMLElement {
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
            const newSelection = checkbox.checked ? [...selectedOptions, optionValue] : selectedOptions.filter(item => item !== optionValue);
            app.setState({ filters: { ...app.state.filters, [id]: newSelection } });
        });
        let optionLabel = optionValue;
        if (id === 'assignee') {
            const user = app.state.allUsers.find(u => u.id === optionValue);
            optionLabel = user ? user.profile.displayName : '未知用户';
        }
        optionEl.appendChild(checkbox);
        optionEl.append(document.createTextNode(optionLabel));
        dropdown.appendChild(optionEl);
    });
    if (options.length > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清空';
        clearBtn.className = 'multi-select-clear';
        clearBtn.onclick = (e) => {
            e.preventDefault();
            app.setState({ filters: { ...app.state.filters, [id]: [] } });
        };
        dropdown.appendChild(clearBtn);
    } else {
        dropdown.innerHTML = `<div class="multi-select-empty">无可用选项</div>`;
    }
    button.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.multi-select-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
        dropdown.classList.toggle('hidden');
    });
    updateButtonText();
    container.appendChild(button);
    container.appendChild(dropdown);
    document.addEventListener('click', (e) => { if (!container.contains(e.target as Node)) dropdown.classList.add('hidden'); });
    return container;
}

function renderFilterSortControls(app: ITimelineApp): void {
    app.filterSortControlsEl.innerHTML = '';
    const allAssignees = [...new Set(app.state.timeline?.members.map(m => m.userId) || [])];
    app.filterSortControlsEl.appendChild(createMultiSelectDropdown(app, 'status', '状态', ['待办', '进行中', '已完成'], app.state.filters.status));
    app.filterSortControlsEl.appendChild(createMultiSelectDropdown(app, 'priority', '优先级', ['高', '中', '低'], app.state.filters.priority));
    app.filterSortControlsEl.appendChild(createMultiSelectDropdown(app, 'assignee', '负责人', allAssignees, app.state.filters.assignee));
    const sortGroup = document.createElement('div');
    sortGroup.className = 'sort-group';
    sortGroup.innerHTML = `<label for="sort-by">排序:</label><select id="sort-by"><option value="default">默认</option><option value="deadline">截止日期</option><option value="priority">优先级</option><option value="name">任务名称</option></select>`;
    const sortSelect = sortGroup.querySelector('#sort-by') as HTMLSelectElement;
    sortSelect.value = app.state.sortBy;
    sortSelect.addEventListener('change', (e) => app.setState({ sortBy: (e.target as HTMLSelectElement).value as any }));
    app.filterSortControlsEl.appendChild(sortGroup);
}

function createEditableElement(app: ITimelineApp, tag: 'h2' | 'h3' | 'h4', text: string, indices: TopLevelIndices, field: '项目名称' | '阶段名称'): HTMLElement {
    const el = document.createElement(tag);
    el.textContent = text;
    if (!app.canEditProject()) return el;
    el.className = 'editable';
    el.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = text;
        input.className = 'inline-edit';
        el.replaceWith(input);
        input.focus();
        const save = () => app.handleUpdateField(indices, field, input.value);
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.removeEventListener('blur', save);
                input.blur();
                app.render();
            }
        });
    });
    return el;
}

function showApiKeyModal(app: ITimelineApp, show: boolean): void {
    app.apiKeyErrorEl.classList.add('hidden');
    app.apiKeyErrorEl.textContent = '';
    app.apiKeyModalOverlay.classList.toggle('hidden', !show);
    app.apiKeyModalOverlay.classList.toggle('visible', show);
    if (show) app.apiKeyInput.focus();
}

function showEditModal(app: ITimelineApp, indices: Indices, task: 任务): void {
    document.getElementById('edit-modal-overlay')?.remove();
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'edit-modal-overlay';
    modalOverlay.className = 'modal-overlay';
    const formatToDateTimeLocalValue = (d?: string): string => d ? (d.includes(' ') ? d.replace(' ', 'T') : `${d}T00:00`).slice(0, 16) : '';
    const flatTasks = Array.from(app.flattenTasks()).map(i => i.task);
    const dependencyOptions = flatTasks.filter(t => t.id !== task.id).map(t => `<option value="${t.id}" ${task.dependencies?.includes(t.id) ? 'selected' : ''}>${t.任务名称}</option>`).join('');
    const projectMembers = app.state.timeline?.members.map(m => app.state.allUsers.find(u => u.id === m.userId)).filter(Boolean) as User[];
    const knownUserIds = new Set(projectMembers.map(u => u.id));
    const taskAssigneeIds = task.负责人Ids || [];
    const taskKnownUserIds = taskAssigneeIds.filter(id => knownUserIds.has(id));
    const taskOtherNames = taskAssigneeIds.filter(id => !knownUserIds.has(id));
    const assigneeOptions = projectMembers.map(user => `<option value="${user.id}" ${taskKnownUserIds.includes(user.id) ? 'selected' : ''}>${user.profile.displayName}</option>`).join('');
    modalOverlay.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>编辑任务</h2><button class="modal-close-btn">&times;</button></div><form class="modal-form"><div class="form-group full-width"><label for="taskName">任务名称</label><input type="text" id="taskName" value="${task.任务名称}" required></div><div class="form-group full-width"><label for="details">详情</label><textarea id="details">${task.详情 || ''}</textarea></div><div class="form-group"><label for="status">状态</label><select id="status"><option value="待办" ${task.状态 === '待办' ? 'selected' : ''}>待办</option><option value="进行中" ${task.状态 === '进行中' ? 'selected' : ''}>进行中</option><option value="已完成" ${task.状态 === '已完成' ? 'selected' : ''}>已完成</option></select></div><div class="form-group"><label for="priority">优先级</label><select id="priority"><option value="高" ${task.优先级 === '高' ? 'selected' : ''}>高</option><option value="中" ${!task.优先级 || task.优先级 === '中' ? 'selected' : ''}>中</option><option value="低" ${task.优先级 === '低' ? 'selected' : ''}>低</option></select></div><div class="form-group full-width"><label for="assignee">项目成员 (可多选)</label><select id="assignee" multiple>${assigneeOptions}</select></div><div class="form-group full-width"><label for="otherAssignees">其他负责人 (用逗号分隔)</label><input type="text" id="otherAssignees" value="${taskOtherNames.join(', ')}"></div><div class="form-group"><label for="startTime">开始时间</label><input type="datetime-local" id="startTime" value="${formatToDateTimeLocalValue(task.开始时间)}"></div><div class="form-group"><label for="deadline">截止日期</label><input type="datetime-local" id="deadline" value="${formatToDateTimeLocalValue(task.截止日期)}"></div><div class="form-group full-width"><label for="dependencies">依赖于 (可多选)</label><select id="dependencies" multiple>${dependencyOptions}</select></div><div class="form-group full-width"><label for="notes">备注</label><textarea id="notes">${task.备注 || ''}</textarea></div><div class="modal-footer"><button type="button" class="secondary-btn cancel-btn">取消</button><button type="submit" class="primary-btn">保存</button></div></form></div>`;
    document.body.appendChild(modalOverlay);
    const form = modalOverlay.querySelector('form')!;
    if (!app.canEditProject()) {
        form.querySelectorAll('input, textarea, select, button').forEach(el => (el as any).disabled = true);
        form.querySelector<HTMLButtonElement>('.cancel-btn')!.disabled = false;
    }
    const close = () => modalOverlay.remove();
    const formatFromDateTimeLocalValue = (val: string): string => val ? val.replace('T', ' ') : '';
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) close(); });
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const selectedDependencies = Array.from((form.querySelector('#dependencies') as HTMLSelectElement).selectedOptions).map(o => o.value);
        const selectedAssignees = Array.from((form.querySelector('#assignee') as HTMLSelectElement).selectedOptions).map(o => o.value);
        const otherAssignees = (form.querySelector('#otherAssignees') as HTMLInputElement).value.split(',').map(n => n.trim()).filter(Boolean);
        const allAssignees = [...new Set([...selectedAssignees, ...otherAssignees])];
        const updatedTask: 任务 = { ...task, 任务名称: (form.querySelector('#taskName') as HTMLInputElement).value, 详情: (form.querySelector('#details') as HTMLTextAreaElement).value, 状态: (form.querySelector('#status') as HTMLSelectElement).value as any, 优先级: (form.querySelector('#priority') as HTMLSelectElement).value as any, 负责人Ids: allAssignees, 开始时间: formatFromDateTimeLocalValue((form.querySelector('#startTime') as HTMLInputElement).value), 截止日期: formatFromDateTimeLocalValue((form.querySelector('#deadline') as HTMLInputElement).value), 备注: (form.querySelector('#notes') as HTMLTextAreaElement).value, dependencies: selectedDependencies };
        updatedTask.已完成 = updatedTask.状态 === '已完成';
        app.handleUpdateTask(indices, updatedTask);
        close();
    });
    modalOverlay.querySelector('.modal-close-btn')!.addEventListener('click', close);
    modalOverlay.querySelector('.cancel-btn')!.addEventListener('click', close);
    setTimeout(() => modalOverlay.classList.add('visible'), 10);
}

function showMembersModal(app: ITimelineApp): void {
    if (!app.state.timeline || !app.state.currentUser) return;
    const userRole = app.getUserRole();
    const canManage = userRole === 'Admin';
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'members-modal-overlay';
    modalOverlay.className = 'modal-overlay';
    const renderMembersList = () => {
        const owner = app.state.allUsers.find(u => u.id === app.state.timeline!.ownerId);
        return app.state.timeline!.members.map(member => {
            const user = app.state.allUsers.find(u => u.id === member.userId);
            if (!user) return '';
            const isOwner = user.id === owner?.id;
            const roleSelector = canManage && !isOwner ? `<select class="role-selector" data-user-id="${user.id}"><option value="Admin" ${member.role === 'Admin' ? 'selected' : ''}>Admin</option><option value="Editor" ${member.role === 'Editor' ? 'selected' : ''}>Editor</option><option value="Viewer" ${member.role === 'Viewer' ? 'selected' : ''}>Viewer</option></select>` : `<span>${isOwner ? '所有者' : member.role}</span>`;
            return `<div class="member-item"><div class="member-info">${renderUserAvatar(app, user.id)}<span>${user.profile.displayName}</span></div><div class="member-actions">${roleSelector}${canManage && !isOwner ? `<button class="icon-btn remove-member-btn" data-user-id="${user.id}" title="移除成员"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}</div></div>`;
        }).join('');
    };
    const nonMemberOptions = () => app.state.allUsers.filter(u => !app.state.timeline!.members.some(m => m.userId === u.id)).map(u => `<option value="${u.id}">${u.profile.displayName}</option>`).join('');
    const inviteLink = `${window.location.origin}${window.location.pathname}?projectId=${app.state.timeline.id}`;
    modalOverlay.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>项目协作</h2><button class="modal-close-btn">&times;</button></div><div class="modal-body"><div class="members-list">${renderMembersList()}</div>${canManage ? `<div class="invite-section"><form class="add-member-form"><h5>邀请成员</h5><div class="form-group-inline"><select id="add-user-select" required>${nonMemberOptions()}</select><select id="add-user-role"><option value="Editor">Editor</option><option value="Viewer">Viewer</option><option value="Admin">Admin</option></select><button type="submit" class="primary-btn">添加</button></div></form><div class="share-link-section"><h5>或分享链接邀请</h5><div class="form-group-inline"><input type="text" readonly value="${inviteLink}"><button id="copy-link-btn" class="secondary-btn">复制</button></div></div></div>` : ''}</div></div>`;
    document.body.appendChild(modalOverlay);
    const close = () => modalOverlay.remove();
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) close(); });
    modalOverlay.querySelector('.modal-close-btn')!.addEventListener('click', close);
    if (canManage) {
        modalOverlay.querySelectorAll('.remove-member-btn').forEach(btn => btn.addEventListener('click', (e) => {
            const userId = (e.currentTarget as HTMLElement).dataset.userId;
            if (userId && app.state.timeline) {
                app.state.timeline.members = app.state.timeline.members.filter(m => m.userId !== userId);
                app.saveCurrentProject(app.state.timeline);
                close();
                showMembersModal(app);
            }
        }));
        modalOverlay.querySelectorAll('.role-selector').forEach(select => select.addEventListener('change', (e) => {
            const target = e.currentTarget as HTMLSelectElement;
            const userId = target.dataset.userId;
            const newRole = target.value as ProjectMemberRole;
            if(userId && app.state.timeline) {
                const member = app.state.timeline.members.find(m => m.userId === userId);
                if (member) {
                    member.role = newRole;
                    app.saveCurrentProject(app.state.timeline);
                }
            }
        }));
        const addForm = modalOverlay.querySelector('.add-member-form');
        if (addForm) {
            addForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const userId = (modalOverlay.querySelector('#add-user-select') as HTMLSelectElement).value;
                const role = (modalOverlay.querySelector('#add-user-role') as HTMLSelectElement).value as ProjectMemberRole;
                if (userId && role && app.state.timeline) {
                    app.state.timeline.members.push({ userId, role });
                    app.saveCurrentProject(app.state.timeline);
                    close();
                    showMembersModal(app);
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

function showReportModal(app: ITimelineApp, isLoading: boolean, reportText: string = ''): void {
    document.getElementById('report-modal-overlay')?.remove();
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'report-modal-overlay';
    modalOverlay.className = 'modal-overlay';
    const safeReportText = reportText.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const contentHTML = isLoading
        ? `<div class="modal-body loading-state"><div class="spinner"></div><p>报告生成中，请稍候...</p></div>`
        : `<div class="modal-body"><pre class="report-content">${safeReportText}</pre></div><div class="modal-footer"><button type="button" class="secondary-btn copy-btn">复制内容</button><button type="button" class="primary-btn close-btn">关闭</button></div>`;
    modalOverlay.innerHTML = `<div class="modal-content report-modal"><div class="modal-header"><h2>项目状态报告</h2><button class="modal-close-btn close-btn">&times;</button></div>${contentHTML}</div>`;
    document.body.appendChild(modalOverlay);
    const close = () => modalOverlay.remove();
    modalOverlay.querySelectorAll('.close-btn').forEach(btn => btn.addEventListener('click', close));
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) close(); });
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

export const renderUI = {
    renderAuth,
    renderUserAvatar,
    renderUserDisplay,
    renderSaveStatusIndicator,
    renderHomeScreen,
    renderChat,
    renderViewSwitcher,
    renderViewSpecificControls,
    renderFilterSortControls,
    createEditableElement,
    showApiKeyModal,
    showEditModal,
    showMembersModal,
    showReportModal,
};