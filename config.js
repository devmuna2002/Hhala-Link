/* ================================================================
   HLALA LINK — Standalone Database Client Configuration
   ================================================================ */

window.HLALA_CONFIG = (function() {
    // Purge any stale Supabase Cloud session tokens so the browser does not call blocked cloud URL
    if (typeof localStorage !== 'undefined') {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (key && (key.includes('ntzjjfbmpxgmjuorzwmv') || key.startsWith('sb-ntzjjfbmpxgmjuorzwmv'))) {
                localStorage.removeItem(key);
            }
        }
    }

    // Allows overriding API URL via localStorage for multi-environment testing
    const customUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('hlala_api_url') : null;
    const customKey = typeof localStorage !== 'undefined' ? localStorage.getItem('hlala_anon_key') : null;

    return {
        // Standalone Database Gateway URL (Defaults to local standalone server port 8000)
        apiUrl: customUrl || window.HLALA_API_URL || 'http://localhost:8000',
        
        // Standalone Anon Key (JWT token generated with standalone JWT_SECRET)
        anonKey: customKey || window.HLALA_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImhsYWxhLXN0YW5kYWxvbmUiLCJpYXQiOjE3OTA4OTU1MDAsImV4cCI6MjEwNjI1NTUwMH0.6o4swyqP9xKgQcZGU_W1SWMY0vL2ucTOC8P_1O7bfZM',
        
        isStandalone: true,
        version: '2026.2'
    };
})();
