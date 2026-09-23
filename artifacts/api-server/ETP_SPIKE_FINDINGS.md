# Reservoir DDMS ETP feasibility spike

Date: 2026-09-22

This was a throwaway live probe against:

- REST: `https://akerbp.energy.azure.com/api/reservoir-ddms/v2/`
- ETP: `wss://akerbp.energy.azure.com/api/reservoir-ddms-etp/v2/`
- ETP subprotocol: `etp12.energistics.org`

No product code, package manifest, lockfile, or workspace dependency was changed. The ETP serializer and one-off WebSocket dependency ran only from `/tmp`.

## Executive result

The ADME server supports ETP 1.2 Protocol 9 and successfully served both `GetDataArrays` and `GetDataSubarrays`. A `10 × 10` slab request returned exactly 100 values.

However, a browser-native WebSocket from the Replit frontend origin cannot authenticate: browsers cannot attach the required `Authorization` and `data-partition-id` upgrade headers, and the tested query-parameter token forms were ignored by the gateway. Server-side ETP works; browser-only ETP does not.

For the representative `2321 × 896` Grid2d array, ETP used about 48% fewer application-payload bytes than REST JSON. REST's existing `format=base64` response reduced the REST response by about 31% and was slightly faster than the cold ETP measurement. This materially narrows the efficiency case for adding an ETP client.

## 1. Server-side protocol probe

### Authentication and upgrade

- Cold AAD client-credentials token request: HTTP 200 in approximately **367 ms**.
- Authenticated WebSocket upgrade: HTTP **101** in **511 ms**.
- Negotiated subprotocol: `etp12.energistics.org`.
- `OpenSession` received **640 ms** after starting the WebSocket probe.
- Server application: `ReservoirDDMS - OSDU Reservoir DDMS ETP-1.2 Server`.
- Server version string: `OSDU M26 -  ()`.

ETP 1.2 does not define a separate `GetSupportedProtocols` message in the live schema used for this probe. The server reports enabled protocols in `OpenSession.supportedProtocols`, which is the protocol ground truth.

### Enabled protocols reported by `OpenSession`

| Protocol | Role | Version |
|---|---|---|
| 3 — Discovery | store | 1.2.0.0 |
| 4 — Store | store | 1.2.0.0 |
| 9 — DataArray | store | 1.2.0.0 |
| 18 — Transaction | store | 1.2.0.0 |
| 24 — Dataspace | store | 1.2.0.0 |

Protocol 26 was requested but not returned. The only endpoint capability key returned was `MaxWebSocketMessagePayloadSize`. Protocol 9's `protocolCapabilities` map was empty, so capability-map inspection alone does not reveal method-level support.

### Direct `GetDataSubarrays` proof

Method support was therefore tested directly:

- Request: Protocol 9 `GetDataSubarrays`
- Requested slab: starts `[0, 0]`, counts `[10, 10]`
- Response: Protocol 9 `GetDataSubarraysResponse`
- Response dimensions: `[10, 10]`
- Values returned: **100**
- Request payload: **200 bytes**
- Response payload: **420 bytes**
- Round-trip after the full-array test: approximately **139 ms**

**Conclusion:** Protocol 9 is enabled and `GetDataSubarrays` works on the live ADME server.

## 2. Browser-side feasibility

A browser-native `WebSocket` was created from the actual Replit-served frontend origin with subprotocol `etp12.energistics.org`.

### Result

- The socket failed before opening.
- Browser close code: **1006**.
- Time to failure: approximately **373 ms**.

Browsers cannot set `Authorization` or `data-partition-id` on a WebSocket upgrade. Raw upgrade probes from the same Replit origin tested:

- no query token;
- `access_token=...`;
- `token=...`;
- `authorization=...`.

All returned HTTP **401** before upgrade. The gateway's `www-authenticate` response said that the Authorization header could not be parsed, showing that these query parameters were not accepted as authentication substitutes.

An ETP `RequestSession`/`noHeaders` body cannot solve this ordering problem because the HTTP upgrade must succeed before any ETP body can be sent.

**Conclusion:** direct browser-only ETP is not feasible against this endpoint. A browser feature would require a trusted server-side WebSocket proxy or a server-side ETP adapter.

## 3. Efficiency measurement

### Representative array

- Dataspace: `PDS-Preview/CWP_Session_2`
- Resource type: `resqml20.obj_Grid2dRepresentation`
- Resource UUID: `2f1aca7b-dfb8-4826-ad9a-7b6a3dfa3419`
- Resource name: `Horizon 2 Horizon Representation`
- Array path: `resqml20/2f1aca7b-dfb8-4826-ad9a-7b6a3dfa3419/points_patch0`
- Dimensions: `[2321, 896]`
- Value count: **2,079,616**
- REST-reported type: `Int8Array`

### Full-array comparison

The byte counts below are observable application payloads. They exclude TLS, TCP, and HTTP/WebSocket framing overhead.

| Path | Response bytes | Wall-clock |
|---|---:|---:|
| REST JSON full array | 16,072,150 | 4,575 ms |
| REST `format=base64` full array | 11,091,546 | 2,746 ms |
| ETP full array response | 8,318,485 | 2,270 ms after `OpenSession`; 2,910 ms including authenticated WS handshake/session |

ETP setup payloads were 185 bytes for `RequestSession`, 243 bytes for `OpenSession`, and 189 bytes for `GetDataArrays`. Including these, the ETP application payload through completion of the full array was approximately **8,319,102 bytes**.

Including the measured cold AAD token request:

- ETP cold token + handshake/session + full array: approximately **3,277 ms**.
- REST cold token + full JSON array: approximately **4,942 ms**.
- REST cold token + base64 full array: approximately **3,113 ms**.

