const { app, BrowserWindow, Tray, Menu, ipcMain, Notification, nativeImage, powerMonitor } = require('electron')
const path = require('path')
const fs = require('fs')
const { execSync } = require('child_process')

// ─── Stats tracking ──────────────────────────────────────────────────────────
const STATS_PATH = path.join(app.getPath('userData'), 'buggy-stats.json')

function loadStats() {
  try {
    if (fs.existsSync(STATS_PATH)) {
      return JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'))
    }
  } catch (e) {
    console.log('Could not load stats:', e.message)
  }
  return { sessions: [], streakDays: [] }
}

function saveStats(stats) {
  try {
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), 'utf8')
  } catch (e) {
    console.log('Could not save stats:', e.message)
  }
}

function recordSession(task, durationMinutes, completed) {
  const stats = loadStats()
  const today = new Date().toISOString().split('T')[0]

  stats.sessions.push({
    date: today,
    task,
    minutes: durationMinutes,
    completed,
    timestamp: Date.now()
  })

  if (!stats.streakDays.includes(today)) {
    stats.streakDays.push(today)
  }

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)
  const cutoffStr = cutoff.toISOString().split('T')[0]
  stats.streakDays = stats.streakDays.filter(d => d >= cutoffStr)

  saveStats(stats)
  return stats
}

function getTodayStats() {
  const stats = loadStats()
  const today = new Date().toISOString().split('T')[0]

  const todaySessions = stats.sessions.filter(s => s.date === today)
  const totalMinutes = todaySessions.reduce((sum, s) => sum + (s.completed ? s.minutes : 0), 0)
  const completedCount = todaySessions.filter(s => s.completed).length

  const taskGroups = {}
  todaySessions.forEach(s => {
    const key = s.task.toLowerCase().trim()
    if (!taskGroups[key]) {
      taskGroups[key] = { task: s.task, minutes: 0, count: 0 }
    }
    taskGroups[key].minutes += s.completed ? s.minutes : 0
    taskGroups[key].count++
  })

  let streak = 0
  const sortedDays = [...stats.streakDays].sort().reverse()
  let checkDate = new Date()
  for (let i = 0; i < 365; i++) {
    const dateStr = checkDate.toISOString().split('T')[0]
    if (sortedDays.includes(dateStr)) {
      streak++
      checkDate.setDate(checkDate.getDate() - 1)
    } else if (i > 0) {
      break
    } else {
      checkDate.setDate(checkDate.getDate() - 1)
    }
  }

  const heatmap = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dateStr = d.toISOString().split('T')[0]
    const dayMinutes = stats.sessions
      .filter(s => s.date === dateStr && s.completed)
      .reduce((sum, s) => sum + s.minutes, 0)
    heatmap.push({ date: dateStr, minutes: dayMinutes })
  }

  return { totalMinutes, completedCount, tasks: Object.values(taskGroups), streak, heatmap }
}

// ─── State ────────────────────────────────────────────────────────────────────
let tray = null
let launcherWindow = null
let overlayWindow = null
let focusInterval = null

const state = {
  isSessionActive: false,
  isFlowMode: false,
  currentTask: '',
  sessionGoal: '',
  blockedSites: [],
  blockedApps: [],
  blockMode: 'gentle',
  timerSeconds: 0,
  timerTotal: 0,
  theme: 'forest',
}

let appBlockInterval = null
let windowMonitorInterval = null

// ─── Hosts file blocking (hard mode) ─────────────────────────────────────────
const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts'
const HOSTS_MARKER_START = '# CREATURE-FOCUS-START'
const HOSTS_MARKER_END = '# CREATURE-FOCUS-END'

function blockSitesInHosts(sites) {
  try {
    let content = fs.readFileSync(HOSTS_PATH, 'utf8')
    content = removeFocusBlock(content)
    const block = [
      HOSTS_MARKER_START,
      ...sites.map(site => `127.0.0.1 ${site}\n127.0.0.1 www.${site}`),
      HOSTS_MARKER_END,
    ].join('\n')
    fs.writeFileSync(HOSTS_PATH, content + '\n' + block, 'utf8')
  } catch (e) {
    console.warn('Could not write hosts file (need admin):', e.message)
    return false
  }
  return true
}

function unblockSitesInHosts() {
  try {
    let content = fs.readFileSync(HOSTS_PATH, 'utf8')
    content = removeFocusBlock(content)
    fs.writeFileSync(HOSTS_PATH, content, 'utf8')
  } catch (e) {
    console.warn('Could not clean hosts file:', e.message)
  }
}

function removeFocusBlock(content) {
  const start = content.indexOf(HOSTS_MARKER_START)
  const end = content.indexOf(HOSTS_MARKER_END)
  if (start !== -1 && end !== -1) {
    return content.slice(0, start) + content.slice(end + HOSTS_MARKER_END.length)
  }
  return content
}

