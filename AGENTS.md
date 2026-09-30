# Base44 development notes

- The preview serves the ProperDocs documentation, including `/api_reference/flygym/anatomy/`, rather than the separate React game under `web/fly-neural-sandbox`.
- Start with `docker compose -f docker-compose.base44.yml up -d --build`. Source is bind-mounted; startup synchronizes `uv.lock` with the `dev` extra into a named virtualenv volume. No credentials or database are required for the docs.
- MuJoCo's model asset generation needs the EGL/GL system libraries even for a documentation preview. The Base44 runtime Dockerfile installs them without baking in app source.
- The existing ProperDocs startup hook downloads pinned MuJoCo/Three.js browser libraries and generates viewer/game assets when missing. First boot requires network access and can take longer than subsequent boots.
- ProperDocs watches docs/config/wasm plus the source and documentation scripts. It rebuilds and reloads automatically; do not replace it with a static production server.
- Verify with `docker compose -f docker-compose.base44.yml ps`, GET `/`, and GET `/api_reference/flygym/anatomy/` on port 3000. Logs should show watched paths and the live server on `0.0.0.0:3000`.
- The independent React game has its own README, package manifest, and tests; it is not required to serve the documentation.
