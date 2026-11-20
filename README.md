# Tally 2.0

Tally is a mobile-first expense-sharing app built with React, TypeScript, Vite, Tailwind CSS and Lucide. GitHub Pages serves the frontend. Firebase Authentication manages accounts, and Firestore stores group metadata and ledgers protected by account access rules.

## Run and test locally

Use Node.js 22.12 or newer. The Firebase CLI also needs a supported Java runtime for the Firestore emulator.

```sh
npm ci
npm run dev
npm test
npm run build
```

To test with local Firebase, set `VITE_FIREBASE_EMULATORS=true` in `.env.local` and start the emulators before opening the dev server. Run the Firestore rule tests against the demo project.

```sh
firebase emulators:exec --project demo-tally --only auth,firestore "npm run test:firebase"
```

If Windows sandbox permissions prevent Vite from reading its config, add `-- --configLoader runner` to the `dev`, `test`, or `build` command.

## Deploy to GitHub Pages

1. In the existing Firebase project, enable **Email/Password** and **Google** authentication. Keep email enumeration protection enabled, set a minimum password length of eight characters, and add the Pages hostname to **Authorised domains**. Ensure Firestore is on the default Native-mode database.
2. Set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID` as GitHub Actions repository variables. For development against Firebase, put the same values in `.env.local`. These are Firebase web configuration values. The frontend requires no Firebase admin credentials or GitHub token.
3. Verify the repository owner’s GitHub identity and their verified Firebase account independently. A Firebase project administrator should create the document `platformAdmin/identity` with `firebaseUid` set to that account’s exact Firebase Authentication UID. Record the verified owner’s GitHub ID and repository in the same document as provenance. Client writes to this document are denied. The optional `accountAdmins/<uid>` recovery setting remains separate from platform administration.
4. Back up the project, run the emulator tests and complete the existing data checks below. After the Firebase project owner confirms the production rollout, deploy the Firestore rules and indexes to that project, then publish the Pages build. Refresh existing tabs before editing. After deployment, each owner can enable password-free access for their group.
5. In the GitHub repository’s **Settings → Pages**, select **GitHub Actions** as the source and run **Check and deploy to GitHub Pages**. Verify login, direct group-link access, a member invitation, and archive/restore with test accounts on the deployed site.

```sh
firebase deploy --only firestore:rules,firestore:indexes --project <project-id>
```

## Existing data and cutover

- Existing Firebase accounts, group IDs and records are reused. Existing encrypted ledgers keep their encryption when opened or edited. A verified owner of an active legacy cloud group enters its current password once to enable account access. Tally reseals the same ledger with a fresh random key and saves both changes in one Firestore transaction. The original password and its derived key are kept out of Firebase. Future opens rely on the verified owner or member account. Existing account-only groups continue to work.
- **Before deploying the rules**, have the Firebase project administrator identify existing cloud groups already marked archived inside their encrypted snapshot. That old flag is unavailable to Firestore rules. For each one, use a trusted Firestore write batch to set `cloudGroups/<group-id>.archivedAt` to a server timestamp and `archivedBy` to the verified platform admin’s UID, and remove the old `accounts/<owner-uid>/groups/<group-id>` index and any `guestConfig/<group-id>` document in the same batch. When available, copy the old index name to the archived head’s `legacyName` field. Leave the head revision and all encrypted parts intact. The app recognises that flag after decryption and prompts the owner to contact the admin. Opening a group leaves its archived state unchanged.
- The old public `app.json` is excluded from the Pages build. Keep a backup before rollout. In this checkout, the previous snapshot was moved byte-for-byte to the ignored `legacy/app.json` path. It can also be exported from the pre-upgrade Git revision. The intended owner can log in and use **Account > Import a legacy group** with the file and original group password. The importer retains expenses, payments, roster records, snapshots’ archived state and activity, and maps each legacy group ID to a stable Firebase group ID. If the file contains several groups, import each with its group code. Verify imported records before relying on the new dashboard.
- Older group URLs map to the same Firebase group ID as the importer. An authorised account can reopen the group from that URL after the owner has imported a legacy-only snapshot. Group IDs and legacy hashes including overview, calendar and activity remain accepted. New viewers need a member invitation or a separate guest link.
- Existing ledgers need no format migration for Tally 2.0. A receipt is an optional payment field. On the first receipt save, Firestore adds a persistent receipt-version marker to reject writes from older clients that could drop the image. The same image size and ledger limits apply to payment and expense photos. Group descriptions appear in My Groups after the first save of an account-only group. Password-protected group descriptions stay inside the encrypted ledger.
- Previously downloaded ciphertext and public Git revisions are outside Firebase’s access control. Deploying the new rules and Pages build protects the Firebase copy and removes the static feed, but cannot revoke already distributed copies.

## Roles, groups and settlements

- Verified owners manage active groups and record expenses and reimbursements. **Share > Tally users** finds opted-in profiles. **Share > Invite by email** works for anyone with a valid email, including new users. Copy the joining link or open your email app to deliver it. **Add by name** adds a roster entry without granting access. Select an existing roster member to link their account without moving any expenses. The original one-time roster links still work.
- Removing a member ends their account access and invalidates their invite links. Past expenses, payments and balances keep the historical roster entry. **Manage group → Archive group** hides the group from its owner and members. The verified platform admin can open or restore it from **Admin**. Restore returns access to the owner and remaining linked members.
- **Home** shows the linked member's balance, outstanding directed pairs and recent transactions. People without a linked ledger member can explicitly choose a balance to view. **Expenses** includes search, filters, a calendar and CSV export for owners. **People** keeps inactive members and their transaction history visible.
- **Settle up** records a reimbursement against an outstanding payer-to-recipient pair. Tally uses integer minor currency units and applies payments to the oldest charges for the same pair in the same direction. Reciprocal obligations remain independent. Partial payments, unapplied amounts and optional receipts are visible in the ledger. Revision checks protect against overlapping edits.
- Firestore evaluates ownership, membership and archive status for group metadata and ledger reads and writes. Tally validates financial records before saving them. Legacy backups and archives that predate account access still need their original password. After activation, Firestore releases the new AES-256 key only to authorised accounts with access to the encrypted ledger. An archived group using account access can only be opened by the verified platform admin. Removed members lose access to the current ledger and key through Firestore. Copies obtained before removal remain outside Firebase access controls.

## Guest links and invitation delivery

1. Deploy the Firestore rules and indexes using the command above, then publish the Pages build. The new rules cover guest projections, opt-in discovery and recipient-specific invitation inboxes. Existing account and group IDs are reused. These features use the existing environment variables and Auth providers. Follow the legacy archive inventory procedure above if the project contains encrypted archive flags that have never been registered in Firestore.
2. An owner can generate, replace or revoke a seven-day link from **Manage group > Guest sharing**. The link fragment and the separate guest code represent the same random viewing secret. Guests receive a separately encrypted, read-only snapshot of the visible ledger. It is refreshed with owner edits, and Firestore checks expiry, source revision, archive status and revocation on every read. Private group collections keep their existing account permissions. Archiving revokes guest sharing.
3. Account holders opt in under **Account > Profile discovery**. Opting in shows their display name, verified email and supported profile photo. Exact-email lookup avoids collection listing. Name search queries at most eight opt-in profiles from a three-character prefix. Owners can still invite by email when someone cannot be found in discovery.
4. Member invitations expire after seven days and appear in the verified recipient's in-app **Invitations**. Owners can see pending, accepted, expired and revoked states. **Open email app** and **Copy invitation** let the owner deliver the secure link manually. This deployment has no automatic email provider, API key or added infrastructure. Firebase reads and writes count towards the existing Firestore quota.
