// ============================================================
// CROSS-DEVICE SYNC MODULE - CLEAN VERSION
// Simple, reliable cross-device synchronization
// ============================================================

console.log('📱 Cross-device sync: Loading...');

let syncInterval = null;
let lastSyncTime = 0;
let deviceId = null;

// Generate unique device ID
function getDeviceId() {
  if (!deviceId) {
    deviceId = localStorage.getItem('handball_device_id');
    if (!deviceId) {
      deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('handball_device_id', deviceId);
    }
  }
  return deviceId;
}

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
      last_updated: new Date().toISOString(),
      // Save roster data so we can restore on another device
      roster_data: window.currentRoster ? JSON.stringify(window.currentRoster) : null
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
    
    // Ask user if they want to continue the match
    const matchDesc = `${data.team_name || 'Team'} vs ${data.opponent || 'Opponent'}`;
    const mins = Math.floor(data.timer_seconds / 60);
    const secs = data.timer_seconds % 60;
    const timeDesc = `${mins}:${secs.toString().padStart(2, '0')}`;
    
    const doContinue = confirm(
      `Continue your match from another device?\n\n` +
      `${matchDesc}\n` +
      `Time: ${timeDesc}\n` +
      `Score: ${data.score_home}-${data.score_away}\n\n` +
      `Click OK to continue, or Cancel to start a new match.`
    );
    
    if (!doContinue) {
      // User wants to start fresh
      await clearMatchFromCloud();
      return false;
    }
    
    // Restore the match with saved roster data
    if (data.roster_data) {
      try {
        const rosterData = JSON.parse(data.roster_data);
        
        // Call restoreMatchState which will launch the match
        if (window.restoreMatchState) {
          window.restoreMatchState(data, rosterData);
          return true;
        }
      } catch (err) {
        console.error('Failed to parse roster data:', err);
      }
    }
    
    // No roster data - just pre-fill team names
    if (window.restoreMatchState) {
      window.restoreMatchState(data);
    }
    
    return false;
    
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
  
  // Also start realtime sync
  startRealtimeSync();
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
  if (!window.currentUser) {
    console.log('⚠️ Cannot start realtime - no user');
    return;
  }
  
  console.log('📡 Starting realtime sync for user:', window.currentUser.id);
  
  const channel = _supabase
    .channel('match_sync')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'current_match',
      filter: `coach_user_id=eq.${window.currentUser.id}`
    }, (payload) => {
      // Ignore if this update came from our own save (within 2 seconds)
      const timeSinceOurSave = Date.now() - lastSyncTime;
      if (timeSinceOurSave < 2000) {
        console.log('⏭️ Ignoring - this was our own update (' + timeSinceOurSave + 'ms ago)');
        return;
      }
      
      console.log('📱 UPDATE FROM OTHER DEVICE!');
      console.log('   Score:', payload.new.score_home, '-', payload.new.score_away);
      console.log('   Timer:', payload.new.timer_seconds, 'seconds');
      
      // Update score
      if (window.stats) {
        window.stats.goals = payload.new.score_home;
        window.stats.goalsAgainst = payload.new.score_away;
      }
      
      // Update timer
      window.matchSeconds = payload.new.timer_seconds;
      window.timerRunning = payload.new.is_timer_running;
      window.currentHalf = payload.new.current_half;
      
      // Update UI
      if (typeof window.updateScoreboard === 'function') {
        window.updateScoreboard();
      }
      if (typeof window.updateTimerDisplay === 'function') {
        window.updateTimerDisplay();
      }
      
      console.log('✅ UI updated from other device');
    })
    .subscribe((status) => {
      console.log('📡 Realtime subscription status:', status);
      if (status === 'SUBSCRIBED') {
        console.log('✅ REALTIME SYNC ACTIVE - Changes will sync between devices!');
      } else if (status === 'CHANNEL_ERROR') {
        console.error('❌ Realtime subscription FAILED!');
      }
    });
  
  return channel;
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
