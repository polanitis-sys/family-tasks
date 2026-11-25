# Family Tasks — separately hosted botanical edition

This version serves the family app from a normal website. Children sign in with their family name and access code. Their browser does not visit Google Sheets, Apps Script, Google sign-in, or a Google iframe. The hosted server connects privately to your existing Google Sheet through a signed Apps Script endpoint.

The botanical design, twelve avatars, fireworks, required voting, scheduling, availability, task history, and all 58 initial task names are retained.

**This is a deployable package, not a live website yet. Your parent-owned Google account and hosting account must be connected using the steps below. No existing Sheet has been changed by this download.**

## What you need

- The Google Sheet and bound Apps Script project you already created.
- A parent-owned GitHub account to hold the app files in a private repository.
- A parent-owned Render account (the illustrated steps in START_HERE.html use Render). Other Node.js or Docker hosting also works.

Only the parent needs these accounts. Family members use the family app's existing names and access codes.

## 1. Update the existing Google backend without resetting your family

1. Open your existing Google Sheet, then **Extensions → Apps Script**.
2. Replace the contents of **Code.gs** with **google-apps-script/Code.gs** from this package. The START_HERE.html guide has a copy button.
3. Save. **Do not run setupHousehold again.** Keep your existing Sheet, tabs, votes, members, task history and family access codes. The existing Index.html file in Apps Script can remain in place; the new hosted site uses public/index.html instead.
4. In the function dropdown at the top of the Apps Script code editor, choose **showHostingConnection**, then **Run**. Return to the Sheet to read the dialog. Alternatively, reload the Sheet and use **Family Tasks → Show hosting connection secret**.
5. Copy the **hosting connection secret** somewhere private for the next step. This is a new server credential, separate from all family sign-in codes. Running showHostingConnection again displays the same secret; it does not reset family credentials.
6. In Apps Script select **Deploy → New deployment → Web app**. Name it **Family Tasks hosted connection**. Set **Execute as: Me** and **Who has access: Anyone** (anonymous access, not “Anyone with a Google account”). Only your hosted server will use this endpoint. If your work account does not offer that option, its administrator may restrict Apps Script deployment; use an eligible parent-owned account/project instead.
7. Deploy and copy this **new Web app URL ending in /exec**. You will put it in APPS_SCRIPT_URL on the hosting service.

Creating a **new deployment** leaves your previous Google-hosted app deployment working while you test the new site. Keep that old deployment until you are satisfied with the migration. Do not give the new Google connection URL to the children; they will use the separate website address from Render.

No spreadsheet migration is needed. Avatar settings, credential hashes, votes, availability and assignments retain their original formats. Existing automatic Monday planning triggers keep working.

## 2. Upload the website to a private GitHub repository

1. Sign in to your GitHub account and create a **new private repository**, such as **family-tasks**.
2. Extract this ZIP on your computer.
3. Open the extracted **Family_Tasks_Hosted** folder. Upload the **contents of that folder** into the repository using GitHub's **Add file → Upload files**. Keep the public, lib, google-apps-script, tools and test folders intact.
4. Confirm that **package.json**, **server.mjs** and **render.yaml** appear at the repository's top level. Commit the upload.

Do not add your hosting secret or family access codes to source files. This package has no live credentials in it. The example .env.example contains placeholders only; do not upload a filled-in .env file.

## 3. Create a Render Web Service

1. Open your Render dashboard and choose **New → Web Service**.
2. Connect your GitHub account and select the private family-tasks repository. If asked, grant access only to that repository.
3. Set the service as follows:

| Setting | Value |
| --- | --- |
| Runtime / Language | Node |
| Root directory | Leave blank if package.json is at the repository root |
| Build command | npm run check |
| Start command | npm start |
| Health check path | /healthz |
| Node version | 24 |

4. Choose the hosting plan you want. Render offers a Free web service option; it sleeps after 15 minutes of inactivity and may take about a minute to wake. The household data remains in your Google Sheet when the web server sleeps or restarts. Review the plan shown in your account before creating the service.
5. Under **Environment**, add these variables **before deployment**:

| Variable | Value |
| --- | --- |
| NODE_ENV | production |
| NODE_VERSION | 24 |
| APPS_SCRIPT_URL | The new Google connection URL ending /exec from step 1 |
| HOSTING_SECRET | The private 64-character hosting connection secret shown in your Sheet |

You do not need to set PORT or PUBLIC_ORIGIN on Render. Render supplies PORT and RENDER_EXTERNAL_URL, which the app uses automatically. Do not paste your family sign-in code into HOSTING_SECRET.

6. Create / deploy the Web Service. Once it is ready, open its **https://…onrender.com** website address. That is the address to share with your family.

The included render.yaml provides the same settings for people using Render Blueprints. A **Web Service is required**; a Static Site alone cannot hold the private Google connection.

## 4. Test before sharing with the children

1. Open the new **onrender.com** website. Sign in with your **existing** family administrator name and access code. You should see your existing tasks, votes, family members and history.
2. Try updating your avatar or weekly availability and check that the change is reflected in the original Sheet. Do not use “recover administrator access” unless you actually want to replace that access code.
3. Open the new website on your child's supervised device. If Family Link asks for website approval, approve **the new hosted site** as the parent. Keep normal supervision in place.
4. Sign in using the child's existing family name and access code. No Google sign-in or permission request should appear; all Google requests occur on the server.
5. If the child still sees the Google age message, check the address bar: use the new hosted website, not your Google Sheet, Apps Script editor, or a /exec URL. A device/site approval restriction is separate from Google's service age restriction.

