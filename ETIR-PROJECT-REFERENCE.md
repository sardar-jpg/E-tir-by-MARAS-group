# Etir by MARAS — Project Reference

**Read this first in any new conversation about this app.** Everything needed to pick up work immediately is below.

---

## 1. Quick Reference

| What | Where |
|---|---|
| GitHub repo | https://github.com/sardar-jpg/E-tir-by-MARAS-group |
| Local project (Mac) | `~/Desktop/Etir/E-tir-by-MARAS-group` |
| Live web app | https://e-tir-by-maras-v2-282009674985.europe-west1.run.app |
| Firebase project | `etir-by-maras-group` |
| Firebase Console | https://console.firebase.google.com/project/etir-by-maras-group |
| Google Cloud project | `etir-by-maras-group` (project number `282009674985`) |
| Cloud Run service | `e-tir-by-maras-v2`, region `europe-west1` |
| GCP Console | https://console.cloud.google.com/run?project=etir-by-maras-group |
| App Store Connect | https://appstoreconnect.apple.com — app "Etir" |
| Apple Developer | https://developer.apple.com/account — Team ID `7S734U3SAW` |
| Bundle ID | `com.maras.etir` |
| Firestore database | NOT `(default)` — it's `ai-studio-43f003da-29bb-4b79-b7a4-8fcf5095f532`, region europe-west1 |

**Demo accounts (for App Review or your own testing):**
- Admin: `sardar@maras.iq` — password in your password manager
- Driver: `applereviewer` — already approved, has a sample shipment assigned

---

## 2. What This App Is

A logistics/freight management platform for MARAS Group (Iraq-based freight company), tracking TIR shipments across Turkey, Iraq, and the Gulf. Three user roles, each with a completely separate experience:
- **Admin** — dashboard, shipment registry, driver/client/vendor management, GPS tracking map, cost statements
- **Driver** — mobile-style native app view: job list, chat, GPS check-in, document uploads
- **Client** — customer-facing shipment tracking dashboard

## 3. Architecture

- **Frontend**: React + TypeScript, single-page app (`src/App.tsx` routes to `AdminPanel.tsx`, `DriverApplication.tsx`, or `ClientDashboard.tsx` based on login role)
- **Backend**: Express/Node.js (`server.ts`), one file, all API routes
- **Database**: Firebase Firestore (NOT the default database — see table above)
- **Auth**: Custom — the server signs its own session tokens (not raw Firebase Auth sessions) after verifying credentials against Firestore. The server itself authenticates to Firestore as a dedicated Firebase Auth user (`server-internal-3@etir-by-maras-group.firebaseapp.com`), since Firestore security rules only allow that one account to read/write.
- **Deployment**: Cloud Run, auto-deployed via Cloud Build trigger on every push to `main` on GitHub. No manual deploy step — `git push` is the deploy.
- **Native app**: Capacitor wraps the same web app as an iOS app. `capacitor.config.ts`'s `server.url` points the native WebView directly at the live Cloud Run URL — the native app is NOT a separate bundle of the web code, it loads the same live website. This means most fixes (anything in `src/` or `server.ts`) go live immediately on `git push`, with **no new App Store build needed** — only native-level changes (new Capacitor plugins, Xcode capabilities, entitlements) require a fresh archive + upload.
- **Push notifications**: Firebase Cloud Messaging, with a real APNs key uploaded to Firebase. Server uses `firebase-admin` (Application Default Credentials — no key file, works automatically on Cloud Run). Client uses `@capacitor/push-notifications`.

## 4. Common Operations

### Deploy a code change (web/server — covers 90% of changes)
```bash
cd ~/Desktop/Etir/E-tir-by-MARAS-group
# make your edit
npx tsc --noEmit          # verify it compiles first
git add <files>
git commit -m "..."
git push                  # this alone triggers deployment
```
Check deploy status:
```bash
gcloud builds list --region=global --filter="substitutions.TRIGGER_NAME:e-tir-by-maras-v2" --limit=1 --format="table(id,status,createTime,substitutions.COMMIT_SHA)"
```
Wait for `STATUS = SUCCESS` (usually 2-4 minutes) before testing.

### Ship a native-level change (new build required)
Only needed for: new Capacitor plugins, new Xcode capabilities/entitlements, icon changes, version bumps.
```bash
cd ~/Desktop/Etir/E-tir-by-MARAS-group/ios/App
# bump MARKETING_VERSION and CURRENT_PROJECT_VERSION in App.xcodeproj/project.pbxproj first
xcodebuild archive -project App.xcodeproj -scheme App -configuration Release -archivePath ~/Desktop/Etir-X.X.X.xcarchive -allowProvisioningUpdates
open ~/Desktop/Etir-X.X.X.xcarchive
```
Then in Xcode Organizer: **Distribute App → App Store Connect → Upload**. After it finishes processing in TestFlight, go to App Store Connect → Distribution → the version page → select the new build → complete export compliance (always: "Standard encryption..." / No for France) → Save → Add for Review (or Resubmit).

## 5. Important Gotchas (learned the hard way)

- **Always verify file downloads by content, not just by name.** Browsers sometimes silently serve a stale cached file under the same name, or save as `name (1).ext`. After any file is sent to you, check it contains the expected new content before copying it into the project — don't assume the download worked.
- **Line-number-based text edits are fragile** for multi-line insertions/deletions — line numbers shift after every edit, and off-by-one mistakes create orphaned syntax that looks fine in a quick glance but breaks compilation. Prefer an exact, whole-string match-and-replace for anything more than a one-line change.
- **Always verify the code compiles after every edit**, before committing. It's the fastest, most reliable way to catch a broken edit immediately.
- **A rejected App Store version becomes editable in place** — you don't need to create a new version to fix it, just edit it directly and resubmit. But if a build is "Waiting for Review," it's locked; you may need to **expire the attached TestFlight build** to unstick it (Apple sometimes auto-releases the lock once the underlying build is invalid).
- **TestFlight shows the highest version number by default**, even across completely unrelated old builds. If an old, abandoned attempt is still sitting in TestFlight with a higher version number, it'll shadow your real app. Expire it.
- **Google Sign-In has two separate gates beyond your own code**: Firebase's "Authorized domains" list (Authentication → Settings) and Google's own OAuth consent screen "Publishing status" (Testing vs In production, with a max 100 manually-added test users while in Testing). Both can silently block sign-in with errors that look like app bugs but aren't.
- **The native app loads from the live URL** — it is not a frozen snapshot. Any web/server fix shipped is immediately live in the native app too, with no new build needed. Don't confuse "needs a new TestFlight build" with "needs a new commit."

## 6. Where Things Stand (as of this writing)

- App Store submission: version 1.0.3, build 6, submitted, addressing two rounds of rejections (name/icon/Google-sign-in-bug/demo-credentials/account-deletion/business-model, then Google-login-error/no-demo-driver-content/email-verification-not-received)
- A full driver approval workflow now exists (was previously completely absent — anyone could self-register and get instant access)
- Real push notifications are built end-to-end (admin, driver, client)
- A significant security exposure (a public API redirect mechanism plus exposed real client data, both reachable with zero authentication) was found and fixed earlier in this project's life
- Two old, unrelated local Xcode projects were removed from this Mac's Desktop (abandoned early prototypes, unrelated to the real app)

For the full, detailed history of everything fixed, `git log --oneline` in the project tells the real story — commit messages in this repo are written to explain *why*, not just *what*, specifically so this kind of future-reference lookup works.