// ─── App blocking ────────────────────────────────────────────────────────────
function startAppBlocking(apps) {
  if (apps.length === 0) return

  const appToProcess = {
    'discord': 'Discord',
    'slack': 'Slack',
    'spotify': 'Spotify',
    'steam': 'steam',
    'telegram': 'Telegram',
    'notion': 'Notion',
    'chrome': 'chrome',
    'firefox': 'firefox',
    'edge': 'msedge',
    'brave': 'brave',
  }

  const processNames = apps.map(app => {
    const lower = app.toLowerCase()
    return appToProcess[lower] || app
  })

  appBlockInterval = setInterval(() => {
    processNames.forEach(proc => {
      try {
        execSync(`taskkill /IM "${proc}.exe" /F`, { stdio: 'ignore' })
        sendNotification('App blocked', `${proc} was closed. Focus!`)
      } catch (e) {
        // App not running, ignore
      }
    })
  }, 10000) // Check every 10 seconds instead of 5 to be less aggressive
}

function stopAppBlocking() {
  if (appBlockInterval) {
    clearInterval(appBlockInterval)
    appBlockInterval = null
  }
}

// ─── Window title monitoring ─────────────────────────────────────────────────
let lastDetectedSite = null
let lastDetectionTime = 0

function startWindowMonitoring(sites) {
  if (sites.length === 0) return

  const patterns = sites.map(site => site.toLowerCase().split('.')[0])

  windowMonitorInterval = setInterval(() => {
    if (!state.isSessionActive) return // Don't monitor if session ended

    try {
      const titles = execSync(
        'powershell -Command "Get-Process | ForEach-Object { $_.MainWindowTitle } | Where-Object { $_ }"',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 3000, shell: true, windowsHide: true }
      ).toLowerCase()

      for (let i = 0; i < patterns.length; i++) {
        if (titles.includes(patterns[i])) {
          const site = sites[i]
          const now = Date.now()

          if (lastDetectedSite !== site || now - lastDetectionTime > 30000) {
            lastDetectedSite = site
            lastDetectionTime = now

            if (overlayWindow && !state.isFlowMode) {
              overlayWindow.webContents.send('snark-message', getSnarkyMessage('distracted'))
              overlayWindow.webContents.send('site-detected', { site })
            }
            sendNotification('Get back to work!', `Caught you on ${site}! Focus on ${state.currentTask}`)
          }
          break
        }
      }
    } catch (e) {
      // PowerShell command failed, skip this check
    }
  }, 3000)
}

function stopWindowMonitoring() {
  if (windowMonitorInterval) {
    clearInterval(windowMonitorInterval)
    windowMonitorInterval = null
  }
  lastDetectedSite = null
  lastDetectionTime = 0
}

// ─── Snarky creature messages ─────────────────────────────────────────────────
const SNARK = {
  idle: [
    "hey boss...what we gonna do today?",
    "let's go let's go!",
    "this makes me feel good to see you and such etc",
    "grow my zucchini",
    "meeeow...meeeow",
  ],
  distracted: [
    "hey. HEY. That's not what you said you'd be doing.",
    "oh interesting, taking a little 'break' are we?!",
    "you said you were working on: %TASK%. This isn't that.",
    "i'm watching you",
    "nice try....get back to work.....",
    "fascinating. anyway. back to %TASK%.",
  ],
  starting: [
    "Okay. %TASK%. let's go!!!",
    "timer started...you've got this",
    "you've got this and when you finish you can eat a cooky",
    "do it do it do it!!!",
    "let's make it happen",
  ],
  finished: [
    "you actually did it!!!",
    "session complete! look at you go!",
    "That's %MINUTES% minutes of real work. Take a break, you earned it.",
    "done! now drink water",
    "nice work. i yam proud of you.",
  ],
  gaveup: [
    "you are fucking BUSTING MY CHOPS!!!",
    "i believed in you...",
    "u for real? we were doing so well...",
    "fine. FINE. go do whatever.",
    "disappointing but not surprising tbh",
  ],
  extending: [
    "let's keep going together! let's take ibuprofen!",
    "dude u on a mcfreakin roll!!!",
    "don't give up bitch!!!",
    "ain't nobody doing it like you",
  ],
  flowing: [
    "im here with you mam",
    "take your time epic style",
    "i like pizza in the morning i like pizza every day",
    "i am a killer on the dance floor",
    "hungry...",
  ],
}

function getSnarkyMessage(type) {
  const messages = SNARK[type] || SNARK.idle
  const msg = messages[Math.floor(Math.random() * messages.length)]
  return msg
    .replace('%TASK%', state.currentTask || 'your task')
    .replace('%MINUTES%', Math.round(state.timerTotal / 60))
}