Only the actual child's device can confirm that its browser and parental settings allow the new site. The app does not change their age, Google account, Family Link settings, or device supervision.

## Local testing (optional)

Use Node.js 24. Copy .env.example to .env, fill in APPS_SCRIPT_URL and HOSTING_SECRET, and leave NODE_ENV=development and PUBLIC_ORIGIN=http://localhost:3000 for local use.

```sh
npm run check
npm test
npm run check:connection
npm start
```

Open http://localhost:3000. The check:connection command contacts the signed Google endpoint without reading family data or changing the Sheet. There are no npm runtime dependencies to install.

## Other hosting and Docker

Any host that runs a Node.js 24 web process can use npm start. Set NODE_ENV=production, APPS_SCRIPT_URL and HOSTING_SECRET. Also set **PUBLIC_ORIGIN** to the exact HTTPS origin of your website, for example https://family.example.com, with no trailing slash or path. The host should route requests to the port it provides in PORT (default 3000) and terminate HTTPS.

For Docker, build the included Dockerfile and set the same environment variables at runtime. Never bake the hosting secret into the image.

If you switch from an onrender.com address to a custom domain, set PUBLIC_ORIGIN to that domain, redeploy, and use only that address. This keeps the same-origin checks and sign-in cookies consistent.

## Sign-in and access

- Family names and access codes still authenticate against your existing private Sheet. Existing codes are not reissued by the conversion.
- The new host stores the login session in an HttpOnly, SameSite=Strict cookie, with Secure enabled in production. Browser JavaScript does not receive or store the session token.
- Family members sign in again on the new website. Sessions last up to six hours and can end earlier if Google's cache evicts them.
- Administrator code recovery is still available in the private Google Sheet. Deactivating a member or issuing a new member code invalidates that member's existing sessions.
- The hosting secret belongs only in your hosting environment and Apps Script properties. Do not share it with family members, place it in public files, or send it in chat. A parent can retrieve it with showHostingConnection.
- Google calls are server-to-server, signed with HMAC and short-lived timestamps. The Apps Script endpoint checks signatures and caches used request nonces. No Google credentials, connection URLs or hosting secrets are served in the app's browser files.
- Requests from other website origins and direct access to server/source/environment files are rejected. All normal browser assets come from your own site; there are no advertising, tracking, external-font or image-service requests.

## Planning and the botanical interface

The previous app's task/voting/allocation rules are unchanged. Everyone active, including the administrator, must vote on each task. Unresolved disagreements hold a task for discussion. Plans use 80% of available hours and respect the member's expertise level; professional work remains unallocated.

Choose your avatar in My availability and save. Successful actions trigger celebrations; completing a task creates a bigger burst. The celebration toggle is saved per browser, and reduced-motion preferences replace fireworks with a still success message. No audio plays.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Google age-restriction page | Use the new hosted website URL, not a Google URL. Approve the new site through Family Link if requested. |
| The website will not start | Check Render logs for the missing environment variable name. Set Node version 24, APPS_SCRIPT_URL and HOSTING_SECRET, then redeploy. |
| “Spreadsheet connection needs attention” | Use the new signed-backend Code.gs and deployment; HOSTING_SECRET must match the value shown by showHostingConnection. |
| Google permission or HTML-response error in the connection check | The Google endpoint must be a deployed /exec URL with Execute as Me and anonymous Anyone access. Use New deployment after saving the new Code.gs. |
| “Open the family website directly” | PUBLIC_ORIGIN must match the website address exactly. On Render, remove an incorrect PUBLIC_ORIGIN override to use its automatic address. |
| “Name or access code is incorrect” | Use the latest member code and current name, not the hosting secret or Google password. |
| “Too many attempts” | Wait 15 minutes before retrying sign-in; repeated attempts do not help. |
| First visit takes a while | A Render Free web service may be waking from sleep. |
| An action times out | Refresh and inspect the current state before repeating it; the original action may already have saved. The app never retries mutations automatically. |

## Updating and rollback

- Website files: commit changes to the connected repository, then deploy the new version through your host.
- Google backend: save Code.gs and deploy a new version of the **hosted connection** deployment. Keep its URL consistent or update APPS_SCRIPT_URL.
- Your old Google-hosted app deployment can remain available to adults during testing. It continues to point at its previously deployed code version and shares the same Sheet. Stop using it once the migration is accepted if you want a single family website.
- Your Sheet's existing version history remains your data backup. Hosting restarts do not erase household records.

## Validation

The included Node tests exercise the hosted server and signed Google bridge with a simulated Google runtime: signature verification, replay and stale-message rejection, login cookies, role checks, origins, private-file protection, preserved task data and codes, avatars, required votes, disagreement resolution, planning, completion and credential rotation.

Additional local Chromium checks use the real hosted HTTP server and simulated Google endpoint to verify parent and child sign-in, cookies, task completion, fireworks, avatar persistence, voting, mobile layout, reload and logout. Every recorded browser request remains on the hosted website's origin.

Actual Google deployment, your hosting account, and the child's supervised device must still be connected and tested. Google Apps Script quotas and temporary Google availability can affect the spreadsheet connection. This is intended for a small family household, not a public multi-tenant service.

## Reference documentation

- Google Apps Script Content Service: https://developers.google.com/apps-script/guides/content
- Render Node web services: https://render.com/docs/deploy-node-express-app
- Render environment variables: https://render.com/docs/environment-variables
- Render Free services: https://render.com/docs/free
