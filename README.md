# Tally

Tally is a mobile-first expense-sharing app built with React, TypeScript, Vite, Tailwind CSS and Lucide. GitHub Pages serves the frontend. Firebase Authentication manages accounts, and Firestore stores protected group metadata and encrypted ledgers.

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
4. Complete the existing data checks below. Deploy the Firestore rules and indexes to the existing project, then deploy the frontend as part of the same rollout. Old frontend versions will lose anonymous group access as soon as the rules change.
5. In the GitHub repository’s **Settings → Pages**, select **GitHub Actions** as the source and run **Check and deploy to GitHub Pages**. Verify login, direct group-link access, a member invitation, and archive/restore with test accounts on the deployed site.

```sh
firebase deploy --only firestore:rules,firestore:indexes --project <project-id>
```

## Existing data and cutover

- Existing Firebase accounts, group IDs, ledgers and passwords are reused. Old account groups are discovered through their existing owner index. An owner’s first unlock updates the group summary to populate member count, personal balance and activity without replacing its records.
- **Before deploying the rules**, have the Firebase project administrator identify existing cloud groups already marked archived inside their encrypted snapshot. That old flag is unavailable to Firestore rules. For each one, use a trusted Firestore write batch to set `cloudGroups/<group-id>.archivedAt` to a server timestamp and `archivedBy` to the verified platform admin’s UID, and remove the old `accounts/<owner-uid>/groups/<group-id>` index document in the same batch. When available, copy the old index name to the archived head’s `legacyName` field. Leave the head revision and all encrypted parts intact. Existing owner unlocks also recognise and archive a legacy group whose encrypted flag is still set.
- The old public `app.json` is excluded from the Pages build. Keep a backup before rollout. In this checkout, the previous snapshot was moved byte-for-byte to the ignored `legacy/app.json` path. It can also be exported from the pre-upgrade Git revision. The intended owner can log in and use **Settings → Import a legacy group** with the file and original group password. The importer retains expenses, payments, roster records, snapshots’ archived state and activity, and maps each legacy group ID to a stable Firebase group ID. If the file contains several groups, import each with its group code. Verify imported records before relying on the new dashboard.
- Older links contained a group ID and did not store account membership. A verified account that already owns or has joined the group can keep using the ID. Other viewers need a new member invitation. Owners should issue a new invite for each existing roster member who needs access.
- Previously downloaded ciphertext and public Git revisions are outside Firebase’s access control. Deploying the new rules and Pages build protects the Firebase copy and removes the static feed, but cannot revoke already distributed copies.

## Roles, groups and settlements

- Verified owners create and manage active groups, issue one-time invitations for existing roster members, and record expenses and payments. Joined accounts can read their active group, including activity. A recipient accepts the invitation while signed in, then unlocks with the group password. The invitation links their Firebase UID to one roster member.
- **Manage group → Archive group** hides the group from its owner and members. Firestore denies their direct reads of the head, encrypted parts, membership and invitations. Archived groups can be opened or restored from **Admin** by the verified account in the trusted mapping. Opening an archived ledger still requires the group password. Restore returns access to the original owner and members. The app has no group deletion operation.
- **Group Home** shows expense contributions and allocated shares alongside the net balance after reimbursements. **Settle Up** follows an outstanding payer-to-recipient pair. Tally applies a payment to the oldest charges for that pair in the same direction, preserves all original expenses, and supports partial payments. The save checks the ledger revision so overlapping edits cannot silently overwrite one another.
- Firestore evaluates ownership, membership and archive status independently of the UI. Group summary metadata is kept behind those rules. Ledger contents stay encrypted with Web Crypto using PBKDF2-SHA-256 and AES-256-GCM, so Firestore rules authorise snapshot writes and Tally validates the financial records before encrypting them. Account password recovery and the group password are separate.
