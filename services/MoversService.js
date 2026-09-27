/*
 * MoversService.js
 * Service layer for interacting with Supabase RPCs related to Movers/Freight.
 * Provides helper functions to create bookings, place bids, accept bookings,
 * and update booking status. All functions return the raw Supabase response
 * for caller handling (error checking, UI updates, etc.).
 */

import { supabase } from '../supabase';

/**
 * Resolve any mover identifier to a real `movers.id` (READ-ONLY).
 *
 * The app's mover lists are built from `profiles` (role = 'mover'), so
 * callers pass a PROFILE id — but `mover_bookings.mover_id` has a foreign
 * key to `movers(id)`. Passing the profile id straight through is what
 * produced: violates foreign key constraint "mover_bookings_mover_id_fkey".
 *
 * NOTE: this helper deliberately never INSERTs into `movers`. The booker is
 * a *client*, and the `movers` RLS policy only lets a mover manage their own
 * row — a client-side insert always fails with "new row violates
 * row-level security policy for table movers". Provisioning a missing row
 * must happen inside the SECURITY DEFINER `create_mover_booking` RPC
 * (see database/fix_mover_booking_fk.sql), which bypasses RLS safely.
 *
 * @param {string} moverId - Either a `movers.id` or a `profiles.id`.
 * @returns {Promise<string>} Resolved `movers.id`.
 */
export async function resolveMoversRowId(moverId) {
  if (!moverId) throw new Error('Missing mover id.');
  // 1. Direct hit: already a movers.id
  const { data: direct } = await supabase
    .from('movers')
    .select('id')
    .eq('id', moverId)
    .maybeSingle();
  if (direct?.id) return direct.id;

  // 2. Linked row via profile_id / owner_id
  const { data: linked } = await supabase
    .from('movers')
    .select('id')
    .or(`profile_id.eq.${moverId},owner_id.eq.${moverId}`)
    .maybeSingle();
  if (linked?.id) return linked.id;

  // 3. No movers row yet — do NOT insert here (RLS forbids clients from
  // writing movers rows). Pass the profile id through: the hardened
  // server-side RPC auto-provisions the row. If the RPC is still the old
  // version, it will raise the FK error, which we translate below.
  return moverId;
}

/**
 * Create a new mover booking request.
 * @param {string} requesterId - UUID of the tenant/client creating the request.
 * @param {string} moverId - UUID of the mover (`movers.id` OR `profiles.id` —
 *   profile ids are auto-resolved to the linked `movers` row).
 * @param {object} jobDetails - JSON object containing details such as
 *   pickup_address, drop_address, moving_date, estimated_price, etc.
 * @returns {Promise<object>} Supabase RPC response containing the new booking ID.
 */
export async function createMoverBooking(requesterId, moverId, jobDetails) {
  try {
    const resolvedMoverId = await resolveMoversRowId(moverId);
    const { data, error } = await supabase.rpc('create_mover_booking', {
      requester_id: requesterId,
      mover_id: resolvedMoverId,
      job_details: jobDetails,
    });
    if (error) {
      console.error('[MoversService] createMoverBooking error:', error.message);
      // Old RPC without auto-provisioning: profile id hits the FK.
      // The fix is database/fix_mover_booking_fk.sql (hardened RPC).
      if (/mover_bookings_mover_id_fkey|foreign key/i.test(error.message || '')) {
        return {
          data: null,
          error: {
            ...error,
            message:
              'This mover has no booking profile yet. Please run database/fix_mover_booking_fk.sql in Supabase, then try again.',
          },
        };
      }
    }
    return { data, error };
  } catch (e) {
    const error = { message: e?.message || 'Could not create booking. Please try again.' };
    console.error('[MoversService] createMoverBooking error:', error.message);
    return { data: null, error };
  }
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
  const channel = supabase.channel(`public:mover_bookings_${Date.now()}`);
  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'mover_bookings' }, (payload) => {
      callback(payload);
    })
    .subscribe();
  return channel;
}

export const MoversService = {
  resolveMoversRowId,
  createMoverBooking,
  placeBid,
  acceptBooking,
  updateBookingStatus,
  subscribeToBookingUpdates,
};

export default MoversService;