function sendNotification(title, message) {
  new Notification({ title, body: message }).show()
}

// ─── Windows ──────────────────────────────────────────────────────────────────
function createLauncherWindow() {
  const iconPath = path.join(__dirname, '../assets/sprites/idle.png')
  launcherWindow = new BrowserWindow({
    width: 480,
    height: 880,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  launcherWindow.loadFile(path.join(__dirname, '../renderer/launcher.html'))
  launcherWindow.on('closed', () => { launcherWindow = null })
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 220,
    height: 320,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  const { screen } = require('electron')
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  overlayWindow.setPosition(width - 240, height - 340)
  overlayWindow.loadFile(path.join(__dirname, '../renderer/overlay.html'))
  overlayWindow.on('closed', () => { overlayWindow = null })
}

// ─── Session logic ────────────────────────────────────────────────────────────
function startSession({ task, sessionGoal, blockedSites, blockedApps, blockMode, durationMinutes, theme, isFlowMode }) {
  state.theme = theme || 'forest'
  state.isSessionActive = true
  state.isFlowMode = isFlowMode || false
  state.currentTask = task
  state.sessionGoal = sessionGoal || ''
  state.blockedSites = blockedSites || []
  state.blockedApps = blockedApps || []
  state.blockMode = state.isFlowMode ? 'gentle' : blockMode
  state.timerTotal = state.isFlowMode ? 0 : durationMinutes * 60
  state.timerSeconds = state.timerTotal

  if (state.blockMode === 'hard') {
    const hostsSuccess = blockSitesInHosts(blockedSites)
    if (!hostsSuccess && blockedSites.length > 0) {
      sendNotification('⚠️ Hard Mode Limited', "Couldn't modify system hosts file. Run as admin for full blocking. App blocking still active.")
      state.blockMode = 'gentle' // Fall back to gentle for site monitoring
    }
    if (state.blockedApps.length > 0) {
      startAppBlocking(state.blockedApps)
    }
  }

  if (!state.isFlowMode) {
    startWindowMonitoring(blockedSites)
  }

  if (launcherWindow) launcherWindow.close()
  createOverlayWindow()

  setTimeout(() => {
    if (overlayWindow) {
      overlayWindow.webContents.send('session-started', {
        task: state.currentTask,
        sessionGoal: state.sessionGoal,
        totalSeconds: state.timerTotal,
        message: getSnarkyMessage('starting'),
        theme: state.theme,
        isFlowMode: state.isFlowMode,
      })
    }
  }, 500)

  // Tick timer
  focusInterval = setInterval(() => {
    if (state.isFlowMode) {
      state.timerSeconds++
      if (overlayWindow) {
        overlayWindow.webContents.send('tick', { secondsLeft: state.timerSeconds, isFlowMode: true })
      }
      // Flow mode: gentle encouragement every 15 minutes
      if (state.timerSeconds > 0 && state.timerSeconds % 900 === 0) {
        if (overlayWindow) {
          overlayWindow.webContents.send('snark-message', getSnarkyMessage('flowing'))
        }
      }
    } else {
      state.timerSeconds--
      if (overlayWindow) {
        overlayWindow.webContents.send('tick', { secondsLeft: state.timerSeconds, isFlowMode: false })
      }
      if (state.timerSeconds <= 0) {
        // Don't auto-end - show extend screen instead
        clearInterval(focusInterval)
        focusInterval = null
        if (overlayWindow) {
          overlayWindow.webContents.send('timer-complete', { message: getSnarkyMessage('finished') })
        }
      }
    }
  }, 1000)
}

function extendSession(extraMinutes) {
  state.timerSeconds = extraMinutes * 60
  state.timerTotal += extraMinutes * 60

  if (overlayWindow) {
    overlayWindow.webContents.send('session-extended', {
      newSeconds: state.timerSeconds,
      message: getSnarkyMessage('extending'),
    })
  }

  // Restart timer
  focusInterval = setInterval(() => {
    state.timerSeconds--
    if (overlayWindow) {
      overlayWindow.webContents.send('tick', { secondsLeft: state.timerSeconds, isFlowMode: false })
    }
    if (state.timerSeconds <= 0) {
      clearInterval(focusInterval)
      focusInterval = null
      if (overlayWindow) {
        overlayWindow.webContents.send('timer-complete', { message: getSnarkyMessage('finished') })
      }
    }
  }, 1000)
}

function endSession(early = false) {
  if (focusInterval) clearInterval(focusInterval)
  focusInterval = null

  const wasFlowMode = state.isFlowMode
  const minutesCompleted = wasFlowMode
    ? Math.round(state.timerSeconds / 60)
    : Math.round((state.timerTotal - Math.max(0, state.timerSeconds)) / 60)
  recordSession(state.currentTask, minutesCompleted, !early || wasFlowMode)

  state.isSessionActive = false
  state.isFlowMode = false

  stopWindowMonitoring()

  if (state.blockMode === 'hard') {
    unblockSitesInHosts()
    stopAppBlocking()
  }

  // Flow mode always celebrates (any amount of work is good!)
  // Regular mode: celebrate if completed, disappoint if gave up early
  const shouldCelebrate = wasFlowMode || !early
  const messageType = shouldCelebrate ? 'finished' : 'gaveup'
  const message = getSnarkyMessage(messageType)

  if (overlayWindow) {
    overlayWindow.webContents.send('session-ended', { message, early: !shouldCelebrate, minutesCompleted })
  }
}

function reopenLauncher() {
  if (overlayWindow) overlayWindow.close()
  setTimeout(() => {
    if (!launcherWindow) createLauncherWindow()
  }, 300)
}

// ─── IPC handlers ────────────────────────────────────────────────────────────
ipcMain.on('start-session', (event, data) => startSession(data))
ipcMain.on('extend-session', (event, { minutes }) => extendSession(minutes))
ipcMain.on('end-session', () => endSession(false))
ipcMain.on('end-session-early', () => endSession(true))
ipcMain.on('close-overlay', () => reopenLauncher())
ipcMain.on('minimize-overlay', () => {
  if (overlayWindow) overlayWindow.hide()
})
ipcMain.on('minimize-launcher', () => {
  if (launcherWindow) launcherWindow.minimize()
})
ipcMain.on('open-launcher', () => {
  if (state.isSessionActive) {
    if (overlayWindow) {
      overlayWindow.show()
      overlayWindow.focus()
    }
    return
  }
  if (!launcherWindow) createLauncherWindow()
  else launcherWindow.focus()
})
ipcMain.on('get-snark', (event, type) => {
  event.reply('snark-message', getSnarkyMessage(type))
})
ipcMain.on('restore-session', (event) => {
  // Restore session state if overlay was closed but session still active
  if (state.isSessionActive && overlayWindow) {
    overlayWindow.webContents.send('session-restored', {
      task: state.currentTask,
      sessionGoal: state.sessionGoal,
      secondsLeft: state.timerSeconds,
      totalSeconds: state.timerTotal,
      theme: state.theme,
      isFlowMode: state.isFlowMode,
    })
  }
})
ipcMain.handle('get-stats', () => getTodayStats())
ipcMain.handle('get-session-state', () => ({
  isSessionActive: state.isSessionActive,
  isFlowMode: state.isFlowMode,
  task: state.currentTask,
  sessionGoal: state.sessionGoal,
  secondsLeft: state.timerSeconds,
  totalSeconds: state.timerTotal,
  theme: state.theme,
}))

// ─── Tray ─────────────────────────────────────────────────────────────────────
function createTray() {
  const iconPath = path.join(__dirname, '../assets/sprites/idle.png')
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty()

  tray = new Tray(icon)
  tray.setToolTip('Buggy Focus Timer')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Start Focus Session',
      click: () => {
        if (!launcherWindow) createLauncherWindow()
        else launcherWindow.focus()
      }
    },
    { type: 'separator' },
    {
      label: 'End Session Early',
      click: () => endSession(true)
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setContextMenu(menu)
  tray.on('click', () => {
    if (state.isSessionActive) {
      if (overlayWindow) {
        overlayWindow.show()
        overlayWindow.focus()
      } else {
        // Session active but overlay closed - recreate it
        createOverlayWindow()
        setTimeout(() => {
          if (overlayWindow) {
            overlayWindow.webContents.send('session-restored', {
              task: state.currentTask,
              sessionGoal: state.sessionGoal,
              secondsLeft: state.timerSeconds,
              totalSeconds: state.timerTotal,
              theme: state.theme,
              isFlowMode: state.isFlowMode,
            })
          }
        }, 500)
      }
    } else {
      if (!launcherWindow) createLauncherWindow()
      else launcherWindow.focus()
    }
  })
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray()
  createLauncherWindow()

  // Handle system suspend/resume to prevent timer issues when computer sleeps
  powerMonitor.on('suspend', () => {
    // Stop monitoring when system goes to sleep to prevent errors on wake
    stopWindowMonitoring()
  })

  powerMonitor.on('resume', () => {
    // Resume monitoring if session is still active
    if (state.isSessionActive && !state.isFlowMode && state.blockedSites.length > 0) {
      startWindowMonitoring(state.blockedSites)
    }
  })
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})

app.on('before-quit', () => {
  if (state.blockMode === 'hard' && state.isSessionActive) {
    unblockSitesInHosts()
    stopAppBlocking()
  }
})
