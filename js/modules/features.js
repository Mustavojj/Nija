const FEATURES_CONFIG = {
    TASK_VERIFICATION_DELAY: 10,
    REFERRAL_BONUS_TON: 0.003,
    REFERRAL_PERCENTAGE: 10,
    REFERRALS_PER_PAGE: 10,
    PARTNER_TASK_REWARD: 0.001,
    SOCIAL_TASK_REWARD: 0.0005
};

class TaskManager {
    constructor(app) {
        this.app = app;
        this.mainTasks = [];
        this.partnerTasks = [];
        this.socialTasks = [];
        this.taskTimers = new Map();
    }

    async loadTasksData(forceRefresh = false) {
        const cacheKey = `tasks_${this.app.tgUser.id}`;
        
        if (!forceRefresh) {
            const cached = this.app.cache.get(cacheKey);
            if (cached) {
                this.partnerTasks = cached.partnerTasks || [];
                this.socialTasks = cached.socialTasks || [];
                return;
            }
        }
        
        try {
            this.partnerTasks = await this.loadTasksFromDatabase('partner');
            this.socialTasks = await this.loadTasksFromDatabase('social');
            
            this.app.cache.set(cacheKey, {
                partnerTasks: this.partnerTasks,
                socialTasks: this.socialTasks
            }, 30000);
            
        } catch (error) {
            this.partnerTasks = [];
            this.socialTasks = [];
        }
    }

    async loadTasksFromDatabase(category) {
        try {
            if (!this.app.db) return [];
            
            const tasks = [];
            const tasksSnapshot = await this.app.db.ref(`config/tasks`).once('value');
            
            if (tasksSnapshot.exists()) {
                tasksSnapshot.forEach(child => {
                    try {
                        const taskData = child.val();
                        
                        if (taskData.status !== 'active' && taskData.taskStatus !== 'active') {
                            return;
                        }
                        
                        if (taskData.category !== category) {
                            return;
                        }
                        
                        const task = { 
                            id: child.key, 
                            name: taskData.name || 'Unknown Task',
                            description: taskData.description || 'Join & Get Reward',
                            picture: taskData.picture || 'https://i.ibb.co/GvWFRrnp/ninja.png',
                            url: taskData.url || '',
                            type: taskData.type || 'channel',
                            category: category,
                            reward: this.app.safeNumber(taskData.reward || 0.001),
                            currentCompletions: taskData.currentCompletions || 0,
                            maxCompletions: taskData.maxCompletions || 999999
                        };
                        
                        if (!this.app.userCompletedTasks.has(task.id)) {
                            tasks.push(task);
                        }
                    } catch (error) {
                        console.error('Error processing task:', error);
                    }
                });
            }
            
            return tasks;
            
        } catch (error) {
            console.error(`Error loading ${category} tasks:`, error);
            return [];
        }
    }

    getPartnerTasks() {
        return this.partnerTasks;
    }

    getSocialTasks() {
        return this.socialTasks;
    }

    async checkBotAdminStatus(chatId) {
        try {
            if (!this.app.tgUser?.id) return false;
            
            const response = await fetch('/api/telegram-bot', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-user-id': this.app.tgUser.id.toString(),
                    'x-telegram-hash': this.app.tg?.initData || ''
                },
                body: JSON.stringify({
                    action: 'getChatAdministrators',
                    params: { chat_id: chatId }
                })
            });
            
            if (!response.ok) {
                console.error('Bot admin check failed');
                return false;
            }
            
