# Tally

Tally is a mobile-first expense-sharing app built with React, TypeScript, Vite, Tailwind CSS and Lucide. GitHub Pages serves the app and [public/app.json](public/app.json). The included household and tennis records are fictional examples.

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
4. Open the deployment URL shown in Actions. The site can be installed from a supporting browser. After an online visit, the service worker can display the most recently cached published ledger offline.

If the **Check GitHub Pages configuration** step returns 404, open the repository's **Settings → Pages** as a repository admin and save **GitHub Actions** as the source. Then run the workflow again from the default branch.

[GitHub Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

To start with a blank ledger, replace the example contents before your first deployment.

```json
{"version":1,"groups":[],"members":[],"expenses":[],"payments":[],"sessions":[],"activity":[]}
```

## Read and edit

Anyone can open the published app, select a group and choose a member perspective. Under **Settings**, repository collaborators with write access can connect using a fine-grained personal access token. Select only the deployment repository and grant **Contents → Read and write**. The token is held in memory until the tab reloads or closes, or the editor disconnects. GitHub applies its token rules and branch protections to every write. Collaborator and organisation token policies may require using the export workflow.

[Fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token) · [GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)

- Create or correct records in the editor, then choose **Review draft → Commit to GitHub**. The app checks the file SHA before writing and sends the expected SHA with the update. If the file changed, download your draft, load the latest repository data, and reapply the edits.
- For the token-free workflow, open the export editor, download `app.json`, and replace `public/app.json` using GitHub’s web editor. Review the diff against the current branch before committing or opening a pull request. Local drafts are in memory, so download a copy before closing the editor.
- After a successful commit, Tally refreshes repository data and checks the published revision. Readers see the old version until the Pages workflow finishes. Check the **Actions** tab if publication is delayed.
- Generate CSV from the current Expenses search and filters. JSON export contains the full ledger. Use **Sports sessions** to set a repeating court fee, then confirm the attendees and date for each occurrence.

## Data and limitations

Every group uses one currency. Monetary values are integers in that currency’s minor units. Percentages use hundredths of a percent. Dates use ISO calendar dates and activity timestamps are UTC. Tally records a named event for each in-app edit, and Git stores commit history. Direct edits through GitHub should include a matching activity event when needed.

The ledger allocates fractional units by largest remainder with stable member IDs as tie-breakers. Each expense creates its own debts between members who participated or paid. Payments apply to the oldest outstanding charges for the same pair and direction. Overpayments caused by corrections remain visible as unapplied. Tally keeps separate balances for reciprocal debts.

**Public repositories and their published JSON are publicly readable.** Anyone can download the records, and Git history retains previously committed values. GitHub Pages alone cannot provide Google/Gmail signup, password-reset emails or secure private member accounts. The app’s member selector changes the balance perspective.
