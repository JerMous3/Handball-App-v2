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
  // Restore team names
  teamName = data.team_name || '';
  opponent = data.opponent || '';
  
  // Update topbar brand
  const topbarBrand = document.getElementById('topbarBrand');
  if (topbarBrand && teamName && opponent) {
    topbarBrand.textContent = `⬡ ${teamName} vs ${opponent}`;
  }
  
  // Update scoreboard labels
  const labels = document.querySelectorAll('.scoreboard-teams span');
  if (labels.length >= 2) {
    labels[0].textContent = teamName || 'Home';
    labels[2].textContent = opponent || 'Away';
  }
  
  // Restore timer
  matchSeconds = data.timer_seconds || 0;
  isTimerRunning = data.is_timer_running || false;
  currentHalf = data.current_half || 'first';
  
  updateTimerDisplay();
  updateHalfLabel();
  
  if (isTimerRunning) {
    startTimer();
  }
  
  // Restore score
  stats.goals = data.score_home || 0;
  stats.goalsAgainst = data.score_away || 0;
  updateScoreboard();
  
  // Restore players
  if (data.players && data.players.length > 0) {
    currentPlayers = data.players;
    renderPlayers();
  }
  
  // Restore undo stack
  if (data.undo_stack && data.undo_stack.length > 0) {
    undoStack = data.undo_stack;
    const undoBtn = document.getElementById('undoBtn');
    const mobileUndoBtn = document.getElementById('mobileUndoBtn');
    if (undoBtn) undoBtn.disabled = false;
    if (mobileUndoBtn) mobileUndoBtn.disabled = false;
  }
  
  // Restore stats
  if (data.stats && Object.keys(data.stats).length > 0) {
    Object.assign(stats, data.stats);
    updateStats();
  }
  
  // Restore live broadcasting state
  if (data.is_broadcasting && data.live_match_id) {
    currentLiveMatchId = data.live_match_id;
    isLiveBroadcasting = true;
    if (typeof showLiveStatus === 'function') {
      showLiveStatus(true);
    }
  }
  
  console.log('✅ Match state restored from cloud');
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
  if (!teamName && !opponent && currentPlayers.length === 0) {
    return;
  }
  
  try {
    const matchState = {
      coach_user_id: currentUser.id,
      team_name: teamName,
      opponent: opponent,
      timer_seconds: matchSeconds,
      is_timer_running: isTimerRunning,
      current_half: currentHalf,
      score_home: stats.goals || 0,
      score_away: stats.goalsAgainst || 0,
      players: currentPlayers,
      undo_stack: undoStack.slice(-30), // Keep last 30 undo actions
      stats: stats,
      live_match_id: currentLiveMatchId,
      is_broadcasting: isLiveBroadcasting
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
 */
async function onUserSignedIn() {
  // Try to load existing match
  const hasActiveMatch = await loadCurrentMatch();
  
  if (!hasActiveMatch) {
    // No active match, start auto-save for new session
    startAutoSave();
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
