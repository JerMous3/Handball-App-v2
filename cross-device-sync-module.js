// ============================================================
// CROSS-DEVICE SESSION SYNC MODULE
// Add this to index.html after Supabase initialization
// ============================================================

let autoSaveInterval = null;
let currentMatchId = null;

// ============================================================
// 1. LOAD CURRENT MATCH ON STARTUP
// ============================================================

/**
 * Load active match from Supabase when app starts
 * Call this after user signs in
 */
async function loadCurrentMatch() {
  if (!currentUser) return;
  
  try {
    const { data, error } = await _supabase
      .from('current_match')
      .select('*')
      .eq('coach_user_id', currentUser.id)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      throw error;
    }
    
    if (data) {
      console.log('📱 Found active match on another device - restoring...');
      currentMatchId = data.id;
      
      // Restore match state
      restoreMatchState(data);
      
      // Start auto-save
      startAutoSave();
      
      return true;
    } else {
      console.log('No active match found');
      return false;
    }
    
  } catch (error) {
    console.error('Error loading current match:', error);
    return false;
  }
}

/**
 * Restore all match state from saved data
 */
function restoreMatchState(data) {
  // Convert saved players back to roster format for initMatch
  const players = data.players || [];
  
  // Separate players by zone
  const rosterData = {
    gk: players.filter(p => p.zone === 'gk'),
    players: players.filter(p => p.zone === 'field'),
    subs: players.filter(p => p.zone === 'sub')
  };
  
  // Set team names globally so initMatch can access them
  window.restoredTeamName = data.team_name || '';
  window.restoredOpponent = data.opponent || '';
  
  // Call initMatch to set up all the match functionality
  if (typeof initMatch === 'function') {
    initMatch(rosterData);
  } else {
    console.error('initMatch function not found!');
    return;
  }
  
  // Update team names in topbar
  const topbarBrand = document.getElementById('topbarBrand');
  if (topbarBrand && window.restoredTeamName && window.restoredOpponent) {
    topbarBrand.textContent = `⬡ ${window.restoredTeamName} vs ${window.restoredOpponent}`;
  }
  
  // Now restore the dynamic state that initMatch doesn't handle
  
  // Restore timer state
  matchSeconds = data.timer_seconds || 0;
  isTimerRunning = data.is_timer_running || false;
  currentHalf = data.current_half === 'second' ? 2 : 1;
  
  updateTimerDisplay();
  const timerLabel = document.getElementById('timerLabel');
  if (timerLabel) {
    timerLabel.textContent = currentHalf === 1 ? '1st Half' : '2nd Half';
  }
  
  if (isTimerRunning) {
    const startStopBtn = document.getElementById('startStopBtn');
    if (startStopBtn) {
      startStopBtn.textContent = '⏸ Pause';
      startStopBtn.classList.add('active');
    }
    startTimer();
  }
  
  // Restore score
  if (data.score_home !== undefined) stats.goals = data.score_home;
  if (data.score_away !== undefined) stats.goalsAgainst = data.score_away;
  
  // Restore all stats
  if (data.stats && Object.keys(data.stats).length > 0) {
    Object.assign(stats, data.stats);
  }
  
  // Restore player stats
  if (data.players && data.players.length > 0) {
    data.players.forEach(savedPlayer => {
      if (playerStats[savedPlayer.id]) {
        Object.assign(playerStats[savedPlayer.id], savedPlayer.stats || {});
      }
    });
  }
  
  // Update all displays
  updateScoreboard();
  updateStats();
  renderPlayers();
  
  // Restore undo stack
  if (data.undo_stack && data.undo_stack.length > 0) {
    undoStack = data.undo_stack;
    const undoBtn = document.getElementById('undoBtn');
    const mobileUndoBtn = document.getElementById('mobileUndoBtn');
    if (undoBtn) undoBtn.disabled = false;
    if (mobileUndoBtn) mobileUndoBtn.disabled = false;
  }
  
  // Restore live broadcasting state
  if (data.is_broadcasting && data.live_match_id) {
    currentLiveMatchId = data.live_match_id;
    isLiveBroadcasting = true;
    if (typeof showLiveStatus === 'function') {
      showLiveStatus(true);
    }
  }
  
  console.log('✅ Match state fully restored from cloud');
  console.log('   Timer:', matchSeconds, 'seconds');
  console.log('   Score:', stats.goals, '-', stats.goalsAgainst);
  console.log('   Players:', data.players?.length || 0);
}

// ============================================================
// 2. AUTO-SAVE CURRENT MATCH
// ============================================================

/**
 * Start auto-saving match state every 5 seconds
 */
