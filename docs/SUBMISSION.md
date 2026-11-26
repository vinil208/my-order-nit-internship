# NIT submission handoff after the upgrade

The upgraded app, tests, source history and documentation are prepared locally. The source package is `my-order-upgraded-source.zip`; it contains the complete Git bundle. No public repository or hosted deployment was created.

## Local use

Node 24+, then `npm start`. Seven demo accounts use Demo@12345. `npm test` verifies the automated suite. `npm run benchmark` performs the exact scenario in an isolated database. See the README for a persistent separate benchmark dataset.

## Publish existing history

Create an empty public GitHub/GitLab repository, then push the existing master branch. From an extracted package, restore the history with:

```sh
git clone repository-history.bundle my-order
cd my-order
git remote set-url origin YOUR_PUBLIC_REPOSITORY_URL
git push -u origin master
```

Replace the URL with the repository you created and use the host's normal sign-in flow. Do not squash the project into one final-upload commit.

## Video status

The updated single demo, my-order-nit-internship-demo.mp4, was recorded on 26 November 2026. It runs 6 minutes 49 seconds at 1920 x 1080, with English narration and captions. It includes the mandatory benchmark and upgraded mobile, offline, planning, reconciliation and correction workflows. Full decoding and audio checks passed. See [video coverage](VIDEO.md). The new public video link remains pending upload.

Submit the final public repository URL and an accessible unlisted YouTube or Drive demo link. The old YouTube link was not changed. Check reviewer access before submitting. The local-run command satisfies the task's local-start option; no hosted deployment is claimed.
