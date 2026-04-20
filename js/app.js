const DEFAULT_SETTINGS = {
    tonWallet: "TON-WALLET",
    minimumWithdraw: 0.05,
    referralBonus: 0.003,
    referralPercentage: 10,
    taskReward: 0.001,
    taskPrice100: 0.10,
    adRewardTon: 0.001,
    welcomeTasks: [
        { name: "Join our channel", url: "https://t.me/AksbCash", reward: 0.005 }
    ],
    defaultTaskIcon: "https://i.ibb.co/Kj9Spc3R/file-0000000030c47246abd539cab2933811.png",
    defaultUserIcon: "https://i.ibb.co/Kj9Spc3R/file-0000000030c47246abd539cab2933811.png",
    tonIcon: "https://cdn-icons-png.flaticon.com/512/12114/12114247.png"
};

const APP_CONFIG = {
    APP_NAME: "CointoCash",
    BOT_USERNAME: "CointoCash1Bot",
    MINIMUM_WITHDRAW: 0.05,
    REFERRAL_BONUS_TON: 0.003,
    REFERRAL_PERCENTAGE: 10,
    REFERRAL_BONUS_TASKS: 0,
    TASK_REWARD_BONUS: 0,
    MAX_DAILY_ADS: 999999,
    AD_COOLDOWN: 600000 
};

import { CacheManager, NotificationManager, SecurityManager, AdManager } from './modules/core.js';
import { TaskManager, QuestManager, ReferralManager } from './modules/features.js';

class CointoCashApp {
    
    constructor() {
        this.darkMode = true;
        this.tg = null;
        this.db = null;
        this.auth = null;
        this.firebaseInitialized = false;
        
        this.currentUser = null;
        this.userState = {};
        this.appConfig = APP_CONFIG;
        
        this.userCompletedTasks = new Set();
        this.partnerTasks = [];
        this.isInitialized = false;
        this.isInitializing = false;
        this.userWithdrawals = [];
        this.appStats = {
            totalUsers: 0,
            onlineUsers: 0,
            totalPayments: 0,
            totalWithdrawals: 0
        };
        
        this.pages = [
            { id: 'tasks-page', name: 'Earn', icon: 'fa-coins', color: '#3b82f6' },
            { id: 'quests-page', name: 'Quests', icon: 'fa-tasks', color: '#3b82f6' },
            { id: 'referrals-page', name: 'Invite', icon: 'fa-user-plus', color: '#3b82f6' },
            { id: 'withdraw-page', name: 'Withdraw', icon: 'fa-wallet', color: '#3b82f6' }
        ];
        
        this.cache = new CacheManager();
        this.notificationManager = null;
        this.securityManager = new SecurityManager();
        this.adManager = null;
        this.isProcessingTask = false;
        
        this.tgUser = null;
        
        this.taskManager = null;
        this.questManager = null;
        this.referralManager = null;
        
        this.currentTasksTab = 'main';
        this.isProcessingAd = false;
        this.isCopying = false;
        this.pendingReferral = null;
        
        this.referralBonusGiven = new Set();
        
        this.adTimers = {
            ad1: 0,
            ad2: 0
        };
        
        this.adCooldown = 600000;
        
        this.referralMonitorInterval = null;
        
        this.welcomeTasksShown = false;
        this.welcomeTasksCompleted = false;
        this.welcomeTasksList = [];
        
        this.remoteConfig = null;
        this.configCache = null;
        this.configTimestamp = 0;
        
        this.pendingReferralAfterWelcome = null;
        this.rateLimiter = new (this.getRateLimiterClass())();
        
        this.settings = { ...DEFAULT_SETTINGS };
        
        this.userCreatedTasks = [];
    }

    getRateLimiterClass() {
        return class RateLimiter {
            constructor() {
                this.requests = new Map();
                this.limits = {
                    'task_start': { limit: 1, window: 3000 },
                    'withdrawal': { limit: 1, window: 86400000 },
                    'ad_reward': { limit: 10, window: 300000 }
                };
            }

            checkLimit(userId, action) {
                const key = `${userId}_${action}`;
                const now = Date.now();
                const limitConfig = this.limits[action] || { limit: 5, window: 60000 };
                
                if (!this.requests.has(key)) this.requests.set(key, []);
                
                const userRequests = this.requests.get(key);
                const windowStart = now - limitConfig.window;
                const recentRequests = userRequests.filter(time => time > windowStart);
                this.requests.set(key, recentRequests);
                
                if (recentRequests.length >= limitConfig.limit) {
                    return {
                        allowed: false,
                        remaining: Math.ceil((recentRequests[0] + limitConfig.window - now) / 1000)
                    };
                }
                
                recentRequests.push(now);
                return { allowed: true };
            }
        };
    }

    async initialize() {
        if (this.isInitializing || this.isInitialized) return;
        
        this.isInitializing = true;
        
        try {
            this.showLoadingProgress(5);
            
            if (!window.Telegram || !window.Telegram.WebApp) {
                this.showError("Please open from Telegram Mini App");
                return;
            }
            
            this.tg = window.Telegram.WebApp;
            
            if (!this.tg.initDataUnsafe || !this.tg.initDataUnsafe.user) {
                this.showError("User data not available");
                return;
            }
            
            this.tgUser = this.tg.initDataUnsafe.user;
            
            this.showLoadingProgress(8);
            const multiAccountAllowed = await this.checkMultiAccount(this.tgUser.id);
            if (!multiAccountAllowed) {
                this.isInitializing = false;
                return;
            }
            
            this.showLoadingProgress(12);
            
            this.tg.ready();
            this.tg.expand();
            
            this.showLoadingProgress(15);
            this.setupTelegramTheme();
            
            this.notificationManager = new NotificationManager();
            
            this.showLoadingProgress(20);
            
            const firebaseSuccess = await this.initializeFirebase();
            
            if (firebaseSuccess) {
                this.setupFirebaseAuth();
            }
            
            this.showLoadingProgress(40);
            
            await this.loadSettingsFromFirebase();
            
            await this.loadUserData();
            
            if (this.userState.status === 'ban') {
                this.showBannedPage();
                return;
            }
            
            this.showLoadingProgress(50);
            
            this.adManager = new AdManager(this);
            this.taskManager = new TaskManager(this);
            this.questManager = new QuestManager(this);
            this.referralManager = new ReferralManager(this);
            
            this.startReferralMonitor();
            
            this.showLoadingProgress(60);
            
            try {
                await this.loadTasksData();
            } catch (taskError) {
            }
            
            this.showLoadingProgress(70);
            
            try {
                await this.loadHistoryData();
            } catch (historyError) {
            }
            
            this.showLoadingProgress(80);
            
            try {
                await this.loadAppStats();
            } catch (statsError) {
            }
            
            this.showLoadingProgress(85);
            
            try {
                await this.loadAdTimers();
                await this.loadUserCreatedTasks();
            } catch (adError) {
            }
            
            this.showLoadingProgress(90);
            this.renderUI();
            
            this.darkMode = true;
            document.body.classList.add('dark-mode');
            
            this.isInitialized = true;
            this.isInitializing = false;
            
            this.showLoadingProgress(100);
            
            setTimeout(() => {
                const appLoader = document.getElementById('app-loader');
                const app = document.getElementById('app');
                
                if (appLoader) {
                    appLoader.style.opacity = '0';
                    appLoader.style.transition = 'opacity 0.5s ease';
                    
                    setTimeout(() => {
                        appLoader.style.display = 'none';
                    }, 500);
                }
                
                if (app) {
                    app.style.display = 'block';
                    setTimeout(() => {
                        app.style.opacity = '1';
                        app.style.transition = 'opacity 0.3s ease';
                    }, 50);
                }
                
                this.showWelcomeTasksModal();
                
            }, 500);
            
        } catch (error) {
            if (this.notificationManager) {
                this.notificationManager.showNotification(
                    "Initialization Error",
                    "App loaded with limited functionality. Please refresh.",
                    "warning"
                );
            }
            
            try {
                this.userState = this.getDefaultUserState();
                this.renderUI();
                
                const appLoader = document.getElementById('app-loader');
                const app = document.getElementById('app');
                
                if (appLoader) appLoader.style.display = 'none';
                if (app) app.style.display = 'block';
                
            } catch (renderError) {
                this.showError("Failed to initialize app: " + error.message);
            }
            
            this.isInitializing = false;
        }
    }

    async loadWelcomeTasksFromFirebase() {
        try {
            if (!this.db) {
                this.welcomeTasksList = this.settings.welcomeTasks || DEFAULT_SETTINGS.welcomeTasks;
                return;
            }
            
            const welcomeTasksRef = await this.db.ref('config/welcomeTasks').once('value');
            if (welcomeTasksRef.exists()) {
                const tasks = [];
                welcomeTasksRef.forEach(child => {
                    tasks.push({
                        id: child.key,
                        ...child.val()
                    });
                });
                if (tasks.length > 0) {
                    this.welcomeTasksList = tasks;
                    return;
                }
            }
            
            this.welcomeTasksList = this.settings.welcomeTasks || DEFAULT_SETTINGS.welcomeTasks;
        } catch (error) {
            this.welcomeTasksList = this.settings.welcomeTasks || DEFAULT_SETTINGS.welcomeTasks;
        }
    }

    async loadSettingsFromFirebase() {
        try {
            if (!this.db) return;
            
            const settingsRef = await this.db.ref('settings').once('value');
            if (settingsRef.exists()) {
                const settings = settingsRef.val();
                if (settings.tonWallet) this.settings.tonWallet = settings.tonWallet;
                if (settings.minimumWithdraw) this.settings.minimumWithdraw = settings.minimumWithdraw;
                if (settings.referralBonus) this.settings.referralBonus = settings.referralBonus;
                if (settings.referralPercentage) this.settings.referralPercentage = settings.referralPercentage;
                if (settings.taskReward) this.settings.taskReward = settings.taskReward;
                if (settings.taskPrice100) this.settings.taskPrice100 = settings.taskPrice100;
                if (settings.adRewardTon) this.settings.adRewardTon = settings.adRewardTon;
                if (settings.defaultTaskIcon) this.settings.defaultTaskIcon = settings.defaultTaskIcon;
                if (settings.defaultUserIcon) this.settings.defaultUserIcon = settings.defaultUserIcon;
                if (settings.tonIcon) this.settings.tonIcon = settings.tonIcon;
                if (settings.welcomeTasks) this.settings.welcomeTasks = settings.welcomeTasks;
            }
            
            await this.loadWelcomeTasksFromFirebase();
        } catch (error) {
        }
    }

    async initializeFirebase() {
        try {
            if (typeof firebase === 'undefined') {
                throw new Error('Firebase SDK not loaded');
            }
            
            let firebaseConfig;
            try {
                const response = await fetch('/api/firebase-config', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-telegram-user': this.tgUser?.id?.toString() || '',
                        'x-telegram-auth': this.tg?.initData || ''
                    }
                });
                
                if (response.ok) {
                    firebaseConfig = await response.json();
                } else {
                    throw new Error('Failed to load Firebase config from API');
                }
            } catch (apiError) {
                firebaseConfig = {
                    apiKey: "fallback-key-123",
                    authDomain: "fallback.firebaseapp.com",
                    databaseURL: "https://fallback-default-rtdb.firebaseio.com",
                    projectId: "fallback-project",
                    storageBucket: "fallback.firebasestorage.app",
                    messagingSenderId: "1234567890",
                    appId: "1:1234567890:web:abcdef123456",
                    measurementId: "G-XXXXXXX"
                };
            }
            
            let firebaseApp;
            
            try {
                firebaseApp = firebase.initializeApp(firebaseConfig);
            } catch (error) {
                if (error.code === 'app/duplicate-app') {
                    firebaseApp = firebase.app();
                } else {
                    throw error;
                }
            }
            
            this.db = firebaseApp.database();
            this.auth = firebaseApp.auth();
            
            try {
                await this.auth.signInAnonymously();
            } catch (authError) {
                const randomEmail = `user_${this.tgUser.id}_${Date.now()}@cointocash.app`;
                const randomPassword = Math.random().toString(36).slice(-10) + Date.now().toString(36);
                
                await this.auth.createUserWithEmailAndPassword(randomEmail, randomPassword);
            }
            
            await new Promise((resolve, reject) => {
                const unsubscribe = this.auth.onAuthStateChanged((user) => {
                    if (user) {
                        unsubscribe();
                        this.currentUser = user;
                        resolve(user);
                    }
                });
                
                setTimeout(() => {
                    unsubscribe();
                    reject(new Error('Authentication timeout'));
                }, 10000);
            });
            
            this.firebaseInitialized = true;
            
