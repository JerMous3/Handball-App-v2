// ============================================================
// CROSS-DEVICE SYNC MODULE - CLEAN VERSION
// Simple, reliable cross-device synchronization
// ============================================================

console.log('📱 Cross-device sync: Loading...');

let syncInterval = null;
let lastSyncTime = 0;

// ============================================================
// SAVE TO CLOUD
// ============================================================

async function saveMatchToCloud() {
  if (!window.currentUser) return;
  
  try {
    // Gather current match state
    const matchState = {
      coach_user_id: window.currentUser.id,
      team_name: document.getElementById('homeTeamName')?.textContent || '',
      opponent: document.getElementById('awayTeamName')?.textContent || '',
      timer_seconds: window.matchSeconds || 0,
      is_timer_running: window.timerRunning || false,
      current_half: window.currentHalf || 'first',
      score_home: window.stats?.goals || 0,
      score_away: window.stats?.goalsAgainst || 0,
      last_updated: new Date().toISOString()
    };
    
    // Skip if empty match
    if (!matchState.team_name && !matchState.opponent) {
      return;
    }
    
    // Check if row exists
    const { data: existing } = await _supabase
      .from('current_match')
      .select('id')
      .eq('coach_user_id', window.currentUser.id)
      .maybeSingle();
    
    if (existing) {
      // Update existing
      await _supabase
        .from('current_match')
        .update(matchState)
        .eq('coach_user_id', window.currentUser.id);
    } else {
      // Insert new
      await _supabase
        .from('current_match')
        .insert(matchState);
    }
    
    lastSyncTime = Date.now();
    
  } catch (error) {
    console.error('Sync error:', error);
  }
}

// ============================================================
// LOAD FROM CLOUD
// ============================================================

async function loadMatchFromCloud() {
  if (!window.currentUser) return false;
  
  try {
    const { data, error } = await _supabase
      .from('current_match')
      .select('*')
      .eq('coach_user_id', window.currentUser.id)
      .maybeSingle();
    
    if (error) throw error;
    if (!data) return false;
    
    // Check if empty match
    if (!data.team_name && !data.opponent) {
      return false;
    }
    
    // Pre-fill team names in setup screen (silent restore)
    if (window.restoreMatchState) {
      window.restoreMatchState(data);
    }
    
    return false; // Don't skip setup screen - let user start fresh
    
  } catch (error) {
    console.error('Load error:', error);
    return false;
  }
}

// ============================================================
// CLEAR CLOUD MATCH
// ============================================================

async function clearMatchFromCloud() {
  if (!window.currentUser) return;
  
  try {
    await _supabase
      .from('current_match')
      .delete()
      .eq('coach_user_id', window.currentUser.id);
  } catch (error) {
    console.error('Clear error:', error);
  }
}

// ============================================================
// AUTO-SAVE
// ============================================================

function startAutoSave() {
  stopAutoSave();
  
  syncInterval = setInterval(() => {
    saveMatchToCloud();
  }, 5000); // Every 5 seconds
  
  console.log('✅ Auto-save enabled (every 5s)');
}

function stopAutoSave() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}

// ============================================================
// REALTIME SYNC (Optional - can be added later)
// ============================================================

function startRealtimeSync() {
  if (!window.currentUser) return;
  
  const channel = _supabase
    .channel('match_sync')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'current_match',
      filter: `coach_user_id=eq.${window.currentUser.id}`
    }, (payload) => {
      // Only sync if update is from another device
      const timeSinceOurSave = Date.now() - lastSyncTime;
      if (timeSinceOurSave > 2000) {
        console.log('📱 Update from another device');
        if (window.restoreMatchState) {
          window.restoreMatchState(payload.new);
        }
      }
    })
    .subscribe();
}

// ============================================================
// EXPOSE TO WINDOW
// ============================================================

window.saveMatchToCloud = saveMatchToCloud;
window.loadMatchFromCloud = loadMatchFromCloud;
window.clearMatchFromCloud = clearMatchFromCloud;
window.startAutoSave = startAutoSave;
window.stopAutoSave = stopAutoSave;
window.startRealtimeSync = startRealtimeSync;

console.log('✅ Cross-device sync ready');
