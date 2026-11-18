# Tally

Tally is a mobile-first expense-sharing app built with React, TypeScript, Vite, Tailwind CSS and Lucide. GitHub Pages serves the app and the encrypted group directory in [public/app.json](public/app.json). The directory starts empty.

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

The welcome screen shows no ledger records. Select **View groups**, choose a group, and enter the password shared by its organiser. The password unlocks that group's records in this tab. **All groups**, **Lock group**, or a reload closes the unlocked view. Use **Calendar** for monthly totals and a day-by-day expense list. Photos and notes are available in each expense's details.

## Set up and publish as an admin

Open **Admin** in the header. Repository collaborators with write access can connect using a fine-grained personal access token. Select only the deployment repository and grant **Contents → Read and write**. The token is held in memory until the tab reloads or closes, or the editor disconnects. GitHub applies its token rules and branch protections to every write. Collaborator and organisation token policies may require using the export workflow.

[Fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token) · [GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)

- Select **New group** and choose a unique password of at least 14 characters. Save it somewhere safe and share it with members. Use the group's editor to add members, record expenses, and change the password when needed.
- Choose **Review draft → Commit to GitHub** when ready. Tally checks the repository file SHA before writing. If it changed, download your encrypted draft, load the latest repository data, and reapply your edits.
- For the token-free workflow, choose **Export draft**, edit your groups, and download `app.json`. Replace `public/app.json` through GitHub and review the diff before committing or opening a pull request. Drafts are held in memory. Download a copy before closing the editor.
- Tally checks the published revision after a commit. Viewers see the previous version until the Pages workflow finishes. Check the **Actions** tab if publication is delayed.
- Generate CSV from the unlocked group's Expenses view. The admin JSON export contains the encrypted directory. Each expense can have three photos. Tally resizes JPEG, PNG and WebP uploads before encrypting them with the notes and other records.
- Use **Sports sessions** to set a repeating court fee, then confirm the attendees and date for each occurrence.

## Data and limitations

Every group uses one currency. Monetary values are integers in that currency’s minor units. Percentages use hundredths of a percent. Dates use ISO calendar dates and activity timestamps are UTC. Tally records a named event for each in-app edit, and Git stores commit history. Direct edits through GitHub should include a matching activity event when needed.

The ledger allocates fractional units by largest remainder with stable member IDs as tie-breakers. Each expense creates its own debts between members who participated or paid. Payments apply to the oldest outstanding charges for the same pair and direction. Overpayments caused by corrections remain visible as unapplied. Tally keeps separate balances for reciprocal debts.

The public JSON contains group names, archive status and encrypted group records. Tally uses Web Crypto with PBKDF2-SHA-256 and AES-256-GCM. Unlocking happens in the browser, so anyone with a group's password can read its records. Tally cannot recover a lost password. A password change protects future snapshots. Previous Git revisions and copies can still be unlocked with the password that protected them. The original demo records remain in earlier commits.

GitHub Pages alone cannot provide Google/Gmail signup, password-reset emails or individual private member accounts. The app's member selector changes the balance perspective.