Relative to REST JSON, ETP reduced application payload by approximately **48%** and cold wall-clock by approximately **34%** in this single run. Existing REST base64 reduced payload by approximately **31%** and made its cold wall-clock slightly lower than ETP in this run, although its response remained about 2.77 MB larger.

### REST alternatives

- `format=base64` is supported and returns JSON with the same `uid` and dimensions plus a base64 string.
- The array metadata endpoint is supported and returned 418 bytes in 279 ms.
- A direct REST slice attempt using `starts=0,0&counts=10,10` returned HTTP 400 with `starts and counts dimensions not compatible with array dimensions`. No confirmed working REST slab request was established in this spike.
- No binary content type, streaming body, direct HDF5 response, or dataset-blob download was discovered on the tested array endpoints.

The REST base64 option closes much of the full-array efficiency gap, but the tested ETP path is the only path that conclusively returned a partial slab.

## 4. Ground-truth REST shapes

The live responses were captured before writing this report. Raw fixtures remained in throwaway scratch space because the requested workspace deliverable was findings only and the full array fixture is 16.1 MB. Integrity hashes are included so a future implementation can identify equivalent captures.

### Record response

- HTTP 200
- 12,889 bytes
- SHA-256: `54eec249939e38a3b0b66b606bd0c239c271147eb33dd97ac9069e3f42636ada`
- Top-level shape: an array with one RESQML record
- Record keys: `$type`, `Citation`, `Grid2dPatch`, `RepresentedInterpretation`, `SchemaVersion`, `SurfaceRole`, `Uuid`

Representative shape:

```json
[
  {
    "$type": "...",
    "Citation": {},
    "Grid2dPatch": {},
    "RepresentedInterpretation": {},
    "SchemaVersion": "...",
    "SurfaceRole": "...",
    "Uuid": "..."
  }
]
```

### Array response

- HTTP 200
- 16,072,150 bytes
- SHA-256: `08a5aa31e4f3dd06a442447b85bd6c842009300409874241740a618cdc694074`
- Exact envelope: `{uid, data:{dimensions,data}}`
- Dimensions: `[2321, 896]`
- `data.data` length: 2,079,616

Representative shape:

```json
{
  "uid": {
    "uri": "eml:///dataspace('PDS-Preview/CWP_Session_2')/eml20.obj_EpcExternalPartReference(359d6a59-0db4-4115-8010-a3220438f943)",
    "pathInResource": "resqml20/2f1aca7b-dfb8-4826-ad9a-7b6a3dfa3419/points_patch0"
  },
  "data": {
    "dimensions": [2321, 896],
    "data": ["2,079,616 values"]
  }
}
```

The ETP `GetDataArraysResponse` returned the same dimensions and value count. A production adapter would still need a value-by-value equality test against a retained fixture before replacing the REST path.

## Recommendation

The server satisfies the first gate: `GetDataSubarrays` is enabled and works. The second gate is not satisfied strongly enough to justify implementation now:

- browser-side ETP is not feasible without a new server proxy/adapter;
- the representative full grid was served successfully by REST;
- REST base64 substantially narrows the full-array transfer and timing gap;
- no confirmed product requirement was supplied that needs partial slabs and cannot be served by REST.

**NO-GO — do not add an ETP client now. Reconsider only when a confirmed large-grid workflow requires partial slab reads that REST cannot serve.**

## base64 array schema

- Dataspace: `PDS-Preview/CWP_Session_2`
- Datatype: `resqml20.obj_Grid2dRepresentation`
- UUID: `2f1aca7b-dfb8-4826-ad9a-7b6a3dfa3419`
- Array path: `resqml20/2f1aca7b-dfb8-4826-ad9a-7b6a3dfa3419/points_patch0`

### 1. Array metadata

Full JSON:

```json
{
  "uid": {
    "uri": "eml:///dataspace('PDS-Preview/CWP_Session_2')/eml20.obj_EpcExternalPartReference(359d6a59-0db4-4115-8010-a3220438f943)",
    "pathInResource": "resqml20/2f1aca7b-dfb8-4826-ad9a-7b6a3dfa3419/points_patch0"
  },
  "dimensions": [
    2321,
    896
  ],
  "preferredSubarrayDimensions": [],
  "logicalArrayType": 0,
  "transportArrayType": 3,
  "storeLastWrite": "1970-01-01T00:00:00.000Z",
  "storeCreated": "1970-01-01T00:00:00.000Z",
  "customData": {}
}
```

- Numeric type field: `transportArrayType`
- Exact value: `3`
- Logical array type: `0`

### 2. Base64 response

- Top-level JSON keys: `uid`, `data`
- `data.data` is a base64 string: `true`
- Base64 string length: **11,091,288** characters

### 3. Decoded interpretations

- Decoded buffer length: **8,318,464** bytes
- Float32 little-endian element count: **2,079,616**
- Float32 little-endian first 5: `["NaN", "NaN", "NaN", "NaN", "NaN"]`
- Int32 little-endian element count: **2,079,616**
- Int32 little-endian first 5: `[2143289344, -4194304, -4194304, -4194304, -4194304]`

### 4. Default JSON response

- Default JSON `data.data` first 5: `[null, null, null, null, null]`

### 5. Result

- Float32 little-endian matches the default first 5 after JSON NaN-to-null serialization: **true**
- Int32 little-endian matches the default first 5: **false**
- Dimensions: `[2321, 896]`
- Product of dimensions: **2,079,616**
- Decoded element count equals `product(dimensions)`: **true**
- Matching interpretation: **Float32 little-endian**; the NaN values appear as `null` in the default JSON response.