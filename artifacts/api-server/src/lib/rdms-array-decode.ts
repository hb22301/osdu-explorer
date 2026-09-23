// Decodes a Reservoir DDMS `?format=base64` array response back into the plain
// number array the frontend expects. base64 transfers the raw little-endian
// element bytes instead of a JSON number list, which is far smaller for large
// grids. The element type is not part of the array payload, so it must come
// from the array-metadata endpoint: older ADME servers report a numeric
// `transportArrayType` (the Energistics ETP v12 AnyArrayType enum), newer ones
// a string `arrayType` (a JS TypedArray name). Both are supported. Anything we
// cannot decode with certainty returns null so the caller can fall back to the
// server's default JSON array response — decoding with the wrong element type
// would silently corrupt the numbers, so the type is always read, never guessed.

interface ElementDecoder {
  bytesPerElement: number;
  read: (view: DataView, byteOffset: number) => number;
}

// Energistics ETP v12 AnyArrayType enum values that map to a numeric element.
// int32 (1) and float32 (3) share a byte width but never share a value, and the
// same holds for long (2) and double (4), so the reported value is unambiguous.
const TRANSPORT_TYPE_DECODERS: Record<number, ElementDecoder> = {
  1: { bytesPerElement: 4, read: (view, offset) => view.getInt32(offset, true) },
  2: { bytesPerElement: 8, read: (view, offset) => Number(view.getBigInt64(offset, true)) },
  3: { bytesPerElement: 4, read: (view, offset) => view.getFloat32(offset, true) },
  4: { bytesPerElement: 8, read: (view, offset) => view.getFloat64(offset, true) },
};

// JS TypedArray names reported by newer servers' `arrayType` metadata field.
const ARRAY_TYPE_DECODERS: Record<string, ElementDecoder> = {
  Int8Array: { bytesPerElement: 1, read: (view, offset) => view.getInt8(offset) },
  Uint8Array: { bytesPerElement: 1, read: (view, offset) => view.getUint8(offset) },
  Int16Array: { bytesPerElement: 2, read: (view, offset) => view.getInt16(offset, true) },
  Uint16Array: { bytesPerElement: 2, read: (view, offset) => view.getUint16(offset, true) },
  Int32Array: { bytesPerElement: 4, read: (view, offset) => view.getInt32(offset, true) },
  Uint32Array: { bytesPerElement: 4, read: (view, offset) => view.getUint32(offset, true) },
  BigInt64Array: { bytesPerElement: 8, read: (view, offset) => Number(view.getBigInt64(offset, true)) },
  BigUint64Array: { bytesPerElement: 8, read: (view, offset) => Number(view.getBigUint64(offset, true)) },
  Float32Array: { bytesPerElement: 4, read: (view, offset) => view.getFloat32(offset, true) },
  Float64Array: { bytesPerElement: 8, read: (view, offset) => view.getFloat64(offset, true) },
};

function resolveDecoder(metadata: unknown): ElementDecoder | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const record = metadata as Record<string, unknown>;
  const arrayType = record.arrayType;
  if (typeof arrayType === "string" && arrayType in ARRAY_TYPE_DECODERS) {
    return ARRAY_TYPE_DECODERS[arrayType];
  }
  const transportArrayType = record.transportArrayType;
  if (typeof transportArrayType === "number" && transportArrayType in TRANSPORT_TYPE_DECODERS) {
    return TRANSPORT_TYPE_DECODERS[transportArrayType];
  }
  return null;
}

// True when the array-metadata payload names an element type we can decode, so
// the caller can decide whether to request base64 at all — fetching base64 and
// then discarding it (falling back to plain JSON) wastes a large transfer.
export function metadataElementIsSupported(metadataPayload: unknown): boolean {
  return resolveDecoder(metadataPayload) !== null;
}

function toDimensions(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const dimensions: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry <= 0) return null;
    dimensions.push(entry);
  }
  return dimensions;
}

export interface DecodedArrayResponse {
  uid: unknown;
  data: { dimensions: number[]; data: number[] };
}

// Returns the decoded array in the frontend's { uid, data: { dimensions, data } }
// shape, or null to signal the caller should fall back to the plain JSON array.
// NaN floats are preserved verbatim; JSON.stringify serializes them to null,
// which matches the server's default JSON response for inactive nodes.
export function buildDecodedArrayResponse(
  dataPayload: unknown,
  metadataPayload: unknown,
): DecodedArrayResponse | null {
  if (typeof dataPayload !== "object" || dataPayload === null) return null;
  const payload = dataPayload as { uid?: unknown; data?: unknown };
  if (typeof payload.data !== "object" || payload.data === null) return null;
  const inner = payload.data as { dimensions?: unknown; data?: unknown };

  const base64 = inner.data;
  if (typeof base64 !== "string" || base64.length === 0) return null;

  const dimensions = toDimensions(inner.dimensions);
  if (!dimensions) return null;

  const decoder = resolveDecoder(metadataPayload);
  if (!decoder) return null;

  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength % decoder.bytesPerElement !== 0) return null;

  const count = buffer.byteLength / decoder.bytesPerElement;
  const expected = dimensions.reduce((product, size) => product * size, 1);
  if (count !== expected) return null;

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const values = new Array<number>(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = decoder.read(view, index * decoder.bytesPerElement);
  }

  return { uid: payload.uid, data: { dimensions, data: values } };
}

// True when the server ignored ?format=base64 and already returned the plain
// JSON number array, so it can be passed straight through without a re-fetch.
export function isPlainArrayResponse(dataPayload: unknown): boolean {
  if (typeof dataPayload !== "object" || dataPayload === null) return false;
  const inner = (dataPayload as { data?: unknown }).data;
  if (typeof inner !== "object" || inner === null) return false;
  return Array.isArray((inner as { data?: unknown }).data);
}
