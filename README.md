# deckpilot-ui

A thin browser client (plain HTML, CSS and JavaScript, no build step) served by nginx. It is a client of the
`project-service` API, not a business service. nginx forwards `/api/*` to `http://project-service:8000/`, so the
browser needs no CORS and the agents stay private inside the cluster.

Features: create a project (type or **dictate with the mic**; slide count; one of four themes; sample briefs), answer the intake agent's questions, live progress stepper,
a **slide-by-slide preview** that matches the .pptx (stat cards, charts, tables, process steps), **restyle** the finished deck in another theme without a new search, sources, **Download .pptx**, per-project **activity log** (every call project-service made to
intake/research/builder, with request and response), and an **API console** at the bottom showing every request
the UI sends and the response it receives.

Dictation uses the browser's built-in speech recognition (Chrome or Edge, on `localhost` or HTTPS); no Azure service is involved.
Those browsers send the audio to their own speech service.

## Run
Part of the compose file / minikube deployment in `deckpilot-deploy`. Standalone image:
`docker build -t deckpilot/deckpilot-ui:1.0 .` · manifest `k8s/deckpilot-ui.yaml` (NodePort 30080).

CI: `.github/workflows/ci.yml` (JavaScript syntax check, `nginx -t`, image build/push).
