# Deploy checklist for Lori + LTX-2.3 + LipSync

This checklist is for the Modal side of the production pipeline.

1. Deploy the LTX-2.3 generation worker used by the API.
2. Deploy the Lori/LipSync worker used by `POST /api/generate/lip-sync`.
3. Confirm both workers have access to their required Modal Volumes and model files.
4. Confirm the LTX worker can call the Render webhook URL.
5. Confirm the LipSync worker can call the same webhook URL.
6. Set the Render service's Modal endpoint environment variables to the exact deployed Modal URLs.
7. If Modal proxy authentication is enabled, set the matching `MODAL_KEY` and `MODAL_SECRET` in Render.
8. Test the full sequence with one short MP3 and one short LTX section before running a full production job.

Expected callback flow:

`LTX Modal completion -> POST /api/modal/webhook -> API starts LipSync -> LipSync Modal completion -> POST /api/modal/webhook -> parent job completed`

The API also accepts `/api/webhooks/modal` as a compatibility alias.

If the Modal endpoint itself fails TLS, returns 404, or returns 500, fix/deploy the Modal worker before debugging the Render API. Render cannot repair a failed Modal worker by itself.
