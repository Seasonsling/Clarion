import type { TimelineApp } from './app';
import { getInitials, parseDate, getWeekStartDate, stringToColor } from './utils';
import { 阶段, 任务, Indices, TopLevelIndices, TaskStatus, GanttGranularity, User, 时间轴数据, ViewType, ProjectMemberRole } from './types';

export class Renderer {
    private app: TimelineApp;

    constructor(app: TimelineApp) {
        this.app = app;
    }

    renderUserAvatar(userIdOrName: string): string {
        const { allUsers, currentUser } = this.app.state;
        const user = allUsers.find(u => u.id === userIdOrName) || (currentUser?.id === userIdOrName ? currentUser : null);
        
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
  
    // --- RENDER ---
    render() {
        this.app.loadingOverlay.classList.toggle("hidden", !this.app.state.isLoading);
        this.app.loadingTextEl.textContent = this.app.state.loadingText;
        
        if (!this.app.state.currentUser) {
            this.renderAuth();
            return;
        }

        // --- Logged-in view ---
        this.app.authSection.classList.add('hidden');
        this.app.userDisplayEl.classList.remove('hidden');
        this.app.generateBtn.disabled = this.app.state.isLoading;
        if (this.app.generateBtn.querySelector('span')) {
            this.app.generateBtn.querySelector('span')!.textContent = this.app.state.isLoading ? "生成中..." : "开始生成";
        }
        this.app.chatSendBtn.disabled = this.app.state.isChatLoading;
        
        this.renderUserDisplay();

        if (this.app.state.timeline) {
          this.app.inputSection.classList.add("hidden");
          this.app.timelineSection.classList.remove("hidden");
          setTimeout(() => this.app.timelineSection.classList.add('visible'), 10);
          
          const userRole = this.app.getUserRole();
          const readOnly = userRole === 'Viewer';
          
          this.app.projectNameEl.innerHTML = '';
          this.app.projectNameEl.appendChild(this.createEditableElement('h2', this.app.state.timeline.项目名称, {}, '项目名称'));
          if (readOnly) {
            const badge = document.createElement('span');
            badge.className = 'readonly-badge';
            badge.textContent = '只读模式';
            this.app.projectNameEl.appendChild(badge);
          }
          
          this.renderSaveStatusIndicator();
          this.app.shareBtn.style.display = userRole === 'Viewer' ? 'none' : 'inline-flex';
          
          this.renderViewSwitcher();
          this.renderViewSpecificControls();
          this.renderFilterSortControls();
          this.renderChat();
          
          this.app.timelineContainer.onwheel = null; // Clear wheel listeners before re-rendering view.
          if (this.app.state.currentView !== 'dependencies') {
              this.app.timelineContainer.innerHTML = "";
              this.app.timelineContainer.className = `${this.app.state.currentView}-view`;
          }
          
          switch(this.app.state.currentView) {
            case 'vertical': this.renderVerticalTimeline(this.app.state.timeline.阶段); break;
            case 'gantt': this.renderGanttChart(); break;
            case 'kanban': this.renderKanban(); break;
            case 'calendar': this.renderCalendar(); break;
            case 'workload': this.renderWorkloadView(); break;
            case 'dependencies': this.renderDependencyMap(); break;
            case 'mindmap': this.renderMindMap(); break;
          }

        } else {
          this.app.inputSection.classList.remove("hidden");
          this.app.timelineSection.classList.add("hidden");
          this.app.timelineSection.classList.remove('visible');
          this.renderHomeScreen();
        }
    }
  
    renderAuth(): void {
        this.app.authSection.classList.remove('hidden');
        this.app.inputSection.classList.add('hidden');
        this.app.timelineSection.classList.add('hidden');
        this.app.userDisplayEl.classList.add('hidden');
        
        if (this.app.state.authView === 'login') {
            this.app.loginForm.classList.remove('hidden');
            this.app.registerForm.classList.add('hidden');
            this.app.showLoginBtn.classList.add('active');
            this.app.showRegisterBtn.classList.remove('active');
        } else {
            this.app.loginForm.classList.add('hidden');
            this.app.registerForm.classList.remove('hidden');
            this.app.showLoginBtn.classList.remove('active');
            this.app.showRegisterBtn.classList.add('active');
        }
    }
    
    renderUserDisplay(): void {
        if (this.app.state.currentUser) {
            this.app.userDisplayEl.classList.remove('hidden');
            this.app.userDisplayEl.innerHTML = `
                <div class="user-info">
                  ${this.renderUserAvatar(this.app.state.currentUser.id)}
                  <span>欢迎, <strong>${this.app.state.currentUser.profile.displayName}</strong></span>
                </div>
                <div class="user-actions">
                  <button id="logout-btn" class="secondary-btn">登出</button>
                </div>
            `;
            this.app.userDisplayEl.querySelector('#logout-btn')!.addEventListener('click', () => {
                this.app.setState({ currentUser: null, timeline: null, projectsHistory: [], allUsers: [] });
            });
        } else {
            this.app.userDisplayEl.classList.add('hidden');
            this.app.userDisplayEl.innerHTML = '';
        }
    }

    renderSaveStatusIndicator(): void {
      switch (this.app.state.saveStatus) {
        case 'saving':
          this.app.saveStatusEl.innerHTML = `<div class="spinner"></div> 正在同步...`;
          break;
        case 'saved':
          this.app.saveStatusEl.innerHTML = `✓ 已同步至云端`;
          break;
        case 'error':
          this.app.saveStatusEl.innerHTML = `✗ 同步失败`;
          break;
        case 'idle':
        default:
          this.app.saveStatusEl.innerHTML = '';
          break;
      }
    }

    getUserProjects(): 时间轴数据[] {
        if (!this.app.state.currentUser) return [];
        return this.app.state.projectsHistory.filter(p => 
            p.members.some(m => m.userId === this.app.state.currentUser!.id)
        );
    }

    renderHomeScreen(): void {
        this.app.projectInput.value = "";
        const userProjects = this.getUserProjects();
        const hasHistory = userProjects.length > 0;

        this.app.historySectionEl.classList.toggle('hidden', !hasHistory);
        this.app.quickAddFormEl.classList.toggle('hidden', !hasHistory);

        if (hasHistory) {
            this.app.historyListEl.innerHTML = '';
            const projectSelect = this.app.quickAddFormEl.querySelector('#project-select') as HTMLSelectElement;
            projectSelect.innerHTML = '';

            userProjects.forEach((project) => {
                const isOwner = project.ownerId === this.app.state.currentUser?.id;
                const member = project.members.find(m => m.userId === this.app.state.currentUser?.id);
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
                itemEl.querySelector('.load-btn')!.addEventListener('click', () => this.app.handleLoadProject(project));
                if (isOwner) {
                    itemEl.querySelector('.delete-btn')!.addEventListener('click', () => this.app.handleDeleteProject(project));
                }
                this.app.historyListEl.appendChild(itemEl);

                // Populate select dropdown
                const option = document.createElement('option');
                option.value = project.id;
                option.textContent = project.项目名称;
                projectSelect.appendChild(option);
            });
        }
    }

    renderChat(): void {
        this.app.chatHistoryEl.innerHTML = '';
        this.app.state.chatHistory.forEach(msg => {
            const msgEl = document.createElement('div');
            msgEl.className = `chat-message-container`;

            const messageCore = document.createElement('div');
            messageCore.className = `chat-message ${msg.role}-message`;
            messageCore.innerHTML = `
                ${msg.role === 'model' ? 
                  `<div class="avatar" style="background-color: var(--accent-color-light); color: var(--text-primary);">助</div>` :
                  this.renderUserAvatar(this.app.state.currentUser!.id)
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
                regenBtn.onclick = () => this.app.handleRegenerateClick();

                actions.appendChild(copyBtn);
                actions.appendChild(regenBtn);
                msgEl.appendChild(actions);
            }
            this.app.chatHistoryEl.appendChild(msgEl);
        });

        if (this.app.state.isChatLoading) {
            const thinkingEl = document.createElement('div');
            thinkingEl.className = 'chat-message model-message thinking';
            thinkingEl.innerHTML = `
                <div class="avatar" style="background-color: var(--accent-color-light); color: var(--text-primary);">助</div>
                <div class="message-content">
                    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                </div>
            `;
            this.app.chatHistoryEl.appendChild(thinkingEl);
        }

        this.app.chatHistoryEl.scrollTop = this.app.chatHistoryEl.scrollHeight;
    }
  
    renderViewSwitcher(): void {
        this.app.viewSwitcherEl.innerHTML = '';
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
          btn.className = this.app.state.currentView === view.id ? 'active' : '';
          btn.onclick = () => this.app.setState({ currentView: view.id });
          this.app.viewSwitcherEl.appendChild(btn);
        });
    }

    renderViewSpecificControls(): void {
        if (!this.app.viewSpecificControlsEl) return;
        this.app.viewSpecificControlsEl.innerHTML = '';

        if (this.app.state.currentView === 'gantt') {
            this.app.viewSpecificControlsEl.classList.add('gantt-view-controls');
            const granularities: { id: GanttGranularity, name: string }[] = [
                { id: 'days', name: '日' },
                { id: 'weeks', name: '周' },
                { id: 'months', name: '月' },
            ];
            granularities.forEach(gran => {
                const btn = document.createElement('button');
                btn.textContent = gran.name;
                btn.className = this.app.state.ganttGranularity === gran.id ? 'active' : '';
                btn.onclick = () => this.app.setState({ ganttGranularity: gran.id });
                this.app.viewSpecificControlsEl!.appendChild(btn);
            });
        } else {
            this.app.viewSpecificControlsEl.classList.remove('gantt-view-controls');
        }
    }

    renderFilterSortControls(): void {
        this.app.filterSortControlsEl.innerHTML = ''; // Clear previous controls

        const allAssignees = [...new Set(this.app.state.timeline?.members.map(m => m.userId) || [])];
        
        this.app.filterSortControlsEl.appendChild(this.createMultiSelectDropdown('status', '状态', ['待办', '进行中', '已完成'], this.app.state.filters.status));
        this.app.filterSortControlsEl.appendChild(this.createMultiSelectDropdown('priority', '优先级', ['高', '中', '低'], this.app.state.filters.priority));
        this.app.filterSortControlsEl.appendChild(this.createMultiSelectDropdown('assignee', '负责人', allAssignees, this.app.state.filters.assignee));

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
        sortSelect.value = this.app.state.sortBy;
        sortSelect.addEventListener('change', (e) => this.app.setState({ sortBy: (e.target as HTMLSelectElement).value as any }));
        this.app.filterSortControlsEl.appendChild(sortGroup);
    }
  
    createMultiSelectDropdown(id: 'status' | 'priority' | 'assignee', labelText: string, options: string[], selectedOptions: string[]): HTMLElement {
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
                this.app.setState({ filters: { ...this.app.state.filters, [id]: newSelection } });
            });
            
            let optionLabel = optionValue;
            if (id === 'assignee') {
                const user = this.app.state.allUsers.find(u => u.id === optionValue);
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
              this.app.setState({ filters: { ...this.app.state.filters, [id]: [] } });
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

    createEditableElement(
        tag: 'h2' | 'h3' | 'h4', text: string,
        indices: TopLevelIndices, field: '项目名称' | '阶段名称'
    ): HTMLElement {
        const el = document.createElement(tag);
        el.textContent = text;

        if (!this.app.canEditProject()) {
            return el;
        }

        el.className = 'editable';

        el.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = text;
            input.className = 'inline-edit';
            el.replaceWith(input);
            input.focus();
            
            const save = () => {
                this.app.handleUpdateField(indices, field, input.value);
            };
            input.addEventListener('blur', save);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') input.blur();
                if (e.key === 'Escape') {
                    input.removeEventListener('blur', save);
                    input.blur();
                    this.app.render();
                }
            });
        });
        return el;
    }

    // --- MODALS ---
    showEditModal(indices: Indices, task: 任务): void {
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
        
        const flatTasks = Array.from(this.app.flattenTasks()).map(i => i.task);
        const dependencyOptions = flatTasks
            .filter(t => t.id !== task.id)
            .map(t => `<option value="${t.id}" ${task.dependencies?.includes(t.id) ? 'selected' : ''}>${t.任务名称}</option>`)
            .join('');

        const projectMembers = this.app.state.timeline?.members.map(m => this.app.state.allUsers.find(u => u.id === m.userId)).filter(Boolean) as User[];
        const knownUserIds = new Set(projectMembers.map(u => u.id));
        const taskAssigneeIds = task.负责人Ids || [];
        const taskKnownUserIds = taskAssigneeIds.filter(id => knownUserIds.has(id));
        const taskOtherNames = taskAssigneeIds.filter(id => !knownUserIds.has(id));

        const assigneeOptions = projectMembers.map(user => 
            `<option value="${user.id}" ${taskKnownUserIds.includes(user.id) ? 'selected' : ''}>${user.profile.displayName}</option>`
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
                        <label for="assignee">项目成员 (可多选)</label>
                        <select id="assignee" multiple>${assigneeOptions}</select>
                    </div>
                     <div class="form-group full-width">
                        <label for="otherAssignees">其他负责人 (用逗号分隔)</label>
                        <input type="text" id="otherAssignees" value="${taskOtherNames.join(', ')}">
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
        if (!this.app.canEditProject()) {
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
            const otherAssigneesInput = form.querySelector('#otherAssignees') as HTMLInputElement;

            const selectedDependencies = Array.from(dependenciesSelect.selectedOptions).map(option => option.value);
            const selectedAssignees = Array.from(assigneeSelect.selectedOptions).map(option => option.value);
            const otherAssignees = otherAssigneesInput.value.split(',').map(name => name.trim()).filter(Boolean);
            const allAssignees = [...new Set([...selectedAssignees, ...otherAssignees])];

            const updatedTask: 任务 = {
                ...task,
                任务名称: (form.querySelector('#taskName') as HTMLInputElement).value,
                详情: (form.querySelector('#details') as HTMLTextAreaElement).value,
                状态: (form.querySelector('#status') as HTMLSelectElement).value as '待办' | '进行中' | '已完成',
                优先级: (form.querySelector('#priority') as HTMLSelectElement).value as '高' | '中' | '低',
                负责人Ids: allAssignees,
                开始时间: formatFromDateTimeLocalValue((form.querySelector('#startTime') as HTMLInputElement).value),
                截止日期: formatFromDateTimeLocalValue((form.querySelector('#deadline') as HTMLInputElement).value),
                备注: (form.querySelector('#notes') as HTMLTextAreaElement).value,
                dependencies: selectedDependencies,
            };
            updatedTask.已完成 = updatedTask.状态 === '已完成';
            this.app.handleUpdateTask(indices, updatedTask);
            close();
        });

        modalOverlay.querySelector('.modal-close-btn')!.addEventListener('click', close);
        modalOverlay.querySelector('.cancel-btn')!.addEventListener('click', close);

        setTimeout(() => modalOverlay.classList.add('visible'), 10);
    }
  
    showMembersModal(): void {
        if (!this.app.state.timeline || !this.app.state.currentUser) return;
        const userRole = this.app.getUserRole();
        const canManage = userRole === 'Admin';

        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'members-modal-overlay';
        modalOverlay.className = 'modal-overlay';

        const renderMembersList = () => {
            const owner = this.app.state.allUsers.find(u => u.id === this.app.state.timeline!.ownerId);
            return this.app.state.timeline!.members.map(member => {
                const user = this.app.state.allUsers.find(u => u.id === member.userId);
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
            return this.app.state.allUsers
                .filter(u => !this.app.state.timeline!.members.some(m => m.userId === u.id))
                .map(u => `<option value="${u.id}">${u.profile.displayName}</option>`)
                .join('');
        };
        
        const inviteLink = `${window.location.origin}${window.location.pathname}?projectId=${this.app.state.timeline.id}`;

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
                    if (userId && this.app.state.timeline) {
                        this.app.state.timeline.members = this.app.state.timeline.members.filter(m => m.userId !== userId);
                        this.app.saveCurrentProject(this.app.state.timeline);
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
                    if(userId && this.app.state.timeline) {
                        const member = this.app.state.timeline.members.find(m => m.userId === userId);
                        if (member) {
                            member.role = newRole;
                            this.app.saveCurrentProject(this.app.state.timeline);
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
                    if (userId && role && this.app.state.timeline) {
                         this.app.state.timeline.members.push({ userId, role });
                        this.app.saveCurrentProject(this.app.state.timeline);
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

    showReportModal(isLoading: boolean, reportText: string = ''): void {
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

    // --- VIEWS ---

    renderVerticalTimeline(phases: 阶段[]): void {
        const canEdit = this.app.canEditProject();
        phases.forEach((phase, phaseIndex) => {
          const phaseId = `phase-${phaseIndex}`;
          const isCollapsed = this.app.state.collapsedItems.has(phaseId);
    
          const phaseEl = document.createElement("div");
          phaseEl.className = "phase";
          
          const phaseHeader = document.createElement('div');
          phaseHeader.className = 'phase-header';
          phaseHeader.innerHTML = `<div class="phase-icon">${phaseIndex + 1}</div>`;
          
          phaseHeader.appendChild(this.createEditableElement('h3', phase.阶段名称, { phaseIndex }, '阶段名称'));
    
          const toggleBtn = document.createElement('button');
          toggleBtn.className = `icon-btn toggle-collapse ${isCollapsed ? 'collapsed' : ''}`;
          toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
          toggleBtn.onclick = () => {
              const newSet = this.app.state.collapsedItems;
              if (newSet.has(phaseId)) newSet.delete(phaseId);
              else newSet.add(phaseId);
              this.app.setState({ collapsedItems: newSet });
          };
          phaseHeader.prepend(toggleBtn);
          phaseEl.appendChild(phaseHeader);
    
          const contentEl = document.createElement('div');
          contentEl.className = `phase-content ${isCollapsed ? 'collapsed' : ''}`;
    
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
                  contentEl.appendChild(projectEl);
              });
          }
    
          if (phase.任务) {
              contentEl.appendChild(this.createTasksList(phase.任务, { phaseIndex }, [], canEdit));
          }
    
          phaseEl.appendChild(contentEl);
          this.app.timelineContainer.appendChild(phaseEl);
        });
    }

    triggerCompletionAnimation(taskElement: HTMLElement): void {
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

    createTasksList(tasks: 任务[], baseIndices: TopLevelIndices, parentPath: number[], canEdit: boolean): HTMLElement {
        const listContainer = document.createElement('div');
        const tasksList = document.createElement("ul");
        tasksList.className = "tasks-list";

        const processedTasks = this.app.processTaskArray(tasks);

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
                        this.app.handleMoveTask(draggedIndices, dropIndices, position);
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
                this.app.handleToggleComplete(fullIndices, isChecked);
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
                addSubtaskBtn.onclick = () => this.app.handleAddTask(baseIndices, currentPath);
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
                deleteBtn.onclick = () => this.app.handleDeleteTask(fullIndices);
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
                    const user = this.app.state.allUsers.find(u => u.id === comment.发言人Id);
                    const commentEl = document.createElement('li');
                    commentEl.className = 'comment-item';
                    const timestamp = new Date(comment.时间戳).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' });

                    let attachmentsHTML = '';
                    if (comment.附件 && comment.附件.length > 0) {
                        attachmentsHTML += `<div class="comment-attachments">`;
                        comment.附件.forEach(att => {
                            attachmentsHTML += `<a href="${att.url}" target="_blank" class="comment-attachment-item">📎 ${att.name}</a>`;
                        });
                        attachmentsHTML += `</div>`;
                    }

                    commentEl.innerHTML = `
                        <div class="comment-header">
                            ${this.renderUserAvatar(comment.发言人Id)}
                            <strong class="comment-author">${user?.profile.displayName || '未知用户'}</strong>
                            <span class="comment-timestamp">${timestamp}</span>
                        </div>
                        <p class="comment-content">${comment.内容}</p>
                        ${attachmentsHTML}
                    `;
                    commentsList.appendChild(commentEl);
                });
            }
            
            const newCommentForm = document.createElement('form');
            newCommentForm.className = 'new-comment-form';
            newCommentForm.innerHTML = `
                ${this.renderUserAvatar(this.app.state.currentUser!.id)}
                <div class="new-comment-form-main">
                  <textarea placeholder="添加评论..." rows="1" required></textarea>
                  <div class="comment-form-actions">
                    <div class="attached-file-display"></div>
                    <div>
                        <input type="file" class="comment-file-input" style="display: none;">
                        <button type="button" class="icon-btn attach-btn" title="上传附件">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        </button>
                        <button type="submit" class="primary-btn">发布</button>
                    </div>
                  </div>
                </div>
            `;
            if (!canEdit) {
                newCommentForm.querySelectorAll('textarea, button').forEach(el => (el as any).disabled = true);
            }

            const fileInput = newCommentForm.querySelector('.comment-file-input') as HTMLInputElement;
            const attachBtn = newCommentForm.querySelector('.attach-btn') as HTMLButtonElement;
            const fileDisplay = newCommentForm.querySelector('.attached-file-display') as HTMLElement;
            
            attachBtn.onclick = () => fileInput.click();
            fileInput.onchange = () => {
                if (fileInput.files && fileInput.files.length > 0) {
                    fileDisplay.textContent = `已选择: ${fileInput.files[0].name}`;
                } else {
                    fileDisplay.textContent = '';
                }
            };

            newCommentForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const textarea = newCommentForm.querySelector('textarea')!;
                const file = fileInput.files?.[0];
                this.app.handleAddComment(fullIndices, textarea.value, file);
                textarea.value = '';
                fileInput.value = '';
                fileDisplay.textContent = '';
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
            addBtn.onclick = () => this.app.handleAddTask(baseIndices, parentPath);
            listContainer.appendChild(addBtn);
        }

        return listContainer;
    }
    
    renderGanttChart(): void {
        this.app.timelineContainer.onwheel = (e: WheelEvent) => {
            if (e.ctrlKey) {
                e.preventDefault();
                const zoomAmount = e.deltaY > 0 ? -10 : 10;
                const newZoom = this.app.state.ganttZoomLevel + zoomAmount;
                this.app.setState({ ganttZoomLevel: Math.max(10, Math.min(200, newZoom)) });
            }
        };
    
        const tasksWithDates = this.app.getProcessedTasks().filter(t => t.task.开始时间);
        if (tasksWithDates.length === 0) {
            this.app.timelineContainer.innerHTML = `<p>沒有符合篩選條件的任務，或任務未設置開始時間。</p>`;
            return;
        }
    
        const dates = tasksWithDates.flatMap(t => [parseDate(t.task.开始时间), parseDate(t.task.截止日期)])
                                   .filter((d): d is Date => d !== null);
        if (dates.length === 0) {
            this.app.timelineContainer.innerHTML = `<p>沒有帶日期的任務可供顯示。</p>`;
            return;
        }
        
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
    
        const { ganttGranularity: granularity, ganttZoomLevel } = this.app.state;
        
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
            this.app.timelineContainer.innerHTML = `<p>日期范围过大，请尝试使用更粗的时间粒度（周/月）。</p>`;
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
    
            const start = parseDate(task.开始时间);
            if (start) {
                const endOrDefault = parseDate(task.截止日期) || new Date(start.getTime() + 86400000);
                let startUnit = 0, duration = 0;
                
                if (granularity === 'days') {
                    startUnit = Math.floor((start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24));
                    duration = Math.ceil((endOrDefault.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) || 1;
                } else if (granularity === 'weeks') {
                    startUnit = Math.floor((start.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
                    duration = Math.ceil((endOrDefault.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 7)) || 1;
                } else { // months
                    startUnit = (start.getFullYear() - minDate.getFullYear()) * 12 + (start.getMonth() - minDate.getMonth());
                    duration = Math.ceil(((endOrDefault.getFullYear() - start.getFullYear()) * 12 + (endOrDefault.getMonth() - minDate.getMonth())) - 
                                         ((start.getFullYear() - minDate.getFullYear()) * 12 + (start.getMonth() - minDate.getMonth()))) || 1;
                }

                const statusClass = { '待办': 'todo', '进行中': 'inprogress', '已完成': 'completed' }[task.状态] || 'todo';
    
                const bar = document.createElement('div');
                bar.className = `gantt-bar gantt-bar-${statusClass}`;
                bar.style.gridColumn = `${startUnit + 1} / span ${duration}`;
                bar.title = `${task.任务名称} (${task.状态})`;
                bar.innerHTML = `<span>${task.任务名称}</span>`;
    
                bar.addEventListener('click', () => {
                    const taskData = this.app.getTaskFromPath(indices)?.task;
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
        this.app.timelineContainer.innerHTML = '';
        this.app.timelineContainer.appendChild(container);
    }
    
    renderKanban(): void {
        const statuses: TaskStatus[] = ['待办', '进行中', '已完成'];
        const board = document.createElement('div');
        board.className = 'kanban-board';

        const tasksByStatus: Record<string, any[]> = { '待办': [], '进行中': [], '已完成': [] };
        
        for (const item of this.app.getProcessedTasks()) {
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
        this.app.timelineContainer.appendChild(board);
    }

    renderCalendar(): void {
        const date = this.app.state.calendarDate;
        const year = date.getFullYear();
        const month = date.getMonth();

        const container = document.createElement('div');
        container.className = 'calendar-view';
        
        const header = document.createElement('div');
        header.className = 'calendar-header';
        const prevBtn = document.createElement('button');
        prevBtn.className = 'secondary-btn';
        prevBtn.textContent = '<';
        prevBtn.onclick = () => this.app.setState({ calendarDate: new Date(year, month - 1, 1) });
        const nextBtn = document.createElement('button');
        nextBtn.className = 'secondary-btn';
        nextBtn.textContent = '>';
        nextBtn.onclick = () => this.app.setState({ calendarDate: new Date(year, month + 1, 1) });
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

        const tasksWithDates = this.app.getProcessedTasks().filter(t => t.task.开始时间 || t.task.截止日期);

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
                const start = parseDate(task.开始时间);
                const end = parseDate(task.截止日期);
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
        this.app.timelineContainer.appendChild(container);
    }

    createCalendarEvent(task: 任务, indices: Indices, type: 'start' | 'end'): HTMLElement {
        const eventEl = document.createElement('div');
        eventEl.className = `calendar-event calendar-event-${type}`;
        eventEl.textContent = task.任务名称;
        eventEl.title = task.任务名称;
        eventEl.onclick = () => this.showEditModal(indices, task);
        return eventEl;
    }

    renderWorkloadView(): void {
        const tasks = Array.from(this.app.flattenTasks()).filter(t => t.task.负责人Ids && t.task.开始时间);
        if (tasks.length === 0) {
            this.app.timelineContainer.innerHTML = `<p>沒有可供分析的任務。請確保任務已分配負責人並設置了開始時間。</p>`;
            return;
        }
    
        const workloadData: Record<string, Record<string, { count: number, tasks: 任务[] }>> = {};
        const weekStarts = new Set<number>();
    
        tasks.forEach(({ task }) => {
            const assignees = task.负责人Ids || [];
            if (assignees.length === 0) return;
    
            const startDate = parseDate(task.开始时间);
            if (!startDate) return;
    
            const weekStart = getWeekStartDate(startDate).getTime();
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
            const userA = this.app.state.allUsers.find(u=>u.id === a);
            const userB = this.app.state.allUsers.find(u=>u.id === b);
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
            const user = this.app.state.allUsers.find(u => u.id === assigneeId);
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
        this.app.timelineContainer.appendChild(table);
    }
    
    renderDependencyMap(): void {
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

        const flatTasks = Array.from(this.app.flattenTasks());
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
                    ? this.app.state.allUsers.find(u => u.id === task.负责人Ids![0])?.profile.displayName || '未分配'
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

    renderMindMap(): void {
        if (!this.app.state.timeline) return;

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
                name: this.app.state.timeline!.项目名称,
                type: 'project',
                data: this.app.state.timeline,
                children: [],
                x: 0, y: 0, subtreeHeight: 0,
            };

            this.app.state.timeline!.阶段.forEach((phase, phaseIndex) => {
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
            const isCollapsed = this.app.state.mindMapState.collapsedNodes.has(node.id);

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
            const isCollapsed = this.app.state.mindMapState.collapsedNodes.has(node.id);

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

        this.app.timelineContainer.innerHTML = '';
        this.app.timelineContainer.className = 'mindmap-view';
        
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
            const isCollapsed = this.app.state.mindMapState.collapsedNodes.has(node.id);
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
                const isCollapsed = this.app.state.mindMapState.collapsedNodes.has(node.id);
                toggleBtn.textContent = isCollapsed ? '+' : '-';
                nodeEl.appendChild(toggleBtn);
                nodeEl.classList.toggle('collapsed', isCollapsed);
                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    const newSet = this.app.state.mindMapState.collapsedNodes;
                    if (newSet.has(node.id)) {
                        newSet.delete(node.id);
                    } else {
                        newSet.add(node.id);
                    }
                    this.app.setState({ mindMapState: { collapsedNodes: newSet } });
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

        this.app.timelineContainer.appendChild(viewport);
        this.app.timelineContainer.appendChild(controls);

        setTimeout(() => controls.querySelector<HTMLButtonElement>('button[data-action="fit"]')?.click(), 100);
    }
}