            return true;
            
        } catch (error) {
            this.notificationManager?.showNotification(
                "Authentication Error",
                "Failed to connect to database. Some features may not work.",
                "error"
            );
            
            return false;
        }
    }

    setupFirebaseAuth() {
        if (!this.auth) return;
        
        this.auth.onAuthStateChanged(async (user) => {
            if (user) {
                this.currentUser = user;
                
                if (this.userState.firebaseUid !== user.uid) {
                    this.userState.firebaseUid = user.uid;
                    await this.syncUserWithFirebase();
                }
            } else {
                try {
                    await this.auth.signInAnonymously();
                } catch (error) {
                }
            }
        });
    }

    async syncUserWithFirebase() {
        try {
            if (!this.db || !this.auth.currentUser) {
                return;
            }
            
            const firebaseUid = this.auth.currentUser.uid;
            const telegramId = this.tgUser.id;
            
            const userRef = this.db.ref(`users/${telegramId}`);
            const userSnapshot = await userRef.once('value');
            
            if (!userSnapshot.exists()) {
                const userData = {
                    ...this.getDefaultUserState(),
                    firebaseUid: firebaseUid,
                    telegramId: telegramId,
                    createdAt: Date.now(),
                    lastSynced: Date.now()
                };
                
                await userRef.set(userData);
            } else {
                await userRef.update({
                    firebaseUid: firebaseUid,
                    lastSynced: Date.now()
                });
            }
            
        } catch (error) {
        }
    }

    async loadUserData(forceRefresh = false) {
        const cacheKey = `user_${this.tgUser.id}`;
        
        if (!forceRefresh) {
            const cachedData = this.cache.get(cacheKey);
            if (cachedData) {
                this.userState = cachedData;
                this.updateHeader();
                return;
            }
        }
        
        try {
            if (!this.db || !this.firebaseInitialized || !this.auth?.currentUser) {
                this.userState = this.getDefaultUserState();
                this.updateHeader();
                
                if (this.auth && !this.auth.currentUser) {
                    setTimeout(() => {
                        this.initializeFirebase();
                    }, 2000);
                }
                
                return;
            }
            
            const telegramId = this.tgUser.id;
            
            const userRef = this.db.ref(`users/${telegramId}`);
            const userSnapshot = await userRef.once('value');
            
            let userData;
            
            if (userSnapshot.exists()) {
                userData = userSnapshot.val();
                userData = await this.updateExistingUser(userRef, userData);
            } else {
                userData = await this.createNewUser(userRef);
            }
            
            if (userData.firebaseUid !== this.auth.currentUser.uid) {
                await userRef.update({
                    firebaseUid: this.auth.currentUser.uid,
                    lastUpdated: Date.now()
                });
                userData.firebaseUid = this.auth.currentUser.uid;
            }
            
            this.userState = userData;
            this.cache.set(cacheKey, userData, 60000);
            this.updateHeader();
            
        } catch (error) {
            this.userState = this.getDefaultUserState();
            this.updateHeader();
            
            this.notificationManager?.showNotification(
                "Data Sync Error",
                "Using local data. Will sync when connection improves.",
                "warning"
            );
        }
    }

    getDefaultUserState() {
        return {
            id: this.tgUser.id,
            username: this.tgUser.username ? `@${this.tgUser.username}` : 'No Username',
            telegramId: this.tgUser.id,
            firstName: this.getShortName(this.tgUser.first_name || 'User'),
            photoUrl: this.settings.defaultUserIcon,
            balance: 0,
            referrals: 0,
            totalEarned: 0,
            totalTasks: 0,
            totalWithdrawals: 0,
            completedTasks: [],
            referralEarnings: 0,
            status: 'free',
            lastUpdated: Date.now(),
            firebaseUid: this.auth?.currentUser?.uid || null,
        };
    }

    async createNewUser(userRef) {
        const multiAccountAllowed = await this.checkMultiAccount(this.tgUser.id, false);
        if (!multiAccountAllowed) {
            return this.getDefaultUserState();
        }
        
        let referralId = null;
        const startParam = this.tg?.initDataUnsafe?.start_param;
        
        if (startParam) {
            referralId = this.extractReferralId(startParam);
            
            if (referralId && referralId > 0 && referralId !== this.tgUser.id) {
                const referrerRef = this.db.ref(`users/${referralId}`);
                const referrerSnapshot = await referrerRef.once('value');
                if (referrerSnapshot.exists()) {
                    this.pendingReferralAfterWelcome = referralId;
                    
                    await this.db.ref(`referrals/${referralId}/${this.tgUser.id}`).set({
                        userId: this.tgUser.id,
                        username: this.tgUser.username ? `@${this.tgUser.username}` : 'No Username',
                        firstName: this.getShortName(this.tgUser.first_name || ''),
                        photoUrl: this.settings.defaultUserIcon,
                        joinedAt: Date.now(),
                        state: 'pending',
                        bonusGiven: false,
                    });
                } else {
                    referralId = null;
                }
            } else {
                referralId = null;
            }
        }
        
        const userData = {
            id: this.tgUser.id,
            username: this.tgUser.username ? `@${this.tgUser.username}` : 'No Username',
            telegramId: this.tgUser.id,
            firstName: this.tgUser.first_name,
            photoUrl: this.settings.defaultUserIcon,
            balance: 0,
            referrals: 0,
            referredBy: referralId,
            totalEarned: 0,
            totalTasks: 0,
            totalWithdrawals: 0,
            referralEarnings: 0,
            completedTasks: [],
            createdAt: Date.now(),
            lastActive: Date.now(),
            status: 'free',
            referralState: referralId ? 'pending' : null,
            firebaseUid: this.auth?.currentUser?.uid || null,
        };
        
        await userRef.set(userData);
        
        try {
            await this.updateAppStats('totalUsers', 1);
        } catch (statsError) {}
        
        return userData;
    }

    async checkMultiAccount(tgId, showBanPage = true) {
        try {
            const ip = await this.getUserIP();
            if (!ip) return true;
            
            const ipData = JSON.parse(localStorage.getItem("ip_records")) || {};
            
            if (ipData[ip] && ipData[ip] !== tgId) {
                if (showBanPage) {
                    this.showMultiAccountBanPage();
                }
                
                try {
                    if (this.db) {
                        await this.db.ref(`users/${tgId}`).update({
                            status: 'ban',
                            banReason: 'Multiple accounts detected on same IP',
                            bannedAt: Date.now()
                        });
                    }
                } catch (error) {}
                
                return false;
            }
            
            if (!ipData[ip]) {
                ipData[ip] = tgId;
                localStorage.setItem("ip_records", JSON.stringify(ipData));
            }
            
            return true;
        } catch (error) {
            return true;
        }
    }

    showMultiAccountBanPage() {
        document.body.innerHTML = `
            <div style="
                background-color:#000000;
                color:#fff;
                height:100vh;
                display:flex;
                justify-content:center;
                align-items:center;
                font-family:-apple-system, BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                padding:20px;
            ">
                <div style="
                    background:#111111;
                    border-radius:22px;
                    padding:40px 30px;
                    width:85%;
                    max-width:330px;
                    text-align:center;
                    box-shadow:0 0 40px rgba(0,0,0,0.5);
                    border:1px solid rgba(255,255,255,0.08);
                    animation:fadeIn 0.6s ease-out;
                ">
                    <div style="margin-bottom:24px;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ff4d4d" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="animation:pulse 1.8s infinite ease-in-out;">
                            <circle cx="12" cy="12" r="10" stroke="#ff4d4d"/>
                            <line x1="15" y1="9" x2="9" y2="15" stroke="#ff4d4d"/>
                            <line x1="9" y1="9" x2="15" y2="15" stroke="#ff4d4d"/>
                        </svg>
                    </div>
                    <h2 style="
                        font-size:18px;
                        font-weight:600;
                        color:#fff;
                        letter-spacing:0.5px;
                    ">Multi accounts not allowed</h2>
                    <p style="
                        margin-top:10px;
                        color:#9da5b4;
                        font-size:14px;
                        line-height:1.5;
                    ">Access for this device has been blocked.<br>Multiple Telegram accounts detected on the same IP.</p>
                </div>
            </div>

            <style>
                @keyframes fadeIn {
                    from { opacity:0; transform:scale(0.97); }
                    to { opacity:1; transform:scale(1); }
                }
                @keyframes pulse {
                    0% { transform:scale(1); opacity:1; }
                    50% { transform:scale(1.1); opacity:0.8; }
                    100% { transform:scale(1); opacity:1; }
                }
            </style>
        `;
    }

    async getUserIP() {
        try {
            const res = await fetch("https://api.ipify.org?format=json");
            const data = await res.json();
            return data.ip;
        } catch (e) {
            return null;
        }
    }

    async updateExistingUser(userRef, userData) {
        await userRef.update({ 
            lastActive: Date.now(),
            username: this.tgUser.username ? `@${this.tgUser.username}` : 'No Username',
            firstName: (userData.firstName || this.getShortName(this.tgUser.first_name || 'User')).substring(0, 10)
        });
        
        if (userData.completedTasks && Array.isArray(userData.completedTasks)) {
            this.userCompletedTasks = new Set(userData.completedTasks);
        } else {
            this.userCompletedTasks = new Set();
            userData.completedTasks = [];
            await userRef.update({ completedTasks: [] });
        }
        
        const defaultData = {
            referralCode: userData.referralCode || this.generateReferralCode(),
            lastDailyCheckin: userData.lastDailyCheckin || 0,
            status: userData.status || 'free',
            referralState: userData.referralState || 'verified',
            referralEarnings: userData.referralEarnings || 0,
            totalEarned: userData.totalEarned || 0,
            totalTasks: userData.totalTasks || 0,
            totalWithdrawals: userData.totalWithdrawals || 0,
            balance: userData.balance || 0,
            referrals: userData.referrals || 0,
            firebaseUid: this.auth?.currentUser?.uid || userData.firebaseUid || null,
            welcomeTasksCompleted: userData.welcomeTasksCompleted || false,
            welcomeTasksCompletedAt: userData.welcomeTasksCompletedAt || null
        };
        
        const updates = {};
        Object.keys(defaultData).forEach(key => {
            if (userData[key] === undefined) {
                updates[key] = defaultData[key];
                userData[key] = defaultData[key];
            }
        });
        
        if (Object.keys(updates).length > 0) {
            await userRef.update(updates);
        }
        
        return userData;
    }

    extractReferralId(startParam) {
        if (!startParam) return null;
        
        if (!isNaN(startParam)) {
            return parseInt(startParam);
        } else if (startParam.includes('startapp=')) {
            const match = startParam.match(/startapp=(\d+)/);
            if (match && match[1]) {
                return parseInt(match[1]);
            }
        } else if (startParam.includes('=')) {
            const parts = startParam.split('=');
            if (parts.length > 1 && !isNaN(parts[1])) {
                return parseInt(parts[1]);
            }
        }
        
        return null;
    }

    async processReferralRegistrationWithBonus(referrerId, newUserId) {
        try {
            if (!this.db) return;
            
            const referrerRef = this.db.ref(`users/${referrerId}`);
            const referrerSnapshot = await referrerRef.once('value');
            
            if (!referrerSnapshot.exists()) return;
            
            const referrerData = referrerSnapshot.val();
            
            if (referrerData.status === 'ban') return;
            
            const referralBonus = this.settings.referralBonus;
            
            const newBalance = this.safeNumber(referrerData.balance) + referralBonus;
            const newReferrals = (referrerData.referrals || 0) + 1;
            const newReferralEarnings = this.safeNumber(referrerData.referralEarnings) + referralBonus;
            const newTotalEarned = this.safeNumber(referrerData.totalEarned) + referralBonus;
            
            await referrerRef.update({
                balance: newBalance,
                referrals: newReferrals,
                referralEarnings: newReferralEarnings,
                totalEarned: newTotalEarned
            });
            
            await this.db.ref(`referrals/${referrerId}/${newUserId}`).update({
                state: 'verified',
                bonusGiven: true,
                verifiedAt: Date.now(),
                bonusAmount: referralBonus
            });
            
            await this.db.ref(`users/${newUserId}`).update({
                referralState: 'verified'
            });
            
            if (this.tgUser && referrerId === this.tgUser.id) {
                this.userState.balance = newBalance;
                this.userState.referrals = newReferrals;
                this.userState.referralEarnings = newReferralEarnings;
                this.userState.totalEarned = newTotalEarned;
                
                this.updateHeader();
            }
            
            await this.refreshReferralsList();
            
        } catch (error) {
        }
    }

    async processReferralTaskBonus(referrerId, taskReward) {
        try {
            if (!this.db) return;
            if (!referrerId || referrerId === this.tgUser.id) return;
            
            const referrerRef = this.db.ref(`users/${referrerId}`);
            const referrerSnapshot = await referrerRef.once('value');
            
            if (!referrerSnapshot.exists()) return;
            
            const referrerData = referrerSnapshot.val();
            
            if (referrerData.status === 'ban') return;
            
            const referralPercentage = this.settings.referralPercentage;
            const referralBonus = (taskReward * referralPercentage) / 100;
            
            if (referralBonus <= 0) return;
            
            const newBalance = this.safeNumber(referrerData.balance) + referralBonus;
            const newReferralEarnings = this.safeNumber(referrerData.referralEarnings) + referralBonus;
            const newTotalEarned = this.safeNumber(referrerData.totalEarned) + referralBonus;
            
            await referrerRef.update({
                balance: newBalance,
                referralEarnings: newReferralEarnings,
                totalEarned: newTotalEarned
            });
            
            await this.db.ref(`referralTasks/${referrerId}`).push({
                userId: this.tgUser.id,
                taskReward: taskReward,
                referralBonus: referralBonus,
                percentage: referralPercentage,
                createdAt: Date.now()
            });
            
            if (referrerId === this.tgUser.id) {
                this.userState.balance = newBalance;
                this.userState.referralEarnings = newReferralEarnings;
                this.userState.totalEarned = newTotalEarned;
                
                this.updateHeader();
            }
            
        } catch (error) {
        }
    }

    async loadTasksData() {
        try {
            if (this.taskManager) {
                return await this.taskManager.loadTasksData();
            }
            return [];
        } catch (error) {
            return [];
        }
    }

    async loadHistoryData() {
        try {
            if (!this.db) {
                this.userWithdrawals = [];
                return;
            }
            
            const statuses = ['pending', 'completed', 'rejected'];
            const withdrawalPromises = statuses.map(status => 
                this.db.ref(`withdrawals/${status}`).orderByChild('userId').equalTo(this.tgUser.id).once('value')
            );
            
            const withdrawalSnapshots = await Promise.all(withdrawalPromises);
            this.userWithdrawals = [];
            
            withdrawalSnapshots.forEach(snap => {
                snap.forEach(child => {
                    this.userWithdrawals.push({ id: child.key, ...child.val() });
                });
            });
            
            this.userWithdrawals.sort((a, b) => (b.createdAt || b.timestamp) - (a.createdAt || a.timestamp));
            
        } catch (error) {
            this.userWithdrawals = [];
        }
    }

    async loadAppStats() {
        try {
            if (!this.db) {
                this.appStats = {
                    totalUsers: 0,
                    onlineUsers: 0,
                    totalPayments: 0,
                    totalWithdrawals: 0
                };
                return;
            }
            
            const statsSnapshot = await this.db.ref('appStats').once('value');
            if (statsSnapshot.exists()) {
                const stats = statsSnapshot.val();
                const totalUsers = this.safeNumber(stats.totalUsers || 0);
                const minOnline = Math.floor(totalUsers * 0.05);
                const maxOnline = Math.floor(totalUsers * 0.20);
                const onlineUsers = Math.floor(Math.random() * (maxOnline - minOnline + 1)) + minOnline;
                
                this.appStats = {
                    totalUsers: totalUsers,
                    onlineUsers: Math.max(onlineUsers, Math.floor(totalUsers * 0.05)),
                    totalPayments: this.safeNumber(stats.totalPayments || 0),
                    totalWithdrawals: this.safeNumber(stats.totalWithdrawals || 0)
                };
            } else {
                this.appStats = {
                    totalUsers: 0,
                    onlineUsers: 0,
                    totalPayments: 0,
                    totalWithdrawals: 0
                };
                await this.db.ref('appStats').set(this.appStats);
            }
            
        } catch (error) {
            this.appStats = {
                totalUsers: 0,
                onlineUsers: 0,
                totalPayments: 0,
                totalWithdrawals: 0
            };
        }
    }

    async updateAppStats(stat, value = 1) {
        try {
            if (!this.db) return;
            
            if (stat === 'totalUsers') {
                const newTotal = (this.appStats.totalUsers || 0) + value;
                const minOnline = Math.floor(newTotal * 0.05);
                const maxOnline = Math.floor(newTotal * 0.20);
                const onlineUsers = Math.floor(Math.random() * (maxOnline - minOnline + 1)) + minOnline;
                
                await this.db.ref('appStats/onlineUsers').set(Math.max(onlineUsers, Math.floor(newTotal * 0.05)));
            }
            
            await this.db.ref(`appStats/${stat}`).transaction(current => (current || 0) + value);
            this.appStats[stat] = (this.appStats[stat] || 0) + value;
            
            if (stat === 'totalUsers') {
                await this.loadAppStats();
            }
        } catch (error) {}
    }

    async showWelcomeTasksModal() {
        if (this.userState.welcomeTasksCompleted) {
            this.showPage('tasks-page');
            return;
        }
        
        if (this.welcomeTasksList.length === 0) {
            await this.loadWelcomeTasksFromFirebase();
        }
        
        const modal = document.createElement('div');
        modal.className = 'welcome-tasks-modal';
        
        const tasksHtml = this.welcomeTasksList.map((task, index) => `
            <div class="welcome-task-item" id="welcome-task-${index}">
                <div class="welcome-task-info">
                    <h4>${this.escapeHtml(task.name)}</h4>
                    <div class="welcome-task-reward">Reward: ${(task.reward || 0.005).toFixed(3)} TON</div>
                </div>
                <div style="flex-direction: column; align-items: flex-end;">
                    <button class="welcome-task-btn" id="welcome-task-btn-${index}" 
                            data-url="${task.url}" 
                            data-reward="${task.reward || 0.005}"
                            data-name="${this.escapeHtml(task.name)}">
                        <i class="fas fa-external-link-alt"></i> Join
                    </button>
                    <div class="welcome-task-error" id="welcome-task-error-${index}"></div>
                </div>
            </div>
        `).join('');
        
        const totalReward = this.welcomeTasksList.reduce((sum, task) => sum + (task.reward || 0.005), 0);
        
        modal.innerHTML = `
            <div class="welcome-tasks-content">
                <div class="welcome-header">
                    <div class="welcome-icon">
                        <i class="fas fa-gift"></i>
                    </div>
                    <h3>Welcome Tasks</h3>
                  </div>
                
                <div class="welcome-tasks-list">
                    ${tasksHtml}
                </div>
                
                <div class="welcome-footer">
                    <button class="check-welcome-btn" id="check-welcome-btn" disabled>
                        <i class="fas fa-check-circle"></i> Check & Get ${totalReward.toFixed(3)} TON
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const app = this;
        const clickedTasks = {};
        const taskRewards = {};
        
        this.welcomeTasksList.forEach((task, index) => {
            clickedTasks[index] = false;
            taskRewards[index] = task.reward || 0.005;
        });
        
        function updateCheckButton() {
            const checkBtn = document.getElementById('check-welcome-btn');
            const allClicked = Object.values(clickedTasks).every(v => v === true);
            
            if (allClicked && checkBtn) {
                checkBtn.disabled = false;
            }
        }
        
        function showTaskError(taskId, message) {
            const errorDiv = document.getElementById(`welcome-task-error-${taskId}`);
            if (errorDiv) {
                errorDiv.textContent = message;
                errorDiv.classList.add('show');
                setTimeout(() => {
                    errorDiv.classList.remove('show');
                }, 3000);
            }
        }
        
        this.welcomeTasksList.forEach((task, index) => {
            const btn = document.getElementById(`welcome-task-btn-${index}`);
            if (btn) {
                btn.addEventListener('click', async () => {
                    const url = btn.getAttribute('data-url');
                    const channelUsername = this.extractChannelUsername(url);
                    window.open(url, '_blank');
                    
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                    btn.disabled = true;
                    
                    setTimeout(async () => {
                        try {
                            let isMember = false;
                            if (channelUsername) {
                                isMember = await app.checkTelegramMembership(channelUsername);
                            } else {
                                isMember = true;
                            }
                            
                            if (isMember) {
                                btn.innerHTML = '<i class="fas fa-check"></i> Joined';
                                btn.classList.add('completed');
                                clickedTasks[index] = true;
                                const errorDiv = document.getElementById(`welcome-task-error-${index}`);
                                if (errorDiv) {
                                    errorDiv.classList.remove('show');
                                }
                            } else {
                                btn.innerHTML = originalText;
                                btn.disabled = false;
                                clickedTasks[index] = false;
                                showTaskError(index, `Please join ${task.name} first`);
                            }
                            
                            updateCheckButton();
                            
                        } catch (error) {
                            btn.innerHTML = originalText;
                            btn.disabled = false;
                            showTaskError(index, 'Verification failed. Please try again.');
                        }
                    }, 10000);
                });
            }
        });
        
        const checkBtn = document.getElementById('check-welcome-btn');
        if (checkBtn) {
            checkBtn.addEventListener('click', async () => {
                if (checkBtn.disabled) return;
                
                checkBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verifying...';
                checkBtn.disabled = true;
                
                try {
                    const verificationResult = await app.verifyWelcomeTasks();
                    
                    if (verificationResult.success) {
                        await app.completeWelcomeTasks();
                        modal.remove();
                        app.showPage('tasks-page');
                        app.notificationManager.showNotification("Success", `Welcome tasks completed! +${totalReward.toFixed(3)} TON`, "success");
                    } else {
                        checkBtn.innerHTML = '<i class="fas fa-check-circle"></i> Check & Get ' + totalReward.toFixed(3) + ' TON';
                        checkBtn.disabled = false;
                        
                        if (verificationResult.missing.length > 0) {
                            const missingItems = verificationResult.missing.join(', ');
                            app.notificationManager.showNotification("Incomplete", `Please join: ${missingItems}`, "warning");
                        }
                    }
                } catch (error) {
                    app.notificationManager.showNotification("Error", "Failed to verify tasks", "error");
                    checkBtn.innerHTML = '<i class="fas fa-check-circle"></i> Check & Get ' + totalReward.toFixed(3) + ' TON';
                    checkBtn.disabled = false;
                }
            });
        }
        
        this.welcomeTasksShown = true;
    }
    
    extractChannelUsername(url) {
        try {
            if (!url) return null;
            const match = url.match(/t\.me\/([^\/\?]+)/);
            if (match && match[1]) {
                let username = match[1];
                if (!username.startsWith('@')) {
                    username = '@' + username;
                }
                return username;
            }
            return null;
        } catch (error) {
            return null;
        }
    }
    
    async verifyWelcomeTasks() {
        try {
            const missingChannels = [];
            const verifiedChannels = [];
            
            for (const task of this.welcomeTasksList) {
                const channelUsername = this.extractChannelUsername(task.url);
                let isMember = false;
                
                if (channelUsername) {
                    isMember = await this.checkTelegramMembership(channelUsername);
                } else {
                    isMember = true;
                }
                
                if (isMember) {
                    verifiedChannels.push(task.name);
                } else {
                    missingChannels.push(task.name);
                }
                
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            return {
                success: missingChannels.length === 0,
                verified: verifiedChannels,
                missing: missingChannels
            };
            
        } catch (error) {
            return {
                success: false,
                verified: [],
                missing: this.welcomeTasksList.map(t => t.name)
            };
        }
    }
    
    async checkTelegramMembership(channelUsername) {
        try {
            if (!this.tgUser || !this.tgUser.id) {
                return false;
            }
            
            const response = await fetch('/api/telegram-bot', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-user-id': this.tgUser.id.toString(),
                    'x-telegram-hash': this.tg?.initData || ''
                },
                body: JSON.stringify({
                    action: 'getChatMember',
                    params: {
                        chat_id: channelUsername,
                        user_id: this.tgUser.id
                    }
                })
            });
            
            if (!response.ok) {
                return false;
            }
            
            const data = await response.json();
            
            if (data.ok && data.result) {
                const status = data.result.status;
                const isMember = (status === 'member' || status === 'administrator' || 
                                status === 'creator' || status === 'restricted');
                return isMember;
            }
            
            return false;
            
        } catch (error) {
            return false;
        }
    }
    
    async completeWelcomeTasks() {
        try {
            const totalReward = this.welcomeTasksList.reduce((sum, task) => sum + (task.reward || 0.005), 0);
            const currentBalance = this.safeNumber(this.userState.balance);
            const newBalance = currentBalance + totalReward;
            
            if (this.db) {
                await this.db.ref(`users/${this.tgUser.id}`).update({
                    balance: newBalance,
                    totalEarned: this.safeNumber(this.userState.totalEarned) + totalReward,
                    totalTasks: this.safeNumber(this.userState.totalTasks),
                    welcomeTasksCompleted: true,
                    welcomeTasksCompletedAt: Date.now(),
                    welcomeTasksVerifiedAt: Date.now()
                });
            }
            
            this.userState.balance = newBalance;
            this.userState.totalEarned = this.safeNumber(this.userState.totalEarned) + totalReward;
            this.userState.welcomeTasksCompleted = true;
            this.userState.welcomeTasksCompletedAt = Date.now();
            this.userState.welcomeTasksVerifiedAt = Date.now();
            
            if (this.pendingReferralAfterWelcome) {
                const referrerId = this.pendingReferralAfterWelcome;
                await this.processReferralRegistrationWithBonus(referrerId, this.tgUser.id);
                this.pendingReferralAfterWelcome = null;
            }
            
            this.cache.delete(`user_${this.tgUser.id}`);
            this.updateHeader();
            
            return true;
        } catch (error) {
            return false;
        }
    }

    startReferralMonitor() {
        if (this.referralMonitorInterval) {
            clearInterval(this.referralMonitorInterval);
        }
        
        this.referralMonitorInterval = setInterval(async () => {
            await this.checkReferralsVerification();
        }, 30000);
    }

    async checkReferralsVerification() {
        try {
            if (!this.db || !this.tgUser) return;
            
            const referralsRef = await this.db.ref(`referrals/${this.tgUser.id}`).once('value');
            if (!referralsRef.exists()) return;
            
            const referrals = referralsRef.val();
            let updated = false;
            
            for (const referralId in referrals) {
                const referral = referrals[referralId];
                
                if (referral.state === 'pending') {
                    const newUserRef = await this.db.ref(`users/${referralId}`).once('value');
                    if (newUserRef.exists()) {
                        const newUserData = newUserRef.val();
                        
                        if (newUserData.welcomeTasksCompleted) {
                            await this.processReferralRegistrationWithBonus(this.tgUser.id, referralId);
                            updated = true;
                        }
                    }
                }
            }
            
            if (updated) {
                this.cache.delete(`user_${this.tgUser.id}`);
                this.cache.delete(`referrals_${this.tgUser.id}`);
                
                if (document.getElementById('referrals-page')?.classList.contains('active')) {
                    this.renderReferralsPage();
                }
            }
            
        } catch (error) {
        }
    }

    async loadAdTimers() {
        try {
            const savedTimers = localStorage.getItem(`ad_timers_${this.tgUser.id}`);
            if (savedTimers) {
                this.adTimers = JSON.parse(savedTimers);
            }
        } catch (error) {
            this.adTimers = {
                ad1: 0,
                ad2: 0
            };
        }
    }

    async saveAdTimers() {
        try {
            localStorage.setItem(`ad_timers_${this.tgUser.id}`, JSON.stringify(this.adTimers));
        } catch (error) {
        }
    }

    setupTelegramTheme() {
        if (!this.tg) return;
        
        this.darkMode = true;
        document.body.classList.add('dark-mode');
        
        this.tg.onEvent('themeChanged', () => {
            this.darkMode = true;
            document.body.classList.add('dark-mode');
        });
    }

    showLoadingProgress(percent) {
        const progressBar = document.getElementById('loading-progress-bar');
        if (progressBar) {
            progressBar.style.width = percent + '%';
            progressBar.style.transition = 'width 0.3s ease';
        }
        
        const loadingPercentage = document.getElementById('loading-percentage');
        if (loadingPercentage) {
            loadingPercentage.textContent = `${percent}%`;
        }
    }

    showError(message) {
        document.body.innerHTML = `
            <div class="error-container">
                <div class="error-content">
                    <div class="error-header">
                        <div class="error-icon">
                            <i class="fab fa-telegram"></i>
                        </div>
                        <h2>CointoCash</h2>
                    </div>
                    
                    <div class="error-message">
                        <div class="error-icon-wrapper">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <h3>Error</h3>
                        <p>${message}</p>
                    </div>
                    
                    <button onclick="window.location.reload()" class="reload-btn">
                        <i class="fas fa-redo"></i> Reload App
                    </button>
                </div>
            </div>
        `;
    }

    showBannedPage() {
        document.body.innerHTML = `
            <div class="banned-container">
                <div class="banned-content">
                    <div class="banned-header">
                        <div class="banned-icon">
                            <i class="fas fa-ban"></i>
                        </div>
                        <h2>Account Banned</h2>
                        <p>Your account has been suspended</p>
                    </div>
                    
                    <div class="ban-reason">
                        <div class="ban-reason-icon">
                            <i class="fas fa-exclamation-circle"></i>
                        </div>
                        <h3>Ban Reason</h3>
                        <p>${this.userState.banReason || 'Violation of terms'}</p>
                    </div>
                </div>
            </div>
        `;
    }

    showDepositModal() {
        const existingModal = document.querySelector('.deposit-modal');
        if (existingModal) existingModal.remove();
        
        const modal = document.createElement('div');
        modal.className = 'deposit-modal';
        
        const memo = this.tgUser.id.toString();
        const walletAddress = this.settings.tonWallet;
        
        modal.innerHTML = `
            <div class="deposit-modal-content">
                <button class="deposit-modal-close" id="deposit-modal-close">
                    <i class="fas fa-times"></i>
                </button>
                <div class="deposit-modal-header">
                    <h3>Deposit TON</h3>
                </div>
                <div class="deposit-field">
                    <div class="deposit-field-label">
                        <i class="fas fa-wallet"></i> TON Wallet
                    </div>
                    <div class="deposit-field-value" id="deposit-wallet-value">${walletAddress}</div>
                    <button class="deposit-field-copy" data-copy="wallet">
                        <i class="far fa-copy"></i> Copy Wallet
                    </button>
                </div>
                <div class="deposit-field">
                    <div class="deposit-field-label">
                        <i class="fas fa-comment"></i> Comment (Memo)
                    </div>
                    <div class="deposit-field-value" id="deposit-memo-value">${memo}</div>
                    <button class="deposit-field-copy" data-copy="memo">
                        <i class="far fa-copy"></i> Copy Memo
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeBtn = modal.querySelector('#deposit-modal-close');
        if (closeBtn) {
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                modal.remove();
            };
        }
        
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        };
        
        const copyButtons = modal.querySelectorAll('[data-copy]');
        copyButtons.forEach(btn => {
            btn.onclick = () => {
                const type = btn.dataset.copy;
                let text = '';
                if (type === 'wallet') {
                    text = walletAddress;
                } else if (type === 'memo') {
                    text = memo;
                }
                if (text) {
                    this.copyToClipboard(text);
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                    setTimeout(() => {
                        btn.innerHTML = originalText;
                    }, 2000);
                }
            };
        });
    }
    
    updateHeader() {
        const userPhoto = document.getElementById('user-photo');
        const userName = document.getElementById('user-name');
        const tonBalance = document.getElementById('header-ton-balance');
        const addBalanceBtn = document.getElementById('add-balance-btn');
        
        if (userPhoto) {
            userPhoto.src = this.userState.photoUrl || this.settings.defaultUserIcon;
            userPhoto.oncontextmenu = (e) => e.preventDefault();
            userPhoto.ondragstart = () => false;
        }
        
        if (userName) {
            const fullName = this.tgUser.first_name || 'User';
            userName.textContent = this.truncateName(fullName, 15);
        }
        
        if (tonBalance) {
            const balance = this.safeNumber(this.userState.balance);
            tonBalance.textContent = `${balance.toFixed(3)} TON`;
        }
        
        if (addBalanceBtn) {
            addBalanceBtn.onclick = null;
            addBalanceBtn.addEventListener('click', () => {
                this.showDepositModal();
            });
        }
    }

    renderUI() {
        this.updateHeader();
        this.renderTasksPage();
        this.renderQuestsPage();
        this.renderReferralsPage();
        this.renderWithdrawPage();
        this.setupNavigation();
        this.setupEventListeners();
        
        document.body.addEventListener('copy', (e) => {
            e.preventDefault();
            return false;
        });
        
        document.body.addEventListener('contextmenu', (e) => {
            if (e.target.tagName === 'IMG') {
                e.preventDefault();
                return false;
            }
        });
    }

    setupNavigation() {
        const bottomNav = document.querySelector('.bottom-nav');
        if (!bottomNav) return;
        
        const navButtons = bottomNav.querySelectorAll('.nav-btn');
        navButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const pageId = btn.getAttribute('data-page');
                if (pageId) {
                    this.showPage(pageId);
                }
            });
        });
    }

    showPage(pageId) {
        const pages = document.querySelectorAll('.page');
        const navButtons = document.querySelectorAll('.nav-btn');
        
        pages.forEach(page => page.classList.remove('active'));
        navButtons.forEach(btn => btn.classList.remove('active'));
        
        const targetPage = document.getElementById(pageId);
        const targetButton = document.querySelector(`[data-page="${pageId}"]`);
        
        if (targetPage) {
            targetPage.classList.add('active');
            
            if (targetButton) targetButton.classList.add('active');
            
            if (pageId === 'tasks-page') {
                this.renderTasksPage();
            } else if (pageId === 'quests-page') {
                this.renderQuestsPage();
            } else if (pageId === 'referrals-page') {
                this.renderReferralsPage();
            } else if (pageId === 'withdraw-page') {
                this.renderWithdrawPage();
            }
        }
    }

    renderTasksPage() {
        const tasksPage = document.getElementById('tasks-page');
        if (!tasksPage) return;
        
        tasksPage.innerHTML = `
            <div id="tasks-content">
                <div class="tasks-tabs">
                    <button class="tab-btn active" data-tab="social-tab">
                        <i class="fas fa-users"></i> Social
                    </button>
                    <button class="tab-btn" data-tab="partner-tab">
                        <i class="fas fa-handshake"></i> Partner
                    </button>
                    <button class="tab-btn" data-tab="more-tab">
                        <i class="fas fa-ellipsis-h"></i> More
                    </button>
                </div>
                
                <div id="social-tab" class="tasks-tab-content active">
                    <div class="task-category">
                        <div class="task-category-header">
                            <h3 class="task-category-title">
                                <i class="fas fa-users"></i> Social Tasks
                            </h3>
                            <button class="add-task-btn" id="add-task-btn">
                                <i class="fas fa-plus"></i> Add Task
                            </button>
                        </div>
                        <div id="social-tasks-list" class="referrals-list"></div>
                    </div>
                </div>
                
                <div id="partner-tab" class="tasks-tab-content">
                    <div class="task-category">
                        <div class="task-category-header">
                            <h3 class="task-category-title">
                                <i class="fas fa-handshake"></i> Partner Tasks
                            </h3>
                        </div>
                        <div id="partner-tasks-list" class="referrals-list"></div>
                    </div>
                </div>
                
                <div id="more-tab" class="tasks-tab-content">
                    <div class="promo-card">
                        <div class="promo-header">
                            <div class="promo-icon">
                                <i class="fas fa-gift"></i>
                            </div>
                            <h3>Promo Codes</h3>
                        </div>
                        <input type="text" id="promo-input" class="promo-input" 
                               placeholder="Enter promo code" maxlength="20">
                        <button id="promo-btn" class="promo-btn">
                            <i class="fas fa-gift"></i> APPLY
                        </button>
                    </div>
                    <div class="ad-card">
                        <div class="ad-header">
                            <div class="ad-icon">
                                <i class="fas fa-ad"></i>
                            </div>
                            <div class="ad-title">Watch AD #1</div>
                        </div>
                        <div class="ad-reward">
                            <img src="${this.settings.tonIcon}" alt="TON">
                            <span>Reward: ${this.settings.adRewardTon.toFixed(3)} TON</span>
                        </div>
                        <button class="ad-btn ${this.isAdAvailable(1) ? 'available' : 'cooldown'}" 
                                id="watch-ad-1-btn"
                                ${!this.isAdAvailable(1) ? 'disabled' : ''}>
                            ${this.isAdAvailable(1) ? 'WATCH' : this.formatTime(this.getAdTimeLeft(1))}
                        </button>
                    </div>
                    <div class="ad-card">
                        <div class="ad-header">
                            <div class="ad-icon">
                                <i class="fas fa-ad"></i>
                            </div>
                            <div class="ad-title">Watch AD #2</div>
                        </div>
                        <div class="ad-reward">
                            <img src="${this.settings.tonIcon}" alt="TON">
                            <span>Reward: ${this.settings.adRewardTon.toFixed(3)} TON</span>
                        </div>
                        <button class="ad-btn ${this.isAdAvailable(2) ? 'available' : 'cooldown'}" 
                                id="watch-ad-2-btn"
                                ${!this.isAdAvailable(2) ? 'disabled' : ''}>
                            ${this.isAdAvailable(2) ? 'WATCH' : this.formatTime(this.getAdTimeLeft(2))}
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        setTimeout(() => {
            this.setupTasksTabs();
            this.loadSocialTasks();
            this.loadPartnerTasks();
            this.setupPromoCodeEvents();
            this.setupAdWatchEvents();
            this.startAdTimers();
            this.setupAddTaskButton();
        }, 100);
    }

    setupAddTaskButton() {
        const addTaskBtn = document.getElementById('add-task-btn');
        if (addTaskBtn) {
            addTaskBtn.addEventListener('click', () => {
                this.showAddTaskModal();
            });
        }
    }

    showAddTaskModal() {
        const completionsOptions = [100, 250, 500, 1000, 5000, 10000];
        const taskPricePer100 = this.settings.taskPrice100;
        
        const modal = document.createElement('div');
        modal.className = 'task-modal';
        
        modal.innerHTML = `
            <div class="task-modal-content">
                <button class="task-modal-close" id="task-modal-close">
                    <i class="fas fa-times"></i>
                </button>
                
                <div class="task-modal-tabs-container">
                    <div class="task-modal-tabs">
                        <button class="task-modal-tab active" data-tab="add">Add Task</button>
                        <button class="task-modal-tab" data-tab="mytasks">My Tasks</button>
                    </div>
                </div>
                
                <div id="add-task-tab" class="task-modal-body" style="display: block;">
                    <form class="add-task-form" id="add-task-form">
                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-tag"></i> Task Name
                            </label>
                            <input type="text" id="task-name" class="form-input" placeholder="Enter your task name *" maxlength="15" required>
                      </div>
                        
                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-link"></i> Task Link
                            </label>
                            <input type="url" id="task-link" class="form-input" placeholder="https://t.me/..." required>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-globe"></i> Task Type
                            </label>
                            <div class="category-selector" id="task-type-selector">
                                <div class="category-option active" data-type="telegram">Telegram</div>
                                <div class="category-option" data-type="other">Other</div>
                            </div>
                        </div>
                        
                        <div class="form-group" id="verification-group">
                            <label class="form-label">
                                <i class="fas fa-shield-alt"></i> Verification Required
                            </label>
                            <div class="category-selector" id="verification-selector">
                                <div class="category-option active" data-verification="NO">NO</div>
                                <div class="category-option" data-verification="YES">YES</div>
                            </div>
                        </div>
                        
                        <div id="upgrade-admin-container" style="display: none;">
                            <button type="button" class="upgrade-admin-btn" id="upgrade-admin-btn" style="width:100%; padding:12px; background:#222; border:1px solid #3b82f6; border-radius:12px; color:#3b82f6; cursor:pointer; margin-bottom:15px;">
                                <i class="fab fa-telegram"></i> Add @${this.appConfig.BOT_USERNAME} as admin
                            </button>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">
                                <i class="fas fa-chart-line"></i> Completions
                            </label>
                            <div class="completions-selector">
                                ${completionsOptions.map(opt => {
                                    let price = (opt / 100) * taskPricePer100;
                                    if (opt === 250) price = 2.5 * taskPricePer100;
                                    return `
                                        <div class="completion-option ${opt === 100 ? 'active' : ''}" data-completions="${opt}" data-price="${price.toFixed(4)}">${opt}</div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                        
                        <div class="price-info">
                            <span class="price-label">Total Price:</span>
                            <span class="price-value" id="total-price">${taskPricePer100.toFixed(4)} TON</span>
                        </div>
                        
                        <div class="task-message" id="task-message" style="display: none;"></div>
                        
                        <button type="button" class="pay-task-btn" id="pay-task-btn" disabled>
                            <i class="fas fa-coins"></i> Pay ${taskPricePer100.toFixed(4)} TON
                        </button>
                    </form>
                </div>
                
                <div id="mytasks-tab" class="task-modal-body" style="display: none;">
                    <div class="my-tasks-list" id="my-tasks-list">
                        ${this.renderMyTasks()}
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeBtn = document.getElementById('task-modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                modal.remove();
            });
        }
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
        
        this.setupTaskModalEvents(modal, completionsOptions, taskPricePer100);
    }

    renderMyTasks() {
        if (!this.userCreatedTasks || this.userCreatedTasks.length === 0) {
            return `
                <div class="no-data">
                    <i class="fas fa-tasks"></i>
                    <p>No tasks created yet</p>
                </div>
            `;
        }
        
        return this.userCreatedTasks.map(task => {
            const currentCompletions = task.currentCompletions || 0;
            const maxCompletions = task.maxCompletions || 100;
            const progress = (currentCompletions / maxCompletions) * 100;
            const verification = task.verification === 'YES' ? '🔒' : '🔓';
            const isCompleted = currentCompletions >= maxCompletions;
            
            return `
                <div class="my-task-item" data-task-id="${task.id}">
                    <div class="my-task-header">
                        <div class="my-task-avatar">
                            <img src="${this.settings.defaultTaskIcon}" alt="Task">
                        </div>
                        <div class="my-task-info">
                            <div class="my-task-name">${task.name}</div>
                    </div>
                        <div class="my-task-actions">
                            <button class="my-task-delete-btn" data-task-id="${task.id}" title="Delete task">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="my-task-progress">
                        <div class="progress-header">
                            <span>Progress</span>
                            <span>${currentCompletions}/${maxCompletions}</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${Math.min(progress, 100)}%"></div>
                        </div>
                    </div>
                    ${isCompleted ? '<div class="task-completed-badge">Completed ✓</div>' : ''}
                </div>
            `;
        }).join('');
    }

    setupTaskModalEvents(modal, completionsOptions, taskPricePer100) {
        const tabs = modal.querySelectorAll('.task-modal-tab');
        const addTab = modal.querySelector('#add-task-tab');
        const myTasksTab = modal.querySelector('#mytasks-tab');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                if (tab.dataset.tab === 'add') {
                    addTab.style.display = 'block';
                    myTasksTab.style.display = 'none';
                } else {
                    addTab.style.display = 'none';
                    myTasksTab.style.display = 'block';
                    this.renderMyTasksInModal();
                }
            });
        });
        
        const taskTypeOptions = modal.querySelectorAll('#task-type-selector .category-option');
        const verificationGroup = modal.querySelector('#verification-group');
        const verificationOptions = modal.querySelectorAll('#verification-selector .category-option');
        const upgradeContainer = modal.querySelector('#upgrade-admin-container');
        const upgradeBtn = modal.querySelector('#upgrade-admin-btn');
        const taskLinkInput = modal.querySelector('#task-link');
        
        taskTypeOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                taskTypeOptions.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                
                const taskType = opt.dataset.type;
                if (taskType === 'telegram') {
                    verificationGroup.style.display = 'block';
                    if (taskLinkInput) {
                        taskLinkInput.placeholder = 'https://t.me/...';
                    }
                } else {
                    verificationGroup.style.display = 'none';
                    if (taskLinkInput) {
                        taskLinkInput.placeholder = 'https://...';
                    }
                }
                this.checkTaskFormComplete(modal);
            });
        });
        
        verificationOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                verificationOptions.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                
                if (opt.dataset.verification === 'YES') {
                    upgradeContainer.style.display = 'block';
                } else {
                    upgradeContainer.style.display = 'none';
                }
                this.checkTaskFormComplete(modal);
            });
        });
        
        if (upgradeBtn) {
            upgradeBtn.addEventListener('click', () => {
                const url = `https://t.me/${this.appConfig.BOT_USERNAME}?startchannel=Commands&admin=invite_users`;
                window.open(url, '_blank');
            });
        }
        
        const completionOptions = modal.querySelectorAll('.completion-option');
        const totalPriceSpan = modal.querySelector('#total-price');
        const payBtn = modal.querySelector('#pay-task-btn');
        
        completionOptions.forEach(opt => {
            opt.addEventListener('click', () => {
                completionOptions.forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                
                const price = parseFloat(opt.dataset.price);
                totalPriceSpan.textContent = `${price.toFixed(4)} TON`;
                payBtn.innerHTML = `<i class="fas fa-coins"></i> Pay ${price.toFixed(4)} TON`;
                
                this.checkTaskFormComplete(modal);
            });
        });
        
        payBtn.addEventListener('click', async () => {
            await this.handleCreateTask(modal);
        });
        
        if (taskLinkInput) {
            taskLinkInput.addEventListener('input', () => {
                this.checkTaskFormComplete(modal);
            });
        }
        
        const taskNameInput = modal.querySelector('#task-name');
        if (taskNameInput) {
            taskNameInput.addEventListener('input', () => {
                this.checkTaskFormComplete(modal);
            });
        }
        
        this.checkTaskFormComplete(modal);
        this.setupMyTaskButtons(modal);
    }

    checkTaskFormComplete(modal) {
        const taskName = modal.querySelector('#task-name')?.value.trim();
        const taskLink = modal.querySelector('#task-link')?.value.trim();
        const payBtn = modal.querySelector('#pay-task-btn');
        const activeCompletion = modal.querySelector('.completion-option.active');
        const taskType = modal.querySelector('#task-type-selector .category-option.active')?.dataset.type;
        
        let isValidLink = false;
        if (taskType === 'telegram') {
            isValidLink = taskLink && taskLink.startsWith('https://t.me/');
        } else {
            isValidLink = taskLink && taskLink.startsWith('https://');
        }
        
        const isComplete = taskName && taskName.length > 0 && taskName.length <= 15 && 
                          /^[a-zA-Z0-9\s]*$/.test(taskName) &&
                          isValidLink &&
                          activeCompletion;
        
        if (payBtn) {
            payBtn.disabled = !isComplete;
        }
    }

    renderMyTasksInModal() {
        const myTasksList = document.querySelector('#my-tasks-list');
        if (myTasksList) {
            myTasksList.innerHTML = this.renderMyTasks();
            this.setupMyTaskButtons(document.querySelector('.task-modal'));
        }
    }

    setupMyTaskButtons(modal) {
        const deleteBtns = modal.querySelectorAll('.my-task-delete-btn');
        
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = btn.getAttribute('data-task-id');
                const task = this.userCreatedTasks.find(t => t.id === taskId);
                if (task) {
                    await this.showDeleteTaskConfirmation(task);
                }
            });
        });
    }

    async showDeleteTaskConfirmation(task) {
        const currentCompletions = task.currentCompletions || 0;
        const maxCompletions = task.maxCompletions || 100;
        const remaining = maxCompletions - currentCompletions;
        const taskPricePer100 = this.settings.taskPrice100;
        const refundAmount = (currentCompletions / 100) * taskPricePer100 * 0.5;
        
        const modal = document.createElement('div');
        modal.className = 'task-modal';
        modal.innerHTML = `
            <div class="task-modal-content" style="max-width: 350px;">
                <button class="task-modal-close" id="delete-task-close">
                    <i class="fas fa-times"></i>
                </button>
                <h3 style="text-align: center; margin-bottom: 20px; color: #e74c3c;">Delete Task</h3>
                
                <div class="form-group">
                    <label class="form-label">Task: ${task.name}</label>
                    <label class="form-label">Progress: ${currentCompletions}/${maxCompletions}</label>
                    <label class="form-label">Remaining: ${remaining}</label>
                </div>
                
                
                
                <div class="task-message" id="delete-task-message" style="display: none;"></div>
                
                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button type="button" class="cancel-delete-btn" style="flex: 1; padding: 12px; background: rgba(0,0,0,0.4); border: none; border-radius: 50px; color: var(--text-secondary); cursor: pointer;">Cancel</button>
                    <button type="button" class="confirm-delete-btn" style="flex: 1; padding: 12px; background: linear-gradient(135deg, #e74c3c, #c0392b); border: none; border-radius: 50px; color: white; cursor: pointer; font-weight: bold;">Delete</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const closeBtn = document.getElementById('delete-task-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                modal.remove();
            });
        }
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
        
        const cancelBtn = modal.querySelector('.cancel-delete-btn');
        const confirmBtn = modal.querySelector('.confirm-delete-btn');
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => modal.remove());
        }
        
        if (confirmBtn) {
            confirmBtn.addEventListener('click', async () => {
                const originalText = confirmBtn.innerHTML;
                confirmBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Deleting...';
                confirmBtn.disabled = true;
                
                try {
                    if (this.db) {
                        await this.db.ref(`config/userTasks/${this.tgUser.id}/${task.id}`).remove();
                    }
                    
                    await this.loadUserCreatedTasks();
                    
                    this.updateHeader();
                    
                    const messageDiv = document.getElementById('delete-task-message');
                    if (messageDiv) {
                        messageDiv.textContent = `Task deleted!`;
                        messageDiv.className = 'task-message success';
                        messageDiv.style.display = 'block';
                    }
                    
                    setTimeout(() => {
                        modal.remove();
                        const taskModal = document.querySelector('.task-modal');
                        if (taskModal) {
                            this.renderMyTasksInModal();
                        }
                    }, 1500);
                    
                } catch (error) {
                    const messageDiv = document.getElementById('delete-task-message');
                    if (messageDiv) {
                        messageDiv.textContent = 'Failed to delete task';
                        messageDiv.className = 'task-message error';
                        messageDiv.style.display = 'block';
                    }
                    confirmBtn.innerHTML = originalText;
                    confirmBtn.disabled = false;
                }
            });
        }
    }

    async handleCreateTask(modal) {
        try {
            const taskName = modal.querySelector('#task-name').value.trim();
            const taskLink = modal.querySelector('#task-link').value.trim();
            const taskType = modal.querySelector('#task-type-selector .category-option.active').dataset.type;
            let verification = 'NO';
            
            if (taskType === 'telegram') {
                verification = modal.querySelector('#verification-selector .category-option.active').dataset.verification;
            }
            
            const completions = parseInt(modal.querySelector('.completion-option.active').dataset.completions);
            
            if (!taskName || !taskLink) {
                this.showMessage(modal, 'Please fill all fields', 'error');
                return;
            }
            
            if (taskName.length > 15) {
                this.showMessage(modal, 'Task name must be 15 characters or less', 'error');
                return;
            }
            
            const englishOnly = /^[a-zA-Z0-9\s]*$/;
            if (!englishOnly.test(taskName)) {
                this.showMessage(modal, 'Task name must contain only English letters and numbers', 'error');
                return;
            }
            
            if (taskType === 'telegram') {
                if (!taskLink.startsWith('https://t.me/')) {
                    this.showMessage(modal, 'Task link must start with https://t.me/', 'error');
                    return;
                }
            } else {
                if (!taskLink.startsWith('https://')) {
                    this.showMessage(modal, 'Task link must start with https://', 'error');
                    return;
                }
            }
            
            const taskPricePer100 = this.settings.taskPrice100;
            let price = (completions / 100) * taskPricePer100;
            if (completions === 250) price = 2.5 * taskPricePer100;
            
            const userBalance = this.safeNumber(this.userState.balance);
            
            if (userBalance < price) {
                this.showMessage(modal, `Insufficient TON balance. Need ${price.toFixed(4)} TON`, 'error');
                return;
            }
            
            const payBtn = modal.querySelector('#pay-task-btn');
            const originalText = payBtn.innerHTML;
            payBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Creating...';
            payBtn.disabled = true;
            
            try {
                if (taskType === 'telegram' && verification === 'YES') {
                    const chatId = this.taskManager.extractChatIdFromUrl(taskLink);
                    if (chatId) {
                        const isBotAdmin = await this.checkBotAdminStatus(chatId);
                        if (!isBotAdmin) {
                            this.showMessage(modal, 'Please add the bot as an admin first!', 'error');
                            payBtn.innerHTML = originalText;
                            payBtn.disabled = false;
                            return;
                        }
                    }
                }
                
                const currentTime = Date.now();
                const taskData = {
                    name: taskName,
                    url: taskLink,
                    category: 'social',
                    type: taskType === 'telegram' ? 'channel' : 'website',
                    verification: verification,
                    maxCompletions: completions,
                    currentCompletions: 0,
                    status: 'active',
                    reward: this.settings.taskReward,
                    owner: this.tgUser.id,
                    createdAt: currentTime,
                    picture: this.settings.defaultTaskIcon
                };
                
                if (this.db) {
                    const taskRef = await this.db.ref(`config/userTasks/${this.tgUser.id}`).push(taskData);
                    const taskId = taskRef.key;
                    
                    const newBalance = userBalance - price;
                    await this.db.ref(`users/${this.tgUser.id}`).update({
                        balance: newBalance
                    });
                    
                    this.userState.balance = newBalance;
                    
                    await this.loadUserCreatedTasks();
                    
                    const myTasksList = modal.querySelector('#my-tasks-list');
                    if (myTasksList) {
                        myTasksList.innerHTML = this.renderMyTasks();
                        this.setupMyTaskButtons(modal);
                    }
                    
                    this.showMessage(modal, `Task created! Cost: ${price.toFixed(4)} TON`, 'success');
                    
                    setTimeout(() => {
                        const messageDiv = modal.querySelector('#task-message');
                        if (messageDiv) {
                            messageDiv.style.display = 'none';
                        }
                    }, 3000);
                    
                    this.updateHeader();
                }
                
            } catch (error) {
                this.showMessage(modal, 'Failed to create task', 'error');
            } finally {
                payBtn.innerHTML = originalText;
                payBtn.disabled = false;
            }
            
        } catch (error) {
            this.showMessage(modal, 'Failed to create task', 'error');
        }
    }

    async checkBotAdminStatus(chatId) {
        try {
            const response = await fetch('/api/telegram-bot', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'x-user-id': this.tgUser.id.toString(),
                    'x-telegram-hash': this.tg?.initData || ''
                },
                body: JSON.stringify({
                    action: 'getChatAdministrators',
                    params: { chat_id: chatId }
                })
            });
            
            if (!response.ok) return false;
            
            const data = await response.json();
            if (data.ok && data.result) {
                const admins = data.result;
                const isBotAdmin = admins.some(admin => {
                    const isBot = admin.user?.is_bot;
                    const isThisBot = admin.user?.username === this.appConfig.BOT_USERNAME;
                    return isBot && isThisBot;
                });
                return isBotAdmin;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    async loadUserCreatedTasks() {
        try {
            if (!this.db) return;
            
            const tasksRef = await this.db.ref(`config/userTasks/${this.tgUser.id}`).once('value');
            if (tasksRef.exists()) {
                const tasks = [];
                tasksRef.forEach(child => {
                    tasks.push({
                        id: child.key,
                        ...child.val()
                    });
                });
                this.userCreatedTasks = tasks;
            } else {
                this.userCreatedTasks = [];
            }
        } catch (error) {
            this.userCreatedTasks = [];
        }
    }

    showMessage(modal, text, type) {
        const messageDiv = modal.querySelector('.task-message');
        if (messageDiv) {
            messageDiv.textContent = text;
            messageDiv.className = `task-message ${type}`;
            messageDiv.style.display = 'block';
            
            if (type === 'success') {
                setTimeout(() => {
                    messageDiv.style.display = 'none';
                }, 3000);
            }
        }
    }

    setupTasksTabs() {
        const tabButtons = document.querySelectorAll('.tasks-tabs .tab-btn');
        const tabContents = document.querySelectorAll('.tasks-tab-content');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabContents.forEach(content => content.classList.remove('active'));
                
                button.classList.add('active');
                const targetTab = document.getElementById(tabId);
                if (targetTab) {
                    targetTab.classList.add('active');
                    
                    if (tabId === 'social-tab') {
                        this.loadSocialTasks();
                    } else if (tabId === 'partner-tab') {
                        this.loadPartnerTasks();
                    }
                }
            });
        });
    }

    async loadSocialTasks() {
        const socialTab = document.getElementById('social-tasks-list');
        if (!socialTab) return;
        
        try {
            let socialTasks = [];
            if (this.taskManager) {
                socialTasks = await this.taskManager.loadTasksFromDatabase('social');
            }
            
            const userTasks = this.userCreatedTasks || [];
            const allSocialTasks = [...socialTasks, ...userTasks];
            
            if (allSocialTasks.length > 0) {
                const tasksHTML = allSocialTasks.map(task => this.renderTaskCard(task)).join('');
                socialTab.innerHTML = tasksHTML;
                this.setupTaskButtons();
            } else {
                socialTab.innerHTML = `
                    <div class="no-tasks">
                        <i class="fas fa-users"></i>
                        <p>No social tasks available now</p>
                   </div>
                `;
            }
        } catch (error) {
            socialTab.innerHTML = `
                <div class="no-tasks">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Error loading social tasks</p>
                </div>
            `;
        }
    }

    async loadPartnerTasks() {
        const partnerTab = document.getElementById('partner-tasks-list');
        if (!partnerTab) return;
        
        try {
            let partnerTasks = [];
            if (this.taskManager) {
                partnerTasks = await this.taskManager.loadTasksFromDatabase('partner');
            }
            
            if (partnerTasks.length > 0) {
                const tasksHTML = partnerTasks.map(task => this.renderTaskCard(task)).join('');
                partnerTab.innerHTML = tasksHTML;
                this.setupTaskButtons();
            } else {
                partnerTab.innerHTML = `
                    <div class="no-tasks">
                        <i class="fas fa-handshake"></i>
                        <p>No partner tasks available now</p>
                    </div>
                `;
            }
        } catch (error) {
            partnerTab.innerHTML = `
                <div class="no-tasks">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>Error loading partner tasks</p>
                </div>
            `;
        }
    }

    renderTaskCard(task) {
        const isCompleted = this.userCompletedTasks.has(task.id);
        const defaultIcon = this.settings.defaultTaskIcon;
        
        let buttonText = 'Start';
        let buttonClass = 'start';
        let isDisabled = isCompleted || this.isProcessingTask;
        
        if (isCompleted) {
            buttonText = 'COMPLETED';
            buttonClass = 'completed';
            isDisabled = true;
        }
        
        return `
            <div class="referral-row ${isCompleted ? 'task-completed' : ''}" id="task-${task.id}">
                <div class="referral-row-avatar">
                    <img src="${task.picture || defaultIcon}" alt="Task" 
                         oncontextmenu="return false;" 
                         ondragstart="return false;">
                </div>
                <div class="referral-row-info">
                    <p class="referral-row-username">${this.escapeHtml(task.name)}</p>
                    <p class="task-reward-amount">Reward: ${(task.reward || this.settings.taskReward).toFixed(5)} TON</p>
                </div>
                <div class="referral-row-status">
                    <button class="task-btn ${buttonClass}" 
                            data-task-id="${task.id}"
                            data-task-url="${task.url}"
                            data-task-type="${task.type}"
                            data-task-reward="${task.reward || this.settings.taskReward}"
                            ${isDisabled ? 'disabled' : ''}>
                        ${buttonText}
                    </button>
                </div>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setupTaskButtons() {
        const startButtons = document.querySelectorAll('.task-btn.start:not(:disabled)');
        startButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (this.isProcessingTask) return;
                
                const rateLimitCheck = this.rateLimiter.checkLimit(this.tgUser.id, 'task_start');
                if (!rateLimitCheck.allowed) {
                    this.notificationManager.showNotification(
                        "Rate Limit", 
                        `Please wait ${rateLimitCheck.remaining} seconds before starting another task`, 
                        "warning"
                    );
                    return;
                }
                
                const taskId = btn.getAttribute('data-task-id');
                const taskUrl = btn.getAttribute('data-task-url');
                const taskType = btn.getAttribute('data-task-type');
                const taskReward = parseFloat(btn.getAttribute('data-task-reward')) || 0;
                
                if (taskId && taskUrl) {
                    e.preventDefault();
                    await this.taskManager.handleTask(taskId, taskUrl, taskType, taskReward, btn);
                }
            });
        });
    }

    setupPromoCodeEvents() {
        const promoBtn = document.getElementById('promo-btn');
        const promoInput = document.getElementById('promo-input');
        
        if (promoBtn) {
            promoBtn.addEventListener('click', () => {
                this.handlePromoCode();
            });
        }
        
        if (promoInput) {
            promoInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handlePromoCode();
                }
            });
        }
    }

    async handlePromoCode() {
        const promoInput = document.getElementById('promo-input');
        const promoBtn = document.getElementById('promo-btn');
        
        if (!promoInput || !promoBtn) return;
        
        const code = promoInput.value.trim().toUpperCase();
        if (!code) {
            this.notificationManager.showNotification("Promo Code", "Please enter a promo code", "warning");
            return;
        }
        
        const originalText = promoBtn.innerHTML;
        promoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
        promoBtn.disabled = true;
        
        try {
            let promoData = null;
            if (this.db) {
                const promoCodesRef = await this.db.ref('config/promoCodes').once('value');
                if (promoCodesRef.exists()) {
                    const promoCodes = promoCodesRef.val();
                    for (const id in promoCodes) {
                        if (promoCodes[id].code === code) {
                            promoData = { id, ...promoCodes[id] };
                            break;
                        }
                    }
                }
            }
            
            if (!promoData) {
                this.notificationManager.showNotification("Promo Code", "Invalid promo code", "error");
                promoBtn.innerHTML = originalText;
                promoBtn.disabled = false;
                return;
            }
            
            if (this.db) {
                const usedRef = await this.db.ref(`usedPromoCodes/${this.tgUser.id}/${promoData.id}`).once('value');
                if (usedRef.exists()) {
                    this.notificationManager.showNotification("Promo Code", "You have already used this code", "error");
                    promoBtn.innerHTML = originalText;
                    promoBtn.disabled = false;
                    return;
                }
            }
            
            let adShown = false;
            if (window.AdBlock19345 && typeof window.AdBlock19345.show === 'function') {
                adShown = await new Promise((resolve) => {
                    window.AdBlock19345.show().then(() => {
                        resolve(true);
                    }).catch(() => {
                        resolve(false);
                    });
                });
            }
            
            if (!adShown) {
                this.notificationManager.showNotification("Ad Required", "Please watch the ad to claim promo", "info");
                promoBtn.innerHTML = originalText;
                promoBtn.disabled = false;
                return;
            }
            
            const reward = this.safeNumber(promoData.reward || 0.01);
            const currentBalance = this.safeNumber(this.userState.balance);
            const newBalance = currentBalance + reward;
            
            if (this.db) {
                await this.db.ref(`users/${this.tgUser.id}`).update({
                    balance: newBalance,
                    totalEarned: this.safeNumber(this.userState.totalEarned) + reward
                });
                
                await this.db.ref(`usedPromoCodes/${this.tgUser.id}/${promoData.id}`).set({
                    code: code,
                    reward: reward,
                    claimedAt: Date.now()
                });
                
                await this.db.ref(`config/promoCodes/${promoData.id}/usedCount`).transaction(current => (current || 0) + 1);
            }
            
            this.userState.balance = newBalance;
            this.userState.totalEarned = this.safeNumber(this.userState.totalEarned) + reward;
            
            this.cache.delete(`user_${this.tgUser.id}`);
            
            this.updateHeader();
            promoInput.value = '';
            
            this.notificationManager.showNotification("Success", `Promo code applied! +${reward.toFixed(3)} TON`, "success");
            
        } catch (error) {
            this.notificationManager.showNotification("Error", "Failed to apply promo code", "error");
        } finally {
            promoBtn.innerHTML = originalText;
            promoBtn.disabled = false;
        }
    }

    setupAdWatchEvents() {
        const watchAd1Btn = document.getElementById('watch-ad-1-btn');
        const watchAd2Btn = document.getElementById('watch-ad-2-btn');
        
        if (watchAd1Btn) {
            watchAd1Btn.addEventListener('click', async () => {
                await this.watchAd(1);
            });
        }
        
        if (watchAd2Btn) {
            watchAd2Btn.addEventListener('click', async () => {
                await this.watchAdWithGiga(2);
            });
        }
    }

    async watchAd(adNumber) {
        const currentTime = Date.now();
        const adTimerKey = `ad${adNumber}`;
        
        if (this.adTimers[adTimerKey] + this.adCooldown > currentTime) {
            const timeLeft = this.adTimers[adTimerKey] + this.adCooldown - currentTime;
            this.notificationManager.showNotification("Cooldown", `Please wait ${this.formatTime(timeLeft)}`, "info");
            return;
        }
        
        const adBtn = document.getElementById(`watch-ad-${adNumber}-btn`);
        if (adBtn) {
            adBtn.disabled = true;
            adBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        }
        
        try {
            let adShown = false;
            
            if (window.AdBlock19345 && typeof window.AdBlock19345.show === 'function') {
                adShown = await new Promise((resolve) => {
                    window.AdBlock19345.show().then(() => {
                        resolve(true);
                    }).catch(() => {
                        resolve(false);
                    });
                });
            }
            
            if (adShown) {
                this.adTimers[adTimerKey] = currentTime;
                await this.saveAdTimers();
                
                const reward = this.settings.adRewardTon;
                const currentBalance = this.safeNumber(this.userState.balance);
                const newBalance = currentBalance + reward;
                
                if (this.db) {
                    await this.db.ref(`users/${this.tgUser.id}`).update({
                        balance: newBalance,
                        totalEarned: this.safeNumber(this.userState.totalEarned) + reward,
                        totalTasks: this.safeNumber(this.userState.totalTasks) + 1
                    });
                }
                
                this.userState.balance = newBalance;
                this.userState.totalEarned = this.safeNumber(this.userState.totalEarned) + reward;
                this.userState.totalTasks = this.safeNumber(this.userState.totalTasks) + 1;
                
                this.cache.delete(`user_${this.tgUser.id}`);
                
                this.updateHeader();
                this.updateAdButtons();
                
                this.notificationManager.showNotification("Success", `+${reward.toFixed(3)} TON! Ad watched successfully`, "success");
                
            } else {
                this.notificationManager.showNotification("Error", "Failed to show ad", "error");
                if (adBtn) {
                    adBtn.disabled = false;
                    adBtn.innerHTML = 'WATCH';
                }
            }
            
        } catch (error) {
            this.notificationManager.showNotification("Error", "Failed to watch ad", "error");
            if (adBtn) {
                adBtn.disabled = false;
                adBtn.innerHTML = 'WATCH';
            }
        }
    }

    async watchAdWithGiga(adNumber) {
        const currentTime = Date.now();
        const adTimerKey = `ad${adNumber}`;
        
        if (this.adTimers[adTimerKey] + this.adCooldown > currentTime) {
            const timeLeft = this.adTimers[adTimerKey] + this.adCooldown - currentTime;
            this.notificationManager.showNotification("Cooldown", `Please wait ${this.formatTime(timeLeft)}`, "info");
            return;
        }
        
        const adBtn = document.getElementById(`watch-ad-${adNumber}-btn`);
        if (adBtn) {
            adBtn.disabled = true;
            adBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        }
        
        try {
            let adShown = false;
            
            if (typeof window.showGiga === 'function') {
                adShown = await new Promise((resolve) => {
                    window.showGiga()
                        .then(() => {
                            resolve(true);
                        })
                        .catch((e) => {
                            console.error('Giga ad error:', e);
                            resolve(false);
                        });
                });
            }
            
            if (adShown) {
                this.adTimers[adTimerKey] = currentTime;
                await this.saveAdTimers();
                
                const reward = this.settings.adRewardTon;
                const currentBalance = this.safeNumber(this.userState.balance);
                const newBalance = currentBalance + reward;
                
                if (this.db) {
                    await this.db.ref(`users/${this.tgUser.id}`).update({
                        balance: newBalance,
                        totalEarned: this.safeNumber(this.userState.totalEarned) + reward,
                        totalTasks: this.safeNumber(this.userState.totalTasks) + 1
                    });
                }
                
                this.userState.balance = newBalance;
                this.userState.totalEarned = this.safeNumber(this.userState.totalEarned) + reward;
                this.userState.totalTasks = this.safeNumber(this.userState.totalTasks) + 1;
                
                this.cache.delete(`user_${this.tgUser.id}`);
                
                this.updateHeader();
                this.updateAdButtons();
                
                this.notificationManager.showNotification("Success", `+${reward.toFixed(3)} TON! Ad watched successfully`, "success");
                
            } else {
                this.notificationManager.showNotification("Error", "Failed to show ad", "error");
                if (adBtn) {
                    adBtn.disabled = false;
                    adBtn.innerHTML = 'WATCH';
                }
            }
            
        } catch (error) {
            this.notificationManager.showNotification("Error", "Failed to watch ad", "error");
            if (adBtn) {
                adBtn.disabled = false;
                adBtn.innerHTML = 'WATCH';
            }
        }
    }

    formatTime(milliseconds) {
        const totalSeconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    isAdAvailable(adNumber) {
        const adTimerKey = `ad${adNumber}`;
        const currentTime = Date.now();
        return this.adTimers[adTimerKey] + this.adCooldown <= currentTime;
    }

    getAdTimeLeft(adNumber) {
        const adTimerKey = `ad${adNumber}`;
        const currentTime = Date.now();
        return Math.max(0, this.adTimers[adTimerKey] + this.adCooldown - currentTime);
    }

    updateAdButtons() {
        const currentTime = Date.now();
        
        for (let i = 1; i <= 2; i++) {
            const adBtn = document.getElementById(`watch-ad-${i}-btn`);
            if (!adBtn) continue;
            
            const timeLeft = Math.max(0, this.adTimers[`ad${i}`] + this.adCooldown - currentTime);
            
            if (timeLeft > 0) {
                adBtn.disabled = true;
                adBtn.innerHTML = this.formatTime(timeLeft);
                adBtn.classList.remove('available');
                adBtn.classList.add('cooldown');
            } else {
                adBtn.disabled = false;
                adBtn.innerHTML = 'WATCH';
                adBtn.classList.add('available');
                adBtn.classList.remove('cooldown');
            }
        }
    }

    startAdTimers() {
        this.updateAdButtons();
        setInterval(() => this.updateAdButtons(), 1000);
    }

    renderQuestsPage() {
        const questsPage = document.getElementById('quests-page');
        if (!questsPage) return;
        
        const userReferrals = this.safeNumber(this.userState.referrals || 0);
        const userTotalTasks = this.safeNumber(this.userState.totalTasks || 0);
        
        const friendsQuests = [
            { required: 10, reward: 0.01, current: userReferrals },
            { required: 25, reward: 0.03, current: userReferrals },
            { required: 50, reward: 0.05, current: userReferrals },
            { required: 100, reward: 0.10, current: userReferrals }
        ];
        
        const tasksQuests = [
            { required: 50, reward: 0.03, current: userTotalTasks },
            { required: 100, reward: 0.08, current: userTotalTasks },
            { required: 250, reward: 0.20, current: userTotalTasks },
            { required: 500, reward: 0.50, current: userTotalTasks }
        ];
        
        const nextFriendsQuest = friendsQuests.find(q => q.current < q.required) || friendsQuests[0];
        const nextTasksQuest = tasksQuests.find(q => q.current < q.required) || tasksQuests[0];
        
        questsPage.innerHTML = `
            <div class="quests-container">
                <div class="quests-section">
                    <h3><i class="fas fa-user-plus"></i> Friends Quests</h3>
                    <div id="friends-quests-list" class="quests-list">
                        ${this.renderQuestCard('friends', 0, nextFriendsQuest.required, nextFriendsQuest.reward, nextFriendsQuest.current)}
                    </div>
                </div>
                
                <div class="quests-section">
                    <h3><i class="fas fa-tasks"></i> Tasks Quests</h3>
                    <div id="tasks-quests-list" class="quests-list">
                        ${this.renderQuestCard('tasks', 0, nextTasksQuest.required, nextTasksQuest.reward, nextTasksQuest.current)}
                    </div>
                </div>
            </div>
        `;
        
        this.setupQuestClaimEvents();
    }
    
    renderQuestCard(questType, index, required, reward, current) {
        const progress = Math.min((current / required) * 100, 100);
        const isCompleted = current >= required;
        
        return `
            <div class="quest-card">
                <div class="quest-card-header">
                    <div class="quest-type-badge">
                        <i class="fas fa-${questType === 'friends' ? 'user-plus' : 'tasks'}"></i>
                        ${questType === 'friends' ? 'Friends' : 'Tasks'}
                    </div>
                    <div class="quest-status ${isCompleted ? 'ready' : 'progress'}">
                        ${isCompleted ? 'Ready' : 'In Progress'}
                    </div>
                </div>
                <div class="quest-card-body">
                    <h4 class="quest-title">${questType === 'friends' ? 'Invite' : 'Complete'} ${required} ${questType === 'friends' ? 'Friends' : 'Tasks'}</h4>
                    <div class="quest-progress-container">
                        <div class="quest-progress-info">
                            <span>${current}/${required}</span>
                            <span>${progress.toFixed(0)}%</span>
                        </div>
                        <div class="quest-progress-bar">
                            <div class="quest-progress-fill" style="width: ${progress}%"></div>
                        </div>
                    </div>
                    <div class="quest-reward-display">
                        <div class="reward-icon">
                            <img src="${this.settings.tonIcon}" alt="TON" style="width: 28px; height: 28px; object-fit: contain;">
                        </div>
                        <div class="reward-amount">
                            <span class="reward-value">Reward: ${reward.toFixed(3)} TON</span>
                        </div>
                    </div>
                </div>
                <div class="quest-card-footer">
                    <button class="quest-claim-btn ${isCompleted ? 'available' : 'disabled'}" 
                            data-quest-type="${questType}"
                            data-quest-index="${index}"
                            ${!isCompleted ? 'disabled' : ''}>
                        ${isCompleted ? 'CLAIM' : 'IN PROGRESS'}
                    </button>
                </div>
            </div>
        `;
    }

    setupQuestClaimEvents() {
        const claimBtns = document.querySelectorAll('.quest-claim-btn.available:not(:disabled)');
        claimBtns.forEach(btn => {
            btn.addEventListener('click', async () => {
                const questType = btn.getAttribute('data-quest-type');
                const questIndex = parseInt(btn.getAttribute('data-quest-index'));
                
                await this.claimQuest(questType, questIndex, btn);
            });
        });
    }

    async claimQuest(questType, questIndex, button) {
        try {
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            button.disabled = true;
            
            let adShown = false;
            if (window.AdBlock19345 && typeof window.AdBlock19345.show === 'function') {
                adShown = await new Promise((resolve) => {
                    window.AdBlock19345.show().then(() => {
                        resolve(true);
                    }).catch(() => {
                        resolve(false);
                    });
                });
            }
            
            if (!adShown) {
                this.notificationManager.showNotification("Ad Required", "Please watch the ad to claim reward", "info");
                button.innerHTML = originalText;
                button.disabled = false;
                return false;
            }
            
            const rewards = {
                friends: [0.01, 0.03, 0.05, 0.10],
                tasks: [0.03, 0.08, 0.20, 0.50]
            };
            
            const rewardAmount = rewards[questType][questIndex];
            const currentBalance = this.safeNumber(this.userState.balance);
            const newBalance = currentBalance + rewardAmount;
            
            if (this.db) {
                await this.db.ref(`users/${this.tgUser.id}`).update({
                    balance: newBalance,
                    totalEarned: this.safeNumber(this.userState.totalEarned) + rewardAmount
                });
                
                await this.db.ref(`users/${this.tgUser.id}/claimedQuests/${questType}_${questIndex}`).set({
                    claimed: true,
                    claimedAt: Date.now(),
                    reward: rewardAmount
                });
            }
            
            this.userState.balance = newBalance;
            this.userState.totalEarned = this.safeNumber(this.userState.totalEarned) + rewardAmount;
            
            this.cache.delete(`user_${this.tgUser.id}`);
            
            this.updateHeader();
            
            button.innerHTML = 'CLAIMED';
            button.classList.remove('available');
            button.classList.add('disabled');
            button.disabled = true;
            
            this.notificationManager.showNotification("Quest Claimed", `+${rewardAmount.toFixed(3)} TON!`, "success");
            
            return true;
            
        } catch (error) {
            this.notificationManager.showNotification("Error", "Failed to claim quest reward", "error");
            
            if (button) {
                button.innerHTML = 'CLAIM';
                button.disabled = false;
            }
            
            return false;
        }
    }

    async refreshReferralsList() {
        try {
            if (!this.db || !this.tgUser) return;
            
            const referralsRef = await this.db.ref(`referrals/${this.tgUser.id}`).once('value');
            if (!referralsRef.exists()) return;
            
            const referrals = referralsRef.val();
            const verifiedReferrals = [];
            
            for (const referralId in referrals) {
                const referral = referrals[referralId];
                if (referral.state === 'verified' && referral.bonusGiven) {
                    verifiedReferrals.push({
                        id: referralId,
                        ...referral
                    });
                }
            }
            
            this.userState.referrals = verifiedReferrals.length;
            
            if (document.getElementById('referrals-page')?.classList.contains('active')) {
                this.renderReferralsPage();
            }
            
        } catch (error) {
        }
    }

    renderReferralsPage() {
        const referralsPage = document.getElementById('referrals-page');
        if (!referralsPage) return;
        
        const referralLink = `https://t.me/${this.appConfig.BOT_USERNAME}/earn?startapp=${this.tgUser.id}`;
        const referrals = this.safeNumber(this.userState.referrals || 0);
        const referralEarnings = this.safeNumber(this.userState.referralEarnings || 0);
        
        const recentReferrals = this.loadRecentReferralsForDisplay();
        
        referralsPage.innerHTML = `
            <div class="referrals-container">
                <div class="referral-link-section">
                    <div class="referral-link-box">
                        <p class="link-label">Your referral link:</p>
                        <div class="link-display" id="referral-link-text">${referralLink}</div>
                        <button class="copy-btn" id="copy-referral-link-btn">
                            <i class="far fa-copy"></i> Copy Link
                        </button>
                    </div>
                    
                    <div class="referral-info">
                        <div class="info-card">
                            <div class="info-icon">
                                <i class="fas fa-gift"></i>
                            </div>
                            <div class="info-content">
                                <h4>Get ${this.settings.referralBonus.toFixed(3)} TON</h4>
                                <p>For each verified referral</p>
                            </div>
                        </div>
                        <div class="info-card">
                            <div class="info-icon">
                                <i class="fas fa-percentage"></i>
                            </div>
                            <div class="info-content">
                                <h4>Earn ${this.settings.referralPercentage}% Bonus</h4>
                                <p>From your referrals' earnings</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="referral-stats-section">
                    <h3><i class="fas fa-chart-bar"></i> Referrals Statistics</h3>
                    <div class="stats-grid-two">
                        <div class="stat-card">
                            <div class="stat-icon">
                                <i class="fas fa-users"></i>
                            </div>
                            <div class="stat-info">
                                <h4>Total Referrals</h4>
                                <p class="stat-value">${referrals}</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon">
                                <i class="fas fa-coins"></i>
                            </div>
                            <div class="stat-info">
                                <h4>Total Earnings</h4>
                                <p class="stat-value">${referralEarnings.toFixed(3)} TON</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="last-referrals-section">
                    <h3><i class="fas fa-history"></i> Recent Referrals</h3>
                    <div class="referrals-list" id="referrals-list">
                        ${recentReferrals.length > 0 ? 
                            recentReferrals.map(referral => this.renderReferralRow(referral)).join('') : 
                            '<div class="no-data"><i class="fas fa-handshake"></i><p>No referrals yet</p><p class="hint">Share your link to earn free TON!</p></div>'
                        }
                    </div>
                </div>
            </div>
        `;
        
        this.setupReferralsPageEvents();
    }

    renderReferralRow(referral) {
        return `
            <div class="referral-row">
                <div class="referral-row-avatar">
                    <img src="${referral.photoUrl || this.settings.defaultUserIcon}" alt="${referral.firstName}" 
                         oncontextmenu="return false;" 
                         ondragstart="return false;">
                </div>
                <div class="referral-row-info">
                    <p class="referral-row-username">${this.escapeHtml(referral.username)}</p>
                </div>
                <div class="referral-row-status ${referral.state}">
                    ${referral.state === 'verified' ? 'COMPLETED' : 'PENDING'}
                </div>
            </div>
        `;
    }

    loadRecentReferralsForDisplay() {
        return [];
    }

    setupReferralsPageEvents() {
        const copyBtn = document.getElementById('copy-referral-link-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const referralLink = `https://t.me/${this.appConfig.BOT_USERNAME}/earn?startapp=${this.tgUser.id}`;
                this.copyToClipboard(referralLink);
                
                copyBtn.classList.add('copied');
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = originalText;
                }, 2000);
            });
        }
    }

    renderWithdrawPage() {
        const withdrawPage = document.getElementById('withdraw-page');
        if (!withdrawPage) return;
        
        const userBalance = this.safeNumber(this.userState.balance);
        const minimumWithdraw = this.settings.minimumWithdraw;
        
        withdrawPage.innerHTML = `
            <div class="withdraw-container">
                <div class="withdraw-form">
                    <div class="form-group">
                        <label class="form-label" for="wallet-input">
                            <i class="fas fa-wallet"></i> TON Wallet Address
                        </label>
                        <input type="text" id="wallet-input" class="form-input" 
                               placeholder="Enter your TON wallet address (UQ...)"
                               required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label" for="amount-input">
                            <i class="fas fa-gem"></i> Withdrawal Amount
                        </label>
                        <input type="number" id="amount-input" class="form-input" 
                               step="0.00001" min="${minimumWithdraw}" max="${userBalance}"
                               placeholder="Minimum: ${minimumWithdraw.toFixed(3)} TON"
                               required>
                    </div>
                    
                    <div class="withdraw-minimum-info">
                        <i class="fas fa-info-circle"></i>
                        <span>Minimum Withdrawal: <strong>${minimumWithdraw.toFixed(3)} TON</strong></span>
                    </div>
                    
                    <button id="withdraw-btn" class="withdraw-btn" 
                            ${userBalance < minimumWithdraw ? 'disabled' : ''}>
                        <i class="fas fa-paper-plane"></i> WITHDRAW NOW
                    </button>
                </div>
                
                <div class="history-section">
                    <h3><i class="fas fa-history"></i> Withdrawal History</h3>
                    <div class="history-list" id="withdrawal-history-list">
                        ${this.userWithdrawals.length > 0 ? 
                            this.renderWithdrawalHistory() : 
                            '<div class="no-history"><i class="fas fa-history"></i><p>No withdrawal history</p></div>'
                        }
                    </div>
                </div>
            </div>
        `;
        
        this.setupWithdrawPageEvents();
    }

    renderWithdrawalHistory() {
        return this.userWithdrawals.slice(0, 5).map(transaction => {
            const date = new Date(transaction.createdAt || transaction.timestamp);
            const formattedDate = this.formatDate(date);
            const formattedTime = this.formatTime24(date);
            
            const amount = this.safeNumber(transaction.tonAmount || transaction.amount || 0);
            const status = transaction.status || 'pending';
            const wallet = transaction.walletAddress || '';
            const shortWallet = wallet.length > 10 ? 
                `${wallet.substring(0, 5)}...${wallet.substring(wallet.length - 5)}` : 
                wallet;
            
            const transactionLink = transaction.transaction_link || `https://tonviewer.com/${wallet}`;
            
            return `
                <div class="history-item">
                    <div class="history-top">
                        <div class="history-title">
                            <i class="fas fa-gem"></i>
                            <span>TON Withdrawal</span>
                        </div>
                        <span class="history-status ${status}">${status.toUpperCase()}</span>
                    </div>
                    <div class="history-details">
                        <div class="history-row">
                            <span class="detail-label">Amount:</span>
                            <span class="detail-value">${amount.toFixed(5)} TON</span>
                        </div>
                        <div class="history-row">
                            <span class="detail-label">Wallet:</span>
                            <span class="detail-value wallet-address" title="${wallet}">${shortWallet}</span>
                        </div>
                        <div class="history-row">
                            <span class="detail-label">Date:</span>
                            <span class="detail-value">${formattedDate} ${formattedTime}</span>
                        </div>
                    </div>
                    ${status === 'completed' ? `
                        <div class="history-explorer">
                            <a href="${transactionLink}" target="_blank" class="explorer-link">
                                <i class="fas fa-external-link-alt"></i> View on Explorer
                            </a>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    setupWithdrawPageEvents() {
        const walletInput = document.getElementById('wallet-input');
        const amountInput = document.getElementById('amount-input');
        const withdrawBtn = document.getElementById('withdraw-btn');
        
        if (amountInput) {
            amountInput.addEventListener('input', () => {
                const max = this.safeNumber(this.userState.balance);
                const value = parseFloat(amountInput.value) || 0;
                
                if (value > max) {
                    amountInput.value = max.toFixed(5);
                }
            });
        }
        
        if (withdrawBtn) {
            withdrawBtn.addEventListener('click', async () => {
                await this.handleWithdrawal();
            });
        }
    }

    async handleWithdrawal() {
        const walletInput = document.getElementById('wallet-input');
        const amountInput = document.getElementById('amount-input');
        const withdrawBtn = document.getElementById('withdraw-btn');
        
        if (!walletInput || !amountInput || !withdrawBtn) return;
        
        const walletAddress = walletInput.value.trim();
        const amount = parseFloat(amountInput.value);
        const userBalance = this.safeNumber(this.userState.balance);
        const minimumWithdraw = this.settings.minimumWithdraw;
        
        if (!walletAddress || walletAddress.length < 20) {
            this.notificationManager.showNotification("Error", "Please enter a valid TON wallet address", "error");
            return;
        }
        
        if (!amount || amount < minimumWithdraw) {
            this.notificationManager.showNotification("Error", `Minimum withdrawal is ${minimumWithdraw.toFixed(3)} TON`, "error");
            return;
        }
        
        if (amount > userBalance) {
            this.notificationManager.showNotification("Error", "Insufficient balance", "error");
            return;
        }
        
        const rateLimitCheck = this.rateLimiter.checkLimit(this.tgUser.id, 'withdrawal');
        if (!rateLimitCheck.allowed) {
            this.notificationManager.showNotification(
                "Rate Limit", 
                `Please wait ${Math.ceil(rateLimitCheck.remaining / 3600)} hours before making another withdrawal`, 
                "warning"
            );
            return;
        }
        
        const originalText = withdrawBtn.innerHTML;
        withdrawBtn.disabled = true;
        withdrawBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        
        try {
            if (this.adManager) {
                const adShown = await this.adManager.showWithdrawalAd();
                if (!adShown) {
                    this.notificationManager.showNotification("Ad Required", "Please watch the ad to process withdrawal", "info");
                    withdrawBtn.disabled = false;
                    withdrawBtn.innerHTML = originalText;
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            const newBalance = userBalance - amount;
            
            if (this.db) {
                await this.db.ref(`users/${this.tgUser.id}`).update({
                    balance: newBalance,
                    totalWithdrawals: this.safeNumber(this.userState.totalWithdrawals) + 1,
                    lastWithdrawalDate: Date.now()
                });
                
                const requestData = {
                    userId: this.tgUser.id,
                    userName: this.userState.firstName,
                    username: this.userState.username,
                    walletAddress: walletAddress,
                    amount: amount,
                    status: 'pending',
                    createdAt: Date.now()
                };
                
                await this.db.ref('withdrawals/pending').push(requestData);
            }
            
            this.userState.balance = newBalance;
            this.userState.totalWithdrawals = this.safeNumber(this.userState.totalWithdrawals) + 1;
            this.userState.lastWithdrawalDate = Date.now();
            
            this.cache.delete(`user_${this.tgUser.id}`);
            
            await this.updateAppStats('totalWithdrawals', 1);
            await this.updateAppStats('totalPayments', amount);
            
            await this.loadHistoryData();
            
            walletInput.value = '';
            amountInput.value = '';
            
            this.updateHeader();
            this.renderWithdrawPage();
            
            this.notificationManager.showNotification("Success", "Withdrawal request submitted!", "success");
            
        } catch (error) {
            this.notificationManager.showNotification("Error", "Failed to process withdrawal", "error");
        } finally {
            withdrawBtn.disabled = false;
            withdrawBtn.innerHTML = originalText;
        }
    }

    copyToClipboard(text) {
        if (!text || this.isCopying) return;
        
        this.isCopying = true;
        
        navigator.clipboard.writeText(text).then(() => {
            this.notificationManager.showNotification("Copied", "Text copied to clipboard", "success");
            setTimeout(() => {
                this.isCopying = false;
            }, 1000);
        }).catch(() => {
            this.notificationManager.showNotification("Error", "Failed to copy text", "error");
            setTimeout(() => {
                this.isCopying = false;
            }, 1000);
        });
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    }

    formatTime24(timestamp) {
        const date = new Date(timestamp);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    setupEventListeners() {
        const telegramIdElement = document.getElementById('user-telegram-id');
        if (telegramIdElement) {
            telegramIdElement.addEventListener('click', () => {
                if (this.tgUser?.id) {
                    this.copyToClipboard(this.tgUser.id.toString());
                }
            });
        }
    }

    generateReferralCode() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 7; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return `COIN${code}`;
    }

    safeNumber(value) {
        if (value === null || value === undefined) return 0;
        const num = Number(value);
        return isNaN(num) ? 0 : num;
    }

    getShortName(name) {
        if (!name) return 'User';
        return name.substring(0, 10);
    }

    truncateName(name, maxLength = 10) {
        if (!name) return 'User';
        if (name.length <= maxLength) return name;
        return name.substring(0, maxLength) + '...';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!window.Telegram || !window.Telegram.WebApp) {
        document.body.innerHTML = `
            <div class="error-container">
                <div class="error-content">
                    <div class="error-icon">
                        <i class="fab fa-telegram"></i>
                    </div>
                    <h2>CointoCash</h2>
                    <p>Please open from Telegram Mini App</p>
                </div>
            </div>
        `;
        return;
    }
    
    window.app = new CointoCashApp();
    
    setTimeout(() => {
        if (window.app && typeof window.app.initialize === 'function') {
            window.app.initialize();
        }
    }, 300);
});
