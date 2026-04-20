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
  if (!currentUser) {
    console.log('❌ No user signed in, cannot load match');
    return false;
  }
  
  console.log('🔍 Checking for active match in cloud...');
  
  try {
    const { data, error } = await _supabase
      .from('current_match')
      .select('*')
      .eq('coach_user_id', currentUser.id)
      .single();
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('❌ Error loading match:', error);
      throw error;
    }
    
    if (data) {
      console.log('✅ Found active match!', data);
      console.log('   Team:', data.team_name, 'vs', data.opponent);
      console.log('   Score:', data.score_home, '-', data.score_away);
      console.log('   Timer:', data.timer_seconds, 'seconds');
      console.log('   Players:', data.players?.length || 0);
      
      currentMatchId = data.id;
      
      // Restore match state
      console.log('🔄 Restoring match state...');
      restoreMatchState(data);
      
      // Start auto-save
      startAutoSave();
      
      console.log('✅ Match restoration complete!');
      return true;
    } else {
      console.log('ℹ️ No active match found in cloud');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error loading current match:', error);
    return false;
  }
}

/**
 * Restore all match state from saved data
 */
function restoreMatchState(data) {
  console.log('🔧 Starting match restoration...');
  
  // Check if initMatch is available
  if (typeof initMatch !== 'function') {
    console.error('❌ initMatch function not found! Cannot restore match.');
    alert('Error: Cannot restore match. Please refresh the page and try again.');
    return;
  }
  
  // Convert saved players back to roster format for initMatch
  const players = data.players || [];
  console.log('   Players to restore:', players.length);
  
  // Separate players by zone
  const rosterData = {
    gk: players.filter(p => p.zone === 'gk'),
    players: players.filter(p => p.zone === 'field'),
    subs: players.filter(p => p.zone === 'sub')
  };
  
  console.log('   Goalkeepers:', rosterData.gk.length);
  console.log('   Field players:', rosterData.players.length);
  console.log('   Substitutes:', rosterData.subs.length);
  
  // Set team names globally so initMatch can access them
  window.restoredTeamName = data.team_name || '';
  window.restoredOpponent = data.opponent || '';
  
  console.log('   Team names:', window.restoredTeamName, 'vs', window.restoredOpponent);
  
  // Call initMatch to set up all the match functionality
  console.log('📞 Calling initMatch()...');
  try {
    initMatch(rosterData);
    console.log('✅ initMatch() completed');
  } catch (error) {
    console.error('❌ Error calling initMatch:', error);
    alert('Error restoring match: ' + error.message);
    return;
  }
  
  // Update team names in topbar
  const topbarBrand = document.getElementById('topbarBrand');
  if (topbarBrand && window.restoredTeamName && window.restoredOpponent) {
    topbarBrand.textContent = `⬡ ${window.restoredTeamName} vs ${window.restoredOpponent}`;
    console.log('✅ Updated topbar brand');
  }
  
  // Now restore the dynamic state that initMatch doesn't handle
  console.log('🔧 Restoring dynamic state...');
  
  // Restore timer state
  matchSeconds = data.timer_seconds || 0;
  isTimerRunning = data.is_timer_running || false;
  currentHalf = data.current_half === 'second' ? 2 : 1;
  
  console.log('   Timer:', matchSeconds, 'seconds');
  console.log('   Running:', isTimerRunning);
  console.log('   Half:', currentHalf);
  
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
    console.log('✅ Timer started');
  }
  
  // Restore score
  if (data.score_home !== undefined) stats.goals = data.score_home;
  if (data.score_away !== undefined) stats.goalsAgainst = data.score_away;
  
  console.log('   Score:', stats.goals, '-', stats.goalsAgainst);
  
  // Restore all stats
  if (data.stats && Object.keys(data.stats).length > 0) {
    Object.assign(stats, data.stats);
    console.log('✅ Stats restored');
  }
  
  // Restore player stats
  if (data.players && data.players.length > 0) {
    data.players.forEach(savedPlayer => {
      if (playerStats[savedPlayer.id]) {
        Object.assign(playerStats[savedPlayer.id], savedPlayer.stats || {});
      }
    });
    console.log('✅ Player stats restored');
  }
  
  // Update all displays
  updateScoreboard();
  updateStats();
  renderPlayers();
  console.log('✅ UI updated');
  
  // Restore undo stack
  if (data.undo_stack && data.undo_stack.length > 0) {
    undoStack = data.undo_stack;
    const undoBtn = document.getElementById('undoBtn');
    const mobileUndoBtn = document.getElementById('mobileUndoBtn');
    if (undoBtn) undoBtn.disabled = false;
    if (mobileUndoBtn) mobileUndoBtn.disabled = false;
    console.log('✅ Undo stack restored (', data.undo_stack.length, 'actions)');
  }
  
  // Restore live broadcasting state
  if (data.is_broadcasting && data.live_match_id) {
    currentLiveMatchId = data.live_match_id;
    isLiveBroadcasting = true;
    if (typeof showLiveStatus === 'function') {
      showLiveStatus(true);
    }
    console.log('✅ Live broadcasting state restored');
  }
  
  console.log('🎉 Match state fully restored from cloud!');
  console.log('════════════════════════════════════════');
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
  
  // Also start listening for changes from other devices
  startRealtimeSync();
}

