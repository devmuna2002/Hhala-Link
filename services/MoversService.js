/*
 * MoversService.js
 * Service layer for interacting with Supabase RPCs related to Movers/Freight.
 * Provides helper functions to create bookings, place bids, accept bookings,
 * and update booking status. All functions return the raw Supabase response
 * for caller handling (error checking, UI updates, etc.).
 */

import { supabase } from '../supabase';

/**
 * Create a new mover booking request.
 * @param {string} requesterId - UUID of the tenant/client creating the request.
 * @param {string} moverId - UUID of the mover to which the request is sent.
 * @param {object} jobDetails - JSON object containing details such as
 *   pickup_address, drop_address, moving_date, estimated_price, etc.
 * @returns {Promise<object>} Supabase RPC response containing the new booking ID.
 */
export async function createMoverBooking(requesterId, moverId, jobDetails) {
  const { data, error } = await supabase.rpc('create_mover_booking', {
    requester_id: requesterId,
    mover_id: moverId,
    job_details: jobDetails,
  });
  if (error) {
    console.error('[MoversService] createMoverBooking error:', error.message);
  }
  return { data, error };
}

/**
 * Place a bid on an existing booking.
 * @param {string} bookingId - UUID of the mover_booking record.
 * @param {string} moverId - UUID of the mover placing the bid (must match booking.mover_id).
 * @param {number} amount - Bid amount in the platform currency.
 * @returns {Promise<object>} Supabase RPC response.
 */
export async function placeBid(bookingId, moverId, amount) {
  const { data, error } = await supabase.rpc('place_bid', {
    booking_id: bookingId,
    mover_id: moverId,
    amount: amount,
  });
  if (error) {
    console.error('[MoversService] placeBid error:', error.message);
  }
  return { data, error };
}

/**
 * Accept a booking (mover confirms the move).
 * @param {string} bookingId - UUID of the mover_booking.
 * @param {string} moverId - UUID of the mover accepting the booking.
 * @returns {Promise<object>} Supabase RPC response.
 */
export async function acceptBooking(bookingId, moverId) {
  const { data, error } = await supabase.rpc('accept_booking', {
    booking_id: bookingId,
    mover_id: moverId,
  });
  if (error) {
    console.error('[MoversService] acceptBooking error:', error.message);
  }
  return { data, error };
}

/**
 * Update the status of an existing booking.
 * @param {string} bookingId - UUID of the mover_booking.
 * @param {string} newStatus - New status string (e.g., 'in_progress', 'completed').
 * @param {object} [extraData] - Optional JSON payload with additional information.
 * @returns {Promise<object>} Supabase RPC response.
 */
export async function updateBookingStatus(bookingId, newStatus, extraData = {}) {
  const { data, error } = await supabase.rpc('update_booking_status', {
    booking_id: bookingId,
    new_status: newStatus,
    extra_data: extraData,
  });
  if (error) {
    console.error('[MoversService] updateBookingStatus error:', error.message);
  }
  return { data, error };
}

/**
 * Subscribe to real‑time updates for mover bookings.
 * This helper creates a Supabase channel that emits events whenever the
 * `mover_bookings` table changes (INSERT, UPDATE, DELETE). Consumers can
 * attach callbacks to react to status shifts and display them instantly.
 * @param {function} callback - Function invoked with the payload of each event.
 */
export function subscribeToBookingUpdates(callback) {
  const channel = supabase.channel('public:mover_bookings');
  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mover_bookings' }, (payload) => {
      callback(payload);
    })
    .subscribe();
  return channel;
}

export const MoversService = {
  createMoverBooking,
  placeBid,
  acceptBooking,
  updateBookingStatus,
  subscribeToBookingUpdates,
};

export default MoversService;
