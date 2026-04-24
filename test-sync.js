// ============================================================
// MINIMAL CROSS-DEVICE SYNC TEST
// Only syncs SCORE to prove it works
// ============================================================

console.log('🧪 TEST SYNC: Loading...');

let testSyncInterval = null;
let testSubscription = null;

// Save score every 3 seconds
function startTestSync() {
  if (!window.currentUser) {
    console.log('❌ No user - sync disabled');
    return;
  }
  
  console.log('✅ Starting test sync (score only, every 3s)');
  
  // Save every 3 seconds
  testSyncInterval = setInterval(async () => {
    if (!window.stats) return;
    
    const score = {
      coach_user_id: window.currentUser.id,
      team_name: 'Test',
      opponent: 'Test',
      score_home: window.stats.goals || 0,
      score_away: window.stats.goalsAgainst || 0,
      timer_seconds: 0,
      is_timer_running: false,
      current_half: 'first',
      last_updated: new Date().toISOString()
    };
    
    console.log('💾 Saving score:', score.score_home, '-', score.score_away);
    
    try {
      const { data: existing } = await _supabase
        .from('current_match')
        .select('id')
        .eq('coach_user_id', window.currentUser.id)
        .maybeSingle();
      
      if (existing) {
        await _supabase
          .from('current_match')
          .update(score)
          .eq('coach_user_id', window.currentUser.id);
      } else {
        await _supabase
          .from('current_match')
          .insert(score);
      }
      
      console.log('✅ Saved');
    } catch (err) {
      console.error('❌ Save error:', err);
    }
  }, 3000);
  
  // Listen for changes
  testSubscription = _supabase
    .channel('test_sync')
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'current_match',
      filter: `coach_user_id=eq.${window.currentUser.id}`
    }, (payload) => {
      console.log('📱 RECEIVED UPDATE FROM OTHER DEVICE!');
      console.log('   New score:', payload.new.score_home, '-', payload.new.score_away);
      
      // Update local score
      if (window.stats) {
        window.stats.goals = payload.new.score_home;
        window.stats.goalsAgainst = payload.new.score_away;
        
        // Update UI
        if (typeof window.updateScoreboard === 'function') {
          window.updateScoreboard();
          console.log('✅ Scoreboard updated!');
        }
      }
    })
    .subscribe((status) => {
      console.log('📡 Realtime status:', status);
      if (status === 'SUBSCRIBED') {
        console.log('✅✅ REALTIME SYNC ACTIVE - Changes will sync instantly!');
      }
    });
}

function stopTestSync() {
  if (testSyncInterval) {
    clearInterval(testSyncInterval);
    testSyncInterval = null;
  }
  if (testSubscription) {
    testSubscription.unsubscribe();
    testSubscription = null;
  }
  console.log('⏹️ Test sync stopped');
}

window.startTestSync = startTestSync;
window.stopTestSync = stopTestSync;

console.log('✅ TEST SYNC ready');
console.log('ℹ️ After starting a match, run: startTestSync()');