/**
 * Listen for changes from other devices in real-time
 */
function startRealtimeSync() {
  if (!currentUser) return;
  
  // Subscribe to changes on the current_match table
  const subscription = _supabase
    .channel('current_match_sync')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'current_match',
        filter: `coach_user_id=eq.${currentUser.id}`
      },
      (payload) => {
        console.log('📱 Match updated from another device!', payload);
        
        // Only update if the change came from a different session
        // (we don't want to reload our own changes)
        if (payload.new && payload.new.last_updated) {
          const lastUpdate = new Date(payload.new.last_updated);
          const now = new Date();
          const timeDiff = now - lastUpdate;
          
          // If update was more than 2 seconds ago, it's from another device
          if (timeDiff > 2000) {
            console.log('🔄 Syncing changes from other device...');
            syncFromCloud(payload.new);
          }
        }
      }
    )
    .subscribe();
  
  // Store subscription for cleanup
  window.currentMatchSubscription = subscription;
  
  console.log('👂 Listening for changes from other devices');
}

/**
 * Sync specific fields from cloud without full page reload
 */
function syncFromCloud(data) {
  // Update timer
  if (data.timer_seconds !== undefined && matchSeconds !== data.timer_seconds) {
    matchSeconds = data.timer_seconds;
    updateTimerDisplay();
  }
  
  // Update timer running state
  if (data.is_timer_running !== undefined && isTimerRunning !== data.is_timer_running) {
    isTimerRunning = data.is_timer_running;
    if (isTimerRunning && !timerInterval) {
      startTimer();
    } else if (!isTimerRunning && timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    
    const startStopBtn = document.getElementById('startStopBtn');
    if (startStopBtn) {
      startStopBtn.textContent = isTimerRunning ? '⏸ Pause' : '▶ Start';
      if (isTimerRunning) {
        startStopBtn.classList.add('active');
      } else {
        startStopBtn.classList.remove('active');
      }
    }
  }
  
  // Update half
  if (data.current_half !== undefined) {
    const newHalf = data.current_half === 'second' ? 2 : 1;
    if (currentHalf !== newHalf) {
      currentHalf = newHalf;
      const timerLabel = document.getElementById('timerLabel');
      if (timerLabel) {
        timerLabel.textContent = currentHalf === 1 ? '1st Half' : '2nd Half';
      }
    }
  }
  
  // Update score
  if (data.score_home !== undefined || data.score_away !== undefined) {
    if (stats.goals !== data.score_home || stats.goalsAgainst !== data.score_away) {
      stats.goals = data.score_home || 0;
      stats.goalsAgainst = data.score_away || 0;
      updateScoreboard();
    }
  }
  
  // Update all stats
  if (data.stats && Object.keys(data.stats).length > 0) {
    Object.assign(stats, data.stats);
    updateStats();
  }
  
  // Update player stats
  if (data.players && data.players.length > 0) {
    data.players.forEach(savedPlayer => {
      if (playerStats[savedPlayer.id] && savedPlayer.stats) {
        Object.assign(playerStats[savedPlayer.id], savedPlayer.stats);
      }
    });
    renderPlayers();
  }
  
  // Update undo stack
  if (data.undo_stack && data.undo_stack.length > 0) {
    undoStack = data.undo_stack;
    const undoBtn = document.getElementById('undoBtn');
    const mobileUndoBtn = document.getElementById('mobileUndoBtn');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (mobileUndoBtn) mobileUndoBtn.disabled = undoStack.length === 0;
  }
  
  console.log('✅ Synced from other device');
}

/**
 * Stop real-time sync listener
 */
function stopRealtimeSync() {
  if (window.currentMatchSubscription) {
    window.currentMatchSubscription.unsubscribe();
    window.currentMatchSubscription = null;
    console.log('👂 Stopped listening for changes');
  }
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
  
  // Also stop listening for changes
  stopRealtimeSync();
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
  console.log('════════════════════════════════════════');
  console.log('🔐 User signed in - checking for active match...');
  
  // Try to load existing match
  const hasActiveMatch = await loadCurrentMatch();
  
  if (hasActiveMatch) {
    console.log('✅ Active match found and restored!');
    
    // Match restored - hide setup screen, show tracker
    const setupScreen = document.getElementById('setupScreen');
    const appTopbar = document.getElementById('appTopbar');
    const appMain = document.getElementById('appMain');
    
    if (setupScreen) setupScreen.classList.add('hidden');
    if (appTopbar) appTopbar.style.display = 'flex';
    if (appMain) appMain.style.display = 'grid';
    
    console.log('✅ UI switched to tracker view');
    
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
      animation: slideDown 0.3s ease;
    `;
    notification.textContent = '📱 Continuing your match from another device';
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
    
    console.log('✅ Notification shown');
    console.log('════════════════════════════════════════');
    
    return true;
  } else {
    console.log('ℹ️ No active match - showing setup screen');
    console.log('════════════════════════════════════════');
    
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
