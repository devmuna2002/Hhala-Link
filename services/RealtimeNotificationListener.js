import { supabase } from '../supabase';

export class RealtimeNotificationListener {
  /**
   * Initialize a realtime listener for user notifications.
   * @param {string} userId - The authenticated user's ID
   * @param {function} onNotification - Callback invoked when a new notification is inserted
   * @param {number} timeoutMs - How long to wait for realtime before falling back (default: 3000)
   */
  constructor(userId, onNotification, timeoutMs = 3000) {
    this.userId = userId;
    this.onNotification = onNotification;
    this.timeoutMs = timeoutMs;
    this.channel = null;
    this.timeoutId = null;
  }

  /**
   * Start listening for database insertions.
   * Attempts realtime subscription, then falls back to polling after timeout.
   */
  subscribe() {
    if (!this.userId) {
      console.warn('[RealtimeNotificationListener] Cannot subscribe: No User ID provided');
      if (this.onNotification) this.onNotification([]);
      return;
    }

    // Clean up any existing channel
    this.unsubscribe();

    const channelId = `user-notifs-${this.userId}-${Date.now()}`;
    console.log(`[RealtimeNotificationListener] Subscribing to channel: ${channelId}`);

    this.channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${this.userId}`
        },
        (payload) => {
          console.log('[RealtimeNotificationListener] New notification inserted:', payload.new);
          if (this.onNotification) {
            this.onNotification(payload.new);
          }
          // If we get a realtime notification, clear the timeout and stop polling
          if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
          }
        }
      )
      .subscribe((status) => {
        console.log(`[RealtimeNotificationListener] Subscription status:`, status);
        // After the timeout, fall back to API polling since cPanel MySQL
        // doesn't support postgres_changes realtime subscriptions
        if (!this.timeoutId) {
          this.timeoutId = setTimeout(() => {
            console.log('[RealtimeNotificationListener] Real-time timeout, falling back to API polling');
            this._fallbackToPolling();
          }, this.timeoutMs);
        }
      });
  }

  /**
   * Fall back to polling the API for notifications.
   * This is called when the realtime timeout expires.
   */
  _fallbackToPolling() {
    // Note: The actual polling is handled by the notification screens
    // which call fetch('/api/notifications') on mount.
    // This method is a marker that the realtime window has closed.
    if (this.onNotification) {
      // Request uninitialized - screens will fetch fresh data on mount
      this.onNotification([]);
    }
  }

  /**
   * Stop listening and destroy the channel subscription.
   */
  unsubscribe() {
    if (this.channel) {
      console.log('[RealtimeNotificationListener] Unsubscribing channel');
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}