function startAutoSave() {
  if (autoSaveInterval) return; // Already running
  
  console.log('💾 Auto-save enabled - syncing every 5 seconds');
  
  autoSaveInterval = setInterval(() => {
    saveCurrentMatch();
  }, 5000); // Save every 5 seconds
}

/**
 * Stop auto-saving
 */
function stopAutoSave() {
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
    console.log('Auto-save stopped');
  }
}

/**
 * Save current match state to Supabase
 */
async function saveCurrentMatch() {
  if (!currentUser) return;
  
  // Don't save if no match is active
  if ((!window.restoredTeamName && !teamName) && (!window.restoredOpponent && !opponent) && currentPlayers.length === 0) {
    return;
  }
  
  try {
    // Enrich players with their current stats and zone
    const playersWithStats = currentPlayers.map(player => ({
      ...player,
      stats: playerStats[player.id] || {},
      zone: playerZone[player.id] || 'field'
    }));
    
    const matchState = {
      coach_user_id: currentUser.id,
      team_name: window.restoredTeamName || teamName || '',
      opponent: window.restoredOpponent || opponent || '',
      timer_seconds: matchSeconds || 0,
      is_timer_running: isTimerRunning || false,
      current_half: currentHalf === 2 ? 'second' : 'first',
      score_home: stats?.goals || 0,
      score_away: stats?.goalsAgainst || 0,
      players: playersWithStats,
      undo_stack: (undoStack || []).slice(-30), // Keep last 30 undo actions
      stats: stats || {},
      live_match_id: currentLiveMatchId || null,
      is_broadcasting: isLiveBroadcasting || false
    };
    
    // Upsert (insert or update)
    const { data, error } = await _supabase
      .from('current_match')
      .upsert(matchState, { 
        onConflict: 'coach_user_id',
        ignoreDuplicates: false 
      })
      .select()
      .single();
    
    if (error) throw error;
    
    if (data) {
      currentMatchId = data.id;
    }
    
  } catch (error) {
    console.error('Error auto-saving match:', error);
  }
}

/**
 * Clear current match from Supabase
 * Call this when match is saved to history or reset
 */
async function clearCurrentMatch() {
  if (!currentUser) return;
  
  try {
    await _supabase
      .from('current_match')
      .delete()
      .eq('coach_user_id', currentUser.id);
    
    currentMatchId = null;
    stopAutoSave();
    
    console.log('Current match cleared from cloud');
    
  } catch (error) {
    console.error('Error clearing current match:', error);
  }
}

// ============================================================
// 3. INTEGRATION HOOKS
// ============================================================

/**
 * Call this after user signs in successfully
 * Returns true if active match was restored, false if not
 */
async function onUserSignedIn() {
  // Try to load existing match
  const hasActiveMatch = await loadCurrentMatch();
  
  if (hasActiveMatch) {
    // Match restored - hide setup screen, show tracker
    document.getElementById('setupScreen').classList.add('hidden');
    document.getElementById('appTopbar').style.display = 'flex';
    document.getElementById('appMain').style.display = 'grid';
    
    // Show notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--accent);
      color: #000;
      padding: 16px 24px;
      border-radius: 12px;
      font-weight: 700;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    notification.textContent = '📱 Continuing your match from another device';
    document.body.appendChild(notification);
    
    setTimeout(() => notification.remove(), 3000);
    
    return true;
  } else {
    // No active match, start auto-save for new session
    startAutoSave();
    return false;
  }
}

/**
 * Call this when match is saved to history
 */
async function onMatchSavedToHistory() {
  await clearCurrentMatch();
}

/**
 * Call this when match is reset
 */
async function onMatchReset() {
  await clearCurrentMatch();
  // Restart auto-save for new match
  startAutoSave();
}

/**
 * Call this when user signs out
 */
async function onUserSignOut() {
  stopAutoSave();
}

// ============================================================
// 4. EXPOSE FUNCTIONS GLOBALLY
// ============================================================

window.loadCurrentMatch = loadCurrentMatch;
window.saveCurrentMatch = saveCurrentMatch;
window.clearCurrentMatch = clearCurrentMatch;
window.startAutoSave = startAutoSave;
window.stopAutoSave = stopAutoSave;
window.onUserSignedIn = onUserSignedIn;
window.onMatchSavedToHistory = onMatchSavedToHistory;
window.onMatchReset = onMatchReset;
window.onUserSignOut = onUserSignOut;

console.log('📱 Cross-device sync module loaded');

// ============================================================
// INTEGRATION INSTRUCTIONS:
// ============================================================
/*

1. After user signs in (in initMatch function):
   await onUserSignedIn();

2. When saving match to history (in saveMatchToHistory):
   await onMatchSavedToHistory();

3. When resetting match (in resetTimer):
   await onMatchReset();

4. When signing out (in signOut):
   await onUserSignOut();

*/
