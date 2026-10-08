import { GetOsduRecordResponse } from "@workspace/api-zod";

export function parseStorageRecordResponse(record: Record<string, unknown>) {
  return GetOsduRecordResponse.parse({
    id: record.id ?? null,
    kind: record.kind ?? null,
    version: record.version ?? null,
    createUser: record.createUser,
    createTime: record.createTime,
    modifyUser: record.modifyUser,
    modifyTime: record.modifyTime,
    acl: record.acl ?? {},
    legal: record.legal ?? {},
    data: record.data ?? {},
    meta: record.meta ?? [],
    ancestry: record.ancestry ?? {},
    tags: record.tags ?? {},
  });
}