            const data = await response.json();
            if (data.ok && data.result) {
                const admins = data.result;
                const isBotAdmin = admins.some(admin => {
                    const isBot = admin.user?.is_bot;
                    const isThisBot = admin.user?.username === 'NinjaTONS_Bot';
                    return isBot && isThisBot;
                });
                return isBotAdmin;
            }
            return false;
        } catch (error) {
            console.error('Error checking bot admin status:', error);
            return false;
        }
    }
    
    async checkUserMembershipWithBot(chatId) {
        try {
            const userId = this.app.tgUser?.id;
            if (!userId) return false;
            
            const response = await fetch('/api/telegram-bot', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-user-id': userId.toString(),
                    'x-telegram-hash': this.app.tg?.initData || ''
                },
                body: JSON.stringify({
                    action: 'getChatMember',
                    params: {
                        chat_id: chatId,
                        user_id: userId
                    }
                })
            });
            
            if (!response.ok) return false;
            
            const data = await response.json();
            if (!data.ok || !data.result) return false;
            
            const userStatus = data.result.status;
            return ['member', 'administrator', 'creator', 'restricted'].includes(userStatus);
        } catch (error) {
            console.error('Error checking user membership with bot:', error);
            return false;
        }
    }

    async handleTask(taskId, url, taskType, reward, button) {
        if (this.app.userCompletedTasks.has(taskId)) {
            this.app.notificationManager.showNotification("Already Completed", "You have already completed this task", "info");
            return;
        }
        
        if (this.app.isProcessingTask) {
            this.app.notificationManager.showNotification("Busy", "Please complete current task first", "warning");
            return;
        }
        
        window.open(url, '_blank');
        
        this.disableAllTaskButtons();
        this.app.isProcessingTask = true;
        
        const originalText = button.innerHTML;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Wait 10s';
        button.disabled = true;
        button.classList.remove('start');
        button.classList.add('counting');
        
        let secondsLeft = 10;
        const countdown = setInterval(() => {
            secondsLeft--;
            if (secondsLeft > 0) {
                button.innerHTML = `<i class="fas fa-clock"></i> ${secondsLeft}s`;
            } else {
                clearInterval(countdown);
                button.innerHTML = 'CHECK';
                button.disabled = false;
                button.classList.remove('counting');
                button.classList.add('check');
                
                const newButton = button.cloneNode(true);
                button.parentNode.replaceChild(newButton, button);
                
                newButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await this.handleCheckTask(taskId, url, taskType, reward, newButton);
                });
            }
        }, 1000);
        
        setTimeout(() => {
            if (secondsLeft > 0) {
                clearInterval(countdown);
                button.innerHTML = originalText;
                button.disabled = false;
                button.classList.remove('counting');
                button.classList.add('start');
                this.enableAllTaskButtons();
                this.app.isProcessingTask = false;
            }
        }, 11000);
    }

    async handleCheckTask(taskId, url, taskType, reward, button) {
        if (button) {
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
            button.disabled = true;
        }
        
        this.disableAllTaskButtons();
        this.app.isProcessingTask = true;
        
        try {
            let task = null;
            for (const t of [...this.partnerTasks, ...this.socialTasks]) {
                if (t.id === taskId) {
                    task = t;
                    break;
                }
            }
            
            if (!task) {
                throw new Error("Task not found");
            }
            
            const chatId = this.extractChatIdFromUrl(url);
            
            if (task.type === 'channel' || task.type === 'group') {
                if (chatId) {
                    const isBotAdmin = await this.checkBotAdminStatus(chatId);
                    
                    if (isBotAdmin) {
                        const isSubscribed = await this.checkUserMembershipWithBot(chatId);
                        
                        if (isSubscribed) {
                            await this.completeTask(taskId, taskType, task.reward, button);
                        } else {
                            this.app.notificationManager.showNotification(
                                "Join Required", 
                                "You need to join the channel/group first!", 
                                "error"
                            );
                            
                            this.enableAllTaskButtons();
                            this.app.isProcessingTask = false;
                            
                            if (button) {
                                button.innerHTML = 'Try Again';
                                button.disabled = false;
                                button.classList.remove('check');
                                button.classList.add('start');
                                
                                const newButton = button.cloneNode(true);
                                button.parentNode.replaceChild(newButton, button);
                                
                                newButton.addEventListener('click', async (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    await this.handleTask(taskId, url, taskType, task.reward, newButton);
                                });
                            }
                        }
                    } else {
                        this.app.notificationManager.showNotification(
                            "Task Completed!", 
                            `You have received ${task.reward.toFixed(5)} TON`, 
                            "success"
                        );
                        
                        await this.completeTask(taskId, taskType, task.reward, button);
                    }
                } else {
                    this.app.notificationManager.showNotification(
                        "Task Completed!", 
                        `You have received ${task.reward.toFixed(5)} TON`, 
                        "success"
                    );
                    
                    await this.completeTask(taskId, taskType, task.reward, button);
                }
            } else {
                await this.completeTask(taskId, taskType, task.reward, button);
            }
            
        } catch (error) {
            this.enableAllTaskButtons();
            this.app.isProcessingTask = false;
            
            if (button) {
                button.innerHTML = 'Try Again';
                button.disabled = false;
                button.classList.remove('check');
                button.classList.add('start');
                
                const newButton = button.cloneNode(true);
                button.parentNode.replaceChild(newButton, button);
                
                newButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await this.handleTask(taskId, url, taskType, reward, newButton);
                });
            }
            
            this.app.notificationManager.showNotification("Error", "Failed to verify task completion", "error");
        }
    }

    async completeTask(taskId, taskType, reward, button) {
        try {
            if (!this.app.db) return false;
            
            let task = null;
            for (const t of [...this.partnerTasks, ...this.socialTasks]) {
                if (t.id === taskId) {
                    task = t;
                    break;
                }
            }
            
            if (!task) {
                throw new Error("Task not found");
            }
            
            const taskReward = this.app.safeNumber(reward);
            
            const currentBalance = this.app.safeNumber(this.app.userState.balance);
            const totalEarned = this.app.safeNumber(this.app.userState.totalEarned);
            const totalTasks = this.app.safeNumber(this.app.userState.totalTasks);
            
            if (this.app.userCompletedTasks.has(taskId)) {
                this.app.notificationManager.showNotification("Already Completed", "This task was already completed", "info");
                return false;
            }
            
            const updates = {};
            updates.balance = currentBalance + taskReward;
            updates.totalEarned = totalEarned + taskReward;
            updates.totalTasks = totalTasks + 1;
            
            this.app.userCompletedTasks.add(taskId);
            updates.completedTasks = [...this.app.userCompletedTasks];
            
            await this.app.db.ref(`users/${this.app.tgUser.id}`).update(updates);
            
            await this.app.db.ref(`config/tasks/${taskId}/currentCompletions`).transaction(current => (current || 0) + 1);
            
            this.app.userState.balance = currentBalance + taskReward;
            this.app.userState.totalEarned = totalEarned + taskReward;
            this.app.userState.totalTasks = totalTasks + 1;
            this.app.userState.completedTasks = [...this.app.userCompletedTasks];
            
            if (button) {
                const taskCard = document.getElementById(`task-${taskId}`);
                if (taskCard) {
                    const taskBtn = taskCard.querySelector('.task-btn');
                    if (taskBtn) {
                        taskBtn.innerHTML = 'COMPLETED';
                        taskBtn.className = 'task-btn completed';
                        taskBtn.disabled = true;
                        taskCard.classList.add('task-completed');
                    }
                }
            }
            
            this.app.updateHeader();
            this.app.renderQuestsPage();
            
            await this.app.updateAppStats('totalTasks', 1);
            
            this.app.cache.delete(`tasks_${this.app.tgUser.id}`);
            this.app.cache.delete(`user_${this.app.tgUser.id}`);
            
            this.enableAllTaskButtons();
            this.app.isProcessingTask = false;

           if (this.app.userState.referredBy) {
            await this.app.processReferralTaskBonus(this.app.userState.referredBy, taskReward);
                                  }
            
            return true;
            
        } catch (error) {
            this.enableAllTaskButtons();
            this.app.isProcessingTask = false;
            
            if (button) {
                button.innerHTML = 'Try Again';
                button.disabled = false;
                button.classList.remove('check', 'completed');
                button.classList.add('start');
                
                const newButton = button.cloneNode(true);
                button.parentNode.replaceChild(newButton, button);
                
                newButton.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await this.handleTask(taskId, url, taskType, reward, newButton);
                });
            }
            
            throw error;
        }
    }

    extractChatIdFromUrl(url) {
        try {
            if (!url) return null;
            
            url = url.toString().trim();
            
            if (url.includes('t.me/')) {
                const match = url.match(/t\.me\/([^\/\?]+)/);
                if (match && match[1]) {
                    const username = match[1];
                    
                    if (username.startsWith('@')) return username;
                    
                    if (/^[a-zA-Z][a-zA-Z0-9_]{4,}$/.test(username)) return '@' + username;
                    
                    return username;
                }
            }
            
            return null;
            
        } catch (error) {
            return null;
        }
    }

    disableAllTaskButtons() {
        document.querySelectorAll('.task-btn:not(.completed):not(.counting):not(:disabled)').forEach(btn => {
            btn.disabled = true;
        });
    }

    enableAllTaskButtons() {
        document.querySelectorAll('.task-btn:not(.completed):not(.counting)').forEach(btn => {
            btn.disabled = false;
        });
    }
}

class QuestManager {
    constructor(app) {
        this.app = app;
    }

    async loadQuestsData() {
        return;
    }

    async updateQuestsProgress() {
        return;
    }
}

class ReferralManager {
    constructor(app) {
        this.app = app;
        this.recentReferrals = [];
        this.currentPage = 1;
        this.itemsPerPage = FEATURES_CONFIG.REFERRALS_PER_PAGE;
        this.isLoading = false;
        this.hasMore = true;
    }

    async loadRecentReferrals() {
        return;
    }

    async handleReferralBonus(referralId) {
        return false;
    }

    async renderReferralsPage() {
        return;
    }

    setupReferralsPageEvents() {
        return;
    }
}

export { TaskManager, QuestManager, ReferralManager };
