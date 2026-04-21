// ============================================================
// CROSS-DEVICE SESSION SYNC MODULE v2.1
// Last updated: 2026-04-21 16:30
// Add this to index.html after Supabase initialization
// ============================================================

console.log('📱 Loading sync module v2.1...');

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
      
      // Check if this is actually a real match (has players OR team names)
      const hasPlayers = data.players && data.players.length > 0;
      const hasTeamNames = data.team_name || data.opponent;
      
      if (!hasPlayers && !hasTeamNames) {
        console.log('⚠️ Match found but has no data - treating as empty');
        console.log('   Deleting empty match from cloud...');
        
        // Delete this empty match
        await _supabase
          .from('current_match')
          .delete()
          .eq('id', data.id);
        
        console.log('ℹ️ No active match found in cloud');
        return false;
      }
      
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
  
  // CRITICAL: Clear localStorage timer to prevent conflicts
  console.log('🧹 Clearing localStorage timer (preventing conflicts)...');
  localStorage.removeItem('handballtrack_timer');
  
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
  
  // Set team names globally
  window.teamName = data.team_name || '';
  window.opponent = data.opponent || '';
  
  // Update ALL team name displays in the UI
  const homeNameEl = document.getElementById('homeTeamName');
  const awayNameEl = document.getElementById('awayTeamName');
  const mobileHomeEl = document.getElementById('mobileHomeTeam');
  const mobileAwayEl = document.getElementById('mobileAwayTeam');
  const mobileHomeEl2 = document.getElementById('mobileHomeTeam2');
  const mobileAwayEl2 = document.getElementById('mobileAwayTeam2');
  
  if (homeNameEl) homeNameEl.textContent = window.teamName || 'Home Team';
  if (awayNameEl) awayNameEl.textContent = window.opponent || 'Away Team';
  if (mobileHomeEl) mobileHomeEl.textContent = window.teamName || 'Home Team';
  if (mobileAwayEl) mobileAwayEl.textContent = window.opponent || 'Away Team';
  if (mobileHomeEl2) mobileHomeEl2.textContent = window.teamName || 'Home Team';
  if (mobileAwayEl2) mobileAwayEl2.textContent = window.opponent || 'Away Team';
  
  // Update scoreboard labels
  const labels = document.querySelectorAll('.scoreboard-teams span');
  if (labels.length >= 2) {
    labels[0].textContent = window.teamName || 'Home';
    labels[2].textContent = window.opponent || 'Away';
  }
  
  // Update topbar brand
  const topbarBrand = document.getElementById('topbarBrand');
  if (topbarBrand && window.teamName && window.opponent) {
    topbarBrand.textContent = `⬡ ${window.teamName} vs ${window.opponent}`;
    console.log('✅ Updated all team name displays');
  }
  
  // Now restore the dynamic state that initMatch doesn't handle
  console.log('🔧 Restoring dynamic state...');
  
  // Restore timer state - use let to ensure local scope
  let restoredMatchSeconds = data.timer_seconds || 0;
  let restoredTimerRunning = data.is_timer_running || false;
  let restoredCurrentHalf = data.current_half === 'second' ? 2 : 1;
  
  // Update global variables via window (they exist in main script scope)
  window.matchSeconds = restoredMatchSeconds;
  window.timerRunning = restoredTimerRunning;
  window.currentHalf = restoredCurrentHalf;
  
  console.log('   Set window.matchSeconds:', window.matchSeconds);
  console.log('   Set window.timerRunning:', window.timerRunning);
  console.log('   Set window.currentHalf:', window.currentHalf);
  
  // CRITICAL: Also update the local variables by executing in the main window context
  // This ensures both local and window variables are synchronized
  try {
    // Execute in the main script's scope to update local variables
    const script = document.createElement('script');
    script.textContent = `
      if (typeof matchSeconds !== 'undefined') matchSeconds = ${restoredMatchSeconds};
      if (typeof timerRunning !== 'undefined') timerRunning = ${restoredTimerRunning};
      if (typeof currentHalf !== 'undefined') currentHalf = ${restoredCurrentHalf};
      console.log('✅ Local timer variables synchronized');
    `;
    document.body.appendChild(script);
    document.body.removeChild(script);
  } catch (e) {
    console.error('Error synchronizing local variables:', e);
  }
  
  // Update timer display
  if (typeof updateTimerDisplay === 'function') {
    try {
      updateTimerDisplay();
      console.log('✅ Timer display updated via updateTimerDisplay()');
    } catch (e) {
      console.error('Error calling updateTimerDisplay:', e);
    }
  } else {
    // Fallback: manually update timer display if function doesn't exist yet
    console.log('⚠️ updateTimerDisplay not available, updating manually');
    const timerDisplayEl = document.querySelector('.timer-display');
    if (timerDisplayEl) {
      const mins = Math.floor(restoredMatchSeconds / 60);
      const secs = restoredMatchSeconds % 60;
      timerDisplayEl.textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
      console.log('✅ Timer display updated manually:', timerDisplayEl.textContent);
    }
  }
  
  const timerLabel = document.getElementById('timerLabel');
  if (timerLabel) {
    timerLabel.textContent = restoredCurrentHalf === 1 ? '1st Half' : '2nd Half';
    console.log('✅ Half label updated:', timerLabel.textContent);
  }
  
  // Restore timer state variables for proper timer continuation
  if (restoredTimerRunning) {
    try {
      console.log('⏰ Restoring running timer...');
      
      // CRITICAL: Set all timer state variables and start interval in main scope
      const script = document.createElement('script');
      script.textContent = `
        console.log('  Setting timer variables in main scope...');
        if (typeof timerPausedAt !== 'undefined') {
          timerPausedAt = ${restoredMatchSeconds};
          console.log('  ✅ timerPausedAt =', timerPausedAt);
        }
        if (typeof timerStartTime !== 'undefined') {
          timerStartTime = Date.now();
          console.log('  ✅ timerStartTime =', new Date(timerStartTime).toISOString());
        }
        if (typeof timerRunning !== 'undefined') {
          timerRunning = true;
          console.log('  ✅ timerRunning = true');
        }
        
        // Start the timer interval
        if (typeof startTimerInterval === 'function') {
          startTimerInterval();
          console.log('  ✅ startTimerInterval() called');
          
          // Verify it worked
          if (timerInterval) {
            console.log('  ✅✅ Timer interval is now ACTIVE!');
          } else {
            console.error('  ❌ Timer interval is still null after calling startTimerInterval!');
          }
        } else {
          console.error('  ❌ startTimerInterval function not found!');
        }
      `;
      document.body.appendChild(script);
      document.body.removeChild(script);
      
      // Update button UI
      const startStopBtn = document.getElementById('startStopBtn');
      if (startStopBtn) {
        startStopBtn.textContent = '⏸ Pause';
        startStopBtn.classList.add('active');
      }
      
      console.log('✅ Timer restore complete');
    } catch (e) {
      console.error('❌ Error starting timer:', e);
    }
  } else {
    console.log('ℹ️ Timer was paused - not starting interval');
  }
  
  // Restore score
  if (data.score_home !== undefined && window.stats) {
    window.stats.goals = data.score_home;
  }
  if (data.score_away !== undefined && window.stats) {
    window.stats.goalsAgainst = data.score_away;
  }
  
  console.log('   Score:', window.stats?.goals || 0, '-', window.stats?.goalsAgainst || 0);
  
  // Restore all stats
  if (data.stats && Object.keys(data.stats).length > 0 && window.stats) {
    Object.assign(window.stats, data.stats);
    console.log('✅ Stats restored');
  }
  
  // Restore player stats
  if (data.players && data.players.length > 0 && window.playerStats) {
    data.players.forEach(savedPlayer => {
      if (window.playerStats[savedPlayer.id]) {
        Object.assign(window.playerStats[savedPlayer.id], savedPlayer.stats || {});
      }
    });
    console.log('✅ Player stats restored');
  }
  
  // Update all displays - wrap in try-catch in case functions don't exist
  try {
    if (typeof updateScoreboard === 'function') updateScoreboard();
    if (typeof updateStats === 'function') updateStats();
    if (typeof renderPlayers === 'function') renderPlayers();
    console.log('✅ UI updated');
  } catch (e) {
    console.error('Error updating UI:', e);
  }
  
  // Restore undo stack
  if (data.undo_stack && data.undo_stack.length > 0 && window.undoStack) {
    // Update window.undoStack
    window.undoStack.length = 0; // Clear it first
    data.undo_stack.forEach(item => window.undoStack.push(item));
    
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
        console.log('📱 Received change notification from Supabase', payload);
        
        // Sync the changes from the other device
        // We use a small debounce to avoid syncing our own rapid-fire changes
        if (payload.new) {
          // Check if this might be our own save (within last 1 second)
          const lastUpdate = new Date(payload.new.last_updated);
          const now = new Date();
          const timeDiff = now - lastUpdate;
          
          // Small window to ignore our own very recent saves
          if (timeDiff < 500) {
            console.log('ℹ️ Ignoring own recent update (', timeDiff, 'ms ago)');
            return;
          }
          
          console.log('🔄 Syncing changes from other device (', timeDiff, 'ms ago)...');
          syncFromCloud(payload.new);
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
  console.log('🔄 Received update from another device');
  
  // Show notification that another device made changes
  showSyncNotification();
  
  // Update timer - use window variables
  if (data.timer_seconds !== undefined && window.matchSeconds !== data.timer_seconds) {
    window.matchSeconds = data.timer_seconds;
    // Also update local variable via script injection
    const script = document.createElement('script');
    script.textContent = `if (typeof matchSeconds !== 'undefined') matchSeconds = ${data.timer_seconds};`;
    document.body.appendChild(script);
    document.body.removeChild(script);
    
    if (typeof updateTimerDisplay === 'function') updateTimerDisplay();
  }
  
  // Update timer running state
  if (data.is_timer_running !== undefined && window.timerRunning !== data.is_timer_running) {
    window.timerRunning = data.is_timer_running;
    
    // Update local variable and start/stop timer
    const script2 = document.createElement('script');
    script2.textContent = `
      if (typeof timerRunning !== 'undefined') timerRunning = ${data.is_timer_running};
      if (${data.is_timer_running} && typeof timerInterval !== 'undefined' && !timerInterval) {
        if (typeof timerPausedAt !== 'undefined') timerPausedAt = ${data.timer_seconds};
        if (typeof timerStartTime !== 'undefined') timerStartTime = Date.now();
        if (typeof startTimerInterval === 'function') startTimerInterval();
      } else if (!${data.is_timer_running} && typeof timerInterval !== 'undefined' && timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    `;
    document.body.appendChild(script2);
    document.body.removeChild(script2);
    
    const startStopBtn = document.getElementById('startStopBtn');
    if (startStopBtn) {
      startStopBtn.textContent = data.is_timer_running ? '⏸ Pause' : '▶ Start';
      if (data.is_timer_running) {
        startStopBtn.classList.add('active');
      } else {
        startStopBtn.classList.remove('active');
      }
    }
  }
  
  // Update half
  if (data.current_half !== undefined) {
    const newHalf = data.current_half === 'second' ? 2 : 1;
    if (window.currentHalf !== newHalf) {
      window.currentHalf = newHalf;
      
      // Update local variable
      const script3 = document.createElement('script');
      script3.textContent = `if (typeof currentHalf !== 'undefined') currentHalf = ${newHalf};`;
      document.body.appendChild(script3);
      document.body.removeChild(script3);
      
      const timerLabel = document.getElementById('timerLabel');
      if (timerLabel) {
        timerLabel.textContent = newHalf === 1 ? '1st Half' : '2nd Half';
      }
    }
  }
  
  // Update score
  if (data.score_home !== undefined || data.score_away !== undefined) {
    if (window.stats.goals !== data.score_home || window.stats.goalsAgainst !== data.score_away) {
      window.stats.goals = data.score_home || 0;
      window.stats.goalsAgainst = data.score_away || 0;
      updateScoreboard();
    }
  }
  
  // Update all stats
  if (data.stats && Object.keys(data.stats).length > 0) {
    Object.assign(window.stats, data.stats);
    updateStats();
  }
  
  // Update player stats
  if (data.players && data.players.length > 0) {
    data.players.forEach(savedPlayer => {
      if (window.playerStats[savedPlayer.id] && savedPlayer.stats) {
        Object.assign(window.playerStats[savedPlayer.id], savedPlayer.stats);
      }
    });
    renderPlayers();
  }
  
  // Update undo stack
  if (data.undo_stack && data.undo_stack.length > 0) {
    window.undoStack.length = 0;
    data.undo_stack.forEach(item => window.undoStack.push(item));
    const undoBtn = document.getElementById('undoBtn');
    const mobileUndoBtn = document.getElementById('mobileUndoBtn');
    if (undoBtn) undoBtn.disabled = window.undoStack.length === 0;
    if (mobileUndoBtn) mobileUndoBtn.disabled = window.undoStack.length === 0;
  }
  
  console.log('✅ Synced from other device');
}

/**
 * Show notification when another device updates the match
 */
function showSyncNotification() {
  // Don't spam notifications - only show once every 30 seconds
  const now = Date.now();
  if (window.lastSyncNotification && (now - window.lastSyncNotification) < 30000) {
    return;
  }
  window.lastSyncNotification = now;
  
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: #FF9500;
    color: #000;
    padding: 12px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease;
  `;
  notification.textContent = '📱 Updated from another device';
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.3s';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
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
  console.log('💾 saveCurrentMatch() called');
  
  if (!currentUser) {
    console.log('❌ No currentUser, exiting');
    return;
  }
  
  console.log('✅ currentUser exists:', currentUser.id);
  
  // Check if match variables exist (they're created by initMatch)
  if (typeof window.currentPlayers === 'undefined' || !window.currentPlayers) {
    console.log('❌ window.currentPlayers is undefined, match not started');
    return;
  }
  
  console.log('✅ window.currentPlayers exists:', window.currentPlayers.length, 'players');
  
  // Don't save if no match is active
  const hasTeamName = window.teamName || window.restoredTeamName;
  const hasOpponent = window.opponent || window.restoredOpponent;
  const hasPlayers = window.currentPlayers && window.currentPlayers.length > 0;
  
  console.log('Team check:');
  console.log('  window.teamName:', window.teamName);
  console.log('  window.opponent:', window.opponent);
  console.log('  window.restoredTeamName:', window.restoredTeamName);
  console.log('  window.restoredOpponent:', window.restoredOpponent);
  console.log('  hasTeamName:', hasTeamName);
  console.log('  hasOpponent:', hasOpponent);
  console.log('  hasPlayers:', hasPlayers);
  
  if (!hasTeamName && !hasOpponent && !hasPlayers) {
    console.log('❌ No team name, opponent, or players - exiting');
    return;
  }
  
  try {
    // Safely access variables from window
    const safeTeamName = window.teamName || window.restoredTeamName || '';
    const safeOpponent = window.opponent || window.restoredOpponent || '';
    const safeMatchSeconds = typeof window.matchSeconds !== 'undefined' ? window.matchSeconds : 0;
    const safeTimerRunning = typeof window.timerRunning !== 'undefined' ? window.timerRunning : false;
    const safeCurrentHalf = typeof window.currentHalf !== 'undefined' ? (window.currentHalf === 2 ? 'second' : 'first') : 'first';
    const safePlayerStats = window.playerStats || {};
    const safePlayerZone = window.playerZone || {};
    const safeStats = window.stats || {};
    const safeUndoStack = window.undoStack || [];
    
    console.log('📦 Preparing match state:');
    console.log('  Team:', safeTeamName);
    console.log('  Opponent:', safeOpponent);
    console.log('  Timer:', safeMatchSeconds, 'seconds');
    console.log('  Timer running:', safeTimerRunning);
    console.log('  Half:', safeCurrentHalf);
    console.log('  Score:', safeStats?.goals || 0, '-', safeStats?.goalsAgainst || 0);
    console.log('  Players:', window.currentPlayers.length);
    
    // Enrich players with their current stats and zone
    const playersWithStats = window.currentPlayers.map(player => ({
      ...player,
      stats: safePlayerStats[player.id] || {},
      zone: safePlayerZone[player.id] || 'field'
    }));
    
    const matchState = {
      coach_user_id: currentUser.id,
      team_name: safeTeamName,
      opponent: safeOpponent,
      timer_seconds: safeMatchSeconds,
      is_timer_running: safeTimerRunning,
      current_half: safeCurrentHalf,
      score_home: safeStats?.goals || 0,
      score_away: safeStats?.goalsAgainst || 0,
      players: playersWithStats,
      undo_stack: safeUndoStack.slice(-30),
      stats: safeStats,
      live_match_id: (typeof currentLiveMatchId !== 'undefined' ? currentLiveMatchId : null),
      is_broadcasting: (typeof isLiveBroadcasting !== 'undefined' ? isLiveBroadcasting : false)
    };
    
    console.log('🚀 Saving to Supabase...');
    
    // Upsert (insert or update)
    const { data, error } = await _supabase
      .from('current_match')
      .upsert(matchState, { 
        onConflict: 'coach_user_id',
        ignoreDuplicates: false 
      })
      .select()
      .single();
    
    if (error) {
      console.error('❌ Supabase error:', error);
      throw error;
    }
    
    console.log('✅ Saved successfully!', data);
    
    if (data) {
      currentMatchId = data.id;
    }
    
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
    
    // Also clear localStorage timer to prevent conflicts
    localStorage.removeItem('handballtrack_timer');
    
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
  console.log('   User ID:', currentUser?.id);
  console.log('   User email:', currentUser?.email);
  
  // Try to load existing match
  const hasActiveMatch = await loadCurrentMatch();
  
  console.log('🔍 hasActiveMatch result:', hasActiveMatch);
  
  if (hasActiveMatch) {
    console.log('✅ Active match found and restored!');
    
    // Match restored - hide setup screen, show tracker
    const setupScreen = document.getElementById('setupScreen');
    const appTopbar = document.getElementById('appTopbar');
    const appMain = document.getElementById('appMain');
    
    console.log('📱 Switching UI to tracker view...');
    console.log('   setupScreen element:', !!setupScreen);
    console.log('   appTopbar element:', !!appTopbar);
    console.log('   appMain element:', !!appMain);
    
    if (setupScreen) {
      setupScreen.classList.add('hidden');
      console.log('   ✅ Setup screen hidden');
    }
    if (appTopbar) {
      appTopbar.style.display = ''; // Use CSS default
      console.log('   ✅ Topbar shown');
    }
    if (appMain) {
      appMain.style.display = ''; // Use CSS default
      console.log('   ✅ Main area shown');
    }
    
    console.log('✅ UI switched to tracker view');
    
    // Verify data was restored
    console.log('🔍 Verifying restored data:');
    console.log('   window.currentPlayers:', window.currentPlayers?.length);
    console.log('   window.teamName:', window.teamName);
    console.log('   window.opponent:', window.opponent);
    console.log('   window.stats:', window.stats);
    
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
    
    // Don't start auto-save yet - wait for user to start a match
    // Auto-save will start when initMatch() is called
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
