import { supabase } from '../supabase';

export class RealtimeNotificationListener {
  /**
   * Initialize a realtime listener for user notifications.
   * @param {string} userId - The authenticated user's ID
   * @param {function} onNotification - Callback invoked when a new notification is inserted
   */
  constructor(userId, onNotification) {
    this.userId = userId;
    this.onNotification = onNotification;
    this.channel = null;
  }

  /**
   * Start listening for database insertions.
   */
  subscribe() {
    if (!this.userId) {
      console.warn('[RealtimeNotificationListener] Cannot subscribe: No User ID provided');
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
        }
      )
      .subscribe((status) => {
        console.log(`[RealtimeNotificationListener] Subscription status for user ${this.userId}:`, status);
      });
  }

  /**
   * Stop listening and destroy the channel subscription.
   */
  unsubscribe() {
    if (this.channel) {
      console.log(`[RealtimeNotificationListener] Unsubscribing channel`);
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
