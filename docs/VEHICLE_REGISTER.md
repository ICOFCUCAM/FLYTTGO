# Plate lookup in the vehicle register

Owner's decision, 31 October 2026: the driver application on `/become-a-driver` fills make, model and year
from the number plate, using Statens vegvesen's API for technical vehicle data.

## How it works

- `supabase/functions/vehicle-lookup` (deploy with `--no-verify-jwt`; it checks the caller itself).
  - `{ "probe": true }` answers `{ available }`. The form shows the lookup only when it is `true`.
  - `{ "plate": "AB 12345" }` needs a signed-in user, at most 20 lookups an hour per user and instance.
- `supabase/functions/_shared/vehicle-register.ts` calls the register and reads only:
  - make (`merke`);
  - trade name (`handelsbetegnelse`);
  - first registration in Norway, for the year.
- The answer is never stored. The filled-in fields stay editable, and what the driver submits is what
  goes into `driver_applications`.

## Switching it on (the owner)

1. Order an API key for "Kjøretøyoppslag" through Altinn, on behalf of FlyttGo AS. Statens vegvesen:
   api-kjoretoy@vegvesen.no.
2. Check the endpoint and the authorisation header in the agreement that comes with the key, against
   the defaults:
   - `SVV_API_URL`: `https://akfell-datautlevering.atlas.vegvesen.no/enkeltoppslag/kjoretoydata`
     (`?kjennemerke=` is added).
   - `SVV_AUTH_HEADER`: `SVV-Authorization`, value `Apikey <key>`.

   These defaults could not be confirmed from the build environment, so set the two secrets if the
   agreement says otherwise.
3. Set the secret `SVV_API_KEY` (and the two above if needed), then deploy `vehicle-lookup`.

Until the key is set, the lookup is off and the form looks as it did before.
