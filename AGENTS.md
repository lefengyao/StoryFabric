# StoryFabric Agent Instructions

## Release and deployment package checks

When changing the application version or any code shipped to the Linux server, the source version and release artifacts must be updated together. Do not assume that an existing file under `release/` was rebuilt.

Required release flow:

1. Update `package.json` and the root package entry in `package-lock.json` to the same version.
2. Run `npm run server:bundle` to rebuild the server payload. This must create `release/<version>/storyfabric-server-<version>.tar.gz` and update `release/<version>/server-bundle/VERSION`.
3. Run the platform packaging command, for Windows `npm run dist:win`. It reruns the server bundle step and embeds the resulting archive as `resources/server-bundle.tar.gz`.
4. Before reporting the release as ready, verify all of the following are the new version:
   - `package.json` and the root `package-lock.json` entry;
   - `release/<version>/server-bundle/VERSION`;
   - `VERSION` inside `release/<version>/storyfabric-server-<version>.tar.gz`;
   - `VERSION` inside `release/<version>/win-unpacked/resources/server-bundle.tar.gz`;
   - `release/<version>/latest.yml` and the new installer filenames.
5. Compare the SHA256 of the standalone server archive and the archive embedded in the unpacked installer. They must match exactly.

The server deployment service uploads the standalone bundle during deployment, while a packaged desktop app reads the embedded `resources/server-bundle.tar.gz`. Updating only `package.json`, `package-lock.json`, or `latest.yml` is insufficient. Every version must have its own `release/<version>/` directory; never put new artifacts in the release root or select a package by an unversioned path.

## Linux server data boundary

The deployed container uses a host bind mount:

- Host: `<install directory>/data`
- Container: `/data`

Projects created by the server are stored under the host filesystem, normally:

`<install directory>/data/workspaces/<workspace-id>/`

The container's `/app` and other writable image layers are not the project data location and must not be treated as persistent storage. Server settings are stored at `<install directory>/data/settings.json`. The access key is stored outside the container at `<install directory>/secrets/storyfabric_key` and mounted read-only at `/run/secrets/storyfabric_key`.

When updating or uninstalling the server, preserve `<install directory>/data`; the update flow is expected to replace the container/image while keeping this bind-mounted data unchanged.
