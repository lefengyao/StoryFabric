# StoryFabric Agent Instructions

## Release and deployment package checks

When changing the application version or any code shipped to the Linux server, the source version and release artifacts must be updated together. Do not assume that an existing file under `release/` was rebuilt.

Required release flow:

1. Update `package.json` and the root package entry in `package-lock.json` to the same version.
2. When releasing the standalone Linux server, run `npm run server:bundle`. This must create `release/<version>/storyfabric-server-<version>.tar.gz` and update `release/<version>/server-bundle/VERSION`.
3. When releasing the Windows desktop app, run `npm run dist:win`. It no longer rebuilds or embeds the standalone server bundle.
4. Before reporting the release as ready, verify all of the following are the new version:
   - `package.json` and the root `package-lock.json` entry;
   - `release/<version>/server-bundle/VERSION`;
   - `VERSION` inside `release/<version>/storyfabric-server-<version>.tar.gz`;
   - `release/<version>/latest.yml` and the new installer filenames when a desktop release is produced.
5. For a server release, record and verify the standalone archive SHA256 printed by `npm run server:bundle`; use `server-bundle/SHA256SUMS` to verify the files contained inside the archive.

The standalone server archive is deployed manually. Updating only `package.json`, `package-lock.json`, or `latest.yml` is insufficient. Every version must have its own `release/<version>/` directory; never put new artifacts in the release root or select a package by an unversioned path.

## Linux server data boundary

The deployed container uses a host bind mount:

- Host: `<install directory>/data`
- Container: `/data`

Projects created by the server are stored under the host filesystem, normally:

`<install directory>/data/workspaces/<workspace-id>/`

The container's `/app` and other writable image layers are not the project data location and must not be treated as persistent storage. Server settings are stored at `<install directory>/data/settings.json`. The access key is stored outside the container at `<install directory>/secrets/storyfabric_key` and mounted read-only at `/run/secrets/storyfabric_key`.

When updating or uninstalling the server, preserve `<install directory>/data`; the update flow is expected to replace the container/image while keeping this bind-mounted data unchanged.
