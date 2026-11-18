# Tally

Tally is a mobile-first expense-sharing app built with React, TypeScript, Vite, Tailwind CSS and Lucide. GitHub Pages serves the app and its encrypted group snapshots in [public/app.json](public/app.json).

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
npm test
npm run build
npm run preview
```

## Publish on GitHub Pages

1. Push this project to the default branch of a public GitHub repository.
2. In **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. Run **Check and deploy to GitHub Pages** from the **Actions** tab, or push to the default branch. The workflow supplies the repository name and branch to the build. Vite uses relative URLs so the build works on a project subpath and at the root.
4. Open the deployment URL shown in Actions. Supporting browsers can install Tally. After an online visit, the service worker can serve the most recently cached encrypted directory offline.

If the **Check GitHub Pages configuration** step returns 404, open the repository's **Settings → Pages** as a repository admin and save **GitHub Actions** as the source. Then run the workflow again from the default branch.

[GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## View a group

Open the invite link shared by the organiser, or select **Open an invite** and paste the link or code. Enter the group password to see expenses, reimbursements and balances. **Lock** or a reload closes the unlocked view. **Calendar** shows monthly totals and daily expenses. Open an expense to see its notes and photos.

## Account groups and recovery

With Firebase configured, select **Sign in → Sign in with Google** to create an account or sign in with Google. To use an email and password, select **Create account** and verify your email. You can reopen your groups from **Account**. Group edits save to Firestore under the verified owner's account. Viewers can still open an invite and unlock the encrypted records with the shared group password.

Choose **Forgot password?** to send a reset link to your account email. Firebase project admins can also send a reset from the Authentication users page. To show **Account recovery** in Tally, add the Firestore document `accountAdmins/<Firebase Auth user UID>` with `enabled` set to boolean `true` as a Firebase project admin.

For deployment, enable **Email/Password** and **Google** in Firebase Authentication, add the deployed host under **Authorised domains**, and create a Firestore database in Native mode. From this checkout, run `firebase deploy --only firestore:rules,firestore:indexes --project <project-id>`. Set the four public Firebase web values from [.env.example](.env.example) as GitHub Actions repository variables and run the Pages workflow. For local development, use `.env.local` and ensure the local hostname is authorised in Firebase, or use the emulators.

To test the access rules, run `firebase emulators:start --project demo-tally --only auth,firestore` and then `npm run test:firebase`. Set `VITE_FIREBASE_EMULATORS=true` for a local dev server with the emulators.

## Work on and publish changes

From the home screen, select **Settings → Manage GitHub groups → Open workspace** to edit groups stored in the GitHub repository. Deployments without Firebase accounts show **Workspace** in the header. A group password opens an existing group. GitHub repository permissions control who can publish. **Log out** locks the group and closes the workspace.

1. Open an existing group or choose **New group** and set a unique password of at least 14 characters. Use **Share invite** to copy its link.
2. Add members and record expenses or reimbursements. Members can use a photo, emoji, or initials. **Cash** and **PayID** are available in both transaction forms. Add a custom method from the same dropdown to reuse it for the group.
3. Select **Save changes**. Tally checks the file SHA before preparing the update. Copy the encrypted text, open the GitHub editor, replace the contents of `public/app.json`, and review the diff before committing. For large ledgers, save the encrypted file and replace it using an authenticated Git client.
4. Return to Tally and select **Check save**. The live app receives the update after GitHub Pages deploys the commit.

If another organiser published while you were editing, load the latest version and reapply your changes. Review GitHub's diff before committing when several people edit. **Expenses** includes CSV export in the workspace. **Sports sessions** lets you schedule recurring court fees. Each expense accepts up to three resized JPEG, PNG or WebP images.

## Data and limitations

Every group uses one currency. Monetary values are integers in that currency’s minor units. Percentages use hundredths of a percent. Dates use ISO calendar dates and activity timestamps are UTC. Tally records a named event for each in-app edit, and Git stores commit history. Direct edits through GitHub should include a matching activity event when needed.

The ledger allocates fractional units by largest remainder with stable member IDs as tie-breakers. Each expense creates its own debts between members who participated or paid. Payments apply to the oldest outstanding charges for the same pair and direction. Overpayments caused by corrections remain visible as unapplied. Tally keeps separate balances for reciprocal debts.

Tally uses Web Crypto with PBKDF2-SHA-256 and AES-256-GCM. New encrypted snapshots keep group names and archive status inside ciphertext. Open and save an older group in the workspace to upgrade its snapshot. Previous Git revisions retain the original metadata and can still be unlocked with the password that protected them. Tally cannot recover a lost password.

Firebase handles account authentication and reset emails. A group password unlocks the group ciphertext and stays separate from account recovery. The app's member selector changes the balance perspective.
