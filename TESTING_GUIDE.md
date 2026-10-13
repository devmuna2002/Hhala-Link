# Hlala Link — Tester Guide (v1.2.0)

Hey testers! Thank you for helping test Hlala Link. Follow the steps for **your assigned role** below, then report anything broken (see *How to report a bug* at the bottom).

**Install:** use the test build link sent in the group (Android APK). You need internet for first launch.

---

## 0. Create your account (everyone)

1. Open the app → **Sign up**.
2. Register with **your email from the list** (use your real email so we can find your account).
3. Pick **your assigned role** (Agent / Tenant / Mover) — see the role split below.
4. Log in. If anything fails here, stop and report it.

### Suggested role split (flexible — swap if you agree in the group)

| Role | Testers |
|---|---|
| Agent / Landlord (4) | ndlovugodswills@gmail.com, pmasina309@gmail.com, munasheantonio1@gmail.com, laquishadube@gmail.com |
| Tenant (4) | marunyalovejoy1@gmail.com, muresherwadarlington208@gmail.com, norestgwazegwaze@gmail.com, shepherdmlalazi2k19@gmail.com |
| Mover (4) | pjubika@gmail.com, mupikenipatience@gmail.com, elvisnhanho2nd@gmail.com, sufficientnhodo@gmail.com |

---

## 1. AGENT / LANDLORD tests

- [ ] **A1.** Complete your profile: photo, bio, business name, city. Check it on the Profile tab.
- [ ] **A2.** Post a listing (＋ button): title, price, address, city, **photos AND a video** (max 30s). Confirm it says it goes live **after approval**.
- [ ] **A3.** Open **My Listings** — your listing is there with a status badge.
- [ ] **A4.** **Edit** the listing: change the price, **remove one photo**, add one photo. Save. Confirm the removed photo is gone when you reopen it.
- [ ] **A5.** Ask a tenant tester to **apply** for your listing. Open the application and **approve** it, then **reject** another one.
- [ ] **A6.** Open a **chat** with the tenant from the listing/messages and send messages back and forth.
- [ ] **A7.** **Share** a listing (share button) — link should open the listing.
- [ ] **A8.** Save someone else's listing (heart icon), find it under Saved.

## 2. TENANT tests

- [ ] **T1.** Browse the home feed: scroll, play a **video** (it should play only when visible, pause when scrolled past), use **search** and category/city filters.
- [ ] **T2.** Open a listing: photos, video with sound toggle, description, agent info.
- [ ] **T3.** **Save** a listing, check it under Saved. **Unsave** it — confirm it disappears.
- [ ] **T4.** **Apply** for a rental from an agent tester's listing. Confirm the agent sees it.
- [ ] **T5.** **Chat** with the agent. Confirm message ticks change when read.
- [ ] **T6.** Open **Movers**, search your city, open a mover profile (photos, vehicle, reviews).
- [ ] **T7.** **Book a mover**, then **review** them after the job is completed.
- [ ] **T8.** Open **Activity** (notifications): filter pills (All/Unread/Messages/Bookings/Listings) work, tapping one opens the right screen.

## 3. MOVER tests

- [ ] **M1.** Complete your mover profile: business name, city, vehicle type/model/registration, **4+ vehicle photos**.
- [ ] **M2.** Open **Moving Hub** — profile, vehicle, and jobs show correctly.
- [ ] **M3.** Ask a tenant tester to **book** you. Accept the request from **My Jobs** (or the notification action button).
- [ ] **M4.** Move the booking through statuses: **Accept → Start Move → Mark Complete**.
- [ ] **M5.** **Decline** one request — confirm the client is told.
- [ ] **M6.** **Chat** with the client from the booking.
- [ ] **M7.** Ask the client to leave you a **review**; confirm it shows on your profile.

## 4. Everyone (all roles)

- [ ] **G1.** **Push notifications**: log in on a real device, accept the notification permission. Ask another tester to message you with the app **closed** — the push must arrive, and tapping it must open the chat.
- [ ] **G2.** **Edit Profile**: change your name, photo (try **Camera** and **Gallery**), bio. Confirm the photo uploads with a % indicator.
- [ ] **G3.** **Offline**: turn on airplane mode, reopen the app — your last feed/listings should still show. Turn internet back on and pull to refresh.
- [ ] **G4.** **Log out and back in** — everything still correct, floating bar shows the right center button (＋ for agents, movers icon for tenants/movers).

---

## How to report a bug

Send one message per bug with:

1. **Your email** (account used)
2. **What you did** (steps, e.g. T4 → applied → agent approved)
3. **What happened vs what you expected**
4. **Screenshot or screen recording** if possible

Example: *mover test M3 — pjubika@gmail.com — tapped Accept on booking, spinner stuck, booking still pending. Expected: accepted + client notified. [screenshot]*

Thank you — every report makes the launch smoother! 🚀
